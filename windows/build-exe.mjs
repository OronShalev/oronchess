// Builds the web client, bundles it with the Windows app and builds an
// installer at windows/WintrChess-Setup.exe.
//
// Usage (from windows/): node build-exe.mjs [--skip-web]
//
// Needs the .NET SDK and Inno Setup 6. ISCC is found on the PATH, in its
// default install folders, or at the path in the ISCC variable.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
    "publish", "WintrChess/WintrChess.csproj",
    "-c", "Release",
    "-o", `"${outputRoot}"`,
    "--nologo"
], windowsRoot);

// The server only serves these two folders, so they make up the whole app
const assetsRoot = path.join(outputRoot, "www");

cpSync(path.join(appRoot, "public"), assetsRoot, { recursive: true });
cpSync(path.join(appRoot, "dist/client"), assetsRoot, { recursive: true });

// Package it into an installer
run(`"${findInnoSetupCompiler()}"`, ["/Q", "installer.iss"], windowsRoot);

console.log(`Installer written to ${path.join(windowsRoot, "WintrChess-Setup.exe")}`);
