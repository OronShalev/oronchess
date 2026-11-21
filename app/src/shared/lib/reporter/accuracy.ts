import { clamp, meanBy } from "lodash-es";

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
    // Power mean of the analysed moves' accuracies, NaN if there are none
    accuracy: number;
    analysedMoves: number;
    totalMoves: number;
}

/**
 * @description Returns the power mean of accuracies with the configured
 * exponent, taken over fractions of 100 so that all 100s give exactly
 * 100. NaN for no accuracies.
 */
export function getMeanAccuracy(accuracies: number[]) {
    const { meanExponent } = reporterConfig.accuracy;

    return 100 * Math.pow(
        meanBy(accuracies, accuracy => Math.pow(accuracy / 100, meanExponent)),
        1 / meanExponent
    );
}

function getSideAccuracy(
    moveNodes: StateTreeNode[],
    colour: PieceColour
): SideAccuracy {
    const sideNodes = moveNodes.filter(
        node => node.state.moveColour == colour
    );

    const accuracies = sideNodes
        .map(node => node.state.accuracy)
        .filter(accuracy => accuracy != undefined);

    return {
        accuracy: getMeanAccuracy(accuracies),
        analysedMoves: accuracies.length,
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
 * @description Returns the expected points that a move lost for its
 * mover, with the gradient of accuracies.
 */
export function getAccuracyPointLoss(
    previous: ExtractedPreviousNode,
    current: ExtractedCurrentNode
) {
    const { before, after } = getMoverExpectedPoints(
        previous.evaluation,
        current.evaluation,
        adaptPieceColour(current.playedMove.color),
        reporterConfig.accuracy.centipawnGradient
    );

    return Math.max(0, before - after);
}

export function getMoveAccuracy(
    previous: ExtractedPreviousNode,
    current: ExtractedCurrentNode
) {
    // The previous evaluation is that of the top move itself, so a drop
    // after it is the engine revising its search, not a player's error
    if (previous.topMove.san == current.playedMove.san) return 100;

    // Book moves lose nothing, whether or not they are labelled as theory
    if (getOpeningName(current.state.fen)) return 100;

    return getAccuracyFromPointLoss(getAccuracyPointLoss(previous, current));
}
