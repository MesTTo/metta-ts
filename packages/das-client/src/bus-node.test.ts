// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect, afterEach } from "vitest";
import { BusNode } from "./bus-node";
import type { MessageData } from "./gen/distributed_algorithm_node";

// In-process gRPC: two bus nodes exchange a ping and an execute_message command over the real
// das-proto wire (no live DAS needed; verifies the gRPC bus layer end to end).
let nodes: BusNode[] = [];
afterEach(async () => {
  await Promise.all(nodes.map((n) => n.stop()));
  nodes = [];
});

describe("BusNode (real gRPC over das-proto)", () => {
  it("ping returns the server's Ack", async () => {
    const a = new BusNode("127.0.0.1:0");
    nodes.push(a);
    // bind on an ephemeral port via the OS, then ping ourselves on a fixed test port
    const server = new BusNode("127.0.0.1:52771");
    nodes.push(server);
    await server.start();
    const ack = await a.ping("127.0.0.1:52771");
    expect(ack.error).toBe(false);
    expect(ack.msg).toBe("pong");
  });

  it("execute_message delivers a command to the peer", async () => {
    let received: MessageData | undefined;
    const server = new BusNode("127.0.0.1:52772", (m) => (received = m));
    nodes.push(server);
    await server.start();
    const client = new BusNode("127.0.0.1:0");
    nodes.push(client);
    await client.send("127.0.0.1:52772", {
      command: "bus_command_proxy",
      args: ["pattern-matching-query", "(Similarity human $s)"],
      sender: "127.0.0.1:0",
      isBroadcast: false,
      visitedRecipients: [],
    });
    expect(received?.command).toBe("bus_command_proxy");
    expect(received?.args[1]).toBe("(Similarity human $s)");
  });
});
