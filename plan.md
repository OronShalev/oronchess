# Speed up OronChess review, keep the brilliancies

## Implementation status and measured results (2026-10-14)

The plan below has been implemented on branch `analysis-only` (uncommitted). It was validated with a benchmark harness that runs the real app code against the code at `HEAD`. The new pipeline is faster in every measurement and at least as accurate on every quality measure:

| Measure | `HEAD` | Now |
|---|---|---|
| Full review in Chrome, 6 games, same conditions, runs alternated | 145.4 s | **43.8 s (3.3× faster)** |
| Re-review of an already analysed game | same as first | **0.5–0.7 s** (IndexedDB cache) |
| Engine time, 20 games, Node harness | 322 s | **132 s (2.44×)** |
| Slowest of those 20 games | 33.1 s | **11.5 s** |
| Main thread CPU per game | 6.1 s | **1.3 s** |
| Classification per game | 1,730 ms + server round trip | **250 ms, in the browser** |
| Labels agreeing with deep reference (4,185 moves) | 81.41% | **81.34%** (paired: 315 vs 312, a tie) |
| Critical found / missed / extra (vs reference) | 51 / 9 / 3 | **57 / 3 / 6** |
| Brilliant found (vs reference) | 9 of 10 | 9 of 10, the same 9 moves |
| Point-loss error vs reference (mean absolute) | 0.0085 | 0.0086 |

### What changed, by plan step

| Step | Status | Where |
|---|---|---|
| 0 Harness | Done. `npm run bench:review` (in `app/`) plus `compare.mjs`, `replay.mjs`, `reference.mjs`, `corpus.mjs` | [app/scripts/review-bench/](app/scripts/review-bench/) |
| 1 Parse once, final lines only, throttled UI | Done. Batch searches keep the latest `info` per depth/line and convert only the deepest complete set to SAN, using move objects. Bound lines are skipped, there is no per-ply prefix replay, and progress is throttled to 150 ms | [engine.ts](app/src/client/apps/features/analysis/lib/engine.ts), [useEvaluateGame.ts](app/src/client/apps/features/analysis/hooks/useEvaluateGame.ts) |
| 2 Realtime engine paused during review; workers terminated | Done. Verified in Chrome: 0 realtime searches during review, 8/8 workers terminated (`HEAD`: 1 search, 0/4 terminated) | [RealtimeEngine](app/src/client/apps/features/analysis/components/RealtimeEngine/index.tsx), [RealtimeEngineArea](app/src/client/apps/features/analysis/components/AnalysisPanel/RealtimeEngineArea/index.tsx) |
| 3 Pool sized to the device, Hash set, `isready` | Done. `clamp(cores − 1, 1, 8)`, 4 on mobile, 2 on iOS, 4 for the full net; Hash 32 MB (16 on mobile) | [hardware.ts](app/src/client/apps/features/analysis/lib/hardware.ts) |
| 4 Cloud never blocks engines | Done. The first plies (up to 16) are left to cloud lookups while engines start on the rest. Lookups use `multiPv=1`, URL-encode the FEN, and stop on any error, including 429 | [evaluate.ts](app/src/client/apps/features/analysis/lib/evaluate.ts), [cloudEvaluate.ts](app/src/client/apps/features/analysis/lib/cloudEvaluate.ts) |
| 5 Classify in the browser | Done. Server route removed; reporter extracts each node once | [reporter.ts](app/src/client/apps/features/analysis/lib/reporter.ts), [report.ts](app/src/shared/lib/reporter/report.ts) |
| 6 Contiguous segments + work stealing | Done, walked **forwards**, not backwards (see below) | [evaluate.ts](app/src/client/apps/features/analysis/lib/evaluate.ts) |
| 7 Second line only where a label can use it | Done, with a MultiPV 2 re-search instead of the exclusion search (see below) | [secondLine.ts](app/src/shared/lib/reporter/utils/secondLine.ts), [evaluate.ts](app/src/client/apps/features/analysis/lib/evaluate.ts) |
| 8 IndexedDB cache | Done. Keyed by position + engine settings. Positions that repeat earlier in the game or are near the 50-move rule are not cached. One transaction per game; capped at 10,000 positions | [evalCache.ts](app/src/client/apps/features/analysis/lib/evalCache.ts) |
| 9 Skip trivial positions | Done. No-legal-move positions get the depth-0 line; one-legal-move positions take the next position's line (mate counts adjusted) | [evaluate.ts](app/src/client/apps/features/analysis/lib/evaluate.ts) |
| 10 Search budget | Node cap on review searches: 2M nodes at depth 16, scaled 1.6× per ply of the depth setting (`getSearchNodeLimit`). The live engine panel is not capped | [evaluate.ts](app/src/client/apps/features/analysis/lib/evaluate.ts), [useEvaluateGame.ts](app/src/client/apps/features/analysis/hooks/useEvaluateGame.ts) |
| Extra | Brilliant piece-safety analysis is 8.1× faster with identical output (moves are generated only from attacking squares, in chess.js order) | [attackers.ts](app/src/shared/lib/reporter/utils/attackers.ts) |

**How step 7 works.**
- Every position is searched with MultiPV 1.
- When a move and its parent both have a top line, the gate classifies the move against the second line most favourable to an upgrade: the mover being mated. The second line is only read to award Critical or Brilliant, so if neither label appears, no real second line can produce one.
- Only gated parents are searched again with MultiPV 2: about 10% of moves, 0.14 extra searches per ply. Those two lines replace the MultiPV 1 line.
- The gate reuses `classify()` itself, so it cannot drift out of sync with the classifier.

### Decisions the measurements forced (deviations from the plan)

1. **Step 7: MultiPV 2 re-search instead of an exclusion search.**
   - The exclusion search is cheaper: 1.13× a warm MultiPV 1 search, against 1.82× for MultiPV 2.
   - But its line 2 scored systematically worse for the mover, which inflated Critical counts.
   - The re-search gives gated positions exactly the old pipeline's data, for about 7% more engine time.
2. **Step 6: forward segments, not backward.**
   - Searching a parent right after its child (backward) pulls the parent's choice of best move towards the move actually played, through the transposition table. The "top move played" decision agreed with the reference only 87.4% of the time, against 89.0% for `HEAD`, and label agreement fell to 80.4%.
   - Interleaving positions across engines removed that bias (88.5%) but lost the hash benefit (point-loss error 0.0090).
   - Forward segments search each parent before its child: no bias, hash reuse kept, and 81.3% agreement.
