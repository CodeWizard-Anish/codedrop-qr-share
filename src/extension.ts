import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import axios from "axios";
import FormData from "form-data";
import QRCode from "qrcode";

const SERVER = "https://codedrop-server.onrender.com";

export function activate(context: vscode.ExtensionContext) {

  const disposable = vscode.commands.registerCommand(
    "codedrop.sendFile",
    async (uri: vscode.Uri) => {

      try {
        /* -------- FILE -------- */

        let filePath: string | undefined;

        if (uri?.fsPath) {filePath = uri.fsPath;}
        else if (vscode.window.activeTextEditor)
          {filePath = vscode.window.activeTextEditor.document.uri.fsPath;}

        if (!filePath) {
          vscode.window.showErrorMessage("No file selected");
          return;
        }

        const fileName = path.basename(filePath);

        const stats = fs.statSync(filePath);

        if (stats.size > 10 * 1024 * 1024) {
          vscode.window.showErrorMessage("File exceeds 10MB limit");
          return;
        }

        /* -------- UPLOAD WITH PROGRESS -------- */

        const progressOptions = {
          location: vscode.ProgressLocation.Notification,
          title: "Uploading file...",
          cancellable: false
        };

        let response: any;

        await vscode.window.withProgress(progressOptions, async (progress) => {

          const form = new FormData();
          form.append("file", fs.createReadStream(filePath!));

          response = await axios.post(`${SERVER}/upload`, form, {
            headers: form.getHeaders(),
            maxBodyLength: Infinity,
            onUploadProgress: (p) => {
              const percent = Math.round((p.loaded / (p.total || 1)) * 100);
              progress.report({ message: `${percent}%` });
            }
          });

        });

        const { url, expiresAt } = response.data;

        /* -------- QR -------- */

        const qr = await QRCode.toDataURL(url);

        /* -------- WEBVIEW -------- */

        const panel = vscode.window.createWebviewPanel(
          "codedrop",
          "CodeDrop",
          vscode.ViewColumn.One,
          { enableScripts: true }
        );

        panel.webview.html = getHtml(qr, url, expiresAt);

        /* -------- LIVE STATS -------- */

        const interval = setInterval(async () => {
          try {
            const res = await axios.get(`${SERVER}/stats/${url.split("/").pop()}`);
            panel.webview.postMessage({
              type: "stats",
              downloads: res.data.downloads,
              expiresAt: res.data.expiresAt
            });
          } catch {}
        }, 3000);

        panel.onDidDispose(() => clearInterval(interval));

      } catch (err: any) {

        vscode.window.showErrorMessage(
          err.response?.data?.error || err.message
        );

      }
    }
  );

  context.subscriptions.push(disposable);
}

function getHtml(qr: string, url: string, expiresAt: number) {
  return `
  <body style="text-align:center;background:#111;color:white;font-family:Arial">
    <h1>📦 CodeDrop</h1>

    <img src="${qr}" width="220"/>

    <p>${url}</p>

    <button onclick="navigator.clipboard.writeText('${url}')">
      Copy Link
    </button>

    <h3 id="downloads">Downloads: 0</h3>
    <h3 id="timer"></h3>

    <script>
      const expiresAt = ${expiresAt};

      function updateTimer() {
        const diff = expiresAt - Date.now();

        if (diff <= 0) {
          document.getElementById("timer").innerText = "Expired";
          return;
        }

        const min = Math.floor(diff / 60000);
        const sec = Math.floor((diff % 60000) / 1000);

        document.getElementById("timer").innerText =
          "Expires in: " + min + "m " + sec + "s";
      }

      setInterval(updateTimer, 1000);
      updateTimer();

      window.addEventListener("message", (event) => {
        const msg = event.data;

        if (msg.type === "stats") {
          document.getElementById("downloads").innerText =
            "Downloads: " + msg.downloads;
        }
      });
    </script>
  </body>
  `;
}

export function deactivate() {}