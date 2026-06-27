// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The grounding table: built-in operations dispatched by symbol name, a faithful port of
// LeaTTa `Core/Builtins.lean`. Each op takes already-evaluated argument atoms and returns a
// ReduceResult. Numbers track int vs float; arithmetic on two ints stays int.
import {
  type Atom,
  sym,
  gint,
  gfloat,
  gbool,
  gstr,
  emptyExpr,
  expr,
  atomEq,
  atomSize,
  atomVars,
  isErrorAtom,
} from "./atom";
import { variable } from "./atom";
import { alphaEq } from "./alpha";
import { applySubst, type Subst } from "./substitution";
import {
  type IntVal,
  addInt,
  subInt,
  mulInt,
  intDiv,
  intMod,
  intAbs,
  isZero,
  toF64,
} from "./number";
import { format, parseAll } from "./parser";
import { Tokenizer } from "./tokenizer";

// A standalone tokenizer for `parse`/`sread` (number/bool literals), built here to avoid importing the runner
// (which imports this module). Matches the runner's standardTokenizer.
let parseTokenizer: Tokenizer | undefined;
function makeTokenizer(): Tokenizer {
  if (parseTokenizer === undefined) {
    const t = new Tokenizer();
    t.register(/^-?\d+$/, (s) => gint(BigInt(s)));
    t.register(/^-?\d+\.\d+$/, (s) => gfloat(Number(s)));
    t.register(/^True$/, () => gbool(true));
    t.register(/^False$/, () => gbool(false));
    parseTokenizer = t;
  }
  return parseTokenizer;
}

export type ReduceResult =
  | { readonly tag: "ok"; readonly results: readonly Atom[] }
  | { readonly tag: "runtimeError"; readonly msg: string }
  | { readonly tag: "incorrectArgument"; readonly msg: string }
  | { readonly tag: "noReduce" };

export type GroundFn = (args: readonly Atom[]) => ReduceResult;
export type GroundingTable = Map<string, GroundFn>;

// Monotonic counter for `sealed`'s fresh variable names (process-wide uniqueness, like Hyperon's make_unique).
let sealCounter = 0;
const ok = (...results: Atom[]): ReduceResult => ({ tag: "ok", results });
const rerr = (msg: string): ReduceResult => ({ tag: "runtimeError", msg });
const ierr = (msg: string): ReduceResult => ({ tag: "incorrectArgument", msg });

// Line sink for println!/trace!: console.log is the natural equivalent (it appends the newline).
// Overridable so embedders and tests can capture output instead of writing to the console.
let outputSink: (line: string) => void = (line) => {
  console.log(line);
};
/** Replace the line-output sink used by `println!`/`trace!` (returns the previous sink). */
export function setOutputSink(fn: (line: string) => void): (line: string) => void {
  const prev = outputSink;
  outputSink = fn;
  return prev;
}

// Raw sink for print!, which (per Hyperon) writes WITHOUT a trailing newline. In Node that is
// process.stdout.write; the browser has no partial-line console, so it falls back to console.log (one line).
let rawSink: (text: string) => void =
  typeof process !== "undefined" && process.stdout && typeof process.stdout.write === "function"
    ? (text) => void process.stdout.write(text)
    : (text) => console.log(text);
/** Replace the raw (no-newline) sink used by `print!` (returns the previous sink). */
export function setRawSink(fn: (text: string) => void): (text: string) => void {
  const prev = rawSink;
  rawSink = fn;
  return prev;
}

/** Display form of an atom for printing: a top-level string shows unquoted; everything else uses the
 *  standard MeTTa rendering. */
function display(a: Atom): string {
  if (a.kind === "gnd" && a.value.g === "str") return a.value.s;
  return format(a);
}

// --- numeric coercions ---
/** The integer value of an atom (number|bigint), or undefined if not an Int. */
function asIntVal(a: Atom): IntVal | undefined {
  return a.kind === "gnd" && a.value.g === "int" ? a.value.n : undefined;
}
function asBool(a: Atom): boolean | undefined {
  if (a.kind === "gnd" && a.value.g === "bool") return a.value.b;
  return undefined;
}
function asStr(a: Atom): string | undefined {
  return a.kind === "gnd" && a.value.g === "str" ? a.value.s : undefined;
}
/** The f64 value of an Int or Float atom (Int is coerced, with the usual precision caveat). */
function asFloat(a: Atom): number | undefined {
  if (a.kind !== "gnd") return undefined;
  const v = a.value;
  if (v.g === "int") return toF64(v.n);
  if (v.g === "float") return v.n;
  return undefined;
}

