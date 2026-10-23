import { Chess } from "chess.js";

import { EngineLine } from "@shared/types/game/position/EngineLine";
import EngineVersion from "@shared/constants/EngineVersion";
import { STARTING_FEN } from "@shared/constants/utils";
import {
    EngineTransport,
    NativeEngineKind,
    createNativeEngineTransport,
    isNativeEngineAvailable
} from "./nativeEngine";

// Convert UCI evaluation types to our ones
const uciEvaluationTypes: Record<string, "centipawn" | "mate" | undefined> = {
    cp: "centipawn",
    mate: "mate"
};

interface ParsedInfoLine {
    depth: number;
    index: number;
    evaluation: EngineLine["evaluation"];
    moveUcis: string[];
}

const nativeEngineKinds: Partial<Record<EngineVersion, NativeEngineKind>> = {
    [EngineVersion.STOCKFISH_19]: "full",
    [EngineVersion.STOCKFISH_19_LITE]: "lite"
};

/**
 * @description Returns whether an engine version runs as a native program
 * here, as it does in the apps.
 */
export function isNativeEngine(version: EngineVersion) {
    const kind = nativeEngineKinds[version];

    return !!kind && isNativeEngineAvailable(kind);
}

class Engine {
    private worker: EngineTransport;
    private version: EngineVersion;

    private position = STARTING_FEN;
    private lineCount = 1;
    private evaluating = false;

    constructor(version: EngineVersion) {
        this.worker = isNativeEngine(version)
            ? createNativeEngineTransport(nativeEngineKinds[version]!)
            : new Worker("/engines/" + version);
        this.version = version;

        this.worker.postMessage("uci");
        this.setPosition(this.position);
    }

    private consumeLogs(
        command: string,
        endCondition: (logMessage: string) => boolean,
        onLogReceived?: (logMessage: string) => void
    ): Promise<string[]> {
        this.worker.postMessage(command);

        const worker = this.worker;
        const logMessages: string[] = [];

        return new Promise((res, rej) => {
            function onMessageReceived(event: MessageEvent) {
                const message = String(event.data);

                onLogReceived?.(message);

                logMessages.push(message);

                if (endCondition(message)) {
                    worker.removeEventListener("message", onMessageReceived);
                    worker.removeEventListener("error", rej);

                    res(logMessages);
                }
            }

            this.worker.addEventListener("message", onMessageReceived);
            this.worker.addEventListener("error", rej);
        });
    }

    private parseInfoLine(log: string): ParsedInfoLine | undefined {
        if (!log.startsWith("info depth")) return;
        if (log.includes("currmove")) return;

        // Aspiration window fails are superseded by an exact line
        if (log.includes(" lowerbound") || log.includes(" upperbound")) return;

        // Extract depth and multipv index of line
        const depth = parseInt(log.match(/(?<= depth )\d+/)?.[0] || "");
        if (isNaN(depth)) return;

        const index = parseInt(log.match(/(?<= multipv )\d+/)?.[0] || "") || 1;

        // Extract evaluation type and score
        const scoreMatches = log.match(/ score (cp|mate) (-?\d+)/);

        const evaluationType = uciEvaluationTypes[scoreMatches?.[1] || ""];
        if (!evaluationType) return;

        let evaluationScore = parseInt(scoreMatches?.[2] || "");
        if (isNaN(evaluationScore)) return;

        // Make sure evaluations are always from White's view
        if (this.position.includes(" b ")) {
            evaluationScore = -evaluationScore;
        }

        return {
            depth: depth,
            index: index,
            evaluation: {
                type: evaluationType,
                value: evaluationScore
            },
            moveUcis: log.match(/ pv (.*)/)?.at(1)?.split(" ") || []
        };
    }

    private createEngineLine(parsedLine: ParsedInfoLine): EngineLine {
        // Convert UCI moves to SANs on a temp board
        const board = new Chess(this.position);

        return {
            depth: parsedLine.depth,
            index: parsedLine.index,
            evaluation: parsedLine.evaluation,
            source: this.version,
            moves: parsedLine.moveUcis.map(moveUci => ({
                uci: moveUci,
                // Move objects avoid matching against every legal SAN
                san: board.move({
                    from: moveUci.slice(0, 2),
                    to: moveUci.slice(2, 4),
                    promotion: moveUci.slice(4) || undefined
                }).san
            }))
        };
    }

