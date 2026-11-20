import { create } from "zustand";

import PieceColour from "@shared/constants/PieceColour";
import { StateTreeNode } from "@shared/types/game/position/StateTreeNode";

interface LearningStore {
    // The game whose mistakes are being learned from
    rootNode?: StateTreeNode;
    colour: PieceColour;
    mistake?: StateTreeNode;
    // IDs of mistakes for which an excellent move or better was found,
    // or the best move was shown
    solved: Record<string, boolean>;
    // IDs of mistakes for which the best move was shown
    revealed: Record<string, boolean>;
    // The engine's line after the mistake while it is played out, and
    // how many of its moves are on the board
    line?: StateTreeNode[];
    lineShown: number;

    startGame: (rootNode: StateTreeNode, colour: PieceColour) => void;
    setColour: (colour: PieceColour) => void;
    setMistake: (mistake?: StateTreeNode) => void;
    setSolved: (mistake: StateTreeNode) => void;
    setRevealed: (mistake: StateTreeNode) => void;
    showLine: (line: StateTreeNode[]) => void;
    advanceLine: () => void;
    closeLine: () => void;
}

const useLearningStore = create<LearningStore>(set => ({
    colour: PieceColour.WHITE,
    solved: {},
    revealed: {},
    lineShown: 0,

    startGame(rootNode, colour) {
        set({
            rootNode: rootNode,
            colour: colour,
            mistake: undefined,
            solved: {},
            revealed: {},
            line: undefined,
            lineShown: 0
        });
    },

    showLine(line) {
        set({ line: line, lineShown: 0 });
    },

    advanceLine() {
        set(state => ({
            lineShown: Math.min(state.lineShown + 1, state.line?.length || 0)
        }));
    },

    closeLine() {
        set({ line: undefined, lineShown: 0 });
    },

    setColour(colour) {
        set({ colour: colour });
    },

    setMistake(mistake) {
        set({ mistake: mistake });
    },

    setSolved(mistake) {
        set(state => ({
            solved: { ...state.solved, [mistake.id]: true }
        }));
    },

    setRevealed(mistake) {
        set(state => ({
            revealed: { ...state.revealed, [mistake.id]: true }
        }));
    }
}));

export default useLearningStore;