/** Binary arithmetic: two Ints use exact integer math (bigint on overflow); a Float on either side
 *  promotes both to f64. Mirrors Hyperon's int-stays-int, int+float->float rule. */
function arithBin(
  intF: (x: IntVal, y: IntVal) => IntVal,
  floatF: (x: number, y: number) => number,
): GroundFn {
  return (args) => {
    if (args.length !== 2) return ierr("expected exactly two arguments");
    const ax = asIntVal(args[0]!);
    const ay = asIntVal(args[1]!);
    if (ax !== undefined && ay !== undefined) return ok(gint(intF(ax, ay)));
    const fx = asFloat(args[0]!);
    const fy = asFloat(args[1]!);
    if (fx === undefined || fy === undefined) return ierr("expected two Numbers");
    return ok(gfloat(floatF(fx, fy)));
  };
}

/** Three-way compare: exact for two Ints (promoting to bigint as needed), f64 otherwise. */
function compareNumbers(a: Atom, b: Atom): number | undefined {
  const ai = asIntVal(a);
  const bi = asIntVal(b);
  if (ai !== undefined && bi !== undefined) {
    if (typeof ai === "bigint" || typeof bi === "bigint") {
      const x = BigInt(ai);
      const y = BigInt(bi);
      return x < y ? -1 : x > y ? 1 : 0;
    }
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  }
  const af = asFloat(a);
  const bf = asFloat(b);
  if (af === undefined || bf === undefined) return undefined;
  return af < bf ? -1 : af > bf ? 1 : 0;
}
function numCmp(f: (c: number) => boolean): GroundFn {
  return (args) => {
    if (args.length !== 2) return ierr("expected exactly two arguments");
    const c = compareNumbers(args[0]!, args[1]!);
    if (c === undefined) return ierr("expected two Numbers");
    return ok(gbool(f(c)));
  };
}
function boolBin(f: (x: boolean, y: boolean) => boolean): GroundFn {
  return (args) => {
    if (args.length !== 2) return ierr("expected exactly two arguments");
    const x = asBool(args[0]!);
    const y = asBool(args[1]!);
    if (x === undefined || y === undefined) return ierr("expected two Bool atoms");
    return ok(gbool(f(x, y)));
  };
}

// `==`: error operands pass through; otherwise structural equality as a Bool.
const eqAtom: GroundFn = (args) => {
  if (args.length !== 2) return ierr("expected exactly two arguments");
  const a = args[0]!;
  const b = args[1]!;
  if (isErrorAtom(a)) return ok(a);
  if (isErrorAtom(b)) return ok(b);
  return ok(gbool(atomEq(a, b)));
};

// --- list surgery ---
const consAtom: GroundFn = (args) => {
  if (args.length !== 2) return ierr("expected head and tail");
  const [h, t] = args as [Atom, Atom];
  if (t.kind !== "expr") return ierr("cons-atom: expected an expression tail");
  return ok(expr([h, ...t.items]));
};
const deconsAtom: GroundFn = (args) => {
  if (args.length !== 1) return ierr("expected non-empty expression");
  const e = args[0]!;
  if (e.kind !== "expr") return ierr("expected non-empty expression");
  if (e.items.length === 0) return ok(emptyExpr);
  const [h, ...t] = e.items;
  return ok(expr([h!, expr(t)]));
};
const carAtom: GroundFn = (args) => {
  const e = args[0];
  if (args.length !== 1 || e?.kind !== "expr" || e.items.length === 0)
    return ierr("expected non-empty expression");
  return ok(e.items[0]!);
};
const cdrAtom: GroundFn = (args) => {
  const e = args[0];
  if (args.length !== 1 || e?.kind !== "expr" || e.items.length === 0)
    return ierr("expected non-empty expression");
  return ok(expr(e.items.slice(1)));
};
const sizeAtom: GroundFn = (args) => {
  if (args.length !== 1) return ierr("expected one atom");
  const a = args[0]!;
  return ok(gint(a.kind === "expr" ? a.items.length : atomSize(a)));
};
const minMaxAtom =
  (isMin: boolean, name: string): GroundFn =>
  (args) => {
    const e = args[0];
    if (args.length !== 1 || e?.kind !== "expr")
      return ierr(name + " expects one argument: expression");
    const nums: number[] = [];
    for (const c of e.items) {
      const f = asFloat(c);
      if (f === undefined) return rerr("Only numbers are allowed in expression");
      nums.push(f);
    }
    if (nums.length === 0) return rerr("Empty expression");
    let acc = nums[0]!;
    for (const z of nums.slice(1)) acc = isMin ? (z < acc ? z : acc) : z > acc ? z : acc;
    return ok(gfloat(acc));
  };
