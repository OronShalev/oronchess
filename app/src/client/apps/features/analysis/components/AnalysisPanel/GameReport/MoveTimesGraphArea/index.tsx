import React, { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { findIndex } from "lodash-es";

import { getNodeChain } from "@shared/types/game/position/StateTreeNode";
import {
    formatTimeControl,
    getPgnTimeControl,
    parseTimeControl
} from "@shared/lib/stateTree/clocks";
import useAnalysisGameStore from "@analysis/stores/AnalysisGameStore";
import useAnalysisBoardStore from "@analysis/stores/AnalysisBoardStore";
import MoveTimesGraph from "@analysis/components/report/MoveTimesGraph";
import playBoardSound from "@client/lib/boardSounds";

function MoveTimesGraphArea() {
    const analysisGame = useAnalysisGameStore(state => state.analysisGame);

    const {
        currentStateTreeNode,
        setCurrentStateTreeNode
    } = useAnalysisBoardStore(
        useShallow(state => ({
            currentStateTreeNode: state.currentStateTreeNode,
            setCurrentStateTreeNode: state.setCurrentStateTreeNode
        }))
    );

    const mainlineChain = useMemo(() => (
        getNodeChain(analysisGame.stateTree)
    ), [analysisGame]);

    const timeControl = useMemo(() => {
        const periods = parseTimeControl(getPgnTimeControl(analysisGame.pgn));

        return periods && formatTimeControl(periods);
    }, [analysisGame.pgn]);

    // Only games with recorded move times have a graph of them
    if (!mainlineChain.some(node => node.state.moveTime != undefined)) {
        return null;
    }

    return <MoveTimesGraph
        nodes={mainlineChain}
        timeControl={timeControl}
        initialPosition={analysisGame.initialPosition}
        selectedIndex={findIndex(
            mainlineChain,
            node => node.id == currentStateTreeNode.id
        )}
        onMoveClick={node => {
            setCurrentStateTreeNode(node);
            playBoardSound(node);
        }}
    />;
}

export default MoveTimesGraphArea;
