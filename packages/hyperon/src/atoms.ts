// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

/**
 * Atom API: a TypeScript class surface over the functional `@metta-ts/core` term model, modeled on
 * Hyperon's `hyperon.atoms`. It wraps immutable core atoms in classes; it does not bridge Python, Rust,
 * or FFI. Python aliases (`get_name`, `get_metatype`, ...) sit beside idiomatic names (`name`,
 * `metatype`, ...) for ported code.
 */
import * as core from "@metta-ts/core";
import { Bindings, BindingsSet } from "./bindings";

/** The kind of an atom: `Symbol`, `Variable`, `Expression`, or `Grounded`. */
export type MetaType = core.MetaType;

/**
 * Base class for every atom. Wraps one immutable core atom (`catom`) and exposes shared operations:
 * metatype, structural equality, rendering, depth-first iteration, and matching.
 */
export abstract class Atom {
  protected constructor(readonly catom: core.Atom) {}

  /** Wrap a core atom in the matching subclass. */
  static fromCAtom(c: core.Atom): Atom {
    switch (c.kind) {
      case "sym":
        return new SymbolAtom(c);
      case "var":
        return new VariableAtom(c);
      case "expr":
        return new ExpressionAtom(c);
      case "gnd":
        return new GroundedAtom(c);
    }
  }

  /** The metatype (kind) of this atom. */
  metatype(): MetaType {
    return core.metaType(this.catom);
  }
  /** Python alias of {@link metatype}. */
  get_metatype(): MetaType {
    return this.metatype();
  }

  /** Structural equality with another atom. */
  equals(other: Atom): boolean {
    return core.atomEq(this.catom, other.catom);
  }

  /** MeTTa source rendering. */
  toString(): string {
    return core.format(this.catom);
  }

  /** This atom and all descendants, depth-first (Hyperon `iterate`). */
  iterate(): Atom[] {
    const out: Atom[] = [];
    const go = (c: core.Atom): void => {
      out.push(Atom.fromCAtom(c));
      if (c.kind === "expr") for (const it of c.items) go(it);
    };
    go(this.catom);
    return out;
  }

  /** Match this atom against another, returning every resulting binding frame. */
  matchAtom(other: Atom): BindingsSet {
    return new BindingsSet(core.matchAtoms(this.catom, other.catom).map((b) => new Bindings(b)));
  }
  /** Python alias of {@link matchAtom}. */
  match_atom(other: Atom): BindingsSet {
    return this.matchAtom(other);
  }
}

/** Reject a core atom with the wrong kind for a wrapper subclass. */
function assertKind(catom: core.Atom, kind: core.Atom["kind"], cls: string): void {
  if (catom.kind !== kind) throw new Error(`${cls} expects a '${kind}' atom, got '${catom.kind}'`);
}

/** A symbol: a single named concept. Symbols with the same name are the same atom. */
export class SymbolAtom extends Atom {
  /** Wrap a core symbol atom. */
  constructor(catom: core.Atom) {
    assertKind(catom, "sym", "SymbolAtom");
    super(catom);
  }
  /** The symbol's name. */
  name(): string {
    return (this.catom as core.SymAtom).name;
  }
  /** Python alias of {@link name}. */
  get_name(): string {
    return this.name();
  }
}

/** A variable: a placeholder that can be bound during matching. */
export class VariableAtom extends Atom {
  /** Wrap a core variable atom. */
  constructor(catom: core.Atom) {
    assertKind(catom, "var", "VariableAtom");
    super(catom);
  }
  /** The variable's name (without the leading `$`). */
  name(): string {
    return (this.catom as core.VarAtom).name;
  }
  /** Python alias of {@link name}. */
  get_name(): string {
    return this.name();
  }
  /** Construct a variable from a name (Hyperon `parse_name`). */
  static parseName(name: string): VariableAtom {
    return new VariableAtom(core.variable(name));
  }
}

/** An expression: an ordered tuple of child atoms. */
export class ExpressionAtom extends Atom {
  /** Wrap a core expression atom. */
  constructor(catom: core.Atom) {
    assertKind(catom, "expr", "ExpressionAtom");
    super(catom);
  }
  /** The child atoms, in order. */
  children(): Atom[] {
    return (this.catom as core.ExprAtom).items.map(Atom.fromCAtom);
  }
  /** Python alias of {@link children}. */
  get_children(): Atom[] {
    return this.children();
  }
}

// ---- Grounded objects -------------------------------------------------------------------------

