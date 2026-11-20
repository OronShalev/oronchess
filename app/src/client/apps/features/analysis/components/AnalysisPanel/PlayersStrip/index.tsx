import React, { useMemo } from "react";

import PieceColour from "@shared/constants/PieceColour";
import {
    getNodeClocks,
    getPgnTimeControl,
    hasClocks,
    parseTimeControl
} from "@shared/lib/stateTree/clocks";
import useAnalysisGameStore from "@analysis/stores/AnalysisGameStore";
import useAnalysisBoardStore from "@analysis/stores/AnalysisBoardStore";
import PlayerClock from "@client/components/chess/PlayerClock";

import * as styles from "./PlayersStrip.module.css";

const colours = [ PieceColour.WHITE, PieceColour.BLACK ];

/**
 * @description Both players and their clocks in one row, shown in place of
 * the rows above and below the board on short, wide screens, where those
 * would take too much of the board's height.
 */
function PlayersStrip() {
    const analysisGame = useAnalysisGameStore(state => state.analysisGame);

    const currentNode = useAnalysisBoardStore(
        state => state.currentStateTreeNode
    );

    const timeControl = useMemo(() => parseTimeControl(
        getPgnTimeControl(analysisGame.pgn)
    ), [analysisGame.pgn]);

    const gameHasClocks = useMemo(() => (
        hasClocks(analysisGame.stateTree)
    ), [analysisGame.stateTree]);

    const clocks = gameHasClocks
        ? getNodeClocks(currentNode, timeControl)
        : undefined;

    // The clock of the side to move is the one running
    const runningColour = currentNode.state.fen.split(" ")[1] == "w"
        ? PieceColour.WHITE
        : PieceColour.BLACK;

    return <div className={styles.wrapper}>
        {colours.map(colour => {
            const profile = analysisGame.players[colour];
            const seconds = clocks?.[colour];

            return <div key={colour} className={styles.player}>
                <span className={colour == PieceColour.WHITE
                    ? styles.whiteSwatch
                    : styles.blackSwatch
                }/>

                {profile.title && <span className={styles.title}>
                    {profile.title}
                </span>}

                <span className={styles.name}>
                    {profile.username || "?"}
                </span>

                {profile.rating != undefined && <span className={styles.rating}>
                    {profile.rating}
                </span>}

                {seconds != undefined && <span className={styles.clock}>
                    <PlayerClock
                        seconds={seconds}
                        running={colour == runningColour}
                    />
                </span>}
            </div>;
        })}
    </div>;
}

export default PlayersStrip;
