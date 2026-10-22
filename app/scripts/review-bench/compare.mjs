// Compares benchmark results: label agreement against a baseline, measured
// against the baseline's own run to run noise, and evaluation timings.
//
// Usage: node compare.mjs --baseline <a.json> [--baseline2 <b.json>]
//          --candidate <c.json> [--markdown <report.md>]
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
    options: {
        baseline: { type: "string" },
        baseline2: { type: "string" },
        candidate: { type: "string" },
        markdown: { type: "string" }
    }
});

const load = file => file && JSON.parse(readFileSync(file, "utf8"));

const baseline = load(args.baseline);
const baseline2 = load(args.baseline2);
const candidate = load(args.candidate);

const specialLabels = ["brilliant", "critical"];

const output = [];
const print = (line = "") => output.push(line);

// Classifications of each move keyed by game id and ply
function getLabels(results) {
    const labels = new Map();

    for (const game of results.games) {
        game.nodes.forEach((node, ply) => {
            if (ply > 0) labels.set(`${game.id}:${ply}`, node.classification);
        });
    }

    return labels;
}

function getAgreement(labelsA, labelsB) {
    let same = 0, total = 0;

    for (const [ key, label ] of labelsA) {
        if (!labelsB.has(key)) continue;

        total++;
        if (labelsB.get(key) == label) same++;
    }

    return { same, total, rate: same / total };
}

function getPositives(labels, label) {
    return new Set(
        [...labels].filter(([, value]) => value == label).map(([key]) => key)
    );
}

function getPlayerAccuracies(results) {
    const accuracies = new Map();

    for (const game of results.games) {
        for (const colour of [0, 1]) {
            const moveAccuracies = game.nodes
                .filter((node, ply) => ply > 0 && (ply - 1) % 2 == colour)
                .map(node => node.accuracy)
                .filter(accuracy => accuracy != undefined);

            if (moveAccuracies.length == 0) continue;

            accuracies.set(
                `${game.id}:${colour}`,
                moveAccuracies.reduce((a, b) => a + b, 0) / moveAccuracies.length
            );
        }
    }

    return accuracies;
}

function getMeanAccuracyDifference(resultsA, resultsB) {
    const accuraciesA = getPlayerAccuracies(resultsA);
    const accuraciesB = getPlayerAccuracies(resultsB);

    const differences = [...accuraciesA]
        .filter(([key]) => accuraciesB.has(key))
        .map(([key, value]) => Math.abs(value - accuraciesB.get(key)));

    return differences.reduce((a, b) => a + b, 0) / differences.length;
}

const percent = value => (value * 100).toFixed(2) + "%";
const seconds = ms => (ms / 1000).toFixed(1) + "s";

const median = values => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
};

const baselineLabels = getLabels(baseline);
const baseline2Labels = baseline2 && getLabels(baseline2);
const candidateLabels = getLabels(candidate);

print("## Label agreement");
print();
print("| Comparison | Agreeing moves | Rate |");
print("|---|---|---|");

if (baseline2Labels) {
    const noise = getAgreement(baselineLabels, baseline2Labels);
    print(`| Baseline A vs baseline B (noise floor) | ${noise.same}/${noise.total} | ${percent(noise.rate)} |`);
}

const agreement = getAgreement(baselineLabels, candidateLabels);
print(`| Baseline A vs candidate | ${agreement.same}/${agreement.total} | ${percent(agreement.rate)} |`);

if (baseline2Labels) {
    const agreement2 = getAgreement(baseline2Labels, candidateLabels);
    print(`| Baseline B vs candidate | ${agreement2.same}/${agreement2.total} | ${percent(agreement2.rate)} |`);
}

print();
print("## Brilliant and critical moves");
print();
print("Stable positives are moves with the label in every baseline run. Flicker is the number of moves with the label in exactly one baseline run.");
print();
print("| Label | Baseline A | Baseline B | Candidate | Stable | Stable found by candidate | Baseline flicker | Candidate only |");
print("|---|---|---|---|---|---|---|---|");

