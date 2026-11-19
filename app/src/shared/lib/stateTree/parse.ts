import { Chess } from "chess.js";
import { ParseTree, parseGame } from "@mliebelt/pgn-parser";
import { uniqueId } from "lodash-es";

import Game from "@shared/types/game/Game";
import { StateTreeNode } from "@shared/types/game/position/StateTreeNode";
import PieceColour from "@shared/constants/PieceColour";
import {
    getPgnTimeControl,
    parseClockTime,
    parseTimeControl,
    setMoveTimes
} from "./clocks";

type ParsedPGNMove = ParseTree["moves"][number];

function parseStateTree(game: Game) {
    const parsedPGN = parseGame(game.pgn);

    function addMovesToNode(
        node: StateTreeNode,
        moves: ParsedPGNMove[],
        mainline: boolean
    ) {
        let lastNode = node;

        for (const pgnMove of moves) {
            const move = new Chess(lastNode.state.fen)
                .move(pgnMove.notation.notation);

            const newNode: StateTreeNode = {
                id: uniqueId(),
                mainline: mainline,
                parent: lastNode,
                children: [],
                state: {
                    fen: move.after,
                    engineLines: [],
                    move: {
                        san: move.san,
                        uci: move.lan
                    },
                    moveColour: move.color == "w"
                        ? PieceColour.WHITE
                        : PieceColour.BLACK,
                    clock: parseClockTime(pgnMove.commentDiag?.clk),
                    moveTime: parseClockTime(pgnMove.commentDiag?.emt)
                }
            };

            lastNode.children.push(newNode);

            for (const variation of pgnMove.variations) {
                addMovesToNode(lastNode, variation, false);
            }

            lastNode = newNode;
        }
    }

    const rootNode: StateTreeNode = {
        id: uniqueId(),
        mainline: true,
        children: [],
        state: {
            fen: game.initialPosition,
            engineLines: []
        }
    };

    addMovesToNode(rootNode, parsedPGN.moves, true);

    setMoveTimes(rootNode, parseTimeControl(getPgnTimeControl(game.pgn)));

    return rootNode;
}

export default parseStateTree;