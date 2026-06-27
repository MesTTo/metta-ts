// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Differential test: the trail-based unifier agrees with the reference immutable matcher (`matchAtoms`
// + `instantiate`) on success/failure and on the resolved form of a probe term, over random atom pairs.
import { describe, it, expect } from "vitest";
import { type Atom, sym, variable, expr, gint } from "./atom";
import { format } from "./parser";
import { matchAtoms } from "./match";
import { instantiate } from "./instantiate";
import { Trail, unifyTrail } from "./trail";

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 0x100000000);
}

// Random atom over a small vocabulary of symbols, ints, and a few variables, bounded depth.
function randAtom(rnd: () => number, depth: number, vars: string[]): Atom {
  const r = rnd();
  if (depth <= 0 || r < 0.5) {
    const k = rnd();
    if (k < 0.4) return sym(["a", "b", "c", "f", "g"][Math.floor(rnd() * 5)]!);
    if (k < 0.7) return gint(Math.floor(rnd() * 4));
    return variable(vars[Math.floor(rnd() * vars.length)]!);
  }
  const n = 1 + Math.floor(rnd() * 3);
  const head = sym(["f", "g", "h"][Math.floor(rnd() * 3)]!);
  return expr([head, ...Array.from({ length: n }, () => randAtom(rnd, depth - 1, vars))]);
}

// The reference: matchAtoms(l, r) is a single unifier (0 or 1 result for these inputs). It accepts cyclic
// bindings that the evaluator filters afterward via hasLoop, so a cyclic result counts as failure here —
// matching the trail unifier's early occurs-check (same outcome: no result). Resolve a probe otherwise.
function refResolve(l: Atom, r: Atom, probe: Atom): { ok: boolean; out?: string } {
  const bs = matchAtoms(l, r);
  if (bs.length === 0) return { ok: false };
  return { ok: true, out: format(instantiate(bs[0]!, probe)) };
}

describe("trail unifier matches the reference matcher", () => {
  it("agrees on success and resolved probe over random atom pairs", () => {
    const rnd = lcg(7);
    const vars = ["x", "y", "z"];
    let checked = 0;
    for (let i = 0; i < 4000; i++) {
      const l = randAtom(rnd, 3, vars);
      const r = randAtom(rnd, 3, vars);
      const probe = expr([sym("p"), variable("x"), variable("y"), variable("z")]);
      const ref = refResolve(l, r, probe);
      const tr = new Trail();
      const ok = unifyTrail(tr, l, r);
      expect(ok).toBe(ref.ok);
      if (ok && ref.ok) {
        expect(format(tr.resolve(probe))).toBe(ref.out);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100); // sanity: a healthy fraction unified
  });

  it("undo restores the trail so a branch leaves no trace", () => {
    const tr = new Trail();
    const m = tr.mark();
    expect(unifyTrail(tr, variable("x"), gint(5))).toBe(true);
    expect(format(tr.resolve(variable("x")))).toBe("5");
    tr.undo(m);
    expect(format(tr.resolve(variable("x")))).toBe("$x");
  });
});
