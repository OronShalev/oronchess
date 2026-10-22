// Replays recorded engine lines through the classifier, without engines:
// - the reporter at a git revision and the current reporter must agree
//   on every classification and accuracy;
// - the second line gate must select the parent of every move that the
//   recorded lines classify as brilliant or critical.
//
// Usage (from app/):
//   node --import ./scripts/review-bench/register.mjs \
//     scripts/review-bench/replay.mjs --results <results.json> [--ref HEAD]
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import path from "node:path";
import { Chess } from "chess.js";

const { values: args } = parseArgs({
    options: {
        results: { type: "string" },
        ref: { type: "string", default: "HEAD" }
    }
});

const appRoot = fileURLToPath(new URL("../../", import.meta.url));
const baselineRoot = path.join(appRoot, "scripts/review-bench/.baseline");

rmSync(path.join(baselineRoot, "reporter"), { recursive: true, force: true });

const reporterFiles = execFileSync("git", [
    "ls-tree", "-r", "--name-only", "--full-name", args.ref,
    "src/shared/lib/reporter"
], { cwd: appRoot, encoding: "utf8" }).trim().split("\n");

for (const file of reporterFiles) {
    const targetPath = path.join(
        baselineRoot, file.replace("app/src/shared/lib/", "")
    );

    mkdirSync(path.dirname(targetPath), { recursive: true });

    writeFileSync(targetPath, execFileSync("git", [
        "show", `${args.ref}:${file}`
    ], { cwd: appRoot }));
}

const { getGameAnalysis: getBaselineAnalysis } = await import(
    "./.baseline/reporter/report.ts"
);
const { getGameAnalysis } = await import(
    "../../src/shared/lib/reporter/report.ts"
);
const { mightUseSecondLine } = await import(
    "../../src/shared/lib/reporter/utils/secondLine.ts"
);
const { getNodeChain } = await import(
    "../../src/shared/types/game/position/StateTreeNode.ts"
);

const results = JSON.parse(readFileSync(args.results, "utf8"));

// Rebuilds a mainline state tree holding the recorded engine lines
function buildStateTree(game, lineCount = 2) {
    let parent;
    let root;

    for (const recordedNode of game.nodes) {
        let move;

        if (parent && recordedNode.move) {
            const playedMove = new Chess(parent.state.fen).move(recordedNode.move);
            move = { san: playedMove.san, uci: playedMove.lan };
        }

        const node = {
            id: String(Math.random()),
            mainline: true,
            parent: parent,
            children: [],
            state: {
                fen: recordedNode.fen,
                move: move,
                moveColour: move
                    ? (parent.state.fen.split(" ")[1] == "w" ? "white" : "black")
                    : undefined,
                engineLines: structuredClone(recordedNode.lines)
                    .slice(0, lineCount)
            }
        };

        // Recorded lines only hold the first move, which is all that
        // the classifier reads; give it the SAN as well
        for (const line of node.state.engineLines) {
            line.moves = line.moves.map(lineMove => {
                const parsed = new Chess(node.state.fen).move(lineMove.uci);
                return { san: parsed.san, uci: parsed.lan };
            });
        }

        if (parent) parent.children.push(node);

        root ||= node;
        parent = node;
    }

    return root;
}

let movesChecked = 0;
let classificationDifferences = 0;
let accuracyDifferences = 0;

let upgradedMoves = 0;
let upgradedMovesGated = 0;
let gatedMoves = 0;

for (const game of results.games) {
    const baselineNodes = getNodeChain(getBaselineAnalysis(buildStateTree(game)).stateTree);
    const currentNodes = getNodeChain(getGameAnalysis(buildStateTree(game)).stateTree);

    // Gate decisions only see the top line of each position
    const gateNodes = getNodeChain(buildStateTree(game, 1));

    for (let ply = 1; ply < currentNodes.length; ply++) {
        movesChecked++;

        const baselineState = baselineNodes[ply].state;
        const currentState = currentNodes[ply].state;

        if (baselineState.classification != currentState.classification) {
            classificationDifferences++;
        }

        if (baselineState.accuracy !== currentState.accuracy) {
            accuracyDifferences++;
        }

        const gated = mightUseSecondLine(gateNodes[ply]);
        if (gated) gatedMoves++;

        if (["brilliant", "critical"].includes(currentState.classification)) {
            upgradedMoves++;

            if (gated) {
                upgradedMovesGated++;
            } else {
                console.log(`not gated: ${game.id} ply ${ply} (${currentState.classification})`);
            }
        }
    }
}

console.log(`moves replayed: ${movesChecked}`);
console.log(`classification differences, ${args.ref} reporter vs current: ${classificationDifferences}`);
console.log(`accuracy differences, ${args.ref} reporter vs current: ${accuracyDifferences}`);
console.log(`brilliant or critical moves whose parent the gate selects: ${upgradedMovesGated}/${upgradedMoves}`);
console.log(`moves whose parent the gate selects: ${gatedMoves}/${movesChecked} (${(gatedMoves / movesChecked * 100).toFixed(1)}%)`);

process.exit(classificationDifferences || accuracyDifferences || upgradedMovesGated < upgradedMoves ? 1 : 0);
