import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import useGameSelector from "@client/hooks/useGameSelector";
import useAnalysisProgressStore from "@analysis/stores/AnalysisProgressStore";
import GameSelector from "@client/components/chess/GameSelector";
import LogMessage from "@client/components/common/LogMessage";
import Button from "@client/components/common/Button";

import useImportGame from "@analysis/hooks/useImportGame";
import useEvaluateGame from "@analysis/hooks/useEvaluateGame";
import AnalyseButton from "../../AnalyseButton";
import ImportReviewDialog from "../../ImportReviewDialog";
import * as styles from "./GameSelection.module.css";

function GameSelection() {
    const { t } = useTranslation("analysis");

    const { setSelectedGame } = useGameSelector();

    const setEvaluationController = useAnalysisProgressStore(
        state => state.setEvaluationController
    );

    const [ statusMessage, setStatusMessage ] = useState<string>();
    const [ importError, setImportError ] = useState<string>();
    const [ importReviewOpen, setImportReviewOpen ] = useState(false);

    const importSelectedGame = useImportGame();
    const evaluateGame = useEvaluateGame();

    async function onAnalyseClick() {
        try {
            var importedGame = await importSelectedGame(setStatusMessage);
        } catch (err) {
            return setImportError((err as Error).message);
        }

        const controller = await evaluateGame(importedGame);

        setEvaluationController(controller);
    }

    return <>
        <GameSelector
            saveLocalStorage
            onGameSelect={setSelectedGame}
        />

        <AnalyseButton onClick={onAnalyseClick} />

        <Button
            className={styles.importReviewButton}
            onClick={() => setImportReviewOpen(true)}
        >
            <span className={styles.importReviewLabel}>
                {t("gameSelector.importReviewButton")}
            </span>
        </Button>

        {statusMessage && <i className={styles.statusMessage}>
            {statusMessage}
        </i>}

        {importError && <LogMessage>
            {importError}
        </LogMessage>}

        {importReviewOpen && <ImportReviewDialog
            onClose={() => setImportReviewOpen(false)}
        />}
    </>;
}

export default GameSelection;
