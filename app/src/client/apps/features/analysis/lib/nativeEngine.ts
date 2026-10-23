// The Android and Windows apps can run Stockfish as a native program,
// which is much faster than its WebAssembly builds. Each app exposes a
// bridge that starts engine processes and relays their UCI output.
//
// Messages to the app:   "<op>\t<id>\t<argument>" with op start (argument
//                        is the engine, full or lite), send (a UCI command)
//                        or stop
// Messages from the app: "<id>\n<line>\n<line>..." with output lines, or
//                        "<id>\n!<message>" when the engine fails

/**
 * @description What the analysis engine needs from a Web Worker, so that
 * a native engine process can stand in for one.
 */
export interface EngineTransport {
    postMessage(message: string): void;
    addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
    addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
    removeEventListener(type: "message" | "error", listener: (event: any) => void): void;
    terminate(): void;
}

export type NativeEngineKind = "full" | "lite";

interface NativeBridge {
    engines: NativeEngineKind[];
    post: (message: string) => void;
    listen: (handler: (message: string) => void) => void;
}

interface MessageChannelLike {
    postMessage: (message: string) => void;
    addEventListener: (
        type: "message",
        listener: (event: { data: string }) => void
    ) => void;
}

declare global {
    interface Window {
        // Added by the Android app
        NativeEngine?: MessageChannelLike;
        NativeEngineInfo?: { engines: () => string };

        // Set by the Windows app, whose bridge is the WebView2 one; true
        // in versions that only had the full engine
        __oronNativeEngine?: boolean | string[];
        chrome?: { webview?: MessageChannelLike };
    }
}

function parseEngines(engines: string[]) {
    return engines.filter((engine): engine is NativeEngineKind => (
        engine == "full" || engine == "lite"
    ));
}

function findBridge(): NativeBridge | null {
    if (typeof window == "undefined") return null;

    const android = window.NativeEngine;

    if (android) return {
        engines: window.NativeEngineInfo
            ? parseEngines(window.NativeEngineInfo.engines().split(","))
            : ["full"],
        post: message => android.postMessage(message),
        listen: handler => android.addEventListener(
            "message", event => handler(String(event.data))
        )
    };

    const webview = window.chrome?.webview;
    const windowsEngines = window.__oronNativeEngine;

    if (webview && windowsEngines) return {
        engines: Array.isArray(windowsEngines)
            ? parseEngines(windowsEngines)
            : ["full"],
        post: message => webview.postMessage(message),
        listen: handler => webview.addEventListener(
            "message", event => handler(String(event.data))
        )
    };

    return null;
}

const bridge = findBridge();

const transports = new Map<string, NativeEngineTransport>();
let nextId = 1;

bridge?.listen(message => {
    const lines = message.split("\n");
    const transport = transports.get(lines[0]);
    if (!transport) return;

    for (const line of lines.slice(1)) {
        if (line.startsWith("!")) {
            transport.dispatchEvent(new ErrorEvent("error", {
                message: line.slice(1),
                error: line.slice(1)
            }));
        } else {
            transport.dispatchEvent(new MessageEvent("message", { data: line }));
        }
    }
});

/**
 * @description Returns whether this app can run a native engine, or any
 * native engine if none is given.
 */
export function isNativeEngineAvailable(engine?: NativeEngineKind) {
    if (!bridge) return false;

    return engine ? bridge.engines.includes(engine) : bridge.engines.length > 0;
}

class NativeEngineTransport extends EventTarget {
    private id = String(nextId++);

    constructor(engine: NativeEngineKind) {
        super();

        transports.set(this.id, this);
        bridge!.post(`start\t${this.id}\t${engine}`);
    }

    postMessage(message: string) {
        if (!transports.has(this.id)) return;

        bridge!.post(`send\t${this.id}\t${message}`);
    }

    terminate() {
        if (!transports.delete(this.id)) return;

        bridge!.post(`stop\t${this.id}\t`);
    }
}

/**
 * @description Starts a native engine process through the app bridge.
 */
export function createNativeEngineTransport(
    engine: NativeEngineKind
): EngineTransport {
    if (!isNativeEngineAvailable(engine)) {
        throw new Error(`native ${engine} engine is not available`);
    }

    return new NativeEngineTransport(engine) as unknown as EngineTransport;
}
