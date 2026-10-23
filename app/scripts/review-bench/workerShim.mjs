// Minimal stand-in for the browser Worker API that runs the app's
// Stockfish builds as Node child processes speaking UCI over stdio.
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";

const engineSourceDir = fileURLToPath(new URL("../../public/engines/", import.meta.url));
const engineCacheDir = path.join(os.tmpdir(), "oronchess-bench-engines");

export const workerStats = {
    created: 0,
    searches: 0,
    multiPvSearches: 0
};

// The engine scripts are CommonJS, but the app package is an ES module
function getEnginePath(scriptName) {
    const baseName = path.basename(scriptName, ".js");
    const enginePath = path.join(engineCacheDir, baseName + ".cjs");

    if (!existsSync(enginePath)) {
        mkdirSync(engineCacheDir, { recursive: true });

        copyFileSync(
            path.join(engineSourceDir, baseName + ".js"),
            enginePath
        );

        copyFileSync(
            path.join(engineSourceDir, baseName + ".wasm"),
            path.join(engineCacheDir, baseName + ".wasm")
        );
    }

    return enginePath;
}

class EngineWorker extends EventTarget {
    constructor(url) {
        super();

        this.multiPv = 1;
        this.process = spawn(process.execPath, [
            getEnginePath(String(url).split("/").at(-1))
        ]);

        this.process.stdin.on("error", () => {});

        createInterface({ input: this.process.stdout }).on("line", line => {
            this.dispatchEvent(new MessageEvent("message", { data: line }));
        });

        workerStats.created++;
    }

    postMessage(command) {
        if (this.process.exitCode != null || this.process.killed) return;

        const multiPv = command.match(/^setoption name MultiPV value (\d+)/);
        if (multiPv) this.multiPv = parseInt(multiPv[1]);

        if (command.startsWith("go")) {
            workerStats.searches++;
            if (this.multiPv > 1) workerStats.multiPvSearches++;
        }

        this.process.stdin.write(command + "\n");
    }

    terminate() {
        this.process.kill();
    }
}

globalThis.Worker = EngineWorker;
