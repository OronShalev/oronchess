import { describe, it } from "node:test";
import assert from "node:assert/strict";

import AnalysedGame from "@shared/types/game/AnalysedGame";
import EngineVersion from "@shared/constants/EngineVersion";
import parsePgn from "@client/lib/games/pgn";
import parseStateTree from "@shared/lib/stateTree/parse";
import { getPgnTimeControl } from "@shared/lib/stateTree/clocks";
import { getNodeChain } from "@shared/types/game/position/StateTreeNode";
import { encodeReviewCode, decodeReviewCode } from "../reviewShare";

// Made by the encoder before clocks were added to codes, from a game with
// clocks: they were left out, and the code ends after the engine lines
const codeBeforeClocks = "oronchess-Fi7p0IyC2NLGyiITexEIvELUsp2YyCJESIkRIiREjA";

function parseReviewedGame(pgn: string): AnalysedGame {
    const game = parsePgn(pgn);
    const analysedGame = { ...game, stateTree: parseStateTree(game) };

    const nodes = getNodeChain(analysedGame.stateTree);

    nodes.forEach((node, index) => {
        const nextMove = nodes[index + 1]?.state.move;

        node.state.engineLines = [{
            evaluation: nextMove
                ? { type: "centipawn", value: 20 * index }
                : { type: "centipawn", value: 0 },
            source: EngineVersion.STOCKFISH_19_LITE,
            depth: nextMove ? 16 : 0,
            index: 1,
            moves: nextMove ? [nextMove] : []
        }];
    });

    return analysedGame;
}

function getTimes(game: AnalysedGame) {
    return getNodeChain(game.stateTree).map(node => ({
        clock: node.state.clock,
        moveTime: node.state.moveTime,
        lines: node.state.engineLines
    }));
}

describe("review codes with clocks", () => {
    it("keeps clocks, move times and the time control", () => {
        const game = parseReviewedGame(`[White "Alice"]
[Black "Bob"]
[Result "*"]
[TimeControl "180+2"]

1. e4 {[%clk 0:03:00]} 1... c5 {[%clk 0:03:00]} 2. Nf3 {[%clk 0:02:58.4]}
2... d6 {[%clk 0:02:59.9]} 3. d4 {[%clk 0:02:31]} 3... cxd4 {[%clk 0:01:02.7]} *`);

        const decoded = decodeReviewCode(encodeReviewCode(game));
        assert.ok(decoded);

        assert.equal(getPgnTimeControl(decoded.pgn), "180+2");
        assert.deepEqual(getTimes(decoded), getTimes(game));
        assert.equal(decoded.players.white.username, "Alice");
    });

    it("keeps the clocks of repeated positions apart", () => {
        const game = parseReviewedGame(`[Result "1/2-1/2"]
[TimeControl "60"]

1. Nf3 {[%clk 0:01:00]} 1... Nf6 {[%clk 0:01:00]} 2. Ng1 {[%clk 0:00:58]}
2... Ng8 {[%clk 0:00:57]} 3. Nf3 {[%clk 0:00:55]} 3... Nf6 {[%clk 0:00:51]}
4. Ng1 {[%clk 0:00:50]} 4... Ng8 {[%clk 0:00:44]} 1/2-1/2`);

        const decoded = decodeReviewCode(encodeReviewCode(game));
        assert.ok(decoded);

        assert.deepEqual(getTimes(decoded), getTimes(game));
    });

    it("still opens codes made before clocks were added", () => {
        const decoded = decodeReviewCode(codeBeforeClocks);
        assert.ok(decoded);

        const nodes = getNodeChain(decoded.stateTree);

        assert.equal(nodes.length, 8);
        assert.ok(nodes.every(node => node.state.engineLines.length == 1));
        assert.ok(nodes.every(node => node.state.clock == undefined));
    });

    it("makes codes for games without clocks as before", () => {
        const game = parseReviewedGame("[Result \"*\"]\n\n1. e4 e5 2. Nf3 *");

        const decoded = decodeReviewCode(encodeReviewCode(game));
        assert.ok(decoded);

        assert.deepEqual(getTimes(decoded), getTimes(game));
    });
});
