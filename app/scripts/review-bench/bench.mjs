// Evaluates and classifies a corpus of games with either the current
// pipeline or the one at a git revision, recording timings and results.
//
// Usage (from app/):
//   npm run bench:review -- --corpus <corpus.json> --out <results.json>
//     [--pipeline current|baseline] [--baseline-ref HEAD] [--engines N]
//     [--depth 16] [--games N] [--parallel N] [--no-selective]
//     [--node-limit N]
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import os from "node:os";
import path from "node:path";

import { workerStats } from "./workerShim.mjs";

const { values: args } = parseArgs({
    options: {
        corpus: { type: "string" },
        out: { type: "string" },
        pipeline: { type: "string", default: "current" },
        "baseline-ref": { type: "string", default: "HEAD" },
        engines: { type: "string" },
        depth: { type: "string", default: "16" },
        games: { type: "string" },
        parallel: { type: "string", default: "1" },
        "node-limit": { type: "string" },
        "no-selective": { type: "boolean", default: false }
    }
});

const appRoot = fileURLToPath(new URL("../../", import.meta.url));
const baselineRoot = path.join(appRoot, "scripts/review-bench/.baseline");

// Copies the evaluation and reporter sources of a git revision
function extractBaseline(ref) {
    rmSync(baselineRoot, { recursive: true, force: true });

    const sources = {
        "engine.ts": "app/src/client/apps/features/analysis/lib/engine.ts",
        "evaluate.ts": "app/src/client/apps/features/analysis/lib/evaluate.ts",
        "cloudEvaluate.ts": "app/src/client/apps/features/analysis/lib/cloudEvaluate.ts"
    };

    const reporterFiles = execFileSync("git", [
        "ls-tree", "-r", "--name-only", "--full-name", ref, "src/shared/lib/reporter"
    ], { cwd: appRoot, encoding: "utf8" }).trim().split("\n");

    for (const file of reporterFiles) {
        const target = file.replace("app/src/shared/lib/", "");
        sources[target] = file;
    }

    for (const [ target, source ] of Object.entries(sources)) {
        const targetPath = path.join(baselineRoot, target);
        mkdirSync(path.dirname(targetPath), { recursive: true });

        writeFileSync(targetPath, execFileSync("git", [
            "show", `${ref}:${source}`
        ], { cwd: appRoot }));
    }
}

const isBaseline = args.pipeline == "baseline";

if (isBaseline) extractBaseline(args["baseline-ref"]);

// Cloud evaluations are left out so both pipelines do the same engine work
globalThis.fetch = async () => {
    throw new Error("network disabled in benchmark");
};

const { default: EngineVersion } = await import(
    "../../src/shared/constants/EngineVersion.ts"
);
const { default: parsePgn } = await import(
    "../../src/client/lib/games/pgn.ts"
);
const { default: parseStateTree } = await import(
    "../../src/shared/lib/stateTree/parse.ts"
);
const {
    getNodeChain,
    serializeNode,
    deserializeNode,
    stateTreeNodeSchema
} = await import("../../src/shared/types/game/position/StateTreeNode.ts");
const { pickEngineLines } = await import(
    "../../src/shared/types/game/position/EngineLine.ts"
);
const { getGameAnalysis } = isBaseline
    ? await import("./.baseline/reporter/report.ts")
    : await import("../../src/shared/lib/reporter/report.ts");
const { default: createGameEvaluator } = isBaseline
    ? await import("./.baseline/evaluate.ts")
    : await import("../../src/client/apps/features/analysis/lib/evaluate.ts");

const corpus = JSON.parse(readFileSync(args.corpus, "utf8"))
    .slice(0, args.games ? parseInt(args.games) : undefined);

const depth = parseInt(args.depth);

const defaultEngineCount = isBaseline
    ? 4 : Math.min(Math.max(os.availableParallelism() - 1, 1), 8);

const engineCount = args.engines
    ? parseInt(args.engines) : defaultEngineCount;

