import React, { useId } from "react";
import { useTranslation } from "react-i18next";

import { StateTreeNode } from "@shared/types/game/position/StateTreeNode";
import { classificationImages } from "@analysis/constants/classifications";
import { getMoveLabel } from "@analysis/lib/learning";

import * as styles from "./GameLearning.module.css";

import iconInterfaceCheck from "@assets/img/interface/check.svg";
import iconInterfaceExpandArrow from "@assets/img/interface/expand_arrow.svg";

export interface MistakeListProps {
    mistakes: StateTreeNode[];
    selected?: StateTreeNode;
    solved: Record<string, boolean>;
    initialPosition?: string;
    open: boolean;
    // Whether moving to another mistake is blocked
    locked?: boolean;
    onToggle: () => void;
    onSelect: (mistake: StateTreeNode) => void;
}

function MistakeList({
    mistakes,
    selected,
    solved,
    initialPosition,
    open,
    locked,
    onToggle,
    onSelect
}: MistakeListProps) {
    const { t } = useTranslation("analysis");

    const movesId = useId();

    const solvedCount = mistakes.filter(mistake => solved[mistake.id]).length;

    return <div className={styles.list}>
        <button
            className={styles.listToggle}
            aria-expanded={open}
            aria-controls={movesId}
            onClick={onToggle}
        >
            <img
                className={styles.listToggleArrow}
                src={iconInterfaceExpandArrow}
                width={22}
                height={22}
                alt=""
                style={{ transform: open ? "rotate(180deg)" : undefined }}
            />

            <span>
                {t("learning.solvedCount", {
                    solved: solvedCount,
                    total: mistakes.length
                })}
            </span>
        </button>

        {open && <div id={movesId} className={styles.listMoves}>
            {mistakes.map(mistake => {
                const classification = mistake.state.classification;

                return <button
                    key={mistake.id}
                    className={`${styles.listMove} ${
                        mistake == selected ? styles.selectedListMove : ""
                    }`}
                    aria-current={mistake == selected}
                    disabled={locked}
                    onClick={() => onSelect(mistake)}
                >
                    {classification && <img
                        className={styles.listMoveIcon}
                        src={classificationImages[classification]}
                    />}

                    <span>{getMoveLabel(mistake, initialPosition)}</span>

                    {solved[mistake.id] && <img
                        className={styles.solvedBadge}
                        src={iconInterfaceCheck}
                        title={t("learning.solved")}
                        alt={t("learning.solved")}
                    />}
                </button>;
            })}
        </div>}
    </div>;
}

export default MistakeList;
