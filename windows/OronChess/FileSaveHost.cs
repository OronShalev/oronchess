using System;
using System.IO;
using System.Linq;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

namespace OronChess
{
    /// <summary>
    /// Saves files made in the app, such as game videos, which the page
    /// sends in base64 chunks over the WebView2 message channel:
    ///   file\tbegin\t&lt;name&gt;, file\tappend\t&lt;base64&gt;, file\tsave\t
    /// and answers with file\n&lt;saved|cancelled|failed&gt;\n&lt;path&gt;
    /// once the user has chosen where to save it.
    /// </summary>
    internal sealed class FileSaveHost
    {
        private readonly CoreWebView2 core;
        private readonly Form owner;

        private MemoryStream pending;
        private string pendingName;

        public FileSaveHost(CoreWebView2 core, Form owner)
        {
            this.core = core;
            this.owner = owner;

            core.WebMessageReceived += OnWebMessageReceived;
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
            if (parts.Length < 2 || parts[0] != "file") return;

            string argument = parts.Length > 2 ? parts[2] : "";

            switch (parts[1])
            {
                case "begin":
                    pending?.Dispose();
                    pending = new MemoryStream();
                    pendingName = GetSafeFileName(argument);
                    break;

                case "append":
                    try
                    {
                        byte[] bytes = Convert.FromBase64String(argument);
                        pending?.Write(bytes, 0, bytes.Length);
                    }
                    catch (FormatException)
                    {
                        pending?.Dispose();
                        pending = null;
                    }
                    break;

                case "save":
                    Save();
                    break;
            }
        }

        private void Save()
        {
            if (pending == null)
            {
                Reply("failed", "");
                return;
            }

            string extension = Path.GetExtension(pendingName);
            string kind = extension.TrimStart('.').ToUpperInvariant();

            using (SaveFileDialog dialog = new SaveFileDialog
            {
                FileName = pendingName,
                Filter = kind + " files (*" + extension + ")|*" + extension
                    + "|All files (*.*)|*.*",
                InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.MyVideos),
                OverwritePrompt = true,
                AddExtension = true
            })
            {
                if (dialog.ShowDialog(owner) != DialogResult.OK)
                {
                    Reply("cancelled", "");
                    return;
                }

                try
                {
                    File.WriteAllBytes(dialog.FileName, pending.ToArray());
                    Reply("saved", dialog.FileName);
                }
                catch (Exception exception) when (
                    exception is IOException || exception is UnauthorizedAccessException
                )
                {
                    Reply("failed", "");
                }
            }
        }

        private void Reply(string status, string path)
        {
            core.PostWebMessageAsString("file\n" + status + "\n" + path);
        }

        private static string GetSafeFileName(string name)
        {
            string safeName = new string(
                name.Where(character => !Path.GetInvalidFileNameChars().Contains(character)).ToArray()
            ).Trim();

            return string.IsNullOrEmpty(safeName) ? "oronchess" : safeName;
        }
    }
}
