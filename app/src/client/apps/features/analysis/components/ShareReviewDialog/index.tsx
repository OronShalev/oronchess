import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { renderReviewedPgn } from "@analysis/lib/reviewShare";
import Dialog from "@client/components/common/Dialog";
import TextField from "@client/components/common/TextField";
import Button from "@client/components/common/Button";

import ShareReviewDialogProps from "./ShareReviewDialogProps";
import * as styles from "./ShareReviewDialog.module.css";

import iconInterfaceShare from "@assets/img/interface/share.svg";

declare global {
    interface Window {
        // Provided by the Android app, whose WebView has no Web Share API
        AndroidShare?: { shareText: (text: string) => void };
    }
}

function shareText(text: string) {
    if (window.AndroidShare) {
        window.AndroidShare.shareText(text);
    } else {
        // Rejects when the share sheet is dismissed
        navigator.share({ text }).catch(() => undefined);
    }
}

const canShareText = !!window.AndroidShare || !!navigator.share;

function ShareReviewDialog({ game, onClose }: ShareReviewDialogProps) {
    const { t } = useTranslation(["analysis", "common"]);

    const [ reviewedPgn, setReviewedPgn ] = useState<string>();

    useEffect(() => {
        renderReviewedPgn(game)
            .then(setReviewedPgn)
            .catch(err => console.error(err));
    }, [game]);

    return <Dialog className={styles.wrapper} onClose={onClose}>
        <div className={styles.title}>
            {t("shareReview.title")}
        </div>

        <div className={styles.content}>
            <span className={styles.description}>
                {t("shareReview.description")}
            </span>

            {/* Text fields copy the value they were created with */}
            {reviewedPgn && <TextField
                wrapperStyle={{ width: "100%", height: "200px" }}
                className={styles.field}
                copyClassName={styles.fieldCopy}
                value={reviewedPgn}
                multiline
                readOnly
                copyable
                copyTooltip={t("shareGame.copyReviewedPGN", { ns: "common" })}
                copyToast={t("shareGame.copyReviewedPGNToast", { ns: "common" })}
                onClick={event => event.currentTarget.select()}
            />}

            {reviewedPgn && canShareText && <Button
                className={styles.shareButton}
                icon={iconInterfaceShare}
                onClick={() => shareText(reviewedPgn)}
            >
                {t("shareGame.shareReview", { ns: "common" })}
            </Button>}
        </div>
    </Dialog>;
}

export default ShareReviewDialog;
