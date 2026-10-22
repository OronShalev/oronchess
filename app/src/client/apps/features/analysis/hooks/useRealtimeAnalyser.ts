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

        // If there is not enough data for a centipawn comparison
        const parentState = currentStateTreeNode.parent.state;

        if (parentState.engineLines.length == 0) {
            if (!currentStateTreeNode.state.classification) return;

            return cancelAnalyse("classifiedMoveCard.insufficientLines");
        }

        const classified = analyseNode(currentStateTreeNode, {
            includeBrilliant: settings.classifications.included.brilliant,
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