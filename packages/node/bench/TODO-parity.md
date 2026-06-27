# MeTTa-TS ⟷ PeTTa parity

Goal: pass and outrun PeTTa on the example corpus while staying byte-identical to Hyperon. Re-benchmark
after each change; the oracle stays 270/270 throughout.

## Status (`corpus-bench --engine=both`)

107 examples (42 host-FFI / PeTTa-execution-model cases excluded as N/A). MeTTa-TS passes 95; both engines
pass 95; MeTTa-TS is faster on 92/95, median ~2.2x (geomean ~2.0x), faster in aggregate. The 12 non-passing
split into PLN/NARS lib ports, four perf outliers (matespace×3, tilepuzzle, greedy_chess), and selfprog —
none a Hyperon-faithfulness gap.

## Done

- Corpus `bench/corpus-mettats/`: the PeTTa examples adapted to Hyperon conventions, attributed to PeTTa (MIT).
- Engine bugs fixed (genuine, not adaptations): `sealed`/`|->` body laziness; grounded-op type declarations;
  alpha-unique-atom; occurs check on rebind reconciliation (nilbc); `add-atom`/`remove-atom` store unreduced
  + `add-reducts` reduces; compile tuple-memo key; parser string round-trip; `if` return type `$t`.
- Perf (all 270/270 byte-identical): O(1)-stack reduce trampoline; Set-based binding path; deferred rhs
  freshening + candidate pre-filter; `getTypes` memo; persistent ground-fact exact-match index (peano
  15.4s→3.7s); count-without-materialise + O(1) worklist (permutations un-timed-out); runtime-rule tabling
  (fibadd); tuple compilation + PeTTa-style higher-order specialiser + param-type inference
  (patrick_iterate_quad >90s→0.31s); scoped matcher (rename-at-bind); worker-thread race for
  `(once (hyperpose …))` (hyperpose_primes 15s timeout→1.4s).
- Opt-in `curry` module (core stays Hyperon-pure).
- Two review passes: dead code removed, inelegances fixed, jscpd clean.

## Remaining

1. **PLN / NARS lib ports.** lib_pln (pln_direct/roman/tuffy), lib_nars (nars_direct/tuffy), lib_roman
   (roman_test). The truth arithmetic ports cleanly, but the example files use PeTTa execution-model
   primitives (`cut`, `reduce`, `(cons , $args)`, `progn`), so a faithful pass needs the examples rewritten
   in Hyperon style, not just a lib port.
2. **Perf outliers (architectural).** matespace×3 / tilepuzzle time out; nilbc / permutations / peano pass
   but trail PeTTa. All are allocation-bound symbolic atomspace search at the per-reduction floor (~1M atoms
   matched O(K²) times). The match is already head-indexed, so the floor is per-result case-body evaluation;
   crossing it needs symbolic compilation of the atomspace ops (MORK-scale) and/or streamed factorised emit,
   not a constant-factor matcher win.
3. **selfprog.** Two parts. (a) remove-atom of a static top-level rule: `eraseSpace` erases only the runtime
   `selfExtra` log, not `env.ruleIndex`, so the rule still reduces. Fix is a copy-on-write `removedStatic`
   tombstone on the World (stays branch-local like `selfExtra`), filtered in `candidates()`/`selfAtoms`
   behind an empty-set fast path, with compiled/tabling caches invalidated for a tombstoned head. (b) strict
   `repr`: a PeTTa primitive that evaluates its argument; @metta-ts types it lazy (`Atom`) for the curry
   repr-of-partial tests.

## Excluded (N/A): PeTTa execution model, not Hyperon

- Host FFI: python, torch, prolog, git, llm, repl.
- Prolog execution model: cons-list matching `(cons $h $t)`, reverse/inverted function matching,
  head-eval-then-apply, `=`-as-unification, `call`/`eval`/`reduce` full-eval, unify-as-space-query.
- 2-arg `if` (ifsimple, booleansolver); partial-application/currying (library, holbenchmark, …); the PeTTa
  specializer (specializefunctiontypes); relational logic (logicprog, scale).
- superpose-as-union (mettaset, metta4_streams, casenew): Hyperon cross-products the tuple, so an `(empty)`
  element empties the whole superpose. Verified against the LeaTTa binary.
- overloaded-function dispatch (types_nondet): `(Error (f T1in) (BadArgType 1 Type2 Type1))` byte-identical
  to the LeaTTa binary; PeTTa's answer is PeTTa-only.

## Corpus adaptation conventions

- `assertEqual`/`assert*` return `()` on pass (PeTTa returns True). `assertEqualToResult`'s 2nd arg is the
  expected result set (a tuple, unevaluated); collapse of one result `r` is `(r)`.
- Bool literals `True`/`False`; collapse is a bare tuple; floats render full IEEE.
- Math returns Float: pow/sqrt/log/min-atom/max-atom, and trunc/ceil/floor/round on float input.
- `==` is `(-> $t $t Bool)`; Hyperon has no `!=`.
- Keep MeTTa-TS Hyperon-correct; never bend the engine to a PeTTa-ism.
