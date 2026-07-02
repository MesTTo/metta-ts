# @metta-ts/das-client

A client for SingularityNET's Distributed AtomSpace (DAS). It lets a MeTTa TS program query a remote, shared atomspace over gRPC, and it presents that DAS as a `Space` backend, so a DAS drops in wherever an in-memory space would. It is Node-only, because a participant hosts an inbound bus node; from the browser you reach a DAS through [`@metta-ts/das-gateway`](../das-gateway).

## Install

```bash
npm install @metta-ts/das-client
```

## Querying a DAS

A DAS query is a network round-trip, so it is asynchronous. `DasLiveSpace` is the async analogue of an in-memory space, and `matchAsync` is the async analogue of `(match space pattern template)`: it queries the space and instantiates a template under each binding.

```ts
import { DasLiveSpace, matchAsync } from "@metta-ts/das-client";
import { sym, expr, variable } from "@metta-ts/core";

const A = (...xs) => expr(xs);
const space = new DasLiveSpace(/* connection */);

const results = await matchAsync(space, A(sym("parent"), sym("Tom"), variable("c")));
console.log(results.map(String));
```

For tests and local development, `MockTransport` exercises the same query path without a running DAS. Build a `DasSpace` over it, run your queries against canned answers, then swap in the real transport.

## Running against a live DAS

The client is Node-only but cross-platform (Linux, macOS, Windows). The cluster below is stood up with `das-cli` + Docker; the steps and the one gotcha are what was verified on Linux. The loader (`db_loader`) and the Query Agent come from the same das image, so their atom handles agree.

```bash
git clone https://github.com/singnet/das-toolbox.git
pip install -e das-toolbox/das-cli   # in a fresh venv; the system das-cli may be stale
das-cli config set                   # accept defaults: Redis :40020, MongoDB :40021, AB :40001, QA :40002
das-cli db start                     # Redis + MongoDB
das-cli metta load /tmp/animals.metta  # via the db_loader container; animals.metta is in hyperon-experimental/integration_tests/das
das-cli ab start                     # Attention Broker
das-cli qa start                     # Query Agent (serves pattern_matching_query)

DAS_LIVE=1 pnpm vitest run packages/das-client/src/live-query.test.ts
```

Two things to know:

- **Query leaves are bare Symbols, not quoted strings.** `animals.metta` stores `is_animal`, `human`, etc. as Symbols, so build the pattern with `sym("is_animal")`, not `gstr("is_animal")` / `sym('"is_animal"')`. (An older das quoted string literals; that is gone.)
- **Linux only: pin MongoDB to 7.0.** On Linux kernels >= 6.19, das-cli's default `mongodb-community-server:8.x` refuses to start (`ERROR: ... tcmalloc ... known issue with the v6.19 and newer Linux kernel`). Set `MONGODB_IMAGE_NAME = "mongo"` and `MONGODB_IMAGE_VERSION = "7.0"` in das-cli's `settings/config.py` so `db start` succeeds. Other platforms (and older kernels) run the 8.x default fine.

A pattern with a variable then returns the matched bindings:

```
(EVALUATION (PREDICATE is_animal) (CONCEPT $C))
  -> chimp earthworm ent human monkey rhino snake triceratops
```

`$C` binds to the matched `CONCEPT` node handle, not the enclosing `(CONCEPT ...)` link.

## How a query is run

`queryPatternMatching` runs the whole exchange against a Query Agent in three steps.

It encodes the pattern as a prefix token stream (`query-tokens.ts`) using the DAS opcodes `LINK_TEMPLATE`, `LINK`, `NODE`, `VARIABLE`, and `ATOM`, the same stack machine as das-mono's `PatternMatchingQueryProcessor::setup_query_tree`. A link containing a variable is a `LINK_TEMPLATE`; a fully ground one is a `LINK`.

It issues the tokens as a `pattern_matching_query` with the `ServiceBus::issue_bus_command` framing, and hosts an inbound proxy node so the agent can stream answers back.

It decodes the streamed `answer_bundle` messages (`answer.ts`): it unwraps the `bus_command_proxy` envelope, then parses each `QueryAnswer` string into its variable assignment and matched handles.

Atom-handle hashing (`handle.ts`) is a port of `hyperon_das/hasher.py` and produces the same handles as the live AtomDB, which is what makes the handles in the query and in the decoded answers line up. The encoder and decoder have offline tests built from a captured answer, so the protocol stays covered with no DAS running.

## Version matching

The released `1.0.0` Query Agent serves the `dasproto.AtomSpaceNode` service. A later `das-proto` renamed it to `DistributedAlgorithmNode`, and calling the new contract against the old agent returns gRPC `UNIMPLEMENTED`. The client carries both generated contracts, and the live path uses the one the running agent serves. Regenerate the stubs with `pnpm --filter @metta-ts/das-client gen` (needs `protoc`).
