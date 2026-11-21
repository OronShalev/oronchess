import { describe, it } from "node:test";
import assert from "node:assert/strict";

import PieceColour from "@shared/constants/PieceColour";
import parsePgn from "@client/lib/games/pgn";
import parseStateTree from "@shared/lib/stateTree/parse";
import { getNodeChain } from "@shared/types/game/position/StateTreeNode";
import { getGameAnalysis } from "../report";
import { getGameAccuracy, getMeanAccuracy } from "../accuracy";
import { centipawns, createLine } from "./helpers";

// Castling on both sides, en passant and a promotion with capture
const specialMovesPgn = `[Result "*"]

1. e4 d5 2. e5 f5 3. exf6 Nc6 4. fxg7 Nf6 5. gxh8=Q Bf5 6. Nf3 e6
7. Be2 Qd7 8. O-O O-O-O *`;

/**
 * @description Gives every mainline position a top line holding the
 * move played next, all at an equal evaluation.
 */
function parseEvaluatedGame(pgn: string) {
    const stateTree = parseStateTree(parsePgn(pgn));
    const nodes = getNodeChain(stateTree);

    nodes.forEach((node, index) => {
        node.state.engineLines = [createLine(
            centipawns(0),
            node.state.fen,
            nodes[index + 1]?.state.move?.san
        )];
    });

    return { stateTree, nodes };
}

describe("game analysis", () => {
    it("classifies games with castling, en passant and promotion", () => {
        const { stateTree, nodes } = parseEvaluatedGame(specialMovesPgn);

        getGameAnalysis(stateTree);

        const moveNodes = nodes.slice(1);

        assert.equal(moveNodes.length, 16);
        assert.ok(moveNodes.every(node => node.state.classification));
        assert.ok(moveNodes.every(node => node.state.accuracy == 100));

        const accuracies = getGameAccuracy(stateTree);

        assert.deepEqual(accuracies.white, {
            accuracy: 100, analysedMoves: 8, totalMoves: 8
        });
        assert.deepEqual(accuracies.black, {
            accuracy: 100, analysedMoves: 8, totalMoves: 8
        });
    });

    it("leaves moves without lines out of accuracy and counts them", () => {
        const { stateTree, nodes } = parseEvaluatedGame(specialMovesPgn);

        // White's fourth move, fxg7, is not the top move and loses points
        nodes[6].state.engineLines = [
            createLine(centipawns(0), nodes[6].state.fen, "d4")
        ];
        nodes[7].state.engineLines[0].evaluation = centipawns(-300);

        // Position 10 has no lines, so neither Black's fifth move, which
        // leads to it, nor White's sixth, which is played from it, can
        // be compared
        nodes[10].state.engineLines = [];

        getGameAnalysis(stateTree);

        const accuracies = getGameAccuracy(stateTree);

        assert.equal(nodes[10].state.accuracy, undefined);
        assert.equal(nodes[11].state.accuracy, undefined);

        assert.equal(accuracies.white.analysedMoves, 7);
        assert.equal(accuracies.white.totalMoves, 8);
        assert.ok(accuracies.white.accuracy < 100);

        assert.equal(accuracies.black.analysedMoves, 7);
        assert.equal(accuracies.black.totalMoves, 8);
        assert.equal(accuracies.black.accuracy, 100);
    });

    it("takes the power mean of each side's move accuracies", () => {
        const { stateTree, nodes } = parseEvaluatedGame(specialMovesPgn);

        // White's second move, e5, drops a pawn of an equal position
        nodes[2].state.engineLines = [
            createLine(centipawns(0), nodes[2].state.fen, "Nc3")
        ];
        nodes[3].state.engineLines[0].evaluation = centipawns(-100);

        getGameAnalysis(stateTree);

        const whiteAccuracies = nodes
            .filter(node => node.state.moveColour == PieceColour.WHITE)
            .map(node => node.state.accuracy!);

        const plainMean = whiteAccuracies.reduce((sum, accuracy) => (
            sum + accuracy
        ), 0) / whiteAccuracies.length;

        const accuracies = getGameAccuracy(stateTree);

        assert.ok(nodes[3].state.accuracy! < 50);
        assert.equal(accuracies.white.accuracy, getMeanAccuracy(whiteAccuracies));

        // The dropped pawn weighs more than in an ordinary mean
        assert.ok(accuracies.white.accuracy < plainMean - 1);

        assert.equal(accuracies.white.analysedMoves, 8);
        assert.equal(accuracies.white.totalMoves, 8);
    });

    it("reports no accuracy for a side without moves", () => {
        const { stateTree } = parseEvaluatedGame("[Result \"*\"]\n\n1. e4 *");

        getGameAnalysis(stateTree);

        const accuracies = getGameAccuracy(stateTree);

        assert.equal(accuracies.white.accuracy, 100);
        assert.ok(Number.isNaN(accuracies.black.accuracy));
        assert.equal(accuracies.black.totalMoves, 0);
    });
});
