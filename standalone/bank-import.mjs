// Reads the two-year bank export (Sheet1: C זכות, D חובה, E תיאור, H תאריך, I קטגוריה, J נושא)
// and gives every row a category and topic. Rows the file already labels keep their labels; the
// rest are filled from rows with the same description, and each filled row is listed for review.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSheet, serialToIso } from "./xlsx.mjs";

// The bank export lives in the project's transactions folder.
export const BANK_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "transactions", "bank 09-24 09-26.xlsx");
export const CARD_TOPIC = "ראה פירוט CC";
const TOPIC_FIXES = new Map([["דני ניהול", "דמי ניהול"]]);

// Column I holds the running balance (a number) or "0" on rows the user has not labeled yet.
const isLabel = (v) => typeof v === "string" && v !== "0" && !/^-?\d+(\.\d+)?$/.test(v);
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const pattern = (d) => d.replace(/\d+/g, "#");

function mostCommon(items) {
  const counts = new Map();
  for (const i of items) counts.set(i, (counts.get(i) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// Card companies as they appear in bank descriptions ("כרטיסי אשראי לישראל" is Cal).
export const cardCompany = (s) =>
  /ישראכרט/.test(s) ? "ישראכרט" : /כאל|כרטיסי אשראי לי/.test(s) ? "כאל" : /מקס/.test(s) ? "מקס" : null;

// Rows filed under "ראה פירוט CC" that are not card bills: [description, category, topic, how].
const NOT_CARD_BILLS = [
  // Refunds of overdraft interest: same amounts as the "ריבית על מסגרת…" charges.
  [/^הטבה פלוס/, "ריבית", "דמי ניהול", "החזר ריבית — כמו חיובי הריבית המקבילים"],
  // Money returned from the garnished account: the other side of "העברה … לטובת עיקול".
  [/מחשבון מעוקל/, "החזר עיקול", "קנסות", "החזר עיקול — כמו העברות העיקול"],
  // Cash withdrawals: most "כספומט" rows are labelled rent.
  [/^(סניפומט|כספומט)/, "שכר דירה", "שכר דירה", "משיכת מזומן — כמו רוב שורות הכספומט — לבדוק"],
  [/^משיכת שיק/, "לא ידוע", "לא ידוע", "משיכת שיק — אין דוגמה בקובץ — לבדוק"],
];

/** Best guesses for descriptions that never appear labeled in the file. */
function fallback(x) {
  if (/ישראכרט|כרטיסי אשראי/.test(x.description) && x.kind === "income")
    return x.amount >= 10000 ? ["לקיחת הלוואה", "הלוואות"] : ["זיכוי", CARD_TOPIC];
  if (/עמלת/.test(x.description)) return ["דמי ניהול", "דמי ניהול"];
  return ["לא ידוע", "לא ידוע"];
}

export function readBankFile(file = BANK_FILE, { isracardVisaCard = null } = {}) {
  const sheet = readSheet(file, { columns: /^[A-J]$/ });
  const rows = sheet
    .slice(1)
    .map(({ r, cells: c }) => {
      const credit = typeof c.C === "number" ? c.C : 0;
      const debit = typeof c.D === "number" ? c.D : 0;
      return {
        r,
        date: serialToIso(typeof c.H === "number" ? c.H : c.B),
        description: clean(c.E) || "ללא תיאור",
        amount: Math.round((credit || debit) * 100) / 100,
        kind: credit > 0 ? "income" : "expense",
        category: isLabel(c.I) ? c.I : null,
        topic: isLabel(c.J) ? (TOPIC_FIXES.get(c.J) ?? c.J) : null,
        how: "מהקובץ",
      };
    })
    .filter((x) => x.amount > 0);

  const examples = new Map();
  for (const x of rows) {
    if (!x.category || !x.topic) continue;
    const k = `${pattern(x.description)}|${x.kind}`;
    if (!examples.has(k)) examples.set(k, []);
    examples.get(k).push(x);
  }

  const review = [];
  for (const x of rows) {
    if (x.category && x.topic) continue;
    const ex = examples.get(`${pattern(x.description)}|${x.kind}`) ?? [];
    const card = x.kind === "expense" && /^(\d{4}) - (ישראכרט|כרטיסי אשראי לי)$/.exec(x.description);
    if (x.category) {
      x.topic = mostCommon(rows.filter((e) => e.category === x.category && e.topic).map((e) => e.topic)) ?? "לא ידוע";
      x.how = "נושא לפי הקטגוריה";
    } else if (card) {
      x.category = `פרעון CC ${card[1]}`;
      x.topic = CARD_TOPIC;
      x.how = "לפי מספר הכרטיס בתיאור";
    } else if (ex.length) {
      const labels = new Set(ex.map((e) => `${e.category}|${e.topic}`));
      const best = labels.size === 1
        ? ex[0]
        : ex.reduce((b, e) => (Math.abs(Math.log(e.amount / x.amount)) < Math.abs(Math.log(b.amount / x.amount)) ? e : b));
      x.category = best.category;
      x.topic = best.topic;
      x.how = labels.size === 1 ? "כמו תנועות אחרות עם אותו תיאור" : `לפי הסכום הקרוב ביותר (${best.amount}) באותו תיאור — לבדוק`;
    } else {
      [x.category, x.topic] = fallback(x);
      x.how = "ניחוש — לבדוק";
    }
    review.push(x);
  }
  // Credit-card bills paid from the bank (topic "ראה פירוט CC"). They are marked, not counted as
  // expenses, because the card statements list the actual purchases; they are used to check that the
  // card totals match what the bank paid. Rows filed under that topic that are not card bills get
  // the category/topic of the matching examples elsewhere in the file.
  // "ישראכרט-כ.ויזה" debits (and their technical reversals) are the bills of an Isracard Visa card
  // (its number comes from the private config).
  for (const x of rows) {
    if (!isracardVisaCard || !/ישראכרט-כ\.ויזה/.test(x.description)) continue;
    [x.category, x.topic] = [`פרעון CC ${isracardVisaCard}`, CARD_TOPIC];
    x.how = `חיוב כרטיס ישראכרט ויזה ${isracardVisaCard} — סומן כתשלום כרטיס`;
    if (!review.includes(x)) review.push(x);
  }
  // Cal's monthly direct debit is always a card bill, even where the file labels it otherwise.
  for (const x of rows) {
    if (x.topic === CARD_TOPIC || !/^עפ"י הרשאה כאל$/.test(x.description) || x.kind !== "expense") continue;
    [x.category, x.topic] = ["CC כאל", CARD_TOPIC];
    x.how = "חיוב חודשי של כאל — סומן כתשלום כרטיס";
    if (!review.includes(x)) review.push(x);
  }
  for (const x of rows) {
    if (x.topic !== CARD_TOPIC) continue;
    const other = NOT_CARD_BILLS.find(([re]) => re.test(x.description));
    if (other) {
      [x.category, x.topic] = [other[1], other[2]];
      x.how = other[3];
      if (!review.includes(x)) review.push(x);
      continue;
    }
    x.cardPayment = true;
    x.cardCompany = cardCompany(x.description) ?? cardCompany(x.category);
    x.cardNumber = (/\b(\d{4})\b/.exec(x.description) ?? /\b(\d{4})\b/.exec(x.category) ?? [])[1] ?? null;
  }
  return { sheet: sheet.sheetName ?? "Sheet1", rows, review };
}
