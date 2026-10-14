import { Chess, Move } from "chess.js";

import { BoardState } from "@shared/types/game/position/BoardState";
import { EngineLine } from "@shared/types/game/position/EngineLine";
import Evaluation from "@shared/types/game/position/Evaluation";

export interface ExtractedNode {
    board: Chess;
    state: BoardState;
    topLine: EngineLine;
    evaluation: Evaluation;
    secondTopLine?: EngineLine;
    secondTopMove?: Move;
    secondSubjectiveEvaluation?: Evaluation;
}

export interface ExtractedPreviousNode extends ExtractedNode {
    topMove: Move;
    subjectiveEvaluation?: Evaluation;
    playedMove?: Move;
}

export interface ExtractedCurrentNode extends ExtractedNode {
    topMove?: Move;
    subjectiveEvaluation: Evaluation;
    playedMove: Move;
}