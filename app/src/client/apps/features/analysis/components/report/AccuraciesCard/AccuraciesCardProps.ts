import { GameAnalysis } from "@shared/types/game/GameAnalysis";
import { SideAccuracy } from "@shared/lib/reporter/accuracy";

interface AccuraciesCardProps {
    accuracies: {
        white: SideAccuracy;
        black: SideAccuracy;
    };
    estimatedRatings?: GameAnalysis["estimatedRatings"];
}

export default AccuraciesCardProps;