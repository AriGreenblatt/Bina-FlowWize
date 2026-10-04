// Minimal .xlsx reader with no external packages: unzips with node:zlib and reads cell values.
// Handles plain and namespace-prefixed XML (<x:row>, <x:c> …), which some banks' exports use.
import fs from "node:fs";
import zlib from "node:zlib";

/** Read every entry of a zip file into a Map(name -> Buffer). */
function unzip(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`${file}: not a zip/xlsx file`);
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < entries; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`${file}: bad central directory`);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compSize);
    out.set(name, method === 0 ? raw : zlib.inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const decode = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");

/**
 * Rows of one sheet as [{ r: rowNumber, cells: { A: value, B: value, ... } }].
 * Only columns matching `columns` (a RegExp) are kept. Numbers stay numbers (dates are Excel serials).
 */
export function readSheet(file, { sheetName, columns = /^[A-Z]{1,2}$/ } = {}) {
  const zip = unzip(file);
  const text = (name) => zip.get(name)?.toString("utf8") ?? "";
  const shared = [...text("xl/sharedStrings.xml").matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)]
    .map((m) => decode([...m[1].matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((t) => t[1]).join("")));

  const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
  const sheets = [...text("xl/workbook.xml").matchAll(/<(?:\w+:)?sheet [^>]*>/g)].map((m) => ({ name: decode(attr(m[0], "name") ?? ""), rid: attr(m[0], "r:id") }));
  // Attribute order varies between producers, so read Id and Target separately.
  const rels = new Map([...text("xl/_rels/workbook.xml.rels").matchAll(/<(?:\w+:)?Relationship [^>]*>/g)].map((m) => [attr(m[0], "Id"), attr(m[0], "Target")]));
  const sheet = sheetName ? sheets.find((s) => s.name === sheetName) : sheets[0];
  if (!sheet) throw new Error(`${file}: sheet ${sheetName} not found`);
  const target = rels.get(sheet.rid).replace(/^\/?(xl\/)?/, "");
  const xml = text(`xl/${target}`);

  const rows = [];
  for (const rm of xml.matchAll(/<(?:\w+:)?row [^>]*?r="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    if (!rm[2]) continue;
    const cells = {};
    for (const cm of rm[2].matchAll(/<(?:\w+:)?c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const [, col, attrs, inner] = cm;
      if (!inner || !columns.test(col)) continue;
      const t = /t="(\w+)"/.exec(attrs)?.[1];
      const v = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner)?.[1];
      let val;
      if (t === "s") val = shared[+v];
      else if (t === "inlineStr") val = decode([...inner.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((x) => x[1]).join(""));
      else if (t === "str" || t === "e") val = v != null ? decode(v) : "";
      else if (t === "b") val = v === "1";
      else val = v != null ? Number(v) : undefined;
      if (typeof val === "string") val = val.trim();
      if (val !== undefined && val !== "") cells[col] = val;
    }
    if (Object.keys(cells).length) rows.push({ r: +rm[1], cells });
  }
  rows.sheetName = sheet.name;
  return rows;
}

export const serialToIso = (n) => new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