3. **Step 10: node cap enabled.**
   - Rare search explosions dominated per-game time. One position took 16 s at MultiPV 1 and 60 s at MultiPV 2: depth 15 needed 8.5M nodes in a position where one side was 20 pawns up.
   - A 2M-node cap, twice Lichess's 1M nodes per move, changed no quality measure. It cut the slowest game from 35.9 s to 11.5 s.

### Validation

- **MultiPV cost:** at depth 16 on SF19 Lite, MultiPV 2 costs 2.10× MultiPV 1 (60 positions, cold hash).
- **Zero-risk checks:**
  - Replaying 4,185 recorded moves through the `HEAD` and current reporters gave 0 label and 0 accuracy differences.
  - An exhaustive comparison of `getAttackingMoves`, `getDefendingMoves` and `getUnsafePieces` over every piece of 1,351 positions (35,113 checks) found 0 differences.
  - The gate selected the parent of 63/63 recorded Brilliant and Critical moves.
- **Noise floor:** two runs of the `HEAD` pipeline agree on only 85.9% of labels, because worker assignment changes hash contents. 32 Critical labels appear in only one of the two runs.
- **Plan gate (at least 95% recall of stable baseline positives):** Critical 22/23 (95.7%), Brilliant 3/3. Brilliant is also identical to `HEAD` on all 60 games (the same 9 moves).
- **Deep reference:** MultiPV 2 at 1.5M nodes per position (about 7× the depth-16 budget), 60 games, 4,185 moves, stratified over 5 rating bands. Against it:

| Variant | Agreement | Paired vs `HEAD` (HEAD-only right / variant-only right) | Critical found / missed / extra | Brilliant | Point-loss error | Engine time (20 games) |
|---|---|---|---|---|---|---|
| `HEAD` | 81.41% | – | 51 / 9 / 3 | 9/10 | 0.0085 | 322 s |
| Backward segments | 80.38% | 358 / 315 | 57 / 3 / 6 | 9/10 | 0.0086 | 149 s |
| Interleaved | 80.22% | 359 / 309 | 57 / 3 / 8 | 9/10 | 0.0090 | – |
| Backward, depth 17 | 80.84% | 367 / 343 | 56 / 4 / 9 | 9/10 | 0.0085 | 217 s |
| Forward segments | 81.31% | 315 / 311 | 55 / 5 / 7 | 9/10 | 0.0086 | 163 s |
| **Forward + node cap (shipped)** | **81.34%** | **315 / 312** | **57 / 3 / 6** | **9/10** | **0.0086** | **132 s** |

- **The one Brilliant the reference has and both pipelines lack** (game 5yfj2fdk, ply 88) is missed by `HEAD` too. It is a depth-16 limit, not a regression.
- **Player-accuracy deviation** from the reference is 0.595 against 0.568 for `HEAD` on the same 30 games. That is within the 0.034 by which the two `HEAD` runs differ from each other.

### Caveats and follow-ups

- The opening table (374 KB raw) now ships to the browser, because classification runs there.
- Nodes that only got one line show that line from the cache and fill line 2 with a live search when browsed after the review.
- Timings come from one 6-core/12-thread Windows desktop. Mobile pool sizes follow Chesskit's and Lichess's limits but were not measured on a phone.
- Lichess rate-limits cloud lookups. One 429 appeared after many test runs; the review then continued locally.

**Reproducing.** Build a corpus from a Lichess database dump with `node scripts/review-bench/corpus.mjs lichess_db.pgn corpus.json 60`. Then:
- Run `npm run bench:review -- --corpus corpus.json --out new.json --node-limit 2000000`.
- Add `--pipeline baseline` to benchmark `HEAD`, and use `reference.mjs` to build the deep reference.
- Compare with `node scripts/review-bench/compare.mjs --baseline a.json --baseline2 b.json --candidate new.json`.

---

## Original research and plan

OronChess's game review can get substantially faster without touching how it decides Brilliant or Critical moves. Most of the waste is around the engine, not inside the search. Today the app makes up to 15+ serial Lichess cloud requests before any engine starts. It hard-codes 4 workers regardless of the CPU. It hands consecutive plies to different workers, so the transposition table is rarely reused. It parses and converts every intermediate `info` line to SAN and re-renders React for each one. It then ships everything to the server for classification. Fixing all of that leaves the engine output, and therefore every label, unchanged or changed only at noise level. The one large engine-side saving, running MultiPV 2 everywhere for a second line that is only read on a minority of moves, can be captured safely. The trick is to stop reducing MultiPV globally and instead **compute the second line only on the parents of moves that could become Brilliant or Critical**. The current classifier reads PV2 nowhere else, and reads only its first move and score even there. The naive alternatives are what break things. MultiPV 1 everywhere makes Critical impossible and weakens Brilliant's "already winning anyway" guard. A lower depth or a time limit shifts moves across the classifier's fixed expected-points thresholds, and can silently drop the second line. The plan below orders the work from zero-risk quick wins to the gated-second-line change. It is wrapped in a before/after benchmark that measures the engine's own run-to-run noise first, so each change can be judged against that floor rather than against perfection.

Code paths in this report are relative to the repository root (`C:/Users/orons/Desktop/oronchess`, branch `analysis-only`). Speed figures marked "estimate" are inferences from the cited data and from reading the code. No part of this pipeline has been profiled yet, which is why Step 0 of the plan is measurement.

## Stockfish buys accuracy with nodes, and MultiPV taxes every node

