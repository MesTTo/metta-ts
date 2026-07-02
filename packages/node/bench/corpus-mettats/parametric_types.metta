; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/parametric_types.metta for MeTTa-TS (Hyperon) conventions.

(: apply (-> (-> $tx $ty) $tx $ty))
(= (apply $f $x) ($f $x))
!(test (apply not False) True)
!(test (get-type (apply not False)) Bool)
; In Hyperon a `let`'s pattern (first argument) is matched but not evaluated; only the value (second
; argument) is evaluated. So `(get-type apply)` must be the value, with the arrow as the pattern, for the
; type variable $result to bind. (PeTTa evaluates the first argument, hence its reversed order.)
!(test (let (-> (-> Bool Bool) Bool $result) (get-type apply) $result)
       Bool)
