// Tiny static server for previewing FlowWise.html:  node standalone/serve.mjs  → http://localhost:5178
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT) || 5178;

http
  .createServer((req, res) => {
    const file = path.join(root, "FlowWise.html");
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(500); return res.end(String(err)); }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(buf);
    });
  })
  .listen(port, () => console.log(`FlowWise preview on http://localhost:${port}`));
