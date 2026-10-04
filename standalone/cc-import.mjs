// Reads the credit-card company's monthly "Export_M_YYYY.xlsx" statements. Each file holds several
// card sections ("פלטינה מסטרקארד - 1234"), each with domestic ("עסקאות בארץ") and foreign
// ("עסקאות בחו"ל") tables. Every transaction gets the card's last four digits, and a category and
// topic when the merchant can be identified.
import { readSheet, serialToIso } from "./xlsx.mjs";

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** "15/09/24", "13/03/2024" or an Excel serial → "2024-09-15". */
export function parseDmy(v) {
  if (typeof v === "number" && v > 30000 && v < 60000) return serialToIso(v);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(clean(v));
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

// Statement lines that summarize other rows rather than being purchases.
const SUMMARY = /סך חיוב|לחיוב|חיובי קרדיט|חיוב חודשי|סך ריבית|TOTAL FOR DATE/;
// Charges added by the card company that the statement leaves out of its purchase totals.
const FEE = /ריבית ישרקרדיט|גלישה ישרקרדיט/;

export function readCardFile(file) {
  const rows = readSheet(file, { columns: /^[A-H]$/ });
  const txns = [];
  const totals = [];
  const skipped = [];
  const cards = [];
  let card = null, cardName = null, billing = null, section = null, col = null;

  for (const { r, cells: c } of rows) {
    const a = typeof c.A === "string" ? clean(c.A) : "";
    const heading = /^(.+?) - (\d{4})( \*)?$/.exec(a);
    if (heading && !parseDmy(a)) {
      [card, cardName, billing, section, col] = [heading[2], heading[1], parseDmy(c.C), null, null];
      cards.push({ card, cardName, billing, empty: false });
      continue;
    }
    if (a === "אין נתונים להצגה") { if (cards.length) cards.at(-1).empty = true; continue; }
    if (a === "עסקאות בארץ") { section = "domestic"; col = null; continue; }
    if (a.startsWith("עסקאות בחו")) { section = "abroad"; col = null; continue; }
    if (a === "תאריך רכישה") {
      col = Object.fromEntries(Object.entries(c).map(([k, v]) => [clean(v), k]));
      continue;
    }
    if (!card || !section || !col) continue;

    const cell = (name) => c[col[name]];
    if (SUMMARY.test(`${clean(c.B)} ${clean(c.C)}`)) {
      totals.push({ r, card, section, label: clean(c.B) || clean(c.C), amount: section === "abroad" ? c.D : c.E });
      continue;
    }
    const merchant = clean(cell("שם בית עסק"));
    const details = clean(cell("פירוט נוסף"));
    const purchase = parseDmy(cell("תאריך רכישה"));
    const charge = cell("סכום חיוב");
    if (!purchase || typeof charge !== "number") continue;
    if (/פרעון ישרקרדיט/.test(merchant) || /פרעון חוב/.test(details)) { skipped.push({ r, card, merchant, charge, why: "פרעון חוב קרדיט (מופיע בבנק)" }); continue; }
    // "קרדיט ב-3 תש של …" only announces a move to installments (totalled under "לידיעה בקרדיט"); the installments follow as their own rows.
    if (/^קרדיט ב-/.test(details)) { skipped.push({ r, card, merchant, charge, why: "לידיעה בלבד (הועבר לתשלומי קרדיט)" }); continue; }
    if (charge === 0) { skipped.push({ r, card, merchant, charge, why: "סכום חיוב 0" }); continue; }

    // Installments are charged monthly: date them on the billing date and name the installment.
    const inst = /תשלום (\d+)\s*(?:מ-|מתוך)\s*(\d+)/.exec(details);
    txns.push({
      r,
      card,
      cardName,
      billing,
      section,
      date: inst ? (billing ?? purchase) : purchase,
      purchase,
      merchant,
      description: inst ? `${merchant} (תשלום ${inst[1]} מתוך ${inst[2]})` : merchant,
      voucher: clean(cell("מספר שובר")) || null,
      original: cell("סכום עסקה") ?? cell("סכום מקורי"),
      currency: cell("מטבע מקור"),
      charge,
      details,
      fee: FEE.test(merchant),
      // "העברות לקרדיט": earlier purchases refunded and re-charged in installments — a reschedule, not new spending.
      transfer: /^העברות/.test(merchant),
    });
  }
  return { txns, totals, skipped, cards };
}

/* ---------------- classification ---------------- */

export const normMerchant = (s) =>
  clean(s).replace(/^פרעון\s+/, "").replace(/["'`׳״().,*\-_/\\|:]/g, " ").replace(/\d+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

/** Merchant name → [category, topic], learned from transactions the user already classified. */
export function buildKnown(rows) {
  const votes = new Map();
  for (const r of rows) {
    if (!r.category || !r.topic) continue;
    const k = normMerchant(r.description);
    if (k.length < 3) continue;
    const e = votes.get(k) ?? new Map();
    const v = `${r.category}${r.topic}`;
    e.set(v, (e.get(v) ?? 0) + 1);
    votes.set(k, e);
  }
  return new Map([...votes].map(([k, e]) => [k, [...e].sort((a, b) => b[1] - a[1])[0][0].split("")]));
}

// Merchant rules the user approved (kept in the private config, not in the code). They win over
// everything else. Set with setUserRules([{ pattern, flags, category, topic }]).
let USER_RULES = [];
export const setUserRules = (rules = []) => { USER_RULES = rules.map((r) => [new RegExp(r.pattern, r.flags ?? ""), r.category, r.topic]); };
const RULES = [
  [/^העברות/, "העברה לקרדיט", "דמי ניהול"],
  [/משיכת מזומנים/, "שכר דירה", "שכר דירה"],
  [/ריבית|גלישה ישרקרדיט|פרעון מוקדם לעסקאות|עמלת|עמלה/, "ריבית", "דמי ניהול"],
  [/דמי כרטיס|דמי חבר/, "דמי כרטיס אשראי", "דמי ניהול"],
  [/GETT|יאנגו|YANGO|מונית|טקסי/i, "מוניות", "מוניות"],
  [/חניון|חניוני|חניה|אחוזות החוף|אחוזת החוף|פנגו|PANGO|סלופארק|CELLOPARK/i, "חניון", "רכב"],
  [/דרך ארץ|כביש 6|נתיבי איילון|נתיב מהיר/, "כביש 6", "רכב"],
  [/WE WASH|מ\. ?התחבורה|מוסך|מוסכים|טורבו קלין|צמיג|רישוי|משרד תחבורה|משרד התחבורה|שטיפת רכב|רכבת ישראל|רב.?קו|RAV.?KAV|MOOVIT/i, "רכב ותחבורה", "רכב"],
  [/(^|\s)פז(\s|$)|YELLOW|(^|\s)דלק(\s|$)|סונול|SONOL|דור אלון|דור אלקנה|ביילסול|תחנת |(^|\s)TEN(\s|$)/i, "דלק", "דלק"],
  [/חתונה|בר מצווה|בת מצווה|מתנות/, "מתנות ואירועים", "משפחה"],
  [/קרן קיימת|CHARIDY|VAAD HATZEDA|ע"ר|ע\.ר|עמות|חסד|צדק|תרומ|(?<!פתח )תקו?וה|לעזור|ארוחה חמה|יד ליתום|קרן יחד|לתת |מתנת חיים|אור לחולה|רפואה וחיים|הצלה|טהרת המשפחה|שערי רחמים|גרנות|ועד הרבנים|התורה והארץ|אבני דעת|(^|\s)עלה(\s|$)|מגדל אור|לב האחי|ילדי המל|קו לחיים|בית חם|עם אחד|נתינת|מקווה|ישיבת|ישיבה|בית כנסת|חב"ד|ברסלב|האש שלי|תרים קרנו|אור מנחם|קרוב אליך|CHESED|GOFNDME|GOFUNDME|JGIVE/i, "צדקה", "צדקה"],
  [/סופר ?פארם|SUPER-?PHARM|בית מרקחת|בי דראגסטורס|BE DRUG|ניו פארם|גוד פארם/i, "בית מרקחת", "בריאות"],
  [/NUTREANCE|BUYGOODS|ביו ?-?גאיה/i, "תוספי תזונה", "בריאות"],
  [/ספרינג ביומד|מכבי|כללית|מאוחדת|רופא|מרפאה|קופת חולים|שיניים|אופטיק|משקפ|פיזיותרפ/, "רפואה ובריאות", "בריאות"],
  [/OMO FIT|קליסטניקס|אבא חטוב|הולמס פלייס|HOLMES|GYM|כושר|סטודיו/i, "ספורט", "בריאות"],
  [/ביטוח|הראל|כלל ב|מגדל חיים|מגדל בטוח|מגדל רכב|הפניקס|מנורה|הכשרה|AIG|ליברה/i, "ביטוח", "ביטוח"],
  [/סלקום|CELLCOM|פרטנר|PARTNER|(^|\s)HOT(\s|$)|הוט |בזק|גולן טלקום|דינמיקה סלולר|גלישה בטוחה|WE4G|אקספון/i, "נייד", "נייד"],
  [/PDFSIMPLI|PDFAID|TIKTOK|NETFLIX|SPOTIFY|GOOGLE|YOUTUBE|OPENAI|CHATGPT|ANTHROPIC|CLAUDE|APPLE\.COM|ITUNES|MICROSOFT|ADOBE|SCRIBD|TOTALAV|YOGA GO|ABLEAPP|FASTEASY|MYHERITAGE|GROUND NEWS|DISNEY|CANVA|DROPBOX|PATREON|MEDIUM|ZOOM|NOTION|TRUECALLER|2CO\.COM|PADDLE|DEEPSTASH|BLINKIST|DUOLINGO|SUBS|SUBSCRIPTION/i, "מנוים אינטרנט", "אינטרנט"],
  [/ABEBOOKS|TIMES NEWSPAPERS|גלובס|הארץ|ידיעות|מעריב|ישראל היום|מגזין|עיתון|ספרים|ספרייתי|סטימצקי|AUDIBLE|KINDLE/i, "ספרים ועיתונים", "בית"],
  [/AIRBNB|BOOKING|EXPEDIA|מלון|HOTEL|צימר|אכסני/i, "אירוח", "אירוח"],
  [/היכל|תיאטר|קולנוע|סינמה|CINEMA|YES PLANET|כרטיסים|זאפה|הופעה|מוזיאון|ספארי|לונה פארק|כפר השעשועים/i, "פנאי בילוי", "פנאי"],
  [/לוטו|טוטו|(^|\s)פיס(\s|$)|הפיס/, "לוטו", "משרד"],
  [/ALLJOBS|דרושים|LINKEDIN/i, "חיפוש עבודה", "עבודה"],
  [/PAYBOX|פייבוקס/i, "משרד", "משרד"],
  [/ארומה|קפה|CAFE|COFFEE|קופיקס|לנדוור|בליקר|רולדין|ROLADIN|מילק בר/i, "בתי קפה", "בתי קפה"],
  [/מסעד|קייטרינג|פלאפל|חומוס|שיפוד|פיצ|PIZZA|בורגר|BURGER|סושי|SUSHI|מקדונלד|MCDONALD|שווארמה|בהדונס|בר גוריון|גריל|ביסטרו|גלידה|WOLT|וולט|תן ביס|10BIS|סיבוס|CIBUS|נודלס|ראמן|דומינוס/i, "מסעדות", "ארוחות"],
  [/טופ מרקט|CARREFOUR|קרפור|ויקטורי|שופרסל|SHUFERSAL|רמי לוי|יוחננוף|אושר עד|חצי חינם|מגה בעיר|AM:PM|יינות ביתן|טיב טעם|מכולת|פירות|ירקות|אטליז|קצב|מאפי|מאפה|קונדיטור|נשנושים|חנויות נוחות|ניומרקט|מרקט|דגים|גבינות/i, "מזון", "מזון"],
  [/קולומביה|COLUMBIA|מתאים לי|טופ תיק|אופנ|ZARA|זארה|H&M|קסטרו|CASTRO|(^|\s)FOX(\s|$)|פוקס|רנואר|RENUAR|גולף|TERMINAL ?X|טרמינל|SHEIN|ASOS|בוגארט|סאקוני|SAUCONY|נעל|הפנינג|מסימו|אמריקן איגל|בורסלינו|קרל י|ADIDAS|NIKE|אדידס|נייקי|מנגו|MANGO|עדיקה|ADIKA|ביגוד|תכשיט/i, "ביגוד", "ביגוד"],
  [/מרבד הקסמים|שטיח|פרח|איקאה|IKEA|(^|\s)ACE(\s|$)|הום סנטר|ביתילי|כלי בית|מצעים|ריהוט|רהיט/i, "ריהוט ובית", "בית"],
  [/(^|\s)באג(\s|$)|KSP|מזלטק|שקם אלקטריק|מחסני חשמל|אלקטרו|קרביץ|OFFICE DEPOT|מחשב/i, "ציוד ומשרד", "בית"],
  [/TEMU|ALIEXPRESS|AMAZON|EBAY|IHERB/i, "קניות אונליין", "בית"],
  [/COURSIV|CODE WITH MOSH|קורס|VITRUE|UDEMY|COURSERA|סדנ/i, "קורסים", "קורסים"],
];

/** { category, topic, how } for one card merchant; category/topic are null when it can't be identified. */
export function classifyCard(merchant, known) {
  for (const [re, category, topic] of USER_RULES) if (re.test(merchant)) return { category, topic, how: "כלל שאושר" };
  const k = normMerchant(merchant);
  const hit = known.get(k);
  if (hit) return { category: hit[0], topic: hit[1], how: "כמו בנתוני האשראי הקיימים" };
  // Statements cut merchant names to ~20 characters, so also match a shared beginning.
  if (k.length >= 8) {
    for (const [name, v] of known) {
      if (name.length >= 8 && (name.startsWith(k) || k.startsWith(name))) return { category: v[0], topic: v[1], how: "כמו בנתוני האשראי הקיימים (שם מקוצר)" };
    }
  }
  for (const [re, category, topic] of RULES) if (re.test(merchant)) return { category, topic, how: "לפי סוג בית העסק" };
  return { category: null, topic: null, how: "לא זוהה" };
}
