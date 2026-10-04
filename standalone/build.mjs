// Builds the real data file ../data/flowwise-real.js from the statements in ../transactions and the
// categories/topics in ../data/taxonomy.json, and rebuilds ../FlowWise.html. Run:  node standalone/build.mjs
//
// Fresh start (Sep 2026): sources are added one step at a time.
//   Step 1 — bank account.   Step 2 — credit cards, one card at a time (see CARDS).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { BANK_FILE, CARD_TOPIC, cardCompany, readBankFile } from "./bank-import.mjs";
import { readAllStatements } from "./card-sources.mjs";
import { writeApp, writeData } from "./app-html.mjs";
import { buildKnown, classifyCard, normMerchant, setUserRules } from "./cc-import.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// Deterministic ids, so rebuilding never changes the id of an existing row.
const stableId = (kind, key) => {
  const h = crypto.createHash("sha1").update(`${kind}:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

// ---- Private settings: card numbers, personal merchant rules, one-off items ----
// Kept in data/private-config.json (git-ignored) so the code itself holds no personal details.
const configFile = path.join(root, "data", "private-config.json");
const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, "utf8")) : {};
setUserRules(config.merchantRules);

// ---- Categories and topics (kept from before the fresh start) ----
const taxonomy = JSON.parse(fs.readFileSync(path.join(root, "data", "taxonomy.json"), "utf8"));
const categories = taxonomy.categories.map(({ id, name, primary_topic_id }) => ({ id, name, primary_topic_id }));
const topics = taxonomy.topics.map(({ id, name }) => ({ id, name }));
const category_topics = taxonomy.category_topics.map(({ category_id, topic_id }) => ({ category_id, topic_id }));
const transactions = [];
const imports = [];

const topicByName = new Map(topics.map((t) => [t.name, t]));
const catByName = new Map(categories.map((c) => [c.name, c]));
const newNames = { categories: [], topics: [] };
const topicId = (name) => {
  if (!topicByName.has(name)) {
    const t = { id: stableId("topic", name), name };
    topics.push(t);
    topicByName.set(name, t);
    newNames.topics.push(name);
  }
  return topicByName.get(name).id;
};
const link = (categoryId, tid) => {
  if (!category_topics.some((l) => l.category_id === categoryId && l.topic_id === tid)) category_topics.push({ category_id: categoryId, topic_id: tid });
};

// ---- Step 1: bank account ----
const bank = readBankFile(BANK_FILE, { isracardVisaCard: config.isracardVisaCard });
const topicsPerCategory = new Map();
for (const r of bank.rows) {
  const m = topicsPerCategory.get(r.category) ?? new Map();
  m.set(r.topic, (m.get(r.topic) ?? 0) + 1);
  topicsPerCategory.set(r.category, m);
}
for (const [name, counts] of topicsPerCategory) {
  const primary = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  let c = catByName.get(name);
  if (!c) {
    c = { id: stableId("category", name), name, primary_topic_id: topicId(primary) };
    categories.push(c);
    catByName.set(name, c);
    newNames.categories.push(name);
  } else if (!c.primary_topic_id) c.primary_topic_id = topicId(primary);
  for (const t of counts.keys()) link(c.id, topicId(t));
}

const bankFileName = path.basename(BANK_FILE);
const bankImportId = stableId("import", `bank:${bankFileName}`);
const occurrences = new Map();
for (const r of bank.rows) {
  // Identical rows (same day, description and amount) are real separate transfers, so number the repeats.
  const base = [r.date, r.description, r.amount.toFixed(2), r.kind, "בנק"].join("|");
  const n = (occurrences.get(base) ?? 0) + 1;
  occurrences.set(base, n);
  const dedup_key = n === 1 ? base : `${base}|${n}`;
  transactions.push({
    id: stableId("txn", dedup_key),
    import_id: bankImportId,
    txn_date: r.date,
    description: r.description,
    amount: r.amount,
    // Card bills paid from the bank are their own kind, left out of income/expense totals.
    kind: r.cardPayment ? "cc_payment" : r.kind,
    ...(r.cardPayment ? { cc_company: r.cardCompany, cc_card: r.cardNumber, cc_amount: r.kind === "income" ? -r.amount : r.amount } : {}),
    account_label: "בנק",
    category_id: catByName.get(r.category).id,
    topic_id: topicId(r.topic),
    source_category: r.category,
    source_topic: r.topic,
    source_file: bankFileName,
    source_sheet: bank.sheet,
    dedup_key,
  });
}
imports.push({
  id: bankImportId,
  file_name: bankFileName,
  sheet_names: [bank.sheet],
  rows_read: bank.rows.length,
  rows_added: bank.rows.length,
  rows_duplicate: 0,
  created_at: fs.statSync(BANK_FILE).mtime.toISOString(),
});

// ---- Step 1b: transfers to the children before the bank file starts ----
// The bank's transfer list ("העברות מהחשבון מ 2023", saved as CSV next to the .xls) names each
// recipient in full; config.transferNames maps a full name to the category used in the app
// (e.g. the child's nickname) — or { category, topic } when the topic isn't "ילדים". Transfers dated
// before the bank file's first row are added; later ones correct the matching bank row (see below).
const TRANSFERS_FILE = path.join(root, "transactions", "temp", "העברות מהחשבון מ 2023.csv");
const transferImportId = stableId("import", "transfers:2023");
const transferReport = { added: 0, sum: 0, skippedInBank: 0, otherNames: new Map(), corrected: [], notInBank: [] };
if (fs.existsSync(TRANSFERS_FILE) && config.transferNames) {
  const bankStart = transactions.filter((t) => t.import_id === bankImportId).map((t) => t.txn_date).sort()[0];
  const parseCsv = (text) => text.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean).map((line) => {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur);
    return out;
  });
  const rows = parseCsv(fs.readFileSync(TRANSFERS_FILE, "utf8"));
  const head = rows.findIndex((r) => r.includes("תאריך") && r.includes("שם מוטב"));
  const col = Object.fromEntries(rows[head].map((h, i) => [h.trim(), i]));
  const kids = topicId("ילדים");
  const list = [];
  for (const r of rows.slice(head + 1)) {
    const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((r[col["תאריך"]] ?? "").trim());
    if (!d) continue;
    const date = `${d[3]}-${d[2]}-${d[1]}`;
    const name = r[col["שם מוטב"]].trim();
    const amount = Number(r[col["סכום"]]);
    const target = config.transferNames[name];
    const catName = typeof target === "string" ? target : target?.category;
    if (!catName) { if (date < bankStart) transferReport.otherNames.set(name, (transferReport.otherNames.get(name) ?? 0) + 1); continue; }
    const tid = typeof target === "object" && target.topic ? topicId(target.topic) : kids;
    let c = catByName.get(catName);
    if (!c) {
      // A new category named in the config, with the given topic as its main one.
      c = { id: stableId("category", catName), name: catName, primary_topic_id: tid };
      categories.push(c);
      catByName.set(catName, c);
      newNames.categories.push(catName);
    }
    link(c.id, tid);
    list.push({ date, name, amount, c, tid, catName, what: r[col["מהות העברה"]].replace(/\s*\(הערת לקוח\)\s*/, "").trim(), ref: r[col["אסמכתה"]].trim() });
  }

  // From the bank file's first day the bank rows are the record. Each transfer is matched to a bank
  // row with the same amount within 3 days — first where the row already has the right category, then
  // the rest (closest date first). A matched row with another category is corrected to the recipient's;
  // a transfer with no bank row is added.
  const dayDiff = (a, b) => Math.abs(new Date(a) - new Date(b)) / 864e5;
  const bankRows = transactions.filter((t) => t.import_id === bankImportId && t.kind === "expense");
  const used = new Set(), matched = new Map();
  const inPeriod = list.filter((x) => x.date >= bankStart);
  for (const pass of [1, 2]) {
    for (const x of inPeriod) {
      if (matched.has(x)) continue;
      const cand = bankRows
        .filter((t) => !used.has(t) && Math.abs(t.amount - x.amount) < 0.005 && dayDiff(t.txn_date, x.date) <= 3 && (pass === 2 || t.category_id === x.c.id))
        .sort((a, b) => dayDiff(a.txn_date, x.date) - dayDiff(b.txn_date, x.date));
      if (cand[0]) { used.add(cand[0]); matched.set(x, cand[0]); }
    }
  }
  const topicName = (id) => topics.find((t) => t.id === id).name;
  for (const x of list) {
    const t = matched.get(x);
    if (t) {
      transferReport.skippedInBank++;
      if (t.category_id !== x.c.id || t.topic_id !== x.tid) {
        transferReport.corrected.push({ date: t.txn_date, amount: t.amount, name: x.name, from: t.source_category, to: x.catName, dedup_key: t.dedup_key });
        Object.assign(t, { category_id: x.c.id, topic_id: x.tid, source_category: x.catName, source_topic: topicName(x.tid) });
      }
      continue;
    }
    const dedup_key = ["transfer", x.date, x.name, x.amount.toFixed(2), x.ref].join("|");
    transactions.push({
      id: stableId("txn", dedup_key), import_id: transferImportId, txn_date: x.date,
      description: `העברה ל${x.name}${x.what ? ` — ${x.what}` : ""}`, amount: x.amount, kind: "expense", account_label: "בנק",
      category_id: x.c.id, topic_id: x.tid, source_category: x.catName, source_topic: topicName(x.tid),
      source_file: path.basename(TRANSFERS_FILE), source_sheet: "העברות", dedup_key,
    });
    transferReport.added++; transferReport.sum += x.amount;
    if (x.date >= bankStart) transferReport.notInBank.push(`${x.date} ${x.amount} ${x.name}`);
  }
  imports.push({ id: transferImportId, file_name: path.basename(TRANSFERS_FILE), sheet_names: ["העברות לפני קובץ הבנק"], rows_read: rows.length - head - 1, rows_added: transferReport.added, rows_duplicate: transferReport.skippedInBank, created_at: fs.statSync(TRANSFERS_FILE).mtime.toISOString() });
}

// Rows whose category/topic were filled in by the import, for the user to check.
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const reviewPath = path.join(root, "bank-classification-review.csv");
fs.writeFileSync(
  reviewPath,
  "﻿" + [
    ["שורה באקסל", "תאריך", "תיאור", "סכום", "קטגוריה", "נושא", "איך נקבע"],
    ...bank.review.map((r) => [r.r, r.date, r.description, r.kind === "income" ? r.amount : -r.amount, r.category, r.topic, r.how]),
  ].map((row) => row.map(csvCell).join(",")).join("\n"),
);

// One-off items kept out of the regular cash flow (kind "separate", shown as "מחוץ לתזרים"),
// listed in the private config as { date, description, amount }.
const SEPARATE = (config.separate ?? []).map((x) => [x.date, new RegExp(x.description), x.amount]);
for (const t of transactions) {
  if (SEPARATE.some(([d, re, amt]) => t.txn_date === d && re.test(t.description) && Math.abs(t.amount - amt) < 0.005)) t.kind = "separate";
}

// Financing — savings withdrawn, loans taken and loan principal repaid — is kept apart from income
// and spending (kind "financing", fin_amount + in / − out). Loan interest stays an expense.
const FINANCING = new Set(["הפקדת חסכון", "משיכת חסכון", "משיכה מחסכון", "לקיחת הלוואה", "פרעון הלוואה", "מזרחי הלוואה", "החזר הלוואה"]);
for (const t of transactions) {
  if ((t.kind === "income" || t.kind === "expense") && FINANCING.has(t.source_category)) {
    t.fin_amount = t.kind === "income" ? t.amount : -t.amount;
    t.kind = "financing";
  }
}

// ---- Step 2: credit cards, one card at a time ----
// CARDS lists the cards loaded so far. For each: the company, and the day of the month its bill is
// debited, used to tell which of the company's bank debits without a card number belong to it.
// The cards to load, from the private config: { "1234": { company, billingDays?: [[from, to], …] } }.
// billingDays: debits of that company with no card number on those days of the month are this card's.
const CARDS = config.cards ?? {};
const MISSING_CATEGORY = "פירוט אשראי חסר";
const { statements: allStatements } = readAllStatements(path.join(root, "transactions"), { maxCard: config.maxCard });

// Merchant → category/topic, learned from card transactions classified in the original app.
const lovableFile = path.join(root, "data", "transactions.json");
const catNameById = new Map(categories.map((c) => [c.id, c.name]));
const topicNameById = new Map(topics.map((t) => [t.id, t.name]));
const known = buildKnown(
  (fs.existsSync(lovableFile) ? JSON.parse(fs.readFileSync(lovableFile, "utf8")) : [])
    .filter((t) => t.account_label !== "בנק")
    .map((t) => ({ description: t.description, category: catNameById.get(t.category_id) ?? t.source_category, topic: topicNameById.get(t.topic_id) ?? t.source_topic })),
);
const categoryFor = (name, topic) => {
  const tid = topicId(topic);
  let c = catByName.get(name);
  if (!c) {
    c = { id: stableId("category", name), name, primary_topic_id: tid };
    categories.push(c);
    catByName.set(name, c);
    newNames.categories.push(name);
  }
  link(c.id, tid);
  return c.id;
};

const r2 = (x) => Math.round(x * 100) / 100;
const month = (d) => d.slice(0, 7);

// Card bills the bank file labels as something else (fees, "ריבית", "פרעון הלוואה"): a card company's
// debit is a card payment when it names one of our cards, when it is Max's, or when its amount equals
// a statement total of that company billed within 4 days. Counting it as an expense too would count
// the card's purchases twice.
const relabelled = [];
const days = (a, b) => Math.abs(new Date(a) - new Date(b)) / 86400000;
const cardFee = categoryFor("פרעון כרטיס אשראי", CARD_TOPIC);
for (const t of transactions) {
  if (t.account_label !== "בנק" || t.kind === "cc_payment") continue;
  const company = cardCompany(t.description);
  if (!company) continue;
  const number = /\b(\d{4})\b/.exec(t.description)?.[1];
  const signed = t.kind === "income" ? -t.amount : t.amount;
  let card = null;
  if (number && CARDS[number]?.company === company) card = number;
  else if (company === "מקס" && config.maxCard) card = config.maxCard;
  else card = allStatements.find((s) => s.company === company && s.total !== null && s.billing && Math.abs(s.total - signed) < 0.005 && days(s.billing, t.txn_date) <= 4)?.card ?? null;
  if (!card) continue;
  relabelled.push({ date: t.txn_date, description: t.description, amount: signed, was: `${t.source_category} / ${t.source_topic}`, card });
  Object.assign(t, { kind: "cc_payment", cc_company: company, cc_card: card, cc_amount: signed, category_id: cardFee, topic_id: topicId(CARD_TOPIC), source_category: "פרעון כרטיס אשראי", source_topic: CARD_TOPIC });
}
// Card payments with no card number that equal one immediate / off-cycle charge on a statement
// (e.g. a cash withdrawal charged at once) belong to that card.
for (const t of transactions) {
  if (t.kind !== "cc_payment" || t.cc_card) continue;
  const hit = allStatements.find((s) => s.company === t.cc_company && s.rows.some((r) =>
    /מחוץ למועד|מיידי/.test(r.section ?? "") && Math.abs((r.charge ?? 0) - t.cc_amount) < 0.005 && days(r.date, t.txn_date) <= 4));
  if (hit) { t.cc_card = hit.card; t.cc_card_inferred = true; continue; }
  // …or equal the sum of a statement's off-cycle charges (an early repayment of several items at once).
  const sum = allStatements.find((s) => s.company === t.cc_company && s.billing && days(s.billing, t.txn_date) <= 10 &&
    Math.abs(s.rows.filter((r) => /מחוץ למועד/.test(r.section ?? "") && r.charge).reduce((a, r) => a + r.charge, 0) - t.cc_amount) < 0.005);
  if (sum) { t.cc_card = sum.card; t.cc_card_inferred = true; }
}
const cardImportIds = [];
const reconciliation = [];
const cardReport = [];
for (const [card, cfg] of Object.entries(CARDS)) {
  // One statement per billing month, by the date inside the file. Exact copies are dropped; the
  // per-card download wins over the all-cards Export; otherwise the fuller file wins.
  const byMonth = new Map();
  for (const s of allStatements.filter((s) => s.card === card && s.billing && s.rows.length)) {
    const sig = JSON.stringify(s.rows.map((r) => [r.date, r.merchant, r.charge]).sort());
    const list = byMonth.get(month(s.billing)) ?? [];
    if (!list.some((o) => o.sig === sig)) list.push({ ...s, sig });
    byMonth.set(month(s.billing), list);
  }
  const chosen = new Map();
  const conflicts = [];
  for (const [m, list] of byMonth) {
    list.sort((a, b) => (a.format === "isracard-export") - (b.format === "isracard-export") || b.rows.length - a.rows.length);
    chosen.set(m, list[0]);
    if (list.length > 1) conflicts.push(`${m}: ${list.map((s) => path.basename(s.file)).join(" / ")}`);
  }

  // Bank debits for this card: its own number, or the company's unnumbered debit on its billing day.
  const payments = transactions.filter((t) => t.kind === "cc_payment" && t.cc_company === cfg.company &&
    (t.cc_card === card || (!t.cc_card && (cfg.billingDays ?? []).some(([a, z]) => +t.txn_date.slice(8) >= a && +t.txn_date.slice(8) <= z))));
  for (const t of payments) if (!t.cc_card) { t.cc_card = card; t.cc_card_inferred = true; }

  let added = 0, purchases = 0, placeholders = 0;
  for (const [m, s] of [...chosen].sort()) {
    const importId = stableId("import", `card:${card}:${m}`);
    const occurrences = new Map();
    let n = 0;
    for (const r of s.rows) {
      if (r.charge === null || r.charge === 0 || r.type === "credit-payment" || r.type === "pending") continue;
      const inst = /תשלום (\d+)\s*(?:מ-|מתוך)\s*(\d+)/.exec(r.details ?? "");
      // Not spending: repayments of the card's debt and balances moved around. The purchases
      // themselves are listed on their own lines.
      //   "פרעון X" (not "פרעון מוקדם", which is a fee) — early repayment of purchase X or of the credit line
      //   "החזר מיידי" — paid off right away;  "העברות לקרדיט" — a purchase moved into installments
      //   "העברת חיובים לכרטיס תחליפי" — balance moved to/from a replacement card
      //   "יתרת אשראי מתגלגל" — Cal's revolving balance carried from month to month
      //   "חיוב ממועד קודם", "החזר-אין הרשאה" — a charge billed again after the bank debit bounced
      const transfer = r.type === "transfer" || /החזר מיידי/.test(r.details ?? "") ||
        /^(פרעון (?!מוקדם)|העברות|העברת חיובים לכרטיס|יתרת אשראי מתגלגל|חיוב ממועד קודם|החזר-אין הרשאה)/.test(r.merchant);
      // The revolving balance comes back with interest: record that part as an expense.
      if (/^יתרת אשראי מתגלגל/.test(r.merchant) && typeof r.amount === "number" && r.amount > 0 && r.charge > r.amount + 0.005) {
        const interest = r2(r.charge - r.amount);
        const ikey = ["card", card, m, s.billing, "interest", interest.toFixed(2)].join("|");
        const ic = classifyCard("ריבית אשראי מתגלגל", known);
        transactions.push({
          id: stableId("txn", ikey), import_id: importId, txn_date: s.billing, description: "ריבית אשראי מתגלגל",
          amount: interest, kind: "expense", account_label: card,
          category_id: ic.category ? categoryFor(ic.category, ic.topic) : null, topic_id: ic.topic ? topicId(ic.topic) : null,
          source_category: ic.category, source_topic: ic.topic, source_file: path.basename(s.file),
          source_sheet: `${s.company} ${card} · חיוב ${s.billing}`, dedup_key: ikey,
        });
        n++;
        purchases += interest;
      }
      const date = inst ? s.billing : r.date;
      const description = inst ? `${r.merchant} (תשלום ${inst[1]} מתוך ${inst[2]})` : r.merchant;
      const base = ["card", card, m, date, normMerchant(r.merchant), r.charge.toFixed(2), inst?.[1] ?? ""].join("|");
      const k = (occurrences.get(base) ?? 0) + 1;
      occurrences.set(base, k);
      const dedup_key = k === 1 ? base : `${base}|${k}`;
      const c = transfer ? { category: null, topic: null } : classifyCard(r.merchant, known);
      transactions.push({
        id: stableId("txn", dedup_key),
        import_id: importId,
        txn_date: date,
        description,
        amount: Math.abs(r.charge),
        kind: transfer ? "transfer" : r.charge < 0 ? "income" : "expense",
        account_label: card,
        category_id: c.category ? categoryFor(c.category, c.topic) : null,
        topic_id: c.topic ? topicId(c.topic) : null,
        source_category: c.category,
        source_topic: c.topic,
        source_file: path.basename(s.file),
        source_sheet: `${s.company} ${card} · חיוב ${s.billing}`,
        dedup_key,
      });
      n++;
      if (!transfer) purchases += r.charge;
    }
    imports.push({ id: importId, file_name: path.basename(s.file), sheet_names: [`${card} · ${s.billing}`], rows_read: s.rows.length, rows_added: n, rows_duplicate: 0, created_at: fs.statSync(s.file).mtime.toISOString() });
    cardImportIds.push(importId);
    added += n;
  }

  // A debit that pays one immediate / off-cycle charge belongs to the statement listing that charge,
  // whatever month it falls in (e.g. Max's foreign charges are debited before the statement date).
  const payMonth = new Map();
  for (const p of payments) {
    const own = [...chosen].find(([, st]) => st.rows.some((r) => (/מיידי|מחוץ למועד/.test(`${r.section} ${r.details}`)) &&
      Math.abs((r.charge ?? 0) - p.cc_amount) < 0.005 && days(r.due ?? r.date, p.txn_date) <= 4));
    payMonth.set(p, own ? own[0] : month(p.txn_date));
  }

  // Months the bank paid but no statement is available: one row with the billed amount, so the
  // totals stay whole until the details arrive. They disappear once the statement is added.
  const placeholderImport = stableId("import", `card:${card}:missing`);
  let placeholderCount = 0;
  for (const p of payments) {
    const m = payMonth.get(p);
    const s = chosen.get(m);
    if (!s) {
      const dedup_key = ["missing", card, p.txn_date, p.cc_amount.toFixed(2)].join("|");
      transactions.push({
        id: stableId("txn", dedup_key),
        import_id: placeholderImport,
        txn_date: p.txn_date,
        description: `חיוב כרטיס ${card} — פירוט חסר (${m.slice(5)}/${m.slice(0, 4)})`,
        amount: Math.abs(p.cc_amount),
        kind: p.cc_amount < 0 ? "income" : "expense",
        account_label: card,
        category_id: categoryFor(MISSING_CATEGORY, "לא ידוע"),
        topic_id: topicId("לא ידוע"),
        source_category: MISSING_CATEGORY,
        source_topic: "לא ידוע",
        source_file: "תשלום בבנק",
        source_sheet: `${cfg.company} ${card} · חסר פירוט`,
        missing_detail: true,
        dedup_key,
      });
      placeholderCount++;
      placeholders += p.cc_amount;
    }
  }
  if (placeholderCount) {
    imports.push({ id: placeholderImport, file_name: `${card} — חודשים ללא פירוט`, sheet_names: [], rows_read: placeholderCount, rows_added: placeholderCount, rows_duplicate: 0, created_at: new Date().toISOString() });
    cardImportIds.push(placeholderImport);
  }

  // Reconciliation: what each statement says is charged vs what the bank paid that month.
  const months = [...new Set([...chosen.keys(), ...payments.map((p) => payMonth.get(p))])].sort();
  for (const m of months) {
    const s = chosen.get(m);
    const paid = r2(payments.filter((p) => payMonth.get(p) === m).reduce((a, p) => a + p.cc_amount, 0));
    // Isracard and Max debit immediate / off-cycle charges on their own dates, outside the statement
    // total, so they are added to what the bank is expected to pay for that statement.
    const extra = s && s.format !== "cal" ? s.rows.filter((r) => /מיידי|מחוץ למועד/.test(`${r.section} ${r.details}`) && r.charge).reduce((a, r) => a + r.charge, 0) : 0;
    const billed = s && s.total !== null ? r2(s.total + extra) : null;
    reconciliation.push({
      card, month: m, billing: s?.billing ?? "", billed, paid,
      status: !s ? "אין פירוט — נרשם הסכום מהבנק" : billed !== null && billed <= 0 && paid === 0 ? "יתרת זכות — אין חיוב" : billed === null ? "אין סכום חיוב בדוח" : Math.abs((billed ?? 0) - paid) < 0.01 ? "תואם" : `הפרש ${r2(paid - billed)}`,
      file: s ? path.basename(s.file) : "",
    });
  }
  cardReport.push({ card, statements: chosen.size, added, purchases: r2(purchases), placeholders: placeholderCount, placeholderSum: r2(placeholders), conflicts });
}
const reconPath = path.join(root, "card-reconciliation.csv");
fs.writeFileSync(
  reconPath,
  "﻿" + [
    ["כרטיס", "חודש", "תאריך חיוב", "סכום לחיוב בדוח", "שולם בבנק", "מצב", "קובץ"],
    ...reconciliation.map((r) => [r.card, r.month, r.billing, r.billed, r.paid, r.status, r.file]),
  ].map((row) => row.map(csvCell).join(",")).join("\n"),
);

// ---- Data already saved in a browser ----
// Each migration name is applied once to saved browser data; it adds the rows of its imports that
// aren't there yet (matched by dedup_key), keeping the user's edits. Add a new name for each new step.
const MIGRATIONS = { "fresh-bank-2026-09-23b": [bankImportId], "cards-all-2026-09-23": cardImportIds, "kids-transfers-2026-09-24": [transferImportId], "rent-transfers-2026-09-24": [transferImportId], "amichai-transfers-2026-09-24": [transferImportId], "other-transfers-2026-09-24": [transferImportId], "transfers-fix-2026-09-24": [transferImportId] };
// Bank rows whose category/topic the build corrected: applied once to saved browser data too.
const RECATEGORIZE = { "transfers-fix-2026-09-24": transferReport.corrected.map((x) => x.dedup_key) };

// ---- Write the real data file, and the app (keeping whichever data file it points to) ----
const dataFile = writeData("real", {
  label: "נתונים אמיתיים", storeKey: "flowwise.standalone.db.v4",
  transactions, categories, topics, category_topics, imports,
  migrations: Object.keys(MIGRATIONS),
  migrationImports: MIGRATIONS,
  migrationRecategorize: RECATEGORIZE,
});
const app = writeApp();
console.log(`Transfers (by recipient) before the bank file: ${transferReport.added} rows (${Math.round(transferReport.sum)} ₪); ${transferReport.skippedInBank} later ones already in the bank file` +
  (transferReport.notInBank.length ? `; added though in the bank period (no bank row): ${transferReport.notInBank.join(", ")}` : "") +
  (transferReport.corrected.length ? `\n  corrected ${transferReport.corrected.length} bank rows:\n${transferReport.corrected.map((x) => `    ${x.date} ${x.amount} ${x.name}: ${x.from} → ${x.to}`).join("\n")}` : "") +
  (transferReport.otherNames.size ? `; not loaded (no category for the name): ${[...transferReport.otherNames].map(([n, k]) => `${n} ×${k}`).join(", ")}` : ""));
const out = dataFile;

// ---- report ----
const bankTx = transactions.filter((t) => t.account_label === "בנק");
const sum = (kind) => Math.round(bankTx.filter((t) => t.kind === kind).reduce((s, t) => s + t.amount, 0));
const dates = bankTx.map((t) => t.txn_date).sort();
console.log(`Bank: ${bankFileName} → ${bankTx.length} rows, ${dates[0]} → ${dates.at(-1)} (income ${sum("income")}, expenses ${sum("expense")})`);
const ccRows = transactions.filter((t) => t.kind === "cc_payment");
const ccBy = new Map();
for (const t of ccRows) { const k = t.cc_company ?? "?"; ccBy.set(k, (ccBy.get(k) ?? 0) + t.cc_amount); }
console.log(`Card bills paid from the bank: ${ccRows.length} rows, ${Math.round(ccRows.reduce((s, t) => s + t.cc_amount, 0))} ₪ — ${[...ccBy].map(([k, v]) => `${k} ${Math.round(v)}`).join(", ")} (not counted as expenses)`);
const how = new Map();
for (const r of bank.rows) { const k = r.how.replace(/\(.*\)/, "(…)"); how.set(k, (how.get(k) ?? 0) + 1); }
console.log("How labels were set:", JSON.stringify(Object.fromEntries(how)));
console.log(`Review list: ${bank.review.length} rows → ${reviewPath}`);
if (newNames.categories.length) console.log("New categories:", newNames.categories.join(", "));
if (newNames.topics.length) console.log("New topics:", newNames.topics.join(", "));
console.log(`Bank debits relabelled as card payments: ${relabelled.length}`);
for (const r of relabelled) console.log(`  ${r.date} ${r.description} ${r.amount} (was ${r.was}) → ${r.card}`);
const unassigned = transactions.filter((t) => t.kind === "cc_payment" && !t.cc_card);
console.log(`Card payments not tied to a card: ${unassigned.length}`, unassigned.map((t) => `${t.txn_date} ${t.description} ${t.cc_amount}`).join(" | "));
// Over the whole period: what was spent on each card vs what the bank paid it. For revolving-credit
// cards only this total is meaningful; the difference is the debt still open (or a data gap).
const cardTotals = Object.keys(CARDS).map((card) => {
  const spent = r2(transactions.filter((t) => t.account_label === card && (t.kind === "expense" || t.kind === "income")).reduce((a, t) => a + (t.kind === "expense" ? t.amount : -t.amount), 0));
  const paid = r2(transactions.filter((t) => t.kind === "cc_payment" && t.cc_card === card).reduce((a, t) => a + t.cc_amount, 0));
  return { card, spent, paid, open: r2(spent - paid) };
});
console.log("Per card, whole period (spent / paid by bank / difference):", cardTotals.map((c) => `${c.card} ${c.spent}/${c.paid}/${c.open}`).join(" · "));
for (const c of cardReport) {
  console.log(`Card ${c.card}: ${c.statements} statements → ${c.added} rows (purchases ${c.purchases} ₪); ${c.placeholders} months without details recorded from the bank (${c.placeholderSum} ₪)`);
  if (c.conflicts.length) console.log("  Different files for the same month (fuller one used):", c.conflicts.join(" | "));
}
for (const r of reconciliation) console.log(`  ${r.card} ${r.month}: billed ${r.billed ?? "—"} · paid ${r.paid} · ${r.status}`);
console.log(`Card reconciliation → ${reconPath}`);
console.log(`Wrote ${out} — ${transactions.length} transactions, ${categories.length} categories, ${topics.length} topics`);
console.log(`FlowWise.html reads ${app.which} data (${app.file})${app.which !== "real" ? " — switch with: node standalone/use-data.mjs real" : ""}`);
