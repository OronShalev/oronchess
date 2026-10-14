import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

// Resolves the same from both src/server/lib and dist/server/lib
export const appRoot = resolve(
    dirname(fileURLToPath(import.meta.url)), "../../.."
);

export const publicPath = resolve(appRoot, "public");
export const clientBuildPath = resolve(appRoot, "dist/client");
export const envPath = resolve(appRoot, "../.env");
