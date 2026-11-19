import { StateTreeNode } from "@shared/types/game/position/StateTreeNode";
import { MoveSound, getMoveSounds, moveSounds } from "@client/lib/boardSounds";

export const videoSampleRate = 48000;

// Move sounds are rendered a few seconds at a time, so that long games
// never need the whole soundtrack in memory
const chunkSeconds = 10;

interface SoundEvent {
    sound: MoveSound;
    // Seconds into the video
    time: number;
}

async function decodeSounds(sounds: Set<MoveSound>) {
    // Decoding needs a context, though not one that plays anything
    const context = new OfflineAudioContext(1, 1, videoSampleRate);

    const entries = await Promise.all([...sounds].map(async sound => {
        const response = await fetch(moveSounds[sound]);
        const buffer = await context.decodeAudioData(await response.arrayBuffer());

        return [ sound, buffer ] as const;
    }));

    return new Map(entries);
}

/**
 * @description Renders the move sounds of a game video, each played as
 * its move arrives, as consecutive mono audio buffers that together last
 * as long as the video.
 */
export async function* renderMoveSounds(
    nodes: StateTreeNode[],
    arrivalTimes: number[],
    duration: number
) {
    const events: SoundEvent[] = [];

    arrivalTimes.forEach((time, ply) => {
        for (const sound of getMoveSounds(nodes[ply])) {
            events.push({ sound, time });
        }
    });

    const buffers = await decodeSounds(new Set(events.map(event => event.sound)));

    for (let start = 0; start < duration; start += chunkSeconds) {
        const end = Math.min(start + chunkSeconds, duration);

        const context = new OfflineAudioContext(
            1,
            Math.round((end - start) * videoSampleRate),
            videoSampleRate
        );

        for (const event of events) {
            const buffer = buffers.get(event.sound)!;

            // Sounds started in an earlier chunk carry on into this one
            if (event.time >= end || event.time + buffer.duration <= start) {
                continue;
            }

            const source = context.createBufferSource();
            source.buffer = buffer;
            source.connect(context.destination);

            if (event.time >= start) {
                source.start(event.time - start);
            } else {
                source.start(0, start - event.time);
            }
        }

        yield await context.startRendering();
    }
}
