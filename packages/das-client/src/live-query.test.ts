// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { node, variable, expr } from "./query-tokens";
import { queryPatternMatching } from "./query-client";
import { terminalHash } from "./handle";

// Drive a real pattern_matching_query at the live 1.0.0 Query Agent (:40002) and decode the answers.
// Query: (EVALUATION (PREDICATE is_animal) (CONCEPT $C)) -- the official das integration test
// (hyperon-experimental integration_tests/das/test.metta). Expected $C: monkey human triceratops
// earthworm chimp ent rhino snake. Skipped unless DAS_LIVE=1.
const run = process.env.DAS_LIVE === "1" ? it : it.skip;

const EXPECTED = ["monkey", "human", "triceratops", "earthworm", "chimp", "ent", "rhino", "snake"];

describe("live DAS pattern_matching_query", () => {
  run(
    "issues (EVALUATION (PREDICATE is_animal) (CONCEPT $C)) and decodes the answers",
    async () => {
      // The das `animals.metta` stores names as bare Symbols (e.g. `is_animal`, `human`), not quoted strings.
      const pattern = expr(
        node("EVALUATION"),
        expr(node("PREDICATE"), node("is_animal")),
        expr(node("CONCEPT"), variable("C")),
      );

      const { answers, finished, aborted } = await queryPatternMatching({
        proxyHost: "127.0.0.1",
        agentAddress: "127.0.0.1:40002",
        pattern,
      });

      // The $C binding is the matched CONCEPT node handle; resolve it back to a readable name.
      const handleToName = new Map(EXPECTED.map((n) => [terminalHash("Symbol", n), n]));
      const decoded = answers
        .map((a) => handleToName.get(a.assignment["C"] ?? ""))
        .filter((n): n is string => n !== undefined)
        .sort();

      console.log("DAS query:", { finished, aborted, answers: answers.length, decoded });

      expect(aborted).toBe(false);
      expect(finished).toBe(true);
      expect(new Set(decoded)).toEqual(new Set(EXPECTED));
    },
  );
});
