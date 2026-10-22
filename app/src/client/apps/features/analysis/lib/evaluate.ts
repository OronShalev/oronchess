import { Chess } from "chess.js";
import { maxBy } from "lodash-es";

import AnalysedGame from "@shared/types/game/AnalysedGame";
import EngineVersion from "@shared/constants/EngineVersion";
import AnalysisOptions from "@shared/lib/reporter/types/AnalysisOptions";
import Evaluation from "@shared/types/game/position/Evaluation";
import { StateTreeNode, getNodeChain } from "@shared/types/game/position/StateTreeNode";
import {
    EngineLine,
    getLineGroupSibling,
    getTopEngineLine
} from "@shared/types/game/position/EngineLine";
import { mightUseSecondLine } from "@shared/lib/reporter/utils/secondLine";
import Engine from "@analysis/lib/engine";
import getCloudEvaluation from "./cloudEvaluate";
import { EvaluationCache, getEvaluationCacheKey } from "./evalCache";

interface EvaluateMovesOptions {
    engineVersion: EngineVersion;
    maxEngineCount?: number;
    engineHashSize?: number;
    engineDepth: number;
    engineTimeLimit?: number;
    /** Stops searches that need more nodes than this before reaching depth */
    engineNodeLimit?: number;
    engineLines: number;
    /**
     * With 2 engine lines, only search a second line in positions whose
     * classification can use it (critical and brilliant candidates).
     * Defaults to true.
     */
    selectiveSecondLine?: boolean;
    cloudEvaluation?: boolean;
    cache?: EvaluationCache;
    classificationOptions?: AnalysisOptions;
    engineConfig?: (engine: Engine) => void;
    onProgress?: (progress: number) => void;
    verbose?: boolean;
}

interface EvaluationProcess {
    evaluate: () => Promise<StateTreeNode[]>;
    controller: AbortController;
}

// Range of node indexes that one engine evaluates from first to last
interface Segment {
    start: number;
    end: number;
}

/**
 * @description Returns the evaluation of a position with one legal move
 * from the evaluation of the position after it. Mates delivered by the
 * side to move take one move longer.
 */
function getForcedMoveEvaluation(
    nextEvaluation: Evaluation,
    whiteToMove: boolean
): Evaluation {
    if (nextEvaluation.type != "mate") return nextEvaluation;

    // The only move delivers checkmate
    if (nextEvaluation.value == 0) {
        return { type: "mate", value: whiteToMove ? 1 : -1 };
    }

    const sideToMoveMates = (nextEvaluation.value > 0) == whiteToMove;

    return {
        type: "mate",
        value: sideToMoveMates
            ? nextEvaluation.value + Math.sign(nextEvaluation.value)
            : nextEvaluation.value
    };
}

/**
 * @description Returns a node limit for searches of a given depth. It is
 * far above what such a search normally needs, and only stops the rare
 * searches that explode, which are almost all in decided positions.
 */
export function getSearchNodeLimit(depth: number) {
    return Math.round(2_000_000 * Math.pow(1.6, depth - 16));
}

