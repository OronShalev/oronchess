import { Chess, Square, PieceSymbol, Color } from "chess.js";

import { Classification } from "@shared/constants/Classification";
import PieceColour from "@shared/constants/PieceColour";
import PlayerProfile from "@shared/types/game/PlayerProfile";
import { StateTreeNode } from "@shared/types/game/position/StateTreeNode";
import { GameClocks, formatClockTime } from "@shared/lib/stateTree/clocks";
import {
    classificationColours,
    classificationImages
} from "@analysis/constants/classifications";

import { pieceSize, pieceSvgs } from "./pieces";

// 1080 pixels wide, as phones and sharing sites expect, with even heights
// as H.264 needs
const boardSize = 1080;
const squareSize = boardSize / 8;
const barHeight = 120;

const barColour = "#1f2125";
const lastMoveColour = "#ffff33";

const textFont = "\"Noto Sans\", sans-serif";
const clockFont = "\"JetBrains Mono\", monospace";

export interface VideoLayout {
    width: number;
    height: number;
    boardTop: number;
    bars: boolean;
}

export interface VideoAssets {
    pieces: Record<string, CanvasImageSource>;
    classifications: Partial<Record<Classification, CanvasImageSource>>;
}

export interface VideoScene {
    layout: VideoLayout;
    assets: VideoAssets;
    theme: {
        lightSquareColour: string;
        darkSquareColour: string;
    };
    flipped: boolean;
    // Only given when names are shown
    players?: Record<PieceColour, PlayerProfile>;
}

export interface VideoFrameState {
    node: StateTreeNode;
    // How far the move to the node has been animated, 1 once it arrives
    progress: number;
    // Only given when clocks are shown
    clocks?: GameClocks;
}

interface MovingPiece {
    piece: string;
    from: Square;
    to: Square;
}

/**
 * @description Returns the size and layout of a video frame: the board,
 * with a bar for each player above and below it when they are shown.
 */
export function getVideoLayout(bars: boolean): VideoLayout {
    return {
        width: boardSize,
        height: boardSize + (bars ? 2 * barHeight : 0),
        boardTop: bars ? barHeight : 0,
        bars: bars
    };
}

function loadImage(source: string) {
    return new Promise<HTMLImageElement>((res, rej) => {
        const image = new Image();

        image.onload = () => res(image);
        image.onerror = () => rej(new Error(`image failed to load: ${source}`));
        image.src = source;
    });
}

// Pieces are drawn once at the size of a square, so that they stay sharp
async function rasterisePiece(innerSvg: string) {
    const svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" "
        + `viewBox="0 0 ${pieceSize} ${pieceSize}" `
        + `width="${squareSize}" height="${squareSize}">${innerSvg}</svg>`;

    const image = await loadImage(
        "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)
    );

    const canvas = document.createElement("canvas");
    canvas.width = squareSize;
    canvas.height = squareSize;
    canvas.getContext("2d")!.drawImage(image, 0, 0, squareSize, squareSize);

    return canvas;
}

let videoAssets: Promise<VideoAssets> | undefined;

/**
 * @description Loads the pieces, classification icons and fonts that
 * video frames are drawn with, once.
 */
export function loadVideoAssets() {
    videoAssets ??= loadAssets();

    // A failed load is tried again next time
    videoAssets.catch(() => videoAssets = undefined);

    return videoAssets;
}

async function loadAssets(): Promise<VideoAssets> {
    const pieceEntries = await Promise.all(Object.entries(pieceSvgs).map(
        async ([ name, svg ]) => [ name, await rasterisePiece(svg) ] as const
    ));

    const classificationEntries = await Promise.all(
        Object.entries(classificationImages).map(
            async ([ classification, source ]) => (
                [ classification, await loadImage(source) ] as const
            )
        )
    );

    await Promise.all([
        document.fonts.load(`600 44px ${textFont}`),
        document.fonts.load(`600 52px ${clockFont}`)
    ]).catch(() => undefined);

    return {
        pieces: Object.fromEntries(pieceEntries),
        classifications: Object.fromEntries(classificationEntries)
    };
}

function getSquarePosition(square: Square, scene: VideoScene) {
    const file = square.charCodeAt(0) - 97;
    const rank = parseInt(square[1]) - 1;

    return {
        x: (scene.flipped ? 7 - file : file) * squareSize,
        y: scene.layout.boardTop
            + (scene.flipped ? rank : 7 - rank) * squareSize
    };
}

function getPieceName(colour: Color, type: PieceSymbol) {
    return colour + type.toUpperCase();
}

// Gets faster then slower, as pieces move on the board
function easeInOut(progress: number) {
    return progress < 0.5
        ? 4 * progress ** 3
        : 1 - (-2 * progress + 2) ** 3 / 2;
}

