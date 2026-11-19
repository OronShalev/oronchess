import { StateTreeNode } from "@shared/types/game/position/StateTreeNode";

interface MoveTimesGraphProps {
    nodes: StateTreeNode[];
    timeControl?: string;
    initialPosition?: string;
    selectedIndex: number;
    // Whether the graph is shown, or only its title
    open: boolean;
    onToggle: () => void;
    onMoveClick?: (node: StateTreeNode) => void;
}

export default MoveTimesGraphProps;
