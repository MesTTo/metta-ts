// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { MeTTa } from "../base";
import { OperationAtom } from "../atoms";
import { registerJsonModule } from "./json";
import { registerCatalogModule, ModuleCatalog } from "./catalog";

describe("JSON module", () => {
  it("dict-space, get-keys, get-value", () => {
    const m = new MeTTa();
    registerJsonModule(m);
    m.run("(= (d) (dict-space ((a 1) (b 2))))");
    const keys = m
      .run("!(get-keys (d))")[0]!
      .map((a) => a.toString())
      .sort();
    expect(keys).toEqual(["a", "b"]);
    expect(m.run("!(get-value (d) a)")[0]!.map((a) => a.toString())).toEqual(["1"]);
    expect(m.run("!(get-value (d) missing)")[0]!.map((a) => a.toString())).toEqual([]);
  });

  it("json-decode produces MeTTa atoms", () => {
    const m = new MeTTa();
    registerJsonModule(m);
    // an array decodes to an expression
    expect(m.run('!(json-decode "[1, 2, 3]")')[0]!.map((a) => a.toString())).toEqual(["(1 2 3)"]);
    // a string decodes to a String atom
    expect(m.run('!(json-decode "\\"hi\\"")')[0]!.map((a) => a.toString())).toEqual(['"hi"']);
    // a number decodes to a Number atom
    expect(m.run('!(json-decode "42")')[0]!.map((a) => a.toString())).toEqual(["42"]);
  });

  it("json-encode is the inverse for arrays and scalars", () => {
    const m = new MeTTa();
    registerJsonModule(m);
    expect(m.run('!(json-encode (json-decode "[1, 2, 3]"))')[0]!.map((a) => a.toString())).toEqual([
      '"[1,2,3]"',
    ]);
    // round-trip an object through a dict-space
    const out = m
      .run('!(json-encode (json-decode "{\\"a\\": 1, \\"b\\": 2}"))')[0]!
      .map((a) => a.toString());
    expect(out).toHaveLength(1);
    expect(JSON.parse(JSON.parse(out[0]!) as string)).toEqual({ a: 1, b: 2 });
  });

  it("json-encode of a non-JSON-encodable grounded value (an operation) is an Error atom", () => {
    const m = new MeTTa();
    registerJsonModule(m);
    // `opval` parses to a grounded atom whose content is a function (not JSON-encodable). The thrown
    // error surfaces as a MeTTa (Error ...) atom rather than crashing the run.
    m.registerAtom(
      "opval",
      OperationAtom("opval", (...a) => a),
    );
    const out = m.run("!(json-encode opval)")[0]!.map((x) => x.toString());
    expect(out.join("")).toContain("not JSON-encodable");
  });
});

describe("Module catalog", () => {
  it("clear/list/update operate on the registry and return unit", () => {
    const m = new MeTTa();
    const catalog = new ModuleCatalog();
    catalog.register("local", ["mod-a", "mod-b"]);
    catalog.register("remote", ["mod-c"]);
    registerCatalogModule(m, catalog);

    // each op returns the unit atom ()
    expect(m.run("!(catalog-list! all)")[0]!.map((a) => a.toString())).toEqual(["()"]);
    expect(catalog.listing).toEqual(["local: mod-a, mod-b", "remote: mod-c"]);

    expect(m.run("!(catalog-update! local)")[0]!.map((a) => a.toString())).toEqual(["()"]);
    expect(catalog.updated).toEqual(["local"]);

    m.run("!(catalog-clear! local)");
    expect(catalog.modules("local")).toEqual([]);
    expect(catalog.modules("remote")).toEqual(["mod-c"]);

    m.run("!(catalog-clear! all)");
    expect(catalog.modules("remote")).toEqual([]);
  });
});
