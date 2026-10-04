// Invented demo data for FlowWise-demo.html — no real transactions, names or card numbers.
// Deterministic (seeded), so every build produces the same demo. Used by build-demo.mjs.
import crypto from "node:crypto";

const stableId = (kind, key) => {
  const h = crypto.createHash("sha1").update(`demo:${kind}:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

// Small seeded random generator (mulberry32).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- Topics and categories ---------------- */
// [category, primary topic]
export const DEMO_TAXONOMY = [
  ["משכורת", "משכורת"], ["קצבה", "משכורת"], ["החזר מס", "משכורת"],
  ["שכר דירה", "דיור"], ["ארנונה", "דיור"], ["חשמל", "דיור"], ["מים", "דיור"], ["ועד בית", "דיור"],
  ["סופרמרקט", "מזון"], ["ירקות ופירות", "מזון"], ["מאפייה", "מזון"],
  ["מסעדות", "ארוחות"], ["משלוחי אוכל", "ארוחות"], ["בתי קפה", "ארוחות"],
  ["דלק", "רכב"], ["חניה", "רכב"], ["ביטוח רכב", "רכב"], ["טיפול לרכב", "רכב"], ["תחבורה ציבורית", "רכב"], ["מוניות", "רכב"],
  ["קופת חולים", "בריאות"], ["בית מרקחת", "בריאות"], ["רופא שיניים", "בריאות"], ["חדר כושר", "בריאות"],
  ["ביטוח חיים", "ביטוח"], ["ביטוח בריאות", "ביטוח"],
  ["סלולר", "תקשורת"], ["אינטרנט", "תקשורת"], ["מנויים דיגיטליים", "תקשורת"],
  ["ביגוד והנעלה", "ביגוד"],
  ["חוגים", "ילדים"], ["דמי כיס", "ילדים"], ["ציוד לבית הספר", "ילדים"],
  ["תרומות", "צדקה"],
  ["קולנוע והופעות", "פנאי"], ["ספרים", "פנאי"], ["חופשות ומלונות", "פנאי"],
  ["כלי בית וריהוט", "בית"], ["קניות אונליין", "בית"],
  ["קורסים", "לימודים"],
  ["מתנות", "משפחה"],
  ["עמלות בנק", "עמלות וריבית"], ["דמי כרטיס", "עמלות וריבית"], ["ריבית הלוואה", "עמלות וריבית"],
  ["משיכת מזומן", "מזומן"],
  // Financing and card bills — kept out of income/spending by the app.
  ["משיכת חסכון", "חסכונות והלוואות"], ["לקיחת הלוואה", "חסכונות והלוואות"], ["פרעון הלוואה", "חסכונות והלוואות"],
  ["פרעון כרטיס אשראי", "ראה פירוט CC"], ["פירוט אשראי חסר", "לא ידוע"],
  ["רכישת רכב", "רכב"],
];

// Fictional cards: company, billing day of month.
export const DEMO_CARDS = {
  "1111": { company: "ישראכרט", name: "מסטרקארד דמו", day: 10 },
  "2222": { company: "כאל", name: "ויזה דמו", day: 2 },
  "3333": { company: "מקס", name: "מקס דמו", day: 15 },
};

// Card merchants: [merchant, category, min ₪, max ₪, times per month, card]. Category null = left
// unclassified on purpose, to show the "unmapped transactions" flow.
const CARD_MERCHANTS = [
  ["שופרסל דיל", "סופרמרקט", 180, 620, 4, "1111"],
  ["רמי לוי שיווק השקמה", "סופרמרקט", 250, 700, 2, "2222"],
  ["פירות וירקות השוק", "ירקות ופירות", 60, 180, 3, "1111"],
  ["מאפיית הכיכר", "מאפייה", 18, 65, 4, "3333"],
  ["WOLT", "משלוחי אוכל", 55, 190, 3, "2222"],
  ["מסעדת הגפן", "מסעדות", 140, 420, 1, "1111"],
  ["קפה נחת", "בתי קפה", 16, 48, 5, "3333"],
  ["פז — תחנת דלק", "דלק", 180, 320, 3, "1111"],
  ["פנגו חניה", "חניה", 8, 35, 5, "3333"],
  ["רב-קו טעינה", "תחבורה ציבורית", 50, 100, 1, "3333"],
  ["GETT", "מוניות", 30, 95, 2, "2222"],
  ["סופר-פארם", "בית מרקחת", 35, 210, 2, "1111"],
  ["מרפאת שיניים חיוך", "רופא שיניים", 250, 900, 0.15, "1111"],
  ["סטודיו כושר", "חדר כושר", 249, 249, 1, "2222"],
  ["סלקום", "סלולר", 89, 89, 1, "1111"],
  ["בזק אינטרנט", "אינטרנט", 119, 119, 1, "1111"],
  ["NETFLIX", "מנויים דיגיטליים", 49.9, 49.9, 1, "3333"],
  ["SPOTIFY", "מנויים דיגיטליים", 21.9, 21.9, 1, "3333"],
  ["קסטרו", "ביגוד והנעלה", 120, 450, 0.5, "2222"],
  ["נעלי השדרה", "ביגוד והנעלה", 200, 480, 0.2, "1111"],
  ["מרכז חוגים עירוני", "חוגים", 320, 320, 1, "2222"],
  ["סטימצקי", "ספרים", 45, 160, 0.4, "3333"],
  ["סינמה סיטי", "קולנוע והופעות", 80, 240, 0.5, "2222"],
  ["עמותת לב חם", "תרומות", 50, 50, 1, "1111"],
  ["קרן אור לילדים", "תרומות", 36, 36, 1, "2222"],
  ["איקאה", "כלי בית וריהוט", 150, 900, 0.25, "1111"],
  ["AMAZON", "קניות אונליין", 60, 380, 0.6, "3333"],
  ["UDEMY", "קורסים", 45, 90, 0.2, "3333"],
  ["מתנות ועוד", "מתנות", 90, 350, 0.3, "2222"],
  ["דמי כרטיס", "דמי כרטיס", 12.9, 12.9, 1, "3333"],
  ["BLUEWAVE*SRV", null, 29, 79, 0.5, "3333"],
  ["א.ב. שירותים בע\"מ", null, 100, 300, 0.3, "1111"],
];

/** Builds the whole demo database: { transactions, categories, topics, category_topics, imports }. */
export function buildDemo({ from = "2024-10", to = "2026-09" } = {}) {
  const rand = rng(20260923);
  const between = (a, b) => Math.round((a + (b - a) * rand()) * 100) / 100;
  const pick = (list) => list[Math.floor(rand() * list.length)];

  const topics = [];
  const topicByName = new Map();
  const topicId = (name) => {
    if (!topicByName.has(name)) { const t = { id: stableId("topic", name), name }; topics.push(t); topicByName.set(name, t); }
    return topicByName.get(name).id;
  };
  const categories = [];
  const catByName = new Map();
  const category_topics = [];
  for (const [name, topic] of DEMO_TAXONOMY) {
    const c = { id: stableId("category", name), name, primary_topic_id: topicId(topic) };
    categories.push(c);
    catByName.set(name, c);
    category_topics.push({ category_id: c.id, topic_id: c.primary_topic_id });
  }
  topicId("ללא נושא");

  const months = [];
  for (let [y, m] = from.split("-").map(Number); `${y}-${String(m).padStart(2, "0")}` <= to; m === 12 ? (y++, m = 1) : m++) months.push(`${y}-${String(m).padStart(2, "0")}`);
  const day = (ym, d) => `${ym}-${String(Math.min(d, 28)).padStart(2, "0")}`;
  const nextMonth = (ym) => { let [y, m] = ym.split("-").map(Number); m === 12 ? (y++, m = 1) : m++; return `${y}-${String(m).padStart(2, "0")}`; };

  const transactions = [];
  const imports = [];
  const bankImport = stableId("import", "bank");
  const seen = new Map();
  const add = (t, catName) => {
    const c = catName ? catByName.get(catName) : null;
    const base = [t.txn_date, t.description, t.amount.toFixed(2), t.account_label].join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const dedup_key = `demo|${base}|${n}`;
    transactions.push({
      id: stableId("txn", dedup_key), category_id: c?.id ?? null, topic_id: c?.primary_topic_id ?? null,
      source_category: catName, source_topic: c ? topics.find((x) => x.id === c.primary_topic_id).name : null,
      source_sheet: t.account_label === "בנק" ? "תנועות בחשבון" : `${DEMO_CARDS[t.account_label]?.company ?? ""} ${t.account_label}`,
      dedup_key, ...t,
    });
  };

  /* ----- credit cards: purchases per billing month ----- */
  const cardBills = new Map(); // `${card}|${billingMonth}` → total
  const cardImports = new Map();
  for (const ym of months) {
    for (const [merchant, cat, min, max, perMonth, card] of CARD_MERCHANTS) {
      let n = Math.floor(perMonth) + (rand() < perMonth % 1 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const amount = min === max ? min : between(min, max);
        const date = day(ym, 1 + Math.floor(rand() * 28));
        const billing = nextMonth(ym);
        const importKey = `${card}|${billing}`;
        if (!cardImports.has(importKey)) cardImports.set(importKey, stableId("import", importKey));
        add({ import_id: cardImports.get(importKey), txn_date: date, description: merchant, amount, kind: "expense", account_label: card, source_file: `דמו — ${DEMO_CARDS[card].company} ${card} ${billing}` }, cat);
        cardBills.set(importKey, Math.round(((cardBills.get(importKey) ?? 0) + amount) * 100) / 100);
      }
    }
    // An occasional refund.
    if (rand() < 0.25) {
      const date = day(ym, 5 + Math.floor(rand() * 20)), billing = nextMonth(ym), card = pick(["1111", "2222"]);
      const amount = between(40, 250), importKey = `${card}|${billing}`;
      if (!cardImports.has(importKey)) cardImports.set(importKey, stableId("import", importKey));
      add({ import_id: cardImports.get(importKey), txn_date: date, description: "זיכוי — קסטרו", amount, kind: "income", account_label: card, source_file: `דמו — ${card} ${billing}` }, "ביגוד והנעלה");
      cardBills.set(importKey, Math.round(((cardBills.get(importKey) ?? 0) - amount) * 100) / 100);
    }
  }

  // Two Max statements "not available": their purchases are removed and replaced by one line with
  // the amount the bank paid, like the real app does for missing statements.
  const MISSING = ["3333|2025-01", "3333|2025-02"];
  for (const key of MISSING) {
    const importId = cardImports.get(key);
    for (let i = transactions.length - 1; i >= 0; i--) if (transactions[i].import_id === importId) transactions.splice(i, 1);
  }

  /* ----- bank account ----- */
  const bank = (ym, d, description, amount, kind, cat, extra = {}) =>
    add({ import_id: bankImport, txn_date: day(ym, d), description, amount: Math.round(amount * 100) / 100, kind, account_label: "בנק", source_file: "דמו — חשבון בנק", ...extra }, cat);
  months.forEach((ym, i) => {
    bank(ym, 1, "העברה - שכר דירה", 5200, "expense", "שכר דירה");
    bank(ym, 3, "הראל ביטוח חיים", 186.4, "expense", "ביטוח חיים");
    bank(ym, 3, "מגדל ביטוח בריאות", 142.9, "expense", "ביטוח בריאות");
    bank(ym, 5, "מכבי שירותי בריאות", 118, "expense", "קופת חולים");
    bank(ym, 6, "ועד הבית", 250, "expense", "ועד בית");
    bank(ym, 10, "משכורת - אלפא טכנולוגיות בע\"מ", between(13800, 14600), "income", "משכורת");
    bank(ym, 20, "ביטוח לאומי - קצבה", 1850, "income", "קצבה");
    bank(ym, 12, "העברה - דמי כיס", 400, "expense", "דמי כיס");
    bank(ym, 14, "כספומט", pick([500, 800, 1000]), "expense", "משיכת מזומן");
    bank(ym, 28, "עמלת ניהול חשבון", 12.9, "expense", "עמלות בנק");
    if (i % 2 === 0) {
      bank(ym, 16, "עיריית העיר - ארנונה", 812, "expense", "ארנונה");
      bank(ym, 18, "חברת החשמל", between(340, 720), "expense", "חשמל");
      bank(ym, 22, "תאגיד המים", between(150, 260), "expense", "מים");
    }
    if (ym >= "2025-03") {
      bank(ym, 9, "הלוואה - תשלום קרן", 1450, "expense", "פרעון הלוואה", { kind: "financing", fin_amount: -1450 });
      bank(ym, 9, "הלוואה - ריבית", between(80, 110), "expense", "ריבית הלוואה");
    }
    if (ym === "2025-06") bank(ym, 25, "החזר מס הכנסה", 3240, "income", "החזר מס");
    if (ym === "2024-12") bank(ym, 8, "ביטוח רכב - מקיף", 3180, "expense", "ביטוח רכב");
    if (ym === "2025-12") bank(ym, 8, "ביטוח רכב - מקיף", 3390, "expense", "ביטוח רכב");
    if (ym === "2025-08") bank(ym, 11, "מוסך העיר - טיפול", 1640, "expense", "טיפול לרכב");
  });
  // Financing and one-off items.
  bank("2025-02", 26, "קופת גמל - משיכת חסכון", 40000, "financing", "משיכת חסכון", { fin_amount: 40000 });
  bank("2025-02", 20, "הלוואה - לקיחת הלוואה", 30000, "financing", "לקיחת הלוואה", { fin_amount: 30000 });
  bank("2025-11", 4, "קרן השתלמות - משיכת חסכון", 25000, "financing", "משיכת חסכון", { fin_amount: 25000 });
  bank("2026-06", 20, "קופת גמל - משיכת חסכון", 60000, "financing", "משיכת חסכון", { fin_amount: 60000 });
  bank("2026-06", 28, "רכישת רכב", 68000, "separate", "רכישת רכב");
  bank("2025-07", 10, "חופשה משפחתית - מלון בים המלח", 4800, "expense", "חופשות ומלונות");

  // Card bills debited from the bank: each equals that card's statement total.
  for (const [key, total] of [...cardBills].sort()) {
    const [card, billing] = key.split("|");
    if (billing > to) continue;
    const c = DEMO_CARDS[card];
    const t = { description: `${c.company} - ${card}`, cc_company: c.company, cc_card: card, cc_amount: total };
    bank(billing, c.day, t.description, Math.abs(total), "cc_payment", "פרעון כרטיס אשראי", t);
    if (MISSING.includes(key)) {
      const placeholder = stableId("import", `${card}|missing`);
      add({
        import_id: placeholder, txn_date: day(billing, c.day), description: `חיוב כרטיס ${card} — פירוט חסר (${billing.slice(5)}/${billing.slice(0, 4)})`,
        amount: total, kind: "expense", account_label: card, source_file: "תשלום בבנק", missing_detail: true,
      }, "פירוט אשראי חסר");
    }
  }

  const count = (id) => transactions.filter((t) => t.import_id === id).length;
  imports.push({ id: bankImport, file_name: "דמו — חשבון בנק", sheet_names: ["תנועות בחשבון"], rows_read: count(bankImport), rows_added: count(bankImport), rows_duplicate: 0, created_at: "2026-09-23T00:00:00.000Z" });
  for (const [key, id] of cardImports) {
    if (!count(id)) continue;
    imports.push({ id, file_name: `דמו — כרטיס ${key.replace("|", " · ")}`, sheet_names: [key], rows_read: count(id), rows_added: count(id), rows_duplicate: 0, created_at: "2026-09-23T00:00:00.000Z" });
  }
  for (const card of new Set(MISSING.map((k) => k.split("|")[0]))) {
    const id = stableId("import", `${card}|missing`);
    imports.push({ id, file_name: `${card} — חודשים ללא פירוט`, sheet_names: [], rows_read: count(id), rows_added: count(id), rows_duplicate: 0, created_at: "2026-09-23T00:00:00.000Z" });
  }
  transactions.sort((a, b) => a.txn_date.localeCompare(b.txn_date));
  return { transactions, categories, topics, category_topics, imports };
}
