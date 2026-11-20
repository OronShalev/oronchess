import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { Options as HotkeyOptions, useHotkeys } from "react-hotkeys-hook";

import PieceColour from "@shared/constants/PieceColour";
import {
    StateTreeNode,
    addChildMove
} from "@shared/types/game/position/StateTreeNode";
import AnalysisStatus from "@analysis/constants/AnalysisStatus";
import {
    LearningStep,
    getAttemptResult,
    getBestMove,
    getLearningStep,
    getLineAfter,
    getMistakes,
    isGameReviewed,
    isSolvingResult
} from "@analysis/lib/learning";
import MoveEvaluator, { MoveEvaluatorStoppedError } from "@analysis/lib/moveEvaluator";
import { createIndexedDBEvaluationCache } from "@analysis/lib/evalCache";
import useSettingsStore from "@client/stores/SettingsStore";
import useAnalysisGameStore from "@analysis/stores/AnalysisGameStore";
import useAnalysisBoardStore from "@analysis/stores/AnalysisBoardStore";
import useAnalysisProgressStore from "@analysis/stores/AnalysisProgressStore";
import useLearningStore from "@analysis/stores/LearningStore";
import LocalStorageKey from "@client/constants/LocalStorageKey";
import useLocalStorage from "@client/hooks/useLocalStorage";
import playBoardSound from "@client/lib/boardSounds";

import SideSelector from "./SideSelector";
import MistakeCard from "./MistakeCard";
import MistakeList from "./MistakeList";
import * as styles from "./GameLearning.module.css";

const hotkeyConfig: HotkeyOptions = { preventDefault: true };

// Milliseconds before the engine's line starts, and between its moves
const lineStartDelay = 400;
const lineMoveInterval = 900;

