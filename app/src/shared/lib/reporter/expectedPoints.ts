import Evaluation from "@shared/types/game/position/Evaluation";
import { PieceColour, flipPieceColour } from "@shared/constants/PieceColour";
import { reporterConfig } from "./config";

interface ExpectedPointsOptions {
    moveColour: PieceColour;
    centipawnGradient?: number;
}

export function getExpectedPoints(
    evaluation: Evaluation,
    options?: ExpectedPointsOptions
) {
    const opts = {
        centipawnGradient: reporterConfig.centipawnGradient,
        ...options
    };

    if (evaluation.type == "mate") {
        if (evaluation.value == 0) {
            return Number(opts.moveColour == PieceColour.WHITE);
        }

        return Number(evaluation.value > 0);
    } else {
        return 1 / (1 + Math.exp(
            -opts.centipawnGradient * evaluation.value
        ));
    }
}

/**
 * @description Returns the mover's expected points before and after their
 * move, from the evaluations of the positions around it, optionally with
 * a gradient of its own.
 */
export function getMoverExpectedPoints(
    previousEvaluation: Evaluation,
    currentEvaluation: Evaluation,
    moveColour: PieceColour,
    centipawnGradient = reporterConfig.centipawnGradient
) {
    const before = getExpectedPoints(previousEvaluation, {
        moveColour: flipPieceColour(moveColour),
        centipawnGradient
    });

    const after = getExpectedPoints(currentEvaluation, {
        moveColour,
        centipawnGradient
    });

    return moveColour == PieceColour.WHITE
        ? { before, after }
        : { before: 1 - before, after: 1 - after };
}

export function getExpectedPointsLoss(
    previousEvaluation: Evaluation,
    currentEvaluation: Evaluation,
    moveColour: PieceColour
) {
    return Math.max(0,
        (
            getExpectedPoints(previousEvaluation, {
                moveColour: flipPieceColour(moveColour)
            })
            - getExpectedPoints(currentEvaluation, { moveColour })
        )
        * (moveColour == PieceColour.WHITE ? 1 : -1)
    );
}