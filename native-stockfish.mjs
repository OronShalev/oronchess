// Downloads an official Stockfish release binary for the Android and
// Windows apps, checks it against its published SHA-256 digest and
// returns the path of the extracted program. Downloads are cached in
// ~/.cache/wintrchess-stockfish.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const release = "sf_19";

export const stockfishBuilds = {
    android: {
        asset: "stockfish-android-arm64-universal.tar.gz",
        sha256: "ebb24051aa4a222b4daaf049b882ecf1163d370c128fe02316602643f4d5e426"
    },
    windows: {
        asset: "stockfish-windows-x86-64-universal.zip",
        sha256: "3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7"
    }
};

function findProgram(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            const found = findProgram(entryPath);
            if (found) return found;
        } else if (/^stockfish-.*universal(\.exe)?$/.test(entry.name)) {
            return entryPath;
        }
    }
}

export async function getStockfish(platform) {
    const { asset, sha256 } = stockfishBuilds[platform];

    const cacheRoot = path.join(os.homedir(), ".cache/wintrchess-stockfish", release);
    const archivePath = path.join(cacheRoot, asset);
    const extractRoot = path.join(cacheRoot, platform);

    mkdirSync(cacheRoot, { recursive: true });

    if (!existsSync(archivePath)) {
        const url = `https://github.com/official-stockfish/Stockfish/releases/download/${release}/${asset}`;
        console.log(`Downloading ${url}`);

        const response = await fetch(url);
        if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);

        writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()));
    }

    const digest = createHash("sha256").update(readFileSync(archivePath)).digest("hex");

    if (digest != sha256) {
        rmSync(archivePath);
        throw new Error(`${asset} does not match its published SHA-256 digest`);
    }

    let program = existsSync(extractRoot) && findProgram(extractRoot);

    if (!program) {
        rmSync(extractRoot, { recursive: true, force: true });
        mkdirSync(extractRoot, { recursive: true });

        // The tar of Windows 10+ (bsdtar) reads both .tar.gz and .zip; a
        // GNU tar found first on the PATH would not take drive letters
        const tar = process.platform == "win32"
            ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe")
            : "tar";

        execFileSync(tar, ["-xf", archivePath, "-C", extractRoot]);

        program = findProgram(extractRoot);
        if (!program) throw new Error(`No Stockfish program found in ${asset}`);
    }

    return program;
}