/** Wraps arbitrary content inside a grounded atom, optionally with a display id. */
export class GroundedObject {
  constructor(
    readonly content: unknown,
    readonly id?: string,
  ) {}
  toString(): string {
    return this.id ?? String(this.content);
  }
  /** A copy of this object (content is shared). */
  copy(): GroundedObject {
    return this;
  }
}

/** A grounded object compared by the equality of its content. */
export class ValueObject extends GroundedObject {
  /** The wrapped value. */
  get value(): unknown {
    return this.content;
  }
  equals(other: ValueObject): boolean {
    return this.content === other.content;
  }
}

/** A value object that can define custom matching against an atom (Hyperon `MatchableObject`). */
export class MatchableObject extends ValueObject {
  /** Override to define matching behavior. Throws by default. */
  match_(atom: Atom): unknown[] {
    throw new Error(`MatchableObject.match_ must be overridden (got ${atom.toString()})`);
  }
}

/** A grounded operation: a named function callable as a grounded atom. */
export class OperationObject extends GroundedObject {
  constructor(
    readonly opName: string,
    readonly op: (...args: Atom[]) => Atom[],
    // Source-compatible with Python Hyperon's `OperationAtom(name, fn, unwrap)`. Ignored because a
    // TypeScript operation always receives argument atoms (`Atom[]`), never unwrapped JS values.
    readonly unwrap = true,
  ) {
    super(op, opName);
  }
  /** Run the operation over the argument atoms. */
  execute(...args: Atom[]): Atom[] {
    return this.op(...args);
  }
}

// Grounded `ext` atoms store only an id in core; JS objects live here. Entries outlive wrappers because
// a core atom can sit in a Space and be re-wrapped later. The process-global registry grows with each
// `G()`/`OperationAtom()`/object-valued `ValueAtom()`. Long-running hosts can call
// `clearGroundedObjects()` once no live grounded `ext` atoms remain.
let extCounter = 0;
const EXT_OBJECTS = new Map<string, GroundedObject>();

/** Drop every registered grounded object. Call only when no grounded `ext` atom is still in use;
 *  afterwards `GroundedAtom.object()` on a cleared atom degrades to a `ValueObject` over its string id. */
export function clearGroundedObjects(): void {
  EXT_OBJECTS.clear();
}

/** A grounded atom: value, space, or operation content wrapped as an atom. */
export class GroundedAtom extends Atom {
  private obj: GroundedObject | undefined;
  /** Wrap a core grounded atom, optionally remembering the JS object behind it. */
  constructor(catom: core.Atom, obj?: GroundedObject) {
    assertKind(catom, "gnd", "GroundedAtom");
    super(catom);
    this.obj = obj;
  }
  /** The wrapped object: the original `GroundedObject` if known, otherwise a `ValueObject` over the
   *  grounded value. The result is cached so repeated calls return the same instance. */
  object(): GroundedObject {
    if (this.obj !== undefined) return this.obj;
    const g = (this.catom as core.GndAtom).value;
    if (g.g === "ext") {
      const o = EXT_OBJECTS.get(g.id);
      if (o !== undefined) {
        this.obj = o;
        return o;
      }
      // The object was cleared (or never registered): keep the string id as the content.
      this.obj = new ValueObject(g.id);
      return this.obj;
    }
    this.obj = new ValueObject(groundToJs(g));
    return this.obj;
  }
  /** Python alias of {@link object}. */
  get_object(): GroundedObject {
    return this.object();
  }
  /** The plain JS value behind this grounded atom, typed as `T`. */
  jsValue<T = unknown>(): T {
    return this.object().content as T;
  }
  /** The grounded type atom. */
  groundedType(): Atom {
    return Atom.fromCAtom((this.catom as core.GndAtom).typ);
  }
  /** Python alias of {@link groundedType}. */
  get_grounded_type(): Atom {
    return this.groundedType();
  }
}

/** The plain JS value behind a core ground (numbers, strings, booleans; `undefined` for unit). */
export function groundToJs(g: core.Ground): unknown {
  switch (g.g) {
    case "int":
    case "float":
      return g.n;
    case "str":
      return g.s;
    case "bool":
      return g.b;
    case "unit":
      return undefined;
    case "error":
      return g.msg;
    case "ext":
      return EXT_OBJECTS.get(g.id);
  }
}

// ---- Convenience constructors ------------------------------------------------------------------

