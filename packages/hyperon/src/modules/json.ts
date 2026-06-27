// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

/**
 * JSON module, modeled on hyperon-experimental's `hyperon.stdlib` JSON operations. Register it on a
 * {@link MeTTa} runner to make these grounded operations callable from MeTTa source:
 *
 * - `dict-space`  `(-> Expression Grounded)`: build a Space of `(key value)` pairs.
 * - `get-keys`    `(-> Grounded Atom)`: every key in a dict-space (one result per key).
 * - `get-value`   `(-> Grounded Atom %Undefined%)`: the value tied to a key (empty if absent).
 * - `json-decode` `(-> String Atom)`: JSON text to MeTTa (array to expression, object to dict-space,
 *   string to String, number to Number, bool to Bool, null to `null`).
 * - `json-encode` `(-> Atom String)`: MeTTa to JSON text (the inverse).
 */
import {
  Atom,
  ExpressionAtom,
  GroundedAtom,
  SymbolAtom,
  ValueObject,
  E,
  G,
  S,
  V,
  ValueAtom,
} from "../atoms";
import { GroundingSpace, MeTTa } from "../base";

/** A grounded value wrapping a Space, so a dict-space round-trips through grounded atoms. */
export class SpaceValue extends ValueObject {
  constructor(readonly space: GroundingSpace) {
    super(space);
  }
  override toString(): string {
    return "(dict-space)";
  }
}

/** The Space inside a grounded dict-space atom, or undefined if the atom is not one. */
function spaceOf(atom: Atom): GroundingSpace | undefined {
  if (!(atom instanceof GroundedAtom)) return undefined;
  const obj = atom.object();
  return obj instanceof SpaceValue ? obj.space : undefined;
}

/** Build a dict-space grounded atom from `(key value)` pair atoms. */
function makeDictSpace(pairs: readonly Atom[]): GroundedAtom {
  const space = new GroundingSpace();
  for (const p of pairs) space.addAtom(p);
  return G(new SpaceValue(space));
}

/** Convert a parsed JSON value into a MeTTa atom. */
function jsonToAtom(value: unknown): Atom {
  if (value === null) return S("null");
  if (Array.isArray(value)) return E(...value.map(jsonToAtom));
  switch (typeof value) {
    case "string":
      return ValueAtom(value);
    case "number":
      return ValueAtom(value);
    case "boolean":
      return ValueAtom(value);
    case "object":
      return makeDictSpace(
        Object.entries(value as Record<string, unknown>).map(([k, v]) =>
          E(ValueAtom(k), jsonToAtom(v)),
        ),
      );
    default:
      return S("null");
  }
}

/** Convert a MeTTa atom into a JSON-encodable JS value. */
function atomToJson(atom: Atom): unknown {
  const space = spaceOf(atom);
  if (space !== undefined) {
    const obj: Record<string, unknown> = {};
    for (const a of space.getAtoms()) {
      if (a instanceof ExpressionAtom) {
        const [k, v] = a.children();
        if (k !== undefined && v !== undefined) obj[String(jsonScalar(k))] = atomToJson(v);
      }
    }
    return obj;
  }
  if (atom instanceof ExpressionAtom) return atom.children().map(atomToJson);
  if (atom instanceof GroundedAtom) {
    const content = atom.object().content;
    const t = typeof content;
    if (content !== null && t !== "string" && t !== "number" && t !== "boolean")
      throw new Error(
        `json-encode: grounded value of type '${t}' is not JSON-encodable: ${atom.toString()}`,
      );
    return content;
  }
  if (atom instanceof SymbolAtom) return atom.name() === "null" ? null : atom.name();
  return atom.toString();
}

/** The plain scalar behind a grounded atom (for use as an object key). */
function jsonScalar(atom: Atom): unknown {
  if (atom instanceof GroundedAtom) return atom.object().content;
  return atom.toString();
}

/** Register the JSON module's operations on a runner. */
export function registerJsonModule(m: MeTTa): void {
  // Fresh internal query-variable counter, per runner. `get-value` never collides with key variables,
  // and the counter does not leak across runners.
  let freshVar = 0;
  m.registerOperation("dict-space", (args) => {
    const expr = args[0];
    const pairs = expr instanceof ExpressionAtom ? expr.children() : [];
    return [makeDictSpace(pairs)];
  });

  m.registerOperation("get-keys", (args) => {
    const space = args[0] === undefined ? undefined : spaceOf(args[0]);
    if (space === undefined)
      throw new Error(
        `get-keys: expected a dict-space, got ${args[0]?.toString() ?? "no argument"}`,
      );
    const keys: Atom[] = [];
    for (const a of space.getAtoms())
      if (a instanceof ExpressionAtom) {
        const k = a.children()[0];
        if (k !== undefined) keys.push(k);
      }
    return keys;
  });

  m.registerOperation("get-value", (args) => {
    const space = args[0] === undefined ? undefined : spaceOf(args[0]);
    const key = args[1];
    if (space === undefined)
      throw new Error(
        `get-value: expected a dict-space, got ${args[0]?.toString() ?? "no argument"}`,
      );
    if (key === undefined) throw new Error("get-value: missing key argument");
    const v = V(`__get_value_${freshVar++}`);
    return space.subst(E(key, v), v);
  });

  m.registerOperation("json-decode", (args) => {
    const a = args[0];
    if (!(a instanceof GroundedAtom))
      throw new Error(
        `json-decode: expected a grounded string, got ${a?.toString() ?? "no argument"}`,
      );
    const text = a.object().content;
    if (typeof text !== "string")
      throw new Error(`json-decode: expected a string value, got ${typeof text}`);
    return [jsonToAtom(JSON.parse(text))];
  });

  m.registerOperation("json-encode", (args) => {
    const a = args[0];
    if (a === undefined) throw new Error("json-encode: missing argument");
    return [ValueAtom(JSON.stringify(atomToJson(a)))];
  });
}
