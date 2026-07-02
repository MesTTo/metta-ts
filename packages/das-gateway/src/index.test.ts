// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { sym, variable, expr, format, instantiate, atomEq } from "@metta-ts/core";
import { encodePattern, decodeBindings, queryDas, type GatewayTransport } from "./index";

describe("das-gateway wire format", () => {
  it("encodes a pattern and decodes binding solutions round-trip", async () => {
    // A stub gateway that "answers" $s = chimp / monkey for any pattern.
    const transport: GatewayTransport = {
      query: () =>
        Promise.resolve({
          bindings: [[["s", "chimp"]], [["s", "monkey"]]],
        }),
    };
    const pattern = expr([sym("Similarity"), sym("human"), variable("s")]);
    expect(encodePattern(pattern)).toBe("(Similarity human $s)");

    const sols = await queryDas(transport, "&das", pattern);
    const got = sols.map((b) => format(instantiate(b, variable("s"))));
    expect(got).toEqual(["chimp", "monkey"]);
    expect(decodeBindings({ bindings: [[["s", "chimp"]]] }).length).toBe(1);
    expect(
      atomEq(
        instantiate(decodeBindings({ bindings: [[["s", "chimp"]]] })[0]!, variable("s")),
        sym("chimp"),
      ),
    ).toBe(true);
  });
});
