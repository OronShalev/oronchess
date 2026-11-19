import { round } from "lodash-es";

import {
    StateTreeNode,
    getNodeChain
} from "@shared/types/game/position/StateTreeNode";
import PieceColour from "@shared/constants/PieceColour";

// Time controls, clocks and move times of games, from PGN metadata:
//   [TimeControl "180+2"]   PGN standard 9.6.1, in seconds
//   {[%clk 0:02:59.1]}      clock of the mover after the move
//   {[%emt 0:00:05]}        time the mover spent on the move
// Clock commands come from the PGN Specification Supplement (2001), as
// Chess.com (with tenths) and Lichess (whole seconds) export them.

export interface TimeControlPeriod {
    // Moves to make in the period, or undefined if it lasts the game
    moves?: number;
    seconds: number;
    increment: number;
}

export type GameClocks = Partial<Record<PieceColour, number>>;

type MoveCounts = Partial<Record<PieceColour, number>>;

// Periods of a day or more are correspondence, where clocks are reset
// rather than counted down, so move times cannot be worked out from them
const correspondenceSeconds = 86400;

/**
 * @description Returns the value of the TimeControl tag of a PGN.
 */
export function getPgnTimeControl(pgn: string) {
    return pgn.match(/\[TimeControl\s+"([^"]*)"\]/)?.[1];
}

/**
 * @description Parses a PGN TimeControl tag value into its periods, the
 * last of which repeats. Returns undefined for an unknown ("?") or no
 * ("-") time control, sandclocks, and values that cannot be read.
 */
export function parseTimeControl(value?: string) {
    if (!value) return;

    const periods: TimeControlPeriod[] = [];

    for (const descriptor of value.trim().split(":")) {
        const match = descriptor.match(/^(?:(\d+)\/)?(\d+)(?:\+(\d+(?:\.\d+)?))?$/);
        if (!match) return;

        const moves = match[1] ? parseInt(match[1]) : undefined;
        if (moves == 0) return;

        periods.push({
            moves: moves,
            seconds: parseInt(match[2]),
            increment: match[3] ? parseFloat(match[3]) : 0
        });
    }

    return periods;
}

function formatPeriodTime(seconds: number) {
    if (seconds >= 86400 && seconds % 86400 == 0) return `${seconds / 86400}d`;
    if (seconds >= 3600 && seconds % 3600 == 0) return `${seconds / 3600}h`;
    if (seconds % 60 == 0) return `${seconds / 60}`;

    const fractions: Record<number, string> = { 15: "¼", 30: "½", 45: "¾" };
    const fraction = fractions[seconds % 60];

    if (fraction) return `${Math.floor(seconds / 60) || ""}${fraction}`;

    return `${seconds}s`;
}

/**
 * @description Returns a short description of a time control, in minutes
 * plus increment seconds where possible, such as "3+2" or "40/90, 30+30".
 */
export function formatTimeControl(periods: TimeControlPeriod[]) {
    return periods.map(period => {
        const time = formatPeriodTime(period.seconds);

        if (period.moves) {
            return `${period.moves}/${time}`
                + (period.increment ? `+${period.increment}` : "");
        }

        return `${time}+${period.increment}`;
    }).join(", ");
}

/**
 * @description Parses a clock time such as "1:02:58", "0:02:59.9" or
 * "2:59" into seconds.
 */
export function parseClockTime(text?: string) {
    if (!text || !/^\d+(:\d+){0,2}(\.\d+)?$/.test(text.trim())) return;

    const seconds = text.trim().split(":").reduce(
        (total, part) => total * 60 + parseFloat(part), 0
    );

    return round(seconds, 1);
}

/**
 * @description Formats seconds as a clock shows them: "1:05:09", "2:59",
 * or with tenths under ten seconds when they are known, "0:09.8".
 */
export function formatClockTime(seconds: number) {
    const value = Math.max(0, round(seconds, 1));
    const wholeSeconds = Math.floor(value);

    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor(wholeSeconds % 3600 / 60);
    const pad = (part: number) => String(part).padStart(2, "0");

    const time = hours > 0
        ? `${hours}:${pad(minutes)}:${pad(wholeSeconds % 60)}`
        : `${minutes}:${pad(wholeSeconds % 60)}`;

    if (value < 10 && !Number.isInteger(value)) {
        return `${time}.${Math.round((value - wholeSeconds) * 10)}`;
    }

    return time;
}

/**
 * @description Formats seconds for a PGN clock command, "h:mm:ss" with
 * tenths when there are any, as in "0:02:59.1".
 */
