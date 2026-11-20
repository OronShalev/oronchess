import React from "react";

import AnalysisTab from "@analysis/constants/AnalysisTab";
import useAnalysisGameStore from "@analysis/stores/AnalysisGameStore";
import useAnalysisTabStore from "@analysis/stores/AnalysisTabStore";
import AnalysisPanel from "@analysis/components/AnalysisPanel";

import BoardArea from "./BoardArea";
import * as styles from "./Analysis.module.css";

function Analysis() {
    const gameAnalysisOpen = useAnalysisGameStore(
        state => state.gameAnalysisOpen
    );

    const activeTab = useAnalysisTabStore(state => state.activeTab);

    // Learning has no move traverser to leave room for
    const learning = gameAnalysisOpen && activeTab == AnalysisTab.LEARNING;

    return <div className={
        `${styles.wrapper} ${learning ? styles.withoutTraverser : ""}`
    }>
        <div className={styles.analysisSection}>
            <BoardArea/>

            <AnalysisPanel className={styles.panel} />
        </div>
    </div>;
}

export default Analysis;
