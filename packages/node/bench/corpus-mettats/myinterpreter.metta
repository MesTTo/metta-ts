; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/myinterpreter.metta for MeTTa-TS (Hyperon) conventions.

; PeTTa's `eval` forces a full evaluation; Hyperon's `eval` is a single minimal-MeTTa step, so to fully
; interpret the held-back code we use `(metta $code %Undefined% &self)` — run $code in the interpreter
; against &self, which is the Hyperon idiom for "evaluate this expression to completion".
(: myinterpreter (-> Expression %Undefined%))
(= (myinterpreter $code)
   (let $temp (println! ("Runtime-interpreting code" $code))
        (metta $code %Undefined% &self)))

(= (w) 42)
(= (v) 43)

!(test (myinterpreter (if (== 1 1) (w) (v))) 42)
!(test (myinterpreter (if (== 1 2) (w) (v))) 43)
