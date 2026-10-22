import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import useImportReview from "@analysis/hooks/useImportReview";
import Dialog from "@client/components/common/Dialog";
import TextField from "@client/components/common/TextField";
import Button from "@client/components/common/Button";
import LogMessage from "@client/components/common/LogMessage";

import ImportReviewDialogProps from "./ImportReviewDialogProps";
import * as styles from "./ImportReviewDialog.module.css";

import iconAnalysis from "@assets/img/interface/analysis.svg";

function ImportReviewDialog({ onClose }: ImportReviewDialogProps) {
    const { t } = useTranslation("analysis");

    const importReview = useImportReview();

    const [ reviewCode, setReviewCode ] = useState("");
    const [ invalid, setInvalid ] = useState(false);

    function open() {
        if (importReview(reviewCode)) {
            return onClose();
        }

        setInvalid(true);
    }

    return <Dialog className={styles.wrapper} onClose={onClose}>
        <div className={styles.title}>
            {t("importReview.title")}
        </div>

        <div className={styles.content}>
            <span className={styles.description}>
                {t("importReview.description")}
            </span>

            <TextField
                wrapperStyle={{ width: "100%", height: "120px" }}
                className={styles.field}
                placeholder={t("importReview.placeholder")}
                value={reviewCode}
                multiline
                onChange={value => {
                    setReviewCode(value);
                    setInvalid(false);
                }}
            />

            {invalid && <LogMessage className={styles.error}>
                {t("importReview.invalid")}
            </LogMessage>}

            <Button
                className={styles.openButton}
                icon={iconAnalysis}
                iconSize="25px"
                disabled={reviewCode.trim().length == 0}
                onClick={open}
            >
                {t("importReview.openButton")}
            </Button>
        </div>
    </Dialog>;
}

export default ImportReviewDialog;
