// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Alpha-equivalence (LeaTTa `Core/Alpha.lean`): two atoms are alpha-equal when canonicalising
// their variables to first-occurrence order makes them structurally equal.
import { type Atom, variable, expr, atomEq } from "./atom";

function canonicalize(a: Atom, map: Map<string, string>): Atom {
  switch (a.kind) {
    case "var": {
      let c = map.get(a.name);
      if (c === undefined) {
        c = "%" + String(map.size);
        map.set(a.name, c);
      }
      return variable(c);
    }
    case "expr":
      return expr(a.items.map((x) => canonicalize(x, map)));
    default:
      return a;
  }
}

export function alphaEq(a: Atom, b: Atom): boolean {
  return atomEq(canonicalize(a, new Map()), canonicalize(b, new Map()));
}
