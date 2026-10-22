import { GameAnalysis } from "@shared/types/game/GameAnalysis";
import { StateTreeNode, getNodeChain } from "@shared/types/game/position/StateTreeNode";
import AnalysisOptions from "./types/AnalysisOptions";
import { adaptPieceColour } from "@shared/constants/PieceColour";
import {
    extractCurrentStateTreeNode,
    extractPreviousStateTreeNode
} from "./utils/extractNode";
import { getOpeningName } from "./utils/opening";
import { getMoveAccuracy } from "./accuracy";
import { classifyExtracted } from "./classify";

/**
 * @description Sets the classification, opening and accuracy of a node
 * from its engine lines and those of its parent.
 */
export function analyseNode(
    node: StateTreeNode,
    options?: AnalysisOptions
) {
    node.state.opening = getOpeningName(node.state.fen);

    const previous = node.parent
        && extractPreviousStateTreeNode(node.parent);
    const current = extractCurrentStateTreeNode(node);

    if (!previous || !current) {
        node.state.classification = undefined;
        return;
    }

    try {
        node.state.classification = classifyExtracted(
            previous, current, options
        );
    } catch {
        node.state.classification = undefined;
    }

    node.state.accuracy = getMoveAccuracy(
        previous.evaluation,
        current.evaluation,
        adaptPieceColour(current.playedMove.color)
    );
}

export function getGameAnalysis(
    rootNode: StateTreeNode,
    options?: AnalysisOptions
): GameAnalysis {
    for (const node of getNodeChain(rootNode)) {
        analyseNode(node, options);
    }

    return {
        estimatedRatings: {
            white: 2000,
            black: 1000
        },
        stateTree: rootNode
    };
}