export function formatClockCommand(seconds: number) {
    const tenths = Math.max(0, Math.round(seconds * 10));
    const wholeSeconds = Math.floor(tenths / 10);
    const pad = (part: number) => String(part).padStart(2, "0");

    const time = `${Math.floor(wholeSeconds / 3600)}`
        + `:${pad(Math.floor(wholeSeconds % 3600 / 60))}`
        + `:${pad(wholeSeconds % 60)}`;

    return tenths % 10 ? `${time}.${tenths % 10}` : time;
}

/**
 * @description Formats a move time in seconds, such as "4.2s" or "1:20".
 */
export function formatMoveTime(seconds: number) {
    if (seconds < 60) return `${round(seconds, 1)}s`;

    return formatClockTime(Math.round(seconds));
}

// Time a player gains after their nth move: the increment of the period
// it is played in, plus the next period's time if it completes its period
function getTimeGained(periods: TimeControlPeriod[], moveNumber: number) {
    let movesBefore = 0;

    for (let index = 0; ; index++) {
        const period = periods[Math.min(index, periods.length - 1)];
        if (!period.moves) return period.increment;

        const periodEnd = movesBefore + period.moves;

        if (moveNumber <= periodEnd) {
            const nextPeriod = periods[Math.min(index + 1, periods.length - 1)];

            return period.increment
                + (moveNumber == periodEnd ? nextPeriod.seconds : 0);
        }

        movesBefore = periodEnd;
    }
}

/**
 * @description Sets the move time of every move in a state tree, from its
 * elapsed move time, or from the mover's clocks before and after it.
 * Moves made with only elapsed times also get clocks, when the time
 * control is known.
 */
export function setMoveTimes(
    rootNode: StateTreeNode,
    periods?: TimeControlPeriod[]
) {
    const countable = !!periods?.length && periods.every(
        period => period.seconds < correspondenceSeconds
    );

    function visit(node: StateTreeNode, moveNumbers: MoveCounts) {
        const state = node.state;
        const colour = state.moveColour;

        if (colour) {
            const moveNumber = (moveNumbers[colour] || 0) + 1;
            moveNumbers = { ...moveNumbers, [colour]: moveNumber };

            // The mover's previous move was the one before last
            const firstMove = moveNumber == 1;
            const previousClock = firstMove
                ? periods?.[0]?.seconds
                : node.parent?.parent?.state.clock;

            const gained = countable ? getTimeGained(periods!, moveNumber) : 0;

            if (state.moveTime == undefined && state.clock != undefined) {
                state.moveTime = getSpentTime(
                    previousClock, state.clock, gained, firstMove
                );
            } else if (
                state.clock == undefined
                && state.moveTime != undefined
                && previousClock != undefined
                && countable
            ) {
                state.clock = round(previousClock + gained - state.moveTime, 1);
            }
        }

        for (const child of node.children) visit(child, moveNumbers);
    }

    function getSpentTime(
        previousClock: number | undefined,
        clock: number,
        gained: number,
        firstMove: boolean
    ) {
        if (previousClock == undefined) return;
        if (periods?.length && !countable) return;

        // Sites start clocks after each side's first move, and only some
        // add the increment for it, which shows in a clock above the start
        const spent = (firstMove && clock <= previousClock)
            ? previousClock - clock
            : previousClock + gained - clock;

        // Time given by an opponent shows as negative time spent
        if (spent < -0.5) return;

        return Math.max(0, round(spent, 1));
    }

    visit(rootNode, {});
}

/**
 * @description Returns whether the mainline of a game recorded clocks.
 */
export function hasClocks(rootNode: StateTreeNode) {
    return getNodeChain(rootNode).some(node => node.state.clock != undefined);
}

/**
 * @description Returns each player's clock at a position: from their last
 * move up to it, or the starting time before they have moved.
 */
export function getNodeClocks(
    node: StateTreeNode,
    periods?: TimeControlPeriod[]
): GameClocks {
    const clocks: GameClocks = {};

    for (let current: StateTreeNode | undefined = node; current; current = current.parent) {
        const colour = current.state.moveColour;

        if (colour && clocks[colour] == undefined && current.state.clock != undefined) {
            clocks[colour] = current.state.clock;
        }
    }

    const startingTime = periods?.[0]?.seconds;

    if (startingTime != undefined && startingTime < correspondenceSeconds) {
        clocks[PieceColour.WHITE] ??= startingTime;
        clocks[PieceColour.BLACK] ??= startingTime;
    }

    return clocks;
}
