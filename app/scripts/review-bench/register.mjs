// Lets Node run the app's TypeScript sources: transpiles them with the
// TypeScript compiler and resolves tsconfig path aliases and extensionless
// imports. Imports of "@analysis/lib/*" and
// relative imports made from the extracted baseline sources stay inside
// the baseline directory, so the old pipeline runs with today's shared code.
import { registerHooks } from "node:module";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";

const appRoot = fileURLToPath(new URL("../../", import.meta.url));
const baselineRoot = path.join(appRoot, "scripts/review-bench/.baseline");

const aliases = {
    "@client/": "src/client/",
    "@server/": "src/server/",
    "@shared/": "src/shared/",
    "@analysis/": "src/client/apps/features/analysis/",
    "@assets/": "public/"
};

function resolveFile(filePath) {
    const candidates = [
        filePath,
        filePath + ".ts",
        filePath + ".tsx",
        path.join(filePath, "index.ts")
    ];

    return candidates.find(candidate => (
        existsSync(candidate) && statSync(candidate).isFile()
    ));
}

registerHooks({
    resolve(specifier, context, nextResolve) {
        const parentPath = context.parentURL?.startsWith("file:")
            ? fileURLToPath(context.parentURL)
            : undefined;

        const fromBaseline = parentPath?.startsWith(baselineRoot);

        let targetPath;

        if (fromBaseline && specifier.startsWith("@analysis/lib/")) {
            targetPath = path.join(
                baselineRoot, specifier.slice("@analysis/lib/".length)
            );
        } else {
            const alias = Object.keys(aliases).find(
                prefix => specifier.startsWith(prefix)
            );

            if (alias) {
                targetPath = path.join(
                    appRoot, aliases[alias], specifier.slice(alias.length)
                );
            } else if (specifier.startsWith(".") && parentPath) {
                targetPath = path.resolve(path.dirname(parentPath), specifier);
            }
        }

        if (targetPath) {
            const resolvedPath = resolveFile(targetPath);

            if (resolvedPath) {
                return nextResolve(pathToFileURL(resolvedPath).href, context);
            }
        }

        return nextResolve(specifier, context);
    },

    load(url, context, nextLoad) {
        if (!/\.tsx?$/.test(url)) return nextLoad(url, context);

        const { outputText } = ts.transpileModule(
            readFileSync(fileURLToPath(url), "utf8"),
            {
                fileName: fileURLToPath(url),
                compilerOptions: {
                    module: ts.ModuleKind.ESNext,
                    target: ts.ScriptTarget.ES2022,
                    jsx: ts.JsxEmit.ReactJSX
                }
            }
        );

        return { format: "module", source: outputText, shortCircuit: true };
    }
});
