import {
    ExtractedCurrentNode,
    ExtractedPreviousNode
} from "../types/ExtractedNode";
import { Classification } from "@shared/constants/Classification";
import { adaptPieceColour } from "@shared/constants/PieceColour";
import { getSubjectiveEvaluation } from "@shared/lib/utils/chess";
import { getExpectedPointsLoss } from "../expectedPoints";
import { reporterConfig, classifyByBands } from "../config";

/**
 * @description Classify using two evaluations and a move colour, using
 * expected point losses, or mate losses between mates for the same side.
 */
export function pointLossClassify(
    previous: ExtractedPreviousNode,
    current: ExtractedCurrentNode
) {
    const moveColour = adaptPieceColour(current.playedMove.color);

    const previousSubjectiveValue = getSubjectiveEvaluation(
        previous.evaluation, moveColour
    ).value;

    const subjectiveValue = current.subjectiveEvaluation.value;

    // Mate to mate evaluations for the same side
    if (
        previous.evaluation.type == "mate"
        && current.evaluation.type == "mate"
        && Math.sign(previousSubjectiveValue) == Math.sign(subjectiveValue)
    ) {
        // For the losing side, making a move that keeps the mate the same
        // is best. Only the winning side expects a mate loss of -1.
        const mateLoss = subjectiveValue - previousSubjectiveValue;

        if (mateLoss < 0 || (mateLoss == 0 && subjectiveValue < 0)) {
            return Classification.BEST;
        }

        return classifyByBands(reporterConfig.mateLossBands, mateLoss);
    }

    // Every other pair of evaluations, including a mate gained or lost,
    // is compared by expected points, as accuracy is
    const pointLoss = getExpectedPointsLoss(
        previous.evaluation,
        current.evaluation,
        moveColour
    );

    return classifyByBands(reporterConfig.pointLossBands, pointLoss);
}
