// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { node, variable, expr, encodeQuery } from "./query-tokens";
import { parseQueryAnswer, collectAnswers, unwrapProxyMessage, PROXY_COMMAND } from "./answer";

describe("query-tokens encoder", () => {
  it("encodes a flat link template (Similarity $v1 $v2)", () => {
    const tokens = encodeQuery(expr(node("Similarity"), variable("v1"), variable("v2")));
    expect(tokens).toEqual([
      "LINK_TEMPLATE",
      "Expression",
      "3",
      "NODE",
      "Symbol",
      "Similarity",
      "VARIABLE",
      "v1",
      "VARIABLE",
      "v2",
    ]);
  });

  it("encodes a nested ground link as LINK and a variable branch as LINK_TEMPLATE", () => {
    // (EVALUATION (PREDICATE "is_animal") (CONCEPT $C)), the official das integration query.
    const tokens = encodeQuery(
      expr(
        node("EVALUATION"),
        expr(node("PREDICATE"), node('"is_animal"')),
        expr(node("CONCEPT"), variable("C")),
      ),
    );
    expect(tokens).toEqual([
      "LINK_TEMPLATE",
      "Expression",
      "3",
      "NODE",
      "Symbol",
      "EVALUATION",
      "LINK",
      "Expression",
      "2",
      "NODE",
      "Symbol",
      "PREDICATE",
      "NODE",
      "Symbol",
      '"is_animal"',
      "LINK_TEMPLATE",
      "Expression",
      "2",
      "NODE",
      "Symbol",
      "CONCEPT",
      "VARIABLE",
      "C",
    ]);
    // The first pass of the agent's stack machine walks token widths (3 for NODE/LINK/LINK_TEMPLATE,
    // 2 for VARIABLE/ATOM) and must consume the stream exactly.
    let cursor = 0;
    while (cursor < tokens.length) {
      const t = tokens[cursor];
      cursor += t === "VARIABLE" || t === "ATOM" ? 2 : 3;
    }
    expect(cursor).toBe(tokens.length);
  });

  it("uses ATOM for a bound handle leaf", () => {
    expect(encodeQuery({ kind: "atom", handle: "deadbeef" })).toEqual(["ATOM", "deadbeef"]);
  });
});

describe("answer protocol decoder", () => {
  // A real QueryAnswer::tokenize string captured from the live 1.0.0 agent: strength importance,
  // 1 matched handle (the EVALUATION link), then assignment {C -> node handle}, then empty metta map.
  const liveAnswer =
    "0.0000000000 0.0000000000 1 05334cd513b84572d7eb52d0dd849072 1 C 181a19436acef495c8039a610be59603 0 ";

  it("parses a tokenized QueryAnswer into assignment and handles", () => {
    const a = parseQueryAnswer(liveAnswer);
    expect(a.handles).toEqual(["05334cd513b84572d7eb52d0dd849072"]);
    expect(a.assignment).toEqual({ C: "181a19436acef495c8039a610be59603" });
  });

  it("unwraps a bus_command_proxy message (inner command is the last arg)", () => {
    const wrapped = unwrapProxyMessage([liveAnswer, "answer_bundle"]);
    expect(wrapped.command).toBe("answer_bundle");
    expect(wrapped.args).toEqual([liveAnswer]);
  });

  it("collects answers across a bundle then a finished signal", () => {
    const messages = [
      { command: PROXY_COMMAND, args: [liveAnswer, "answer_bundle"] },
      { command: PROXY_COMMAND, args: ["finished"] },
    ];
    const { answers, finished, aborted } = collectAnswers(messages);
    expect(answers).toHaveLength(1);
    expect(answers[0]!.assignment["C"]).toBe("181a19436acef495c8039a610be59603");
    expect(finished).toBe(true);
    expect(aborted).toBe(false);
  });
});
