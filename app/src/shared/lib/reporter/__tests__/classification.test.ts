import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";

import { Classification } from "@shared/constants/Classification";
import Evaluation from "@shared/types/game/position/Evaluation";
import { StateTreeNode } from "@shared/types/game/position/StateTreeNode";
import { classifyByBands, reporterConfig } from "../config";
import { analyseNode } from "../report";
import { classify } from "../classify";
import { isMoveCriticalCandidate } from "../utils/criticalMove";
import {
    extractCurrentStateTreeNode,
    extractPreviousStateTreeNode
} from "../utils/extractNode";
import {
    blackToMoveFen,
    centipawns,
    createLine,
    createMovePair,
    mate,
    quietMoves,
    whiteToMoveFen
} from "./helpers";

type Colour = "white" | "black";

function flip(evaluation: Evaluation): Evaluation {
    return { type: evaluation.type, value: -evaluation.value };
}

/**
 * @description Analyses a quiet move that is not the top move, for one
 * colour. Evaluations are given from that colour's point of view.
 */
function analyseQuietMove(
    colour: Colour,
    before: Evaluation,
    after: Evaluation,
    options?: { topMovePlayed?: boolean; secondBefore?: Evaluation }
) {
    const [ played, top ] = quietMoves[colour];
    const toWhiteView = colour == "white" ? (e: Evaluation) => e : flip;

    const node = createMovePair({
        fen: colour == "white" ? whiteToMoveFen : blackToMoveFen,
        playedSan: played,
        topSan: options?.topMovePlayed ? played : top,
        before: toWhiteView(before),
        after: toWhiteView(after),
        secondBefore: options?.secondBefore && {
            san: top,
            evaluation: toWhiteView(options.secondBefore)
        }
    });

    analyseNode(node, { includeTheory: false });

    return node;
}

// Each case is checked for both colours with mirrored evaluations
function itForBothColours(
    name: string,
    before: Evaluation,
    after: Evaluation,
    expected: Classification
) {
    for (const colour of ["white", "black"] as Colour[]) {
        it(`${name} (${colour})`, () => {
            const node = analyseQuietMove(colour, before, after);

            assert.equal(node.state.classification, expected);
        });
    }
}

describe("classification bands", () => {
    const edges: [number, Classification, Classification][] = [
        [0.01, Classification.BEST, Classification.EXCELLENT],
        [0.045, Classification.EXCELLENT, Classification.OKAY],
        [0.08, Classification.OKAY, Classification.INACCURACY],
        [0.12, Classification.INACCURACY, Classification.MISTAKE],
        [0.22, Classification.MISTAKE, Classification.BLUNDER]
    ];

    for (const [ edge, below, from ] of edges) {
        it(`puts ${edge} and above in ${from}`, () => {
            const bands = reporterConfig.pointLossBands;

            assert.equal(classifyByBands(bands, edge - 0.0001), below);
            assert.equal(classifyByBands(bands, edge), from);
            assert.equal(classifyByBands(bands, edge + 0.0001), from);
        });
    }

    itForBothColours("a 10cp drop is best", centipawns(0), centipawns(-10), Classification.BEST);
    itForBothColours("a 12cp drop is excellent", centipawns(0), centipawns(-12), Classification.EXCELLENT);
    itForBothColours("an improvement is best", centipawns(0), centipawns(50), Classification.BEST);
    itForBothColours("a winning position drawn is a blunder", centipawns(900), centipawns(0), Classification.BLUNDER);
});

describe("mate classifications", () => {
    itForBothColours("best defence against a mate the engine then loses sight of is best", mate(-10), centipawns(-1500), Classification.BEST);
    itForBothColours("allowing a mate from an advantage is a blunder", centipawns(300), mate(-8), Classification.BLUNDER);
    itForBothColours("allowing a mate when already lost costs no points", centipawns(-2000), mate(-2), Classification.BEST);
    itForBothColours("turning a forced mate into being mated is a blunder", mate(3), mate(-5), Classification.BLUNDER);
    itForBothColours("losing a forced mate for a small advantage is a blunder", mate(3), centipawns(350), Classification.BLUNDER);
    itForBothColours("losing a forced mate for a huge advantage is best", mate(3), centipawns(1500), Classification.BEST);
    itForBothColours("shortening a mate is best", mate(3), mate(2), Classification.BEST);
    itForBothColours("keeping a mate as long is excellent", mate(3), mate(3), Classification.EXCELLENT);
    itForBothColours("delaying a mate by 6 is okay", mate(3), mate(9), Classification.OKAY);
    itForBothColours("delaying a mate by 7 is an inaccuracy", mate(3), mate(10), Classification.INACCURACY);
    itForBothColours("holding out against a mate is best", mate(-5), mate(-5), Classification.BEST);
    itForBothColours("hastening a mate against you by 1 is excellent", mate(-5), mate(-4), Classification.EXCELLENT);
    itForBothColours("hastening a mate against you by 2 is okay", mate(-5), mate(-3), Classification.OKAY);

    it("accuracy agrees with the label when a mate is allowed", () => {
        const node = analyseQuietMove("white", centipawns(300), mate(-8));

        assert.ok(node.state.accuracy! < 5);
    });

    it("gives best and 100 for delivering checkmate", () => {
        const fen = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1";

        const node = createMovePair({
            fen,
            playedSan: "Ra8#",
            topSan: "Ra8#",
            before: mate(1),
            after: mate(0)
        });

        analyseNode(node);

        assert.equal(node.state.classification, Classification.BEST);
        assert.equal(node.state.accuracy, 100);
    });
});

