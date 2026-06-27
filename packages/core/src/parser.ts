// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// S-expression parser and printer for the HE MeTTa grammar.
// Grammar: a program is atoms optionally prefixed by `!`. A word starting with `$` is a
// variable; `"..."` is a grounded String; `;` starts a line comment; words are run through
// the tokenizer and fall back to Symbol. `format` is the inverse printer.
import { type Atom, sym, variable, expr, gstr, isExpr, isVar, isSym, isGnd } from "./atom";
import { type Tokenizer } from "./tokenizer";

export interface TopAtom {
  readonly atom: Atom;
  readonly bang: boolean;
}

const isWs = (c: string): boolean => /\s/.test(c);
const isDelim = (c: string): boolean => c === "(" || c === ")" || c === '"' || c === ";" || isWs(c);

class Cursor {
  pos = 0;
  constructor(
    readonly s: string,
    readonly tk: Tokenizer,
  ) {}
  done(): boolean {
    return this.pos >= this.s.length;
  }
  peek(): string {
    return this.s[this.pos] as string;
  }
  skipTrivia(): void {
    while (!this.done()) {
      const c = this.peek();
      if (isWs(c)) {
        this.pos++;
        continue;
      }
      if (c === ";") {
        while (!this.done() && this.peek() !== "\n") this.pos++;
        continue;
      }
      break;
    }
  }
}

function readString(c: Cursor): Atom {
  c.pos++; // opening quote
  let out = "";
  while (!c.done() && c.peek() !== '"') {
    if (c.peek() === "\\" && c.pos + 1 < c.s.length) {
      const next = c.s[c.pos + 1] as string;
      // `\uXXXX` (a 4-hex-digit code unit, the form JSON.stringify emits for control characters).
      if (next === "u" && c.pos + 6 <= c.s.length) {
        const hex = c.s.slice(c.pos + 2, c.pos + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          c.pos += 6;
          continue;
        }
      }
      // The single-letter escapes JSON.stringify emits; for `"`, `\`, `/` and anything else `next` is the
      // literal character. This keeps readString the inverse of format (which prints strings via JSON.stringify).
      out +=
        next === "n"
          ? "\n"
          : next === "t"
            ? "\t"
            : next === "r"
              ? "\r"
              : next === "b"
                ? "\b"
                : next === "f"
                  ? "\f"
                  : next;
      c.pos += 2;
      continue;
    }
    out += c.peek();
    c.pos++;
  }
  if (c.done()) throw new Error("unterminated string literal in MeTTa source");
  c.pos++; // closing quote
  return gstr(out);
}

// Bound on expression nesting, so deliberately deep input cannot overflow the recursive walkers.
const MAX_DEPTH = 4096;

function readWord(c: Cursor): string {
  let out = "";
  while (!c.done() && !isDelim(c.peek())) {
    out += c.peek();
    c.pos++;
  }
  return out;
}

function readAtom(c: Cursor, depth = 0): Atom {
  c.skipTrivia();
  const ch = c.peek();
  if (ch === "(") {
    if (depth >= MAX_DEPTH) throw new Error("MeTTa expression nesting too deep");
    c.pos++;
    const items: Atom[] = [];
    for (;;) {
      c.skipTrivia();
      if (c.done()) throw new Error("unbalanced '(' in MeTTa source");
      if (c.peek() === ")") {
        c.pos++;
        break;
      }
      items.push(readAtom(c, depth + 1));
    }
    return expr(items);
  }
  if (ch === '"') return readString(c);
  const word = readWord(c);
  if (word.startsWith("$")) return variable(word.slice(1));
  return c.tk.tokenize(word) ?? sym(word);
}

// Read one top-level atom from the cursor: an optional leading `!` sets the bang flag. The cursor must
// already be positioned at the atom (the caller skips leading trivia and checks for end-of-input).
function readTop(c: Cursor): TopAtom {
  let bang = false;
  if (c.peek() === "!") {
    bang = true;
    c.pos++;
    c.skipTrivia();
  }
  return { atom: readAtom(c), bang };
}

/** Parse the first top-level atom (with its `!`-flag), or undefined if the source is blank. */
function parseTop(src: string, tk: Tokenizer): TopAtom | undefined {
  const c = new Cursor(src, tk);
  c.skipTrivia();
  return c.done() ? undefined : readTop(c);
}

export function parse(src: string, tk: Tokenizer): Atom | undefined {
  return parseTop(src, tk)?.atom;
}

/** Parse a whole program into its sequence of top-level atoms. */
export function parseAll(src: string, tk: Tokenizer): TopAtom[] {
  const c = new Cursor(src, tk);
  const out: TopAtom[] = [];
  for (;;) {
    c.skipTrivia();
    if (c.done()) break;
    out.push(readTop(c));
  }
  return out;
}

/** Print an atom back to MeTTa source (inverse of parse for normalized input). */
export function format(a: Atom): string {
  if (isExpr(a)) return "(" + a.items.map(format).join(" ") + ")";
  if (isVar(a)) return "$" + a.name;
  if (isSym(a)) return a.name;
  if (isGnd(a)) {
    const v = a.value;
    switch (v.g) {
      case "int":
        return String(v.n);
      case "float":
        return Number.isInteger(v.n) ? v.n.toFixed(1) : String(v.n);
      case "str":
        return JSON.stringify(v.s);
      case "bool":
        return v.b ? "True" : "False";
      case "unit":
        return "()";
      case "error":
        return v.msg;
      case "ext":
        return v.id;
    }
  }
  return "?";
}
