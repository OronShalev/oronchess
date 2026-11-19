// Saving and sharing files made in the app. The Android and Windows apps
// save through their own bridges, as their web views cannot download.
//
// Android: window.AndroidFiles, which writes the file, then saves it to
// Downloads/OronChess or shares it.
// Windows: messages on the WebView2 channel, answered with the result:
//   file\tbegin\t<name>   file\tappend\t<base64>   file\tsave\t
//   -> file\n<saved|cancelled|failed>\n<path>

interface AndroidFileBridge {
    begin: (name: string, mimeType: string) => boolean;
    append: (base64: string) => boolean;
    // Returns where the file was saved, or "" if it could not be
    save: () => string;
    share: () => boolean;
}

interface WebViewChannel {
    postMessage: (message: string) => void;
    addEventListener: (type: "message", listener: (event: { data: string }) => void) => void;
    removeEventListener: (type: "message", listener: (event: { data: string }) => void) => void;
}

declare global {
    interface Window {
        AndroidFiles?: AndroidFileBridge;
    }
}

export interface SaveResult {
    saved: boolean;
    // Where the file went, when the app knows
    location?: string;
}

// Base64 of whole groups of 3 bytes, so that chunks join into one file
const chunkBytes = 3 * 1024 * 1024;

async function* toBase64Chunks(blob: Blob) {
    for (let offset = 0; offset < blob.size; offset += chunkBytes) {
        const bytes = new Uint8Array(
            await blob.slice(offset, offset + chunkBytes).arrayBuffer()
        );

        let binary = "";

        for (let index = 0; index < bytes.length; index += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
        }

        yield btoa(binary);
    }
}

function getWindowsChannel() {
    return window.chrome?.webview as WebViewChannel | undefined;
}

// The file last passed to the Android app, which it can still share
let androidFile: Blob | undefined;

async function sendToAndroid(bridge: AndroidFileBridge, blob: Blob, name: string) {
    if (androidFile == blob) return;

    if (!bridge.begin(name, blob.type)) throw new Error("file could not be written");

    for await (const chunk of toBase64Chunks(blob)) {
        if (!bridge.append(chunk)) throw new Error("file could not be written");
    }

    androidFile = blob;
}

async function saveInWindows(channel: WebViewChannel, blob: Blob, name: string) {
    const result = new Promise<SaveResult>((res, rej) => {
        function onMessage(event: { data: string }) {
            const [ prefix, status, path ] = String(event.data).split("\n");
            if (prefix != "file") return;

            channel.removeEventListener("message", onMessage);

            if (status == "failed") return rej(new Error("file could not be saved"));

            res({ saved: status == "saved", location: path || undefined });
        }

        channel.addEventListener("message", onMessage);
    });

    channel.postMessage(`file\tbegin\t${name}`);

    for await (const chunk of toBase64Chunks(blob)) {
        channel.postMessage(`file\tappend\t${chunk}`);
    }

    channel.postMessage("file\tsave\t");

    return result;
}

async function saveInBrowser(blob: Blob, name: string): Promise<SaveResult> {
    const picker = (window as {
        showSaveFilePicker?: (options: object) => Promise<FileSystemFileHandle>;
    }).showSaveFilePicker;

    // Browsers that can show a save dialog let the user choose where
    if (picker) {
        const extension = name.slice(name.lastIndexOf("."));

        try {
            const handle = await picker({
                suggestedName: name,
                types: [{ accept: { [blob.type]: [ extension ] } }]
            });

            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();

            return { saved: true };
        } catch (error) {
            if ((error as Error)?.name == "AbortError") return { saved: false };
            // Other failures fall back to a download
        }
    }

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 60000);

    return { saved: true };
}

/**
 * @description Saves a file where the platform keeps downloads, letting
 * the user choose where when it can. Resolves with whether it was saved.
 */
export async function saveFile(blob: Blob, name: string): Promise<SaveResult> {
    const android = window.AndroidFiles;

    if (android) {
        await sendToAndroid(android, blob, name);

        const location = android.save();

        // Android before 10 cannot save to Downloads without permission,
        // so the share sheet is opened instead, where it can be saved
        if (!location) {
            android.share();
            return { saved: false };
        }

        return { saved: true, location };
    }

    const windowsChannel = getWindowsChannel();
    if (windowsChannel) return saveInWindows(windowsChannel, blob, name);

    return saveInBrowser(blob, name);
}

/**
 * @description Returns whether files like the given one can be shared to
 * other apps here.
 */
export function canShareFile(blob: Blob, name: string) {
    if (window.AndroidFiles) return true;

    try {
        return !!navigator.canShare?.({
            files: [ new File([blob], name, { type: blob.type }) ]
        });
    } catch {
        return false;
    }
}

/**
 * @description Opens the platform's share sheet for a file.
 */
export async function shareFile(blob: Blob, name: string) {
    const android = window.AndroidFiles;

    if (android) {
        await sendToAndroid(android, blob, name);
        android.share();
        return;
    }

    // Rejects when the share sheet is dismissed
    await navigator.share({
        files: [ new File([blob], name, { type: blob.type }) ]
    }).catch(() => undefined);
}
