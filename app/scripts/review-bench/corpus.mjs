// Builds a benchmark corpus from a Lichess database PGN export, spread
// evenly over rating bands.
// Usage: node corpus.mjs <games.pgn> <output.json> [gameCount]
import { readFileSync, writeFileSync } from "node:fs";

const [ inputPath, outputPath, countArgument ] = process.argv.slice(2);
const gameCount = parseInt(countArgument || "100");

const ratingBands = [
    [0, 1200], [1200, 1500], [1500, 1800], [1800, 2100], [2100, 4000]
];

function getTag(pgn, name) {
    return pgn.match(new RegExp(`\\[${name} "([^"]*)"\\]`))?.[1];
}

const games = readFileSync(inputPath, "utf8")
    .replace(/\r/g, "")
    .split(/\n\n(?=\[Event )/)
    .map(pgn => {
        const moveText = pgn.split("\n\n").slice(1).join(" ");

        const plies = moveText
            .replace(/\d+\.+/g, "")
            .trim()
            .split(/\s+/)
            .length - 1;

        return {
            id: getTag(pgn, "Site")?.split("/").at(-1),
            pgn: pgn.trim(),
            rating: (
                parseInt(getTag(pgn, "WhiteElo"))
                + parseInt(getTag(pgn, "BlackElo"))
            ) / 2,
            plies: plies,
            termination: getTag(pgn, "Termination"),
            variant: getTag(pgn, "Variant")
        };
    })
    .filter(game => (
        game.id
        && !game.variant
        && game.termination == "Normal"
        && !isNaN(game.rating)
        && game.plies >= 30
        && game.plies <= 140
    ));

const corpus = [];
const bandCount = Math.round(gameCount / ratingBands.length);

for (const [ low, high ] of ratingBands) {
    const bandGames = games.filter(
        game => game.rating >= low && game.rating < high
    );

    const step = Math.max(1, Math.floor(bandGames.length / bandCount));

    for (
        let i = 0, picked = 0;
        i < bandGames.length && picked < bandCount;
        i += step, picked++
    ) {
        const { id, pgn, rating, plies } = bandGames[i];
        corpus.push({ id, rating, plies, pgn });
    }
}

writeFileSync(outputPath, JSON.stringify(corpus, null, 1));

const totalPlies = corpus.reduce((total, game) => total + game.plies, 0);
console.log(`${corpus.length} games, ${totalPlies} plies`);
