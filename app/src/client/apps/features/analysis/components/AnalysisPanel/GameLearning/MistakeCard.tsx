import React from "react";
import { useTranslation } from "react-i18next";
import { Chess } from "chess.js";

import PieceColour from "@shared/constants/PieceColour";
import { Classification } from "@shared/constants/Classification";
import Evaluation from "@shared/types/game/position/Evaluation";
import {
    StateTreeNode,
    getNodeMoveNumber
} from "@shared/types/game/position/StateTreeNode";
import { getTopEngineLine } from "@shared/types/game/position/EngineLine";
import { getSimpleNotation, stringifyEvaluation } from "@shared/lib/utils/chess";
import {
    classificationColours,
    classificationImages,
    loadingClassificationIcon,
    errorClassificationIcon
} from "@analysis/constants/classifications";
import {
    AttemptResult,
    LearningStep,
    getAttemptResult,
    getMoveLabel,
    isSolvingResult
} from "@analysis/lib/learning";
import Button from "@client/components/common/Button";

import * as styles from "./GameLearning.module.css";

import iconInterfaceBack from "@assets/img/interface/back.svg";
import iconInterfaceRetry from "@assets/img/interface/retry.svg";
import iconInterfaceLightbulb from "@assets/img/interface/lightbulb.svg";
import iconInterfaceCheck from "@assets/img/interface/check.svg";
import iconInterfacePlay from "@assets/img/interface/play.svg";

export interface MistakeCardProps {
    step: LearningStep;
    mistake: StateTreeNode;
    // The node on the board
    node: StateTreeNode;
    // Every mistake of the side, with those solved
    mistakes: StateTreeNode[];
    solved: Record<string, boolean>;
    initialPosition?: string;
    simpleNotation?: boolean;
    // Whether the best move was shown for this mistake
    revealed?: boolean;
    checkFailed?: boolean;
    // The engine's line after the mistake while it plays out, and how
    // many of its moves are on the board
    line?: StateTreeNode[];
    lineShown?: number;
    onSelect: (mistake: StateTreeNode) => void;
    onPrevious?: () => void;
    onNext?: () => void;
    onTryAgain: () => void;
    onShowBest?: () => void;
    onShowLine?: () => void;
    onCloseLine: () => void;
    onReturn: () => void;
}

function getMoveText(
    node: StateTreeNode,
    simpleNotation?: boolean,
    initialPosition?: string
) {
    if (simpleNotation && node.parent && node.state.move) {
        try {
            return getSimpleNotation(
                new Chess(node.parent.state.fen).move(node.state.move.san)
            );
        } catch {}
    }

    return getMoveLabel(node, initialPosition);
}

function EvaluationValue({ evaluation, fen }: {
    evaluation: Evaluation;
    fen: string;
}) {
    // A mate on the board is good for the side that delivered it
    const whiteAhead = evaluation.type == "mate" && evaluation.value == 0
        ? fen.split(" ")[1] == "b"
        : evaluation.value >= 0;

    return <span className={whiteAhead
        ? styles.evaluationWhite
        : styles.evaluationBlack
    }>
        {evaluation.type == "mate" && evaluation.value == 0
            ? "#"
            : stringifyEvaluation(evaluation, true)
        }
    </span>;
}

function EvaluationChange({ node }: { node: StateTreeNode }) {
    const { t } = useTranslation("analysis");

    const before = node.parent
        && getTopEngineLine(node.parent.state.engineLines)?.evaluation;
    const after = getTopEngineLine(node.state.engineLines)?.evaluation;

    if (!node.parent || !before || !after) return null;

    return <div className={styles.evaluationChange}>
        <span>{t("learning.evaluation")}</span>

        <EvaluationValue evaluation={before} fen={node.parent.state.fen} />
        <span aria-hidden>→</span>
        <EvaluationValue evaluation={after} fen={node.state.fen} />
    </div>;
}

