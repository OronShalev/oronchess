import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getAccuracyFromPointLoss } from "../accuracy";
import { analyseNode } from "../report";
import {
    centipawns,
    createMovePair,
    mate,
    quietMoves,
    whiteToMoveFen
} from "./helpers";

describe("per-move accuracy", () => {
    it("is 100 for no point loss", () => {
        assert.equal(getAccuracyFromPointLoss(0), 100);
    });

    it("stays within 0 and 100 and never rises with more loss", () => {
        let previous = Infinity;

        for (let loss = 0; loss <= 1; loss += 0.0005) {
            const accuracy = getAccuracyFromPointLoss(loss);

            assert.ok(accuracy >= 0 && accuracy <= 100, `${loss}: ${accuracy}`);
            assert.ok(accuracy <= previous, `${loss}: ${accuracy} > ${previous}`);

            previous = accuracy;
        }
    });

    it("is 0, not negative, for losing a forced mate", () => {
        assert.equal(getAccuracyFromPointLoss(1), 0);
    });

    it("is finite for extreme and mate evaluations", () => {
        const [ played, top ] = quietMoves.white;

        const evaluations = [
            centipawns(1e6), centipawns(-1e6), centipawns(0),
            mate(1), mate(-1), mate(100), mate(-100)
        ];

        for (const before of evaluations) {
            for (const after of evaluations) {
                const node = createMovePair({
                    fen: whiteToMoveFen,
                    playedSan: played,
                    topSan: top,
                    before,
                    after
                });

                analyseNode(node, { includeTheory: false });

                const accuracy = node.state.accuracy!;

                assert.ok(
                    Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 100,
                    `${JSON.stringify(before)} -> ${JSON.stringify(after)}: ${accuracy}`
                );
            }
        }
    });

    it("is 100 for the top move, whatever the evaluation after it", () => {
        const [ played ] = quietMoves.white;

        const node = createMovePair({
            fen: whiteToMoveFen,
            playedSan: played,
            topSan: played,
            before: centipawns(300),
            after: centipawns(0)
        });

        analyseNode(node, { includeTheory: false });

        assert.equal(node.state.accuracy, 100);
    });
});
