// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Decode DAS bus answers: proxy-peer messages streamed by an agent after `pattern_matching_query`.
// Faithful to das-mono's BaseQueryProxy +
// QueryAnswer::tokenize (src/agents/BaseQueryProxy.cc, src/agents/query_engine/QueryAnswer.cc).
//
// Wire shape. The agent's proxy node calls `to_remote_peer(command, args)`, which the bus delivers
// as an `execute_message` with command = "bus_command_proxy" and args = [...innerArgs, innerCommand]
// (ProxyNode::to_remote_peer appends the inner command last).
// The inner commands that carry results are:
//   - "answer_bundle"  innerArgs = [tokenizedAnswer, tokenizedAnswer, ...]
//   - "finished"       innerArgs = []   (no more answers)
//   - "abort"          innerArgs = []   (query aborted)
//
// Each tokenized answer (QueryAnswer::tokenize) is one space-separated string. The released 1.0.0
// agent emits a flat handle list (verified against a live agent):
//   strength importance
//   <numHandles>     handle...
//   <assignmentSize> [ label handle ]...
//   <mettaMapSize>   [ handle mettaExpr ]...
// The client uses the assignment (variable label -> matched atom handle). The trailing metta map is
// empty unless POPULATE_METTA_MAPPING is set, and it follows the assignment so it cannot affect parsing.

export const PROXY_COMMAND = "bus_command_proxy";
export const ANSWER_BUNDLE = "answer_bundle";
export const FINISHED = "finished";
export const ABORT = "abort";

/** One query answer: variable bindings, matched link handles, and optional handle -> MeTTa text. */
export interface QueryAnswer {
  readonly assignment: Record<string, string>;
  readonly handles: readonly string[];
  readonly metta: Record<string, string>;
}

/** Unwrap a `bus_command_proxy` message into its inner peer command and arguments. */
export function unwrapProxyMessage(args: readonly string[]): { command: string; args: string[] } {
  if (args.length === 0) throw new Error("empty bus_command_proxy args");
  return { command: args[args.length - 1]!, args: args.slice(0, -1) };
}

/** Parse one `QueryAnswer::tokenize` string into assignment, matched handles, and optional handle -> MeTTa text.
 *  MeTTa values may contain spaces and parentheses, so scan with a cursor instead of splitting,
 *  matching das-mono QueryAnswer::untokenize (read_token + read_metta_expression). */
export function parseQueryAnswer(token: string): QueryAnswer {
  const s = token;
  let i = 0;
  const word = (what: string): string => {
    while (i < s.length && s[i] === " ") i++;
    const start = i;
    while (i < s.length && s[i] !== " ") i++;
    if (i === start)
      throw new Error(`malformed query answer: expected ${what} at offset ${start} in <${s}>`);
    return s.slice(start, i);
  };
  const count = (what: string): number => {
    const w = word(what);
    const n = Number(w);
    if (!Number.isInteger(n) || n < 0)
      throw new Error(`malformed query answer: expected ${what} count, got <${w}> in <${s}>`);
    return n;
  };
  // MeTTa expression value: balanced (...), a "..." string, or a bare token.
  const mettaExpr = (): string => {
    while (i < s.length && s[i] === " ") i++;
    const start = i;
    if (s[i] === "(") {
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (; i < s.length; i++) {
        const c = s[i];
        if (inStr) {
          if (esc) esc = false;
          else if (c === "\\") esc = true;
          else if (c === '"') inStr = false;
        } else if (c === '"') inStr = true;
        else if (c === "(") depth++;
        else if (c === ")" && --depth === 0) {
          i++;
          break;
        }
      }
      if (depth !== 0)
        throw new Error(`malformed query answer: unbalanced parens in metta expr <${s}>`);
      return s.slice(start, i);
    }
    if (s[i] === '"') {
      i++;
      let esc = false;
      let closed = false;
      for (; i < s.length; i++) {
        const c = s[i];
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') {
          i++;
          closed = true;
          break;
        }
      }
      if (!closed)
        throw new Error(`malformed query answer: unterminated string in metta expr <${s}>`);
      return s.slice(start, i);
    }
    return word("metta expr");
  };

  word("strength");
  word("importance");
  const handles: string[] = [];
  const numHandles = count("handles");
  for (let k = 0; k < numHandles; k++) handles.push(word("handle"));
  const assignment: Record<string, string> = {};
  const asgSize = count("assignment size");
  for (let k = 0; k < asgSize; k++) {
    const label = word("variable label");
    assignment[label] = word("variable handle");
  }
  const metta: Record<string, string> = {};
  const mettaSize = count("metta-map size");
  for (let k = 0; k < mettaSize; k++) {
    const handle = word("metta handle");
    metta[handle] = mettaExpr();
  }
  return { assignment, handles, metta };
}

/** Fold received proxy messages into answers plus FINISHED/ABORT state.
 *  Only `bus_command_proxy` messages carry answers. */
export function collectAnswers(
  messages: ReadonlyArray<{ command: string; args: readonly string[] }>,
): { answers: QueryAnswer[]; finished: boolean; aborted: boolean } {
  const answers: QueryAnswer[] = [];
  let finished = false;
  let aborted = false;
  for (const m of messages) {
    if (m.command !== PROXY_COMMAND) continue;
    const inner = unwrapProxyMessage(m.args);
    switch (inner.command) {
      case ANSWER_BUNDLE:
        for (const tok of inner.args) answers.push(parseQueryAnswer(tok));
        break;
      case FINISHED:
        finished = true;
        break;
      case ABORT:
        aborted = true;
        break;
      default:
        break;
    }
  }
  return { answers, finished, aborted };
}
