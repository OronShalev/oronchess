import React from "react";

import { formatClockTime } from "@shared/lib/stateTree/clocks";

import PlayerClockProps from "./PlayerClockProps";
import * as styles from "./PlayerClock.module.css";

function PlayerClock({ seconds, running }: PlayerClockProps) {
    return <span
        className={`${styles.clock} ${running ? styles.running : ""}`}
    >
        {formatClockTime(seconds)}
    </span>;
}

export default PlayerClock;