const indexAtom: GroundFn = (args) => {
  const e = args[0];
  if (args.length !== 2 || e?.kind !== "expr")
    return ierr("index-atom expects two arguments: expression and atom");
  const iv = asIntVal(args[1]!);
  if (iv === undefined) return ierr("index-atom expects two arguments: expression and atom");
  const i = Number(iv);
  if (i < 0 || i >= e.items.length) return rerr("Index is out of bounds");
  return ok(e.items[i]!);
};

// --- f64 math ---
const floatUn =
  (ff: (x: number) => number): GroundFn =>
  (args) => {
    if (args.length !== 1) return ierr("expected exactly one argument");
    const x = asFloat(args[0]!);
    return x === undefined ? ierr("expected a Number") : ok(gfloat(ff(x)));
  };
const floatBin =
  (ff: (x: number, y: number) => number): GroundFn =>
  (args) => {
    if (args.length !== 2) return ierr("expected exactly two arguments");
    const x = asFloat(args[0]!);
    const y = asFloat(args[1]!);
    return x === undefined || y === undefined ? ierr("expected two Numbers") : ok(gfloat(ff(x, y)));
  };
const numRound =
  (fi: (n: IntVal) => IntVal, ff: (x: number) => number): GroundFn =>
  (args) => {
    if (args.length !== 1) return ierr("expected exactly one argument");
    const a = args[0]!;
    if (a.kind === "gnd" && a.value.g === "int") return ok(gint(fi(a.value.n)));
    if (a.kind === "gnd" && a.value.g === "float") return ok(gfloat(ff(a.value.n)));
    return ierr("expected a Number");
  };
const floatPred =
  (fb: (x: number) => boolean): GroundFn =>
  (args) => {
    if (args.length !== 1) return ierr("expected exactly one argument");
    const a = args[0]!;
    if (a.kind === "gnd" && a.value.g === "int") return ok(gbool(false));
    if (a.kind === "gnd" && a.value.g === "float") return ok(gbool(fb(a.value.n)));
    return ierr("expected a Number");
  };

const mathEntries: Array<[string, GroundFn]> = [
  ["sqrt-math", floatUn(Math.sqrt)],
  ["sin-math", floatUn(Math.sin)],
  ["cos-math", floatUn(Math.cos)],
  ["tan-math", floatUn(Math.tan)],
  ["asin-math", floatUn(Math.asin)],
  ["acos-math", floatUn(Math.acos)],
  ["atan-math", floatUn(Math.atan)],
  ["pow-math", floatBin(Math.pow)],
  ["log-math", floatBin((base, input) => Math.log(input) / Math.log(base))],
  ["abs-math", numRound(intAbs, Math.abs)],
  ["trunc-math", numRound((n) => n, Math.trunc)],
  ["ceil-math", numRound((n) => n, Math.ceil)],
  ["floor-math", numRound((n) => n, Math.floor)],
  ["round-math", numRound((n) => n, Math.round)],
  ["isnan-math", floatPred(Number.isNaN)],
  ["isinf-math", floatPred((x) => !Number.isFinite(x) && !Number.isNaN(x))],
];

const coreEntries: Array<[string, GroundFn]> = [
  ["+", arithBin(addInt, (a, b) => a + b)],
  ["-", arithBin(subInt, (a, b) => a - b)],
  ["*", arithBin(mulInt, (a, b) => a * b)],
  ["<", numCmp((c) => c < 0)],
  ["<=", numCmp((c) => c <= 0)],
  [">", numCmp((c) => c > 0)],
  [">=", numCmp((c) => c >= 0)],
  ["==", eqAtom],
  ["and", boolBin((a, b) => a && b)],
  ["or", boolBin((a, b) => a || b)],
  ["cons-atom", consAtom],
  ["decons-atom", deconsAtom],
  ["car-atom", carAtom],
  ["cdr-atom", cdrAtom],
  ["size-atom", sizeAtom],
  ["min-atom", minMaxAtom(true, "min-atom")],
  ["max-atom", minMaxAtom(false, "max-atom")],
  ["index-atom", indexAtom],
];

