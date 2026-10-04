# תזרים+ — Flow-Wise

A household cash-flow app: bank and credit-card transactions by month, topic and category, with
card-payment reconciliation, financing (savings and loans) shown separately, and drill-down from every
chart to the transactions behind it.

**Live demo:** open `index.html` — or this repository's GitHub Pages link.
**All data here is invented** (a fictional household with three fictional cards). No real financial data
is included.

## What's here

| Path | What it is |
|---|---|
| `index.html` | the app, reading the demo data |
| `demo/flowwise-demo.js` | the invented demo data |
| `demo/categories-topics.csv` | the demo's categories and their main topics |
| `standalone/` | the source: `template.html` (the app), the build scripts and the statement readers |
| `skills/` | Claude skills used with the project: importing statements, classifying unmapped transactions |

## How it works

- `standalone/build.mjs` reads real bank and card statements (Isracard, Cal, Max Excel exports) into a
  private data file that is never published. `standalone/build-demo.mjs` builds the invented demo data.
- The app picks one data file at a time (`node standalone/use-data.mjs real | demo`), and each keeps its
  own browser storage.
- Card bills in the bank are matched to card statements, so nothing is counted twice; months with no
  statement show the bank amount, tagged "הנתונים אינם זמינים".
- Everything runs in the browser, from a single HTML file; changes are saved in local storage only.

Requires Node 22+ to build; no npm packages.
