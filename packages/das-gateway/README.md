# @metta-ts/das-gateway

A transport-agnostic gateway that bridges [MeTTa TS](https://github.com/MesTTo/Meta-TypeScript-Talk) to a SingularityNET Distributed AtomSpace (DAS). It encodes a pattern query, sends it over an injected transport (Connect/HTTP, usable from the browser), and decodes the bindings back into MeTTa atoms.

## Install

```bash
npm install @metta-ts/das-gateway
```

## Usage

```ts
import { queryDas, type GatewayTransport } from "@metta-ts/das-gateway";
import { parse, standardTokenizer } from "@metta-ts/core";

// You provide the transport (e.g. a Connect client). The gateway is browser-reachable over HTTP.
const transport: GatewayTransport = {
  /* query(request) => Promise<QueryResponse> */
};

const pattern = parse("(Parent $x Bob)", standardTokenizer())!;
const bindings = await queryDas(transport, "&self", pattern);
```

Querying a DAS involves network I/O, so the gateway's query API is async. Pair it with the async evaluation path in `@metta-ts/core` to call it from MeTTa source.

## License

[MIT](https://github.com/MesTTo/Meta-TypeScript-Talk/blob/main/LICENSE).
