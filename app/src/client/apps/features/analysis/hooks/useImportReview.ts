import AnalysedGame from "@shared/types/game/AnalysedGame";
import AnalysisStatus from "@analysis/constants/AnalysisStatus";
import useAnalysisGameStore from "@analysis/stores/AnalysisGameStore";
import useAnalysisBoardStore from "@analysis/stores/AnalysisBoardStore";
import useAnalysisProgressStore from "@analysis/stores/AnalysisProgressStore";
import parseStateTree from "@shared/lib/stateTree/parse";
import parsePgn from "@client/lib/games/pgn";
import { decodeReview, getReviewTag } from "@analysis/lib/reviewShare";

/**
 * @description Returns a function that opens a game review shared from
 * WintrChess. Its evaluations are restored, so it is only classified,
 * without any engine search. Resolves to whether the review was valid.
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

    return async (reviewedPgn: string) => {
        const reviewTag = getReviewTag(reviewedPgn);
        if (!reviewTag) return false;

        try {
            const game = parsePgn(reviewedPgn);

            var analysisGame: AnalysedGame = {
                ...game,
                stateTree: parseStateTree(game)
            };
        } catch {
            return false;
        }

        if (!await decodeReview(reviewTag, analysisGame.stateTree)) {
            return false;
        }

        setAnalysisGame(analysisGame);
        setCurrentStateTreeNode(analysisGame.stateTree);
        setGameAnalysisOpen(true);

        // Classification picks up from here as after an evaluation
        setAnalysisStatus(AnalysisStatus.CLASSIFYING);

        return true;
    };
}

export default useImportReview;
