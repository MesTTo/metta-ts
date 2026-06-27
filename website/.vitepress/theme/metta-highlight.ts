// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// A small MeTTa syntax highlighter for the live sandbox. The token categories follow metta-wam's
// TextMate grammar (libraries/lsp_server_metta/vscode/syntaxes/mettalanguage.json): comments `;`, the
// control symbols `: = -> !`, the operator `==`, `$variables`, `&space-refs`, `@atoms`, parentheses,
// strings, and numbers. The colors (see MettaRunner.vue) are extracted from metta-lang.dev, which uses
// the GitHub Light/Dark themes (green parens, red operators, orange variables, blue numbers).
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const TOKEN =
  /(;[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\$[A-Za-z_][\w\-*]*!?)|(&[A-Za-z_][\w\-*]*!?)|(@[A-Za-z_][\w\-*]*!?)|(->|==)|(-?\d+(?:\.\d+)?)|([:=!])|([()])/g;

/** Highlight MeTTa source as HTML, wrapping tokens in `mh-*` spans. */
export function highlightMetta(code: string): string {
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(code)) !== null) {
    if (m.index > last) out += esc(code.slice(last, m.index));
    const t = m[0];
    let cls: string;
    if (m[1] !== undefined) cls = "mh-comment";
    else if (m[2] !== undefined) cls = "mh-string";
    else if (m[3] !== undefined) cls = "mh-var";
    else if (m[4] !== undefined) cls = "mh-spaceref";
    else if (m[5] !== undefined) cls = "mh-at";
    else if (m[6] !== undefined) cls = t === "==" ? "mh-operator" : "mh-control";
    else if (m[7] !== undefined) cls = "mh-number";
    else if (m[8] !== undefined) cls = "mh-control";
    else cls = "mh-paren";
    out += `<span class="${cls}">${esc(t)}</span>`;
    last = m.index + t.length;
  }
  out += esc(code.slice(last));
  return out;
}
