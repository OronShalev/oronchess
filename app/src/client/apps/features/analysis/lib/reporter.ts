import AnalysisOptions from "@shared/lib/reporter/types/AnalysisOptions";
import { GameAnalysis } from "@shared/types/game/GameAnalysis";
import { StateTreeNode } from "@shared/types/game/position/StateTreeNode";
import {
    getGameAnalysis,
    analyseNode as analyseSingleNode
} from "@shared/lib/reporter/report";

/**
 * @description Classifies every move of a game in place.
 */
export function analyseStateTree(
    rootNode: StateTreeNode,
    options?: AnalysisOptions
): GameAnalysis {
    return getGameAnalysis(rootNode, options);
}

/**
 * @description Classifies a single move in place. Returns whether
 * a classification could be found.
 */
export function analyseNode(
    node: StateTreeNode,
    options?: AnalysisOptions
) {
    if (!node.parent) return false;

    analyseSingleNode(node, options);

    return !!node.state.classification;
}
