// Builds the web client, bundles it into the Android app and builds an
// installable APK at android/oronchess.apk.
//
// Usage (from android/): node build-apk.mjs [--skip-web]
//
// Needs a JDK 17 and the Android SDK (platform 35, build tools 35).
// Native Stockfish comes from its official release, and Lite is built from
// source (see native-stockfish.mjs).
// JAVA_HOME and ANDROID_HOME are used when set; otherwise the toolchain
// is looked for in ~/.android-toolchain/{jdk,sdk}.
import { execFileSync } from "node:child_process";
import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

import { getStockfish, getStockfishLite } from "../native-stockfish.mjs";

const androidRoot = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(androidRoot, "../app");
const assetsRoot = path.join(androidRoot, "app/src/main/assets/www");

const isWindows = process.platform == "win32";
const toolchainRoot = path.join(os.homedir(), ".android-toolchain");

const javaHome = process.env.JAVA_HOME || path.join(toolchainRoot, "jdk");
const androidHome = process.env.ANDROID_HOME
    || process.env.ANDROID_SDK_ROOT
    || path.join(toolchainRoot, "sdk");

for (const [ name, directory ] of [["JDK", javaHome], ["Android SDK", androidHome]]) {
    if (!existsSync(directory)) {
        console.error(`${name} not found at ${directory}`);
        process.exit(1);
    }
}

function run(command, args, cwd, env = {}) {
    execFileSync(command, args, {
        cwd,
        stdio: "inherit",
        shell: isWindows,
        env: { ...process.env, ...env }
    });
}

// Build the web client
if (!process.argv.includes("--skip-web")) {
    run("npm", ["run", "build:client"], appRoot);
}

// The server only serves these two folders, so they make up the whole app.
// Both engines run natively in the app, so their WebAssembly builds are
// left out
rmSync(assetsRoot, { recursive: true, force: true });
cpSync(path.join(appRoot, "public"), assetsRoot, {
    recursive: true,
    filter: source => !/stockfish-19(-lite)?-single\.(js|wasm)$/.test(source)
});
cpSync(path.join(appRoot, "dist/client"), assetsRoot, { recursive: true });
copyFileSync(path.join(androidRoot, "../THIRD_PARTY.md"), path.join(assetsRoot, "THIRD_PARTY.md"));

// Native Stockfish is packaged as a native library so that it can be run
const nativeLibraryRoot = path.join(androidRoot, "app/src/main/jniLibs/arm64-v8a");

mkdirSync(nativeLibraryRoot, { recursive: true });
copyFileSync(await getStockfish("android"), path.join(nativeLibraryRoot, "libstockfish.so"));
copyFileSync(
    await getStockfishLite("android-dotprod"),
    path.join(nativeLibraryRoot, "libstockfish_lite_dotprod.so")
);
copyFileSync(
    await getStockfishLite("android"),
    path.join(nativeLibraryRoot, "libstockfish_lite.so")
);

writeFileSync(
    path.join(androidRoot, "local.properties"),
    `sdk.dir=${androidHome.replace(/\\/g, "/")}\n`
);

run(
    path.join(androidRoot, isWindows ? "gradlew.bat" : "gradlew"),
    ["assembleRelease", "--no-daemon"],
    androidRoot,
    { JAVA_HOME: javaHome, ANDROID_HOME: androidHome }
);

const apkPath = path.join(androidRoot, "oronchess.apk");

copyFileSync(
    path.join(androidRoot, "app/build/outputs/apk/release/app-release.apk"),
    apkPath
);

console.log(`APK written to ${apkPath}`);
