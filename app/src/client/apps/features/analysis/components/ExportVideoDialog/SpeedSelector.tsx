import React, { KeyboardEvent, useRef } from "react";
import { useTranslation } from "react-i18next";

import {
    VideoSpeed,
    getVideoDuration,
    videoSpeedTimings
} from "@analysis/lib/video/timeline";
import { formatClockTime } from "@shared/lib/stateTree/clocks";

import * as styles from "./ExportVideoDialog.module.css";

const speeds = [ VideoSpeed.SLOW, VideoSpeed.REGULAR, VideoSpeed.FAST ];

interface SpeedSelectorProps {
    value: VideoSpeed;
    plyCount: number;
    disabled?: boolean;
    onChange: (speed: VideoSpeed) => void;
}

/**
 * @description A slider with a stop for each video speed, showing how
 * long each move and the whole video last.
 */
function SpeedSelector({ value, plyCount, disabled, onChange }: SpeedSelectorProps) {
    const { t } = useTranslation("analysis");

    const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

    const selectedIndex = speeds.indexOf(value);

    function onKeyDown(event: KeyboardEvent) {
        const step = {
            ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1
        }[event.key];

        if (!step) return;
        event.preventDefault();

        const index = Math.min(Math.max(selectedIndex + step, 0), speeds.length - 1);

        onChange(speeds[index]);
        optionRefs.current[index]?.focus();
    }

    return <div className={styles.speed}>
        <div className={styles.optionHeader}>
            <span className={styles.optionName}>{t("exportVideo.speed")}</span>

            <span className={styles.speedValue}>
                {t(`exportVideo.speeds.${value}`)}
            </span>
        </div>

        <div
            className={styles.speedOptions}
            role="radiogroup"
            aria-label={t("exportVideo.speed")}
            onKeyDown={onKeyDown}
        >
            <div className={styles.speedRail}>
                <div
                    className={styles.speedFill}
                    style={{ width: `${selectedIndex / (speeds.length - 1) * 100}%` }}
                />
            </div>

            {speeds.map((speed, index) => <button
                key={speed}
                ref={element => optionRefs.current[index] = element}
                className={[
                    styles.speedOption,
                    index <= selectedIndex ? styles.speedReached : "",
                    speed == value ? styles.speedSelected : ""
                ].join(" ")}
                role="radio"
                aria-checked={speed == value}
                tabIndex={speed == value ? 0 : -1}
                disabled={disabled}
                onClick={() => onChange(speed)}
            >
                <span className={styles.speedDotArea}>
                    <span className={styles.speedDot} />
                </span>

                <span className={styles.speedLabel}>
                    {t(`exportVideo.speeds.${speed}`)}
                </span>

                <span className={styles.speedDetail}>
                    {t("exportVideo.perMove", {
                        seconds: videoSpeedTimings[speed].moveSeconds
                    })}
                </span>
            </button>)}
        </div>

        <span className={styles.optionDescription}>
            {t("exportVideo.length", {
                length: formatClockTime(Math.round(getVideoDuration(plyCount, value)))
            })}
        </span>
    </div>;
}

export default SpeedSelector;
