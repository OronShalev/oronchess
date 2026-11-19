import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    VideoSpeed,
    getVideoDuration,
    getVideoTimeline,
    videoFrameRate,
    videoSpeedTimings
} from "../timeline";

const speeds = Object.values(VideoSpeed);

describe("video timeline", () => {
    for (const speed of speeds) {
        it(`fills the whole ${speed} video without gaps`, () => {
            const timeline = getVideoTimeline(40, speed);

            let time = 0;

            for (const frame of timeline) {
                assert.equal(frame.start, time);
                assert.ok(frame.length >= 1);

                time += frame.length;
            }

            assert.equal(time / videoFrameRate, getVideoDuration(40, speed));
        });
    }

    it("shows every move for its speed's time, and animates it first", () => {
        const timeline = getVideoTimeline(3, VideoSpeed.REGULAR);
        const moveFrames = videoSpeedTimings[VideoSpeed.REGULAR].moveSeconds * videoFrameRate;

        for (const ply of [1, 2]) {
            const frames = timeline.filter(frame => frame.ply == ply);
            const length = frames.reduce((total, frame) => total + frame.length, 0);

            assert.equal(length, moveFrames);

            // Progress rises to the move's arrival, then stays there
            const progresses = frames.map(frame => frame.progress);

            assert.ok(progresses[0] > 0 && progresses[0] < 1);
            assert.deepEqual(progresses, [...progresses].sort((a, b) => a - b));
            assert.equal(progresses.at(-1), 1);
        }
    });

    it("never holds a frame for more than half a second", () => {
        for (const speed of speeds) {
            assert.ok(getVideoTimeline(10, speed).every(
                frame => frame.length <= videoFrameRate / 2
            ));
        }
    });

    it("holds the start and the end", () => {
        const timeline = getVideoTimeline(2, VideoSpeed.FAST);

        assert.equal(timeline[0].ply, 0);
        assert.equal(timeline.at(-1)!.ply, 2);
        assert.equal(getVideoDuration(2, VideoSpeed.FAST), 1 + 2 * 0.6 + 3);
    });

    it("makes a still video of a game without moves", () => {
        const timeline = getVideoTimeline(0, VideoSpeed.SLOW);

        assert.ok(timeline.every(frame => frame.ply == 0 && frame.progress == 1));
        assert.equal(getVideoDuration(0, VideoSpeed.SLOW), 4);
    });

    it("is slower at slower speeds", () => {
        assert.ok(getVideoDuration(30, VideoSpeed.SLOW) > getVideoDuration(30, VideoSpeed.REGULAR));
        assert.ok(getVideoDuration(30, VideoSpeed.REGULAR) > getVideoDuration(30, VideoSpeed.FAST));
    });
});
