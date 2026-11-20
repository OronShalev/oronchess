// Rebuilds state trees from the engine lines that bench.mjs records, so
// that they can be classified again without an engine.
import { Chess } from "chess.js";

/**
 * @description Builds a mainline state tree holding the recorded engine
 * lines of a game, keeping at most `lineCount` lines per position.
 */
export function buildStateTree(game, lineCount = 2) {
    let parent;
    let root;

    for (const recordedNode of game.nodes) {
        let move;

        if (parent && recordedNode.move) {
            const playedMove = new Chess(parent.state.fen).move(recordedNode.move);
            move = { san: playedMove.san, uci: playedMove.lan };
        }

        const node = {
            id: String(Math.random()),
            mainline: true,
            parent: parent,
            children: [],
            state: {
                fen: recordedNode.fen,
                move: move,
                moveColour: move
                    ? (parent.state.fen.split(" ")[1] == "w" ? "white" : "black")
                    : undefined,
                engineLines: structuredClone(recordedNode.lines)
                    .slice(0, lineCount)
            }
        };

        // Recorded lines only hold the first move, which is all that
        // the classifier reads; give it the SAN as well
        for (const line of node.state.engineLines) {
            line.moves = line.moves.map(lineMove => {
                const parsed = new Chess(node.state.fen).move(lineMove.uci);
                return { san: parsed.san, uci: parsed.lan };
            });
        }

        if (parent) parent.children.push(node);

        root ||= node;
        parent = node;
    }

    return root;
}
