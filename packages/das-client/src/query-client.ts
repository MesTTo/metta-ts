// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Live DAS Query Agent client: host an inbound proxy node, issue `pattern_matching_query`,
// receive streamed answer bundles on the proxy, and decode them.
//
// Contract note. Released 1.0.0 serves `dasproto.AtomSpaceNode`; later das-proto HEAD renamed it to
// `DistributedAlgorithmNode`. This client uses AtomSpaceNode stubs so the call lands on the running
// agent; the wire shape is identical either way.
// Node-only: a requestor must host an inbound bus node, which a browser cannot do.
import { Server, ServerCredentials, credentials } from "@grpc/grpc-js";
import { AtomSpaceNodeClient, AtomSpaceNodeService, type MessageData } from "./gen/atom_space_node";
import type { Empty } from "./gen/common";
import { encodeQuery, type Pattern } from "./query-tokens";
import {
  collectAnswers,
  FINISHED,
  ABORT,
  PROXY_COMMAND,
  unwrapProxyMessage,
  type QueryAnswer,
} from "./answer";

export interface QueryOptions {
  /** Host for the inbound proxy node (default `127.0.0.1`). The port is OS-assigned per query, so
   *  calls never collide on a port or reuse a bus node id. */
  readonly proxyHost?: string;
  /** Address of the live DAS Query Agent that owns `pattern_matching_query`. */
  readonly agentAddress: string;
  /** Query pattern; any nested variable makes it a template. */
  readonly pattern: Pattern;
  /** Optional query context string (defaults to empty). */
  readonly context?: string;
  /** Wait deadline for FINISHED/ABORT from the agent. */
  readonly timeoutMs?: number;
  /** Request handle -> MeTTa text mappings so bindings resolve without a separate AtomDB read. */
  readonly populateMettaMapping?: boolean;
}

/** Serialize supported query parameters to das-mono Properties::tokenize triples (`key type value`). */
function paramTokens(opts: QueryOptions): string[] {
  const out: string[] = [];
  if (opts.populateMettaMapping) out.push("populate_metta_mapping", "bool", "true");
  return out;
}

export interface QueryResult {
  readonly answers: QueryAnswer[];
  readonly finished: boolean;
  readonly aborted: boolean;
}

// Per-query serial; the agent keys requests by (requestor, serial).
let serialCounter = 0;

/**
 * Issue a pattern-matching query against a live DAS Query Agent and return the decoded answers.
 *
 * Wire framing (das-mono ServiceBus::issue_bus_command + BaseQueryProxy::tokenize):
 *   command = "pattern_matching_query"
 *   args = [requestor_id, serial, requestor_proxy_node_id,
 *           numParamTokens, ...paramTokens, context, numQueryTokens, ...queryTokens]
 * With no param tokens, the agent uses its configured defaults.
 *
 * The proxy node binds an OS-assigned port (`host:0`), so its bus node id is unique to this call.
 * Concurrent and back-to-back queries avoid port collisions and the agent's "node already in the
 * network" guard.
 */
export async function queryPatternMatching(opts: QueryOptions): Promise<QueryResult> {
  const { agentAddress, pattern, context = "", timeoutMs = 8000 } = opts;
  const proxyHost = opts.proxyHost ?? "127.0.0.1";
  const received: { command: string; args: string[] }[] = [];

  const server = new Server();
  server.addService(AtomSpaceNodeService, {
    ping: (_c: unknown, cb: (e: null, a: { error: boolean; msg: string }) => void) =>
      cb(null, { error: false, msg: "PING" }),
    executeMessage: (call: { request: MessageData }, cb: (e: null, r: Empty) => void) => {
      received.push({ command: call.request.command, args: call.request.args });
      cb(null, {});
    },
  });

  let bound = false;
  try {
    const port = await new Promise<number>((res, rej) =>
      server.bindAsync(`${proxyHost}:0`, ServerCredentials.createInsecure(), (e, p) =>
        e ? rej(e) : res(p),
      ),
    );
    bound = true;
    const proxyAddress = `${proxyHost}:${port}`;
    const serial = String(serialCounter++);

    const queryTokens = encodeQuery(pattern);
    const params = paramTokens(opts);
    const args = [
      proxyAddress,
      serial,
      proxyAddress,
      String(params.length),
      ...params,
      context,
      String(queryTokens.length),
      ...queryTokens,
    ];

    const client = new AtomSpaceNodeClient(agentAddress, credentials.createInsecure());
    try {
      await new Promise<void>((res, rej) =>
        client.executeMessage(
          {
            command: "pattern_matching_query",
            args,
            sender: proxyAddress,
            isBroadcast: false,
            visitedRecipients: [],
          },
          (e) => (e ? rej(e) : res()),
        ),
      );
    } finally {
      client.close();
    }

    const deadline = Date.now() + timeoutMs;
    const done = (): boolean =>
      received.some((m) => {
        if (m.command !== PROXY_COMMAND) return false;
        const c = unwrapProxyMessage(m.args).command;
        return c === FINISHED || c === ABORT;
      });
    while (Date.now() < deadline && !done()) await new Promise((r) => setTimeout(r, 100));
  } finally {
    if (bound) await new Promise<void>((r) => server.tryShutdown(() => r()));
    else server.forceShutdown();
  }

  return collectAnswers(received);
}
