import { Chess } from "chess.js";

import { StateTreeNode } from "@shared/types/game/position/StateTreeNode";
import { EngineLine, getTopEngineLine } from "@shared/types/game/position/EngineLine";
import { Classification } from "@shared/constants/Classification";
import AnalysisOptions from "../types/AnalysisOptions";
import { classify } from "../classify";

/**
 * @description Returns whether the classification of a node could depend
 * on the second engine line of its parent. The second line is only read
 * to upgrade a move to critical or brilliant, so the node is classified
 * against the second line most favourable to an upgrade (the mover being
 * mated). If neither upgrade happens, no real second line can cause one.
 * Requires the top engine line of the node and of its parent.
 */
export function mightUseSecondLine(
    node: StateTreeNode,
    options?: AnalysisOptions
) {
    const parent = node.parent;
    if (!parent) return false;

    const topLine = getTopEngineLine(parent.state.engineLines);
    const topMoveUci = topLine?.moves.at(0)?.uci;
    if (!topLine || !topMoveUci) return false;

    const alternativeMove = new Chess(parent.state.fen)
        .moves({ verbose: true })
        .find(move => move.lan != topMoveUci);

    if (!alternativeMove) return false;

    const worstSecondLine: EngineLine = {
        evaluation: {
            type: "mate",
            value: alternativeMove.color == "w" ? -1 : 1
        },
        source: topLine.source,
        depth: topLine.depth,
        index: 2,
        moves: [{
            san: alternativeMove.san,
            uci: alternativeMove.lan
        }]
    };

    const hypotheticalParent: StateTreeNode = {
        ...parent,
        state: {
            ...parent.state,
            engineLines: [topLine, worstSecondLine]
        }
    };

    try {
        const classification = classify(
            { ...node, parent: hypotheticalParent },
            options
        );

        return classification == Classification.BRILLIANT
            || classification == Classification.CRITICAL;
    } catch {
        return false;
    }
}
