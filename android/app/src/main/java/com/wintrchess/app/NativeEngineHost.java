package com.wintrchess.app;

import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Runs Stockfish as native processes for the page, which is much faster
 * than its WebAssembly builds. The page talks to it through the
 * "NativeEngine" object:
 *
 *   to here:   "start \t id \t engine" (full or lite), "send \t id \t line"
 *              or "stop \t id"
 *   to page:   "id \n line \n line ..." or "id \n !message" on failure
 *
 * Messages arrive on the main thread, where all engine bookkeeping stays.
 */
final class NativeEngineHost implements WebViewCompat.WebMessageListener {

    // Output is batched so that the page is not messaged for every line
    private static final long FLUSH_DELAY_MS = 16;

    // Program of each engine the page can start, by name
    private final Map<String, String> enginePaths;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Map<String, EngineProcess> engines = new HashMap<>();

    private JavaScriptReplyProxy currentPage;

    NativeEngineHost(Map<String, String> enginePaths) {
        this.enginePaths = enginePaths;
    }

    @Override
    public void onPostMessage(
        @NonNull WebView view,
        @NonNull WebMessageCompat message,
        @NonNull Uri sourceOrigin,
        boolean isMainFrame,
        @NonNull JavaScriptReplyProxy replyProxy
    ) {
        String data = message.getData();
        if (data == null || !isMainFrame) return;

        // Engines of a page that has been left or reloaded are not needed
        if (replyProxy != currentPage) {
            stopAll();
            currentPage = replyProxy;
        }

        String[] parts = data.split("\t", 3);
        if (parts.length < 2) return;

        String op = parts[0];
        String id = parts[1];
        String line = parts.length > 2 ? parts[2] : "";

        switch (op) {
            case "start":
                start(id, line);
                break;
            case "send":
                EngineProcess engine = engines.get(id);
                if (engine != null) engine.send(line);
                break;
            case "stop":
                stop(id);
                break;
        }
    }

    private void start(String id, String engine) {
        stop(id);

        String enginePath = enginePaths.get(engine);

        if (enginePath == null) {
            currentPage.postMessage(id + "\n!no " + engine + " engine");
            return;
        }

        try {
            engines.put(id, new EngineProcess(id, enginePath, currentPage));
        } catch (IOException exception) {
            currentPage.postMessage(id + "\n!" + exception.getMessage());
        }
    }

    private void stop(String id) {
        EngineProcess engine = engines.remove(id);
        if (engine != null) engine.stop();
    }

    void stopAll() {
        for (EngineProcess engine : engines.values()) engine.stop();
        engines.clear();
    }

    private final class EngineProcess {
        private final String id;
        private final JavaScriptReplyProxy page;
        private final Process process;
        private final BufferedWriter input;
        private final ExecutorService writer = Executors.newSingleThreadExecutor();

        private final List<String> pendingLines = new ArrayList<>();
        private boolean flushScheduled = false;
        private volatile boolean stopped = false;

        EngineProcess(
            String id,
            String enginePath,
            JavaScriptReplyProxy page
        ) throws IOException {
            this.id = id;
            this.page = page;

            process = new ProcessBuilder(enginePath)
                .redirectErrorStream(true)
                .start();

            input = new BufferedWriter(new OutputStreamWriter(process.getOutputStream()));

            Thread reader = new Thread(this::readOutput, "stockfish-" + id);
            reader.setDaemon(true);
            reader.start();
        }

        private void readOutput() {
            try (BufferedReader output = new BufferedReader(
                new InputStreamReader(process.getInputStream())
            )) {
                String line;

                while ((line = output.readLine()) != null) {
                    synchronized (pendingLines) {
                        pendingLines.add(line);

                        if (!flushScheduled) {
                            flushScheduled = true;
                            mainHandler.postDelayed(this::flush, FLUSH_DELAY_MS);
                        }
                    }
                }
            } catch (IOException ignored) {
            }

            if (!stopped) {
                mainHandler.post(() -> page.postMessage(id + "\n!engine stopped"));
            }
        }

        private void flush() {
            StringBuilder message = new StringBuilder(id);

            synchronized (pendingLines) {
                for (String line : pendingLines) message.append('\n').append(line);

                pendingLines.clear();
                flushScheduled = false;
            }

            if (!stopped) page.postMessage(message.toString());
        }

        void send(String line) {
            writer.execute(() -> {
                try {
                    input.write(line);
                    input.newLine();
                    input.flush();
                } catch (IOException ignored) {
                    // The reader reports the engine as stopped
                }
            });
        }

        void stop() {
            stopped = true;

            send("quit");
            writer.execute(process::destroy);
            writer.shutdown();
        }
    }
}
