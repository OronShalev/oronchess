import { StateTreeNode } from "@shared/types/game/position/StateTreeNode";

interface MoveTimesGraphProps {
    nodes: StateTreeNode[];
    timeControl?: string;
    initialPosition?: string;
    selectedIndex: number;
    onMoveClick?: (node: StateTreeNode) => void;
}

export default MoveTimesGraphProps;