    onMessage(handler: (message: string) => void) {
        this.worker.addEventListener("message", event => {
            handler(String(event.data));
        });

        return this;
    }

    onError(handler: (error: string) => void) {
        this.worker.addEventListener("error", event => {
            handler(String(event.error));
        });

        return this;
    }

    terminate() {
        this.worker.postMessage("quit");
        this.worker.terminate();
    }

    setOption(option: string, value: string) {
        this.worker.postMessage(
            `setoption name ${option} value ${value}`
        );

        return this;
    }

    setLineCount(lines: number) {
        if (lines == this.lineCount) return this;

        this.setOption("MultiPV", lines.toString());
        this.lineCount = lines;

        return this;
    }

    setThreadCount(threads: number) {
        this.setOption("Threads", threads.toString());

        return this;
    }

    setHashSize(megabytes: number) {
        this.setOption("Hash", megabytes.toString());

        return this;
    }

    async waitUntilReady() {
        await this.consumeLogs("isready", log => log == "readyok");

        return this;
    }

    /**
     * @description Sets the position to evaluate. If the FEN resulting from
     * the moves is already known, passing it skips replaying the moves.
     */
    setPosition(fen: string, uciMoves?: string[], resultingFen?: string) {
        if (uciMoves?.length) {
            this.worker.postMessage(
                `position fen ${fen} moves ${uciMoves.join(" ")}`
            );

            if (resultingFen) {
                this.position = resultingFen;
                return this;
            }

            const board = new Chess(fen);
            for (const uciMove of uciMoves) {
                board.move(uciMove);
            }

            this.position = board.fen();

            return this;
        }

        this.worker.postMessage(`position fen ${fen}`);
        this.position = fen;

        return this;
    }

    /**
     * @description Evaluates the current position. Returns the deepest
     * complete set of lines found. Lines are only converted and streamed
     * individually when `onEngineLine` is given.
     */
    async evaluate(options: {
        depth: number;
        timeLimit?: number;
        nodeLimit?: number;
        onEngineLine?: (line: EngineLine) => void;
    }): Promise<EngineLine[]> {
        // Latest parsed line for each depth and multipv index
        const parsedLines = new Map<string, ParsedInfoLine>();

        const maxTimeArgument = options.timeLimit
            ? ` movetime ${options.timeLimit}` : "";

        const maxNodesArgument = options.nodeLimit
            ? ` nodes ${options.nodeLimit}` : "";

        this.evaluating = true;

        await this.consumeLogs(
            `go depth ${options.depth}${maxTimeArgument}${maxNodesArgument}`,
            log => log.startsWith("bestmove"),
            log => {
                const parsedLine = this.parseInfoLine(log);
                if (!parsedLine) return;

                parsedLines.set(
                    `${parsedLine.depth}:${parsedLine.index}`,
                    parsedLine
                );

                if (options.onEngineLine) {
                    options.onEngineLine(this.createEngineLine(parsedLine));
                }
            }
        );

        this.evaluating = false;

        return this.getFinalLineSet([...parsedLines.values()]);
    }

    /**
     * @description From all lines of a search, picks the deepest set that
     * includes every line index. A search stopped by a time limit can end
     * part way through its final depth, leaving it incomplete.
     */
    private getFinalLineSet(parsedLines: ParsedInfoLine[]) {
        const lineCount = Math.max(0, ...parsedLines.map(line => line.index));

        const depths = [...new Set(parsedLines.map(line => line.depth))]
            .sort((a, b) => b - a);

        let finalLines: ParsedInfoLine[] = [];

        for (const depth of depths) {
            const depthLines = parsedLines.filter(line => line.depth == depth);

            if (depthLines.length > finalLines.length) {
                finalLines = depthLines;
            }

            if (finalLines.length >= lineCount) break;
        }

        return finalLines
            .sort((a, b) => a.index - b.index)
            .map(line => this.createEngineLine(line));
    }

    async stopEvaluation() {
        this.worker.postMessage("stop");

        if (this.evaluating) {
            await this.consumeLogs(
                "", log => log.includes("bestmove")
            );
        }

        this.evaluating = false;
    }
}

export default Engine;
