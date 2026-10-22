import { Chess } from "chess.js";

import AnalysedGame from "@shared/types/game/AnalysedGame";
import EngineVersion from "@shared/constants/EngineVersion";
import GameResult from "@shared/constants/game/GameResult";
import Variant from "@shared/constants/game/Variant";
import { STARTING_FEN } from "@shared/constants/utils";
import { EngineLine, pickEngineLines } from "@shared/types/game/position/EngineLine";
import { StateTreeNode, getNodeChain } from "@shared/types/game/position/StateTreeNode";
import parseStateTree from "@shared/lib/stateTree/parse";
import parsePgn from "@client/lib/games/pgn";

// A reviewed game is shared as one compact code holding its moves and the
// engine lines of its mainline, which is all that classification needs,
// so that it can be opened on another device without any engine search.
//
// Layout, bit-packed: version, checksum, game details, base depth and
// source, ply count, moves, then up to two lines for every position.
const codePrefix = "wintrchess-";
const codePattern = /wintrchess-([A-Za-z0-9_-]+)/;

const codeVersion = 1;
const versionBits = 4;
const checksumBits = 24;

const engineSources = Object.values(EngineVersion);
const sourceBits = 2;

// Exp-Golomb orders: small counts, evaluation changes, ratings
const countOrder = 0;
const evaluationOrder = 5;
const ratingOrder = 8;

const results = ["*", "1-0", "0-1", "1/2-1/2"];

class BitWriter {
    private bits: number[] = [];

    write(value: number, width: number) {
        for (let bit = width - 1; bit >= 0; bit--) {
            this.bits.push(Math.floor(value / 2 ** bit) % 2);
        }
    }

    writeFlag(flag: boolean) {
        this.bits.push(flag ? 1 : 0);
    }

    // Exp-Golomb code of order k for a non-negative integer
    writeUnsigned(value: number, order = countOrder) {
        const shifted = value + 2 ** order;
        const width = Math.floor(Math.log2(shifted)) + 1;

        this.write(0, width - order - 1);
        this.write(shifted, width);
    }

    writeSigned(value: number, order = countOrder) {
        this.writeUnsigned(value < 0 ? -2 * value - 1 : 2 * value, order);
    }

    writeString(text: string) {
        const bytes = new TextEncoder().encode(text);

        this.writeUnsigned(bytes.length);
        bytes.forEach(byte => this.write(byte, 8));
    }

    toBytes() {
        const bytes = new Uint8Array(Math.ceil(this.bits.length / 8));

        this.bits.forEach((bit, index) => {
            bytes[index >> 3] |= bit << (7 - (index & 7));
        });

        return bytes;
    }
}

class BitReader {
    private bytes: Uint8Array;
    private position = 0;

    constructor(bytes: Uint8Array) {
        this.bytes = bytes;
    }

    read(width: number) {
        let value = 0;

        for (let i = 0; i < width; i++) {
            const byteIndex = this.position >> 3;
            if (byteIndex >= this.bytes.length) throw new Error("end of code");

            const bit = (this.bytes[byteIndex] >> (7 - (this.position & 7))) & 1;
            value = value * 2 + bit;

            this.position++;
        }

        return value;
    }

    readFlag() {
        return this.read(1) == 1;
    }

    readUnsigned(order = countOrder) {
        let zeroes = 0;

        while (this.read(1) == 0) {
            if (++zeroes > 40) throw new Error("invalid number");
        }

        const width = zeroes + order;

        return 2 ** width + this.read(width) - 2 ** order;
    }

    readSigned(order = countOrder) {
        const value = this.readUnsigned(order);

        return value % 2 ? -(value + 1) / 2 : value / 2;
    }

    readString() {
        const length = this.readUnsigned();
        const bytes = new Uint8Array(length);

        for (let i = 0; i < length; i++) bytes[i] = this.read(8);

        return new TextDecoder().decode(bytes);
    }
}

function getIndexWidth(count: number) {
    return count > 1 ? Math.ceil(Math.log2(count)) : 0;
}

