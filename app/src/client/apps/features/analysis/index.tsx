import React, { lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import PageWrapper from "@client/components/layout/PageWrapper";

import * as styles from "./index.module.css";

const Analysis = lazy(() => import("./pages/Analysis"));

import "@client/i18n";
import "@client/index.css";

const root = ReactDOM.createRoot(
    document.querySelector(".root")!
);

function App() {
    return <BrowserRouter>
        <PageWrapper className={styles.wrapper}>
            <Routes>
                <Route path="/analysis" element={<Analysis/>} />
            </Routes>
        </PageWrapper>
    </BrowserRouter>;
}

root.render(<App/>);