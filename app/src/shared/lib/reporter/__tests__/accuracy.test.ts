import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getAccuracyFromPointLoss } from "../accuracy";
import { reporterConfig } from "../config";

const startingFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
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

    it("is next to nothing, not negative, for losing a forced mate", () => {
        const accuracy = getAccuracyFromPointLoss(1);

        assert.ok(accuracy >= 0 && accuracy < 0.01, String(accuracy));
    });

    it("is 50 for a loss of the configured half loss", () => {
        const { halfLoss } = reporterConfig.accuracy;

        assert.ok(Math.abs(getAccuracyFromPointLoss(halfLoss) - 50) < 1e-9);
    });

    // The shape fitted to Chess.com's game accuracies: small losses, which
    // are also within engine noise, cost little, and mistakes cost nearly
    // all of a move's accuracy
    it("barely counts small losses and leaves little for mistakes", () => {
        assert.ok(getAccuracyFromPointLoss(0.01) > 99);
        assert.ok(getAccuracyFromPointLoss(0.02) > 90);
        assert.ok(getAccuracyFromPointLoss(0.06) < 20);
        assert.ok(getAccuracyFromPointLoss(0.12) < 2);
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

    it("is 100 for a book move, labelled as theory or not", () => {
        for (const includeTheory of [ true, false ]) {
            // 1. e4 is in the book, though not the top move here
            const node = createMovePair({
                fen: startingFen,
                playedSan: "e4",
                topSan: "d4",
                before: centipawns(50),
                after: centipawns(-300)
            });

            analyseNode(node, { includeTheory });

            assert.ok(node.state.opening, "1. e4 should be a book move");
            assert.equal(node.state.accuracy, 100, `includeTheory: ${includeTheory}`);
        }
    });

    it("is below 100 for the same loss outside the book", () => {
        const [ played, top ] = quietMoves.white;

        const node = createMovePair({
            fen: whiteToMoveFen,
            playedSan: played,
            topSan: top,
            before: centipawns(50),
            after: centipawns(-300)
        });

        analyseNode(node, { includeTheory: false });

        assert.equal(node.state.opening, undefined);
        assert.ok(node.state.accuracy! < 100);
    });
});
