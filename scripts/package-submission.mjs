// Creates submission/grit-interview-scheduler.zip from the committed tree.
// `git archive` only includes tracked files, so node_modules, .next, local
// databases, caches and anything in .gitignore are excluded by construction.
//
//   npm run package
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";

const out = path.resolve("submission/grit-interview-scheduler.zip");
mkdirSync(path.dirname(out), { recursive: true });

const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
if (dirty) console.warn("Warning: uncommitted changes are NOT included in the archive:\n" + dirty + "\n");

execFileSync("git", ["archive", "--format=zip", "--prefix=grit-interview-scheduler/", "-o", out, "HEAD"], { stdio: "inherit" });
const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).trim().split("\n").length;
console.log(`Wrote ${path.relative(process.cwd(), out)} (${(statSync(out).size / 1024 / 1024).toFixed(2)} MB, ${files} files)`);
