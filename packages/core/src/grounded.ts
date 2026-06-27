// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Re-export the grounding-table API. Built-in operations are dispatched by symbol name through
// the grounding table (builtins.ts); grounded atoms (numbers, strings, bools) carry Ground values.
export { type ReduceResult, type GroundingTable, callGrounded, baseTable } from "./builtins";
