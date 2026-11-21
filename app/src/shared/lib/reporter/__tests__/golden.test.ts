import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import parsePgn from "@client/lib/games/pgn";
import parseStateTree from "@shared/lib/stateTree/parse";
import { getNodeChain } from "@shared/types/game/position/StateTreeNode";
import { EngineLine } from "@shared/types/game/position/EngineLine";
import { getGameAnalysis } from "../report";

interface GoldenGame {
    id: string;
    pgn: string;
    nodes: {
        move?: string;
        classification?: string;
        accuracy?: number;
        accuracyWeight?: number;
        lines: EngineLine[];
    }[];
}

// Replays engine lines recorded by a real review (see the file's settings)
// through the reporter, so that any change to classifications or
// accuracies shows up here. Re-record the file when a change is intended.
const golden: { games: GoldenGame[] } = JSON.parse(readFileSync(
    new URL("./golden/reviews.json", import.meta.url),
    "utf8"
));

describe("golden reviews", () => {
    for (const game of golden.games) {
        it(`reproduces ${game.id}`, () => {
            const stateTree = parseStateTree(parsePgn(game.pgn));
            const nodes = getNodeChain(stateTree);

            assert.equal(nodes.length, game.nodes.length);

            nodes.forEach((node, index) => {
                assert.equal(node.state.move?.uci, game.nodes[index].move);
                node.state.engineLines = game.nodes[index].lines;
            });

            getGameAnalysis(stateTree);

            nodes.forEach((node, index) => {
                const expected = game.nodes[index];
                const where = `ply ${index} (${expected.move})`;

                assert.equal(node.state.classification, expected.classification, where);
                assert.equal(node.state.accuracy, expected.accuracy, where);
                assert.equal(node.state.accuracyWeight, expected.accuracyWeight, where);
            });
        });
    }
});
