// Native Stockfish programs for the Android and Windows apps, cached in
// ~/.cache/wintrchess-stockfish:
// - getStockfish: the official Stockfish 19 release (full strength), checked
//   against its published SHA-256 digest
// - getStockfishLite: Stockfish 19 Lite, built from the Stockfish.js engine
//   source that the web app's Lite engine is compiled from, with its small
//   network, using the Zig toolchain as a cross compiler
// Every download is pinned to a SHA-256 digest.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
    writeFileSync
} from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const cacheRoot = path.join(os.homedir(), ".cache/wintrchess-stockfish");
const patchPath = fileURLToPath(new URL("native/stockfish-lite.patch", import.meta.url));

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

// Stockfish.js commit of the "Stockfish.js 19" engines the web app uses
const liteSource = {
    commit: "10b49d8bb4539a0743013772ed735a63853a3b05",
    sha256: "3765c9aad1a79763cc8586f25eb3d7ca86489ce7520955b18ab99f286c08ab25"
};

const liteNetwork = {
    name: "nn-61e7af4bb97d.nnue",
    sha256: "61e7af4bb97d51eeeb25d322916f86513b5cd3a827ce189c98c6e31946f99e5b"
};

const zigVersion = "0.13.0";

const zigBuilds = {
    "win32-x64": ["zig-windows-x86_64-0.13.0.zip", "d859994725ef9402381e557c60bb57497215682e355204d754ee3df75ee3c158"],
    "linux-x64": ["zig-linux-x86_64-0.13.0.tar.xz", "d45312e61ebcc48032b77bc4cf7fd6915c11fa16e4aad116b66c9468211230ea"],
    "linux-arm64": ["zig-linux-aarch64-0.13.0.tar.xz", "041ac42323837eb5624068acd8b00cd5777dac4cf91179e8dad7a7e90dd0c556"],
    "darwin-x64": ["zig-macos-x86_64-0.13.0.tar.xz", "8b06ed1091b2269b700b3b07f8e3be3b833000841bae5aa6a09b1a8b4773effd"],
    "darwin-arm64": ["zig-macos-aarch64-0.13.0.tar.xz", "46fae219656545dfaf4dce12fb4e8685cec5b51d721beee9389ab4194d43394c"]
};

const liteSources = [
    "attacks.cpp", "benchmark.cpp", "bitboard.cpp", "evaluate.cpp", "main.cpp",
    "misc.cpp", "movegen.cpp", "movepick.cpp", "position.cpp", "search.cpp",
    "thread.cpp", "timeman.cpp", "tt.cpp", "uci.cpp", "ucioption.cpp", "tune.cpp",
    "syzygy/tbprobe.cpp", "nnue/nnue_accumulator.cpp", "nnue/nnue_misc.cpp",
    "nnue/network.cpp", "nnue/features/p_hm.cpp", "engine.cpp", "score.cpp", "memory.cpp"
];

// The same defines as Stockfish's Makefile uses for these architectures
const liteTargets = {
    "android-dotprod": {
        flags: ["-target", "aarch64-linux-musl", "-mcpu=generic+v8_2a+dotprod",
            "-DUSE_NEON=8", "-DUSE_NEON_DOTPROD", "-DUSE_POPCNT"],
        output: "stockfish-lite-dotprod"
    },
    "android": {
        flags: ["-target", "aarch64-linux-musl", "-mcpu=generic",
            "-DUSE_NEON=8", "-DUSE_POPCNT"],
        output: "stockfish-lite"
    },
    "windows-avx2": {
        flags: ["-target", "x86_64-windows-gnu", "-mavx2", "-mbmi", "-mbmi2",
            "-msse4.1", "-mssse3", "-msse2", "-mpopcnt", "-DUSE_AVX2", "-DUSE_PEXT",
            "-DUSE_SSE41", "-DUSE_SSSE3", "-DUSE_SSE2", "-DUSE_POPCNT"],
        output: "stockfish-lite-avx2.exe"
    },
    "windows": {
        flags: ["-target", "x86_64-windows-gnu", "-msse4.1", "-mssse3", "-msse2",
            "-mpopcnt", "-DUSE_SSE41", "-DUSE_SSSE3", "-DUSE_SSE2", "-DUSE_POPCNT"],
        output: "stockfish-lite.exe"
    }
};

function sha256Of(filePath) {
    return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

async function download(url, filePath, sha256) {
    if (!existsSync(filePath)) {
        console.log(`Downloading ${url}`);

        const response = await fetch(url);
        if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);

        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, Buffer.from(await response.arrayBuffer()));
    }

    if (sha256Of(filePath) != sha256) {
        rmSync(filePath);
        throw new Error(`${path.basename(filePath)} does not match its pinned SHA-256 digest`);
    }
}

