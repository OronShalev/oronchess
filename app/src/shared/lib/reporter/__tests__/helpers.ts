import { Chess } from "chess.js";

import EngineVersion from "@shared/constants/EngineVersion";
import PieceColour from "@shared/constants/PieceColour";
import Evaluation from "@shared/types/game/position/Evaluation";
import { EngineLine } from "@shared/types/game/position/EngineLine";
import { StateTreeNode } from "@shared/types/game/position/StateTreeNode";

// A quiet rook endgame outside the opening book, the same for either
// colour, with no pieces in contact for brilliant heuristics to consider
export const whiteToMoveFen = "1r4k1/1p3ppp/8/8/8/8/1P3PPP/1R4K1 w - - 0 1";
export const blackToMoveFen = "1r4k1/1p3ppp/8/8/8/8/1P3PPP/1R4K1 b - - 0 1";

// Quiet moves for each colour, mirrored: [played, top]
export const quietMoves = {
    white: ["h3", "g3"],
    black: ["h6", "g6"]
};

export function centipawns(value: number): Evaluation {
    return { type: "centipawn", value };
}

export function mate(value: number): Evaluation {
    return { type: "mate", value };
}

export function createLine(
    evaluation: Evaluation,
    fen: string,
    firstMoveSan?: string,
    options?: Partial<EngineLine>
): EngineLine {
    const firstMove = firstMoveSan
        ? new Chess(fen).move(firstMoveSan)
        : undefined;

    return {
        evaluation,
        source: EngineVersion.STOCKFISH_19_LITE,
        depth: 16,
        index: 1,
        moves: firstMove ? [{ san: firstMove.san, uci: firstMove.lan }] : [],
        ...options
    };
}

/**
 * @description Returns a child node reached by a move from a parent with
 * the given top move and evaluations, both from White's point of view.
 */
export function createMovePair(options: {
    fen: string;
    playedSan: string;
    topSan: string;
    before: Evaluation;
    after: Evaluation;
    secondBefore?: { san: string; evaluation: Evaluation };
}) {
    const move = new Chess(options.fen).move(options.playedSan);

    const parentLines = [
        createLine(options.before, options.fen, options.topSan)
    ];

    if (options.secondBefore) {
        parentLines.push(createLine(
            options.secondBefore.evaluation,
            options.fen,
            options.secondBefore.san,
            { index: 2 }
        ));
    }

    const parent: StateTreeNode = {
        id: "parent",
        mainline: true,
        children: [],
        state: { fen: options.fen, engineLines: parentLines }
    };

    const child: StateTreeNode = {
        id: "child",
        mainline: true,
        parent,
        children: [],
        state: {
            fen: move.after,
            move: { san: move.san, uci: move.lan },
            moveColour: move.color == "w"
                ? PieceColour.WHITE
                : PieceColour.BLACK,
            engineLines: [createLine(options.after, move.after)]
        }
    };

    parent.children.push(child);

    return child;
}
