import { resolve } from "path";
import dotenv from "dotenv";
import DotenvPlugin from "dotenv-webpack";

dotenv.config({ path: "../.env" });

const nodeEnv = process.env.NODE_ENV || "production";

/**
 * @type {import("webpack").Configuration}
 */
export default {
    entry: {
        analysis: "./src/client/apps/features/analysis/index.tsx"
    },
    output: {
        filename: "[name].bundle.js",
        path: resolve("./dist/client"),
        clean: true
    },
    resolve: {
        extensions: [".js", ".jsx", ".ts", ".tsx", ".json"],
        alias: {
            "@client": resolve("./src/client"),
            "@shared": resolve("./src/shared"),
            "@analysis": resolve("./src/client/apps/features/analysis"),
            "@assets": resolve("./public")
        }
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/i,
                use: "babel-loader"
            },
            {
                test: /\.css$/i,
                use: [
                    "style-loader",
                    {
                        loader: "css-loader",
                        options: {
                            modules: true
                        }
                    }
                ]
            },
            {
                test: /\.(png|svg|gif|ttf|mp3)$/i,
                type: "asset"
            }
        ]
    },
    plugins: [
        new DotenvPlugin({
            systemvars: true,
            path: "../.env",
            silent: true
        })
    ],
    mode: nodeEnv
};