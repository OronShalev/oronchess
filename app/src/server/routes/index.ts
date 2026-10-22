import { Router } from "express";

import pagesRouter from "./pages";

const router = Router();

router.use("/",
    pagesRouter
);

export default router;
