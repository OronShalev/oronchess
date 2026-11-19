import { describe, it } from "node:test";
import assert from "node:assert/strict";

import AnalysedGame from "@shared/types/game/AnalysedGame";
import EngineVersion from "@shared/constants/EngineVersion";
import parsePgn from "@client/lib/games/pgn";
import parseStateTree from "@shared/lib/stateTree/parse";
import { getNodeChain } from "@shared/types/game/position/StateTreeNode";
import { isDrawnByClaim } from "../evaluate";
import { encodeReviewCode, decodeReviewCode } from "../reviewShare";

const repetitionMoves = "1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8";

function parseGame(pgn: string): AnalysedGame {
    const game = parsePgn(pgn);

    return { ...game, stateTree: parseStateTree(game) };
}

function isGameDrawnByClaim(pgn: string) {
    const game = parseGame(pgn);

    return isDrawnByClaim(game, getNodeChain(game.stateTree));
}

describe("claimed draws", () => {
    it("detects a threefold repetition in a drawn game", () => {
        assert.equal(isGameDrawnByClaim(
            `[Result "1/2-1/2"]\n\n${repetitionMoves} 1/2-1/2`
        ), true);
    });

    it("ignores repetitions in games that were not drawn", () => {
        assert.equal(isGameDrawnByClaim(
            `[Result "*"]\n\n${repetitionMoves} *`
        ), false);

        assert.equal(isGameDrawnByClaim(
            `[Result "0-1"]\n\n${repetitionMoves} 0-1`
        ), false);
    });

    it("ignores a position seen only twice", () => {
        assert.equal(isGameDrawnByClaim(
            "[Result \"1/2-1/2\"]\n\n1. Nf3 Nf6 2. Ng1 Ng8 1/2-1/2"
        ), false);
    });

    it("detects the fifty move rule", () => {
        assert.equal(isGameDrawnByClaim(
            "[Result \"1/2-1/2\"]\n[SetUp \"1\"]\n"
            + "[FEN \"8/8/8/4k3/8/8/4K3/4R3 w - - 99 80\"]\n\n"
            + "80. Ra1 1/2-1/2"
        ), true);
    });

    it("detects insufficient material", () => {
        assert.equal(isGameDrawnByClaim(
            "[Result \"1/2-1/2\"]\n[SetUp \"1\"]\n"
            + "[FEN \"8/8/8/4k3/8/8/3nK3/8 w - - 0 1\"]\n\n"
            + "1. Kxd2 1/2-1/2"
        ), true);
    });

    it("keeps the drawn line of the final position in shared reviews", () => {
        const game = parseGame(
            `[Result "1/2-1/2"]\n\n${repetitionMoves} 1/2-1/2`
        );

        const nodes = getNodeChain(game.stateTree);

        nodes.forEach((node, index) => {
            const nextMove = nodes[index + 1]?.state.move;

            node.state.engineLines = [{
                evaluation: { type: "centipawn", value: 0 },
                source: EngineVersion.STOCKFISH_19_LITE,
                depth: nextMove ? 16 : 0,
                index: 1,
                moves: nextMove ? [nextMove] : []
            }];
        });

        const decoded = decodeReviewCode(encodeReviewCode(game));
        assert.ok(decoded);

        assert.deepEqual(
            getNodeChain(decoded.stateTree).map(node => node.state.engineLines),
            nodes.map(node => node.state.engineLines)
        );
    });
});
