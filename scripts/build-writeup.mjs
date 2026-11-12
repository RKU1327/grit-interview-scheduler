// Builds docs/GRIT_Assignment_Writeup.pdf from docs/GRIT_Assignment_Writeup.md
// and fails if the result is longer than two A4 pages.
//
//   npm run docs:pdf
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { marked } from "marked";
import { PDFDocument } from "pdf-lib";

const MAX_PAGES = 2;
const src = path.resolve("docs/GRIT_Assignment_Writeup.md");
const out = path.resolve("docs/GRIT_Assignment_Writeup.pdf");

const css = `
  @page { size: A4; margin: 11mm 12mm 11mm 12mm; }
  * { box-sizing: border-box; }
  html { font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif; font-size: 8.5pt; line-height: 1.34; color: #1b2233; }
  body { margin: 0; }
  h1 { font-size: 16pt; margin: 0 0 1mm; color: #1e2a5e; letter-spacing: -0.2pt; }
  .meta { margin: 0 0 2.2mm; color: #5b6478; font-size: 7.8pt; border-bottom: 0.6pt solid #c9cfe0; padding-bottom: 1.6mm; }
  h2 { font-size: 10.5pt; margin: 3mm 0 1.3mm; color: #1e2a5e; break-after: avoid; }
  p { margin: 0 0 1.5mm; }
  ul { margin: 0 0 1.5mm; padding-left: 4.2mm; }
  li { margin: 0 0 0.5mm; }
  strong { color: #131a2e; }
  code { font-family: Consolas, "SF Mono", Menlo, monospace; font-size: 7.6pt; background: #eef0f7; padding: 0 0.6mm; border-radius: 0.6mm; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 2mm; font-size: 7.9pt; line-height: 1.27; }
  th { text-align: left; background: #1e2a5e; color: #fff; font-weight: 600; padding: 0.8mm 1.4mm; }
  td { padding: 0.75mm 1.4mm; vertical-align: top; border-bottom: 0.4pt solid #d5d9e6; }
  tr:nth-child(even) td { background: #f6f7fb; }
  tr { break-inside: avoid; }
  td:first-child { width: 23%; }
`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>GRIT Interview Scheduler - Assignment write-up</title><style>${css}</style></head><body>${marked.parse(
  readFileSync(src, "utf8"),
)}</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "load" });
await page.pdf({ path: out, format: "A4", printBackground: true, preferCSSPageSize: true });
await browser.close();

const pages = (await PDFDocument.load(readFileSync(out))).getPageCount();
writeFileSync(path.resolve("docs/.writeup-preview.html"), html);
console.log(`Wrote ${path.relative(process.cwd(), out)} (${pages} page${pages === 1 ? "" : "s"})`);
if (pages > MAX_PAGES) {
  console.error(`ERROR: the write-up must fit on ${MAX_PAGES} A4 pages but is ${pages}. Shorten the Markdown source.`);
  process.exit(1);
}
