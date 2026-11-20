import { describe, it } from "node:test";
import assert from "node:assert/strict";

import AnalysedGame from "@shared/types/game/AnalysedGame";
import EngineVersion from "@shared/constants/EngineVersion";
import PieceColour from "@shared/constants/PieceColour";
import { Classification } from "@shared/constants/Classification";
import parsePgn from "@client/lib/games/pgn";
import parseStateTree from "@shared/lib/stateTree/parse";
import {
    StateTreeNode,
    addChildMove,
    getNodeChain
} from "@shared/types/game/position/StateTreeNode";
import {
    AttemptResult,
    LearningStep,
    getAttemptResult,
    getBestMove,
    getLearningStep,
    getMistakeLine,
    getMistakes,
    getMoveLabel,
    isGameReviewed,
    isSolvingResult
} from "../learning";

function parseGame(pgn: string): AnalysedGame {
    const game = parsePgn(pgn);

    return { ...game, stateTree: parseStateTree(game) };
}

// 1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#
function classifiedGame(classifications: (Classification | undefined)[]) {
    const game = parseGame("1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0");
    const nodes = getNodeChain(game.stateTree);

    nodes.slice(1).forEach((node, index) => {
        node.state.classification = classifications[index];
    });

    return { game, nodes };
}

function withTopMove(node: StateTreeNode, san: string, uci: string) {
    node.state.engineLines = [{
        evaluation: { type: "centipawn", value: 30 },
        source: EngineVersion.STOCKFISH_19_LITE,
        depth: 16,
        index: 1,
        moves: [{ san, uci }]
    }];
}

describe("finding mistakes", () => {
    const { game, nodes } = classifiedGame([
        Classification.THEORY, Classification.THEORY,
        Classification.INACCURACY, Classification.BEST,
        Classification.EXCELLENT, Classification.BLUNDER,
        Classification.BEST
    ]);

    it("lists a side's inaccuracies, mistakes and blunders in order", () => {
        assert.deepEqual(
            getMistakes(game.stateTree, PieceColour.WHITE),
            [ nodes[3] ]
        );

        assert.deepEqual(
            getMistakes(game.stateTree, PieceColour.BLACK),
            [ nodes[6] ]
        );
    });

    it("leaves out variations", () => {
        const variation = addChildMove(nodes[2], "Nf3");
        variation.state.classification = Classification.MISTAKE;

        assert.deepEqual(
            getMistakes(game.stateTree, PieceColour.WHITE),
            [ nodes[3] ]
        );
    });

    it("orders several mistakes from first to last", () => {
        const { game: other, nodes: otherNodes } = classifiedGame([
            Classification.MISTAKE, Classification.BEST,
            Classification.BLUNDER, Classification.BEST,
            Classification.INACCURACY, Classification.BEST,
            Classification.BEST
        ]);

        assert.deepEqual(
            getMistakes(other.stateTree, PieceColour.WHITE),
            [ otherNodes[1], otherNodes[3], otherNodes[5] ]
        );
    });

    it("knows whether a game was reviewed", () => {
        assert.equal(isGameReviewed(game.stateTree), true);
        assert.equal(isGameReviewed(parseGame("1. e4 e5 *").stateTree), false);
    });
});

describe("learning steps", () => {
    const { nodes } = classifiedGame([]);
    const mistake = nodes[3];

    it("follows the board from a mistake to the moves tried instead", () => {
        assert.equal(getLearningStep(mistake, mistake), LearningStep.MISTAKE);
        assert.equal(getLearningStep(nodes[2], mistake), LearningStep.RETRY);

        const attempt = addChildMove(nodes[2], "Nf3");
        assert.equal(getLearningStep(attempt, mistake), LearningStep.ATTEMPT);
    });

    it("is away anywhere else", () => {
        assert.equal(getLearningStep(nodes[1], mistake), LearningStep.AWAY);
        assert.equal(getLearningStep(nodes[4], mistake), LearningStep.AWAY);

        const deeper = addChildMove(addChildMove(nodes[2], "Nc3"), "Nf6");
        assert.equal(getLearningStep(deeper, mistake), LearningStep.AWAY);
    });
});

