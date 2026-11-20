// Compares review accuracies with reference accuracies from another site,
// such as those of Chess.com's game review.
//
// 1. Build a corpus from a CSV whose columns are a game's PGN and the
//    reference accuracies of White and Black:
//      node scripts/review-bench/accuracy.mjs corpus <games.csv> <corpus.json>
// 2. Record engine lines for it:
//      npm run bench:review -- --corpus <corpus.json> --out <run.json>
// 3. Replay those lines through the current reporter and compare:
//      node --import ./scripts/review-bench/register.mjs \
//        scripts/review-bench/accuracy.mjs check <corpus.json> <run.json>
import { readFileSync, writeFileSync } from "node:fs";

const [ mode, firstPath, secondPath ] = process.argv.slice(2);

// Splits CSV text into rows of fields, allowing quoted fields that hold
// commas, doubled quotes and line breaks
function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;

    for (let index = 0; index < text.length; index++) {
        const character = text[index];

        if (quoted) {
            if (character == "\"" && text[index + 1] == "\"") {
                field += "\"";
                index++;
            } else if (character == "\"") {
                quoted = false;
            } else {
                field += character;
            }
        } else if (character == "\"") {
            quoted = true;
        } else if (character == ",") {
            row.push(field);
            field = "";
        } else if (character == "\n") {
            row.push(field);
            rows.push(row);
            row = [];
            field = "";
        } else if (character != "\r") {
            field += character;
        }
    }

    if (field || row.length) {
        row.push(field);
        rows.push(row);
    }

    return rows;
}

function getTag(pgn, name) {
    const start = pgn.indexOf(`[${name} "`);
    if (start == -1) return undefined;

    const valueStart = start + name.length + 3;

    return pgn.slice(valueStart, pgn.indexOf("\"", valueStart));
}

function buildCorpus(csvPath, corpusPath) {
    const rows = parseCsv(readFileSync(csvPath, "utf8"))
        .slice(1)
        .filter(row => row.length >= 3 && row[0].trim());

    const corpus = rows.map((row, index) => ({
        id: `game${index + 1}`,
        pgn: row[0].trim(),
        rating: (
            parseInt(getTag(row[0], "WhiteElo"))
            + parseInt(getTag(row[0], "BlackElo"))
        ) / 2,
        accuracy: {
            white: parseFloat(row[1]),
            black: parseFloat(row[2])
        }
    }));

    writeFileSync(corpusPath, JSON.stringify(corpus, null, 1));

    console.log(`${corpus.length} games written to ${corpusPath}`);
}

const mean = values => values.reduce((sum, value) => sum + value, 0)
    / values.length;

function standardDeviation(values) {
    const average = mean(values);

    return Math.sqrt(mean(values.map(value => (value - average) ** 2)));
}

async function check(corpusPath, resultsPath) {
    const { buildStateTree } = await import("./recordedTree.mjs");
    const { getGameAnalysis } = await import(
        "../../src/shared/lib/reporter/report.ts"
    );
    const { getGameAccuracy } = await import(
        "../../src/shared/lib/reporter/accuracy.ts"
    );

    const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
    const results = JSON.parse(readFileSync(resultsPath, "utf8"));

    const rows = [];

    for (const game of results.games) {
        const entry = corpus.find(corpusEntry => corpusEntry.id == game.id);
        if (!entry?.accuracy) continue;

        const stateTree = getGameAnalysis(buildStateTree(game)).stateTree;
        const accuracies = getGameAccuracy(stateTree);

        for (const colour of [ "white", "black" ]) {
            rows.push({
                id: game.id,
                colour: colour,
                reference: entry.accuracy[colour],
                review: accuracies[colour].accuracy
            });
        }
    }

    console.log("game        side    reference  review  difference");

    for (const row of rows) {
        console.log(
            row.id.padEnd(12)
            + row.colour.padEnd(8)
            + row.reference.toFixed(1).padStart(9)
            + row.review.toFixed(1).padStart(8)
            + (row.review - row.reference).toFixed(1).padStart(12)
        );
    }

    const differences = rows.map(row => row.review - row.reference);

    const reviews = rows.map(row => row.review);
    const references = rows.map(row => row.reference);

    const covariance = mean(rows.map(row => (
        (row.review - mean(reviews)) * (row.reference - mean(references))
    )));

    const correlation = covariance / (
        standardDeviation(reviews) * standardDeviation(references)
    );

    console.log();
    console.log(`sides compared:      ${rows.length}`);
    console.log(`mean difference:     ${mean(differences).toFixed(2)}`);
    console.log(`mean absolute error: ${mean(differences.map(Math.abs)).toFixed(2)}`);
    console.log(`root mean square:    ${Math.sqrt(mean(differences.map(d => d * d))).toFixed(2)}`);
    console.log(`largest difference:  ${Math.max(...differences.map(Math.abs)).toFixed(2)}`);
    console.log(`correlation:         ${correlation.toFixed(3)}`);
}

if (mode == "corpus" && firstPath && secondPath) {
    buildCorpus(firstPath, secondPath);
} else if (mode == "check" && firstPath && secondPath) {
    await check(firstPath, secondPath);
} else {
    console.log("usage: accuracy.mjs corpus <games.csv> <corpus.json>");
    console.log("       accuracy.mjs check <corpus.json> <run.json>");
    process.exit(1);
}
