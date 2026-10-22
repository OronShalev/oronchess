import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Chess } from "chess.js";
import { range } from "lodash-es";

import { EngineLine } from "@shared/types/game/position/EngineLine";
import { pickEngineLines } from "@shared/types/game/position/EngineLine";
import LogMessage from "@client/components/common/LogMessage";
import Engine from "@analysis/lib/engine";

import EngineLineInfo from "./EngineLine";
import SkeletonLine from "./SkeletonLine";
import RealtimeEngineProps from "./RealtimeEngineProps";
import * as styles from "./RealtimeEngine.module.css";

type Timeout = ReturnType<typeof setTimeout>;

function RealtimeEngine({
    className,
    style,
    initialPosition,
    playedUciMoves,
    config,
    cachedEngineLines,
    paused,
    onEngineLines,
    onEvaluationStart,
    onEvaluationComplete
}: RealtimeEngineProps) {
    const hydratedConfig = { ...config, lines: config.lines || 1 };

    const { t } = useTranslation("analysis");

    const [ engine, setEngine ] = useState<Engine>();

    const [
        realtimeEngineLines,
        setRealtimeEngineLines
    ] = useState<EngineLine[]>([]);

    const [ evaluationError, setEvaluationError ] = useState<string>();

    const evaluationDelayRef = useRef<Timeout>();

    const position = useMemo(() => {
        const board = new Chess(initialPosition);
        if (!playedUciMoves) return initialPosition;

        for (const uciMove of playedUciMoves) {
            try {
                board.move(uciMove);
            } catch {
                return initialPosition;
            }
        }

        return board.fen();
    }, [initialPosition, playedUciMoves]);

    // Instantiate new engine when version changes. None is kept while
    // paused, so that it holds no memory while a game is evaluated
    useEffect(() => {
        if (paused) {
            setEngine(undefined);
            return;
        }

        const newEngine = new Engine(hydratedConfig.version);
        setEngine(newEngine);

        return () => newEngine.terminate();
    }, [hydratedConfig.version, paused]);

    // Get number of lines expected to appear
    const expectedLineCount = useMemo(() => Math.min(
        new Chess(position).moves().length,
        hydratedConfig.lines
    ), [position, hydratedConfig.lines]);

    // Calculate which lines should be displayed
    const displayedCacheLines = useMemo(() => pickEngineLines(
        position,
        cachedEngineLines || [],
        {
            count: hydratedConfig.lines,
            depth: hydratedConfig.depth,
            source: hydratedConfig.version
        }
    ), [
        position,
        cachedEngineLines,
        hydratedConfig.lines,
        hydratedConfig.depth,
        hydratedConfig.version
    ]);

    // Cached lines with fewer lines than displayed, shown until
    // the local engine reaches the same depth
    const partialCacheLines = useMemo(() => {
        if (displayedCacheLines) return null;

        const lines = pickEngineLines(
            position,
            cachedEngineLines || [],
            {
                depth: hydratedConfig.depth,
                source: hydratedConfig.version
            }
        );

        return lines?.length ? lines : null;
    }, [
        position,
        cachedEngineLines,
        displayedCacheLines,
        hydratedConfig.depth,
        hydratedConfig.version
    ]);

    const displayedLocalLines = useMemo(() => pickEngineLines(
        position,
        realtimeEngineLines,
        {
            count: hydratedConfig.lines,
            source: hydratedConfig.version
        }
    ) || [], [realtimeEngineLines]);

    const displayedLines = displayedCacheLines || (
        partialCacheLines && (
            displayedLocalLines[0]?.depth || 0
        ) < partialCacheLines[0].depth
            ? partialCacheLines
            : displayedLocalLines
    );

    useEffect(() => (
        onEngineLines?.(displayedLines)
    ), [displayedLines]);

    async function evaluatePosition() {
        if (!engine) return;

        engine.setPosition(initialPosition, playedUciMoves);
        engine.setLineCount(hydratedConfig.lines);

        try {
            setEvaluationError(undefined);
            onEvaluationStart?.();

            const lines = await engine.evaluate({
                depth: hydratedConfig.depth,
                timeLimit: (
                    hydratedConfig.timeLimit
                    && (hydratedConfig.timeLimit * 1000)
                ),
                onEngineLine: line => {
                    setRealtimeEngineLines(prev => [ ...prev, line ]);
                }
            });

            onEvaluationComplete?.(lines);
        } catch {
            setEvaluationError(
                t("realtimeEngine.error")
            );
        }
    }

    // Evaluate position when settings or position change, except
    // while the whole game is being evaluated by other engines
    useEffect(() => {
        if (displayedCacheLines || paused) {
            if (evaluationDelayRef.current) {
                clearTimeout(evaluationDelayRef.current);
            }

            engine?.stopEvaluation();
            return;
        }

        async function queueEvaluation() {
            await engine?.stopEvaluation();

            if (evaluationDelayRef.current) {
                clearTimeout(evaluationDelayRef.current);
            }

            setRealtimeEngineLines([]);

            evaluationDelayRef.current = setTimeout(evaluatePosition, 400);
        }

        queueEvaluation();
    }, [
        position,
        engine,
        paused,
        !!displayedCacheLines,
        hydratedConfig.depth,
        hydratedConfig.lines
    ]);

    return <div
        className={`${styles.wrapper} ${className}`}
        style={style}
    >
        <span className={styles.depth}>
            <span>
                {t("realtimeEngine.depth")}
            </span>

            <span>
                {displayedLines.at(0)?.depth || 0}
            </span>
        </span>

        {displayedLines.map((line, index) => <>
            <EngineLineInfo line={line} key={line.index} />

            {index != (displayedLines.length - 1)
                && <hr className={styles.engineLineSeparator} />
            }
        </>)}

        {displayedLines.at(0)?.depth != 0
            && range(
                Math.max(0, expectedLineCount - displayedLines.length)
            ).map(() => <>
                <hr className={styles.engineLineSeparator} />
                <SkeletonLine/>
            </>)
        }

        {evaluationError && <LogMessage>
            {evaluationError}
        </LogMessage>}
    </div>;
}

export default RealtimeEngine;