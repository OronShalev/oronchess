import React, { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Switch from "react-switch";

import AnalysedGame from "@shared/types/game/AnalysedGame";
import { getNodeChain } from "@shared/types/game/position/StateTreeNode";
import {
    getNodeClocks,
    getPgnTimeControl,
    hasClocks,
    parseTimeControl
} from "@shared/lib/stateTree/clocks";
import useSettingsStore from "@client/stores/SettingsStore";
import Dialog from "@client/components/common/Dialog";
import Button from "@client/components/common/Button";
import { canShareFile, saveFile, shareFile } from "@client/lib/files";
import { defaultVideoSpeed } from "@analysis/lib/video/timeline";
import { drawVideoFrame } from "@analysis/lib/video/frames";
import {
    VideoEncodingUnsupportedError,
    createVideoScene,
    exportGameVideo,
    videoHasBars
} from "@analysis/lib/video/exportVideo";

import SpeedSelector from "./SpeedSelector";
import ExportVideoDialogProps from "./ExportVideoDialogProps";
import * as styles from "./ExportVideoDialog.module.css";

import iconInterfaceShare from "@assets/img/interface/share.svg";

type ExportStatus =
    | { stage: "options" }
    | { stage: "exporting"; progress: number }
    | {
        stage: "done";
        video: Blob;
        hasSound: boolean;
        saved: boolean;
        saveFailed?: boolean;
        location?: string;
    }
    | { stage: "failed"; unsupported: boolean };

function getVideoFileName(game: AnalysedGame) {
    const name = [
        game.players.white.username || "White",
        "vs",
        game.players.black.username || "Black",
        game.date?.slice(0, 10)
    ].filter(Boolean).join(" ");

    return name
        .replace(/[^\p{L}\p{N} _.-]/gu, "")
        .trim()
        .replace(/\s+/g, "-")
        + ".mp4";
}

interface OptionSwitchProps {
    name: string;
    description: ReactNode;
    checked: boolean;
    disabled?: boolean;
    onChange: (checked: boolean) => void;
}

function OptionSwitch({
    name,
    description,
    checked,
    disabled,
    onChange
}: OptionSwitchProps) {
    return <label className={`${styles.option} ${disabled ? styles.optionDisabled : ""}`}>
        <span className={styles.optionText}>
            <span className={styles.optionName}>{name}</span>
            <span className={styles.optionDescription}>{description}</span>
        </span>

        <Switch
            checked={checked}
            onChange={onChange}
            height={25}
            onColor="#467de8"
            offColor="#2c2f35"
            uncheckedIcon={false}
            checkedIcon={false}
            disabled={disabled}
        />
    </label>;
}

function ExportVideoDialog({
    game,
    currentNode,
    flipped,
    onClose
}: ExportVideoDialogProps) {
    const { t } = useTranslation("analysis");

    const theme = useSettingsStore(state => state.settings.themes.board);

    const [ speed, setSpeed ] = useState(defaultVideoSpeed);
    const [ showPlayers, setShowPlayers ] = useState(true);
    const [ showClocks, setShowClocks ] = useState(true);
    const [ moveSounds, setMoveSounds ] = useState(true);

    const [ status, setStatus ] = useState<ExportStatus>({ stage: "options" });

    const mainline = useMemo(() => getNodeChain(game.stateTree), [game]);
    const gameHasClocks = useMemo(() => hasClocks(game.stateTree), [game]);

    const fileName = useMemo(() => getVideoFileName(game), [game]);

    const options = {
        speed: speed,
        showPlayers: showPlayers,
        showClocks: showClocks && gameHasClocks,
        moveSounds: moveSounds,
        flipped: flipped,
        theme: theme
    };

    const boardOnly = !videoHasBars(game, options);

    // The preview shows the current move, or the last move of the game
    const previewNode = currentNode.state.classification
        ? currentNode
        : mainline[mainline.length - 1];

    const previewRef = useRef<HTMLCanvasElement>(null);
    const [ previewReady, setPreviewReady ] = useState(false);

    useEffect(() => {
        let cancelled = false;

        createVideoScene(game, options).then(scene => {
            const canvas = previewRef.current;
            if (cancelled || !canvas) return;

            canvas.width = scene.layout.width;
            canvas.height = scene.layout.height;

            const periods = parseTimeControl(getPgnTimeControl(game.pgn));

            drawVideoFrame(canvas.getContext("2d")!, scene, {
                node: previewNode,
                progress: 1,
                clocks: options.showClocks
                    ? getNodeClocks(previewNode, periods)
                    : undefined
            });

            setPreviewReady(true);
        }).catch(error => console.error(error));

        return () => {
            cancelled = true;
        };
    }, [showPlayers, showClocks, flipped, previewNode]);

    // An export still running when the dialog closes is stopped
    const controllerRef = useRef<AbortController>();

    useEffect(() => () => controllerRef.current?.abort(), []);

    async function save(video: Blob, hasSound: boolean) {
        try {
            const result = await saveFile(video, fileName);

            setStatus({ stage: "done", video, hasSound, ...result });
        } catch (error) {
            console.error(error);

            setStatus({
                stage: "done", video, hasSound, saved: false, saveFailed: true
            });
        }
    }

    async function startExport() {
        const controller = new AbortController();
        controllerRef.current = controller;

        setStatus({ stage: "exporting", progress: 0 });

        let shownPercent = 0;

        try {
            var { video, hasSound } = await exportGameVideo(game, options, progress => {
                const percent = Math.floor(progress * 100);
                if (percent == shownPercent) return;

                shownPercent = percent;
                setStatus({ stage: "exporting", progress: percent });
            }, controller.signal);
        } catch (error) {
            if (error == "abort") return setStatus({ stage: "options" });

            console.error(error);

            return setStatus({
                stage: "failed",
                unsupported: error instanceof VideoEncodingUnsupportedError
            });
        } finally {
            controllerRef.current = undefined;
        }

        await save(video, hasSound);
    }

    const exporting = status.stage == "exporting";

    return <Dialog className={styles.wrapper} onClose={onClose}>
        <div className={styles.title}>
            {t("exportVideo.title")}
        </div>

        <div className={styles.content}>
            <span className={styles.description}>
                {t("exportVideo.description")}
            </span>

            <SpeedSelector
                value={speed}
                plyCount={mainline.length - 1}
                disabled={exporting}
                onChange={setSpeed}
            />

            <div className={styles.options}>
                <OptionSwitch
                    name={t("exportVideo.showPlayers")}
                    description={t("exportVideo.showPlayersDescription")}
                    checked={showPlayers}
                    disabled={exporting}
                    onChange={setShowPlayers}
                />

                <OptionSwitch
                    name={t("exportVideo.showClocks")}
                    description={gameHasClocks
                        ? t("exportVideo.showClocksDescription")
                        : t("exportVideo.noClocks")
                    }
                    checked={showClocks && gameHasClocks}
                    disabled={exporting || !gameHasClocks}
                    onChange={setShowClocks}
                />

                <OptionSwitch
                    name={t("exportVideo.moveSounds")}
                    description={t("exportVideo.moveSoundsDescription")}
                    checked={moveSounds}
                    disabled={exporting}
                    onChange={setMoveSounds}
                />
            </div>

            <div className={styles.preview}>
                <canvas
                    ref={previewRef}
                    className={styles.previewCanvas}
                    style={{ visibility: previewReady ? "visible" : "hidden" }}
                    aria-label={t("exportVideo.preview")}
                />

                <span className={styles.previewCaption}>
                    {boardOnly
                        ? t("exportVideo.boardOnly")
                        : t("exportVideo.preview")
                    }
                </span>
            </div>

            {status.stage == "options" && <Button
                className={styles.primaryButton}
                onClick={startExport}
            >
                {t("exportVideo.export")}
            </Button>}

            {status.stage == "exporting" && <div className={styles.progress}>
                <div className={styles.progressLabel}>
                    <span>{t("exportVideo.exporting")}</span>
                    <span>{status.progress}%</span>
                </div>

                <div
                    className={styles.progressBar}
                    role="progressbar"
                    aria-valuenow={status.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                >
                    <div
                        className={styles.progressFill}
                        style={{ width: `${status.progress}%` }}
                    />
                </div>

                <Button
                    className={styles.secondaryButton}
                    onClick={() => controllerRef.current?.abort()}
                >
                    {t("exportVideo.cancel")}
                </Button>
            </div>}

            {status.stage == "done" && <div className={styles.result}>
                <span className={status.saveFailed ? styles.error : styles.success}>
                    {status.saveFailed
                        ? t("exportVideo.saveFailed")
                        : status.saved
                            ? (status.location
                                ? t("exportVideo.savedTo", { location: status.location })
                                : t("exportVideo.saved")
                            )
                            : t("exportVideo.notSaved")
                    }
                </span>

                {!status.hasSound && <span className={styles.notice}>
                    {t("exportVideo.noSound")}
                </span>}

                <div className={styles.resultButtons}>
                    <Button
                        className={status.saved ? styles.secondaryButton : styles.primaryButton}
                        onClick={() => save(status.video, status.hasSound)}
                    >
                        {status.saved ? t("exportVideo.saveAgain") : t("exportVideo.save")}
                    </Button>

                    {canShareFile(status.video, fileName) && <Button
                        className={styles.primaryButton}
                        icon={iconInterfaceShare}
                        onClick={() => shareFile(status.video, fileName)}
                    >
                        {t("exportVideo.share")}
                    </Button>}
                </div>

                <Button
                    className={styles.linkButton}
                    onClick={() => setStatus({ stage: "options" })}
                >
                    {t("exportVideo.again")}
                </Button>
            </div>}

            {status.stage == "failed" && <div className={styles.result}>
                <span className={styles.error}>
                    {status.unsupported
                        ? t("exportVideo.unsupported")
                        : t("exportVideo.failed")
                    }
                </span>

                <Button
                    className={styles.secondaryButton}
                    onClick={() => setStatus({ stage: "options" })}
                >
                    {t("exportVideo.back")}
                </Button>
            </div>}
        </div>
    </Dialog>;
}

export default ExportVideoDialog;
