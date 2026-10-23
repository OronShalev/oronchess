using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace WintrChess
{
    /// <summary>
    /// Shows the analysis web app, served from the www folder next to the
    /// executable on a secure origin, so that its engine workers,
    /// WebAssembly and storage all work without a server.
    /// </summary>
    internal sealed class MainForm : Form
    {
        private const string Host = "wintrchess.local";
        private const string Origin = "https://" + Host;
        private const string StartUrl = Origin + "/analysis";
        private const string AppPage = "apps/features/analysis.html";

        private const string WebView2DownloadUrl =
            "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

        private static readonly Dictionary<string, string> MimeTypes =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                { ".html", "text/html" },
                { ".js", "text/javascript" },
                { ".css", "text/css" },
                { ".json", "application/json" },
                { ".wasm", "application/wasm" },
                { ".svg", "image/svg+xml" },
                { ".png", "image/png" },
                { ".gif", "image/gif" },
                { ".ico", "image/x-icon" },
                { ".ttf", "font/ttf" },
                { ".woff", "font/woff" },
                { ".woff2", "font/woff2" },
                { ".mp3", "audio/mpeg" },
                { ".txt", "text/plain" }
            };

        private readonly string assetRoot = Path.GetFullPath(
            Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "www")
        );

        private readonly WebView2 webView = new WebView2 { Dock = DockStyle.Fill };

        private CoreWebView2Environment environment;
        private NativeEngineHost nativeEngines;

        public MainForm()
        {
            Text = "WintrChess";
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            BackColor = Color.FromArgb(16, 18, 22);
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(1280, 860);
            MinimumSize = new Size(420, 600);

            webView.DefaultBackgroundColor = BackColor;
            Controls.Add(webView);

            Load += async (sender, args) => await InitialiseWebView();
        }

        private async System.Threading.Tasks.Task InitialiseWebView()
        {
            // Program Files is read only, so browser data lives with the user
            string userDataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "WintrChess",
                "WebView2"
            );

            try
            {
                environment = await CoreWebView2Environment.CreateAsync(
                    null, userDataFolder
                );

                await webView.EnsureCoreWebView2Async(environment);
            }
            catch (WebView2RuntimeNotFoundException)
            {
                DialogResult answer = MessageBox.Show(
                    "WintrChess needs the Microsoft Edge WebView2 Runtime, "
                        + "which is not installed. Open its download page?",
                    "WintrChess",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning
                );

                if (answer == DialogResult.Yes) OpenExternally(WebView2DownloadUrl);

                Close();
                return;
            }

            CoreWebView2 core = webView.CoreWebView2;

            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = true;

#if !DEBUG
            core.Settings.AreDevToolsEnabled = false;
#endif

            // Requests from engine workers must be served too
            core.AddWebResourceRequestedFilter(
                Origin + "/*",
                CoreWebView2WebResourceContext.All,
                CoreWebView2WebResourceRequestSourceKinds.All
            );

            core.WebResourceRequested += OnWebResourceRequested;

            // Links to other sites open in the browser
            core.NavigationStarting += (sender, args) =>
            {
                if (IsAppUrl(args.Uri)) return;

                args.Cancel = true;
                OpenExternally(args.Uri);
            };

            core.NewWindowRequested += (sender, args) =>
            {
                args.Handled = true;

                if (IsAppUrl(args.Uri)) core.Navigate(args.Uri);
                else OpenExternally(args.Uri);
            };

            // Native Stockfish, much faster than its WebAssembly builds
            Dictionary<string, string> enginePaths = FindEngines();

            if (enginePaths.Count > 0)
            {
                string engineList = string.Join(",", enginePaths.Keys.Select(name => "\"" + name + "\""));

                await core.AddScriptToExecuteOnDocumentCreatedAsync(
                    "window.__wintrNativeEngine = [" + engineList + "];"
                );

                nativeEngines = new NativeEngineHost(core, enginePaths, Host);
                FormClosed += (sender, args) => nativeEngines.Dispose();
            }

            core.DocumentTitleChanged += (sender, args) =>
            {
                Text = string.IsNullOrWhiteSpace(core.DocumentTitle)
                    ? "WintrChess"
                    : core.DocumentTitle;
            };

            core.Navigate(StartUrl);
        }

        [DllImport("kernel32.dll")]
        private static extern bool IsProcessorFeaturePresent(int feature);

        private const int PF_AVX2_INSTRUCTIONS_AVAILABLE = 40;

        /// <summary>
        /// Returns the native engines bundled with the app, by name. Lite uses
        /// its AVX2 build where the CPU has those instructions.
        /// </summary>
        private static Dictionary<string, string> FindEngines()
        {
            string enginesRoot = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "engines");
            Dictionary<string, string> engines = new Dictionary<string, string>();

            string full = Path.Combine(enginesRoot, "stockfish.exe");
            if (File.Exists(full)) engines["full"] = full;

            string liteAvx2 = Path.Combine(enginesRoot, "stockfish-lite-avx2.exe");
            string lite = Path.Combine(enginesRoot, "stockfish-lite.exe");

            if (File.Exists(liteAvx2) && IsProcessorFeaturePresent(PF_AVX2_INSTRUCTIONS_AVAILABLE))
            {
                engines["lite"] = liteAvx2;
            }
            else if (File.Exists(lite))
            {
                engines["lite"] = lite;
            }

            return engines;
        }

        private static bool IsAppUrl(string url)
        {
            return Uri.TryCreate(url, UriKind.Absolute, out Uri uri)
                && string.Equals(uri.Host, Host, StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Serves files from the www folder. Paths without a file extension
        /// are app routes, which all render the analysis page.
        /// </summary>
        private void OnWebResourceRequested(
            object sender,
            CoreWebView2WebResourceRequestedEventArgs args
        )
        {
            Uri uri = new Uri(args.Request.Uri);
            string path = Uri.UnescapeDataString(uri.AbsolutePath).TrimStart('/');

            string extension = Path.GetExtension(path);

            if (string.IsNullOrEmpty(extension))
            {
                path = AppPage;
                extension = ".html";
            }

            string filePath = Path.GetFullPath(Path.Combine(assetRoot, path));

            // Never serve anything outside the app's own files
            bool insideRoot = filePath.StartsWith(
                assetRoot + Path.DirectorySeparatorChar,
                StringComparison.OrdinalIgnoreCase
            );

            if (!insideRoot || !File.Exists(filePath))
            {
                args.Response = environment.CreateWebResourceResponse(
                    null, 404, "Not Found", ""
                );

                return;
            }

            if (!MimeTypes.TryGetValue(extension, out string mimeType))
            {
                mimeType = "application/octet-stream";
            }

            Stream stream = new FileStream(
                filePath, FileMode.Open, FileAccess.Read, FileShare.Read
            );

            args.Response = environment.CreateWebResourceResponse(
                stream, 200, "OK", "Content-Type: " + mimeType
            );
        }

        private static void OpenExternally(string url)
        {
            if (!Uri.TryCreate(url, UriKind.Absolute, out Uri uri)) return;
            if (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp) return;

            try
            {
                Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
            }
            catch (Exception)
            {
                // No browser to open it with
            }
        }
    }
}