function drawBoard(context: CanvasRenderingContext2D, scene: VideoScene) {
    const { lightSquareColour, darkSquareColour } = scene.theme;

    for (let file = 0; file < 8; file++) {
        for (let rank = 0; rank < 8; rank++) {
            const light = (file + rank) % 2 == 1;

            context.fillStyle = light ? lightSquareColour : darkSquareColour;
            context.fillRect(
                file * squareSize,
                scene.layout.boardTop + (7 - rank) * squareSize,
                squareSize,
                squareSize
            );
        }
    }

    // Coordinates in the corners of the edge squares, as on the board
    context.font = `600 ${Math.round(squareSize * 0.16)}px ${textFont}`;

    for (let index = 0; index < 8; index++) {
        const file = scene.flipped ? 7 - index : index;
        const rank = scene.flipped ? index : 7 - index;

        // Squares on the bottom row and the left column alternate from dark
        const bottomLight = index % 2 == 1;
        const leftLight = index % 2 == 0;

        context.fillStyle = bottomLight ? darkSquareColour : lightSquareColour;
        context.textAlign = "right";
        context.textBaseline = "bottom";
        context.fillText(
            String.fromCharCode(97 + file),
            (index + 1) * squareSize - squareSize * 0.05,
            scene.layout.boardTop + boardSize - squareSize * 0.03
        );

        context.fillStyle = leftLight ? darkSquareColour : lightSquareColour;
        context.textAlign = "left";
        context.textBaseline = "top";
        context.fillText(
            String(rank + 1),
            squareSize * 0.05,
            scene.layout.boardTop + index * squareSize + squareSize * 0.04
        );
    }
}

function drawHighlights(
    context: CanvasRenderingContext2D,
    scene: VideoScene,
    node: StateTreeNode
) {
    const uci = node.state.move?.uci;
    if (!uci) return;

    const classification = node.state.classification;

    context.globalAlpha = 0.5;
    context.fillStyle = classification
        ? classificationColours[classification]
        : lastMoveColour;

    for (const square of [ uci.slice(0, 2), uci.slice(2, 4) ] as Square[]) {
        const { x, y } = getSquarePosition(square, scene);
        context.fillRect(x, y, squareSize, squareSize);
    }

    context.globalAlpha = 1;
}

// Pieces that move with a move: the piece itself, and a rook when castling
function getMovingPieces(parentFen: string, uci: string): MovingPiece[] {
    const move = new Chess(parentFen).move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4) || undefined
    });

    const movingPieces: MovingPiece[] = [{
        piece: getPieceName(move.color, move.piece),
        from: move.from,
        to: move.to
    }];

    const rank = move.color == "w" ? "1" : "8";

    if (move.isKingsideCastle()) movingPieces.push({
        piece: getPieceName(move.color, "r"),
        from: `h${rank}` as Square,
        to: `f${rank}` as Square
    });

    if (move.isQueensideCastle()) movingPieces.push({
        piece: getPieceName(move.color, "r"),
        from: `a${rank}` as Square,
        to: `d${rank}` as Square
    });

    return movingPieces;
}

function drawPieces(
    context: CanvasRenderingContext2D,
    scene: VideoScene,
    state: VideoFrameState
) {
    const { node, progress } = state;
    const parentFen = node.parent?.state.fen;
    const uci = node.state.move?.uci;

    const animating = progress < 1 && !!parentFen && !!uci;

    // While a move is animated, the pieces stand as they were before it,
    // apart from those that move, which are drawn on the way
    const movingPieces = animating ? getMovingPieces(parentFen, uci) : [];
    const movingFrom = new Set(movingPieces.map(piece => piece.from));

    const board = new Chess(animating ? parentFen : node.state.fen).board();

    for (const row of board) {
        for (const piece of row) {
            if (!piece || movingFrom.has(piece.square)) continue;

            const { x, y } = getSquarePosition(piece.square, scene);

            context.drawImage(
                scene.assets.pieces[getPieceName(piece.color, piece.type)],
                x, y, squareSize, squareSize
            );
        }
    }

    const eased = easeInOut(progress);

    for (const movingPiece of movingPieces) {
        const from = getSquarePosition(movingPiece.from, scene);
        const to = getSquarePosition(movingPiece.to, scene);

        context.drawImage(
            scene.assets.pieces[movingPiece.piece],
            from.x + (to.x - from.x) * eased,
            from.y + (to.y - from.y) * eased,
            squareSize,
            squareSize
        );
    }
}

