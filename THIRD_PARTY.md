# Third party software

## Stockfish

The Android and Windows apps include two native builds of **Stockfish 19**, used for
game analysis:

- **Stockfish 19**: the official release builds `stockfish-android-arm64-universal`
  and `stockfish-windows-x86-64-universal`.
  - Release: https://github.com/official-stockfish/Stockfish/releases/tag/sf_19
  - Source code: https://github.com/official-stockfish/Stockfish/tree/sf_19
- **Stockfish 19 Lite**: built from the Stockfish.js engine source at commit
  `10b49d8bb4539a0743013772ed735a63853a3b05` with its small network
  `nn-61e7af4bb97d.nnue`, the same engine as the web app's Lite engine.
  - Source code: https://github.com/nmrugg/stockfish.js/tree/10b49d8bb4539a0743013772ed735a63853a3b05
  - Changes for native builds: `native/stockfish-lite.patch` in this repository
  - Build script: `native-stockfish.mjs` in this repository (compiled with Zig 0.13.0)

The web app uses Stockfish 19 compiled to WebAssembly by
[Stockfish.js](https://github.com/nmrugg/stockfish.js).

Stockfish and Stockfish.js are licensed under the GNU General Public License v3.0.
WintrChess itself is licensed under the GNU General Public License v3.0; see `LICENSE`.
