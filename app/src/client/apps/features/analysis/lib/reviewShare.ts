import { Chess } from "chess.js";

import AnalysedGame from "@shared/types/game/AnalysedGame";
import EngineVersion from "@shared/constants/EngineVersion";
import { EngineLine, pickEngineLines } from "@shared/types/game/position/EngineLine";
import { StateTreeNode, getNodeChain } from "@shared/types/game/position/StateTreeNode";
import renderStateTree from "@shared/lib/stateTree/render";

// A reviewed game is shared as its PGN with one extra header holding the
// engine lines of its mainline, so that it can be classified again on
// another device without any engine search
const reviewTagName = "WintrReview";
const reviewVersion = "v1";

const reviewTagPattern = new RegExp(`^\\[${reviewTagName} "([^"]*)"\\]\\r?\\n?`, "m");

const engineSources = Object.values(EngineVersion);

// [evaluation type (0 centipawn, 1 mate), value, depth, source, first move]
type PackedLine = [number, number, number, number, string];

interface PackedReview {
    // Identifies the moves of the game that the review belongs to
    game: string;
    lines: PackedLine[][];
}

/**
 * @description Returns a short hash of the initial position and moves
 * of the mainline of a state tree (32-bit FNV-1a).
 */
function hashMainline(stateTree: StateTreeNode) {
    const moves = getNodeChain(stateTree)
        .map(node => node.state.move?.uci || node.state.fen)
        .join(" ");

    let hash = 0x811c9dc5;

    for (let i = 0; i < moves.length; i++) {
        hash ^= moves.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }

    return (hash >>> 0).toString(36);
}

async function transformBytes(
    bytes: Uint8Array,
    stream: CompressionStream | DecompressionStream
) {
    const output = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);

    return new Uint8Array(await new Response(output).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);

    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function fromBase64Url(text: string) {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));

    return Uint8Array.from(binary, character => character.charCodeAt(0));
}

/**
 * @description Returns whether the mainline of a state tree has engine
 * lines for every position, as it does after a game review.
 */
export function hasReview(stateTree: StateTreeNode) {
    return getNodeChain(stateTree).every(
        node => node.state.engineLines.length > 0
    );
}

/**
 * @description Packs the engine lines of the mainline of a state tree into
 * a compact string. Only what classification needs is kept: up to two
 * lines from one search per position, with their first move.
 */
export async function encodeReview(stateTree: StateTreeNode) {
    const nodes = getNodeChain(stateTree);

    const review: PackedReview = {
        game: hashMainline(stateTree),
        lines: nodes.map(node => (
            pickEngineLines(node.state.fen, node.state.engineLines) || []
        ).slice(0, 2).map(line => [
            line.evaluation.type == "mate" ? 1 : 0,
            line.evaluation.value,
            line.depth,
            engineSources.indexOf(line.source),
            line.moves.at(0)?.uci || ""
        ]))
    };

    const compressed = await transformBytes(
        new TextEncoder().encode(JSON.stringify(review)),
        new CompressionStream("deflate-raw")
    );

    return `${reviewVersion}.${toBase64Url(compressed)}`;
}

/**
 * @description Unpacks a review string onto the mainline of a state tree,
 * replacing its engine lines. Returns false, leaving the tree untouched,
 * if the review does not belong to the game.
 */
export async function decodeReview(review: string, stateTree: StateTreeNode) {
    const [ version, payload ] = review.split(".");
    if (version != reviewVersion || !payload) return false;

    try {
        const decompressed = await transformBytes(
            fromBase64Url(payload),
            new DecompressionStream("deflate-raw")
        );

        var packedReview: PackedReview = JSON.parse(
            new TextDecoder().decode(decompressed)
        );
    } catch {
        return false;
    }

    const nodes = getNodeChain(stateTree);

    if (
        packedReview.game != hashMainline(stateTree)
        || packedReview.lines?.length != nodes.length
    ) return false;

    const nodeLines: EngineLine[][] = [];

    for (const [ nodeIndex, node ] of nodes.entries()) {
        const packedLines = packedReview.lines[nodeIndex];
        if (!Array.isArray(packedLines) || packedLines.length == 0) return false;

        const lines: EngineLine[] = [];

        for (const [ lineIndex, packedLine ] of packedLines.entries()) {
            const [ type, value, depth, sourceIndex, uci ] = packedLine;

            const source = engineSources[sourceIndex];
            if (!source) return false;

            const moves: EngineLine["moves"] = [];

            if (uci) {
                try {
                    const move = new Chess(node.state.fen).move(uci);
                    moves.push({ san: move.san, uci: move.lan });
                } catch {
                    return false;
                }
            }

            lines.push({
                evaluation: {
                    type: type == 1 ? "mate" : "centipawn",
                    value: value
                },
                source: source,
                depth: depth,
                index: lineIndex + 1,
                moves: moves
            });
        }

        nodeLines.push(lines);
    }

    nodes.forEach((node, index) => {
        node.state.engineLines = nodeLines[index];
    });

    return true;
}

/**
 * @description Returns the review string held in a PGN, if any.
 */
export function getReviewTag(pgn: string) {
    return pgn.match(reviewTagPattern)?.[1];
}

/**
 * @description Removes the review header from a PGN.
 */
export function stripReviewTag(pgn: string) {
    return pgn.replace(reviewTagPattern, "");
}

/**
 * @description Renders a reviewed game as PGN with its review attached.
 */
export async function renderReviewedPgn(game: AnalysedGame) {
    const pgn = stripReviewTag(renderStateTree(game.stateTree, game));

    const reviewHeader = `[${reviewTagName} "${await encodeReview(game.stateTree)}"]`;

    // Headers end at the first blank line; a PGN may also have none
    const headerEnd = pgn.indexOf("\n\n");

    return headerEnd == -1
        ? `${reviewHeader}\n\n${pgn}`
        : `${pgn.slice(0, headerEnd)}\n${reviewHeader}${pgn.slice(headerEnd)}`;
}
