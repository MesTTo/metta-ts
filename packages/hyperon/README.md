# @metta-ts/hyperon

A TypeScript class API for MeTTa atoms, spaces, and a runner, modeled on Hyperon's `hyperon.atoms`
and `hyperon.base`. Where the Python package wraps a Rust core over FFI, this one wraps the immutable
terms of [`@metta-ts/core`](../core) in classes. It runs anywhere TypeScript runs, with no native
addon and no WASM.

Hyperon's Python method names are kept as aliases next to the idiomatic TypeScript ones, so code
ported from `hyperon` reads naturally: `get_name()` sits beside `name()`, `get_children()` beside
`children()`, `add_atom()` beside `addAtom()`.

## Atoms

You build atoms with the short constructors `S`, `V`, `E`, `G`, and `ValueAtom`:

```ts
import { S, V, E, ValueAtom } from "@metta-ts/hyperon";

S("parent");                       // a symbol
V("x");                            // a variable, prints as $x
E(S("parent"), S("tom"), V("c"));  // an expression (parent tom $c)
ValueAtom(42);                     // a grounded number
ValueAtom("hi");                   // a grounded string, prints as "hi"
```

Every atom answers `metatype()`, `equals(other)`, `toString()`, `iterate()` (depth-first), and
`matchAtom(other)`. The kinds are `SymbolAtom`, `VariableAtom`, `ExpressionAtom`, and `GroundedAtom`;
`SymbolAtom.name()` and `ExpressionAtom.children()` read the parts.

## Matching and bindings

`matchAtom` returns a `BindingsSet`, a set of binding frames. An empty set means no match.

```ts
import { S, V, E, ValueAtom } from "@metta-ts/hyperon";

const set = E(S("point"), V("x"), V("y"))
  .matchAtom(E(S("point"), ValueAtom(1), ValueAtom(2)));

const frame = set.frames[0];
frame.resolve(V("x"))?.toString(); // "1"
frame.resolve(V("y"))?.toString(); // "2"
```

A `Bindings` frame records associations with `addVarBinding(v, atom)`, reads them with
`resolve(v)` and `pairs()`, and combines with another frame via `merge`.

## Spaces

A `GroundingSpace` holds atoms. You add, query, and substitute:

```ts
import { GroundingSpace, S, V, E } from "@metta-ts/hyperon";

const sp = new GroundingSpace();
sp.addAtom(E(S("parent"), S("tom"), S("bob")));
sp.addAtom(E(S("parent"), S("tom"), S("liz")));

sp.subst(E(S("parent"), S("tom"), V("c")), V("c"))
  .map((a) => a.toString());       // ["bob", "liz"]
```

For a Distributed AtomSpace backend, see [`@metta-ts/das-client`](../das-client), whose `DasLiveSpace`
is the async analogue (a remote query is a network round-trip).

## Running MeTTa

The `MeTTa` runner evaluates programs and keeps its knowledge base across `run` calls.
Non-bang atoms extend the knowledge base; each `!`-query returns its results.

```ts
import { MeTTa } from "@metta-ts/hyperon";

const m = new MeTTa();
m.run("(= (color) red)\n(= (color) green)");
m.run("!(color)")[0].map((a) => a.toString()); // ["red", "green"]
m.run("!(+ 1 2)")[0].map((a) => a.toString());  // ["3"]
```

`registerOperation(name, fn)` adds a grounded operation callable from
MeTTa source; the function takes the argument atoms and returns the result atoms:

```ts
import { MeTTa, ValueAtom, GroundedAtom } from "@metta-ts/hyperon";

const m = new MeTTa();
m.registerOperation("double", (args) => {
  const n = (args[0] as GroundedAtom).object().content as number;
  return [ValueAtom(n * 2)];
});
m.run("!(double 21)")[0].map((a) => a.toString()); // ["42"]
```

`registerToken(regex, constr)` registers a custom token, `space()` exposes the knowledge base, and
`getAtomTypes(atom)` returns the types the runner infers for an atom.

The runner's `space()` is live: an atom added through it reaches the evaluator
exactly as a non-bang atom in `run` does, querying it sees what the evaluator sees, and removing an
atom retracts it from evaluation.

