import AnalysedGame from "@shared/types/game/AnalysedGame";
import { StateTreeNode } from "@shared/types/game/position/StateTreeNode";

interface ExportVideoDialogProps {
    game: AnalysedGame;
    // The position shown in the preview, when it has a classification
    currentNode: StateTreeNode;
    flipped: boolean;
    onClose: () => void;
}

export default ExportVideoDialogProps;
