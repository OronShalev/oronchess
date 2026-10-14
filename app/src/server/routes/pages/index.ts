import { Router } from "express";
import { StatusCodes } from "http-status-codes";
import { extname } from "path";

import appRouter from "@server/lib/appRouter";

const router = Router();

router.get("/analysis", appRouter("features/analysis.html"));

router.get("/*", async (req, res) => {
    // Missing files should not be answered with the analysis page
    if (extname(req.path)) {
        return res.sendStatus(StatusCodes.NOT_FOUND);
    }

    res.redirect("/analysis");
});

export default router;
