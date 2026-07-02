// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Isolated wall-clock benchmark for the MeTTa-TS slow corpus cases.
//
// Usage:
//   node packages/node/bench/slow-cases.mjs [--runs=3] [--timeout=120] [--max-steps=100000000]
//   node packages/node/bench/slow-cases.mjs --filter=peano
//   node packages/node/bench/slow-cases.mjs --hash-cons

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const flag = (name) => process.argv.includes(`--${name}`);

const CLI = resolve(here, "../dist/cli.js");
const CORPUS = resolve(here, "corpus-mettats");
const RUNS = Math.max(3, Number(arg("runs", "3")));
const TIMEOUT_MS = Number(arg("timeout", "120")) * 1000;
const MAX_STEPS = arg("max-steps", "100000000");
const FILTER = arg("filter", "");
const HASH_CONS =
  flag("hash-cons") || process.env.METTA_TS_HASHCONS === "1" || process.env.METTA_TS_HASHCONS === "true";

const groups = [
  ["primary", ["nilbc.metta", "permutations.metta", "peano.metta"]],
  ["symbolic-search", ["matespace.metta", "tilepuzzle.metta"]],
];

for (const [label, path] of [
  ["MeTTa-TS CLI", CLI],
  ...groups.flatMap(([, files]) => files.map((f) => [f, join(CORPUS, f)])),
]) {
  if (!existsSync(path)) {
    console.error(`Missing ${label}: ${path}`);
    if (path === CLI) console.error("  build first: pnpm -r build");
    process.exit(2);
  }
}

function classify(res) {
  const output = (res.stdout ?? "") + (res.stderr ?? "");
  const timedOut = res.signal === "SIGTERM" || res.error?.code === "ETIMEDOUT";
  if (timedOut) return { status: "timeout", detail: `timeout after ${TIMEOUT_MS / 1000}s` };
  if (res.error !== undefined) return { status: "error", detail: String(res.error) };
  if (res.status !== 0) return { status: "error", detail: `exit ${res.status}: ${output.trim()}` };
  const checks = (output.match(/✅/g) ?? []).length;
  const fails = (output.match(/❌/g) ?? []).length;
  if (fails > 0) return { status: "fail", detail: `${fails} failed checks` };
  if (checks > 0) return { status: "pass", detail: `${checks} checks` };
  return { status: "ran", detail: "no embedded checks" };
}

function timeOne(file) {
  const t0 = performance.now();
  const res = spawnSync(
    process.execPath,
    [
      "--stack-size=8000",
      CLI,
      `--max-steps=${MAX_STEPS}`,
      ...(HASH_CONS ? ["--hash-cons"] : []),
      join(CORPUS, file),
    ],
    {
      timeout: TIMEOUT_MS,
      encoding: "utf8",
      maxBuffer: 1 << 27,
      env: { ...process.env, METTA_TS_STACK: "1" },
    },
  );
  const ms = performance.now() - t0;
  return { ...classify(res), ms };
}

const median = (xs) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

console.log(`MeTTa-TS slow corpus benchmark`);
console.log(`  cli=${CLI}`);
console.log(
  `  runs=${RUNS} timeout=${TIMEOUT_MS / 1000}s max-steps=${MAX_STEPS} hash-cons=${HASH_CONS}`,
);
if (FILTER) console.log(`  filter=${FILTER}`);
console.log("");

console.log(pad("group", 16), pad("program", 18), padL("median ms", 10), padL("runs ms", 28), " status");
console.log("-".repeat(86));

for (const [group, files] of groups) {
  for (const file of files) {
    const name = basename(file, ".metta");
    if (FILTER && !name.includes(FILTER)) continue;
    const runs = [];
    const statuses = [];
    for (let i = 0; i < RUNS; i++) {
      const r = timeOne(file);
      statuses.push(r);
      if (r.status === "pass" || r.status === "ran") runs.push(r.ms);
      if (r.status === "timeout" || r.status === "error") break;
    }
    const med = runs.length === RUNS ? median(runs) : null;
    const status = statuses.map((r) => r.status).join(",");
    const detail = statuses.find((r) => r.status !== "pass" && r.status !== "ran")?.detail ?? "";
    console.log(
      pad(group, 16),
      pad(name, 18),
      padL(med === null ? "-" : med.toFixed(1), 10),
      padL(runs.map((x) => x.toFixed(1)).join(", "), 28),
      ` ${status}${detail ? ` (${detail})` : ""}`,
    );
  }
}