// Legal moves in UCI order, which does not depend on move generation
function getSortedMoves(fen: string) {
    return new Chess(fen).moves({ verbose: true })
        .map(move => move.lan)
        .sort();
}

// 24-bit FNV-1a
function checksum(bytes: Uint8Array) {
    let hash = 0x811c9dc5;

    for (const byte of bytes) {
        hash ^= byte;
        hash = Math.imul(hash, 0x01000193);
    }

    return (hash >>> 0) % 2 ** checksumBits;
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

function getMostCommon<T>(values: T[], fallback: T) {
    const counts = new Map<T, number>();
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);

    let mostCommon = fallback;
    let highestCount = 0;

    for (const [ value, count ] of counts) {
        if (count <= highestCount) continue;

        mostCommon = value;
        highestCount = count;
    }

    return mostCommon;
}

function getResultIndex(game: AnalysedGame) {
    const whiteResult = game.players.white.result;

    if (whiteResult == GameResult.WIN) return 1;
    if (whiteResult == GameResult.LOSE) return 2;
    if (whiteResult == GameResult.DRAW) return 3;

    return 0;
}

// What most lines share, so that lines only spell out what differs
interface LineFormat {
    baseDepth: number;
    baseSource: EngineVersion;
    uniformDepth: boolean;
    uniformSource: boolean;
    movesAlwaysPresent: boolean;
}

// The line an engine gives a position with no legal moves
function getTerminalLine(fen: string, source: EngineVersion): EngineLine {
    return {
        evaluation: new Chess(fen).isCheckmate()
            ? { type: "mate", value: 0 }
            : { type: "centipawn", value: 0 },
        source: source,
        depth: 0,
        index: 1,
        moves: []
    };
}

function isTerminalLine(
    lines: EngineLine[],
    fen: string,
    source: EngineVersion
) {
    if (lines.length != 1) return false;

    const line = lines[0];
    const terminalLine = getTerminalLine(fen, source);

    return line.depth == 0
        && line.source == source
        && line.moves.length == 0
        && line.evaluation.type == terminalLine.evaluation.type
        && line.evaluation.value == terminalLine.evaluation.value;
}

interface LinePosition {
    moves: string[];
    playedNext?: string;
}

function writeLine(
    writer: BitWriter,
    line: EngineLine,
    previousValues: Record<string, number>,
    format: LineFormat,
    position: LinePosition
) {
    const type = line.evaluation.type;

    writer.writeFlag(type == "mate");
    writer.writeSigned(
        line.evaluation.value - previousValues[type], evaluationOrder
    );

    previousValues[type] = line.evaluation.value;

    if (!format.uniformDepth) {
        writer.writeFlag(line.depth == format.baseDepth);
        if (line.depth != format.baseDepth) writer.writeUnsigned(line.depth);
    }

    if (!format.uniformSource) {
        writer.writeFlag(line.source == format.baseSource);

        if (line.source != format.baseSource) {
            writer.write(engineSources.indexOf(line.source), sourceBits);
        }
    }

    if (position.moves.length == 0) return;

    const firstMove = line.moves.at(0)?.uci;

    if (!format.movesAlwaysPresent) {
        writer.writeFlag(!!firstMove);
        if (!firstMove) return;
    }

    writer.writeFlag(firstMove == position.playedNext);
    if (firstMove == position.playedNext) return;

    writer.write(
        position.moves.indexOf(firstMove!),
        getIndexWidth(position.moves.length)
    );
}

