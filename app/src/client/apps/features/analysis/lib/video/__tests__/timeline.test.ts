import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    VideoSpeed,
    defaultVideoSpeed,
    getMoveArrivalTimes,
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

        it(`times ${speed} moves in whole frames`, () => {
            const timing = videoSpeedTimings[speed];
            const moveFrames = timing.moveSeconds * videoFrameRate;

            assert.ok(Math.abs(moveFrames - Math.round(moveFrames)) < 1e-9);
            assert.ok(timing.animationFrames >= 1 && timing.animationFrames < moveFrames);
        });
    }

    it("shows every move for its speed's time, and animates it first", () => {
        const timeline = getVideoTimeline(3, VideoSpeed.BLITZ);
        const moveFrames = videoSpeedTimings[VideoSpeed.BLITZ].moveSeconds * videoFrameRate;

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
        const timeline = getVideoTimeline(2, VideoSpeed.ULTRABULLET);

        assert.equal(timeline[0].ply, 0);
        assert.equal(timeline.at(-1)!.ply, 2);
        assert.equal(getVideoDuration(2, VideoSpeed.ULTRABULLET), 1 + 2 * 0.6 + 3);
    });

    it("makes a still video of a game without moves", () => {
        const timeline = getVideoTimeline(0, VideoSpeed.CLASSICAL);

        assert.ok(timeline.every(frame => frame.ply == 0 && frame.progress == 1));
        assert.equal(getVideoDuration(0, VideoSpeed.CLASSICAL), 4);
    });

    it("orders its speeds from the slowest, with blitz in the middle", () => {
        const durations = speeds.map(speed => getVideoDuration(30, speed));

        for (let index = 1; index < durations.length; index++) {
            assert.ok(durations[index] < durations[index - 1], speeds[index]);
        }

        assert.equal(speeds.indexOf(defaultVideoSpeed), 2);
    });
});

describe("move arrival times", () => {
    it("is when each move's animation ends", () => {
        const timeline = getVideoTimeline(3, VideoSpeed.BLITZ);
        const arrivalTimes = getMoveArrivalTimes(timeline);

        // A second of the start, then 1.2s per move, arriving on the last
        // frame of its animation
        const animation = (videoSpeedTimings[VideoSpeed.BLITZ].animationFrames - 1)
            / videoFrameRate;

        assert.equal(arrivalTimes[0], undefined);

        [1, 2, 3].forEach(ply => {
            const expected = 1 + (ply - 1) * 1.2 + animation;

            assert.ok(Math.abs(arrivalTimes[ply] - expected) < 1e-9, `ply ${ply}`);
        });
    });

    it("has a time for every move", () => {
        for (const speed of speeds) {
            const arrivalTimes = getMoveArrivalTimes(getVideoTimeline(25, speed));

            assert.equal(arrivalTimes.filter(time => time != undefined).length, 25);
        }
    });
});
