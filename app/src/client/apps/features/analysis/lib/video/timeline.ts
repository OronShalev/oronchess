// Named after chess time controls, from the slowest to the fastest
export enum VideoSpeed {
    CLASSICAL = "classical",
    RAPID = "rapid",
    BLITZ = "blitz",
    BULLET = "bullet",
    ULTRABULLET = "ultraBullet"
}

interface VideoSpeedTiming {
    // Time each move is shown for, including its animation
    moveSeconds: number;
    // Frames the move's pieces take to slide to their squares
    animationFrames: number;
}

export const videoSpeedTimings: Record<VideoSpeed, VideoSpeedTiming> = {
    [VideoSpeed.CLASSICAL]: { moveSeconds: 2, animationFrames: 12 },
    [VideoSpeed.RAPID]: { moveSeconds: 1.6, animationFrames: 10 },
    [VideoSpeed.BLITZ]: { moveSeconds: 1.2, animationFrames: 8 },
    [VideoSpeed.BULLET]: { moveSeconds: 0.9, animationFrames: 6 },
    [VideoSpeed.ULTRABULLET]: { moveSeconds: 0.6, animationFrames: 5 }
};

export const defaultVideoSpeed = VideoSpeed.BLITZ;

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
    const animationFrames = timing.animationFrames;

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
 * @description Returns the time in seconds at which each move of a video
 * arrives on its square, indexed by the position it leads to.
 */
export function getMoveArrivalTimes(timeline: VideoFrame[]) {
    const arrivalTimes: number[] = [];

    for (const frame of timeline) {
        if (frame.ply == 0 || frame.progress < 1) continue;

        arrivalTimes[frame.ply] ??= frame.start / videoFrameRate;
    }

    return arrivalTimes;
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
