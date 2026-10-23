package com.oronchess.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Shows the analysis web app, served from the APK's assets on a secure
 * origin so that its engine workers, WebAssembly and storage all work
 * without a server.
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/analysis";
    private static final String APP_PAGE = "apps/features/analysis.html";

    private static final int FILE_CHOOSER_REQUEST = 1;

    private static final Map<String, String> MIME_TYPES = new HashMap<>();

    static {
        MIME_TYPES.put("html", "text/html");
        MIME_TYPES.put("js", "text/javascript");
        MIME_TYPES.put("css", "text/css");
        MIME_TYPES.put("json", "application/json");
        MIME_TYPES.put("wasm", "application/wasm");
        MIME_TYPES.put("svg", "image/svg+xml");
        MIME_TYPES.put("png", "image/png");
        MIME_TYPES.put("gif", "image/gif");
        MIME_TYPES.put("ico", "image/x-icon");
        MIME_TYPES.put("ttf", "font/ttf");
        MIME_TYPES.put("woff", "font/woff");
        MIME_TYPES.put("woff2", "font/woff2");
        MIME_TYPES.put("mp3", "audio/mpeg");
        MIME_TYPES.put("txt", "text/plain");
    }

    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;
    private NativeEngineHost nativeEngines;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Debug builds can be inspected from chrome://inspect
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        webView = new WebView(this);

        // Keep the page clear of the status bar, navigation bar and
        // keyboard, which Android 15 otherwise draws the app behind
        FrameLayout container = new FrameLayout(this);
        container.addView(webView);
        container.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Insets bars = insets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.ime()
                );
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(
                    insets.getSystemWindowInsetLeft(),
                    insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(),
                    insets.getSystemWindowInsetBottom()
                );
            }

            return insets;
        });

        setContentView(container);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);

        // The WebView has no Web Share API, so sharing goes through the
        // system share sheet. Only the bundled app is ever loaded.
        webView.addJavascriptInterface(new ShareBridge(), "AndroidShare");

        // Native Stockfish, run from the app's native library folder
        Map<String, String> enginePaths = findEngines();

        if (
            !enginePaths.isEmpty()
            && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
        ) {
            nativeEngines = new NativeEngineHost(enginePaths);

            WebViewCompat.addWebMessageListener(
                webView,
                "NativeEngine",
                Collections.singleton("https://" + HOST),
                nativeEngines
            );

            String engineNames = String.join(",", enginePaths.keySet());

            webView.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public String engines() {
                    return engineNames;
                }
            }, "NativeEngineInfo");
        }

        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/", this::loadAsset)
            .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(
                WebView view,
                WebResourceRequest request
            ) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(
                WebView view,
                WebResourceRequest request
            ) {
                Uri url = request.getUrl();
                if (HOST.equals(url.getHost())) return false;

                // Links to other sites open in the browser
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (ActivityNotFoundException ignored) {
                }

                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                WebView view,
                ValueCallback<Uri[]> callback,
                FileChooserParams params
            ) {
                if (fileChooserCallback != null) {
                    fileChooserCallback.onReceiveValue(null);
                }

                fileChooserCallback = callback;

                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");

                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (ActivityNotFoundException exception) {
                    fileChooserCallback = null;
                    return false;
                }

                return true;
            }
        });

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(START_URL);
        }
    }

    /**
     * Returns the native engines bundled with the app, by name. Lite uses
     * its dot product build where the CPU has those instructions.
     */
    private Map<String, String> findEngines() {
        File libraryDir = new File(getApplicationInfo().nativeLibraryDir);
        Map<String, String> engines = new LinkedHashMap<>();

        File full = new File(libraryDir, "libstockfish.so");
        if (full.exists()) engines.put("full", full.getPath());

        File liteDotProduct = new File(libraryDir, "libstockfish_lite_dotprod.so");
        File lite = new File(libraryDir, "libstockfish_lite.so");

        if (liteDotProduct.exists() && cpuHasFeature("asimddp")) {
            engines.put("lite", liteDotProduct.getPath());
        } else if (lite.exists()) {
            engines.put("lite", lite.getPath());
        }

        return engines;
    }

    private static boolean cpuHasFeature(String feature) {
        try (BufferedReader cpuInfo = new BufferedReader(new FileReader("/proc/cpuinfo"))) {
            String line;

            while ((line = cpuInfo.readLine()) != null) {
                if (!line.startsWith("Features")) continue;

                for (String name : line.substring(line.indexOf(':') + 1).trim().split("\\s+")) {
                    if (name.equals(feature)) return true;
                }
            }
        } catch (IOException ignored) {
        }

        return false;
    }

    private class ShareBridge {
        @JavascriptInterface
        public void shareText(String text) {
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType("text/plain");
            intent.putExtra(Intent.EXTRA_TEXT, text);

            runOnUiThread(() -> startActivity(Intent.createChooser(intent, null)));
        }
    }

    /**
     * Serves files from assets/www. Paths without a file extension are
     * app routes, which all render the analysis page.
     */
    private WebResourceResponse loadAsset(String path) {
        String lastSegment = path.substring(path.lastIndexOf('/') + 1);
        int extensionStart = lastSegment.lastIndexOf('.');

        String assetPath = extensionStart < 0 ? APP_PAGE : path;
        String extension = extensionStart < 0
            ? "html"
            : lastSegment.substring(extensionStart + 1).toLowerCase();

        String mimeType = MIME_TYPES.get(extension);
        if (mimeType == null) mimeType = "application/octet-stream";

        try {
            InputStream stream = getAssets().open("www/" + assetPath);
            return new WebResourceResponse(mimeType, null, stream);
        } catch (IOException exception) {
            return new WebResourceResponse(mimeType, null, 404, "Not Found", null, null);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode != FILE_CHOOSER_REQUEST || fileChooserCallback == null) return;

        fileChooserCallback.onReceiveValue(
            WebChromeClient.FileChooserParams.parseResult(resultCode, data)
        );
        fileChooserCallback = null;
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
            return;
        }

        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (nativeEngines != null) nativeEngines.stopAll();

        webView.destroy();
        super.onDestroy();
    }
}
