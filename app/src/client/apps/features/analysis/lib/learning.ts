import { Chess } from "chess.js";
import { uniqueId } from "lodash-es";

import { Classification, classifValues } from "@shared/constants/Classification";
import { parseUciMove } from "@shared/lib/utils/chess";
import PieceColour from "@shared/constants/PieceColour";
import {
    StateTreeNode,
    getNodeChain,
    getNodeMoveNumber
} from "@shared/types/game/position/StateTreeNode";
import { getTopEngineLine } from "@shared/types/game/position/EngineLine";

// Moves that a player can learn from, by trying again
export const learnableClassifications: Classification[] = [
    Classification.INACCURACY,
    Classification.MISTAKE,
    Classification.BLUNDER
];

export function isLearnableClassification(classification?: Classification) {
    return !!classification
        && learnableClassifications.includes(classification);
}

/**
 * @description Returns the mainline moves of a side that are classified
 * as inaccuracies, mistakes or blunders, from the first to the last.
 */
export function getMistakes(rootNode: StateTreeNode, colour: PieceColour) {
    return getNodeChain(rootNode).filter(node => (
        !!node.parent
        && node.state.moveColour == colour
        && isLearnableClassification(node.state.classification)
    ));
}

/**
 * @description Returns whether any mainline move has a classification,
 * as every move does once a game has been reviewed.
 */
export function isGameReviewed(rootNode: StateTreeNode) {
    return getNodeChain(rootNode).some(node => !!node.state.classification);
}

export enum LearningStep {
    // The mistake is on the board
    MISTAKE = "mistake",
    // The position before it, where another move can be tried
    RETRY = "retry",
    // Another move from that position
    ATTEMPT = "attempt",
    // Any other position
    AWAY = "away"
}

/**
 * @description Returns what the board shows of a mistake.
 */
export function getLearningStep(node: StateTreeNode, mistake: StateTreeNode) {
    if (node == mistake) return LearningStep.MISTAKE;
    if (node == mistake.parent) return LearningStep.RETRY;

    if (node.parent && node.parent == mistake.parent) {
        return LearningStep.ATTEMPT;
    }

    return LearningStep.AWAY;
}

export enum AttemptResult {
    // As good as the best move: best, critical or brilliant
    BEST = "best",
    // Excellent, though not the best
    GOOD = "good",
    // Okay, which is not a mistake but not good enough either
    OKAY = "okay",
    // Still an inaccuracy, mistake or blunder
    BAD = "bad"
}

/**
 * @description Returns how a classified move tried in place of a mistake
 * compares with the best move, or undefined while it is unclassified.
 */
export function getAttemptResult(attempt: StateTreeNode) {
    const classification = attempt.state.classification;
    if (!classification) return;

    const value = classifValues[classification];

    if (value >= classifValues[Classification.BEST]) {
        return AttemptResult.BEST;
    }

    if (value >= classifValues[Classification.EXCELLENT]) {
        return AttemptResult.GOOD;
    }

    if (value >= classifValues[Classification.OKAY]) {
        return AttemptResult.OKAY;
    }

    return AttemptResult.BAD;
}

/**
 * @description Returns whether a result solves a mistake: an excellent
 * move or better.
 */
export function isSolvingResult(result?: AttemptResult) {
    return result == AttemptResult.BEST || result == AttemptResult.GOOD;
}

/**
 * @description Returns the engine's best move in the position before a
 * mistake, from the lines of the review.
 */
export function getBestMove(mistake: StateTreeNode) {
    const parent = mistake.parent;
    if (!parent) return;

    const bestSan = getTopEngineLine(parent.state.engineLines)
        ?.moves.at(0)?.san;

    if (!bestSan) return;

    try {
        return new Chess(parent.state.fen).move(bestSan);
    } catch {
        return;
    }
}

// Moves for each side of the engine's line shown after a mistake
export const mistakeLineMoveCount = 5;

/**
 * @description Returns the engine's best line after a mistake, up to five
 * moves for each side, as positions that are not added to the game.
 */
export function getMistakeLine(
    mistake: StateTreeNode,
    plyCount = mistakeLineMoveCount * 2
) {
    const lineMoves = getTopEngineLine(mistake.state.engineLines)
        ?.moves.slice(0, plyCount) || [];

    const line: StateTreeNode[] = [];
    let previous = mistake;

    for (const lineMove of lineMoves) {
        try {
            var move = new Chess(previous.state.fen).move(
                parseUciMove(lineMove.uci)
            );
        } catch {
            break;
        }

        const node: StateTreeNode = {
            id: uniqueId("line"),
            mainline: false,
            parent: previous,
            children: [],
            state: {
                fen: move.after,
                move: { san: move.san, uci: move.lan },
                moveColour: move.color == "w"
                    ? PieceColour.WHITE
                    : PieceColour.BLACK,
                engineLines: []
            }
        };

        line.push(node);
        previous = node;
    }

    return line;
}

/**
 * @description Returns a move's number and SAN, like 12. Nf3 for a White
 * move or 12... Nf6 for a Black one.
 */
export function getMoveLabel(node: StateTreeNode, initialPosition?: string) {
    const moveNumber = Math.floor(getNodeMoveNumber(node, initialPosition));

    const separator = node.state.moveColour == PieceColour.BLACK
        ? "..." : ".";

    return `${moveNumber}${separator} ${node.state.move?.san || ""}`;
}