// --- stdlib grounded ops (LeaTTa Stdlib.lean stdGroundings) ---
const removeFirst = (a: Atom, xs: readonly Atom[]): Atom[] => {
  const i = xs.findIndex((x) => atomEq(x, a));
  return i < 0 ? [...xs] : [...xs.slice(0, i), ...xs.slice(i + 1)];
};
const dedupAlpha = (xs: readonly Atom[]): Atom[] => {
  const out: Atom[] = [];
  for (const x of xs) if (!out.some((s) => alphaEq(s, x))) out.push(x);
  return out;
};
const msIntersect = (lhs: readonly Atom[], rhs: readonly Atom[]): Atom[] => {
  let pool = [...rhs];
  const out: Atom[] = [];
  for (const x of lhs)
    if (pool.some((y) => atomEq(y, x))) {
      out.push(x);
      pool = removeFirst(x, pool);
    }
  return out;
};
const msSubtract = (lhs: readonly Atom[], rhs: readonly Atom[]): Atom[] => {
  let pool = [...rhs];
  const out: Atom[] = [];
  for (const x of lhs) {
    if (pool.some((y) => atomEq(y, x))) pool = removeFirst(x, pool);
    else out.push(x);
  }
  return out;
};
const resultItems = (xs: readonly Atom[]): Atom[] =>
  xs.length > 0 && xs[0]!.kind === "sym" && xs[0]!.name === "," ? xs.slice(1) : [...xs];
const removeFirstBy = (
  eq: (a: Atom, b: Atom) => boolean,
  a: Atom,
  xs: readonly Atom[],
): Atom[] | undefined => {
  const i = xs.findIndex((x) => eq(a, x));
  return i < 0 ? undefined : [...xs.slice(0, i), ...xs.slice(i + 1)];
};
const bagEqBy = (
  eq: (a: Atom, b: Atom) => boolean,
  as: readonly Atom[],
  bs: readonly Atom[],
): boolean => {
  let pool: Atom[] = [...bs];
  for (const a of as) {
    const r = removeFirstBy(eq, a, pool);
    if (r === undefined) return false;
    pool = r;
  }
  return pool.length === 0;
};
const exprArgs = (args: readonly Atom[]): Atom[][] | undefined => {
  const out: Atom[][] = [];
  for (const a of args) {
    if (a.kind !== "expr") return undefined;
    out.push([...a.items]);
  }
  return out;
};

const getMetatypeOp: GroundFn = (args) => {
  const a = args[0];
  if (args.length !== 1 || a === undefined) return ierr("get-metatype expects 1 argument");
  const k =
    a.kind === "sym"
      ? "Symbol"
      : a.kind === "var"
        ? "Variable"
        : a.kind === "expr"
          ? "Expression"
          : "Grounded";
  return ok(sym(k));
};
const assertEqOp =
  (eq: (a: Atom, b: Atom) => boolean): GroundFn =>
  (args) => {
    if (args.length !== 3 && args.length !== 4) return ierr("_assert-results-are-equal arity");
    const a0 = args[0];
    const e0 = args[1];
    if (a0?.kind !== "expr" || e0?.kind !== "expr") return ierr("expected two expressions");
    const okEq = bagEqBy(eq, resultItems(a0.items), resultItems(e0.items));
    if (okEq) return ok(emptyExpr);
    const msg = args.length === 4 ? args[3]! : sym("results-are-not-equal");
    return ok(expr([sym("Error"), args[2]!, msg]));
  };
// Printed-form (lexicographic) order, used by sort-strings (where alphabetical-by-text IS the spec) and
// sort-atom (which shares it). This is deliberately NOT msort/sort's structural `atomCmp` order: the two
// op families sort by different keys and the corpus relies on each, so they are kept distinct on purpose.
const sortByFormat = (xs: readonly Atom[]): Atom[] =>
  [...xs].sort((a, b) => (format(a) < format(b) ? -1 : format(a) > format(b) ? 1 : 0));

