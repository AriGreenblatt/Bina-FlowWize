// Readers for every credit-card statement format in ../transactions. Each returns a list of
// statements: { file, format, company, card, billing, total, rows }, where
//   billing = the charge date the statement itself states (file names are not reliable),
//   total   = the amount the statement says is charged on that date (null if it doesn't say),
//   rows    = [{ date, merchant, amount, currency, charge, voucher, details, section, type }].
// `type` is "purchase" for real spending and refunds, "credit-payment" for the fixed monthly
// payment of a revolving-credit card (not spending — its purchases are listed separately), and
// "pending" for transactions the company has not processed yet.
import fs from "node:fs";
import path from "node:path";
import { readSheet, serialToIso } from "./xlsx.mjs";
import { readCardFile } from "./cc-import.mjs";

const clean = (s) => String(s ?? "").replace(/[‎‏‪-‮]/g, "").replace(/\s+/g, " ").trim();
const num = (s) => { const m = /-?[\d,]+(\.\d+)?/.exec(String(s ?? "").replace(/\s/g, "")); return m ? Number(m[0].replace(/,/g, "")) : null; };
const pad = (n) => String(n).padStart(2, "0");
const HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

/** "14.01.26", "13/03/2024", "26-01-2026" or an Excel serial → "2026-01-14". */
export function parseDate(v) {
  if (typeof v === "number" && v > 30000 && v < 60000) return serialToIso(v);
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(clean(v));
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${pad(m[2])}-${pad(m[1])}`;
}

/* ---------- Isracard, one card per file: "1234_MM_YYYY.xlsx" ---------- */
export function readIsracardCard(file) {
  const rows = readSheet(file, { columns: /^[A-H]$/ });
  let card = null, cardName = null, billing = null, total = null, section = null, cols = null;
  let stmtMonth = null, stmtYear = null;
  const out = [];
  for (const { cells: c } of rows) {
    const a = clean(c.A);
    const monthCell = /^(\S+) (\d{4})$/.exec(clean(c.C));
    if (a === "פירוט עסקאות" && monthCell) { stmtMonth = HE_MONTHS.indexOf(monthCell[1]) + 1; stmtYear = Number(monthCell[2]); continue; }
    const head = /^(.+?) - (\d{4})$/.exec(a);
    if (head && !card) { [cardName, card] = [head[1], head[2]]; total = num(c.H); continue; }
    const due = /לחיוב ב-(\d{1,2})\.(\d{1,2})/.exec(clean(c.H));
    if (due && !billing) {
      const m = Number(due[2]);
      const y = stmtYear + (stmtMonth === 12 && m === 1 ? 1 : 0);
      billing = `${y}-${pad(m)}-${pad(due[1])}`;
      continue;
    }
    if (/^עסקאות/.test(a) && Object.keys(c).length === 1 && a.length < 40) { section = a; cols = null; continue; }
    if (a === "תאריך רכישה") { cols = Object.fromEntries(Object.entries(c).map(([k, v]) => [clean(v), k])); continue; }
    if (/^סה/.test(clean(c.B)) && /לחיוב החודש/.test(clean(c.B))) { total ??= c.E; continue; }
    if (!cols || !section) continue;
    const cell = (n) => c[cols[n]];
    const merchant = clean(cell("שם בית עסק"));
    if (!merchant || /^סה/.test(merchant)) continue;
    const charge = typeof cell("סכום חיוב") === "number" ? cell("סכום חיוב") : null;
    const date = parseDate(cell("תאריך רכישה"));
    if (!date && charge === null) continue;
    out.push({
      date: date ?? billing, merchant, amount: cell("סכום עסקה"), currency: clean(cell("מטבע עסקה")), charge,
      voucher: clean(cell("מס' שובר")) || null, details: clean(cell("פירוט נוסף")), section,
      type: /^חיוב חודשי ק/.test(merchant) ? "credit-payment" : /טרם נקלטו/.test(section) ? "pending" : "purchase",
    });
  }
  return [{ file, format: "isracard-card", company: "ישראכרט", card, cardName, billing, total, rows: out }];
}

/* ---------- Cal: "5678-MM-YYYY.xlsx" (the name's month is not always the statement's) ---------- */
export function readCal(file) {
  const rows = readSheet(file, { columns: /^[A-G]$/ });
  let card = null, cardName = null, billing = null, total = null, immediate = null, cols = null;
  const out = [];
  for (const { cells: c } of rows) {
    const a = clean(c.A);
    const head = /לכרטיס (.+?) המסתיים ב-(\d{4})/.exec(a);
    if (head) { [cardName, card] = [head[1], head[2]]; continue; }
    const due = /^עסקאות לחיוב ב-(\d{2})\/(\d{2})\/(\d{4}): (.+)$/.exec(a);
    if (due) { billing = `${due[3]}-${due[2]}-${due[1]}`; total = num(due[4]); continue; }
    if (/^עסקאות בחיוב מיידי/.test(a)) { immediate = num(a.replace(/^עסקאות בחיוב מיידי/, "")); continue; }
    if (/^תאריך/.test(a)) { cols = Object.fromEntries(Object.entries(c).map(([k, v]) => [clean(v), k])); continue; }
    if (!cols) continue;
    const date = parseDate(c.A);
    if (!date) continue;
    const cell = (n) => c[cols[n]];
    const details = clean(cell("הערות"));
    out.push({
      date, merchant: clean(cell("שם בית עסק")), amount: cell("סכום עסקה"), currency: "₪",
      charge: typeof cell("סכום חיוב") === "number" ? cell("סכום חיוב") : null,
      voucher: null, details, section: clean(cell("סוג עסקה")), branch: clean(cell("ענף")),
      type: "purchase",
    });
  }
  return [{ file, format: "cal", company: "כאל", card, cardName, billing, total, immediate, rows: out }];
}

/* ---------- Max: "9999-MM-YYYY.xlsx", one sheet per section ---------- */
export function readMax(file) {
  const zipSheets = ["עסקאות במועד החיוב", 'עסקאות חו"ל ומט"ח', "עסקאות בחיוב מיידי"];
  const out = [];
  let card = null, cardName = null, billingMonth = null, total = 0, billing = null;
  for (const sheetName of zipSheets) {
    let rows;
    try { rows = readSheet(file, { sheetName, columns: /^[A-P]$/ }); } catch { continue; }
    let cols = null, grab = false;
    for (const { cells: c } of rows) {
      const a = clean(c.A);
      const head = /^(\d{4})-(.+)$/.exec(a);
      if (head && !cols) { [card, cardName] = [head[1], head[2]]; continue; }
      if (/^\d{2}\/\d{4}$/.test(a) && !cols) { billingMonth = a; continue; }
      if (a === "תאריך עסקה") { cols = Object.fromEntries(Object.entries(c).map(([k, v]) => [clean(v), k])); continue; }
      if (a === "סך הכל") { grab = true; continue; }
      if (grab) { if (sheetName !== "עסקאות בחיוב מיידי") total += num(a) ?? 0; grab = false; continue; }
      if (!cols) continue;
      const date = parseDate(c.A);
      if (!date) continue;
      const cell = (n) => c[cols[n]];
      const due = parseDate(cell("תאריך חיוב"));
      if (sheetName === "עסקאות במועד החיוב" && due) billing ??= due;
      out.push({
        date, merchant: clean(cell("שם בית העסק")), amount: cell("סכום עסקה מקורי"), currency: clean(cell("מטבע עסקה מקורי")),
        charge: typeof cell("סכום חיוב") === "number" ? cell("סכום חיוב") : null, voucher: null,
        details: [clean(cell("סוג עסקה")), clean(cell("הערות"))].filter(Boolean).join(" · "),
        section: sheetName, branch: clean(cell("קטגוריה")), due, type: "purchase",
        card: clean(cell("4 ספרות אחרונות של כרטיס האשראי")) || card,
      });
    }
  }
  if (!billing && billingMonth) { const [m, y] = billingMonth.split("/"); billing = `${y}-${m}-02`; }
  // A download can cover several cards ("כל הכרטיסים (2)"): one statement per card, from each row's card column.
  const cards = [...new Set(out.map((r) => r.card).filter(Boolean))];
  if (!cards.length) cards.push(card);
  return cards.map((k) => {
    const rows = out.filter((r) => (r.card ?? card) === k);
    return {
      file, format: "max", company: "מקס", card: k, cardName: k === card ? cardName : null, billing, billingMonth,
      // The file's "סך הכל" covers all its cards; per card it is the sum of that card's charges.
      total: cards.length === 1 ? Math.round(total * 100) / 100 : Math.round(rows.filter((r) => r.section !== "עסקאות בחיוב מיידי").reduce((s, r) => s + (r.charge ?? 0), 0) * 100) / 100,
      rows,
    };
  });
}

/* ---------- Isracard, all cards in one monthly file: "Export_M_YYYY.xlsx" ---------- */
export function readIsracardExport(file) {
  const { txns, cards } = readCardFile(file);
  return cards.map((k) => {
    const mine = txns.filter((t) => t.card === k.card && t.billing === k.billing);
    return {
      file, format: "isracard-export", company: "ישראכרט", card: k.card, cardName: k.cardName, billing: k.billing,
      total: null, empty: k.empty,
      rows: mine.map((t) => ({
        date: t.purchase, merchant: t.merchant, amount: t.original, currency: t.currency, charge: t.charge,
        voucher: t.voucher, details: t.details, section: t.section, type: t.transfer ? "transfer" : "purchase",
      })),
    };
  });
}

/** Every statement in the transactions folder, with the reader chosen by folder and name. */
export function readAllStatements(dir, { maxCard = null } = {}) {
  const all = [];
  const errors = [];
  for (const name of fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isDirectory())) {
    const sub = { name };
    const folder = path.join(dir, name);
    for (const f of fs.readdirSync(folder).filter((f) => /\.xlsx$/i.test(f)).sort()) {
      const file = path.join(folder, f);
      let reader = null;
      if (/^\d{4}_\d{2}_\d{4}/.test(f)) reader = readIsracardCard;
      // Max: the card's own folder (maxCard in the private config), whatever the files are called
      // ("9999-MM-YYYY", "transaction-details_export_…").
      else if ((maxCard && sub.name === maxCard) || /^transaction-details_export/i.test(f)) reader = readMax;
      // Cal: "5678-MM-YYYY.xlsx" or Cal's own download name "פירוט חיובים לכרטיס ויזה 5678 - …".
      else if (/^\d{4}-\d{2}-\d{4}/.test(f) || /^פירוט חיובים לכרטיס/.test(f)) reader = readCal;
      else if (/^Export_\d+_\d{4}/i.test(f)) reader = readIsracardExport;
      if (!reader) continue;
      try { all.push(...reader(file)); } catch (e) { errors.push(`${sub.name}/${f}: ${e.message}`); }
    }
  }
  return { statements: all, errors };
}
