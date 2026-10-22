// Evaluates every position of a corpus with a much larger search than a
// game review uses (two lines, a fixed node budget) and classifies the
// moves with them, producing a reference to compare pipelines against.
//
// Usage (from app/):
//   node --import ./scripts/review-bench/register.mjs \
//     scripts/review-bench/reference.mjs --corpus <corpus.json> \
//     --out <reference.json> [--nodes 3000000] [--engines N]
import { writeFileSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import os from "node:os";

import "./workerShim.mjs";

const { values: args } = parseArgs({
    options: {
        corpus: { type: "string" },
        out: { type: "string" },
        nodes: { type: "string", default: "3000000" },
        engines: { type: "string" },
        games: { type: "string" }
    }
});

const { default: EngineVersion } = await import(
    "../../src/shared/constants/EngineVersion.ts"
);
const { default: Engine } = await import(
    "../../src/client/apps/features/analysis/lib/engine.ts"
);
const { default: parsePgn } = await import(
    "../../src/client/lib/games/pgn.ts"
);
const { default: parseStateTree } = await import(
    "../../src/shared/lib/stateTree/parse.ts"
);
const { getNodeChain } = await import(
    "../../src/shared/types/game/position/StateTreeNode.ts"
);
const { getGameAnalysis } = await import(
    "../../src/shared/lib/reporter/report.ts"
);

const corpus = JSON.parse(readFileSync(args.corpus, "utf8"))
    .slice(0, args.games ? parseInt(args.games) : undefined);

const nodeLimit = parseInt(args.nodes);
const engineCount = parseInt(args.engines || String(os.availableParallelism()));

const games = corpus.map(entry => {
    const game = parsePgn(entry.pgn);
    const stateTree = parseStateTree(game);

    return { entry, game, stateTree, nodes: getNodeChain(stateTree) };
});

// Positions of each game from last to first, so engines reuse their hash
const jobs = games.flatMap(game => game.nodes
    .map((node, index) => ({ game, index }))
    .reverse()
);

const totalJobs = jobs.length;
const start = performance.now();

let completed = 0;

await Promise.all(Array.from({ length: engineCount }, async () => {
    const engine = new Engine(EngineVersion.STOCKFISH_19_LITE);

    engine.setHashSize(64);
    engine.setLineCount(2);
    await engine.waitUntilReady();

    while (jobs.length > 0) {
        const { game, index } = jobs.shift();
        const node = game.nodes[index];

        engine.setPosition(
            game.game.initialPosition,
            game.nodes.slice(1, index + 1).map(node => node.state.move.uci),
            node.state.fen
        );

        node.state.engineLines = await engine.evaluate({
            depth: 245,
            nodeLimit: nodeLimit
        });

        if (++completed % 200 == 0) {
            const elapsed = (performance.now() - start) / 1000;

            console.log(
                `${completed}/${totalJobs} positions, ${elapsed.toFixed(0)}s`
            );
        }
    }

    engine.terminate();
}));

const results = games.map(({ entry, stateTree, nodes }) => {
    getGameAnalysis(stateTree);

    return {
        id: entry.id,
        rating: entry.rating,
        plies: nodes.length - 1,
        evaluationMs: 0,
        mainThreadCpuMs: 0,
        classificationMs: 0,
        searches: nodes.length,
        multiPvSearches: nodes.length,
        nodes: nodes.map(node => ({
            fen: node.state.fen,
            move: node.state.move?.uci,
            classification: node.state.classification,
            accuracy: node.state.accuracy,
            lines: node.state.engineLines.slice(0, 2).map(line => ({
                depth: line.depth,
                index: line.index,
                evaluation: line.evaluation,
                source: line.source,
                moves: line.moves.slice(0, 1)
            }))
        }))
    };
});

writeFileSync(args.out, JSON.stringify({
    pipeline: `reference (${nodeLimit} nodes, 2 lines)`,
    engineCount,
    depth: 0,
    parallel: engineCount,
    cpuCount: os.availableParallelism(),
    totalMs: performance.now() - start,
    games: results
}));

console.log(`done in ${((performance.now() - start) / 1000).toFixed(0)}s`);
process.exit(0);