const stdEntries: Array<[string, GroundFn]> = [
  [
    "println!",
    (args) => {
      if (args.length !== 1) return ierr("println! expects 1 argument");
      outputSink(display(args[0]!));
      return ok(emptyExpr);
    },
  ],
  [
    // print! writes without a trailing newline (Hyperon semantics), via the raw sink, unlike println!.
    "print!",
    (args) => {
      if (args.length !== 1) return ierr("print! expects 1 argument");
      rawSink(display(args[0]!));
      return ok(emptyExpr);
    },
  ],
  [
    "format-args",
    (args) => {
      if (args.length !== 2) return ierr("format-args expects 2 arguments");
      const tmpl = args[0]!;
      const items = args[1]!;
      if (tmpl.kind !== "gnd" || tmpl.value.g !== "str")
        return ierr("format-args: first argument must be a String");
      if (items.kind !== "expr") return ierr("format-args: second argument must be an Expression");
      let i = 0;
      const out = tmpl.value.s.replace(/\{\}/g, () => {
        const it = items.items[i++];
        return it === undefined ? "{}" : display(it);
      });
      return ok(gstr(out));
    },
  ],
  [
    "repr",
    (args) => (args.length === 1 ? ok(gstr(format(args[0]!))) : ierr("repr expects 1 argument")),
  ],
  [
    "if-equal",
    (args) =>
      args.length === 4
        ? ok(alphaEq(args[0]!, args[1]!) ? args[2]! : args[3]!)
        : ierr("if-equal expects 4 arguments"),
  ],
  [
    "=alpha",
    (args) =>
      args.length === 2
        ? ok(gbool(alphaEq(args[0]!, args[1]!)))
        : ierr("=alpha expects 2 arguments"),
  ],
  ["get-metatype", getMetatypeOp],
  [
    "not",
    (args) => {
      const b = asBool(args[0]!);
      return args.length === 1 && b !== undefined ? ok(gbool(!b)) : ierr("not expects one Bool");
    },
  ],
  [
    "xor",
    (args) => {
      const x = asBool(args[0]!);
      const y = asBool(args[1]!);
      return args.length === 2 && x !== undefined && y !== undefined
        ? ok(gbool(x !== y))
        : ierr("xor expects two Bool");
    },
  ],
  [
    "/",
    (args) => {
      if (args.length === 2) {
        const a = asIntVal(args[0]!);
        const b = asIntVal(args[1]!);
        if (a !== undefined && b !== undefined)
          return isZero(b) ? rerr("DivisionByZero") : ok(gint(intDiv(a, b)));
      }
      return arithBin(intDiv, (x, y) => x / y)(args);
    },
  ],
  [
    "%",
    (args) => {
      const a = asIntVal(args[0]!);
      const b = asIntVal(args[1]!);
      if (args.length === 2 && a !== undefined && b !== undefined)
        return isZero(b) ? rerr("DivisionByZero") : ok(gint(intMod(a, b)));
      return ierr("% expects two Int atoms");
    },
  ],
  [
    "unique-atom",
    (args) => {
      const e = exprArgs(args);
      return e && e.length === 1
        ? ok(expr(dedupAlpha(e[0]!)))
        : ierr("unique-atom expects one expression");
    },
  ],
  [
    "union-atom",
    (args) => {
      const e = exprArgs(args);
      return e && e.length === 2
        ? ok(expr([...e[0]!, ...e[1]!]))
        : ierr("union-atom expects two expressions");
    },
  ],
  [
    "intersection-atom",
    (args) => {
      const e = exprArgs(args);
      return e && e.length === 2
        ? ok(expr(msIntersect(e[0]!, e[1]!)))
        : ierr("intersection-atom expects two expressions");
    },
  ],
  [
    "subtraction-atom",
    (args) => {
      const e = exprArgs(args);
      return e && e.length === 2
        ? ok(expr(msSubtract(e[0]!, e[1]!)))
        : ierr("subtraction-atom expects two expressions");
    },
  ],
  [
    "superpose",
    (args) => {
      const e = exprArgs(args);
      return e && e.length === 1
        ? ok(...resultItems(e[0]!))
        : ierr("superpose expects one expression");
    },
  ],
  [
    "hyperpose",
    (args) => {
      const e = exprArgs(args);
      return e && e.length === 1
        ? ok(...resultItems(e[0]!))
        : ierr("hyperpose expects one expression");
    },
  ],
  [
    "collapse-extract",
    (args) => {
      const e = exprArgs(args);
      if (!e || e.length !== 1) return ierr("collapse-extract expects one expression");
      // collapse returns a bare tuple of the results: `(r1 r2 ...)`, `()` when empty, matching Hyperon
      // (hyperon-experimental b4_nondeterm: `(collapse (shape))` is `((shape))`). Each collapse-bind entry
      // is a `(atom bindings)` pair; take the atom.
      return ok(
        expr(e[0]!.map((p) => (p.kind === "expr" && p.items.length > 0 ? p.items[0]! : p))),
      );
    },
  ],
  [
    "sealed",
    // Alpha-rename every variable in the atom (second argument) to a fresh, unique variable, except those in
    // the ignore list (first argument). The operation is Hyperon's `sealed`; it gives a higher-order template
    // (map-atom/filter-atom's body, an applied lambda) a private copy of its variables each time, so repeated
    // applications do not capture one another. (Previously a no-op, which silently broke that hygiene.)
    (args) => {
      if (args.length !== 2) return ierr("sealed expects (sealed <vars> <atom>)");
      const ignore = new Set(
        (args[0]!.kind === "expr" ? args[0]!.items : []).flatMap((v) =>
          v.kind === "var" ? [v.name] : [],
        ),
      );
      const fresh = atomVars(args[1]!).filter((v) => !ignore.has(v));
      if (fresh.length === 0) return ok(args[1]!);
      const sub: Subst = fresh.map((v) => [v, variable(v + "#" + String(sealCounter++))]);
      return ok(applySubst(sub, args[1]!));
    },
  ],
  ["nop", () => ok(emptyExpr)],
  // `pragma!` is handled as a stateful embedded op in eval.ts (it writes interpreter settings), not here.
  ["register-module!", () => ok(emptyExpr)],
  ["help!", () => ok(emptyExpr)],
  ["empty", () => ok()],
  [
    // `(test actual expected)` checks alpha-equivalence (exactly, no convention-forgiving), prints
    // "is X, should Y. ✅/❌", and reduces to `()` on pass. The MeTTa-TS corpus is written in MeTTa-TS
    // conventions, so this stays strict. MeTTa-TS is not bent to match PeTTa's rendering.
    "test",
    (args) => {
      if (args.length !== 2) return ierr("test expects 2 arguments");
      const passed = alphaEq(args[0]!, args[1]!);
      outputSink(`is ${format(args[0]!)}, should ${format(args[1]!)}. ${passed ? "✅" : "❌"}`);
      return passed
        ? ok(emptyExpr)
        : ok(expr([sym("Error"), expr([sym("test"), args[0]!, args[1]!]), sym("test-failed")]));
    },
  ],
  ["_assert-results-are-equal", assertEqOp(atomEq)],
  ["_assert-results-are-equal-msg", assertEqOp(atomEq)],
  ["_assert-results-are-alpha-equal", assertEqOp(alphaEq)],
  ["_assert-results-are-alpha-equal-msg", assertEqOp(alphaEq)],
  [
    "sort-atom",
    (args) => {
      const e = exprArgs(args);
      return e && e.length === 1
        ? ok(expr(sortByFormat(e[0]!)))
        : ierr("sort-atom expects one expression");
    },
  ],
  [
    "sort-strings",
    (args) => {
      const e = exprArgs(args);
      return e && e.length === 1
        ? ok(expr(sortByFormat(e[0]!)))
        : ierr("sort-strings expects one expression");
    },
  ],
];

