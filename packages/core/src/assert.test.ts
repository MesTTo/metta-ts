// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { assertNever, invariant } from "./assert";

describe("assert", () => {
  it("assertNever throws with a descriptive message", () => {
    expect(() => assertNever("oops" as never)).toThrowError(/unreachable/);
  });
  it("invariant throws when the condition is falsy", () => {
    expect(() => invariant(false, "bad")).toThrowError(/invariant/);
    expect(() => invariant(true, "ok")).not.toThrow();
  });
});
