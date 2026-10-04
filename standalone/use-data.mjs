// Points FlowWise.html at the real or the demo data file.
//   node standalone/use-data.mjs real   — your own data (data/flowwise-real.js)
//   node standalone/use-data.mjs demo   — invented data, for submitting (demo/flowwise-demo.js)
//   node standalone/use-data.mjs        — shows which one is in use
import fs from "node:fs";
import path from "node:path";
import { DATA_FILES, currentData, root, writeApp } from "./app-html.mjs";

const which = process.argv[2];
if (!which) {
  console.log(`FlowWise.html reads: ${currentData() ?? "unknown"} (${DATA_FILES[currentData()] ?? "—"})`);
} else if (!DATA_FILES[which]) {
  console.error(`Use "real" or "demo", not "${which}".`);
  process.exit(1);
} else {
  const { file } = writeApp(which);
  const exists = fs.existsSync(path.join(root, file));
  console.log(`FlowWise.html now reads ${which} data: ${file}${exists ? "" : "  (WARNING: file not built yet)"}`);
}