// --- PeTTa-compat stdlib ---------------------------------------------------------------------------------
// Functions PeTTa auto-loads from `src/metta.pl` that Hyperon (and so MeTTa-TS) does not define, ported as
// grounded ops so the PeTTa example corpus runs against the same engine. Only NEW names are added; where a
// name already exists with Hyperon semantics (foldl-atom/map-atom/filter-atom are the Hyperon higher-order
// forms, repr/size-atom/index-atom/the *-atom set are already present) the existing op wins, so the Hyperon
// oracle is untouched. Semantics follow metta.pl exactly.
const exprItems = (a: Atom | undefined): readonly Atom[] | undefined =>
  a?.kind === "expr" ? a.items : undefined;
// Standard term order for sort/msort: numbers before symbols before strings before expressions; numbers by
// value, the rest by printed form (a practical stand-in for Prolog's standard order of terms).
const numVal = (a: Atom): number | undefined =>
  a.kind === "gnd" && (a.value.g === "int" || a.value.g === "float")
    ? Number(a.value.n)
    : undefined;
const termRank = (a: Atom): number =>
  numVal(a) !== undefined
    ? 0
    : a.kind === "var"
      ? 1
      : a.kind === "sym"
        ? 2
        : a.kind === "gnd"
          ? 3
          : 4;
// Total order on atoms: numbers first (by value), then variables, symbols, non-number grounded, and
// expressions, ranked by kind. Within the same rank, expressions compare STRUCTURALLY: shorter (lower
// arity) first, then element-wise rather than by their printed form, so e.g. `(wu (wu))` precedes
// `(wu (wu 42))` (a string compare would order them by the accident that a space sorts before `)`).
const atomCmp = (a: Atom, b: Atom): number => {
  const ra = termRank(a);
  const rb = termRank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return numVal(a)! - numVal(b)!;
  if (a.kind === "expr" && b.kind === "expr") {
    if (a.items.length !== b.items.length) return a.items.length - b.items.length;
    for (let i = 0; i < a.items.length; i++) {
      const c = atomCmp(a.items[i]!, b.items[i]!);
      if (c !== 0) return c;
    }
    return 0;
  }
  const fa = format(a);
  const fb = format(b);
  return fa < fb ? -1 : fa > fb ? 1 : 0;
};
const sortStd = (xs: readonly Atom[]): Atom[] => [...xs].sort(atomCmp);
const dedup = (xs: readonly Atom[]): Atom[] => {
  const out: Atom[] = [];
  for (const x of xs) if (!out.some((y) => atomEq(y, x))) out.push(x);
  return out;
};
const metatypeOf = (a: Atom): string =>
  a.kind === "var"
    ? "Variable"
    : a.kind === "gnd"
      ? "Grounded"
      : a.kind === "expr"
        ? "Expression"
        : "Symbol";
