<h1 align="center">
    <img width="120" src="app/public/img/logo.svg" />
    <br>
    OronChess
</h1>

<p align="center">
    Chess game reviews with move classifications, powered by Stockfish.
    Runs in the browser, and as Android and Windows apps.
</p>

## ✨ Features

- Full game reviews with Brilliant, Critical, Best, Inaccuracy, Mistake and Blunder moves, accuracies and an evaluation graph
- Games from PGN, FEN, Chess.com or Lichess
- Live engine analysis while exploring moves
- Share a review as a short `oronchess-…` code, and open it on any device with no engine run
- Android and Windows apps that run Stockfish natively, several times faster than in the browser

## 📂 Project

#### `app/`
The web app, in TypeScript:

- `app/src/client`: the React frontend. Import with `@client/...`.
- `app/src/server`: the Express server that serves the app. Import with `@server/...`.
- `app/src/shared`: types and common logic, like the move classifier. Import with `@shared/...`.
- `app/public`: static files: HTML pages, images, translations and the Stockfish engines.

#### `android/`
The Android app: the web app in a WebView, with native Stockfish. Build with `node android/build-apk.mjs`.

#### `windows/`
The Windows app: the web app in WebView2, with native Stockfish, and its installer. Build with `node windows/build-exe.mjs`.

#### `native/`, `native-stockfish.mjs`
Native Stockfish programs for the apps: the official Stockfish 19 release, and Stockfish 19 Lite built from source. See `THIRD_PARTY.md`.

## 📚 Documentation

[Hosting OronChess](docs/hosting.md)

[Contributing to the project](docs/contributing.md)

## 📄 License

GNU General Public License v3.0; see `LICENSE`.