// The classification icon sits on the top right corner of the square
// moved to, as on the board, kept inside the board at its edges
function drawClassification(
    context: CanvasRenderingContext2D,
    scene: VideoScene,
    node: StateTreeNode
) {
    const classification = node.state.classification;
    const uci = node.state.move?.uci;
    if (!classification || !uci) return;

    const icon = scene.assets.classifications[classification];
    if (!icon) return;

    const iconSize = squareSize * 0.45;
    const { x, y } = getSquarePosition(uci.slice(2, 4) as Square, scene);

    const iconX = Math.min(x + squareSize * 0.7, boardSize - iconSize);
    const iconY = Math.max(y - squareSize * 0.15, scene.layout.boardTop);

    context.drawImage(icon, iconX, iconY, iconSize, iconSize);
}

function fitText(
    context: CanvasRenderingContext2D,
    text: string,
    maxWidth: number
) {
    if (context.measureText(text).width <= maxWidth) return text;

    let fitted = text;

    while (fitted.length > 1 && context.measureText(fitted + "…").width > maxWidth) {
        fitted = fitted.slice(0, -1);
    }

    return fitted + "…";
}

function drawRoundedRect(
    context: CanvasRenderingContext2D,
    x: number, y: number, width: number, height: number, radius: number
) {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    context.fill();
}

function drawPlayerBar(
    context: CanvasRenderingContext2D,
    scene: VideoScene,
    state: VideoFrameState,
    colour: PieceColour,
    top: number
) {
    const padding = 32;
    const centre = top + barHeight / 2;

    context.fillStyle = barColour;
    context.fillRect(0, top, boardSize, barHeight);

    // A swatch of the player's colour, as names may be hidden
    context.fillStyle = colour == PieceColour.WHITE ? "#f5f5f5" : "#0a0a0a";
    context.strokeStyle = "#50575f";
    context.lineWidth = 3;
    context.beginPath();
    context.roundRect(padding, centre - 22, 44, 44, 8);
    context.fill();
    context.stroke();

    let textRight = boardSize - padding;

    // Clock on the right, lit while it is the player's turn
    const seconds = state.clocks?.[colour];

    if (seconds != undefined) {
        const running = state.node.state.fen.split(" ")[1]
            == (colour == PieceColour.WHITE ? "w" : "b");

        const clockText = formatClockTime(seconds);

        context.font = `600 52px ${clockFont}`;
        const clockWidth = context.measureText(clockText).width + 48;
        const clockX = boardSize - padding - clockWidth;

        context.fillStyle = running ? "#f5f5f5" : "#3b3e43";
        drawRoundedRect(context, clockX, centre - 40, clockWidth, 80, 10);

        context.fillStyle = running ? "#0a0a0a" : "#c8ccd2";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(clockText, clockX + clockWidth / 2, centre + 2);

        textRight = clockX - 24;
    }

    const profile = scene.players?.[colour];
    if (!profile) return;

    let textX = padding + 44 + 24;

    context.textBaseline = "middle";
    context.textAlign = "left";

    if (profile.title) {
        context.font = `700 34px ${textFont}`;
        const titleWidth = context.measureText(profile.title).width + 20;

        context.fillStyle = "rgb(180, 20, 20)";
        drawRoundedRect(context, textX, centre - 24, titleWidth, 48, 8);

        context.fillStyle = "white";
        context.fillText(profile.title, textX + 10, centre + 1);

        textX += titleWidth + 14;
    }

    const rating = profile.rating != undefined ? ` (${profile.rating})` : "";

    context.font = `500 40px ${textFont}`;
    const ratingWidth = context.measureText(rating).width;

    context.font = `600 44px ${textFont}`;
    const username = fitText(
        context,
        profile.username || "?",
        Math.max(0, textRight - textX - ratingWidth)
    );

    context.fillStyle = "white";
    context.fillText(username, textX, centre + 1);

    if (rating) {
        const usernameWidth = context.measureText(username).width;

        context.font = `500 40px ${textFont}`;
        context.fillStyle = "#9a9ea6";
        context.fillText(rating, textX + usernameWidth, centre + 1);
    }
}

/**
 * @description Draws one frame of a game video: the position after a
 * move, or on the way to it, with its classification once it arrives.
 */
export function drawVideoFrame(
    context: CanvasRenderingContext2D,
    scene: VideoScene,
    state: VideoFrameState
) {
    const { layout } = scene;

    context.fillStyle = barColour;
    context.fillRect(0, 0, layout.width, layout.height);

    drawBoard(context, scene);
    drawHighlights(context, scene, state.node);
    drawPieces(context, scene, state);

    if (state.progress >= 1) {
        drawClassification(context, scene, state.node);
    }

    if (!layout.bars) return;

    const topColour = scene.flipped ? PieceColour.WHITE : PieceColour.BLACK;
    const bottomColour = scene.flipped ? PieceColour.BLACK : PieceColour.WHITE;

    drawPlayerBar(context, scene, state, topColour, 0);
    drawPlayerBar(context, scene, state, bottomColour, layout.boardTop + boardSize);
}
