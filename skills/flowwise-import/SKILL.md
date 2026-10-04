---
name: flowwise-import
description: Add new bank or credit-card statements to the Flow-Wise household cash-flow app and rebuild FlowWise.html. Use when the user says they added, downloaded or want to import new statements, or asks to rebuild or refresh Flow-Wise.
---

# Flow-Wise statement import

Flow-Wise is an offline, single-file cash-flow app. A Node build script reads the user's bank export and monthly credit-card statements, classifies every row, and bakes them into `FlowWise.html`. This skill walks through adding new statements safely and reporting what changed.

## Project facts

- Project folder: `C:\FlowWize+`. The build needs Node 22+ and no npm packages.
- Build: `node standalone/build.mjs`, run from the project folder. It writes `FlowWise.html`, `bank-classification-review.csv` and `card-classification-review.csv`.
- Bank file: a single export, set in `BANK_FILE` in `standalone/bank-import.mjs` (currently `C:\תזרים\09_2024-09-2026.xlsx`).
- Card statements: `Export_M_YYYY.xlsx`, read from the folders in `CARD_DIRS` in `standalone/build.mjs` (`C:\תזרים\old` and `data\cards`).
- Import notes for the user: `standalone/NOTES.md`.
- All of these files hold personal financial data. Never commit them, upload them anywhere, or paste raw transaction rows into chat beyond what the report below needs.

## Steps

### 1. Find out what's new
Ask which statements were added, if the user hasn't said. Then list `C:\תזרים\old` and `data\cards` and compare them with the table in `NOTES.md`:
- **Card statements:** new `Export_M_YYYY.xlsx` files.
- **Old `.xls` statements:** the reader only handles `.xlsx`. Ask the user to open each one in Excel, choose *Save As → Excel Workbook (.xlsx)*, and save it into `data\cards`. Don't change the original.
- **New bank export:** the app reads only one bank file. If the user has a newer, longer export, update `BANK_FILE` to point at it. Confirm with the user first, because it replaces the old bank rows.

### 2. Make sure new rows reach the saved browser data
The app copies built-in rows into data already saved in the browser only once per migration name (`MIGRATIONS` and `migrationImports` in `build.mjs`). If you add card statements without a new migration name, users who already opened the app **won't see them**.

When there are new card statements, tell the user this and, with their OK, edit `standalone/build.mjs`:
1. Add a new name to the `MIGRATIONS` array, e.g. `"add-cards-YYYY-MM-DD"` (today's date).
2. Add the same name to `migrationImports`, mapped to `cardImportIds`.

This is safe: rows already in the browser are skipped by `dedup_key`. Do the same with a new `add-bank-…` name when the bank file changes.

### 3. Run the build
Run `node standalone/build.mjs` in the project folder. If you can't run commands on the user's computer, give them the exact command and ask them to paste the output back.

If the build fails, show the error and the file it names. Don't guess at fixes to the import code without the user's agreement.

### 4. Report the result
Read the build output and give the user a short report:
- Rows added per source (bank, each card) and the date range now covered.
- Duplicates and non-purchase lines skipped. A few are normal; a whole file of duplicates means it was already imported.
- Any **WARNING** about `.xls` files with no `.xlsx` copy.
- Classification: percentage classified per card, and the **top unidentified merchants** by amount. Point to `card-classification-review.csv` (filter "איך נקבע" = "לא זוהה").
- Anything unusual, such as a month with no rows or an unexpectedly large expense topic.

### 5. Update the notes
Update `standalone/NOTES.md`: the "Last build" date, the rows-and-period table, and the unidentified-merchant list. Keep the file's existing structure and language.

### 6. Tell the user how to see it
Open `FlowWise.html` in the browser they usually use. Their earlier edits are kept, and the new rows are added on open. Remind them that "שחזור הנתונים המקוריים" on the Import page wipes their edits, so they shouldn't use it to pick up new rows.

## Optional: improving classification
If the user wants fewer unidentified merchants, suggest rules for the biggest ones. Rules are the `RULES` list in `standalone/cc-import.mjs`: `[regex, category, topic]`, in priority order, using category and topic names that already exist. Show the proposed rules and get approval before editing, then rebuild and report the new classification percentage.
