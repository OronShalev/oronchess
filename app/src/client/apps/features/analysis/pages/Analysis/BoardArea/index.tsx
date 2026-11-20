import React, { useMemo } from "react";
import { Move } from "chess.js";
import { Arrow } from "react-chessboard/dist/chessboard/types";
import { useShallow } from "zustand/react/shallow";

import { addChildMove } from "@shared/types/game/position/StateTreeNode";
import {
    getNodeClocks,
    getPgnTimeControl,
    hasClocks,
    parseTimeControl
} from "@shared/lib/stateTree/clocks";
import AnalysisTab from "@analysis/constants/AnalysisTab";
import useSettingsStore from "@client/stores/SettingsStore";
import useAnalysisGameStore from "@analysis/stores/AnalysisGameStore";
import useAnalysisTabStore from "@analysis/stores/AnalysisTabStore";
import useAnalysisBoardStore from "@analysis/stores/AnalysisBoardStore";
import useLearningStore from "@analysis/stores/LearningStore";
import Board from "@analysis/components/Board";
import playBoardSound from "@client/lib/boardSounds";

import useEvaluation from "./useEvaluation";
import useSuggestionArrows from "./useSuggestionArrows";
import * as styles from "./BoardArea.module.css";

// The board only clears its arrows when given a list, so learning passes
// an empty one rather than none
const noArrows: Arrow[] = [];

function BoardArea() {
    const settings = useSettingsStore(state => state.settings.analysis);
    const theme = useSettingsStore(state => state.settings.themes);

    const {
        analysisGame,
        gameAnalysisOpen,
        setGameAnalysisOpen
    } = useAnalysisGameStore();

    const {
        activeTab,
        setActiveTab
    } = useAnalysisTabStore();

    const {
        mistake: learningMistake,
        line: learningLine,
        lineShown: learningLineShown,
        hint: learningHint
    } = useLearningStore(
        useShallow(state => ({
            mistake: state.mistake,
            line: state.line,
            lineShown: state.lineShown,
            hint: state.hint
        }))
    );

    const {
        currentStateTreeNode,
        setCurrentStateTreeNode,
        dispatchCurrentNodeUpdate,
        autoplayEnabled,
        boardFlipped
    } = useAnalysisBoardStore();

    const timeControl = useMemo(() => parseTimeControl(
        getPgnTimeControl(analysisGame.pgn)
    ), [analysisGame.pgn]);

    // Clocks are only shown for games that recorded them
    const gameHasClocks = useMemo(() => (
        hasClocks(analysisGame.stateTree)
    ), [analysisGame.stateTree]);

    const evaluation = useEvaluation();
    const suggestionArrows = useSuggestionArrows();

    const learning = gameAnalysisOpen && activeTab == AnalysisTab.LEARNING;

    // The engine's line after a mistake is played out on the board without
    // being added to the game
    const lineActive = learning && !!learningLine;

    const boardNode = (lineActive && learningLineShown > 0)
        ? learningLine![learningLineShown - 1]
        : currentStateTreeNode;

    const retrying = learning && !!learningMistake
        && currentStateTreeNode == learningMistake.parent;

    // While learning, moves can only be tried in place of a mistake
    const movesAllowed = !autoplayEnabled && !lineActive
        && (!learning || retrying);

    function addMove(move: Move) {
        if (!movesAllowed) return false;

        if (!gameAnalysisOpen) {
            setGameAnalysisOpen(true);
            setActiveTab(AnalysisTab.ANALYSIS);
        }

        setCurrentStateTreeNode(prev => {
            const createdNode = addChildMove(prev, move.san);
            playBoardSound(createdNode);

            return createdNode;
        });

        dispatchCurrentNodeUpdate();

        return true;
    }

    return <Board
        className={styles.board}
        style={{
            maxWidth: `calc(100vh - ${evaluation ? 195 : 235}px)`
        }}
        profileClassName={styles.boardProfile}
        // Learning leaves out the players and clocks, so that what it
        // shows is close to the board on phones
        whiteProfile={learning ? undefined : analysisGame.players.white}
        blackProfile={learning ? undefined : analysisGame.players.black}
        clocks={gameHasClocks && !learning
            ? getNodeClocks(currentStateTreeNode, timeControl)
            : undefined
        }
        theme={{
            lightSquareColour: theme.board.lightSquareColour,
            darkSquareColour: theme.board.darkSquareColour
        }}
        node={boardNode}
        flipped={boardFlipped}
        evaluation={evaluation}
        arrows={learning ? noArrows : suggestionArrows}
        arrowsAllowed={!learning}
        hint={retrying && !lineActive ? learningHint : undefined}
        piecesDraggable={movesAllowed}
        enableClassifications={!settings.classifications.hide}
        onAddMove={addMove}
    />;
}

export default BoardArea;