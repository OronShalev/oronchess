import { describe, it } from "node:test";
import assert from "node:assert/strict";

import Evaluation from "@shared/types/game/position/Evaluation";
import { getAccuracyFromPointLoss, getPositionValue } from "../accuracy";
import { getExpectedPoints } from "../expectedPoints";
import { reporterConfig } from "../config";
import { analyseNode } from "../report";
import {
    blackToMoveFen,
    centipawns,
    createMovePair,
    mate,
    quietMoves,
    whiteToMoveFen
} from "./helpers";

const startingFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

type Colour = "white" | "black";

/**
 * @description Analyses a quiet move that is not the top move, for one
 * colour, with evaluations from that colour's point of view.
 */
function analyseQuietMove(colour: Colour, before: Evaluation, after: Evaluation) {
    const [ played, top ] = quietMoves[colour];
    const sign = colour == "white" ? 1 : -1;

    const node = createMovePair({
        fen: colour == "white" ? whiteToMoveFen : blackToMoveFen,
        playedSan: played,
        topSan: top,
        before: { type: before.type, value: before.value * sign },
        after: { type: after.type, value: after.value * sign }
    });

    analyseNode(node, { includeTheory: false });

    return node.state;
}

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
        assert.ok(getAccuracyFromPointLoss(0.03) > 90);
        assert.ok(getAccuracyFromPointLoss(0.08) < 25);
        assert.ok(getAccuracyFromPointLoss(0.15) < 5);
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

describe("accuracy in decided positions", () => {
    it("costs more for the same drop nearer equality", () => {
        const lossOf = (from: number, to: number) => (
            getPositionValue(getExpectedPoints(centipawns(from)))
            - getPositionValue(getExpectedPoints(centipawns(to)))
        );

        // Drops of each size, sliding from deep in a won position, through
        // equality and into a lost one, cost most when centred on equality
        for (const drop of [ 20, 100, 200, 500 ]) {
            for (let from = 2000; from > drop / 2; from -= 10) {
                assert.ok(
                    lossOf(from, from - drop) < lossOf(from - 10, from - 10 - drop),
                    `${from} -> ${from - drop}`
                );

                // The same drop on the losing side costs the same
                assert.ok(Math.abs(
                    lossOf(from, from - drop) - lossOf(drop - from, -from)
                ) < 1e-12);
            }
        }
    });

    for (const colour of [ "white", "black" ] as Colour[]) {
        it(`ranks two-pawn drops by how decided the game was for ${colour}`, () => {
            const accuracies = [
                [ 1000, 800 ], [ 600, 400 ], [ 300, 100 ], [ 100, -100 ]
            ].map(([ from, to ]) => analyseQuietMove(
                colour, centipawns(from), centipawns(to)
            ).accuracy!);

            for (let index = 1; index < accuracies.length; index++) {
                assert.ok(
                    accuracies[index] < accuracies[index - 1],
                    accuracies.join(", ")
                );
            }

            // Barely a loss once the game is won
            assert.ok(accuracies[0] > 99, String(accuracies[0]));
        });
    }

    it("counts moves in decided positions less, but never not at all", () => {
        const { weight } = reporterConfig.accuracy.decided;

        const equal = analyseQuietMove("white", centipawns(0), centipawns(0));
        const won = analyseQuietMove("white", centipawns(1000), centipawns(800));
        const lost = analyseQuietMove("black", centipawns(-800), centipawns(-1000));
        const mating = analyseQuietMove("white", mate(5), mate(6));

        assert.equal(equal.accuracyWeight, 1);
        assert.ok(won.accuracyWeight! < 0.5 && won.accuracyWeight! > weight);
        assert.ok(Math.abs(lost.accuracyWeight! - won.accuracyWeight!) < 1e-9);
        assert.equal(mating.accuracyWeight, weight);
    });

    it("charges throwing a won game away in full", () => {
        const thrown = analyseQuietMove("black", centipawns(800), centipawns(-300));

        assert.ok(thrown.accuracy! < 1, String(thrown.accuracy));
        assert.ok(thrown.accuracyWeight! > 0.95, String(thrown.accuracyWeight));
    });

    it("counts a move out of a lost game in full", () => {
        const saved = analyseQuietMove("white", centipawns(-900), centipawns(0));

        assert.equal(saved.accuracy, 100);
        assert.equal(saved.accuracyWeight, 1);
    });
});