```ts
const m = new MeTTa();
m.space().addAtom(parseRule("(= (greeting) hello)")); // reaches evaluation
m.run("!(greeting)")[0].map((a) => a.toString());     // ["hello"]
```

## Grounded objects

`ValueObject`, `OperationObject`, and `MatchableObject` wrap a JS value, a function, or a
custom-matching value. `ValueAtom` converts primitives for you (`number` to Number, `string` to
String, `boolean` to Bool); `G(obj, type?)` wraps any `GroundedObject`, and `GroundedAtom.object()`
recovers it.

Wrapping a non-primitive object registers it in a process-global table (the core's grounded value
carries only an id, and the object must outlive any single wrapper). A long-running host that creates
many grounded objects can reclaim that memory with `clearGroundedObjects()` once no grounded `ext`
atom is still in use.

## Optional modules

Two grounded-operation modules from hyperon-experimental ship as opt-in registrations on a runner.

The JSON module gives you `dict-space`, `get-keys`, `get-value`, `json-decode`, and `json-encode`:

```ts
import { MeTTa, registerJsonModule } from "@metta-ts/hyperon";

const m = new MeTTa();
registerJsonModule(m);
m.run('!(json-decode "[1, 2, 3]")')[0].map((a) => a.toString());          // ["(1 2 3)"]
m.run('(= (d) (dict-space ((a 1) (b 2))))');
m.run("!(get-value (d) a)")[0].map((a) => a.toString());                  // ["1"]
```

The module catalog gives you `catalog-clear!`, `catalog-list!`, and `catalog-update!` over a
`ModuleCatalog` you populate yourself (the dependency-free analogue of Hyperon's remote catalogs):

```ts
import { MeTTa, ModuleCatalog, registerCatalogModule } from "@metta-ts/hyperon";

const m = new MeTTa();
const catalog = new ModuleCatalog();
catalog.register("local", ["mod-a", "mod-b"]);
registerCatalogModule(m, catalog);
m.run("!(catalog-list! all)");   // returns (); records into catalog.listing
```

## JavaScript interop

Hyperon's Python binding has `py-atom`/`py-dot` to call Python from MeTTa, bridged over FFI. Here the
engine is TypeScript, so there is no bridge: a grounded atom can hold a JS function and the interpreter
runs it directly. `registerJsInterop(m)` exposes that (opt-in, since it can call arbitrary global JS):

```ts
import { MeTTa, registerJsInterop } from "@metta-ts/hyperon";

const m = new MeTTa();
registerJsInterop(m);
m.run(`!((js-atom "Math.abs") -5)`)[0];                    // 5
m.run(`!((js-atom "Math.max") 3 7 2)`)[0];                 // 7
m.run(`!((js-dot "hello world" "toUpperCase"))`)[0];       // "HELLO WORLD"
m.run(`!((js-dot (js-list (5 1 3)) "join") "-")`)[0];      // "5-1-3"
m.run(`!(js-dot (js-dict (("a" 1) ("b" 2))) "b")`)[0];     // 2
```

`js-atom` resolves a dotted path from `globalThis` into a grounded atom (an executable one if it is a
function); `js-dot` reads a property or method (methods come back bound to their object); `js-list` and
`js-dict` build a JS array or object from MeTTa atoms.

An `OperationAtom` that heads an expression is run by the interpreter, so a JS function wrapped as an
atom is callable in-language. That is also what makes `registerAtom` with an `OperationAtom` work like
Python's `bind! abs (py-atom ...)`:

```ts
m.registerAtom("dbl", OperationAtom("dbl", (a) =>
  [ValueAtom((a as GroundedAtom).object().content as number * 2)]));
m.run("!(dbl 21)")[0];                                     // 42
```

A grounded operation that throws surfaces as a MeTTa `(Error ...)` atom (an error the program can
still inspect) rather than crashing the run. `evaluateAtom(atom)` evaluates a single constructed atom
(the atom-level counterpart of `run`).

## Docs

API docs are generated with TypeDoc from the TSDoc comments: `pnpm --filter @metta-ts/hyperon docs`.
