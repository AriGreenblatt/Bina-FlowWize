// Builds the demo data file ../demo/flowwise-demo.js (invented data only — see demo-data.mjs) and
// ../demo/categories-topics.csv, and rebuilds ../FlowWise.html. Run:  node standalone/build-demo.mjs
// To make FlowWise.html show the demo:  node standalone/use-data.mjs demo
import fs from "node:fs";
import path from "node:path";
import { DEMO_CARDS, DEMO_TAXONOMY, buildDemo } from "./demo-data.mjs";
import { root, writeApp, writeData } from "./app-html.mjs";

const db = buildDemo();
const file = writeData("demo", { label: "נתוני דמו", storeKey: "flowwise.demo.db.v1", ...db, migrations: [], migrationImports: {} });
const app = writeApp();

const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
fs.writeFileSync(
  path.join(root, "demo", "categories-topics.csv"),
  "﻿" + [["קטגוריה", "נושא ראשי"], ...DEMO_TAXONOMY].map((r) => r.map(csvCell).join(",")).join("\n"),
);

const k = (kind) => db.transactions.filter((t) => t.kind === kind);
const sum = (list, f = (t) => t.amount) => Math.round(list.reduce((a, t) => a + f(t), 0));
console.log(`Wrote ${file} — ${db.transactions.length} invented transactions, ${db.categories.length} categories, ${db.topics.length} topics`);
console.log(`  income ${sum(k("income"))} · expenses ${sum(k("expense"))} · financing ${sum(k("financing"), (t) => t.fin_amount)} · card bills ${sum(k("cc_payment"))} · kept apart ${sum(k("separate"))}`);
console.log(`  cards: ${Object.entries(DEMO_CARDS).map(([n, c]) => `${n} (${c.company})`).join(", ")}; unclassified: ${db.transactions.filter((t) => t.kind === "expense" && !t.category_id).length}`);
console.log(`FlowWise.html reads ${app.which} data (${app.file})${app.which !== "demo" ? " — to show the demo: node standalone/use-data.mjs demo" : ""}`);
