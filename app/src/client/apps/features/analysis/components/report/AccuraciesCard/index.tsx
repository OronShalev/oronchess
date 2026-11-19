import React from "react";
import { useTranslation } from "react-i18next";

import { SideAccuracy } from "@shared/lib/reporter/accuracy";
import AccuraciesCardProps from "./AccuraciesCardProps";
import * as styles from "./AccuraciesCard.module.css";

function formatAccuracy({ accuracy }: SideAccuracy) {
    return Number.isFinite(accuracy)
        ? accuracy.toFixed(1) + "%"
        : "N/A";
}

function AccuraciesCard({ accuracies }: AccuraciesCardProps) {
    const { t } = useTranslation("analysis");

    const partial = [accuracies.white, accuracies.black].some(
        side => side.analysedMoves < side.totalMoves
    );

    return <div className={styles.wrapper}>
        <div className={styles.accuraciesTitle}>
            {t("accuraciesCard.title")}
        </div>

        <div className={styles.accuracies}>
            <div className={`${styles.accuracy} ${styles.whiteAccuracy}`}>
                {formatAccuracy(accuracies.white)}
            </div>

            <div className={`${styles.accuracy} ${styles.blackAccuracy}`}>
                {formatAccuracy(accuracies.black)}
            </div>
        </div>

        {partial && <div className={styles.partialNotice}>
            {t("accuraciesCard.partial", {
                white: `${accuracies.white.analysedMoves}/${accuracies.white.totalMoves}`,
                black: `${accuracies.black.analysedMoves}/${accuracies.black.totalMoves}`
            })}
        </div>}
    </div>;
}

export default AccuraciesCard;