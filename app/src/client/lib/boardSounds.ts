import { Chess } from "chess.js";

import { StateTreeNode } from "@shared/types/game/position/StateTreeNode";
import { parseSanMove } from "@shared/lib/utils/chess";

import iconMove from "@assets/audio/move.mp3";
import iconCheck from "@assets/audio/check.mp3";
import iconCapture from "@assets/audio/capture.mp3";
import iconCastle from "@assets/audio/castle.mp3";
import iconPromote from "@assets/audio/promote.mp3";
import iconGameend from "@assets/audio/gameend.mp3";

export const moveSounds = {
    move: iconMove,
    check: iconCheck,
    capture: iconCapture,
    castle: iconCastle,
    promote: iconPromote,
    gameEnd: iconGameend
};

export type MoveSound = keyof typeof moveSounds;

/**
 * @description Returns the sounds of the move that led to a position:
 * one for the kind of move, and another if it ended the game.
 */
export function getMoveSounds(node: StateTreeNode) {
    const move = node.state.move;
    if (!move) return [];

    const sounds: MoveSound[] = [];

    if (new Chess(node.state.fen).isGameOver()) {
        sounds.push("gameEnd");
    }

    const parsedMove = parseSanMove(move.san);

    if (parsedMove.check || parsedMove.checkmate) {
        sounds.push("check");
    } else if (parsedMove.castling) {
        sounds.push("castle");
    } else if (parsedMove.promotion) {
        sounds.push("promote");
    } else if (parsedMove.capture) {
        sounds.push("capture");
    } else {
        sounds.push("move");
    }

    return sounds;
}

function playBoardSound(node: StateTreeNode) {
    for (const sound of getMoveSounds(node)) {
        new Audio(moveSounds[sound]).play();
    }
}

export default playBoardSound;
