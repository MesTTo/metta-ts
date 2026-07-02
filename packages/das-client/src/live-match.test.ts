// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { sym, variable, expr, format, type Atom } from "@metta-ts/core";
import { DasLiveSpace, matchAsync } from "./async-space";

// The async Space, end-to-end against a live DAS: match a MeTTa pattern and get concrete atoms back
// (resolved from the agent's MeTTa mapping). Mirrors
//   (match &das (EVALUATION (PREDICATE is_animal) (CONCEPT $C)) $C)
// The das `animals.metta` stores names as bare Symbols, so the leaf nodes are `sym(...)`, not strings.
// Skipped unless DAS_LIVE=1.
const run = process.env.DAS_LIVE === "1" ? it : it.skip;

describe("DasLiveSpace.matchAsync", () => {
  run("returns the eight animal concepts as atoms", async () => {
    const space = new DasLiveSpace("127.0.0.1:40002", "127.0.0.1");
    const C = variable("C");
    const pattern: Atom = expr([
      sym("EVALUATION"),
      expr([sym("PREDICATE"), sym("is_animal")]),
      expr([sym("CONCEPT"), C]),
    ]);

    const results = await matchAsync(space, pattern, C);
    const names = results.map(format).sort();

    console.log("matchAsync ->", names);

    const expected = [
      "chimp",
      "earthworm",
      "ent",
      "human",
      "monkey",
      "rhino",
      "snake",
      "triceratops",
    ];
    expect(names).toEqual(expected);
  });

  run("handles two concurrent queries without a port or node-id collision", async () => {
    const space = new DasLiveSpace("127.0.0.1:40002");
    const C = variable("C");
    const q = (pred: string): Promise<string[]> =>
      matchAsync(
        space,
        expr([sym("EVALUATION"), expr([sym("PREDICATE"), sym(pred)]), expr([sym("CONCEPT"), C])]),
        C,
      ).then((r) => r.map(format).sort());

    const [animals, reptiles] = await Promise.all([q("is_animal"), q("is_reptile")]);
    expect(animals).toHaveLength(8);
    expect(reptiles).toEqual(["snake", "triceratops"]);
  });
});