function GameLearning() {
    const { t } = useTranslation("analysis");

    const settings = useSettingsStore(state => state.settings.analysis);

    const analysisGame = useAnalysisGameStore(state => state.analysisGame);
    const rootNode = analysisGame.stateTree;

    const reviewRunning = useAnalysisProgressStore(
        state => state.analysisStatus != AnalysisStatus.INACTIVE
    );

    const {
        currentNode,
        boardFlipped,
        setCurrentStateTreeNode,
        dispatchCurrentNodeUpdate,
        setBoardFlipped,
        setAutoplayEnabled
    } = useAnalysisBoardStore(
        useShallow(state => ({
            currentNode: state.currentStateTreeNode,
            boardFlipped: state.boardFlipped,
            setCurrentStateTreeNode: state.setCurrentStateTreeNode,
            dispatchCurrentNodeUpdate: state.dispatchCurrentNodeUpdate,
            setBoardFlipped: state.setBoardFlipped,
            setAutoplayEnabled: state.setAutoplayEnabled
        }))
    );

    // Classifications are set in place, then announced with an update
    const nodeUpdate = useAnalysisBoardStore(
        state => state.currentStateTreeNodeUpdate
    );

    const learning = useLearningStore();

    // Learning starts from the side at the bottom of the board, which
    // is the searched player's side in games found by username
    const gameStarted = learning.rootNode == rootNode;

    const colour = gameStarted
        ? learning.colour
        : (boardFlipped ? PieceColour.BLACK : PieceColour.WHITE);

    const reviewed = useMemo(() => (
        isGameReviewed(rootNode)
    ), [analysisGame]);

    const mistakesBySide = useMemo(() => ({
        [PieceColour.WHITE]: getMistakes(rootNode, PieceColour.WHITE),
        [PieceColour.BLACK]: getMistakes(rootNode, PieceColour.BLACK)
    }), [analysisGame]);

    const mistakes = mistakesBySide[colour];

    const mistake = gameStarted && learning.mistake
        && mistakes.includes(learning.mistake)
        ? learning.mistake
        : undefined;

    const mistakeIndex = mistake ? mistakes.indexOf(mistake) : -1;

    const step = mistake && getLearningStep(currentNode, mistake);

    const evaluatorRef = useRef<MoveEvaluator>();
    const [ failedNode, setFailedNode ] = useState<StateTreeNode>();

    // Closed until opened, which is then remembered
    const listOpenSetting = useLocalStorage<boolean>(
        LocalStorageKey.LEARNING_MISTAKES_OPEN, false
    );

    const listOpen = listOpenSetting.value == "true";

    // Nothing moves the board while the engine's line plays out
    const lineActive = !!learning.line;

    function goTo(node: StateTreeNode, soundNode = node) {
        setCurrentStateTreeNode(node);
        playBoardSound(soundNode);
        setAutoplayEnabled(false);
    }

    function selectMistake(selected?: StateTreeNode) {
        if (lineActive) return;

        learning.setMistake(selected);

        if (selected) goTo(selected);
    }

    // Opening the tab, or the mistakes changing, shows a mistake: the one
    // on the board, else the one last shown, else the first
    useEffect(() => {
        if (!gameStarted) learning.startGame(rootNode, colour);

        const shown = mistakes.find(other => other == currentNode)
            || mistake
            || mistakes.at(0);

        learning.setMistake(shown);

        if (shown && getLearningStep(currentNode, shown) == LearningStep.AWAY) {
            goTo(shown);
        }
    }, [mistakes]);

    // Moving to another mistake some other way selects it
    useEffect(() => {
        const onBoard = mistakes.find(other => other == currentNode);

        if (onBoard && onBoard != mistake) learning.setMistake(onBoard);
    }, [currentNode]);

    useEffect(() => () => {
        evaluatorRef.current?.stop();
        useLearningStore.getState().closeLine();
    }, []);

    // The engine's line plays one move at a time
    useEffect(() => {
        const line = learning.line;
        if (!line || learning.lineShown >= line.length) return;

        const timeout = setTimeout(() => {
            playBoardSound(line[learning.lineShown]);
            learning.advanceLine();
        }, learning.lineShown == 0 ? lineStartDelay : lineMoveInterval);

        return () => clearTimeout(timeout);
    }, [learning.line, learning.lineShown]);

    // Moves tried in place of a mistake are classified like the game's
    useEffect(() => {
        if (step != LearningStep.ATTEMPT) return;
        if (currentNode.state.classification) return;

        if (!evaluatorRef.current) {
            evaluatorRef.current = new MoveEvaluator(
                createIndexedDBEvaluationCache()
            );
        }

        const attempt = currentNode;
        const attemptMistake = mistake;

        setFailedNode(undefined);

        evaluatorRef.current.classify(attempt, {
            engineVersion: settings.engine.version,
            engineDepth: settings.engine.depth,
            engineTimeLimit: settings.engine.timeLimitEnabled
                ? settings.engine.timeLimit
                : undefined,
            engineLines: settings.engine.lines,
            classificationOptions: {
                includeBrilliant: settings.classifications.included.brilliant,
                includeCritical: settings.classifications.included.critical,
                includeTheory: settings.classifications.included.theory
            }
        }).then(classified => {
            if (!classified) setFailedNode(attempt);

            // Counted even if the board has moved on since
            if (attemptMistake && isSolvingResult(getAttemptResult(attempt))) {
                learning.setSolved(attemptMistake);
            }

            dispatchCurrentNodeUpdate();
        }).catch(error => {
            if (error instanceof MoveEvaluatorStoppedError) return;

            console.error(error);
            setFailedNode(attempt);
        });
    }, [currentNode, step]);

    // A mistake is solved by an excellent move or better, which may have
    // been classified already when it was played
    useEffect(() => {
        if (!mistake || step != LearningStep.ATTEMPT) return;
        if (learning.solved[mistake.id]) return;

        if (isSolvingResult(getAttemptResult(currentNode))) {
            learning.setSolved(mistake);
        }
    }, [currentNode, step, nodeUpdate]);

    function chooseColour(chosen: PieceColour) {
        if (chosen == colour || lineActive) return;

        learning.setColour(chosen);

        // The side learning from is shown at the bottom
        setBoardFlipped(chosen == PieceColour.BLACK);

        selectMistake(mistakesBySide[chosen].at(0));
    }

    function showLine(from: StateTreeNode) {
        const line = getLineAfter(from);
        if (line.length > 0) learning.showLine(line);
    }

    function closeLine() {
        learning.closeLine();
    }

    function tryAgain() {
        if (!mistake?.parent) return;

        setFailedNode(undefined);

        // The sound is of the move taken back
        goTo(mistake.parent, currentNode);
    }

    const bestMove = mistake && getBestMove(mistake);

    function showBest() {
        if (!mistake?.parent || !bestMove) return;

        // Seeing the best move counts as solving the mistake too
        learning.setSolved(mistake);
        learning.setRevealed(mistake);

        const bestNode = addChildMove(mistake.parent, bestMove.san);

        goTo(bestNode);
        dispatchCurrentNodeUpdate();
    }

    const previousMistake = mistakeIndex > 0
        ? mistakes.at(mistakeIndex - 1)
        : undefined;

    const nextMistake = mistake ? mistakes.at(mistakeIndex + 1) : undefined;

    // The arrow keys move between mistakes, as there are no other moves
    // to move between here
    useHotkeys("left", () => {
        if (previousMistake) selectMistake(previousMistake);
    }, hotkeyConfig, [previousMistake, lineActive]);

    useHotkeys("right", () => {
        if (nextMistake) selectMistake(nextMistake);
    }, hotkeyConfig, [nextMistake, lineActive]);

    if (reviewRunning) return <div className={styles.notice}>
        {t("learning.reviewRunning")}
    </div>;

    if (!reviewed) return <div className={styles.notice}>
        {t("learning.notReviewed")}
    </div>;

    // Showing the best move is only offered before it is on the board
    const bestShown = step == LearningStep.ATTEMPT
        && currentNode.state.move?.san == bestMove?.san;

    // The engine's line can be played out after the mistake, or after a
    // move tried in its place
    const lineStart = step == LearningStep.MISTAKE
        ? mistake
        : (step == LearningStep.ATTEMPT ? currentNode : undefined);

    const lineAvailable = !!lineStart && getLineAfter(lineStart, 1).length > 0;

    return <div className={styles.wrapper}>
        {(mistake && step)
            ? <>
                <MistakeCard
                    step={step}
                    mistake={mistake}
                    node={currentNode}
                    mistakes={mistakes}
                    solved={learning.solved}
                    initialPosition={analysisGame.initialPosition}
                    simpleNotation={settings.simpleNotation}
                    revealed={!!learning.revealed[mistake.id]}
                    checkFailed={failedNode == currentNode}
                    line={learning.line}
                    lineShown={learning.lineShown}
                    onSelect={selectMistake}
                    onPrevious={previousMistake
                        ? () => selectMistake(previousMistake)
                        : undefined
                    }
                    onNext={nextMistake
                        ? () => selectMistake(nextMistake)
                        : undefined
                    }
                    onTryAgain={tryAgain}
                    onShowBest={bestMove && !bestShown ? showBest : undefined}
                    onShowLine={lineStart && lineAvailable
                        ? () => showLine(lineStart)
                        : undefined
                    }
                    onCloseLine={closeLine}
                    onReturn={() => goTo(mistake)}
                />

                <MistakeList
                    mistakes={mistakes}
                    selected={mistake}
                    solved={learning.solved}
                    initialPosition={analysisGame.initialPosition}
                    open={listOpen}
                    locked={lineActive}
                    onToggle={() => listOpenSetting.set(!listOpen)}
                    onSelect={selectMistake}
                />
            </>
            : <div className={styles.notice}>
                {t("learning.noMistakes", {
                    player: analysisGame.players[colour].username
                        || t(`learning.colours.${colour}`)
                })}
            </div>
        }

        {/* Last, as the side is rarely changed */}
        <SideSelector
            colour={colour}
            players={analysisGame.players}
            mistakeCounts={{
                [PieceColour.WHITE]: mistakesBySide[PieceColour.WHITE].length,
                [PieceColour.BLACK]: mistakesBySide[PieceColour.BLACK].length
            }}
            locked={lineActive}
            onSelect={chooseColour}
        />
    </div>;
}

export default GameLearning;
