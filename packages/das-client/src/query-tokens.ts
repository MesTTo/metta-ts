// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Encode DAS `pattern_matching_query` tokens from a query pattern.
// Grammar: das-mono PatternMatchingQueryProcessor::setup_query_tree
// (src/agents/query_engine/PatternMatchingQueryProcessor.cc): a prefix token stream the agent
// walks as a stack machine. Token widths: NODE/LINK/LINK_TEMPLATE consume 3 header tokens then
// their children; VARIABLE/ATOM consume 2. A link with any variable inside is a LINK_TEMPLATE;
// a fully-ground link is a LINK; a leaf symbol is a NODE; a bound atom handle is an ATOM.

// DAS token keywords (das-mono commons/atoms/LinkSchema.cc).
const LinkSchema = {
  ATOM: "ATOM",
  NODE: "NODE",
  LINK: "LINK",
  UNTYPED_VARIABLE: "VARIABLE",
  LINK_TEMPLATE: "LINK_TEMPLATE",
} as const;

export type Pattern =
  | { kind: "node"; type: string; name: string }
  | { kind: "var"; name: string }
  | { kind: "atom"; handle: string }
  | { kind: "expr"; children: Pattern[] };

/** A leaf symbol node, e.g. `EVALUATION` -> NODE Symbol EVALUATION. */
export const node = (name: string, type = "Symbol"): Pattern => ({ kind: "node", type, name });
/** A query variable, e.g. `$C` -> VARIABLE C. */
export const variable = (name: string): Pattern => ({ kind: "var", name });
/** An expression (link), e.g. `(CONCEPT $C)`. */
export const expr = (...children: Pattern[]): Pattern => ({ kind: "expr", children });

/** True if any nested variable makes the enclosing link a LINK_TEMPLATE. */
function hasVar(p: Pattern): boolean {
  switch (p.kind) {
    case "var":
      return true;
    case "node":
    case "atom":
      return false;
    case "expr":
      return p.children.some(hasVar);
  }
}

/** Emit the prefix token stream for a pattern (the `query` argument of a pattern_matching_query). */
export function encodeQuery(p: Pattern, linkType = "Expression"): string[] {
  switch (p.kind) {
    case "node":
      return [LinkSchema.NODE, p.type, p.name];
    case "var":
      return [LinkSchema.UNTYPED_VARIABLE, p.name];
    case "atom":
      return [LinkSchema.ATOM, p.handle];
    case "expr": {
      const head = hasVar(p) ? LinkSchema.LINK_TEMPLATE : LinkSchema.LINK;
      const tokens = [head, linkType, String(p.children.length)];
      for (const c of p.children) tokens.push(...encodeQuery(c, linkType));
      return tokens;
    }
  }
}
