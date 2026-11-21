import { Classification } from "@shared/constants/Classification";

interface ClassificationBand {
    // Exclusive upper limit of the loss for this classification
    below: number;
    classification: Classification;
}

/**
 * @description Constants of the expected points model behind move
 * classifications and accuracies. Changing any of them changes the
 * results of every review.
 */
export const reporterConfig = {
    // Expected points of a centipawn evaluation: 1 / (1 + e^(-k * cp))
    centipawnGradient: 0.0035,

    // Fitted to Chess.com's game accuracies for 100 games of club players
    // around 1750 with scripts/review-bench/accuracy.mjs, by 10-fold
    // cross-validation, at depths 16 and 20 alike
    accuracy: {
        // Expected points of the accuracies have a gradient of their own,
        // flatter than that of classifications, as Chess.com's depend on
        // the players' rating. The same drop in evaluation costs less the
        // further it is from equality: two pawns from +10 to +8 cost half
        // of a move's accuracy, from +1 to -1 three quarters
        centipawnGradient: 0.00215,

        // Accuracy of a move: 100 / (1 + (loss / halfLoss) ^ steepness),
        // so 100 for no loss and 50 for a loss of halfLoss: a loss of 0.01
        // scores 91, one of 0.05 scores 48 and one of 0.2 scores 11
        halfLoss: 0.048,
        steepness: 1.5,

        // A side's accuracy is the power mean of its moves' accuracies
        // with this exponent, between the geometric mean (0) and the
        // ordinary mean (1). Every move counts equally, but bad moves
        // weigh more than in an ordinary mean
        meanExponent: 0.25
    },

    pointLossBands: [
        { below: 0.01, classification: Classification.BEST },
        { below: 0.045, classification: Classification.EXCELLENT },
        { below: 0.08, classification: Classification.OKAY },
        { below: 0.12, classification: Classification.INACCURACY },
        { below: 0.22, classification: Classification.MISTAKE },
        { below: Infinity, classification: Classification.BLUNDER }
    ] as ClassificationBand[],

    // By how many moves a mate was made longer for the winning side, or
    // shorter for the losing side, when a move kept a mate for the same side
    mateLossBands: [
        { below: 2, classification: Classification.EXCELLENT },
        { below: 7, classification: Classification.OKAY },
        { below: Infinity, classification: Classification.INACCURACY }
    ] as ClassificationBand[]
};

/**
 * @description Returns the classification of the first band that a loss
 * falls below.
 */
export function classifyByBands(bands: ClassificationBand[], loss: number) {
    return bands.find(band => loss < band.below)!.classification;
}