const oneExpr = (name: string, args: readonly Atom[], f: (it: readonly Atom[]) => ReduceResult) => {
  const it = exprItems(args[0]);
  return args.length === 1 && it ? f(it) : ierr(`${name} expects one expression`);
};
const pettaEntries: Array<[string, GroundFn]> = [
  ["length", (a) => oneExpr("length", a, (it) => ok(gint(it.length)))],
  ["first", (a) => oneExpr("first", a, (it) => (it.length ? ok(it[0]!) : ierr("first: empty")))],
  [
    "last",
    (a) => oneExpr("last", a, (it) => (it.length ? ok(it[it.length - 1]!) : ierr("last: empty"))),
  ],
  ["reverse", (a) => oneExpr("reverse", a, (it) => ok(expr([...it].reverse())))],
  ["msort", (a) => oneExpr("msort", a, (it) => ok(expr(sortStd(it))))],
  ["sort", (a) => oneExpr("sort", a, (it) => ok(expr(dedup(sortStd(it)))))],
  ["list_to_set", (a) => oneExpr("list_to_set", a, (it) => ok(expr(dedup(it))))],
  // PeTTa metta.pl: dedupe a tuple modulo alpha-equivalence (two atoms equal up to a consistent
  // renaming of variables count as one). Hyperon has no such op; this is the alpha-aware sibling of
  // unique-atom, used by lib functions that work over patterns with variables.
  ["alpha-unique-atom", (a) => oneExpr("alpha-unique-atom", a, (it) => ok(expr(dedupAlpha(it))))],
  [
    "second-from-pair",
    (a) =>
      oneExpr("second-from-pair", a, (it) => (it.length >= 2 ? ok(it[1]!) : ierr("not a pair"))),
  ],
  [
    "append",
    (a) => {
      const x = exprItems(a[0]);
      const y = exprItems(a[1]);
      return a.length === 2 && x && y
        ? ok(expr([...x, ...y]))
        : ierr("append expects two expressions");
    },
  ],
  [
    "is-var",
    (a) => (a.length === 1 ? ok(gbool(a[0]!.kind === "var")) : ierr("is-var expects one atom")),
  ],
  [
    "is-ground",
    (a) =>
      a.length === 1 ? ok(gbool(atomVars(a[0]!).length === 0)) : ierr("is-ground expects one atom"),
  ],
  [
    "is-expr",
    (a) => (a.length === 1 ? ok(gbool(a[0]!.kind === "expr")) : ierr("is-expr expects one atom")),
  ],
  [
    "is-space",
    (a) =>
      a.length === 1
        ? ok(gbool(a[0]!.kind === "sym" && (a[0] as { name: string }).name.startsWith("&")))
        : ierr("is-space expects one atom"),
  ],
  [
    "get-mettatype",
    (a) => (a.length === 1 ? ok(sym(metatypeOf(a[0]!))) : ierr("get-mettatype expects one atom")),
  ],
  // Membership: `is-member`/`is-alpha-member` give a Bool; bare `member` succeeds (True) or yields nothing,
  // as in metta.pl's `member(X,L,true) :- member(X,L)`.
  [
    "is-member",
    (a) => {
      const l = exprItems(a[1]);
      return a.length === 2 && l
        ? ok(gbool(l.some((x) => atomEq(x, a[0]!))))
        : ierr("is-member expects (x expr)");
    },
  ],
  [
    "is-alpha-member",
    (a) => {
      const l = exprItems(a[1]);
      return a.length === 2 && l
        ? ok(gbool(l.some((x) => alphaEq(x, a[0]!))))
        : ierr("is-alpha-member expects (x expr)");
    },
  ],
  [
    "member",
    (a) => {
      const l = exprItems(a[1]);
      if (!(a.length === 2 && l)) return ierr("member expects (x expr)");
      return l.some((x) => atomEq(x, a[0]!)) ? ok(gbool(true)) : ok();
    },
  ],
  [
    "exclude-item",
    (a) => {
      const l = exprItems(a[1]);
      return a.length === 2 && l
        ? ok(expr(l.filter((x) => !atomEq(x, a[0]!))))
        : ierr("exclude-item expects (item expr)");
    },
  ],
  // numeric min/max of two numbers (Hyperon has only the list min-atom/max-atom). Int vs float preserved.
  [
    "min",
    (a) => {
      const x = asFloat(a[0]!);
      const y = asFloat(a[1]!);
      return a.length === 2 && x !== undefined && y !== undefined
        ? ok(x <= y ? a[0]! : a[1]!)
        : ierr("min expects two Numbers");
    },
  ],
  [
    "max",
    (a) => {
      const x = asFloat(a[0]!);
      const y = asFloat(a[1]!);
      return a.length === 2 && x !== undefined && y !== undefined
        ? ok(x >= y ? a[0]! : a[1]!)
        : ierr("max expects two Numbers");
    },
  ],
  // bare math names PeTTa registers alongside the *-math forms. log is (base value).
  ["sqrt", floatUn(Math.sqrt)],
  ["sin", floatUn(Math.sin)],
  ["cos", floatUn(Math.cos)],
  ["exp", floatUn(Math.exp)],
  ["log", floatBin((b, x) => Math.log(x) / Math.log(b))],
  // implies a b == (not a) or b
  [
    "implies",
    (a) => {
      const x = asBool(a[0]!);
      const y = asBool(a[1]!);
      return a.length === 2 && x !== undefined && y !== undefined
        ? ok(gbool(!x || y))
        : ierr("implies expects two Bools");
    },
  ],
  // string / atom construction
  [
    "concat",
    (a) => {
      const parts = a.map((x) => asStr(x) ?? format(x));
      return ok(gstr(parts.join("")));
    },
  ],
  [
    "atom_concat",
    (a) => ok(sym(a.map((x) => (x.kind === "sym" ? x.name : (asStr(x) ?? format(x)))).join(""))),
  ],
  // parse a string of MeTTa source into its (first) atom; sread is PeTTa's alias.
  [
    "parse",
    (a) => {
      const s = asStr(a[0]!);
      if (a.length !== 1 || s === undefined) return ierr("parse expects a String");
      const tops = parseAll(s, makeTokenizer());
      return tops.length > 0 ? ok(tops[0]!.atom) : ok(emptyExpr);
    },
  ],
  [
    "sread",
    (a) => {
      const s = asStr(a[0]!);
      if (a.length !== 1 || s === undefined) return ierr("sread expects a String");
      const tops = parseAll(s, makeTokenizer());
      return tops.length > 0 ? ok(tops[0]!.atom) : ok(emptyExpr);
    },
  ],
  // Effectful PeTTa ops: a random integer in [lo, hi), a random float in [lo, hi), and the wall-clock time.
  [
    "random-int",
    (a) => {
      const lo = asIntVal(a[0]!);
      const hi = asIntVal(a[1]!);
      if (a.length !== 2 || lo === undefined || hi === undefined)
        return ierr("random-int expects two Ints");
      const l = Number(lo);
      const h = Number(hi);
      return ok(gint(BigInt(l + Math.floor(Math.random() * Math.max(0, h - l)))));
    },
  ],
  [
    "random-float",
    (a) => {
      const lo = asFloat(a[0]!);
      const hi = asFloat(a[1]!);
      return a.length === 2 && lo !== undefined && hi !== undefined
        ? ok(gfloat(lo + Math.random() * (hi - lo)))
        : ierr("random-float expects two Numbers");
    },
  ],
  ["current-time", () => ok(gfloat(Date.now() / 1000))],
];

