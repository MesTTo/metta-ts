// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// @metta-ts/das-gateway: browser DAS access over HTTP.
//
// Browsers cannot host inbound DAS bus nodes. They call a thin gateway that runs Node `das-client`
// server-side and exposes request/response query over HTTP (Connect over HTTP/1.1).
// This module defines the wire shape and async query helper; Connect server/client and live
// `das-client` integration need running DAS. See README.
import { type Atom, type Bindings, format, parse, standardTokenizer } from "@metta-ts/core";

/** Gateway query payloads use MeTTa source strings on the wire. */
export interface QueryRequest {
  readonly space: string;
  readonly pattern: string;
}
export interface QueryResponse {
  /** Each solution as a flat list of `[varName, atomSource]` pairs. */
  readonly bindings: ReadonlyArray<ReadonlyArray<readonly [string, string]>>;
}

/** Shared MeTTa source wire-codec helpers for gateway clients and servers. */
export const encodePattern = (a: Atom): string => format(a);
export const decodeBindings = (resp: QueryResponse): Bindings[] => {
  const tk = standardTokenizer();
  return resp.bindings.map((sol) =>
    sol.map(([x, src]) => ({ tag: "val" as const, x, a: parse(src, tk)!, y: undefined })),
  );
};

/** Async browser-to-gateway transport, for example a Connect-web client. */
export interface GatewayTransport {
  query(req: QueryRequest): Promise<QueryResponse>;
}

/** Browser-side async DAS access. Limitation: kernel `match` is synchronous while gateway transport
 *  is async, so call this directly instead of `(match &das ...)`. */
export async function queryDas(
  transport: GatewayTransport,
  space: string,
  pattern: Atom,
): Promise<Bindings[]> {
  return decodeBindings(await transport.query({ space, pattern: encodePattern(pattern) }));
}
