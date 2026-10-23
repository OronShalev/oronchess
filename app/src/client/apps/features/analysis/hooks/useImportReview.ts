import AnalysisStatus from "@analysis/constants/AnalysisStatus";
import useAnalysisGameStore from "@analysis/stores/AnalysisGameStore";
import useAnalysisBoardStore from "@analysis/stores/AnalysisBoardStore";
import useAnalysisProgressStore from "@analysis/stores/AnalysisProgressStore";
import { decodeReviewCode } from "@analysis/lib/reviewShare";

/**
 * @description Returns a function that opens a game review shared from
 * OronChess as a code. Its evaluations are restored, so it is only
 * classified, without any engine search. Returns whether it was valid.
 */
function useImportReview() {
    const {
        setAnalysisGame,
        setGameAnalysisOpen
    } = useAnalysisGameStore();

    const setCurrentStateTreeNode = useAnalysisBoardStore(
        state => state.setCurrentStateTreeNode
    );

    const setAnalysisStatus = useAnalysisProgressStore(
        state => state.setAnalysisStatus
    );

    return (reviewCode: string) => {
        const analysisGame = decodeReviewCode(reviewCode);
        if (!analysisGame) return false;

        setAnalysisGame(analysisGame);
        setCurrentStateTreeNode(analysisGame.stateTree);
        setGameAnalysisOpen(true);

        // Classification picks up from here as after an evaluation
        setAnalysisStatus(AnalysisStatus.CLASSIFYING);

        return true;
    };
}

export default useImportReview;
