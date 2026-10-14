import { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import dotenv from "dotenv";

import { envPath } from "@server/lib/paths";

dotenv.config({ path: envPath });

// Comma-separated; subdomains of each hostname are also allowed
const whitelistedHostnames = (process.env.ALLOWED_HOSTNAMES || "")
    .split(",")
    .map(hostname => hostname.trim().toLowerCase())
    .filter(Boolean);

const hostnameWhitelist: RequestHandler = (req, res, next) => {
    if (whitelistedHostnames.length == 0) return next();

    const requestHostname = req.hostname.toLowerCase();

    const hostWhitelisted = whitelistedHostnames.some(hostname => (
        requestHostname == hostname
        || requestHostname.endsWith(`.${hostname}`)
    ));

    if (!hostWhitelisted) {
        return res.sendStatus(StatusCodes.UNAUTHORIZED);
    }

    next();
};

export default hostnameWhitelist;