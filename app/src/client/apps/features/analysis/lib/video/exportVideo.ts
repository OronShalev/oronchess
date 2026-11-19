import AnalysedGame from "@shared/types/game/AnalysedGame";
import PieceColour from "@shared/constants/PieceColour";
import { getNodeChain } from "@shared/types/game/position/StateTreeNode";
import {
    getNodeClocks,
    getPgnTimeControl,
    hasClocks,
    parseTimeControl
} from "@shared/lib/stateTree/clocks";

import {
    VideoScene,
    drawVideoFrame,
    getVideoLayout,
    loadVideoAssets
} from "./frames";
import {
    VideoSpeed,
    getMoveArrivalTimes,
    getVideoTimeline,
    videoFrameRate
} from "./timeline";
import { renderMoveSounds, videoSampleRate } from "./audio";

export interface VideoExportOptions {
    speed: VideoSpeed;
    showPlayers: boolean;
    showClocks: boolean;
    moveSounds: boolean;
    flipped: boolean;
    theme: VideoScene["theme"];
}

export interface GameVideo {
    video: Blob;
    // False when move sounds were asked for but could not be encoded
    hasSound: boolean;
}

export class VideoEncodingUnsupportedError extends Error {}

/**
 * @description Returns whether a video of a game would show player bars:
 * for names, or for clocks when the game recorded them.
 */
export function videoHasBars(game: AnalysedGame, options: Pick<
    VideoExportOptions, "showPlayers" | "showClocks"
>) {
    return options.showPlayers
        || (options.showClocks && hasClocks(game.stateTree));
}

/**
 * @description Creates the scene that frames of a game video are drawn
 * in, loading what they are drawn with.
 */
export async function createVideoScene(
    game: AnalysedGame,
    options: Omit<VideoExportOptions, "speed" | "moveSounds">
): Promise<VideoScene> {
    return {
        layout: getVideoLayout(videoHasBars(game, options)),
        assets: await loadVideoAssets(),
        theme: options.theme,
        flipped: options.flipped,
        players: options.showPlayers ? {
            [PieceColour.WHITE]: game.players.white,
            [PieceColour.BLACK]: game.players.black
        } : undefined
    };
}

/**
 * @description Renders the mainline of a reviewed game into an MP4 video,
 * with the classification of every move, and its sound if asked for.
 * Rejects with "abort" if the signal aborts.
 */
export async function exportGameVideo(
    game: AnalysedGame,
    options: VideoExportOptions,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal
): Promise<GameVideo> {
    const {
        Output,
        Mp4OutputFormat,
        BufferTarget,
        CanvasSource,
        AudioBufferSource,
        QUALITY_HIGH,
        getFirstEncodableVideoCodec,
        getFirstEncodableAudioCodec
    } = await import("mediabunny");

    const nodes = getNodeChain(game.stateTree);
    const scene = await createVideoScene(game, options);
    const { width, height } = scene.layout;

    const codec = await getFirstEncodableVideoCodec(
        ["avc", "vp9", "av1", "hevc"],
        { width, height, quality: QUALITY_HIGH }
    );

    if (!codec) throw new VideoEncodingUnsupportedError();

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d")!;

    const output = new Output({
        format: new Mp4OutputFormat({ fastStart: "in-memory" }),
        target: new BufferTarget()
    });

    const source = new CanvasSource(canvas, {
        codec: codec,
        quality: QUALITY_HIGH
    });

    output.addVideoTrack(source, { frameRate: videoFrameRate });

    // AAC plays everywhere; Opus is the fallback where it cannot be made
    const audioCodec = options.moveSounds
        ? await getFirstEncodableAudioCodec(["aac", "opus"], {
            numberOfChannels: 1,
            sampleRate: videoSampleRate,
            quality: QUALITY_HIGH
        })
        : null;

    const audioSource = audioCodec && new AudioBufferSource({
        codec: audioCodec,
        quality: QUALITY_HIGH
    });

    if (audioSource) output.addAudioTrack(audioSource);

    const periods = parseTimeControl(getPgnTimeControl(game.pgn));
    const showClocks = options.showClocks && hasClocks(game.stateTree);

    const timeline = getVideoTimeline(nodes.length - 1, options.speed);

    await output.start();

    try {
        if (audioSource) {
            const lastFrame = timeline[timeline.length - 1];
            const duration = (lastFrame.start + lastFrame.length) / videoFrameRate;

            const soundChunks = renderMoveSounds(
                nodes, getMoveArrivalTimes(timeline), duration
            );

            for await (const soundChunk of soundChunks) {
                await audioSource.add(soundChunk);
            }
        }

        for (const [ index, frame ] of timeline.entries()) {
            if (signal?.aborted) throw "abort";

            const node = nodes[frame.ply];

            // Clocks change once a move has been made
            const clockNode = (frame.progress < 1 && node.parent) || node;

            drawVideoFrame(context, scene, {
                node: node,
                progress: frame.progress,
                clocks: showClocks
                    ? getNodeClocks(clockNode, periods)
                    : undefined
            });

            await source.add(
                frame.start / videoFrameRate,
                frame.length / videoFrameRate
            );

            onProgress?.((index + 1) / timeline.length);
        }

        await output.finalize();
    } catch (error) {
        await output.cancel().catch(() => undefined);
        throw error;
    }

    return {
        video: new Blob([output.target.buffer!], { type: "video/mp4" }),
        hasSound: !!audioSource || !options.moveSounds
    };
}