function createGameEvaluator(
    game: AnalysedGame,
    options: EvaluateMovesOptions
): EvaluationProcess {
    const controller = new AbortController();

    const stateTreeNodes = getNodeChain(game.stateTree);
    const nodeCount = stateTreeNodes.length;

    const selectiveSecondLine = options.engineLines == 2
        && options.selectiveSecondLine != false;

    const searchLineCount = selectiveSecondLine ? 1 : options.engineLines;

    const playedUciMoves = stateTreeNodes
        .filter(node => node.state.move)
        .map(node => node.state.move!.uci);

    // Index of node evaluation progress
    const claimed: boolean[] = new Array(nodeCount).fill(false);
    const evaluated: boolean[] = new Array(nodeCount).fill(false);
    const secondLineChecked: boolean[] = new Array(nodeCount).fill(false);

    // Parent node indexes awaiting a second line search
    const secondLineQueue: number[] = [];

    let evaluatedCount = 0;
    let cloudStopped = !options.cloudEvaluation;

    // Lines are only reused under the same engine settings
    const cacheKeys = stateTreeNodes.map((node, index) => getEvaluationCacheKey(
        node.state.fen,
        stateTreeNodes.slice(0, index).map(previous => previous.state.fen),
        {
            engine: options.engineVersion,
            depth: options.engineDepth,
            timeLimit: options.engineTimeLimit,
            nodeLimit: options.engineNodeLimit,
            lines: options.engineLines,
            selectiveSecondLine: selectiveSecondLine
        }
    ));

    function getEngineCount() {
        return Math.max(1, Math.min(options.maxEngineCount || 1, nodeCount));
    }

    function setNodeLines(index: number, lines: EngineLine[]) {
        const node = stateTreeNodes[index];

        node.state.engineLines = [
            ...node.state.engineLines.filter(
                line => line.source != lines.at(0)?.source
            ),
            ...lines
        ];
    }

    /**
     * @description Marks a node as evaluated. Returns whether a second
     * line is needed for it as a parent, so that the caller can search
     * it while its hash is still warm.
     */
    function completeNode(index: number, lines: EngineLine[]) {
        setNodeLines(index, lines);

        evaluated[index] = true;
        evaluatedCount++;

        options.onProgress?.(evaluatedCount / nodeCount);

        // As a child, its parent may now be checkable
        if (index > 0 && needsSecondLine(index - 1)) {
            secondLineQueue.push(index - 1);
        }

        return needsSecondLine(index);
    }

    function needsSecondLine(parentIndex: number) {
        if (!selectiveSecondLine) return false;
        if (parentIndex + 1 >= nodeCount) return false;
        if (secondLineChecked[parentIndex]) return false;

        if (!evaluated[parentIndex] || !evaluated[parentIndex + 1]) {
            return false;
        }

        secondLineChecked[parentIndex] = true;

        // Cached lines may already include a second line
        const parentLines = stateTreeNodes[parentIndex].state.engineLines;
        const topLine = getTopEngineLine(parentLines);

        if (topLine && getLineGroupSibling(parentLines, topLine, 2)) {
            return false;
        }

        return mightUseSecondLine(
            stateTreeNodes[parentIndex + 1],
            options.classificationOptions
        );
    }

    function setEnginePosition(engine: Engine, index: number) {
        engine.setPosition(
            game.initialPosition,
            playedUciMoves.slice(0, index),
            stateTreeNodes[index].state.fen
        );
    }

    async function search(engine: Engine, index: number) {
        setEnginePosition(engine, index);

        return await engine.evaluate({
            depth: options.engineDepth,
            timeLimit: options.engineTimeLimit
                ? options.engineTimeLimit * 1000
                : undefined,
            nodeLimit: options.engineNodeLimit
        });
    }

    /**
     * @description Returns lines for positions that need no search, like
     * those with no legal moves or only one legal move.
     */
    function getTrivialLines(index: number): EngineLine[] | undefined {
        const fen = stateTreeNodes[index].state.fen;
        const board = new Chess(fen);
        const legalMoves = board.moves({ verbose: true });

        const lineSource = options.engineVersion;

        // Engines report depth 0 for positions with no legal moves
        if (legalMoves.length == 0) {
            return [{
                depth: 0,
                index: 1,
                evaluation: board.isCheckmate()
                    ? { type: "mate", value: 0 }
                    : { type: "centipawn", value: 0 },
                source: lineSource,
                moves: []
            }];
        }

        // Positions with one legal move share the evaluation of the next
        if (legalMoves.length == 1 && evaluated[index + 1]) {
            const forcedMove = legalMoves[0];
            const nextNode = stateTreeNodes[index + 1];

            if (nextNode.state.move?.uci != forcedMove.lan) return;

            const nextTopLine = getTopEngineLine(nextNode.state.engineLines);
            if (!nextTopLine) return;

            return [{
                depth: nextTopLine.depth,
                index: 1,
                evaluation: getForcedMoveEvaluation(
                    nextTopLine.evaluation, board.turn() == "w"
                ),
                source: nextTopLine.source,
                moves: [
                    { san: forcedMove.san, uci: forcedMove.lan },
                    ...nextTopLine.moves
                ]
            }];
        }
    }

    /**
     * @description Searches a parent node again with two lines, replacing
     * its lines, so that both come from the same search as they would
     * with two lines everywhere.
     */
    async function searchSecondLine(engine: Engine, index: number) {
        engine.setLineCount(2);
        const lines = await search(engine, index);
        engine.setLineCount(searchLineCount);

        stateTreeNodes[index].state.engineLines = lines;
    }

    // Each engine walks a contiguous segment of the game forwards, so a
    // position is searched before the one after it: its choice of best
    // move is not swayed by a search of the move played, while the next
    // search reuses its transposition table entries
    const segments: Segment[] = [];

    function claimNextIndex(segment: Segment): number | undefined {
        while (segment.start <= segment.end) {
            const index = segment.start++;

            if (!claimed[index]) {
                claimed[index] = true;
                return index;
            }
        }

        // Take the later half of the largest remaining segment
        const largestSegment = maxBy(
            segments.filter(other => other.end > other.start),
            other => other.end - other.start
        );

        if (!largestSegment) return;

        const middle = Math.ceil(
            (largestSegment.start + largestSegment.end) / 2
        );

        segment.start = middle;
        segment.end = largestSegment.end;
        largestSegment.end = middle - 1;

        return claimNextIndex(segment);
    }

    async function runEngine(engine: Engine, segment: Segment) {
        while (!controller.signal.aborted) {
            const queuedIndex = secondLineQueue.shift();

            if (queuedIndex != undefined) {
                await searchSecondLine(engine, queuedIndex);
                continue;
            }

            const index = claimNextIndex(segment);
            if (index == undefined) return;

            const lines = getTrivialLines(index)
                || await search(engine, index);

            if (controller.signal.aborted) return;

            if (completeNode(index, lines)) {
                await searchSecondLine(engine, index);
            }
        }
    }

    async function loadCachedEvaluations() {
        if (!options.cache) return;

        const cachedLines = await Promise.all(cacheKeys.map(key => (
            key ? options.cache!.get(key) : undefined
        )));

        cachedLines.forEach((lines, index) => {
            if (!lines?.length || claimed[index]) return;

            claimed[index] = true;

            if (completeNode(index, lines)) {
                secondLineQueue.push(index);
            }
        });
    }

    function saveEvaluations() {
        if (!options.cache) return;

        const entries: [string, EngineLine[]][] = [];

        stateTreeNodes.forEach((node, index) => {
            const key = cacheKeys[index];
            if (!key || node.state.engineLines.length == 0) return;

            entries.push([key, node.state.engineLines]);
        });

        options.cache.setMany(entries);
    }

    // Fills evaluations from the start of the game with cloud evaluations
    // for as long as they are available, while engines work on the rest
    async function runCloudEvaluation() {
        for (let index = 0; index < nodeCount; index++) {
            if (cloudStopped || claimed[index]) return;

            try {
                var cloudEngineLines = await getCloudEvaluation(
                    stateTreeNodes[index].state.fen, searchLineCount
                );
            } catch {
                return;
            }

            const topCloudLine = getTopEngineLine(cloudEngineLines);
            if (!topCloudLine) return;

            if (topCloudLine.depth < options.engineDepth) return;
            if (cloudEngineLines.length < searchLineCount) return;

            if (cloudStopped || claimed[index]) return;

            claimed[index] = true;

            if (completeNode(index, cloudEngineLines)) {
                secondLineQueue.push(index);
            }
        }
    }

    async function evaluator(): Promise<StateTreeNode[]> {
        const engineCount = getEngineCount();

        const engines: Engine[] = [];

        // Opening positions are left to cloud evaluations at first;
        // engines take what remains of them once their segments are done
        const cloudReserve = options.cloudEvaluation
            ? Math.min(16, Math.floor(nodeCount / 4)) : 0;

        const engineNodeCount = nodeCount - cloudReserve;

        // Divide the rest of the game into one segment per engine
        for (let i = 0; i < engineCount; i++) {
            segments.push({
                start: cloudReserve + Math.floor(i * engineNodeCount / engineCount),
                end: cloudReserve + Math.floor((i + 1) * engineNodeCount / engineCount) - 1
            });
        }

        if (cloudReserve > 0) {
            segments.push({ start: 0, end: cloudReserve - 1 });
        }

        const abortPromise = new Promise<never>((res, rej) => {
            controller.signal.addEventListener("abort", () => rej("abort"));
        });

        abortPromise.catch(() => {});

        try {
            for (let i = 0; i < engineCount; i++) {
                const engine = new Engine(options.engineVersion);
                engines.push(engine);

                if (options.engineHashSize) {
                    engine.setHashSize(options.engineHashSize);
                }

                engine.setLineCount(searchLineCount);
                options.engineConfig?.(engine);

                if (options.verbose) {
                    engine.onMessage(console.log);
                }
            }

            const engineErrorPromise = new Promise<never>((res, rej) => {
                engines.forEach(engine => engine.onError(rej));
            });

            engineErrorPromise.catch(() => {});

            await Promise.race([
                Promise.all([
                    ...engines.map(engine => engine.waitUntilReady()),
                    loadCachedEvaluations()
                ]),
                engineErrorPromise,
                abortPromise
            ]);

            const cloudEvaluation = runCloudEvaluation();

            // Engines run until every position is claimed, then until
            // all second line searches found as a result are done
            do {
                await Promise.race([
                    Promise.all(engines.map((engine, engineIndex) => (
                        runEngine(engine, segments[engineIndex])
                    ))),
                    engineErrorPromise,
                    abortPromise
                ]);

                cloudStopped = true;
            } while (secondLineQueue.length > 0);

            cloudEvaluation.catch(() => {});

            saveEvaluations();

            return stateTreeNodes;
        } finally {
            cloudStopped = true;
            engines.forEach(engine => engine.terminate());
        }
    }

    return { evaluate: evaluator, controller };
}

export default createGameEvaluator;