for (const label of specialLabels) {
    const positivesA = getPositives(baselineLabels, label);
    const positivesB = baseline2Labels
        ? getPositives(baseline2Labels, label) : positivesA;
    const positivesCandidate = getPositives(candidateLabels, label);

    const stable = [...positivesA].filter(key => positivesB.has(key));
    const found = stable.filter(key => positivesCandidate.has(key));

    const flicker = [...positivesA].filter(key => !positivesB.has(key)).length
        + [...positivesB].filter(key => !positivesA.has(key)).length;

    const candidateOnly = [...positivesCandidate].filter(
        key => !positivesA.has(key) && !positivesB.has(key)
    );

    print(`| ${label} | ${positivesA.size} | ${baseline2Labels ? positivesB.size : "-"} | ${positivesCandidate.size} | ${stable.length} | ${found.length} (${percent(found.length / (stable.length || 1))}) | ${baseline2Labels ? flicker : "-"} | ${candidateOnly.length} |`);
}

print();
print("## Label counts");
print();

const allLabels = [...new Set([
    ...baselineLabels.values(), ...candidateLabels.values()
])].map(String).sort();

print(`| Label | Baseline A |${baseline2Labels ? " Baseline B |" : ""} Candidate |`);
print(`|---|---|${baseline2Labels ? "---|" : ""}---|`);

for (const label of allLabels) {
    const count = labels => [...labels.values()].filter(value => String(value) == label).length;

    print(`| ${label} | ${count(baselineLabels)} |${baseline2Labels ? ` ${count(baseline2Labels)} |` : ""} ${count(candidateLabels)} |`);
}

print();
print("## Confusion matrix (rows: baseline A, columns: candidate)");
print();
print(`| | ${allLabels.join(" | ")} |`);
print(`|---|${allLabels.map(() => "---").join("|")}|`);

for (const rowLabel of allLabels) {
    const cells = allLabels.map(columnLabel => [...baselineLabels].filter(
        ([key, value]) => String(value) == rowLabel
            && String(candidateLabels.get(key)) == columnLabel
    ).length);

    print(`| ${rowLabel} | ${cells.join(" | ")} |`);
}

print();
print("## Player accuracy");
print();

if (baseline2) {
    print(`- Mean absolute difference, baseline A vs B: ${getMeanAccuracyDifference(baseline, baseline2).toFixed(3)} points`);
}

print(`- Mean absolute difference, baseline A vs candidate: ${getMeanAccuracyDifference(baseline, candidate).toFixed(3)} points`);

print();
print("## Evaluation work and time");
print();
print("| Run | Engines | Games in parallel | Total eval time | Mean per game | Median per game | Searches per ply | Second line searches per ply | Main thread CPU per game | Classification per game |");
print("|---|---|---|---|---|---|---|---|---|---|");

for (const [ name, results ] of [
    ["Baseline A", baseline],
    ["Baseline B", baseline2],
    ["Candidate", candidate]
]) {
    if (!results) continue;

    const games = results.games;
    const sum = key => games.reduce((total, game) => total + game[key], 0);
    const plies = sum("plies");

    const secondLineSearches = sum("multiPvSearches");

    // Search counts and CPU time are per process, so games evaluated
    // in parallel cannot be told apart
    const perGame = (value) => results.parallel == 1 ? value : "-";

    print(`| ${name} | ${results.engineCount} | ${results.parallel} | ${seconds(sum("evaluationMs"))} | ${seconds(sum("evaluationMs") / games.length)} | ${seconds(median(games.map(game => game.evaluationMs)))} | ${perGame((sum("searches") / plies).toFixed(2))} | ${perGame((secondLineSearches / plies).toFixed(2))} | ${perGame((sum("mainThreadCpuMs") / games.length).toFixed(0) + "ms")} | ${(sum("classificationMs") / games.length).toFixed(1)}ms |`);
}

const candidateTimes = new Map(
    candidate.games.map(game => [game.id, game.evaluationMs])
);

const speedups = baseline.games
    .filter(game => candidateTimes.has(game.id))
    .map(game => game.evaluationMs / candidateTimes.get(game.id));

if (baseline.parallel == 1 && candidate.parallel == 1) {
    print();
    print(`Per game speedup (baseline A time / candidate time): median ${median(speedups).toFixed(2)}x, total ${(baseline.games.reduce((t, g) => t + g.evaluationMs, 0) / candidate.games.reduce((t, g) => t + g.evaluationMs, 0)).toFixed(2)}x.`);
}

const report = output.join("\n");

console.log(report);

if (args.markdown) writeFileSync(args.markdown, report + "\n");
