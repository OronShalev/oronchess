import { CSSProperties } from "react";
import { Arrow } from "react-chessboard/dist/chessboard/types";
import { Move } from "chess.js";

import { StateTreeNode } from "@shared/types/game/position/StateTreeNode";
import PlayerProfile from "@shared/types/game/PlayerProfile";
import Evaluation from "@shared/types/game/position/Evaluation";
import { GameClocks } from "@shared/lib/stateTree/clocks";

interface BoardProps {
    className?: string;
    style?: CSSProperties;
    profileClassName?: string;
    profileStyle?: CSSProperties;
    whiteProfile?: PlayerProfile;
    blackProfile?: PlayerProfile;
    clocks?: GameClocks;
    node?: StateTreeNode;
    flipped?: boolean;
    evaluation?: Evaluation;
    arrows?: Arrow[];
    // Whether arrows can be drawn by right-click dragging
    arrowsAllowed?: boolean;
    theme?: {
        lightSquareColour?: string;
        darkSquareColour?: string;
        pieceSet?: string;
    };
    piecesDraggable?: boolean;
    enableClassifications?: boolean;

    onAddMove?: (move: Move) => boolean;
}

export default BoardProps;