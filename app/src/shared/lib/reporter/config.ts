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

    // Accuracy of a move: 100 / (1 + (point loss / halfLoss) ^ steepness),
    // so 100 for no loss and 50 for a loss of halfLoss, falling faster
    // around it the steeper it is. Fitted to Chess.com's game accuracies
    // with scripts/review-bench/accuracy.mjs, at depths 16 and 20 alike:
    // a loss of 0.01 still scores 99.6 and one of 0.02 scores 94, which
    // also keeps engine noise out, while one of 0.06 scores 16
    accuracy: {
        halfLoss: 0.04,
        steepness: 4
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
