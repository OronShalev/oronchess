import React from "react";
import { useTranslation } from "react-i18next";

import PieceColour from "@shared/constants/PieceColour";
import PlayerProfile from "@shared/types/game/PlayerProfile";

import * as styles from "./GameLearning.module.css";

export interface SideSelectorProps {
    colour: PieceColour;
    players: Record<PieceColour, PlayerProfile>;
    mistakeCounts: Record<PieceColour, number>;
    // Whether changing side is blocked
    locked?: boolean;
    onSelect: (colour: PieceColour) => void;
}

const sides = [ PieceColour.WHITE, PieceColour.BLACK ];

function SideSelector({
    colour,
    players,
    mistakeCounts,
    locked,
    onSelect
}: SideSelectorProps) {
    const { t } = useTranslation("analysis");

    return <div
        className={styles.sides}
        role="radiogroup"
        aria-label={t("learning.sides")}
    >
        {sides.map(side => <button
            key={side}
            className={`${styles.side} ${side == colour ? styles.selectedSide : ""}`}
            role="radio"
            aria-checked={side == colour}
            disabled={locked}
            onClick={() => onSelect(side)}
        >
            <span className={side == PieceColour.WHITE
                ? styles.sideToMoveWhite
                : styles.sideToMoveBlack
            }/>

            <span className={styles.sideName}>
                {players[side].username || t(`learning.colours.${side}`)}
            </span>

            <span
                className={styles.sideCount}
                title={t("learning.mistakeCount", {
                    count: mistakeCounts[side]
                })}
            >
                {mistakeCounts[side]}
            </span>
        </button>)}
    </div>;
}

export default SideSelector;