describe("colour symmetry", () => {
    it("gives mirrored evaluations the same label and accuracy", () => {
        // Deterministic pseudo-random evaluations
        let seed = 12345;

        function random() {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed / 2147483648;
        }

        for (let i = 0; i < 300; i++) {
            const before = centipawns(Math.round(random() * 3000 - 1500));
            const after = centipawns(Math.round(random() * 3000 - 1500));

            const white = analyseQuietMove("white", before, after);
            const black = analyseQuietMove("black", before, after);

            assert.equal(white.state.classification, black.state.classification);

            // Expected points of mirrored evaluations differ by rounding
            assert.ok(
                Math.abs(white.state.accuracy! - black.state.accuracy!) < 1e-9,
                `${before.value} -> ${after.value}`
            );
        }
    });
});

describe("special classifications", () => {
    it("classifies the only legal move as forced", () => {
        const node = createMovePair({
            fen: "7k/8/8/8/8/8/6q1/7K w - - 0 1",
            playedSan: "Kxg2",
            topSan: "Kxg2",
            before: centipawns(0),
            after: centipawns(0)
        });

        analyseNode(node);

        assert.equal(node.state.classification, Classification.FORCED);
    });

    it("classifies opening book moves as theory unless excluded", () => {
        const fen = new Chess().fen();

        const node = createMovePair({
            fen,
            playedSan: "e4",
            topSan: "d4",
            before: centipawns(20),
            after: centipawns(-100)
        });

        analyseNode(node);
        assert.equal(node.state.classification, Classification.THEORY);

        analyseNode(node, { includeTheory: false });
        assert.notEqual(node.state.classification, Classification.THEORY);
    });

    it("classifies the top move as critical only when the second is 0.1 worse", () => {
        const critical = analyseQuietMove(
            "white", centipawns(0), centipawns(0),
            { topMovePlayed: true, secondBefore: centipawns(-117) }
        );

        const best = analyseQuietMove(
            "white", centipawns(0), centipawns(0),
            { topMovePlayed: true, secondBefore: centipawns(-114) }
        );

        assert.equal(critical.state.classification, Classification.CRITICAL);
        assert.equal(best.state.classification, Classification.BEST);
    });

    it("does not consider a move critical when the second line also mates", () => {
        function candidate(secondBefore: Evaluation) {
            const node = analyseQuietMove(
                "white", centipawns(300), centipawns(300),
                { topMovePlayed: true, secondBefore }
            );

            return isMoveCriticalCandidate(
                extractPreviousStateTreeNode(node.parent!)!,
                extractCurrentStateTreeNode(node)!
            );
        }

        assert.equal(candidate(centipawns(200)), true);
        assert.equal(candidate(centipawns(700)), false);
        assert.equal(candidate(mate(4)), false);
        assert.equal(candidate(mate(-4)), true);
    });

    it("leaves a move unclassified, with no accuracy, without lines", () => {
        const node = analyseQuietMove("white", centipawns(0), centipawns(-200));

        assert.ok(node.state.accuracy != undefined);

        node.parent!.state.engineLines = [];
        analyseNode(node);

        assert.equal(node.state.classification, undefined);
        assert.equal(node.state.accuracy, undefined);
    });

    it("compares moves against a top line, never a deeper second line", () => {
        const node = analyseQuietMove("white", centipawns(0), centipawns(0));
        const parent = node.parent as StateTreeNode;

        // A deeper search's second line, without its first, sorts ahead
        parent.state.engineLines.unshift(createLine(
            centipawns(-500),
            parent.state.fen,
            quietMoves.white[0],
            { depth: 18, index: 2 }
        ));

        assert.equal(classify(node, { includeTheory: false }), Classification.BEST);
    });
});
