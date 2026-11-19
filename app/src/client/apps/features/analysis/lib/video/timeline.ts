export enum VideoSpeed {
    SLOW = "slow",
    REGULAR = "regular",
    FAST = "fast"
}

interface VideoSpeedTiming {
    // Time each move is shown for, including its animation
    moveSeconds: number;
    animationSeconds: number;
}

export const videoSpeedTimings: Record<VideoSpeed, VideoSpeedTiming> = {
    [VideoSpeed.SLOW]: { moveSeconds: 2, animationSeconds: 0.4 },
    [VideoSpeed.REGULAR]: { moveSeconds: 1.2, animationSeconds: 0.25 },
    [VideoSpeed.FAST]: { moveSeconds: 0.6, animationSeconds: 0.15 }
};

export const videoFrameRate = 30;

// The starting position is shown for a second, and the final one for three
const startFrames = videoFrameRate;
const endFrames = 3 * videoFrameRate;

// Still positions are held in frames of up to half a second, so that the
// video can be seeked without long gaps between frames
const maxStillFrames = videoFrameRate / 2;

export interface VideoFrame {
    // Index of the position shown, 0 for the starting position
    ply: number;
    // How far the move to it has been animated, 1 once it has arrived
    progress: number;
    // Start and length, in frames of the video's frame rate
    start: number;
    length: number;
}

/**
 * @description Returns the frames of a video of a game with the given
 * number of moves, each held for as long as it stays the same.
 */
export function getVideoTimeline(plyCount: number, speed: VideoSpeed) {
    const timing = videoSpeedTimings[speed];

    const moveFrames = Math.round(timing.moveSeconds * videoFrameRate);
    const animationFrames = Math.max(
        1, Math.round(timing.animationSeconds * videoFrameRate)
    );

    const frames: VideoFrame[] = [];
    let time = 0;

    function addFrame(ply: number, progress: number, length: number) {
        frames.push({ ply, progress, start: time, length });
        time += length;
    }

    function hold(ply: number, length: number) {
        while (length > 0) {
            const stillLength = Math.min(length, maxStillFrames);

            addFrame(ply, 1, stillLength);
            length -= stillLength;
        }
    }

    hold(0, startFrames);

    for (let ply = 1; ply <= plyCount; ply++) {
        // The last animation frame is the move arriving
        for (let frame = 1; frame < animationFrames; frame++) {
            addFrame(ply, frame / animationFrames, 1);
        }

        const stillFrames = moveFrames - (animationFrames - 1)
            + (ply == plyCount ? endFrames : 0);

        hold(ply, stillFrames);
    }

    if (plyCount == 0) hold(0, endFrames);

    return frames;
}

/**
 * @description Returns the length in seconds of a video of a game with
 * the given number of moves.
 */
export function getVideoDuration(plyCount: number, speed: VideoSpeed) {
    const moveFrames = Math.round(
        videoSpeedTimings[speed].moveSeconds * videoFrameRate
    );

    return (startFrames + plyCount * moveFrames + endFrames) / videoFrameRate;
}
