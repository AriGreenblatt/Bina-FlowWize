# FlowWise — how the build works

`FlowWise.html` is the app only; its data comes from one of two files (switch with
`node standalone/use-data.mjs real | demo`):

| Data file | Data | Build | Share? |
|---|---|---|---|
| `data/flowwise-real.js` | your real bank and card statements | `node standalone/build.mjs` | **No** — personal, git-ignored |
| `demo/flowwise-demo.js` | invented household (`demo-data.mjs`) | `node standalone/build-demo.mjs` | Yes — safe to submit |

Each data file has its own browser storage, so they never mix.

## Real build — sources

- **Bank:** `transactions/bank 09-24 09-26.xlsx`. Rows whose topic is "ראה פירוט CC", and card-company debits
  that match a statement total, become **card payments** (kept out of income and spending).
- **Credit cards:** every statement under `transactions/<card>/` and `transactions/AllCC/` (Isracard,
  Cal and Max formats — see `card-sources.mjs`). One statement per card per billing month, chosen by the
  billing date *inside* the file; exact copies are skipped; a per-card download wins over the all-cards Export.
- **Private settings:** `data/private-config.json` (git-ignored) — which cards to load and their billing
  days, personal merchant rules, one-off items kept out of the cash flow. The code holds no card numbers.
- **Categories and topics:** `data/taxonomy.json`.

## What the build does

- Repayments, installment transfers, revolving-balance lines and re-billed bounced charges are loaded as
  transfers (not spending); only real purchases, fees and interest count.
- Months the bank paid but no statement exists get one line with the bank amount, tagged
  "הנתונים אינם זמינים"; it is replaced automatically when the statement is added.
- Savings withdrawals, loans taken and loan principal repaid are **financing** (מימון), a separate series.
- Writes `card-reconciliation.csv` (statement total vs. bank payment per card and month) and
  `bank-classification-review.csv` (bank rows whose labels were filled in or changed).