/** Names of the PeTTa-compat grounded ops. They yield to user `=` rules (PeTTa is rules-first, builtins as
 *  fallback), so a program that defines its own e.g. `sort`/`length` is not shadowed by the stdlib one. */
export const pettaOpNames: ReadonlySet<string> = new Set(pettaEntries.map(([n]) => n));

/** The arithmetic / boolean / list-surgery / math grounding core every KB starts with. */
export function baseTable(): GroundingTable {
  return new Map<string, GroundFn>([...mathEntries, ...coreEntries]);
}

/** The full standard-library grounding table (base + stdlib grounded ops + PeTTa-compat). Later entries do
 *  not override earlier ones (Map keeps the first), so Hyperon ops win any name shared with PeTTa-compat. */
export function stdTable(): GroundingTable {
  const t = new Map<string, GroundFn>([...mathEntries, ...coreEntries, ...stdEntries]);
  for (const [name, fn] of pettaEntries) if (!t.has(name)) t.set(name, fn);
  return t;
}

/** Dispatch `op` through the grounding table, or `noReduce` if unknown. */
export function callGrounded(gt: GroundingTable, op: string, args: readonly Atom[]): ReduceResult {
  const fn = gt.get(op);
  return fn ? fn(args) : { tag: "noReduce" };
}