Stockfish searches a game tree with alpha-beta and iterative deepening. It searches to depth 1, then 2, then 3, and reports an `info depth N … score … pv …` line at each iteration. Its "depth" is "the counter of the iterative deepening loop at the root", which is "a useful guide but not a strict guarantee that you've examined every move to that ply" ([Stockfish FAQ](https://official-stockfish.github.io/docs/stockfish-wiki/Stockfish-FAQ.html)). Positions it has already searched are stored in a **transposition table (the "Hash" option, default 16 MB)** ([engine.cpp](https://raw.githubusercontent.com/official-stockfish/Stockfish/master/src/engine.cpp)). The table persists between searches, so a search of a related position starts with useful knowledge ([Stockfish discussion #4998](https://github.com/official-stockfish/Stockfish/discussions/4998)). Evaluation at the leaves comes from an NNUE network. In the browser this is either a ~94-99 MB "full" net or a ~1-1.7 MB "lite/smallnet". Both nmrugg's stockfish.js and Lichess default to the small one, because the full one "can be very slow to load" ([nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js); [lila engines.ts](https://raw.githubusercontent.com/lichess-org/lila/master/ui/lib/src/ceval/engines/engines.ts)). OronChess ships exactly these two single-threaded Stockfish 19 builds and defaults to Lite ([EngineVersion.ts](app/src/shared/constants/EngineVersion.ts); [SettingsStore.ts](app/src/client/stores/SettingsStore.ts)).

Three properties of the search drive everything that follows.

**Depth has steeply diminishing returns.** Each extra ply is worth about +162 Elo at depth 10, +89 at depth 12 and +52 at depth 18 ([Stockfish wiki, Useful data](https://raw.githubusercontent.com/wiki/official-stockfish/Stockfish/Useful-data.md)). That is why the big services budget *nodes*, not depth. Lichess server analysis runs **1,000,000 nodes per move** for user requests, and only 100k-300k for automated passes ([lila Work.scala](https://raw.githubusercontent.com/lichess-org/lila/master/modules/fishnet/src/main/Work.scala)). Chess.com says it sees "diminishing returns in engine quality as depth gets past the low 20's" ([Chess.com Help: engines](https://support.chess.com/en/articles/9462780-how-do-the-chess-engines-on-chess-com-work)).

**MultiPV is not free.** To score the second-best move exactly, the engine gives up the narrow search windows that make single-PV search fast, so each extra line effectively needs its own search ([TalkChess, Lefler](https://talkchess.com/viewtopic.php?p=827156)). At equal time, MultiPV 2 costs **-97 Elo**, MultiPV 3 -157 and MultiPV 5 -235 ([Stockfish wiki, Useful data](https://raw.githubusercontent.com/wiki/official-stockfish/Stockfish/Useful-data.md)). The official advice is to "set it to 1" unless you need the other lines ([Stockfish FAQ](https://official-stockfish.github.io/docs/stockfish-wiki/Stockfish-FAQ.html)). Developers' rough figure is that a single-PV search spends 30-40% of its time on the best move, and that time-to-depth roughly doubles by MultiPV 3-4 ([TalkChess, Muller](https://talkchess.com/viewtopic.php?p=827436)). The flip side matters for this app: **at a fixed depth, MultiPV 2 is a *stronger* search** (+46 Elo at depth 18), because each depth costs more nodes ([Stockfish wiki, Useful data](https://raw.githubusercontent.com/wiki/official-stockfish/Stockfish/Useful-data.md)). "Depth 16, MultiPV 2" and "depth 16, MultiPV 1" are therefore not the same quality of evaluation.

**Parallelism has two shapes.** One engine with N threads (Lazy SMP) reaches about 82% efficiency at 8 threads natively, but it is non-deterministic ([Stockfish wiki, Useful data](https://raw.githubusercontent.com/wiki/official-stockfish/Stockfish/Useful-data.md); [CPW Lazy SMP](https://www.chessprogramming.org/Lazy_SMP)). In WASM it also needs SharedArrayBuffer, which requires COOP/COEP headers ([nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js)). N single-threaded workers on N independent positions avoid both costs. Every position in a game review is an independent job, so worker-per-position parallelism is the natural fit. Its weakness is that each worker's hash knows nothing about its neighbours' positions. Lichess's fishnet and En Croissant both recover hash reuse by **analysing backwards**: fishnet reverses the game into overlapping chunks of 6 positions ([fishnet queue.rs](https://github.com/lichess-org/fishnet/blob/main/src/queue.rs)), and En Croissant says reversed order is "faster and more consistent" ([En Croissant docs](https://encroissant.org/docs/guides/analyze-game)). Neither publishes a measured speedup.

## Brilliant and Critical need line 2 on one position, not everywhere

Every modern game review follows the same recipe. Score each position with the engine, convert scores to a win probability, and label each move by how much probability it threw away. Chess.com's "Classification V2" uses rating-dependent Expected Points, with bands from Best (0) through Blunder (>0.20) ([Chess.com Help](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-and-etc)). Lichess uses Win% drops of 5/10/15 points for Inaccuracy, Mistake and Blunder, with MultiPV 1 and no brilliant class at all ([lila Advice.scala](https://github.com/lichess-org/lila/blob/master/modules/tree/src/main/Advice.scala)). The special labels are where the second line comes in. Chess.com's Brilliant is "a good piece sacrifice" that is best or nearly best, does not leave you worse, and was needed because you "should not be completely winning even if you hadn't found the move". Its Great is the "only good move", or a move that flips the result ([Chess.com Help](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-and-etc)). Both "if you hadn't found it" tests require the **second-best move's evaluation**. That is why OronChess, Chesskit and En Croissant all run MultiPV ≥ 2 ([Chesskit moveClassification.ts](https://github.com/GuillaumeSD/Chesskit/blob/main/src/lib/engine/helpers/moveClassification.ts); [En Croissant chess.rs](https://github.com/franciscoBSalgueiro/en-croissant/blob/master/src-tauri/src/chess.rs)).

OronChess's classifier lives in `app/src/shared/lib/reporter` and decides in a fixed order ([classify.ts](app/src/shared/lib/reporter/classify.ts)):

1. **FORCED** if the parent had at most one legal move.
2. **THEORY** if the resulting FEN is in the bundled opening table.
3. **BEST** for checkmate.
4. **BEST** if the played SAN equals the parent's top-line first move. Otherwise it applies expected-points bands of 0.01 / 0.045 / 0.08 / 0.12 / 0.22, using `1/(1+e^(-0.0035·cp))` ([pointLoss.ts](app/src/shared/lib/reporter/classification/pointLoss.ts); [expectedPoints.ts](app/src/shared/lib/reporter/expectedPoints.ts)).
5. **Critical**, OronChess's "great"/only-move label, only when the top move was played, line 2 exists, and the parent's line 1 beats line 2 by **at least 0.10 expected points** ([critical.ts](app/src/shared/lib/reporter/classification/critical.ts)).
6. **Brilliant** for any move already rated ≥ BEST. This covers the top move, Critical, or a non-top move that lost under 0.01. The move must also leave a non-pawn piece "unsafe" under static chess.js heuristics (attackers, defenders, x-rays, danger levels, trapped pieces) ([brilliant.ts](app/src/shared/lib/reporter/classification/brilliant.ts)).

Both special labels pass through `isMoveCriticalCandidate`. That gate rejects the move when line 2 is still ≥ +700 cp for the mover, when the mover is losing after the move, when the move is a queen promotion, or when the mover started in check. Without line 2 it falls back to the played move's own eval for the +700 test ([criticalMove.ts](app/src/shared/lib/reporter/utils/criticalMove.ts)).

| Label | Engine data actually read | Works with MultiPV 1? |
|---|---|---|
| FORCED, THEORY | None (legal-move count, opening table) | Yes |
| BEST … BLUNDER | Parent line 1 (eval + first move), child line 1 (eval) | Yes |
| Critical | Additionally **parent line 2 eval** at the same depth and source as line 1 | **No — never fires** |
| Brilliant | Parent line 2 eval for the +700 guard, plus static board heuristics | Fires, but the "already winning anyway" guard is wrong |

Four details in this table shape the safe design. First, **PV moves beyond the first are never read** by the reporter, so all the per-depth PV-to-SAN conversion only serves the UI ([extractNode.ts](app/src/shared/lib/reporter/utils/extractNode.ts)). Second, **line 2 is only read on the parent of a move rated ≥ BEST** that is not FORCED, THEORY or checkmate. Every other position needs only line 1. Top-move match rates for human players are around 33-41% ([Lichess blog, citing the Maia study](https://bg.lichess.org/@/ijh/blog/flaws-in-pgn-spy-and-t-analysis/utfuCZNv)), so on most plies line 2 is computed and thrown away. Third, line 2 must be a **sibling** of line 1: same `depth`, same `source`, `index 2`. The top line is chosen as `maxBy(depth − index)` ([EngineLine.ts](app/src/shared/types/game/position/EngineLine.ts)). So any extra line set appended at a different depth or source silently hides line 2, and Critical quietly returns false. Fourth, the classifier never checks depth. Depth matters only through which move ends up "top" and where scores land relative to the absolute thresholds.

## Four workers, a serial cloud prefix, and a React render per info line

Read end to end, the current pipeline looks like this. Clicking Analyse imports the game and calls `createGameEvaluator`. The evaluator first asks Lichess's cloud-eval API about each mainline position **one awaited request at a time from move 0**. It stops at the first miss, the first result shallower than the configured depth, or the first result with fewer than `lines` PVs ([evaluate.ts](app/src/client/apps/features/analysis/lib/evaluate.ts); [cloudEvaluate.ts](app/src/client/apps/features/analysis/lib/cloudEvaluate.ts)). Only then does it start `min(4, remaining+1)` Workers. The 4 is hard-coded ([useEvaluateGame.ts](app/src/client/apps/features/analysis/hooks/useEvaluateGame.ts)). The workers pull positions from a shared forward counter, so worker k sees roughly plies k, k+4, k+8. Each position is sent as `position fen <start> moves <whole game prefix>` plus `go depth 16` with MultiPV 2 ([engine.ts](app/src/client/apps/features/analysis/lib/engine.ts)). When all positions are done, the client `cloneDeep`s the tree with every intermediate line. It trims each node to two lines, POSTs it to `/api/analysis/analyse`, and the server runs `getGameAnalysis`. The client then restores engine lines with a per-node DFS ([StateTreeNode.ts](app/src/shared/types/game/position/StateTreeNode.ts); [analyse.ts](app/src/server/routes/api/analysis/analyse.ts); [useAnalyseGame.ts](app/src/client/apps/features/analysis/hooks/useAnalyseGame.ts)).

The overheads around the search are where the easy time is.

**Serial cloud blocking.** No engine starts until the cloud prefix ends, and one rare move order forfeits every later cloud hit. Requesting `multiPv=2` also makes truncation more likely. Lichess returns the deepest eval only for `multiPv=1`, and higher counts "often mean lower depth" ([lila issue #14278](https://github.com/lichess-org/lila/issues/14278)).

**Wasted cores and no hash locality.** The `threads` setting exists but is never read, `setThreadCount` is never called, and no `Hash`, `isready` or `ucinewgame` is ever sent ([SettingsStore.ts](app/src/client/stores/SettingsStore.ts); [engine.ts](app/src/client/apps/features/analysis/lib/engine.ts)). Round-robin forward scheduling defeats the transposition table that fishnet and En Croissant deliberately exploit ([fishnet queue.rs](https://github.com/lichess-org/fishnet/blob/main/src/queue.rs)).

**Main-thread churn.** Every `info depth` line at every depth and PV index is parsed and replayed on a fresh chess.js board to build SAN. It is appended to the node, never de-duplicated. It also triggers `setEvaluationProgress` plus `dispatchCurrentNodeUpdate()`, which re-renders the report tab's accuracy, graph and count card ([engine.ts](app/src/client/apps/features/analysis/lib/engine.ts); [useEvaluateGame.ts](app/src/client/apps/features/analysis/hooks/useEvaluateGame.ts); [AnalysisBoardStore.ts](app/src/client/apps/features/analysis/stores/AnalysisBoardStore.ts)). At the defaults, an 80-ply game produces on the order of 2,500 such lines (estimate). Each worker only gets its next position after the main thread handles its `bestmove`, so a busy main thread idles the engines too. Lichess throttles engine UI updates to 125 ms and Chesskit to 60 ms ([lila ctrl.ts](https://github.com/lichess-org/lila/blob/master/ui/lib/src/ceval/ctrl.ts); [Chesskit uciEngine.ts](https://github.com/GuillaumeSD/Chesskit/blob/main/src/lib/engine/uciEngine.ts)).

**Duplicated or competing work.** The last cloud-covered node is re-searched locally ("add 1 for cutoff"), yet its deeper cloud line still wins `getTopEngineLine`, so that search is wasted ([evaluate.ts](app/src/client/apps/features/analysis/lib/evaluate.ts)). The realtime engine mounts as soon as the analysis panel opens, which happens before batch evaluation starts. It runs a full search on the root position alongside the batch workers. Its effect does not re-check cached lines when they arrive ([useImportGame.ts](app/src/client/apps/features/analysis/hooks/useImportGame.ts); [RealtimeEngine/index.tsx](app/src/client/apps/features/analysis/components/RealtimeEngine/index.tsx)). `terminate()` posts `quit` but never calls `Worker.terminate()`. There is no cache, so re-opening a game redoes everything ([engine.ts](app/src/client/apps/features/analysis/lib/engine.ts)).

**Round trip for classification.** The reporter imports only chess.js, lodash and JSON, so it already runs anywhere. Shipping it to the server costs a serialize, an HTTP round trip and an O(n²) restore. It also computes the extractions and opening lookups twice per node ([report.ts](app/src/shared/lib/reporter/report.ts)).

## The naive shortcuts each break a label in a specific way

**MultiPV 1 everywhere.** Critical can never fire, because critical.ts returns false without `secondTopLine`. Brilliant's +700 guard falls back to the played move's eval, so it awards Brilliant in positions where another move also won by +7. The UI already warns "At least 2 lines are required for Critical and some Brilliant moves" ([analysis.json](app/public/locales/en/analysis.json); [ClassificationOptionsArea](app/src/client/apps/features/analysis/components/SettingsDialog/ClassificationOptionsArea/index.tsx)).

**Lower depth.** Labels shift across the absolute thresholds: 0.01 for BEST, 0.10 for the Critical gap, 700 cp for the winning cutoff. "Top move played" is an exact SAN match at the chosen depth, so a shallower search changes which move is "best". It also hits Brilliant hardest, because a sacrifice's justification is often invisible at low depth. jk_182's experiments found that low-depth evaluations miss the point of tactics and produce false positives in endgames ([jk_182 blog](https://lichess.org/@/jk_182/blog/using-stockfish-to-automatically-find-tactics-puzzles/wyfoi3Id)). No published study measures label agreement between shallow and deep settings ([arXiv 1607.04186](https://arxiv.org/pdf/1607.04186) used depth 20 without a depth comparison). This has to be measured in-house.

**A time limit (`movetime`).** It makes quality device-dependent. It also has a quieter failure: if the clock cuts an iteration after PV 1 but before PV 2 at the deepest depth, the top line has no sibling and Critical silently becomes false for that node ([engine.ts](app/src/client/apps/features/analysis/lib/engine.ts); [EngineLine.ts](app/src/shared/types/game/position/EngineLine.ts)).

**Mixing sources or depths on one node.** A gated design that adds a local line 2 next to a deeper cloud line 1 breaks the sibling rule. So does appending a pass-2 MultiPV-2 set beside a pass-1 single line at a different depth. Any node that gets a second line must have its line set **replaced, not appended**.

**Gating only on "top move played".** Brilliant also fires on non-top moves that lost under 0.01, so a gate keyed only on PV1 matches would miss real Brilliants.

Removing the second line from non-candidate positions also has a visible side effect. The realtime engine treats a node as cached only if it has `lines` (2) lines, so browsing those nodes after the review would trigger a fresh debounced search ([RealtimeEngine/index.tsx](app/src/client/apps/features/analysis/components/RealtimeEngine/index.tsx)).

## Prioritized action plan

The plan sorts changes by what they can do to labels. **Zero-risk** changes leave engine output byte-for-byte the same. They can be proven by replaying recorded engine lines through the reporter and getting identical labels. **Noise-level** changes alter search state (hash contents, order, cloud coverage) but not what is computed. They must keep label agreement within the engine's own run-to-run noise. **Semantic** changes alter what is computed. They need explicit recall and precision gates for Brilliant and Critical.

| # | Change | Main files | Expected gain (estimate) | Label risk |
|---|---|---|---|---|
| 0 | Baseline harness + measurements | new `app/scripts/review-bench/*`, debug export in `useEvaluateGame.ts` | Enables everything else | None |
| 1 | Cheap parsing, final-depth lines only, throttled UI | `lib/engine.ts`, `lib/evaluate.ts`, `hooks/useEvaluateGame.ts`, report components | Removes ~2,500 chess.js replays and re-renders per game; less engine idle time | Zero (fixes time-limit edge case) |
| 2 | No realtime engine during batch; proper worker lifecycle | `AnalysisPanel/index.tsx`, `RealtimeEngine/index.tsx`, `lib/engine.ts` | Frees a core at start; no lingering workers | Zero |
| 3 | Size worker pool to the device; set Hash; wait for `readyok` | `hooks/useEvaluateGame.ts`, `lib/evaluate.ts`, `lib/engine.ts`, `SettingsStore.ts` | ~1.3-1.75x engine throughput on 8-thread desktops; none on 4-core | Noise-level |
| 4 | Non-blocking cloud phase; drop wasted cutoff re-search | `lib/evaluate.ts`, `lib/cloudEvaluate.ts` | Removes serial network wait before engines start | Noise-level |
| 5 | Classify on the client in a Worker; dedupe reporter work | `lib/reporter.ts`, `hooks/useAnalyseGame.ts`, `hooks/useRealtimeAnalyser.ts`, `shared/lib/reporter/report.ts` | Removes serialize + round trip + O(n²) restore; enables streaming labels | Zero |
| 6 | Contiguous backward chunks per worker | `lib/evaluate.ts` | Hash reuse; unquantified (fishnet/En Croissant claim faster + more consistent) | Noise-level |
| 7 | Gated second line (MultiPV 1 + targeted line 2) | `lib/evaluate.ts`, `lib/engine.ts`, new `shared/lib/reporter/utils/candidate.ts`, `useEvaluateGame.ts`, `RealtimeEngine/index.tsx`, `cloudEvaluate.ts` | ~1.0-1.7x engine time, decided by Step 0 measurements | Semantic — strict gates |
| 8 | IndexedDB eval cache | new `lib/evalCache.ts`, `lib/evaluate.ts` | Re-analysis near-instant | Noise-level |
| 9 | Skip forced, terminal and cloud-covered theory positions | `lib/evaluate.ts`, `shared/lib/reporter/utils/opening.ts` | Small to moderate, game-dependent | Zero to noise-level |
| 10 | Optional: node budget, guarded early stop, progressive two-pass | `lib/evaluate.ts`, `lib/engine.ts`, settings | Predictable latency; faster first results | Semantic — only if Step 0 data supports |
| V | Final before/after validation and benchmark | `app/scripts/review-bench/*` | Go/no-go per step | — |

### Step 0 — Measure first, including the engine's own noise

**Change.** Add a dev-only export that dumps each evaluated mainline (FENs, played moves, every node's final engine lines) to JSON. Add a benchmark script that does two things. It replays dumped trees through the existing `getGameAnalysis` ([report.ts](app/src/shared/lib/reporter/report.ts)) to produce labels, and it diffs two label sets. Drive the real app with a browser automation script over a fixed PGN corpus, so timings reflect the actual WASM build in a real browser.

**Corpus.** Brilliant and Critical are rare, so a few hundred games are needed for meaningful recall estimates. Use 200-500 games across rating bands, deliberately including games whose baseline review contains Brilliant or Critical moves.

**What to record.** Run the **unchanged baseline twice** and record:

- label agreement between the two runs (the noise floor), especially which Brilliant and Critical labels flicker;
- wall-clock time to full report and time spent in the cloud phase;
- per-position search time at MultiPV 1 vs MultiPV 2 at depth 16 on the Lite build. This is the multiplier M that decides Step 7;
- the fraction f of plies that pass the Step 7 candidate gate;
- main-thread long tasks during evaluation.

**Files.** New `app/scripts/review-bench/` (export reader, replay-and-diff script, browser driver); a debug-flagged dump in [useEvaluateGame.ts](app/src/client/apps/features/analysis/hooks/useEvaluateGame.ts).

**Why first.** No profiling exists for this pipeline. The MultiPV-cost figures in the literature are Elo at equal time or older TalkChess timings ([Stockfish wiki, Useful data](https://raw.githubusercontent.com/wiki/official-stockfish/Stockfish/Useful-data.md); [TalkChess](https://talkchess.com/viewtopic.php?p=827436)), not SF19-Lite WASM time-to-depth.

### Phase 1 — Quick wins that cannot change a label

**Step 1: parse once, store once, render rarely.**

In [engine.ts](app/src/client/apps/features/analysis/lib/engine.ts), keep only the latest raw UCI line per MultiPV index during a batch search. Skip `currmove` lines (already done) and `lowerbound`/`upperbound` lines. Convert PVs to SAN once at `bestmove`.

In [evaluate.ts](app/src/client/apps/features/analysis/lib/evaluate.ts), store only the final complete line group. That is the deepest depth at which all requested indices exist, which also repairs the `movetime` case where the deepest depth has only PV 1.

Report progress per completed position, throttled to about 100-250 ms. Replace the per-line `dispatchCurrentNodeUpdate()` in [useEvaluateGame.ts](app/src/client/apps/features/analysis/hooks/useEvaluateGame.ts) with one dispatch per finished position, in line with Lichess's 125 ms and Chesskit's 60 ms throttles ([lila ctrl.ts](https://github.com/lichess-org/lila/blob/master/ui/lib/src/ceval/ctrl.ts); [Chesskit uciEngine.ts](https://github.com/GuillaumeSD/Chesskit/blob/main/src/lib/engine/uciEngine.ts)). Keep streaming (throttled) for the realtime engine, which uses the same `evaluate()` for live display.

Stop replaying the whole game prefix on chess.js in `setPosition` for every ply. The node already holds its FEN. Keep sending the move list to the engine so repetition history is preserved.

- **Gain:** removes the O(n²) replay and roughly two orders of magnitude of main-thread chess.js work and React renders during evaluation (estimate), and keeps workers fed promptly.
- **Risk:** zero for default settings, because the reporter reads only the final-depth top line and its sibling. With a time limit enabled, labels can *improve*, because Critical no longer disappears on truncated iterations.
- **Validation:** replay identical dumped lines and expect zero label diffs. Then expect identical labels in default mode within the noise floor.

**Step 2: stop the fifth engine and clean up workers.**

Do not mount or run the realtime engine while the analysis status is EVALUATING or CLASSIFYING. Alternatively, add `cachedEngineLines` to its effect dependencies so it stops once batch lines arrive ([AnalysisPanel/index.tsx](app/src/client/apps/features/analysis/components/AnalysisPanel/index.tsx); [RealtimeEngine/index.tsx](app/src/client/apps/features/analysis/components/RealtimeEngine/index.tsx)).

In [engine.ts](app/src/client/apps/features/analysis/lib/engine.ts), make `terminate()` call `Worker.terminate()` after `quit`.

- **Gain:** one core-search's worth of contention at the start of every review, plus memory hygiene. It is modest, but free.
- **Risk:** zero.

**Step 3: fit the pool to the device and give it a hash.**

Replace `maxEngineCount: 4` with a device-derived count: about `clamp(hardwareConcurrency − 1, 1, 8)`, lowered on mobile and when `navigator.deviceMemory` is low. This is what Chesskit does (≤8 desktop, 4 mobile, 2 iOS) ([Chesskit worker.ts](https://github.com/GuillaumeSD/Chesskit/blob/main/src/lib/engine/worker.ts)). Optionally repurpose the unused `threads` setting as "parallel engines" ([SettingsStore.ts](app/src/client/stores/SettingsStore.ts)).

Send `setoption name Hash value 32` (64 on desktop) and wait for `readyok` before the first `go` ([engine.ts](app/src/client/apps/features/analysis/lib/engine.ts)). Stockfish's guidance is 64-128 MB for depth-24-class analysis, keeping hashfull under 30% ([Stockfish FAQ](https://official-stockfish.github.io/docs/stockfish-wiki/Stockfish-FAQ.html)). Lichess caps browser hash at 32 MB on iOS and 64 MB on Android ([lila engines.ts](https://raw.githubusercontent.com/lichess-org/lila/master/ui/lib/src/ceval/engines/engines.ts)). The Lite net is ~1.7 MB, so memory is dominated by hash, and 6-8 Lite workers are affordable on desktop. Keep the full 99 MB build at a low worker count, since every worker loads its own copy.

- **Gain:** single-threaded workers on independent positions should scale close to linearly with *physical* cores. Expect roughly 1.3-1.75x engine throughput on 8-logical-core desktops and nothing on 4-core machines (estimate, with SMT siblings contributing less than full cores).
- **Risk:** noise-level. Hash size changes search trees slightly.
- **Validation:** agreement within the Step 0 noise floor.

**Step 4: never let the network block the engines.**

Restructure [evaluate.ts](app/src/client/apps/features/analysis/lib/evaluate.ts) so local workers start immediately, working from the end of the game backwards. Meanwhile the cloud loop runs from move 0 in the background, still **one request at a time** as Lichess's API rules require ([Lichess API tips](https://lichess.org/page/api-tips)). A position is done by whichever source reaches it first.

Let the cloud loop skip misses instead of breaking on them. Bound it to roughly the opening phase, as lila's own eval-cache skip covers 15 plies ([FishnetEvalCache.scala](https://github.com/lichess-org/lila/blob/master/modules/fishnet/src/main/FishnetEvalCache.scala)). Abandon cloud for the game on any 429. Anonymous requests cost 2 units of a ~3,000/day per-IP budget ([lila Api.scala](https://github.com/lichess-org/lila/blob/master/app/controllers/Api.scala)).

Remove the "cutoff" re-search of the last cloud node, because its deeper cloud line wins `getTopEngineLine` anyway. URL-encode the FEN in [cloudEvaluate.ts](app/src/client/apps/features/analysis/lib/cloudEvaluate.ts).

- **Gain:** the whole serial cloud prefix disappears from the critical path. That is one blocking round trip per covered ply today, plus one wasted local search per game.
- **Risk:** noise-level. Non-contiguous cloud coverage puts deep cloud evals next to depth-16 local evals more often, which adds cross-search noise to point-loss labels.
- **Mitigation:** the existing rule that cloud lines must meet the configured depth and line count stays. Validate that agreement stays within the noise floor.

**Step 5: classify in the browser.**

Run `getGameAnalysis` in a Web Worker on the client instead of POSTing the tree ([reporter.ts](app/src/client/apps/features/analysis/lib/reporter.ts); [useAnalyseGame.ts](app/src/client/apps/features/analysis/hooks/useAnalyseGame.ts); [AnalysisProgress/index.tsx](app/src/client/apps/features/analysis/components/AnalysisPanel/AnalysisProgress/index.tsx)). Do the same for single-move classification in [useRealtimeAnalyser.ts](app/src/client/apps/features/analysis/hooks/useRealtimeAnalyser.ts). Keep the server route only if something else needs it ([analyse.ts](app/src/server/routes/api/analysis/analyse.ts)).

In [report.ts](app/src/shared/lib/reporter/report.ts), compute `extractPreviousStateTreeNode`, `extractCurrentStateTreeNode` and `getOpeningName` once per node instead of twice.

This also enables streaming: classify a move as soon as it and its parent have final lines, so labels appear during evaluation rather than after it.

- **Gain:** removes the `cloneDeep` of every line, the 1 MB-limited upload, server parsing, the response and the O(n²) restore.
- **Risk:** zero. It is the same code on the same inputs.
- **Validation:** replayed lines must yield identical labels and accuracies.

### Phase 2 — Larger changes that need the harness

**Step 6: contiguous backward chunks per worker.**

Replace the shared forward counter in [evaluate.ts](app/src/client/apps/features/analysis/lib/evaluate.ts) with W contiguous segments. Each worker walks its segment from last ply to first, starting one ply past the segment end so the first search is not cold. That overlap is fishnet's own trick: it repeats a position "to offset that it is analyzed with completely fresh hash" ([fishnet queue.rs](https://github.com/lichess-org/fishnet/blob/main/src/queue.rs)). Add work-stealing from the tail of the largest remaining segment, so no worker idles at the end. Do not send `ucinewgame` between positions of the same game; per the UCI spec it signals a different game ([UCI spec](https://backscattering.de/chess/uci/)).

- **Gain:** better hash reuse and more consistent parent and child evals. En Croissant calls this "faster and more consistent" ([En Croissant docs](https://encroissant.org/docs/guides/analyze-game)), but no published number exists. Measure it.
- **Risk:** noise-level. A warm hash makes results depend on neighbouring positions.
- **Validation:** noise-floor agreement. Check specifically that Brilliant and Critical flicker does not rise.

**Step 7: compute the second line only where a label can use it.**

This is the step that recovers MultiPV's cost without losing either label. Set batch engines to MultiPV 1 ([useEvaluateGame.ts](app/src/client/apps/features/analysis/hooks/useEvaluateGame.ts)) and obtain line 2 for a parent position P only when the move m played from P could be rated Brilliant or Critical.

Put the gate in a new shared module, `app/src/shared/lib/reporter/utils/candidate.ts`, built from the same helpers the classifier uses, so the gate cannot drift out of sync with [criticalMove.ts](app/src/shared/lib/reporter/utils/criticalMove.ts), [critical.ts](app/src/shared/lib/reporter/classification/critical.ts) and [brilliant.ts](app/src/shared/lib/reporter/classification/brilliant.ts).

The gate first excludes moves the classifier never upgrades: P has at most one legal move, the move reaches a THEORY position, or the move gives checkmate. It then **includes** the move if either path is open:

- **Critical path:** m equals P's line-1 move, P is not in check, m is not a queen promotion, and m does not capture free material.
- **Brilliant path:** m's provisional point loss is under 0.01 (whether or not it is the top move), m is not a promotion, P is not in check, and the mover has at least one unsafe non-pawn piece after m (`getUnsafePieces`).

When the child's eval is known, also drop moves after which the mover is losing.

**Two ways to get line 2.**

- **(a) Inline exclusion search (preferred).** The played move is known before P is searched. So when P's MultiPV-1 `bestmove` equals m and the parent-only gates pass, immediately run `go depth D searchmoves <all legal moves except best>` on the same worker while its hash is warm. Store the result as `index: 2` with exactly line 1's depth and source. This is the same quantity as MultiPV 2's line 2: the best non-best root move at depth D with an exact score. It is not bit-identical, because tree shape, aspiration windows and hash all differ ([TalkChess, Decreasing depth in MultiPV](https://talkchess.com/forum3/viewtopic.php?p=816961); [TalkChess](https://talkchess.com/viewtopic.php?p=817254)). If the exclusion score comes out *higher* than line 1, treat P as unstable: re-search it with MultiPV 2 and **replace** both lines.
- **(b) Deferred MultiPV-2 re-search.** For the rarer Brilliant-path cases where m is not the top move, the gate needs the child's eval. Collect them after pass 1 and re-search P with MultiPV 2, again replacing P's line set.

For cloud-covered parents, request `multiPv=2` for that FEN, or fall back to a local MultiPV-2 search. In both cases **replace** the node's lines rather than mixing sources, so the sibling rule holds ([EngineLine.ts](app/src/shared/types/game/position/EngineLine.ts); [cloudEvaluate.ts](app/src/client/apps/features/analysis/lib/cloudEvaluate.ts)). Cloud requests for non-candidates can then use `multiPv=1`, which returns the deepest stored eval ([lila issue #14278](https://github.com/lichess-org/lila/issues/14278)).

In [RealtimeEngine/index.tsx](app/src/client/apps/features/analysis/components/RealtimeEngine/index.tsx), let the display accept a one-line cached set immediately while it fills line 2 in the background, so post-review browsing does not feel slower.

**Expected gain.** Let M be the MultiPV-2/MultiPV-1 cost ratio at depth 16, f the gated fraction of plies, and e the cost of a warm exclusion search relative to a full search. The new cost is about 1 + f·e against today's M. With M between 1.3 and 2 (TalkChess estimates), f around 0.25-0.4 and e around 0.5-1, the saving ranges from **negligible to about 1.7x** of engine time (estimate).

**Decision rule.** If Step 0 measures M below about 1.3, skip this step; the complexity is not worth it. If M is 1.5 or higher, it is likely the largest single engine-side win.

**Risks and mitigations.**

- **Line-1 quality.** MultiPV 1 at a fixed depth is a slightly weaker search than MultiPV 2 at the same depth (+46 Elo for MP2 at depth 18) ([Stockfish wiki, Useful data](https://raw.githubusercontent.com/wiki/official-stockfish/Stockfish/Useful-data.md)). Line 1 may therefore differ on some positions, which can flip "top move played". Mitigation: if validation shows recall loss, spend part of the saving on depth 17.
- **Gate bugs.** A SAN/UCI mismatch, castling notation, or promotion handling can silently remove rare labels. Mitigation: unit-test the gate, and require that every Brilliant or Critical in the baseline corpus had its parent gated in.
- **Exclusion-score drift near the 0.10 Critical gap and the +700 guard.** Mitigation: optionally confirm with a real MultiPV-2 search when the gap is within ±0.02 of 0.10, or the line-2 score is within ±50 cp of 700.

**Validation.** Recall and precision gates for Brilliant and Critical (see Step V), plus a confusion matrix for every other label.

**Step 8: persistent evaluation cache.**

Add an IndexedDB cache in a new `app/src/client/apps/features/analysis/lib/evalCache.ts`. Key it by normalized FEN (board, side to move, castling, en passant; drop the move clocks) plus engine version, depth or node budget, and MultiPV. Store final line sets. Reuse any entry with at least the requested effort and line count. Skip positions with a high halfmove clock or a repetition, where FEN-only search ignores history. Consult the cache in [evaluate.ts](app/src/client/apps/features/analysis/lib/evaluate.ts) before cloud or engine.

- **Gain:** re-opening or re-analysing a game becomes nearly engine-free. Shared openings across a user's games are also hit.
- **Risk:** noise-level. A cached line came from a different hash state.
- **Mitigation:** include the engine version and settings in the key; Step V checks agreement.

**Step 9: skip positions that need no search.**

- **One legal move:** set the position's line 1 equal to its child's line 1. That is the same evaluation, since the only move is forced, and the move out of it is FORCED anyway.
- **Checkmate or stalemate:** synthesize the depth-0 result Stockfish would return. The classifier still needs a top line on the current node ([extractNode.ts](app/src/shared/lib/reporter/utils/extractNode.ts)).
- **Theory positions** ([opening.ts](app/src/shared/lib/reporter/utils/opening.ts)): use a cloud eval, but do not skip them otherwise. The eval graph and per-move accuracy still read their evals ([report.ts](app/src/shared/lib/reporter/report.ts)), and the last book position is the parent of the first real move.

Chesskit already short-circuits terminal positions ([Chesskit uciEngine.ts](https://github.com/GuillaumeSD/Chesskit/blob/main/src/lib/engine/uciEngine.ts)).

- **Gain:** small and game-dependent.
- **Risk:** zero for the terminal case; noise-level otherwise.
- **Mitigation:** any synthesized line must use the same depth and source convention as its neighbours.

### Phase 3 — Optional, only if the data supports it

**Step 10: change the search budget itself.**

**Node budgets** (`go nodes N`, the Lichess approach at 1M nodes ([lila Work.scala](https://raw.githubusercontent.com/lichess-org/lila/master/modules/fishnet/src/main/Work.scala))) give every position equal compute. Single-threaded, they are reproducible. They do not change average speed by themselves; they redistribute effort. They also change every eval, so they are a semantic change.

**Stability-based early stopping** saves time on quiet positions, but brilliant sacrifices are exactly the moves found late ([jk_182 blog](https://lichess.org/@/jk_182/blog/using-stockfish-to-automatically-find-tactics-puzzles/wyfoi3Id)). Any early stop needs a depth floor of about 12 and must be disabled on gated candidates, on captures, checks and hanging pieces in the best line, and after fail-lows.

**A progressive two-pass review** shows provisional labels from a fast pass, then deepens only near-threshold and candidate moves. It improves perceived speed most, but needs the harness to prove pass 1 rarely misses a label pass 2 never revisits.

**Multi-threaded WASM with COOP/COEP** is not recommended for batch review. Independent positions already parallelize across single-threaded workers. Threads add non-determinism ([Chess Engine Lab](https://chessenginelab.substack.com/p/using-stockfish-to-find-tactics)) and require cross-origin isolation for the whole page ([nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js)). Consider it only for the single-position realtime engine.

**Do not** lower the default depth below 16, set MultiPV 1 globally, enable `movetime` by default, or default to the 99 MB build.

### Step V — Before/after validation and benchmark

Run every step through the same harness, in the order above, and gate each step before starting the next.

**Zero-risk steps (1, 2, 5, terminal part of 9).** Replaying the same dumped engine lines through the old and new code paths must give **identical labels and accuracies**. Any diff is a bug.

**Noise-level steps (3, 4, 6, 8, rest of 9).** Run the full corpus.

- Overall label agreement with baseline must be at least the baseline-vs-baseline agreement measured in Step 0, minus a small tolerance (for example 0.5 points).
- Brilliant and Critical counts must not drop beyond the baseline's own flicker.

**Semantic steps (7, 10).** Define "stable positives" as moves labelled Brilliant (or Critical) in *both* baseline runs. Require at least 95% recall on stable positives for each label. Require new positives not seen in either baseline run to stay at or below the baseline's flicker rate. Also report:

- the full confusion matrix across all eleven labels;
- the mean absolute change in per-player accuracy;
- per-step wall-clock time to first label and to full report, at 4 and 8 logical cores, on desktop and on one mid-range phone.

If a step fails its gate, keep the earlier steps and revise or drop that one. The plan is ordered so the zero-risk steps alone already deliver a faster review.

## Conclusion

The bottleneck in this app is less "Stockfish is slow" than "the app makes Stockfish wait and then throws most of its output away". Serial network calls gate the engines. Cores sit unused, the hash goes cold, every intermediate line is turned into SAN and a React render, and a second line is computed on every position for a classifier that reads it only after a near-best move. That reframing explains why the obvious levers, depth and MultiPV, are the wrong ones to pull first. They touch the evaluation quality that Brilliant and Critical are most sensitive to, while the overheads can be removed with no change to engine output at all.

The deeper point is that the classifier's own structure defines exactly how much engine work it needs: one exact score for every position, and a second, sibling score for one parent per near-best move. Encoding that requirement as a shared gate turns "fewer PV lines" from a correctness risk into a precise optimization. The one unknown that decides whether it is worth building is the measured MultiPV-2 cost multiplier for Stockfish 19 Lite in the browser. Step 0 has to answer it before anything else. Because engine evaluation is not perfectly reproducible, the honest yardstick for every change is the baseline's own run-to-run agreement, not an impossible zero-diff.
