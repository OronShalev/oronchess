using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

namespace WintrChess
{
    /// <summary>
    /// Runs Stockfish as native processes for the page, which is much faster
    /// than its WebAssembly builds. The page talks to it through WebView2
    /// messages:
    ///
    ///   to here:  "start|send|stop \t id \t line"
    ///   to page:  "id \n line \n line ..." or "id \n !message" on failure
    ///
    /// Messages arrive on the UI thread, where all engine bookkeeping stays.
    /// </summary>
    internal sealed class NativeEngineHost : IDisposable
    {
        // Output is batched so that the page is not messaged for every line
        private const int FlushIntervalMs = 15;

        private readonly CoreWebView2 core;
        private readonly string enginePath;
        private readonly Dictionary<string, EngineProcess> engines =
            new Dictionary<string, EngineProcess>();

        private readonly Timer flushTimer = new Timer { Interval = FlushIntervalMs };

        public NativeEngineHost(CoreWebView2 core, string enginePath, string appHost)
        {
            this.core = core;
            this.enginePath = enginePath;

            core.WebMessageReceived += OnWebMessageReceived;

            // Engines of a page that is left or reloaded are not needed.
            // Links to other sites open in the browser and leave it be
            core.NavigationStarting += (sender, args) =>
            {
                bool appPage = Uri.TryCreate(args.Uri, UriKind.Absolute, out Uri uri)
                    && string.Equals(uri.Host, appHost, StringComparison.OrdinalIgnoreCase);

                if (appPage) StopAll();
            };

            flushTimer.Tick += (sender, args) => Flush();
            flushTimer.Start();
        }

        private void OnWebMessageReceived(
            object sender,
            CoreWebView2WebMessageReceivedEventArgs args
        )
        {
            string message;

            try
            {
                message = args.TryGetWebMessageAsString();
            }
            catch (ArgumentException)
            {
                return;
            }

            string[] parts = message.Split(new[] { '\t' }, 3);
            if (parts.Length < 2) return;

            string id = parts[1];
            string line = parts.Length > 2 ? parts[2] : "";

            switch (parts[0])
            {
                case "start":
                    Start(id);
                    break;
                case "send":
                    if (engines.TryGetValue(id, out EngineProcess engine)) engine.Send(line);
                    break;
                case "stop":
                    Stop(id);
                    break;
            }
        }

        private void Start(string id)
        {
            Stop(id);

            try
            {
                engines[id] = new EngineProcess(enginePath);
            }
            catch (Exception exception)
            {
                core.PostWebMessageAsString(id + "\n!" + exception.Message);
            }
        }

        private void Stop(string id)
        {
            if (!engines.TryGetValue(id, out EngineProcess engine)) return;

            engines.Remove(id);
            engine.Stop();
        }

        public void StopAll()
        {
            foreach (EngineProcess engine in engines.Values) engine.Stop();
            engines.Clear();
        }

        private void Flush()
        {
            foreach (KeyValuePair<string, EngineProcess> entry in engines)
            {
                string output = entry.Value.TakeOutput();
                if (output == null) continue;

                core.PostWebMessageAsString(entry.Key + output);
            }
        }

        public void Dispose()
        {
            flushTimer.Dispose();
            StopAll();
        }

        private sealed class EngineProcess
        {
            private readonly Process process;
            private readonly ConcurrentQueue<string> pendingLines =
                new ConcurrentQueue<string>();

            private volatile bool stopped;

            public EngineProcess(string path)
            {
                process = new Process
                {
                    StartInfo = new ProcessStartInfo(path)
                    {
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        RedirectStandardInput = true,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true
                    },
                    EnableRaisingEvents = true
                };

                process.OutputDataReceived += (sender, args) =>
                {
                    if (args.Data != null) pendingLines.Enqueue(args.Data);
                };

                process.Exited += (sender, args) =>
                {
                    if (!stopped) pendingLines.Enqueue("!engine stopped");
                };

                process.Start();
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
            }

            /// <summary>
            /// Returns the lines output since the last call, each prefixed
            /// with a newline, or null if there are none.
            /// </summary>
            public string TakeOutput()
            {
                if (pendingLines.IsEmpty) return null;

                StringBuilder output = new StringBuilder();

                while (pendingLines.TryDequeue(out string line))
                {
                    output.Append('\n').Append(line);
                }

                return output.ToString();
            }

            public void Send(string line)
            {
                try
                {
                    process.StandardInput.WriteLine(line);
                    process.StandardInput.Flush();
                }
                catch (Exception)
                {
                    // The exit handler reports the engine as stopped
                }
            }

            public void Stop()
            {
                stopped = true;

                try
                {
                    process.Kill();
                }
                catch (Exception)
                {
                    // Already exited
                }

                process.Dispose();
            }
        }
    }
}
