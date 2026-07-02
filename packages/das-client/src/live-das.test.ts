// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { credentials } from "@grpc/grpc-js";
import { AtomSpaceNodeClient } from "./gen/atom_space_node";

// Live integration: ping the running DAS Query Agent on :40002 over its actual (pre-rename)
// AtomSpaceNode gRPC contract. Skipped unless a DAS is up (DAS_LIVE=1).
const run = process.env.DAS_LIVE === "1" ? it : it.skip;
describe("live DAS", () => {
  run("pings the real Query Agent over gRPC", async () => {
    const c = new AtomSpaceNodeClient("127.0.0.1:40002", credentials.createInsecure());
    const ack = await new Promise<{ error: boolean; msg: string }>((res, rej) =>
      c.ping({}, (e, a) => (e ? rej(e) : res(a))),
    );
    c.close();
    console.log("LIVE DAS AtomSpaceNode.ping ->", JSON.stringify(ack));
    expect(ack).toBeDefined();
  });
});
