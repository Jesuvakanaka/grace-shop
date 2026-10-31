#!/usr/bin/env node
// "No new lint errors" gate (ZP-470).
//
// `npm run lint` still fails on master with a pre-existing backlog, so CI
// cannot require a clean lint yet. Instead, for every JS/TS file this change
// adds/modifies/renames, compare the ESLint error count of the HEAD version
// with the base version (same config, base text linted via lintText):
//   - modified/renamed file: fails if its error count goes up;
//   - new file: must have 0 errors.
// Warnings are ignored. Prints a per-file table.
//
// Usage: node .github/scripts/lint-no-new-errors.mjs <base-ref-or-sha>
//   Empty or all-zero base -> skip (exit 0). Unknown base -> fall back to HEAD^.
//
// TODO(lint backlog): once `npm run lint` is clean on master, replace this
// gate with `npm run lint` in .github/workflows/checks.yml.

import { execFileSync } from "node:child_process";
import { ESLint } from "eslint";

const EXTENSIONS = /\.(ts|tsx|js|mjs)$/;

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (allowFail) return null;
    throw error;
  }
}

function resolveBase(raw) {
  const base = (raw ?? "").trim();
  if (base === "" || /^0+$/.test(base)) return null;
  if (git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`], { allowFail: true }) !== null) {
    return base;
  }
  console.log(`::warning::Lint base ${base} not found in history; falling back to HEAD^.`);
  return "HEAD^";
}

/** Changed files as { path, basePath|null } relative to the merge base. */
function changedFiles(mergeBase) {
  const out = git(["diff", "--name-status", "-M", "--diff-filter=ACMR", mergeBase, "HEAD"]);
  const files = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [status, first, second] = line.split("\t");
    const path = status.startsWith("R") || status.startsWith("C") ? second : first;
    if (!EXTENSIONS.test(path)) continue;
    const basePath = status.startsWith("A") || status.startsWith("C") ? null : first;
    files.push({ path, basePath });
  }
  return files;
}

function countErrors(result) {
  const byRule = {};
  for (const m of result?.messages ?? []) {
    if (m.severity !== 2) continue;
    const rule = m.ruleId ?? (m.fatal ? "parse-error" : "unknown");
    byRule[rule] = (byRule[rule] ?? 0) + 1;
  }
  return { total: result?.errorCount ?? 0, byRule };
}

async function main() {
  const base = resolveBase(process.argv[2]);
  if (base === null) {
    console.log("::notice::No lint base for this run; skipping the no-new-lint-errors check.");
    return 0;
  }
  const mergeBase = git(["merge-base", base, "HEAD"]).trim();
  const files = changedFiles(mergeBase);
  if (files.length === 0) {
    console.log(`No changed JS/TS files relative to ${base} (merge base ${mergeBase.slice(0, 12)}).`);
    return 0;
  }

  const eslint = new ESLint({ warnIgnored: false });
  const rows = [];
  for (const { path, basePath } of files) {
    const [headResult] = await eslint.lintFiles([path]);
    const head = countErrors(headResult);

    let baseCount = null; // null = new file
    if (basePath !== null) {
      const text = git(["show", `${mergeBase}:${basePath}`], { allowFail: true });
      if (text !== null) {
        // Lint under the HEAD path so the same config/overrides apply.
        const [baseResult] = await eslint.lintText(text, { filePath: path, warnIgnored: false });
        baseCount = countErrors(baseResult);
      }
    }

    const before = baseCount?.total ?? 0;
    const ok = baseCount === null ? head.total === 0 : head.total <= before;
    rows.push({ path, isNew: baseCount === null, before, head, baseCount, ok, headResult });
  }

  const width = Math.max(4, ...rows.map((r) => r.path.length));
  const line = (a, b, c, d, e) =>
    `${a.padEnd(width)}  ${b.padStart(6)}  ${c.padStart(6)}  ${d.padStart(6)}  ${e}`;
  console.log(`No-new-lint-errors check against ${base} (merge base ${mergeBase.slice(0, 12)})\n`);
  console.log(line("file", "base", "head", "delta", "result"));
  console.log(line("-".repeat(width), "------", "------", "------", "------"));
  for (const r of rows) {
    const delta = r.head.total - r.before;
    console.log(
      line(
        r.path,
        r.isNew ? "new" : String(r.before),
        String(r.head.total),
        delta > 0 ? `+${delta}` : String(delta),
        r.ok ? "ok" : r.isNew ? "FAIL (new file must have 0 errors)" : "FAIL (more errors)",
      ),
    );
  }

  const failed = rows.filter((r) => !r.ok);
  for (const r of failed) {
    console.log(`\n${r.path}: errors by rule (base -> head)`);
    const rules = new Set([...Object.keys(r.head.byRule), ...Object.keys(r.baseCount?.byRule ?? {})]);
    for (const rule of [...rules].sort()) {
      const b = r.baseCount?.byRule[rule] ?? 0;
      const h = r.head.byRule[rule] ?? 0;
      if (h > b) console.log(`  ${rule}: ${b} -> ${h}`);
    }
    for (const m of r.headResult?.messages ?? []) {
      if (m.severity === 2) console.log(`  ${m.line}:${m.column}  ${m.ruleId ?? "parse-error"}  ${m.message}`);
    }
    console.log(`::error file=${r.path}::Lint errors increased (${r.before} -> ${r.head.total}).`);
  }

  console.log(
    failed.length === 0
      ? `\nOK: ${rows.length} changed file(s), no new lint errors.`
      : `\nFAILED: ${failed.length} of ${rows.length} changed file(s) gained lint errors.`,
  );
  return failed.length === 0 ? 0 : 1;
}

process.exitCode = await main();