function MistakeCard({
    step,
    mistake,
    node,
    mistakes,
    solved,
    initialPosition,
    simpleNotation,
    revealed,
    checkFailed,
    line,
    lineShown = 0,
    onSelect,
    onPrevious,
    onNext,
    onTryAgain,
    onShowBest,
    onShowLine,
    onCloseLine,
    onReturn
}: MistakeCardProps) {
    const { t } = useTranslation("analysis");

    // Moving between mistakes waits for the engine's line to be closed
    const locked = !!line;

    function renderVerdict(verdictNode: StateTreeNode) {
        const classification = verdictNode.state.classification;
        const moveText = getMoveText(
            verdictNode, simpleNotation, initialPosition
        );

        if (!classification) return <div className={styles.verdict}>
            <img src={checkFailed
                ? errorClassificationIcon
                : loadingClassificationIcon
            }/>

            <span className={styles.verdictText}>
                {checkFailed
                    ? t("learning.checkFailed", { move: moveText })
                    : t("learning.checking", { move: moveText })
                }
            </span>
        </div>;

        return <div className={styles.verdict}>
            <img src={classificationImages[classification]} />

            <span
                className={styles.verdictText}
                style={{ color: classificationColours[classification] }}
            >
                {moveText} {t(`classifiedMoveCard.classifications.${classification}`)}
            </span>
        </div>;
    }

    function getResultMessage(result: AttemptResult) {
        if (result == AttemptResult.BEST) {
            if (revealed) {
                return t("learning.results.revealed");
            }

            // Opening moves are good, though not always the best
            if (node.state.classification == Classification.THEORY) {
                return t("learning.results.theory");
            }
        }

        return t(`learning.results.${result}`);
    }

    const tryAgainButton = <Button
        className={styles.primaryButton}
        icon={iconInterfaceRetry}
        onClick={onTryAgain}
    >
        {t("learning.tryAgain")}
    </Button>;

    const showBestButton = onShowBest && <Button
        className={styles.secondaryButton}
        icon={iconInterfaceLightbulb}
        onClick={onShowBest}
    >
        {t("learning.showBest")}
    </Button>;

    const showLineButton = onShowLine && <Button
        className={styles.secondaryButton}
        icon={iconInterfacePlay}
        onClick={onShowLine}
    >
        {t("learning.showLine")}
    </Button>;

    function renderLine(lineNodes: StateTreeNode[]) {
        return <>
            <div className={styles.verdict}>
                {mistake.state.classification && <img
                    src={classificationImages[mistake.state.classification]}
                />}

                <span className={styles.verdictText}>
                    {t("learning.line.title", {
                        move: getMoveText(mistake, simpleNotation, initialPosition)
                    })}
                </span>
            </div>

            <div className={styles.line}>
                {lineNodes.map((lineNode, index) => {
                    const moveNumber = Math.floor(
                        getNodeMoveNumber(lineNode, initialPosition)
                    );

                    const blackMove = lineNode.state.moveColour == PieceColour.BLACK;

                    // Black moves are numbered only when they come first
                    const prefix = blackMove
                        ? (index == 0 ? `${moveNumber}... ` : "")
                        : `${moveNumber}. `;

                    const shownClass = index < lineShown - 1
                        ? styles.linePlayed
                        : (index == lineShown - 1
                            ? styles.lineCurrent
                            : styles.lineUpcoming
                        );

                    return <span
                        key={lineNode.id}
                        className={`${styles.lineMove} ${shownClass}`}
                    >
                        {prefix}{lineNode.state.move?.san}
                    </span>;
                })}
            </div>

            <div className={styles.actions}>
                <Button
                    className={styles.primaryButton}
                    onClick={onCloseLine}
                >
                    {t("learning.line.ok")}
                </Button>
            </div>
        </>;
    }

    function renderNextButton(primary: boolean) {
        if (!onNext) return;

        return <Button
            className={primary ? styles.primaryButton : styles.secondaryButton}
            onClick={onNext}
        >
            {t("learning.nextMistake")}
        </Button>;
    }

    function renderBody() {
        if (line) return renderLine(line);

        if (step == LearningStep.MISTAKE) return <>
            {renderVerdict(mistake)}

            <EvaluationChange node={mistake} />

            <div className={styles.actions}>
                {tryAgainButton}
                {showBestButton}
                {showLineButton}
            </div>
        </>;

        if (step == LearningStep.RETRY) {
            const side = mistake.state.moveColour == PieceColour.BLACK
                ? PieceColour.BLACK
                : PieceColour.WHITE;

            return <>
                <div className={styles.verdict}>
                    <span className={side == PieceColour.WHITE
                        ? styles.sideToMoveWhite
                        : styles.sideToMoveBlack
                    }/>

                    <span className={styles.verdictText}>
                        {t(`learning.findBetter.${side}`)}
                    </span>
                </div>

                <span className={styles.hint}>
                    {t("learning.findBetterHint", {
                        move: getMoveText(mistake, simpleNotation, initialPosition)
                    })}
                </span>

                <div className={styles.actions}>
                    {showBestButton}
                </div>
            </>;
        }

        if (step == LearningStep.ATTEMPT) {
            const result = getAttemptResult(node);
            const solving = isSolvingResult(result);

            return <>
                {renderVerdict(node)}

                {result && <span className={solving
                    ? styles.resultGood
                    : styles.resultBad
                }>
                    {solving && <img
                        className={styles.solvedBadge}
                        src={iconInterfaceCheck}
                    />}

                    {getResultMessage(result)}
                </span>}

                {result && <EvaluationChange node={node} />}

                {(result || checkFailed) && <div className={styles.actions}>
                    {!solving || checkFailed
                        ? <>
                            {tryAgainButton}
                            {showBestButton}
                        </>
                        : <>
                            {renderNextButton(true)}

                            {result == AttemptResult.GOOD && showBestButton}

                            <Button
                                className={styles.secondaryButton}
                                icon={iconInterfaceRetry}
                                onClick={onTryAgain}
                            >
                                {t("learning.tryAgain")}
                            </Button>
                        </>
                    }
                </div>}

                {solving && !onNext
                    && <span className={styles.hint}>
                        {t("learning.lastMistake")}
                    </span>
                }
            </>;
        }

        return <>
            <span className={styles.hint}>
                {t("learning.away")}
            </span>

            <div className={styles.actions}>
                <Button
                    className={styles.primaryButton}
                    onClick={onReturn}
                >
                    {t("learning.backToMistake")}
                </Button>
            </div>
        </>;
    }

    return <div className={styles.card}>
        <div className={styles.cardHeader}>
            <button
                className={styles.stepButton}
                disabled={!onPrevious || locked}
                onClick={onPrevious}
                title={t("learning.previous")}
                aria-label={t("learning.previous")}
            >
                <img src={iconInterfaceBack} />
            </button>

            <div
                className={styles.progress}
                role="group"
                aria-label={t("learning.progress")}
            >
                {mistakes.map((other, index) => {
                    const otherSolved = !!solved[other.id];

                    const label = t("learning.progressSquare", {
                        number: index + 1,
                        move: getMoveLabel(other, initialPosition)
                    }) + (otherSolved ? ` (${t("learning.solved")})` : "");

                    return <button
                        key={other.id}
                        className={[
                            styles.progressSquare,
                            otherSolved ? styles.solvedSquare : "",
                            other == mistake ? styles.currentSquare : ""
                        ].join(" ")}
                        aria-current={other == mistake ? "step" : undefined}
                        disabled={locked}
                        aria-label={label}
                        title={label}
                        onClick={() => onSelect(other)}
                    >
                        {otherSolved && <img src={iconInterfaceCheck} alt="" />}
                    </button>;
                })}
            </div>

            <button
                className={`${styles.stepButton} ${styles.stepButtonNext}`}
                disabled={!onNext || locked}
                onClick={onNext}
                title={t("learning.next")}
                aria-label={t("learning.next")}
            >
                <img src={iconInterfaceBack} />
            </button>
        </div>

        <div className={styles.cardBody}>
            {renderBody()}
        </div>
    </div>;
}

export default MistakeCard;
