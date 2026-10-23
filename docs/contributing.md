# ☕ Contributing

If you'd like to contribute to OronChess, this guide will help you get started. Thank you for considering a contribution!

## 💡 Ideas

Some improvements that would make OronChess better:

- Performance metrics (accuracies etc.) for each stage of the game: opening, middlegame and endgame.
- Exploring a database of master games when analysing opening moves.
- The "Risky" classification, for moves with good results in the database that the engine finds dubious. Its icon and constants exist, but the classifier does not give it yet.
- Explanations of moves, in plain language.
- Automated classifier tests on a large set of evaluated games (`app/scripts/review-bench` is a start).

## 📋 Code Style

Use ESLint with `eslint.config.js` at the root of the project to match the code style, and look at the code around your change. Some conventions:

```tsx
// Sorting imports

// External libraries first (react at top if applicable)
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Chess } from "chess.js";

// Then imports from shared, and elsewhere in the app
import { PieceColour } from "@shared/constants/PieceColour";
import displayToast from "@client/lib/toast";

// Then props for component & CSS modules
import AwesomeThingProps from "./AwesomeThingProps";
import * as styles from "./AwesomeThing.module.css";

// Then asset imports if you have any
import iconLogo from "@assets/img/logo.svg";

// Component should be normal function, not arrow function
function AwesomeThing({ children }: AwesomeThingProps) {
    return <img src={iconLogo} />;
}

// Component should be default export
export default AwesomeThing;
```

Prefer functions and interfaces to classes unless a class is really needed.

## 🎋 Opening a Pull Request

Pull request and commit names follow [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/#summary):

```
<type of change>(<optional scope>): <present tense description>

feat(fe): add cool new feature
docs: add funny message
```

The scopes are `fe` (Frontend), `be` (Backend), `sh` (Shared), `android`, `windows` and `apps` (both apps). Omit the scope if several areas or root-level files change substantially.

If your changes deal with personal information, describe what data is collected and the security considerations you have taken into account.

Please be nice when discussing things in pull requests! 💙

## 🔐 Reporting security vulnerabilities

Please report vulnerabilities responsibly. Minor ones can be opened as an issue; for anything that could affect user data, use GitHub's private vulnerability reporting on the repository instead.
