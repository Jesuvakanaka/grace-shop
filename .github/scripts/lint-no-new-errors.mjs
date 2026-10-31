#!/usr/bin/env node
// "No new lint errors" gate (ZP-470).
//
// `npm run lint` still fails on master with a pre-existing backlog, so CI
// cannot require a clean lint yet. Instead:
//
// 1. Per changed file: for every JS/TS file this change adds/modifies/renames,
//    compare the ESLint error count of the HEAD version with the base
//    (merge-base) version, both linted with the HEAD config under the HEAD path.
//      - modified/renamed file: fails if its error count goes up;
//      - new file: must have 0 errors.
// 2. Whole tree, only when an ESLint config file changed: lint every tracked
//    JS/TS file at HEAD (HEAD config) and at the merge base (base config) and
//    fail if the TOTAL error count goes up. This catches a config change that
//    adds errors to files the change did not touch.
//
// Warnings are ignored. Prints a per-file table.
// Known gap: an ESLint plugin/version bump in package-lock.json without a
// config-file change is not compared tree-wide (both sides use HEAD's
// node_modules); its effect only shows in the changed files.
//
// Usage: node .github/scripts/lint-no-new-errors.mjs <base-ref-or-sha>
//   Empty or all-zero base -> skip (exit 0).
//   Unknown base -> fall back to origin/master (if it is not HEAD), else HEAD^.
//
// TODO(lint backlog): once `npm run lint` is clean on master, replace this
// gate with `npm run lint` in .github/workflows/checks.yml.

import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { ESLint } from "eslint";

const EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const CONFIG_FILE = /^eslint\.config\.(js|mjs|cjs|ts|mts|cts)$/;

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

const commitOf = (ref) =>
  git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { allowFail: true })?.trim() || null;

function resolveBase(raw) {
  const base = (raw ?? "").trim();
  if (base === "" || /^0+$/.test(base)) return null;
  if (commitOf(base)) return base;
  const head = commitOf("HEAD");
  const master = commitOf("origin/master");
  const fallback = master && master !== head ? "origin/master" : "HEAD^";
  console.log(`::warning::Lint base ${base} not found in history; falling back to ${fallback}.`);
  return fallback;
}

/** Diff entries { status, path, basePath|null } between the merge base and HEAD. */
function diffEntries(mergeBase) {
  const out = git(["diff", "--name-status", "-M", mergeBase, "HEAD"]);
  const entries = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [status, first, second] = line.split("\t");
    const s = status[0];
    const path = s === "R" || s === "C" ? second : first;
    const basePath = s === "A" || s === "C" ? null : first;
    entries.push({ status: s, path, basePath });
  }
  return entries;
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

const sumErrors = (results) => results.reduce((n, r) => n + r.errorCount, 0);

/** Whole-tree totals: HEAD (HEAD config) vs merge base (base config). */
async function compareWholeTree(mergeBase, headEslint) {
  const headFiles = git(["ls-files"]).split("\n").filter((f) => EXTENSIONS.test(f));
  const headTotal = sumErrors(await headEslint.lintFiles(headFiles));

  const baseTree = git(["ls-tree", "-r", "--name-only", mergeBase]).split("\n");
  const baseConfig = baseTree.find((f) => CONFIG_FILE.test(f));
  if (!baseConfig) {
    console.log("::warning::No ESLint config at the merge base; whole-tree comparison skipped.");
    return { headTotal, baseTotal: null };
  }
  // Base config text, written next to the real one so its imports and
  // relative globs resolve exactly as they would at the base commit.
  const ext = baseConfig.slice(baseConfig.lastIndexOf("."));
  const tmpConfig = `.eslint-base-config-${process.pid}${ext}`;
  writeFileSync(tmpConfig, git(["show", `${mergeBase}:${baseConfig}`]));
  try {
    const baseEslint = new ESLint({ overrideConfigFile: tmpConfig, warnIgnored: false });
    let baseTotal = 0;
    for (const file of baseTree.filter((f) => EXTENSIONS.test(f))) {
      const text = git(["show", `${mergeBase}:${file}`]);
      baseTotal += sumErrors(await baseEslint.lintText(text, { filePath: file, warnIgnored: false }));
    }
    return { headTotal, baseTotal };
  } finally {
    rmSync(tmpConfig, { force: true });
  }
}

async function main() {
  const base = resolveBase(process.argv[2]);
  if (base === null) {
    console.log("::notice::No lint base for this run; skipping the no-new-lint-errors check.");
    return 0;
  }
  const mergeBase = git(["merge-base", base, "HEAD"]).trim();
  const entries = diffEntries(mergeBase);
  const files = entries.filter((e) => "AMRC".includes(e.status) && EXTENSIONS.test(e.path));
  const configChanged = entries.some(
    (e) => CONFIG_FILE.test(e.path) || (e.basePath !== null && CONFIG_FILE.test(e.basePath)),
  );
  console.log(`No-new-lint-errors check against ${base} (merge base ${mergeBase.slice(0, 12)})\n`);

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

  if (rows.length === 0) {
    console.log("No changed JS/TS files.");
  } else {
    const width = Math.max(4, ...rows.map((r) => r.path.length));
    const line = (a, b, c, d, e) =>
      `${a.padEnd(width)}  ${b.padStart(6)}  ${c.padStart(6)}  ${d.padStart(6)}  ${e}`;
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

  let treeFailed = false;
  if (configChanged) {
    const { headTotal, baseTotal } = await compareWholeTree(mergeBase, eslint);
    if (baseTotal !== null) {
      const delta = headTotal - baseTotal;
      treeFailed = delta > 0;
      console.log(
        `\nESLint config changed: whole tree base ${baseTotal} -> head ${headTotal} errors ` +
          `(${delta > 0 ? `+${delta}` : delta}) ${treeFailed ? "FAIL" : "ok"}`,
      );
      if (treeFailed) {
        console.log(`::error::The ESLint config change raises total lint errors (${baseTotal} -> ${headTotal}).`);
      }
    }
  }

  const ok = failed.length === 0 && !treeFailed;
  console.log(
    ok
      ? `\nOK: ${rows.length} changed file(s), no new lint errors.`
      : `\nFAILED: ${failed.length} of ${rows.length} changed file(s) gained lint errors` +
          (treeFailed ? "; whole-tree error total went up." : "."),
  );
  return ok ? 0 : 1;
}

process.exitCode = await main();
