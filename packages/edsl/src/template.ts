// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Tagged-template MeTTa source with `${...}` holes. It uses the parser, so every parsed form works:
// if, case, match, types, and nesting. Each interpolation is auto-grounded, so
// `m\`(balance-of ${account})\`` embeds a TypeScript object as a grounded atom, and
// `m\`(parent ${x} Bob)\`` inlines a typed variable.
import {
  Atom,
  SExprParser,
  SymbolAtom,
  ExpressionAtom,
  E,
  standardTokenizer,
  type Tokenizer,
} from "@metta-ts/hyperon";
import { ground, type Term } from "./term";

const SLOT = (i: number): string => `__metta_ts_slot_${i}__`;
const SLOT_RE = /^__metta_ts_slot_(\d+)__$/;

let sharedTokenizer: Tokenizer | undefined;
const tokenizer = (): Tokenizer => (sharedTokenizer ??= standardTokenizer());

function substituteSlots(atom: Atom, slots: Atom[]): Atom {
  if (atom instanceof SymbolAtom) {
    const match = SLOT_RE.exec(atom.name());
    return match ? slots[Number(match[1])]! : atom;
  }
  if (atom instanceof ExpressionAtom)
    return E(...atom.children().map((c) => substituteSlots(c, slots)));
  return atom; // variables and grounded atoms have no slots to fill
}

/** Parse a MeTTa template into the atoms it contains, with `${...}` holes auto-grounded. */
export function mAll(strings: TemplateStringsArray, ...values: Term[]): Atom[] {
  let src = strings[0]!;
  for (let i = 0; i < values.length; i++) src += SLOT(i) + strings[i + 1]!;
  const slots = values.map(ground);
  return new SExprParser(src).parseAll(tokenizer()).map((a) => substituteSlots(a, slots));
}

/** Parse a MeTTa template into one top-level atom. Throws otherwise; use {@link mAll} for several. */
export function m(strings: TemplateStringsArray, ...values: Term[]): Atom {
  const atoms = mAll(strings, ...values);
  if (atoms.length !== 1)
    throw new Error(
      `m\`...\`: expected exactly one atom, got ${atoms.length}. Use mAll\`...\` for several.`,
    );
  return atoms[0]!;
}

/** Parse one atom from a plain source string (no interpolation). Throws unless the source is exactly one
 *  atom. Backs the typed source query {@link MettaDB.q}. */
export function parseSource(src: string): Atom {
  const atoms = new SExprParser(src).parseAll(tokenizer());
  if (atoms.length !== 1)
    throw new Error(`parseSource: expected exactly one atom, got ${atoms.length}: ${src}`);
  return atoms[0]!;
}