function readLine(
    reader: BitReader,
    fen: string,
    lineIndex: number,
    previousValues: Record<string, number>,
    format: LineFormat,
    position: LinePosition
): EngineLine {
    const type = reader.readFlag() ? "mate" : "centipawn";

    const value = previousValues[type] + reader.readSigned(evaluationOrder);
    previousValues[type] = value;

    const depth = (format.uniformDepth || reader.readFlag())
        ? format.baseDepth
        : reader.readUnsigned();

    const source = (format.uniformSource || reader.readFlag())
        ? format.baseSource
        : engineSources[reader.read(sourceBits)];

    if (!source) throw new Error("unknown engine");

    let firstMove: string | undefined;

    if (
        position.moves.length > 0
        && (format.movesAlwaysPresent || reader.readFlag())
    ) {
        firstMove = reader.readFlag()
            ? position.playedNext
            : position.moves[reader.read(getIndexWidth(position.moves.length))];

        if (!firstMove) throw new Error("invalid move");
    }

    const moves: EngineLine["moves"] = [];

    if (firstMove) {
        const move = new Chess(fen).move(firstMove);
        moves.push({ san: move.san, uci: move.lan });
    }

    return {
        evaluation: { type, value },
        source: source,
        depth: depth,
        index: lineIndex + 1,
        moves: moves
    };
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
 * @description Packs a reviewed game into a short shareable code.
 */
export function encodeReviewCode(game: AnalysedGame) {
    const nodes = getNodeChain(game.stateTree);

    const nodeLines = nodes.map(node => (
        pickEngineLines(node.state.fen, node.state.engineLines) || []
    ).slice(0, 2));

    const nodeMoves = nodes.map(node => getSortedMoves(node.state.fen));

    const baseSource = getMostCommon(
        nodeLines.flat().map(line => line.source),
        EngineVersion.STOCKFISH_19_LITE
    );

    // Final positions with the usual line need no lines in the code
    const terminal = nodes.map((node, index) => (
        nodeMoves[index].length == 0
        && isTerminalLine(nodeLines[index], node.state.fen, baseSource)
    ));

    const codedLines = nodeLines
        .filter((lines, index) => !terminal[index])
        .flat();

    const baseDepth = getMostCommon(codedLines.map(line => line.depth), 0);

    const format: LineFormat = {
        baseDepth: baseDepth,
        baseSource: baseSource,
        uniformDepth: codedLines.every(line => line.depth == baseDepth),
        uniformSource: codedLines.every(line => line.source == baseSource),
        movesAlwaysPresent: nodeLines.every((lines, index) => (
            nodeMoves[index].length == 0
            || lines.every(line => line.moves.length > 0)
        ))
    };

    const writer = new BitWriter();

    // Game details
    const standardStart = game.initialPosition == STARTING_FEN;
    writer.writeFlag(standardStart);
    if (!standardStart) writer.writeString(game.initialPosition);

    writer.writeFlag(game.variant == Variant.CHESS960);

    for (const player of [ game.players.white, game.players.black ]) {
        writer.writeString(player.username || "");

        writer.writeFlag(player.rating != undefined);
        if (player.rating != undefined) {
            writer.writeUnsigned(Math.max(0, Math.round(player.rating)), ratingOrder);
        }
    }

    writer.write(getResultIndex(game), 2);

    // Settings shared by most lines
    writer.writeUnsigned(format.baseDepth);
    writer.write(engineSources.indexOf(format.baseSource), sourceBits);
    writer.writeFlag(format.uniformDepth);
    writer.writeFlag(format.uniformSource);
    writer.writeFlag(format.movesAlwaysPresent);

    // Moves played
    writer.writeUnsigned(nodes.length - 1);

    for (const node of nodes.slice(1)) {
        const moves = getSortedMoves(node.parent!.state.fen);

        writer.write(
            moves.indexOf(node.state.move!.uci),
            getIndexWidth(moves.length)
        );
    }

    // Engine lines, with evaluations as changes from the previous one
    const previousValues = { centipawn: 0, mate: 0 };

    nodes.forEach((node, index) => {
        const lines = nodeLines[index];
        const moves = nodeMoves[index];

        if (moves.length == 0) {
            writer.writeFlag(terminal[index]);
            if (terminal[index]) return;
        }

        if (lines.length == 0) throw new Error("position without lines");

        // Positions with one legal move cannot have a second line
        if (moves.length > 1) writer.writeFlag(lines.length > 1);

        for (const line of lines) {
            writeLine(writer, line, previousValues, format, {
                moves: moves,
                playedNext: nodes[index + 1]?.state.move?.uci
            });
        }
    });

    const payload = writer.toBytes();

    const header = new BitWriter();
    header.write(codeVersion, versionBits);
    header.write(checksum(payload), checksumBits);

    const headerBytes = header.toBytes();
    const code = new Uint8Array(headerBytes.length + payload.length);

    code.set(headerBytes);
    code.set(payload, headerBytes.length);

    return codePrefix + toBase64Url(code);
}

function readGame(reader: BitReader) {
    const initialPosition = reader.readFlag()
        ? STARTING_FEN
        : reader.readString();

    const chess960 = reader.readFlag();

    const players = [ 0, 1 ].map(() => {
        const username = reader.readString();

        const rating = reader.readFlag()
            ? reader.readUnsigned(ratingOrder)
            : undefined;

        return { username, rating };
    });

    const result = results[reader.read(2)];

    const baseDepth = reader.readUnsigned();
    const baseSource = engineSources[reader.read(sourceBits)];
    if (!baseSource) throw new Error("unknown engine");

    const format: LineFormat = {
        baseDepth: baseDepth,
        baseSource: baseSource,
        uniformDepth: reader.readFlag(),
        uniformSource: reader.readFlag(),
        movesAlwaysPresent: reader.readFlag()
    };

    // Replay the moves into a PGN for the usual import path
    const board = new Chess(initialPosition);

    const plyCount = reader.readUnsigned();

    for (let ply = 0; ply < plyCount; ply++) {
        const moves = getSortedMoves(board.fen());
        const move = moves[reader.read(getIndexWidth(moves.length))];
        if (!move) throw new Error("invalid move");

        board.move(move);
    }

    const sanitise = (text: string) => text.replace(/["\\\]]/g, "");

    board.setHeader("White", sanitise(players[0].username) || "White");
    board.setHeader("Black", sanitise(players[1].username) || "Black");

    if (players[0].rating != undefined) {
        board.setHeader("WhiteElo", String(players[0].rating));
    }

    if (players[1].rating != undefined) {
        board.setHeader("BlackElo", String(players[1].rating));
    }

    if (chess960) board.setHeader("Variant", "Chess960");

    board.setHeader("Result", result);

    return { pgn: board.pgn(), format };
}

function readLines(
    reader: BitReader,
    nodes: StateTreeNode[],
    format: LineFormat
) {
    const previousValues = { centipawn: 0, mate: 0 };

    return nodes.map((node, index) => {
        const fen = node.state.fen;
        const moves = getSortedMoves(fen);

        if (moves.length == 0 && reader.readFlag()) {
            return [ getTerminalLine(fen, format.baseSource) ];
        }

        const lineCount = (moves.length > 1 && reader.readFlag()) ? 2 : 1;

        const position: LinePosition = {
            moves: moves,
            playedNext: nodes[index + 1]?.state.move?.uci
        };

        return Array.from({ length: lineCount }, (_, lineIndex) => readLine(
            reader, fen, lineIndex, previousValues, format, position
        ));
    });
}

/**
 * @description Unpacks a review code, found anywhere in the given text,
 * into a game whose mainline holds its engine lines. Returns null if no
 * valid code is found.
 */
export function decodeReviewCode(text: string): AnalysedGame | null {
    const encoded = text.match(codePattern)?.[1];
    if (!encoded) return null;

    try {
        const bytes = fromBase64Url(encoded);

        const header = new BitReader(bytes);
        if (header.read(versionBits) != codeVersion) return null;

        const expectedChecksum = header.read(checksumBits);

        const headerLength = Math.ceil((versionBits + checksumBits) / 8);
        const payload = bytes.slice(headerLength);

        if (checksum(payload) != expectedChecksum) return null;

        const reader = new BitReader(payload);

        const { pgn, format } = readGame(reader);

        const game = parsePgn(pgn);
        const stateTree = parseStateTree(game);

        const nodes = getNodeChain(stateTree);
        const nodeLines = readLines(reader, nodes, format);

        nodes.forEach((node, index) => {
            node.state.engineLines = nodeLines[index];
        });

        return { ...game, stateTree };
    } catch {
        return null;
    }
}
