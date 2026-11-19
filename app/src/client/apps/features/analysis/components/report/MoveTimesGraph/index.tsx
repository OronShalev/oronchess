import React, { useId } from "react";
import { useTranslation } from "react-i18next";
import {
    ResponsiveContainer,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    ReferenceLine
} from "recharts";
import { max } from "lodash-es";

import PieceColour from "@shared/constants/PieceColour";
import { getNodeMoveNumber } from "@shared/types/game/position/StateTreeNode";
import { formatClockTime, formatMoveTime } from "@shared/lib/stateTree/clocks";

import MoveTimesGraphProps from "./MoveTimesGraphProps";
import * as styles from "./MoveTimesGraph.module.css";

import iconInterfaceExpandArrow from "@assets/img/interface/expand_arrow.svg";

// Bars for White rise from the axis and bars for Black fall from it, in
// the colours of the pieces
const barColours = {
    [PieceColour.WHITE]: "#e6e8eb",
    [PieceColour.BLACK]: "#80868f"
};

interface MoveTimePoint {
    index: number;
    // Time spent, negative for Black so that their bars fall
    y: number;
    moveTime?: number;
    clock?: number;
    colour?: PieceColour;
    label: string;
}

interface BarShapeProps {
    x: number;
    y: number;
    width: number;
    height: number;
    payload: MoveTimePoint;
}

// A bar rounded at its data end and square at the axis
function BarShape({ x, y, width, height, payload }: BarShapeProps) {
    const top = Math.min(y, y + height);
    const barHeight = Math.abs(height);
    if (barHeight == 0 || width <= 0) return null;

    const radius = Math.min(2, width / 2, barHeight);
    const right = x + width;
    const bottom = top + barHeight;
    const fill = payload.colour ? barColours[payload.colour] : "none";

    const path = payload.y >= 0
        ? `M${x},${bottom} V${top + radius} Q${x},${top} ${x + radius},${top}`
            + ` H${right - radius} Q${right},${top} ${right},${top + radius}`
            + ` V${bottom} Z`
        : `M${x},${top} V${bottom - radius} Q${x},${bottom} ${x + radius},${bottom}`
            + ` H${right - radius} Q${right},${bottom} ${right},${bottom - radius}`
            + ` V${top} Z`;

    return <path d={path} fill={fill} />;
}

function MoveTimesGraph({
    nodes,
    timeControl,
    initialPosition,
    selectedIndex,
    open,
    onToggle,
    onMoveClick
}: MoveTimesGraphProps) {
    const { t } = useTranslation("analysis");

    const chartId = useId();

    const points: MoveTimePoint[] = nodes.map((node, index) => {
        const { moveTime, moveColour, clock, move } = node.state;
        const moveNumber = Math.floor(getNodeMoveNumber(node, initialPosition));

        return {
            index: index,
            y: (moveTime || 0) * (moveColour == PieceColour.BLACK ? -1 : 1),
            moveTime: moveTime,
            clock: clock,
            colour: moveColour,
            label: move
                ? `${moveNumber}${moveColour == PieceColour.WHITE ? "." : "..."} ${move.san}`
                : ""
        };
    });

    const longestTime = max(points.map(point => Math.abs(point.y))) || 1;

    return <div className={styles.wrapper}>
        <div className={styles.header}>
            <button
                className={styles.toggle}
                aria-expanded={open}
                aria-controls={chartId}
                onClick={onToggle}
            >
                <img
                    className={styles.toggleArrow}
                    src={iconInterfaceExpandArrow}
                    width={22}
                    height={22}
                    alt=""
                    style={{ transform: open ? "rotate(180deg)" : undefined }}
                />

                <span className={styles.title}>
                    {t("moveTimesGraph.title")}
                </span>

                {timeControl && <span className={styles.timeControl}>
                    {timeControl}
                </span>}
            </button>

            {open && <span className={styles.legend}>
                {[PieceColour.WHITE, PieceColour.BLACK].map(colour => (
                    <span key={colour} className={styles.legendItem}>
                        <span
                            className={styles.legendSwatch}
                            style={{ backgroundColor: barColours[colour] }}
                        />
                        {t(`moveTimesGraph.${colour}`)}
                    </span>
                ))}
            </span>}
        </div>

        {open && <div id={chartId}>
            <ResponsiveContainer width="100%" height={110}>
                <BarChart
                    className={styles.chart}
                    data={points}
                    margin={{ top: 4, right: 0, bottom: 4, left: 0 }}
                    barCategoryGap="15%"
                    onClick={event => {
                        const index = event?.activePayload?.at(0)?.payload?.index;
                        if (index == undefined || !nodes[index]) return;

                        onMoveClick?.(nodes[index]);
                    }}
                >
                    <XAxis hide dataKey="index" />
                    <YAxis hide domain={[-longestTime, longestTime]} />

                    <ReferenceLine y={0} stroke="#50575f" strokeWidth={1} />

                    {selectedIndex >= 0 && <ReferenceLine
                        x={selectedIndex}
                        stroke="#97a0ab"
                        strokeWidth={2}
                    />}

                    <Bar
                        dataKey="y"
                        isAnimationActive={false}
                        shape={(props: unknown) => (
                            <BarShape {...props as BarShapeProps} />
                        )}
                    />

                    <Tooltip
                        cursor={{ fill: "rgba(255, 255, 255, 0.08)" }}
                        content={({ payload }) => {
                            const point = payload?.at(0)?.payload as MoveTimePoint | undefined;
                            if (!point?.label) return null;

                            return <div className={styles.tooltip}>
                                <span className={styles.tooltipMove}>
                                    {point.label}
                                </span>

                                {point.moveTime != undefined && <span>
                                    {t("moveTimesGraph.spent", {
                                        time: formatMoveTime(point.moveTime)
                                    })}
                                </span>}

                                {point.clock != undefined && <span>
                                    {t("moveTimesGraph.left", {
                                        time: formatClockTime(point.clock)
                                    })}
                                </span>}
                            </div>;
                        }}
                    />
                </BarChart>
            </ResponsiveContainer>
        </div>}
    </div>;
}

export default MoveTimesGraph;
