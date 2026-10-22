import { useTranslation } from "react-i18next";

import AnalysisStatus from "@analysis/constants/AnalysisStatus";
import useSettingsStore from "@client/stores/SettingsStore";
import useAnalysisGameStore from "@analysis/stores/AnalysisGameStore";
import useAnalysisBoardStore from "@analysis/stores/AnalysisBoardStore";
import useAnalysisProgressStore from "@analysis/stores/AnalysisProgressStore";
import { analyseStateTree } from "@analysis/lib/reporter";

function useAnalyseGame(
    onAnalysisError?: (message: string) => void
) {
    const { t } = useTranslation("analysis");

    const settings = useSettingsStore(state => state.settings.analysis);

    const {
        analysisGame,
        setAnalysisGame
    } = useAnalysisGameStore();

    const dispatchCurrentNodeUpdate = useAnalysisBoardStore(
        state => state.dispatchCurrentNodeUpdate
    );

    const setAnalysisStatus = useAnalysisProgressStore(
        state => state.setAnalysisStatus
    );

    return () => {
        // Classifies the moves of the state tree in place
        try {
            var gameAnalysis = analyseStateTree(analysisGame.stateTree, {
                includeBrilliant: settings.classifications.included.brilliant,
                includeCritical: settings.classifications.included.critical,
                includeTheory: settings.classifications.included.theory
            });
        } catch (err) {
            console.error(err);

            return onAnalysisError?.(
                t("progressReporter.reportFailed")
            );
        }

        setAnalysisGame({
            ...analysisGame,
            ...gameAnalysis
        });

        dispatchCurrentNodeUpdate();
        setAnalysisStatus(AnalysisStatus.INACTIVE);
    };
}

export default useAnalyseGame;
