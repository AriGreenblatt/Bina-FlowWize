---
name: flowwise-unmapped
description: Find Flow-Wise transactions with no category or topic, suggest a mapping for each, and apply the approved ones in the app and as import rules. Use when the user asks about unmapped, unclassified or "ללא נושא" transactions in Flow-Wise.
---

# Flow-Wise unmapped transactions

Flow-Wise is an offline cash-flow app (`C:\FlowWize+`). Some transactions have no category or topic and show as "ללא נושא". This skill finds them, suggests a category and topic for each merchant, and applies the approved choices in two places:
- **In the app**, by the user on the סוגי עסקאות screen, so the change shows up right away.
- **As import rules** in the build code, so the same merchants are classified automatically in future statements.

Both are needed. Rule changes don't reach data already saved in the user's browser, and changes made in the app aren't used by future builds.

Merchant names, amounts and dates are personal financial data. Keep working files under `data\` (git-ignored) and don't commit or upload them.

## 1. Get the current data

Use the app's own export, because it includes edits the user already made in the browser:
1. Ask the user to open `FlowWise.html` → **ייבוא** → **ייצוא נתונים (CSV)**. This downloads `transactions-YYYY-MM-DD.csv`, `categories-…csv` and `topics-…csv`.
2. Ask them to move those three files into `C:\FlowWize+\data\exports\`.

If they can't export right now, fall back on `card-classification-review.csv` (rows where "איך נקבע" = "לא זוהה") and `bank-classification-review.csv`. Say that these reflect the last build, not their later edits.

## 2. Find the unmapped transactions

In the transactions CSV, a row is unmapped when **קטגוריה** or **נושא** is empty. Also flag, separately, rows labelled "לא ידוע", which are guesses rather than real mappings.

Group rows the way the app's סוגי עסקאות screen does, so the names match what the user sees:
- Remove a trailing ` (תשלום N מתוך M)` and a leading `פרעון `, collapse spaces, and trim.

For each group, record the name, the number of transactions, the total amount, the accounts (card numbers or "בנק"), and the date range. Sort by total amount, largest first.

## 3. Suggest a category and topic

For each group, suggest a **category** and a **topic**, using only names that already exist in the categories and topics CSVs. See how similar merchants are already mapped and follow the user's own conventions (for example, parking → "חניון" / "רכב").

- Give a confidence level (high / medium / low) and a short reason ("pharmacy chain", "same as CYBERNET rows in 2025", "unknown business").
- If the right fit needs a new category or topic, propose it but mark it **new** and don't assume it.
- If you can't tell what a business is, say so and don't guess. You may look up the business name on the web **only with the user's OK**, and send only the name, never amounts, dates or card numbers.

## 4. Get approval

Write the list to `C:\FlowWize+\data\unmapped-checklist.md` as a table: name (exactly as the app shows it), count, total ₪, accounts, suggested category, suggested topic, confidence, reason, and an empty **✓** column. Show the top 15 in chat as well.

Ask the user to approve, change or skip each row. Accept short replies like "approve all high", "1–8 ok, 9 → ביגוד/ביגוד, skip 12". Don't apply anything until they've answered.

## 5. Apply in the app (the user does this)

Update the checklist so it shows only the approved rows, then give the user these steps:
1. Open `FlowWise.html` → **קטגוריות ונושאים** → **סוגי עסקאות**.
2. Tick **"רק חסרי קטגוריה או נושא"**.
3. For each approved row, use the filter box to find the name, then choose the category and topic.
4. Press **ישם שינויים** once at the end. It applies to every transaction with that name.

If a category or topic is new, they create it from the same picker ("+ קטגוריה חדשה…").

## 6. Add import rules (Claude does this)

Show the user the exact changes before editing, then:

**Card merchants:** in `standalone/cc-import.mjs`, add rules at the **top** of the `RULES` array in a block marked `// User-approved merchants`, one line per merchant:
```js
[/MEDBALANCE/i, "category", "topic"],
```
- Escape regex characters in the name (`. * + ? ( ) [ ] { } | \ / ^ $`).
- Match a distinctive part of the name so shortened statement names still match, but not so short that it catches other merchants.
- Use the exact category and topic names from the export.

**Bank-only names:** add a line to `fallback()` in `standalone/bank-import.mjs` before the final `return`, e.g. `if (/NAME/.test(x.description)) return ["category", "topic"];`. Also mention that labelling the row in the bank Excel file (columns I and J) is the permanent fix, since file labels win.

Then run `node standalone/build.mjs` from the project folder. If you can't run commands on the user's computer, give them the command and ask for the output. Check that the "unidentified merchants" count went down and that no rule caught the wrong merchants (compare the "how" counts and scan `card-classification-review.csv` for rows set "לפי סוג בית העסק" by the new rules).

## 7. Report

Tell the user:
- How many names and transactions were mapped, and the ₪ total now classified.
- What's still unmapped and why (skipped, unknown business).
- That the app changes are live as soon as they press ישם שינויים, and that future statements will pick up the new rules on the next build.
- Update the "Needs review" section of `standalone/NOTES.md` with the new unidentified count.
