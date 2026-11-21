import { describe, it } from "node:test";
import assert from "node:assert/strict";

import PieceColour from "@shared/constants/PieceColour";
import parsePgn from "@client/lib/games/pgn";
import parseStateTree from "@shared/lib/stateTree/parse";
import { getNodeChain } from "@shared/types/game/position/StateTreeNode";
import { getGameAnalysis } from "../report";
import { getGameAccuracy } from "../accuracy";
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

    it("counts moves by how decided the game was when they were played", () => {
        const { stateTree, nodes } = parseEvaluatedGame(specialMovesPgn);

        // White's second move, e5, drops a pawn of an equal position
        nodes[2].state.engineLines = [
            createLine(centipawns(0), nodes[2].state.fen, "Nc3")
        ];
        nodes[3].state.engineLines[0].evaluation = centipawns(-100);

        // From White's fifth move on, White is winning, and plays on with
        // the top moves
        for (const node of nodes.slice(9)) {
            node.state.engineLines[0].evaluation = centipawns(900);
        }

        getGameAnalysis(stateTree);

        const whiteNodes = nodes.filter(
            node => node.state.moveColour == PieceColour.WHITE
        );

        const weightedMean = whiteNodes.reduce((sum, node) => (
            sum + node.state.accuracy! * node.state.accuracyWeight!
        ), 0) / whiteNodes.reduce((sum, node) => (
            sum + node.state.accuracyWeight!
        ), 0);

        const plainMean = whiteNodes.reduce((sum, node) => (
            sum + node.state.accuracy!
        ), 0) / whiteNodes.length;

        // The moves played once White was winning count less, so the
        // dropped pawn counts for more
        for (const index of [ 11, 13, 15 ]) {
            assert.ok(nodes[index].state.accuracyWeight! < 0.5);
        }

        const accuracies = getGameAccuracy(stateTree);

        assert.ok(Math.abs(accuracies.white.accuracy - weightedMean) < 1e-9);
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
