// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { sym as coreSym, matchAtoms } from "@metta-ts/core";
import { G, MatchableObject, ValueAtom, type GroundedAtom } from "./atoms";
import { MeTTa, IncorrectArgumentError } from "./base";

describe("MatchableObject.match_ is wired into the core matcher", () => {
  it("invokes match_ when a pattern unifies against the grounded atom", () => {
    let called = false;
    class Custom extends MatchableObject {
      override match_(): unknown[] {
        called = true;
        return [[]]; // one binding set (empty) = a match
      }
    }
    const g = G(new Custom("c"));
    const results = matchAtoms(coreSym("probe"), g.catom);
    expect(called).toBe(true);
    expect(results.length).toBe(1);
  });

  it("a plain ValueObject grounded atom does NOT match a different atom (no custom match)", () => {
    const v = ValueAtom(7);
    expect(matchAtoms(coreSym("probe"), v.catom).length).toBe(0);
  });
});

describe("GroundedAtom.jsValue typed accessor", () => {
  it("unwraps a grounded atom's JS value", () => {
    const metta = new MeTTa();
    metta.registerOperation("double", (args) => [
      ValueAtom((args[0] as GroundedAtom).jsValue<number>() * 2),
    ]);
    expect(metta.run("!(double 21)")[0]!.map(String)).toEqual(["42"]);
  });
});

describe("registerOperation IncorrectArgumentError leaves the expression unevaluated", () => {
  it("a thrown IncorrectArgumentError does not become an Error atom", () => {
    const metta = new MeTTa();
    metta.registerOperation("skip", () => {
      throw new IncorrectArgumentError("not for me");
    });
    const out = metta.run("!(skip 1)")[0]!.map(String);
    // incorrectArgument -> the expression is not reduced by the op (no (Error ...) atom)
    expect(out.some((s) => s.includes("Error"))).toBe(false);
  });

  it("a plain thrown Error still becomes an Error atom", () => {
    const metta = new MeTTa();
    metta.registerOperation("boom", () => {
      throw new Error("kaboom");
    });
    const out = metta.run("!(boom 1)")[0]!.map(String);
    expect(out.some((s) => s.includes("Error") && s.includes("kaboom"))).toBe(true);
  });
});

describe("ValueAtom honors typeName for primitives", () => {
  it("a typed primitive carries the requested grounded type", () => {
    const a = ValueAtom(42, "Celsius") as GroundedAtom;
    expect(a.groundedType().toString()).toBe("Celsius");
    expect(a.jsValue<number>()).toBe(42);
  });
});
