import { createContext } from "react";
import { Square } from "react-chessboard/dist/chessboard/types";

import { SquaresController } from "./useSquares";

/**
 * @description A square to draw attention to for a moment, like that of
 * the piece that makes the best move. A new ID plays it again.
 */
export interface BoardHint {
    square: Square;
    id: number;
}

export type SquaresContextValue = SquaresController & { hint?: BoardHint };

export const SquaresContext = createContext<SquaresContextValue>({
    selected: undefined,
    setSelected: () => null,

    highlighted: [],
    setHighlighted: () => null,

    playable: [],
    setPlayable: () => null,

    capturable: [],
    setCapturable: () => null,

    pieceDropFlag: false,
    setPieceDropFlag: () => null,
    
    toggleHighlight: () => null,
    clearPlayable: () => null,
    loadPlayable: () => null
});