// Extracts an archive into a fresh folder. The tar of Windows 10+ (bsdtar)
// reads .zip and .tar.*; a GNU tar first on the PATH would not take drive
// letters
function extract(archivePath, extractRoot, members = []) {
    const tar = process.platform == "win32"
        ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe")
        : "tar";

    rmSync(extractRoot, { recursive: true, force: true });
    mkdirSync(extractRoot, { recursive: true });

    execFileSync(tar, ["-xf", archivePath, "-C", extractRoot, ...members]);
}

function findFile(directory, pattern) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            const found = findFile(entryPath, pattern);
            if (found) return found;
        } else if (pattern.test(entry.name)) {
            return entryPath;
        }
    }
}

/**
 * @description Returns the path of the official Stockfish release program
 * for a platform (android or windows).
 */
export async function getStockfish(platform) {
    const { asset, sha256 } = stockfishBuilds[platform];

    const releaseRoot = path.join(cacheRoot, release);
    const archivePath = path.join(releaseRoot, asset);
    const extractRoot = path.join(releaseRoot, platform);

    await download(
        `https://github.com/official-stockfish/Stockfish/releases/download/${release}/${asset}`,
        archivePath,
        sha256
    );

    const pattern = /^stockfish-.*universal(\.exe)?$/;
    let program = existsSync(extractRoot) && findFile(extractRoot, pattern);

    if (!program) {
        extract(archivePath, extractRoot);

        program = findFile(extractRoot, pattern);
        if (!program) throw new Error(`No Stockfish program found in ${asset}`);
    }

    return program;
}

async function getZig() {
    const build = zigBuilds[`${process.platform}-${process.arch}`];
    if (!build) throw new Error(`No Zig toolchain is pinned for ${process.platform}-${process.arch}`);

    const [ archive, sha256 ] = build;
    const zigRoot = path.join(cacheRoot, "zig");
    const archivePath = path.join(zigRoot, archive);

    await download(`https://ziglang.org/download/${zigVersion}/${archive}`, archivePath, sha256);

    const pattern = process.platform == "win32" ? /^zig\.exe$/ : /^zig$/;
    const extractRoot = path.join(zigRoot, zigVersion);
    let zig = existsSync(extractRoot) && findFile(extractRoot, pattern);

    if (!zig) {
        extract(archivePath, extractRoot);
        zig = findFile(extractRoot, pattern);
    }

    return zig;
}

// Engine source with its small network, patched for native builds
async function getLiteSource() {
    const sourceRoot = path.join(cacheRoot, "lite-source", liteSource.commit);
    const srcPath = path.join(sourceRoot, "src");

    if (existsSync(path.join(srcPath, liteNetwork.name))) return srcPath;

    const archivePath = path.join(cacheRoot, "lite-source", `${liteSource.commit}.tar.gz`);

    await download(
        `https://github.com/nmrugg/stockfish.js/archive/${liteSource.commit}.tar.gz`,
        archivePath,
        liteSource.sha256
    );

    // Only the engine source; the archive also holds symbolic links that
    // cannot always be created
    const extractRoot = `${sourceRoot}.tmp`;
    extract(archivePath, extractRoot, [`stockfish.js-${liteSource.commit}/src`]);

    const extracted = path.join(extractRoot, readdirSync(extractRoot)[0]);

    execFileSync("git", ["apply", "-p1", patchPath], { cwd: extracted });

    await download(
        `https://tests.stockfishchess.org/api/nn/${liteNetwork.name}`,
        path.join(extracted, "src", liteNetwork.name),
        liteNetwork.sha256
    );

    rmSync(sourceRoot, { recursive: true, force: true });
    renameSync(extracted, sourceRoot);
    rmSync(extractRoot, { recursive: true, force: true });

    return srcPath;
}

/**
 * @description Returns the path of a Stockfish 19 Lite program for a target
 * (android-dotprod, android, windows-avx2 or windows), building it first if
 * it is not cached.
 */
export async function getStockfishLite(target) {
    const { flags, output } = liteTargets[target];

    // Builds are cached by everything that goes into them
    const buildKey = createHash("sha256")
        .update(JSON.stringify([liteSource, liteNetwork, zigVersion, flags]))
        .update(readFileSync(patchPath))
        .digest("hex")
        .slice(0, 16);

    const programPath = path.join(cacheRoot, "lite-builds", buildKey, output);
    if (existsSync(programPath)) return programPath;

    const zig = await getZig();
    const srcPath = await getLiteSource();

    console.log(`Building Stockfish Lite for ${target}`);

    const temporaryPath = `${programPath}.tmp`;
    mkdirSync(path.dirname(programPath), { recursive: true });

    execFileSync(zig, [
        "c++", ...flags,
        "-O3", "-s", "-static", "-std=c++17", "-fno-exceptions",
        "-DNDEBUG", "-DIS_64BIT", "-DUSE_LITE_NET",
        ...liteSources,
        "-o", temporaryPath
    ], { cwd: srcPath, stdio: "inherit" });

    // Zig may add the target's extension to the output name
    const builtPath = existsSync(temporaryPath) ? temporaryPath : `${temporaryPath}.exe`;
    copyFileSync(builtPath, programPath);
    rmSync(builtPath, { force: true });

    return programPath;
}