/** Construct a {@link SymbolAtom}. */
export const S = (name: string): SymbolAtom => new SymbolAtom(core.sym(name));
/** Construct a {@link VariableAtom}. */
export const V = (name: string): VariableAtom => new VariableAtom(core.variable(name));
/** Construct an {@link ExpressionAtom} from child atoms. */
export const E = (...children: Atom[]): ExpressionAtom =>
  new ExpressionAtom(core.expr(children.map((c) => c.catom)));

/** Construct a {@link GroundedAtom} from a grounded object, optionally typed. An `OperationObject`
 *  becomes executable: when it heads `(<atom> arg...)`, the interpreter runs its operation. */
export function G(obj: GroundedObject, type?: Atom): GroundedAtom {
  const id = `gnd-${extCounter++}`;
  EXT_OBJECTS.set(id, obj);
  const kind = obj instanceof OperationObject ? "operation" : "value";
  const typ = type?.catom ?? core.sym("%Undefined%");
  const exec =
    obj instanceof OperationObject
      ? (args: readonly core.Atom[]): readonly core.Atom[] =>
          obj.execute(...args.map(Atom.fromCAtom)).map((a) => a.catom)
      : undefined;
  // A MatchableObject defines custom unification via core grounded matching.
  const match =
    obj instanceof MatchableObject
      ? (other: core.Atom): readonly unknown[] => obj.match_(Atom.fromCAtom(other))
      : undefined;
  return new GroundedAtom(core.gnd({ g: "ext", kind, id }, typ, exec, match), obj);
}

/**
 * Wrap a JS value in a grounded atom. Without `typeName`, primitives become MeTTa primitives
 * (`number` -> Number, `string` -> String, `boolean` -> Bool) and anything else is wrapped in a
 * {@link ValueObject}. With `typeName`, the value is always wrapped in a `ValueObject` carrying that
 * type, so the requested type is honored for primitives too.
 */
export function ValueAtom(value: unknown, typeName?: string): GroundedAtom {
  if (typeName === undefined) {
    if (typeof value === "number")
      return new GroundedAtom(Number.isInteger(value) ? core.gint(value) : core.gfloat(value));
    if (typeof value === "string") return new GroundedAtom(core.gstr(value));
    if (typeof value === "boolean") return new GroundedAtom(core.gbool(value));
    return G(new ValueObject(value));
  }
  return G(new ValueObject(value), Atom.fromCAtom(core.sym(typeName)));
}

/** Construct a grounded operation atom (Hyperon `OperationAtom`). The operation runs over atoms;
 *  register it in a {@link MeTTa} runner's tokenizer/grounding to call it from MeTTa source. */
export function OperationAtom(
  name: string,
  op: (...args: Atom[]) => Atom[],
  unwrap = true,
): GroundedAtom {
  return G(new OperationObject(name, op, unwrap));
}

/** The built-in type atoms (Hyperon `AtomType`). */
export const AtomType = {
  /** `%Undefined%`. */
  UNDEFINED: S("%Undefined%"),
  /** `Type`. */
  TYPE: S("Type"),
  /** `Atom`. */
  ATOM: S("Atom"),
  /** `Symbol`. */
  SYMBOL: S("Symbol"),
  /** `Variable`. */
  VARIABLE: S("Variable"),
  /** `Expression`. */
  EXPRESSION: S("Expression"),
  /** `Grounded`. */
  GROUNDED: S("Grounded"),
  /** `Number`. */
  NUMBER: S("Number"),
  /** `Bool`. */
  BOOL: S("Bool"),
  /** `String`. */
  STRING: S("String"),
} as const;

/** Display type name for an atom, for use in error messages (e.g. `Number`, `String`,
 *  `Symbol`, `Expression`). Grounded atoms report their value type rather than just `Grounded`. */
export function friendlyTypeName(atom: Atom): string {
  const c = atom.catom;
  if (c.kind === "gnd") {
    switch (c.value.g) {
      case "int":
        return "Number (integer)";
      case "float":
        return "Number (float)";
      case "str":
        return "String";
      case "bool":
        return "Bool";
      case "unit":
        return "Unit";
      case "error":
        return "Error";
      case "ext":
        return "Grounded";
    }
  }
  return atom.metatype();
}

/** True when an atom is an `(Error ...)` expression. */
export function atomIsError(atom: Atom): boolean {
  return core.isErrorAtom(atom.catom);
}

/** True when two atoms are alpha-equivalent (equal up to consistent variable renaming). */
export function atomsAreEquivalent(first: Atom, second: Atom): boolean {
  return core.alphaEq(first.catom, second.catom);
}
