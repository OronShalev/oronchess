import { Chess } from "chess.js";

import EngineVersion from "@shared/constants/EngineVersion";
import AnalysisOptions from "@shared/lib/reporter/types/AnalysisOptions";
import {
    StateTreeNode,
    getNodeParentChain
} from "@shared/types/game/position/StateTreeNode";
import { EngineLine, getTopEngineLine } from "@shared/types/game/position/EngineLine";
import Engine from "./engine";
import { getSearchNodeLimit } from "./evaluate";
import { EvaluationCache, getEvaluationCacheKey } from "./evalCache";
import { analyseNode } from "./reporter";

export interface MoveEvaluationSettings {
    engineVersion: EngineVersion;
    engineDepth: number;
    // Seconds
    engineTimeLimit?: number;
    // Lines searched in a game review, which this matches
    engineLines: number;
    classificationOptions?: AnalysisOptions;
}

export class MoveEvaluatorStoppedError extends Error {
    constructor() {
        super("the move evaluator was stopped.");
    }
}

/**
 * @description Evaluates and classifies moves played away from a reviewed
 * game, one at a time, searching as a game review does so that they are
 * judged alike. Searches are shared with reviews through the cache.
 */
class MoveEvaluator {
    private engine?: Engine;
    private engineVersion?: EngineVersion;
    private engineFailure?: Promise<never>;

    private queue: Promise<unknown> = Promise.resolve();
    private pending = new Map<StateTreeNode, Promise<boolean>>();

    private stopController = new AbortController();
    private stopped: Promise<never>;

    private cache?: EvaluationCache;

    constructor(cache?: EvaluationCache) {
        this.cache = cache;

        this.stopped = new Promise<never>((res, rej) => {
            this.stopController.signal.addEventListener(
                "abort", () => rej(new MoveEvaluatorStoppedError())
            );
        });

        this.stopped.catch(() => {});
    }

    /**
     * @description Classifies a move, searching its position first if it
     * has not been already. Returns whether a classification was found.
     */
    classify(node: StateTreeNode, settings: MoveEvaluationSettings) {
        if (node.state.classification) return Promise.resolve(true);

        const pending = this.pending.get(node);
        if (pending) return pending;

        const classification = this.queue.then(() => (
            this.evaluateAndClassify(node, settings)
        ));

        const forget = () => this.pending.delete(node);
        classification.then(forget, forget);

        this.queue = classification.catch(() => {});
        this.pending.set(node, classification);

        return classification;
    }

    isClassifying(node: StateTreeNode) {
        return this.pending.has(node);
    }

    stop() {
        this.stopController.abort();
        this.engine?.terminate();
        this.engine = undefined;
    }

    private async evaluateAndClassify(
        node: StateTreeNode,
        settings: MoveEvaluationSettings
    ) {
        if (this.stopController.signal.aborted) {
            throw new MoveEvaluatorStoppedError();
        }

        if (node.state.classification) return true;

        // Lines from as deep a search as a review's need no other
        const topLine = getTopEngineLine(node.state.engineLines);

        const searched = topLine && (
            topLine.depth == 0 || topLine.depth >= settings.engineDepth
        );

        if (!searched) {
            try {
                var lines = await this.getLines(node, settings);
            } catch (error) {
                // A failed engine is replaced for the next move
                if (!(error instanceof MoveEvaluatorStoppedError)) {
                    this.engine?.terminate();
                    this.engine = undefined;
                }

                throw error;
            }

            node.state.engineLines = [
                ...node.state.engineLines.filter(
                    line => line.source != lines.at(0)?.source
                ),
                ...lines
            ];
        }

        return analyseNode(node, settings.classificationOptions);
    }

    private async getLines(
        node: StateTreeNode,
        settings: MoveEvaluationSettings
    ): Promise<EngineLine[]> {
        const board = new Chess(node.state.fen);

        // Engines report depth 0 for positions with no legal moves
        if (board.moves().length == 0) return [{
            depth: 0,
            index: 1,
            evaluation: board.isCheckmate()
                ? { type: "mate", value: 0 }
                : { type: "centipawn", value: 0 },
            source: settings.engineVersion,
            moves: []
        }];

        // A review searches one line where it can add a second later
        const selectiveSecondLine = settings.engineLines == 2;
        const searchLineCount = selectiveSecondLine ? 1 : settings.engineLines;

        const nodeLimit = getSearchNodeLimit(settings.engineDepth);

        const previousNodes = getNodeParentChain(node).reverse().slice(0, -1);

        const cacheKey = getEvaluationCacheKey(
            node.state.fen,
            previousNodes.map(previous => previous.state.fen),
            {
                engine: settings.engineVersion,
                depth: settings.engineDepth,
                timeLimit: settings.engineTimeLimit,
                nodeLimit: nodeLimit,
                lines: settings.engineLines,
                selectiveSecondLine: selectiveSecondLine
            }
        );

        const cachedLines = cacheKey
            ? await this.cache?.get(cacheKey)
            : undefined;

        if (cachedLines?.length) return cachedLines;

        const engine = await this.getEngine(settings.engineVersion);

        engine.setLineCount(searchLineCount);

        // The moves to the position let the engine see repetitions
        engine.setPosition(
            previousNodes[0]?.state.fen || node.state.fen,
            previousNodes.slice(1)
                .concat(node)
                .map(previous => previous.state.move?.uci)
                .filter(uci => uci != undefined),
            node.state.fen
        );

        const lines = await Promise.race([
            engine.evaluate({
                depth: settings.engineDepth,
                timeLimit: settings.engineTimeLimit
                    ? settings.engineTimeLimit * 1000
                    : undefined,
                nodeLimit: nodeLimit
            }),
            this.engineFailure!,
            this.stopped
        ]);

        if (cacheKey && lines.length > 0) {
            this.cache?.setMany([[ cacheKey, lines ]]);
        }

        return lines;
    }

    private async getEngine(version: EngineVersion) {
        if (this.engine && this.engineVersion == version) {
            return this.engine;
        }

        this.engine?.terminate();

        const engine = new Engine(version);

        this.engine = engine;
        this.engineVersion = version;

        this.engineFailure = new Promise<never>((res, rej) => {
            engine.onError(rej);
        });

        this.engineFailure.catch(() => {});

        await Promise.race([
            engine.waitUntilReady(),
            this.engineFailure,
            this.stopped
        ]);

        return engine;
    }
}

export default MoveEvaluator;
