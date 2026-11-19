import { describe, it } from "node:test";
import assert from "node:assert/strict";

import parsePgn from "@client/lib/games/pgn";
import PieceColour from "@shared/constants/PieceColour";
import { getNodeChain } from "@shared/types/game/position/StateTreeNode";
import parseStateTree from "../parse";
import {
    formatClockTime,
    formatMoveTime,
    formatTimeControl,
    getNodeClocks,
    parseClockTime,
    parseTimeControl
} from "../clocks";

function parseMainline(pgn: string) {
    const game = parsePgn(pgn);

    return getNodeChain(parseStateTree(game)).slice(1);
}

describe("time controls", () => {
    it("parses every form of the PGN standard", () => {
        assert.deepEqual(parseTimeControl("300"), [
            { moves: undefined, seconds: 300, increment: 0 }
        ]);

        assert.deepEqual(parseTimeControl("180+2"), [
            { moves: undefined, seconds: 180, increment: 2 }
        ]);

        assert.deepEqual(parseTimeControl("40/9000:3600"), [
            { moves: 40, seconds: 9000, increment: 0 },
            { moves: undefined, seconds: 3600, increment: 0 }
        ]);

        assert.deepEqual(parseTimeControl("40/5400+30:1800+30"), [
            { moves: 40, seconds: 5400, increment: 30 },
            { moves: undefined, seconds: 1800, increment: 30 }
        ]);
    });

    it("has no periods for unknown, untimed and sandclock games", () => {
        for (const value of ["?", "-", "*180", "", undefined, "abc", "0/60"]) {
            assert.equal(parseTimeControl(value), undefined, String(value));
        }
    });

    it("describes time controls in minutes and increments", () => {
        const describe = (value: string) => formatTimeControl(parseTimeControl(value)!);

        assert.equal(describe("180+2"), "3+2");
        assert.equal(describe("60"), "1+0");
        assert.equal(describe("15+0"), "¼+0");
        assert.equal(describe("90+1"), "1½+1");
        assert.equal(describe("40/5400+30:1800+30"), "40/90+30, 30+30");
        assert.equal(describe("1/86400"), "1/1d");
    });
});

describe("clock times", () => {
    it("parses clock commands", () => {
        assert.equal(parseClockTime("0:02:59.1"), 179.1);
        assert.equal(parseClockTime("1:02:58"), 3778);
        assert.equal(parseClockTime("2:59"), 179);
        assert.equal(parseClockTime("0:00:05"), 5);
        assert.equal(parseClockTime("soon"), undefined);
        assert.equal(parseClockTime(undefined), undefined);
    });

    it("formats clocks as they are shown", () => {
        assert.equal(formatClockTime(179.1), "2:59");
        assert.equal(formatClockTime(3778), "1:02:58");
        assert.equal(formatClockTime(9.8), "0:09.8");
        assert.equal(formatClockTime(9), "0:09");
        assert.equal(formatClockTime(-0.3), "0:00");

        assert.equal(formatMoveTime(4.2), "4.2s");
        assert.equal(formatMoveTime(80), "1:20");
    });
});

describe("move times", () => {
    it("reads Chess.com clocks, with tenths", () => {
        const moves = parseMainline(`[TimeControl "180"]

1. e4 {[%clk 0:03:00]} 1... g6 {[%clk 0:03:00]} 2. d4 {[%clk 0:02:59.1]}
2... c5 {[%clk 0:02:59.9]} 3. dxc5 {[%clk 0:02:58.1]} *`);

        assert.deepEqual(moves.map(node => node.state.clock), [180, 180, 179.1, 179.9, 178.1]);
        assert.deepEqual(moves.map(node => node.state.moveTime), [0, 0, 0.9, 0.1, 1]);
    });

    it("reads Lichess clocks, adding increments", () => {
        const moves = parseMainline(`[TimeControl "180+2"]

1. d4 { [%clk 0:03:00] } 1... g6 { [%clk 0:03:00] }
2. c4 { [%clk 0:03:01] } 2... Bg7 { [%clk 0:02:50] } *`);

        assert.deepEqual(moves.map(node => node.state.moveTime), [0, 0, 1, 12]);
    });

    it("counts an increment shown on a first move", () => {
        const moves = parseMainline(`[TimeControl "180+2"]

1. e4 {[%clk 0:03:01.5]} 1... e5 {[%clk 0:02:55]} *`);

        assert.deepEqual(moves.map(node => node.state.moveTime), [0.5, 5]);
    });

    it("adds the next period's time after the last move of a period", () => {
        const moves = parseMainline(`[TimeControl "1/60:30"]

1. e4 {[%clk 0:01:20]} 1... e5 {[%clk 0:01:25]}
2. Nf3 {[%clk 0:01:10]} 2... Nc6 {[%clk 0:01:20]} *`);

        // Each first move ends the first period, so its clock already
        // holds the next period's 30s
        assert.deepEqual(moves.map(node => node.state.moveTime), [10, 5, 10, 5]);
    });

    it("uses elapsed move times, and works out clocks from them", () => {
        const moves = parseMainline(`[TimeControl "300+5"]

1. e4 {[%emt 0:00:04]} 1... e5 {[%emt 0:00:10]} 2. Nf3 {[%emt 0:00:20]} *`);

        assert.deepEqual(moves.map(node => node.state.moveTime), [4, 10, 20]);
        assert.deepEqual(moves.map(node => node.state.clock), [301, 295, 286]);
    });

    it("leaves out time given by an opponent", () => {
        const moves = parseMainline(`[TimeControl "60+0"]

1. e4 {[%clk 0:01:00]} 1... e5 {[%clk 0:01:00]}
2. Nf3 {[%clk 0:01:10]} *`);

        assert.equal(moves[2].state.moveTime, undefined);
    });

    it("works out no move times from correspondence clocks", () => {
        const moves = parseMainline(`[TimeControl "1/86400"]

1. e4 {[%clk 23:00:00]} 1... e5 {[%clk 20:00:00]} 2. Nf3 {[%clk 22:00:00]} *`);

        assert.ok(moves.every(node => node.state.moveTime == undefined));
        assert.equal(moves[2].state.clock, 79200);
    });

    it("has no times for games without clocks", () => {
        const moves = parseMainline("[TimeControl \"180\"]\n\n1. e4 e5 *");

        assert.ok(moves.every(node => (
            node.state.clock == undefined && node.state.moveTime == undefined
        )));
    });
});

describe("game clocks", () => {
    it("shows each side's clock at a position, or the starting time", () => {
        const pgn = `[TimeControl "180+2"]

1. e4 {[%clk 0:03:00]} 1... e5 {[%clk 0:02:58]} 2. Nf3 {[%clk 0:02:55]} *`;

        const game = parsePgn(pgn);
        const nodes = getNodeChain(parseStateTree(game));
        const periods = parseTimeControl("180+2");

        assert.deepEqual(getNodeClocks(nodes[0], periods), {
            [PieceColour.WHITE]: 180, [PieceColour.BLACK]: 180
        });

        assert.deepEqual(getNodeClocks(nodes[1], periods), {
            [PieceColour.WHITE]: 180, [PieceColour.BLACK]: 180
        });

        assert.deepEqual(getNodeClocks(nodes[3], periods), {
            [PieceColour.WHITE]: 175, [PieceColour.BLACK]: 178
        });
    });
});
