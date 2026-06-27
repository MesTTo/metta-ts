// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The tokenizer: ordered (regex, constructor) pairs that turn WORD/STRING tokens into
// grounded atoms (HE semantics). First match wins. This is the grounded-op extension seam.
import { type Atom } from "./atom";

export type TokenConstructor = (token: string) => Atom;

export class Tokenizer {
  private readonly entries: Array<{ re: RegExp; make: TokenConstructor }> = [];

  /** Register a (regex, constructor). Order matters: the first matching pattern wins. */
  register(re: RegExp, make: TokenConstructor): void {
    this.entries.push({ re, make });
  }

  /** A grounded atom for `token`, or undefined if no pattern matches (caller falls back to Symbol). */
  tokenize(token: string): Atom | undefined {
    for (const e of this.entries) if (e.re.test(token)) return e.make(token);
    return undefined;
  }
}
