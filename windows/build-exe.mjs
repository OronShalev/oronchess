// Builds the web client, bundles it with the Windows app and builds an
// installer at windows/OronChess-Setup.exe.
//
// Usage (from windows/): node build-exe.mjs [--skip-web]
//
// Needs the .NET SDK and Inno Setup 6. ISCC is found on the PATH, in its
// default install folders, or at the path in the ISCC variable. Native
// Stockfish comes from its official release, and Lite is built from source
// (see native-stockfish.mjs).
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { getStockfish, getStockfishLite } from "../native-stockfish.mjs";

const windowsRoot = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(windowsRoot, "../app");
const outputRoot = path.join(windowsRoot, "build/app");

function run(command, args, cwd) {
    execFileSync(command, args, { cwd, stdio: "inherit", shell: true });
}

function findInnoSetupCompiler() {
    const candidates = [
        process.env.ISCC,
        path.join(process.env.LOCALAPPDATA || "", "Programs/Inno Setup 6/ISCC.exe"),
        path.join(process.env["ProgramFiles(x86)"] || "", "Inno Setup 6/ISCC.exe"),
        path.join(process.env.ProgramFiles || "", "Inno Setup 6/ISCC.exe")
    ];

    return candidates.find(candidate => candidate && existsSync(candidate)) || "ISCC";
}

// Build the web client
if (!process.argv.includes("--skip-web")) {
    run("npm", ["run", "build:client"], appRoot);
}

// Build the app into a clean folder
rmSync(path.join(windowsRoot, "build"), { recursive: true, force: true });

run("dotnet", [
    "publish", "OronChess/OronChess.csproj",
    "-c", "Release",
    "-o", `"${outputRoot}"`,
    "--nologo"
], windowsRoot);

// The server only serves these two folders, so they make up the whole app
const assetsRoot = path.join(outputRoot, "www");

// Both engines run natively in the app, so their WebAssembly builds are
// left out
cpSync(path.join(appRoot, "public"), assetsRoot, {
    recursive: true,
    filter: source => !/stockfish-19(-lite)?-single\.(js|wasm)$/.test(source)
});
cpSync(path.join(appRoot, "dist/client"), assetsRoot, { recursive: true });

// Native Stockfish: the official release, and Lite built from source
const enginesRoot = path.join(outputRoot, "engines");

mkdirSync(enginesRoot, { recursive: true });
copyFileSync(await getStockfish("windows"), path.join(enginesRoot, "stockfish.exe"));
copyFileSync(await getStockfishLite("windows-avx2"), path.join(enginesRoot, "stockfish-lite-avx2.exe"));
copyFileSync(await getStockfishLite("windows"), path.join(enginesRoot, "stockfish-lite.exe"));
copyFileSync(path.join(windowsRoot, "../THIRD_PARTY.md"), path.join(outputRoot, "THIRD_PARTY.md"));

// Package it into an installer
run(`"${findInnoSetupCompiler()}"`, ["/Q", "installer.iss"], windowsRoot);

console.log(`Installer written to ${path.join(windowsRoot, "OronChess-Setup.exe")}`);
