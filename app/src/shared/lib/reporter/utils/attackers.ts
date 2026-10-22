import { Chess, Square, PieceSymbol, KING } from "chess.js";
import { isEqual, xorWith } from "lodash-es";

import { BoardPiece } from "../types/BoardPiece";
import { RawMove, toRawMove } from "../types/RawMove";
import { adaptPieceColour, flipPieceColour } from "@shared/constants/PieceColour";
import { setFenTurn, getCaptureSquare } from "@shared/lib/utils/chess";

interface TransitiveAttacker {
    directFen: string;
    square: Square;
    type: PieceSymbol;
}

// Index of a square in the order that chess.js generates moves in
function getSquareOrder(square: Square) {
    return (8 - parseInt(square[1])) * 8 + square.charCodeAt(0) - 97;
}

function directAttackingMoves(
    board: Chess,
    piece: BoardPiece
): RawMove[] {
    // Set turn to attacker's side (opposite of piece)
    const attackerFen = setFenTurn(
        board.fen(),
        adaptPieceColour(flipPieceColour(piece.color))
    );

    const attackerBoard = new Chess(attackerFen);

    const attackerSquares = attackerBoard.attackers(piece.square);

    // Only pieces attacking the square, or able to capture onto the en
    // passant square, can capture there. Generating moves for just those
    // squares, in board order, gives the same moves as generating all
    const originSquares = new Set(attackerSquares);

    const enPassantSquare = attackerFen.split(" ")[3];

    if (enPassantSquare && enPassantSquare != "-") {
        attackerBoard.attackers(enPassantSquare as Square)
            .forEach(square => originSquares.add(square));
    }

    // Quiet moves onto an empty square do not come from attackers
    const candidateMoves = attackerBoard.get(piece.square)
        ? [...originSquares]
            .sort((a, b) => getSquareOrder(a) - getSquareOrder(b))
            .flatMap(square => attackerBoard.moves({ verbose: true, square }))
        : attackerBoard.moves({ verbose: true });

    const attackingMoves: RawMove[] = candidateMoves
        .filter(move => getCaptureSquare(move) == piece.square)
        .map(toRawMove);

    const kingAttackerSquare = attackerSquares
        .find(attackerSquare => (
            attackerBoard.get(attackerSquare)?.type == KING
        ));

    if (
        kingAttackerSquare
        && !attackingMoves.some(attack => attack.piece == KING)
    ) {
        attackingMoves.push({
            piece: KING,
            color: flipPieceColour(piece.color),
            from: kingAttackerSquare,
            to: piece.square
        });
    }

    return attackingMoves;
}

export function getAttackingMoves(
    board: Chess,
    piece: BoardPiece,
    transitive: boolean = true
): RawMove[] {
    const attackingMoves = directAttackingMoves(board, piece);
    
    if (!transitive) return attackingMoves;

    // Keep a record of each transitive attacker and the FEN on
    // which they are considered a direct attacker
    const frontier: TransitiveAttacker[] = attackingMoves.map(
        attackingMove => ({
            directFen: board.fen(),
            square: attackingMove.from,
            type: attackingMove.piece
        })
    );

    while (frontier.length > 0) {
        const transitiveAttacker = frontier.pop();
        if (!transitiveAttacker) break;

        const transitiveBoard = new Chess(transitiveAttacker.directFen);

        // A king cannot be at the front of a battery
        if (transitiveAttacker.type == KING) {
            continue;
        }

        // Remove the piece at the front of the battery
        const oldAttackingMoves = directAttackingMoves(transitiveBoard, piece);

        transitiveBoard.remove(transitiveAttacker.square);

        // Find revealed attackers as a XOR between old (removed piece excluded)
        // and new direct attackers list
        const revealedAttackingMoves = xorWith(
            oldAttackingMoves.filter(
                attackingMove => attackingMove.from != transitiveAttacker.square
            ),
            directAttackingMoves(transitiveBoard, piece),
            isEqual
        );

        // Record revealed attackers in final list
        attackingMoves.push(...revealedAttackingMoves);

        // Queue revealed attackers for further recursion
        frontier.push(
            ...revealedAttackingMoves.map(attackingMove => ({
                directFen: transitiveBoard.fen(),
                square: attackingMove.from,
                type: attackingMove.piece
            }))
        );
    }

    return attackingMoves;
}