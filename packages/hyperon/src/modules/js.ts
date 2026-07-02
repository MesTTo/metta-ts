// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

/**
 * JavaScript interop, the TypeScript analogue of Hyperon's Python interop (py-atom/py-dot/py-list/
 * py-dict). The MeTTa engine runs in TypeScript, so a grounded atom can hold a JS function and the
 * interpreter executes it directly (see GroundedAtom exec wiring). Register with `registerJsInterop(m)`;
 * opt-in because it can resolve and call arbitrary global JS.
 *
 * - `js-atom`  `(js-atom "Math.abs")`: resolve a dotted path from `globalThis` into a grounded atom
 *   (an executable one if it is a function), e.g. `((js-atom "Math.abs") -5)` -> 5.
 * - `js-dot`   `(js-dot <obj> "prop")`: read a property/method of a wrapped JS object; a method is
 *   returned bound to the object so `((js-dot <s> "toUpperCase"))` works.
 * - `js-list`  `(js-list (1 2 3))`: a JS array from the expression's elements.
 * - `js-dict`  `(js-dict (("a" 1) ("b" 2)))`: a JS object from (key value) pairs.
 */
import {
  Atom,
  ExpressionAtom,
  GroundedAtom,
  SymbolAtom,
  VariableAtom,
  ValueObject,
  OperationAtom,
  ValueAtom,
  G,
  S,
} from "../atoms";
import { MeTTa } from "../base";

/** Marks a grounded atom that wraps an arbitrary JS value (object/array), for round-tripping. */
export class JsValue extends ValueObject {}

/** The plain JS value behind an atom: wrapped JS values unwrap to themselves, grounded primitives to
 *  their content, symbols to their name, expressions to arrays; everything else to its text. */
export function atomToJs(atom: Atom): unknown {
  if (atom instanceof GroundedAtom) return atom.object().content;
  if (atom instanceof SymbolAtom) return atom.name();
  if (atom instanceof VariableAtom) return atom.name();
  if (atom instanceof ExpressionAtom) return atom.children().map(atomToJs);
  return atom.toString();
}

/** Wrap a JS value as an atom: functions become executable operation atoms, primitives become grounded
 *  primitives, everything else is wrapped in a {@link JsValue} grounded atom. */
export function jsToAtom(value: unknown): Atom {
  switch (typeof value) {
    case "number":
    case "string":
    case "boolean":
      return ValueAtom(value);
    case "function":
      return OperationAtom((value as { name?: string }).name || "js-fn", (...args) => [
        jsToAtom((value as (...a: unknown[]) => unknown)(...args.map(atomToJs))),
      ]);
    case "undefined":
      return S("()");
    default:
      return value === null ? S("null") : G(new JsValue(value));
  }
}

// Path segments that expose host-level code execution or prototype access. JS interop still exposes
// ordinary host globals (Math, JSON, String methods, ...), so only enable it for trusted programs. This
// denylist blocks known escalation paths: arbitrary eval, process access, and prototype pollution.
const BLOCKED_SEGMENTS = new Set([
  "eval",
  "Function",
  "constructor",
  "prototype",
  "__proto__",
  "process",
  "require",
  "Reflect",
  "globalThis",
  "global",
  "module",
  "import",
  "child_process",
]);

/** Reject a dotted path that names a blocked segment (eval, Function, process, prototype, ...). */
function assertSafePath(path: string, op: string): void {
  for (const seg of path.split("."))
    if (BLOCKED_SEGMENTS.has(seg)) throw new Error(`${op}: access to '${seg}' is blocked`);
}

/** Resolve a dotted path (e.g. "Math.abs", "console.log") against a root object. */
function resolvePath(root: unknown, path: string): { value: unknown; owner: unknown } {
  let owner: unknown = undefined;
  let value: unknown = root;
  for (const key of path.split(".")) {
    if (value == null) return { value: undefined, owner };
    owner = value;
    value = (value as Record<string, unknown>)[key];
  }
  return { value, owner };
}

function asString(atom: Atom | undefined): string | undefined {
  if (atom === undefined) return undefined;
  const v = atomToJs(atom);
  return typeof v === "string" ? v : undefined;
}

/** Register the JS interop operations on a runner. */
export function registerJsInterop(m: MeTTa): void {
  m.registerOperation("js-atom", (args) => {
    const path = asString(args[0]);
    if (path === undefined) throw new Error('js-atom: expected a String path (e.g. "Math.abs")');
    assertSafePath(path, "js-atom");
    const { value } = resolvePath(globalThis, path);
    if (value === undefined) throw new Error(`js-atom: '${path}' did not resolve on globalThis`);
    return [jsToAtom(value)];
  });

  m.registerOperation("js-dot", (args) => {
    const objAtom = args[0];
    const name = asString(args[1]);
    if (objAtom === undefined || name === undefined)
      throw new Error('js-dot: expected (js-dot <object> "property")');
    assertSafePath(name, "js-dot");
    const obj = atomToJs(objAtom);
    const { value, owner } = resolvePath(obj, name);
    if (typeof value === "function")
      return [jsToAtom((value as (...a: unknown[]) => unknown).bind(owner))];
    return [jsToAtom(value)];
  });

  m.registerOperation("js-list", (args) => {
    const e = args[0];
    const items = e instanceof ExpressionAtom ? e.children() : [];
    return [G(new JsValue(items.map(atomToJs)))];
  });

  m.registerOperation("js-dict", (args) => {
    const e = args[0];
    const out: Record<string, unknown> = {};
    if (e instanceof ExpressionAtom)
      for (const pair of e.children())
        if (pair instanceof ExpressionAtom) {
          const [k, v] = pair.children();
          if (k !== undefined && v !== undefined) out[String(atomToJs(k))] = atomToJs(v);
        }
    return [G(new JsValue(out))];
  });
}
