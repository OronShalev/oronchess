import { useTranslation } from "react-i18next";
import { throttle } from "lodash-es";

import AnalysedGame from "@shared/types/game/AnalysedGame";
import AnalysisStatus from "@analysis/constants/AnalysisStatus";
import useSettingsStore from "@client/stores/SettingsStore";
import useAnalysisBoardStore from "@analysis/stores/AnalysisBoardStore";
import useAnalysisProgressStore from "@analysis/stores/AnalysisProgressStore";
import {
    getRecommendedEngineCount,
    getRecommendedHashSize
} from "../lib/hardware";
import { createIndexedDBEvaluationCache } from "../lib/evalCache";
import createGameEvaluator, { getSearchNodeLimit } from "../lib/evaluate";

const progressUpdateInterval = 150;

function useEvaluateGame() {
    const { t } = useTranslation("analysis");

    const settings = useSettingsStore(
        state => state.settings.analysis
    );

    const dispatchCurrentNodeUpdate = useAnalysisBoardStore(
        state => state.dispatchCurrentNodeUpdate
    );

    const {
        setAnalysisStatus,
        setEvaluationProgress,
        setAnalysisError
    } = useAnalysisProgressStore();

    async function evaluateGame(analysisGame: AnalysedGame) {
        setAnalysisStatus(AnalysisStatus.EVALUATING);

        const engineSettings = settings.engine;

        const updateProgress = throttle((progress: number) => {
            setEvaluationProgress(progress);
            dispatchCurrentNodeUpdate();
        }, progressUpdateInterval);

        const evaluator = createGameEvaluator(analysisGame, {
            engineVersion: engineSettings.version,
            engineDepth: engineSettings.depth,
            engineTimeLimit: engineSettings.timeLimitEnabled
                ? engineSettings.timeLimit : undefined,
            engineNodeLimit: getSearchNodeLimit(engineSettings.depth),
            engineLines: engineSettings.lines,
            maxEngineCount: getRecommendedEngineCount(engineSettings.version),
            engineHashSize: getRecommendedHashSize(),
            cloudEvaluation: true,
            cache: createIndexedDBEvaluationCache(),
            classificationOptions: {
                includeBrilliant: settings.classifications.included.brilliant,
                includeCritical: settings.classifications.included.critical,
                includeTheory: settings.classifications.included.theory
            },
            onProgress: updateProgress
        });

        evaluator.evaluate()
            .then(() => {
                updateProgress.flush();

                setAnalysisStatus(AnalysisStatus.CLASSIFYING);
            })
            .catch(err => {
                updateProgress.cancel();

                if (err == "abort") return;

                console.error(err);
                setAnalysisError(t("analysisError"));
            });

        return evaluator.controller;
    }

    return evaluateGame;
}

export default useEvaluateGame;
