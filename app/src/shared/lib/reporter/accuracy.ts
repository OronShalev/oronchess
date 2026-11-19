import { clamp, meanBy } from "lodash-es";

import { getNodeChain, StateTreeNode } from "@shared/types/game/position/StateTreeNode";
import PieceColour, { adaptPieceColour } from "@shared/constants/PieceColour";
import {
    ExtractedCurrentNode,
    ExtractedPreviousNode
} from "./types/ExtractedNode";
import { getExpectedPointsLoss } from "./expectedPoints";
import { reporterConfig } from "./config";

export interface SideAccuracy {
    // Mean accuracy of the analysed moves, NaN if there are none
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

    return {
        accuracy: meanBy(accuracyHolders, node => node.state.accuracy!),
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

    const { scale, decay, offset } = reporterConfig.accuracy;

    return clamp(scale * Math.exp(-decay * pointLoss) + offset, 0, 100);
}

export function getMoveAccuracy(
    previous: ExtractedPreviousNode,
    current: ExtractedCurrentNode
) {
    // The previous evaluation is that of the top move itself, so a drop
    // after it is the engine revising its search, not a player's error
    if (previous.topMove.san == current.playedMove.san) return 100;

    return getAccuracyFromPointLoss(getExpectedPointsLoss(
        previous.evaluation,
        current.evaluation,
        adaptPieceColour(current.playedMove.color)
    ));
}
