import { clamp, sumBy } from "lodash-es";

import { getNodeChain, StateTreeNode } from "@shared/types/game/position/StateTreeNode";
import PieceColour, { adaptPieceColour } from "@shared/constants/PieceColour";
import {
    ExtractedCurrentNode,
    ExtractedPreviousNode
} from "./types/ExtractedNode";
import { getMoverExpectedPoints } from "./expectedPoints";
import { getOpeningName } from "./utils/opening";
import { reporterConfig } from "./config";

export interface SideAccuracy {
    // Mean accuracy of the analysed moves, each counted by its weight,
    // NaN if there are none
    accuracy: number;
    analysedMoves: number;
    totalMoves: number;
}

function getSideAccuracy(
    moveNodes: StateTreeNode[],
    colour: PieceColour
): SideAccuracy {
    const sideNodes = moveNodes.filter(
        node => node.state.moveColour == colour
    );

    const accuracyHolders = sideNodes.filter(
        node => node.state.accuracy != undefined
    );

    const getWeight = (node: StateTreeNode) => (
        node.state.accuracyWeight ?? 1
    );

    return {
        accuracy: sumBy(accuracyHolders,
            node => node.state.accuracy! * getWeight(node)
        ) / sumBy(accuracyHolders, getWeight),
        analysedMoves: accuracyHolders.length,
        totalMoves: sideNodes.length
    };
}

/**
 * @description Returns the accuracy of each side over the mainline, with
 * how many of their moves could be analysed. Moves without the engine
 * lines needed for an accuracy are left out rather than counted.
 */
export function getGameAccuracy(rootNode: StateTreeNode) {
    const moveNodes = getNodeChain(rootNode).filter(
        node => node.state.move
    );

    return {
        white: getSideAccuracy(moveNodes, PieceColour.WHITE),
        black: getSideAccuracy(moveNodes, PieceColour.BLACK)
    };
}

export function getAccuracyFromPointLoss(pointLoss: number) {
    if (pointLoss <= 0) return 100;

    const { halfLoss, steepness } = reporterConfig.accuracy;

    return clamp(
        100 / (1 + Math.pow(pointLoss / halfLoss, steepness)),
        0, 100
    );
}

/**
 * @description Places expected points p on a scale that flattens toward
 * won and lost positions, 3p^2 - 2p^3. Its slope, 6p(1 - p), is 1.5 at
 * equality and next to nothing once a game is decided, so the same drop
 * in evaluation costs less the more decided the game already was, while
 * a drop through equality pays for all of the scale it crosses.
 */
export function getPositionValue(expectedPoints: number) {
    return expectedPoints * expectedPoints * (3 - 2 * expectedPoints);
}

/**
 * @description Returns how much a move with the given expected points
 * around it counts toward its side's accuracy: in full while the game is
 * open, and less once both positions are decided (see the config).
 */
export function getAccuracyWeight(before: number, after: number) {
    const { evaluation, weight, sharpness } = reporterConfig.accuracy.decided;

    // The position nearer equality, so that a move out of an open game,
    // or into one, counts in full
    const open = Math.abs(before - 0.5) < Math.abs(after - 0.5)
        ? before
        : after;

    // Its evaluation in centipawns, infinite for a mate
    const centipawns = Math.abs(Math.log(open / (1 - open)))
        / reporterConfig.centipawnGradient;

    return weight + (1 - weight) / (
        1 + Math.pow(centipawns / evaluation, sharpness)
    );
}

export function getMoveAccuracy(
    previous: ExtractedPreviousNode,
    current: ExtractedCurrentNode
) {
    const { before, after } = getMoverExpectedPoints(
        previous.evaluation,
        current.evaluation,
        adaptPieceColour(current.playedMove.color)
    );

    const weight = getAccuracyWeight(before, after);

    // The previous evaluation is that of the top move itself, so a drop
    // after it is the engine revising its search, not a player's error.
    // Book moves lose nothing either, whether or not they are labelled
    // as theory
    if (
        previous.topMove.san == current.playedMove.san
        || getOpeningName(current.state.fen)
    ) {
        return { accuracy: 100, weight };
    }

    return {
        accuracy: getAccuracyFromPointLoss(
            getPositionValue(before) - getPositionValue(after)
        ),
        weight
    };
}
