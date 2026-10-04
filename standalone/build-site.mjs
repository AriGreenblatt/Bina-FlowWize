// Builds ../site/ — a public, demo-only copy of the app for GitHub Pages:
//   site/index.html              the app, reading the demo data
//   site/demo/flowwise-demo.js   the invented demo data (built by build-demo.mjs)
//   site/README.md, site/.nojekyll
// Nothing from the real data is copied. Run after build-demo.mjs:  node standalone/build-site.mjs
import fs from "node:fs";
import path from "node:path";
import { DATA_FILES, root, writeApp } from "./app-html.mjs";

const site = path.join(root, "site");
const demo = path.join(root, DATA_FILES.demo);
if (!fs.existsSync(demo)) throw new Error(`${DATA_FILES.demo} not found — run: node standalone/build-demo.mjs`);

fs.rmSync(site, { recursive: true, force: true });
fs.mkdirSync(path.join(site, "demo"), { recursive: true });
writeApp("demo", path.join(site, "index.html"));
fs.copyFileSync(demo, path.join(site, DATA_FILES.demo));
fs.copyFileSync(path.join(root, "demo", "categories-topics.csv"), path.join(site, "demo", "categories-topics.csv"));
fs.writeFileSync(path.join(site, ".nojekyll"), "");
fs.writeFileSync(path.join(site, "README.md"), `# תזרים+ — Flow-Wise (demo)

A household cash-flow app: bank and credit-card transactions by month, topic and category, with
card-payment reconciliation, financing (savings and loans) shown separately, and drill-down from every
chart to the transactions behind it.

**This site shows invented demo data only** — a fictional household with a salary, rent, three
fictional cards, a loan and savings withdrawals. No real financial data is included.

- Open the app: \`index.html\` (or the GitHub Pages link of this repository)
- Demo categories and topics: \`demo/categories-topics.csv\`

The app runs entirely in the browser; changes are saved in the browser's local storage only.
`);

// Safety check: the published app must read the demo data and nothing may point at the real data.
const published = ["index.html", DATA_FILES.demo].map((f) => fs.readFileSync(path.join(site, f), "utf8")).join("\n");
if (published.includes("flowwise-real") || !published.includes('"label":"נתוני דמו"')) throw new Error("site/ is not demo-only");

console.log(`Wrote ${site}: index.html (demo data), ${DATA_FILES.demo}, demo/categories-topics.csv, README.md, .nojekyll`);
