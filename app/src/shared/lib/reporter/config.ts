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

    // Fitted to Chess.com's game accuracies with
    // scripts/review-bench/accuracy.mjs, at depths 16 and 20 alike
    accuracy: {
        // Accuracy of a move: 100 / (1 + (loss / halfLoss) ^ steepness),
        // so 100 for no loss and 50 for a loss of halfLoss, falling faster
        // around it the steeper it is. The loss is measured on a scale
        // that flattens toward won and lost positions (see accuracy.ts):
        // a loss of 0.02 still scores 98.5, which also keeps engine noise
        // out, one of 0.05 scores 63 and one of 0.12 scores 5
        halfLoss: 0.057,
        steepness: 4,

        // Moves count less toward a game's accuracy once the game is
        // decided: a move whose positions before and after are both
        // beyond decidedEvaluation (in centipawns, for either side)
        // counts about half, falling toward decidedWeight, which mates
        // count. A move that turns a decided game into an open one counts
        // in full, as the positions around it are judged by the more open
        decided: {
            evaluation: 600,
            weight: 0.25,
            sharpness: 6
        }
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