async function evaluateGame(entry) {
    const game = parsePgn(entry.pgn);
    const analysedGame = { ...game, stateTree: parseStateTree(game) };

    const statsBefore = { ...workerStats };
    const cpuBefore = process.cpuUsage();
    const evaluationStart = performance.now();

    const evaluator = isBaseline
        ? createGameEvaluator(analysedGame, {
            engineVersion: EngineVersion.STOCKFISH_19_LITE,
            engineDepth: depth,
            cloudEngineLines: 2,
            maxEngineCount: engineCount,
            engineConfig: engine => engine.setLineCount(2)
        })
        : createGameEvaluator(analysedGame, {
            engineVersion: EngineVersion.STOCKFISH_19_LITE,
            engineDepth: depth,
            engineLines: 2,
            maxEngineCount: engineCount,
            engineHashSize: 32,
            engineNodeLimit: args["node-limit"]
                ? parseInt(args["node-limit"]) : undefined,
            selectiveSecondLine: !args["no-selective"],
            cloudEvaluation: false,
            classificationOptions: {}
        });

    await evaluator.evaluate();

    const evaluationMs = performance.now() - evaluationStart;
    const cpu = process.cpuUsage(cpuBefore);

    // The baseline classifies on the server, which needs the tree sent
    // there and back; the current pipeline classifies in place
    const classificationStart = performance.now();

    let stateTree = analysedGame.stateTree;

    if (isBaseline) {
        const request = JSON.stringify(serializeNode(stateTree));

        const received = JSON.parse(request);
        stateTreeNodeSchema.safeParse(received);

        const analysis = getGameAnalysis(deserializeNode(received));

        const response = JSON.stringify({
            ...analysis,
            stateTree: serializeNode(analysis.stateTree)
        });

        stateTree = deserializeNode(JSON.parse(response).stateTree, stateTree);
    } else {
        getGameAnalysis(stateTree);
    }

    const classificationMs = performance.now() - classificationStart;

    const nodes = getNodeChain(stateTree).map(node => ({
        fen: node.state.fen,
        move: node.state.move?.uci,
        classification: node.state.classification,
        accuracy: node.state.accuracy,
        // The lines the classifier reads, as they were sent to the server
        lines: (pickEngineLines(node.state.fen, node.state.engineLines) || [])
            .slice(0, 2)
            .map(line => ({
                depth: line.depth,
                index: line.index,
                evaluation: line.evaluation,
                source: line.source,
                moves: line.moves.slice(0, 1)
            }))
    }));

    return {
        id: entry.id,
        rating: entry.rating,
        plies: nodes.length - 1,
        evaluationMs,
        mainThreadCpuMs: (cpu.user + cpu.system) / 1000,
        classificationMs,
        searches: workerStats.searches - statsBefore.searches,
        multiPvSearches: (
            workerStats.multiPvSearches - statsBefore.multiPvSearches
        ),
        nodes
    };
}

const results = [];
const parallel = parseInt(args.parallel);
const benchStart = performance.now();

let nextGame = 0;

await Promise.all(Array.from({ length: parallel }, async () => {
    while (nextGame < corpus.length) {
        const entry = corpus[nextGame++];
        const result = await evaluateGame(entry);

        results.push(result);

        console.log(
            `[${results.length}/${corpus.length}] ${entry.id} `
            + `${result.plies} plies ${(result.evaluationMs / 1000).toFixed(1)}s`
        );
    }
}));

const corpusOrder = corpus.map(entry => entry.id);

writeFileSync(args.out, JSON.stringify({
    pipeline: isBaseline ? `baseline (${args["baseline-ref"]})` : "current",
    selectiveSecondLine: !isBaseline && !args["no-selective"],
    nodeLimit: args["node-limit"] ? parseInt(args["node-limit"]) : undefined,
    engineCount,
    depth,
    parallel,
    cpuCount: os.availableParallelism(),
    totalMs: performance.now() - benchStart,
    games: results.sort((a, b) => (
        corpusOrder.indexOf(a.id) - corpusOrder.indexOf(b.id)
    ))
}));

console.log(`done in ${((performance.now() - benchStart) / 1000).toFixed(0)}s`);
process.exit(0);
