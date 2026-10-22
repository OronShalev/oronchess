import EngineVersion from "@shared/constants/EngineVersion";

function isMobileDevice() {
    if (typeof navigator == "undefined") return false;

    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function isAppleMobileDevice() {
    if (typeof navigator == "undefined") return false;

    return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * @description Returns how many single threaded engines to run at once
 * for evaluating a game, leaving one core for the page itself.
 */
export function getRecommendedEngineCount(version: EngineVersion) {
    const cores = (
        typeof navigator != "undefined"
        && navigator.hardwareConcurrency
    ) || 4;

    let engineCount = Math.min(Math.max(cores - 1, 1), 8);

    if (isAppleMobileDevice()) {
        engineCount = Math.min(engineCount, 2);
    } else if (isMobileDevice()) {
        engineCount = Math.min(engineCount, 4);
    }

    // Each engine holds its own copy of the full size network
    if (version == EngineVersion.STOCKFISH_19) {
        engineCount = Math.min(engineCount, 4);
    }

    return engineCount;
}

/**
 * @description Returns the transposition table size in megabytes for
 * each engine evaluating a game.
 */
export function getRecommendedHashSize() {
    return isMobileDevice() ? 16 : 32;
}
