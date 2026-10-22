import { EngineLine } from "@shared/types/game/position/EngineLine";

export interface EvaluationCache {
    get: (key: string) => Promise<EngineLine[] | undefined>;
    setMany: (entries: [string, EngineLine[]][]) => Promise<void>;
}

const databaseName = "wintrchess-evaluations";
const storeName = "engineLines";

// The store is cleared when it grows past this many positions
const maxEntryCount = 10000;

function promisifyRequest<T>(request: IDBRequest<T>) {
    return new Promise<T>((res, rej) => {
        request.onsuccess = () => res(request.result);
        request.onerror = () => rej(request.error);
    });
}

function openDatabase() {
    const request = indexedDB.open(databaseName, 1);

    request.onupgradeneeded = () => {
        request.result.createObjectStore(storeName);
    };

    return promisifyRequest(request);
}

/**
 * @description Returns a cache of engine lines kept in IndexedDB, or
 * undefined if IndexedDB is unavailable.
 */
export function createIndexedDBEvaluationCache(): EvaluationCache | undefined {
    if (typeof indexedDB == "undefined") return;

    const databasePromise = openDatabase();
    databasePromise.catch(() => {});

    let entriesChecked = false;

    async function getStore(mode: IDBTransactionMode) {
        const database = await databasePromise;

        return database.transaction(storeName, mode).objectStore(storeName);
    }

    return {
        async get(key) {
            try {
                const store = await getStore("readonly");

                return await promisifyRequest<EngineLine[] | undefined>(
                    store.get(key)
                );
            } catch {
                return undefined;
            }
        },

        async setMany(entries) {
            try {
                if (!entriesChecked) {
                    entriesChecked = true;

                    const entryCount = await promisifyRequest(
                        (await getStore("readonly")).count()
                    );

                    if (entryCount > maxEntryCount) {
                        await promisifyRequest(
                            (await getStore("readwrite")).clear()
                        );
                    }
                }

                // One transaction stores the whole game
                const store = await getStore("readwrite");

                await Promise.all(entries.map(([ key, lines ]) => (
                    promisifyRequest(store.put(lines, key))
                )));
            } catch {
                return;
            }
        }
    };
}

/**
 * @description Returns the cache key for a position under some engine
 * settings, or undefined if its evaluation may depend on the moves that
 * led to it: when it repeats an earlier position of the game, or when the
 * fifty move rule is near.
 */
export function getEvaluationCacheKey(
    fen: string,
    previousFens: string[],
    settings: Record<string, string | number | boolean | undefined>
) {
    const [ board, turn, castling, enPassant, halfmoveClock ] = fen.split(" ");

    if (parseInt(halfmoveClock) >= 80) return;

    const position = [ board, turn, castling, enPassant ].join(" ");

    const repeatsPosition = previousFens.some(previousFen => (
        previousFen.split(" ").slice(0, 4).join(" ") == position
    ));

    if (repeatsPosition) return;

    return [
        position,
        ...Object.entries(settings)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, value]) => `${name}=${value}`)
    ].join(" ");
}