describe("attempt results", () => {
    const { nodes } = classifiedGame([]);

    function resultOf(classification?: Classification) {
        nodes[3].state.classification = classification;

        return getAttemptResult(nodes[3]);
    }

    it("waits for a classification", () => {
        assert.equal(resultOf(undefined), undefined);
    });

    it("counts the best moves and those as good", () => {
        for (const classification of [
            Classification.BRILLIANT,
            Classification.CRITICAL,
            Classification.BEST,
            Classification.THEORY
        ]) {
            assert.equal(resultOf(classification), AttemptResult.BEST);
        }
    });

    it("counts excellent moves as good, but not best", () => {
        assert.equal(resultOf(Classification.EXCELLENT), AttemptResult.GOOD);
    });

    it("keeps okay moves apart from good ones", () => {
        assert.equal(resultOf(Classification.OKAY), AttemptResult.OKAY);
    });

    it("counts inaccuracies, mistakes and blunders as bad", () => {
        assert.equal(resultOf(Classification.INACCURACY), AttemptResult.BAD);
        assert.equal(resultOf(Classification.MISTAKE), AttemptResult.BAD);
        assert.equal(resultOf(Classification.BLUNDER), AttemptResult.BAD);
    });

    it("solves a mistake with an excellent move or better", () => {
        const solving = Object.values(Classification).filter(
            classification => isSolvingResult(resultOf(classification))
        );

        assert.deepEqual(solving.sort(), [
            Classification.BRILLIANT,
            Classification.CRITICAL,
            Classification.BEST,
            Classification.EXCELLENT,
            Classification.THEORY,
            Classification.FORCED
        ].sort());

        assert.equal(isSolvingResult(undefined), false);
    });
});

describe("best moves", () => {
    it("reads the best move from the review's lines before a mistake", () => {
        const { nodes } = classifiedGame([]);

        withTopMove(nodes[2], "Nf3", "g1f3");

        const bestMove = getBestMove(nodes[3]);

        assert.equal(bestMove?.san, "Nf3");
        assert.equal(bestMove?.from, "g1");
    });

    it("has none without lines, or with an illegal one", () => {
        const { nodes } = classifiedGame([]);

        assert.equal(getBestMove(nodes[3]), undefined);

        withTopMove(nodes[2], "Nf6", "g8f6");
        assert.equal(getBestMove(nodes[3]), undefined);
    });
});

describe("lines after mistakes", () => {
    // After 1. e4 e5 2. Qh5, a long line of knight moves
    const lineUcis = [
        "b8c6", "g1f3", "g8f6", "b1c3", "c6b8", "c3b1",
        "b8c6", "b1c3", "c6b8", "c3b1", "b8c6", "b1c3"
    ];

    function withLine(node: StateTreeNode, ucis: string[]) {
        node.state.engineLines = [{
            evaluation: { type: "centipawn", value: -50 },
            source: EngineVersion.STOCKFISH_19_LITE,
            depth: 16,
            index: 1,
            moves: ucis.map(uci => ({ san: "", uci }))
        }];
    }

    it("follows the engine's line for five moves each", () => {
        const { nodes } = classifiedGame([]);
        const mistake = nodes[3];

        withLine(mistake, lineUcis);

        const line = getMistakeLine(mistake);

        assert.equal(line.length, 10);
        assert.deepEqual(
            line.slice(0, 3).map(node => node.state.move?.san),
            [ "Nc6", "Nf3", "Nf6" ]
        );

        assert.equal(line[0].parent, mistake);
        assert.equal(line[1].parent, line[0]);
        assert.equal(line[0].state.moveColour, PieceColour.BLACK);
        assert.equal(getMoveLabel(line[1]), "3. Nf3");
    });

    it("leaves the game as it was", () => {
        const { game, nodes } = classifiedGame([]);
        const mistake = nodes[3];
        const children = [ ...mistake.children ];

        withLine(mistake, lineUcis);
        getMistakeLine(mistake);

        assert.deepEqual(mistake.children, children);
        assert.equal(getNodeChain(game.stateTree).length, nodes.length);
    });

    it("stops at an illegal move, and is empty without lines", () => {
        const { nodes } = classifiedGame([]);

        withLine(nodes[3], [ "b8c6", "e1e8", "g8f6" ]);
        assert.equal(getMistakeLine(nodes[3]).length, 1);

        nodes[3].state.engineLines = [];
        assert.equal(getMistakeLine(nodes[3]).length, 0);
    });
});

describe("move labels", () => {
    const { nodes } = classifiedGame([]);

    it("numbers White and Black moves", () => {
        assert.equal(getMoveLabel(nodes[1]), "1. e4");
        assert.equal(getMoveLabel(nodes[4]), "2... Nc6");
        assert.equal(getMoveLabel(nodes[7]), "4. Qxf7#");
    });

    it("numbers moves of games from a position", () => {
        const fen = "4k3/8/8/8/8/8/4P3/4K3 b - - 0 30";
        const game = parseGame(`[SetUp "1"]\n[FEN "${fen}"]\n\n30... Kd7 31. e4 *`);
        const [ , blackMove, whiteMove ] = getNodeChain(game.stateTree);

        assert.equal(getMoveLabel(blackMove, fen), "30... Kd7");
        assert.equal(getMoveLabel(whiteMove, fen), "31. e4");
    });
});
