import useSettingsStore from "@client/stores/SettingsStore";
import useAnalysisBoardStore from "@analysis/stores/AnalysisBoardStore";
import useAnalysisProgressStore from "@analysis/stores/AnalysisProgressStore";
import { analyseNode } from "@analysis/lib/reporter";

function useRealtimeAnalyser() {
    const settings = useSettingsStore(state => state.settings.analysis);

    const {
        currentStateTreeNode,
        dispatchCurrentNodeUpdate
    } = useAnalysisBoardStore();

    const setRealtimeClassifyError = useAnalysisProgressStore(
        state => state.setRealtimeClassifyError
    );

    function cancelAnalyse(errorString?: string) {
        setRealtimeClassifyError(errorString);
    }

    function considerRealtimeAnalyse() {
        if (!currentStateTreeNode.parent) return;

        // Moves that are already classified, as all are after a game
        // review, keep their results, so that the review's accuracies
        // do not change with the lines of realtime searches
        if (currentStateTreeNode.state.classification) {
            return cancelAnalyse();
        }

        // If there is not enough data for a centipawn comparison
        const parentState = currentStateTreeNode.parent.state;

        if (parentState.engineLines.length == 0) return;

        const classified = analyseNode(currentStateTreeNode, {
            includeBrilliant: settings.classifications.included.brilliant,
            includeCritical: settings.classifications.included.critical,
            includeTheory: settings.classifications.included.theory
        });

        if (!classified)
            return cancelAnalyse("classifiedMoveCard.unknownError");

        cancelAnalyse();
        dispatchCurrentNodeUpdate();
    }

    return considerRealtimeAnalyse;
}

export default useRealtimeAnalyser;