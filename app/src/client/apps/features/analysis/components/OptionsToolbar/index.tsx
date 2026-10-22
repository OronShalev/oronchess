import React, { CSSProperties, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "react-tooltip";
import { useShallow } from "zustand/react/shallow";
import { cloneDeep } from "lodash-es";

import { defaultAnalysedGame } from "@shared/constants/utils";
import { getNodeChain } from "@shared/types/game/position/StateTreeNode";
import { hasReview } from "@analysis/lib/reviewShare";
import AnalysisStatus from "@analysis/constants/AnalysisStatus";
import useAnalysisProgressStore from "../../stores/AnalysisProgressStore";
import { useAnalysisGameStore } from "@analysis/stores/AnalysisGameStore";
import useAnalysisBoardStore from "@analysis/stores/AnalysisBoardStore";
import useRealtimeEngineStore from "@analysis/stores/RealtimeEngineStore";
import Button from "@client/components/common/Button";
import SettingsDialog from "../SettingsDialog";
import ShareDialog from "../ShareDialog";
import ShareReviewDialog from "../ShareReviewDialog";

import * as styles from "./OptionsToolbar.module.css";

import iconBack from "@assets/img/interface/back.svg";
import iconFlip from "@assets/img/interface/flip.svg";
import iconSettings from "@assets/img/interface/settings.svg";
import iconShare from "@assets/img/interface/share.svg";
import iconLogo from "@assets/img/logo.svg";

function OptionsToolbar() {
    const { t } = useTranslation(["analysis", "common"]);

    const {
        evaluationController,
        analysisStatus,
        setAnalysisStatus,
        setAnalysisError
    } = useAnalysisProgressStore(
        useShallow(state => ({
            evaluationController: state.evaluationController,
            analysisStatus: state.analysisStatus,
            setAnalysisStatus: state.setAnalysisStatus,
            setAnalysisError: state.setAnalysisError
        }))
    );

    const {
        analysisGame,
        setAnalysisGame,
        gameAnalysisOpen,
        setGameAnalysisOpen
    } = useAnalysisGameStore();

    const {
        currentStateTreeNode,
        setCurrentStateTreeNode,
        boardFlipped,
        setBoardFlipped
    } = useAnalysisBoardStore();

    const setDisplayedEngineLines = useRealtimeEngineStore(
        state => state.setDisplayedEngineLines
    );

    const [ settingsOpen, setSettingsOpen ] = useState(false);
    const [ shareOpen, setShareOpen ] = useState(false);
    const [ shareReviewOpen, setShareReviewOpen ] = useState(false);

    // A review can be shared once the game has been fully evaluated
    // and classified in the app
    const reviewShareable = useMemo(() => (
        gameAnalysisOpen
        && analysisStatus == AnalysisStatus.INACTIVE
        && hasReview(analysisGame.stateTree)
        && getNodeChain(analysisGame.stateTree).some(
            node => node.state.classification
        )
    ), [gameAnalysisOpen, analysisStatus, analysisGame]);

    function back() {
        // Abort any ongoing evaluations or analyses
        evaluationController?.abort();

        setAnalysisStatus(AnalysisStatus.INACTIVE);
        setAnalysisError();

        // Reset analysis game & evaluation bar
        const freshAnalysisGame = cloneDeep(defaultAnalysedGame);

        setGameAnalysisOpen(false);
        setAnalysisGame(freshAnalysisGame);
        setCurrentStateTreeNode(freshAnalysisGame.stateTree);
        setDisplayedEngineLines([]);
    }

    return <>
        <div className={styles.wrapper}>
            {gameAnalysisOpen && <Button
                icon={iconBack}
                iconSize={"40px"}
                className={styles.backButton}
                tooltipId={"options-toolbar-back"}
                onClick={back}
            />}

            <Tooltip
                id="options-toolbar-back"
                content={t("back", { ns: "common" })}
                delayShow={500}
            />

            <Button
                className={styles.optionButton}
                icon={iconFlip}
                iconSize={"40px"}
                tooltipId={"options-toolbar-flip"}
                onClick={() => setBoardFlipped(!boardFlipped)}
            />

            <Tooltip
                id="options-toolbar-flip"
                content={t("optionsToolbar.flipBoard")}
                delayShow={500}
            />

            <Button
                className={styles.optionButton}
                icon={iconSettings}
                iconSize={"35px"}
                tooltipId={"options-toolbar-settings"}
                onClick={() => setSettingsOpen(true)}
            />

            <Tooltip
                id="options-toolbar-settings"
                content={t("settings", { ns: "common" })}
                delayShow={500}
            />

            <Button
                className={styles.optionButton}
                icon={iconShare}
                iconSize={"35px"}
                tooltipId={"options-toolbar-share"}
                onClick={() => setShareOpen(true)}
            />

            <Tooltip
                id="options-toolbar-share"
                content={t("optionsToolbar.share")}
                delayShow={500}
            />

            {reviewShareable && <Button
                className={`${styles.optionButton} ${styles.shareReviewButton}`}
                style={{ "--logo": `url(${iconLogo})` } as CSSProperties}
                icon={iconShare}
                iconSize={"35px"}
                tooltipId={"options-toolbar-share-review"}
                onClick={() => setShareReviewOpen(true)}
            />}

            <Tooltip
                id="options-toolbar-share-review"
                content={t("optionsToolbar.shareReview")}
                delayShow={500}
            />
        </div>

        {settingsOpen && <SettingsDialog
            onClose={() => setSettingsOpen(false)}
        />}

        {shareOpen && <ShareDialog
            game={analysisGame}
            currentNode={currentStateTreeNode}
            onClose={() => setShareOpen(false)}
        />}

        {shareReviewOpen && <ShareReviewDialog
            game={analysisGame}
            onClose={() => setShareReviewOpen(false)}
        />}
    </>;
}

export default OptionsToolbar;