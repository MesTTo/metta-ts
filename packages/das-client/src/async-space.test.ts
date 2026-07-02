// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { sym, variable, expr, gstr, format, type Atom, type Bindings } from "@metta-ts/core";
import { atomToPattern, matchAsync, type AsyncSpace } from "./async-space";
import { parseQueryAnswer } from "./answer";

describe("atomToPattern", () => {
  it("maps symbols, string values, variables, and expressions", () => {
    const a: Atom = expr([
      sym("EVALUATION"),
      expr([sym("PREDICATE"), gstr("is_animal")]),
      expr([sym("CONCEPT"), variable("C")]),
    ]);
    expect(atomToPattern(a)).toEqual({
      kind: "expr",
      children: [
        { kind: "node", type: "Symbol", name: "EVALUATION" },
        {
          kind: "expr",
          children: [
            { kind: "node", type: "Symbol", name: "PREDICATE" },
            { kind: "node", type: "Symbol", name: '"is_animal"' },
          ],
        },
        {
          kind: "expr",
          children: [
            { kind: "node", type: "Symbol", name: "CONCEPT" },
            { kind: "var", name: "C" },
          ],
        },
      ],
    });
  });

  it("escapes quotes and backslashes in string node names", () => {
    expect(atomToPattern(gstr('a"b\\c'))).toEqual({
      kind: "node",
      type: "Symbol",
      name: '"a\\"b\\\\c"',
    });
  });
});

describe("parseQueryAnswer with metta mapping", () => {
  // A real populate_metta_mapping answer captured from the live agent.
  const liveAnswer =
    "0.0000000000 0.0000000000 1 05334cd513b84572d7eb52d0dd849072 1 C 181a19436acef495c8039a610be59603 8 " +
    '05334cd513b84572d7eb52d0dd849072 (EVALUATION (PREDICATE "is_animal") (CONCEPT "monkey")) ' +
    '181a19436acef495c8039a610be59603 "monkey" ' +
    '3b297892349cca0f8daf85654e1b481d (CONCEPT "monkey") ' +
    "65f7f5dc1ea214486e7cbe8254c0e3dc EVALUATION " +
    "9521638da5eb926fccddfbfd4fb1d060 PREDICATE " +
    'ab436aa431f4f2b644d5890d1acffc43 (PREDICATE "is_animal") ' +
    "c28512d242fb830dd0f52fe36010e502 CONCEPT " +
    'cf07db895a5656bfd3652ba565727554 "is_animal" ';

  it("resolves the variable binding to its MeTTa text", () => {
    const a = parseQueryAnswer(liveAnswer);
    expect(a.assignment["C"]).toBe("181a19436acef495c8039a610be59603");
    expect(a.metta[a.assignment["C"]!]).toBe('"monkey"');
    // the paren-balanced top-level link survives intact (spaces and nested parens)
    expect(a.metta["05334cd513b84572d7eb52d0dd849072"]).toBe(
      '(EVALUATION (PREDICATE "is_animal") (CONCEPT "monkey"))',
    );
  });
});

describe("parseQueryAnswer hard errors on malformed wire data", () => {
  it("throws on a non-numeric count", () => {
    expect(() => parseQueryAnswer("0.0 0.0 notanumber")).toThrow(/expected handles count/);
  });
  it("throws on truncated input", () => {
    expect(() => parseQueryAnswer("0.0 0.0 2 h1")).toThrow(/expected handle/);
  });
  it("throws on an unterminated string in the metta map", () => {
    expect(() => parseQueryAnswer('0.0 0.0 0 0 1 deadbeef "unterminated')).toThrow(
      /unterminated string/,
    );
  });
  it("throws on unbalanced parens in the metta map", () => {
    expect(() => parseQueryAnswer("0.0 0.0 0 0 1 deadbeef (a (b c)")).toThrow(/unbalanced parens/);
  });
});

describe("matchAsync over a mock async space", () => {
  it("instantiates the template under each binding", async () => {
    // A mock space that binds $C to two string atoms, exercising the same resolution path.
    const mock: AsyncSpace = {
      queryAsync: (): Promise<Bindings[]> =>
        Promise.resolve([
          [{ tag: "val", x: "C", a: gstr("monkey"), y: undefined }],
          [{ tag: "val", x: "C", a: gstr("snake"), y: undefined }],
        ]),
    };
    const C = variable("C");
    const out = await matchAsync(mock, expr([sym("CONCEPT"), C]), C);
    expect(out.map(format).sort()).toEqual(['"monkey"', '"snake"']);
  });
});
