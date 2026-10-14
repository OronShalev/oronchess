import { Request, RequestHandler, Response } from "express";
import { readFileSync } from "fs";
import { resolve } from "path";

import { publicPath } from "@server/lib/paths";

type PlaceholderGenerator = (req: Request, res: Response) => (
    Promise<Record<string, string>>
);

function appRouter(
    filepath: string,
    getPlaceholders?: PlaceholderGenerator
): RequestHandler {
    if (!getPlaceholders) {
        return async (req, res) => res.sendFile(
            resolve(publicPath, "apps", filepath)
        );
    }

    return async (req, res) => {
        const placeholders = Object.entries(
            await getPlaceholders(req, res)
        );

        let htmlContent = readFileSync(
            resolve(publicPath, "apps", filepath), "utf-8"
        );

        for (const [ key, value ] of placeholders) {
            htmlContent = htmlContent.replace(
                new RegExp(`\\\${${key}}`, "gi"), value
            );
        }

        res.setHeader("Content-Type", "text/html");

        res.send(htmlContent);
    };
}

export default appRouter;