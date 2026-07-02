// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { type Atom } from "./atom";
import { stdTable } from "./builtins";
import { compileEnv } from "./compile";
import { buildEnv, initSt, mettaEval } from "./eval";
import { parseAll, format } from "./parser";
import { standardTokenizer, preludeAtoms } from "./runner";
import { analyzePurity } from "./tabling";

export const programAtoms = (src: string) =>
  parseAll(src, standardTokenizer())
    .filter((t) => !t.bang)
    .map((t) => t.atom);

export const bangAtoms = (src: string) =>
  parseAll(src, standardTokenizer())
    .filter((t) => t.bang)
    .map((t) => t.atom);

export const parseOne = (src: string): Atom => parseAll(src, standardTokenizer())[0]!.atom;

export function envWith(src: string) {
  const env = buildEnv([...preludeAtoms(), ...programAtoms(src)], stdTable());
  env.pureFunctors = analyzePurity(env);
  return env;
}

export function compiledEnvWith(src: string) {
  const env = envWith(src);
  env.compiled = compileEnv(env);
  env.compileDirty = false;
  return env;
}

export function evalQuery(env: ReturnType<typeof envWith>, q: Atom) {
  const [pairs, st] = mettaEval(env, 10_000_000, initSt(), [], q);
  return { results: pairs.map((p) => format(p[0])), counter: st.counter };
}
