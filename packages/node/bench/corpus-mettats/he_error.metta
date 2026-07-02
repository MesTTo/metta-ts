; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/he_error.metta for MeTTa-TS (Hyperon) conventions.


; The `catch` tests are omitted: `catch` is PeTTa's Prolog exception catch, not a Hyperon op. Hyperon
; surfaces errors as `(Error …)` atoms that `if-error`/`return-on-error` inspect directly, no catch needed.
; The `(return-on-error (Error …) 6)` test is omitted too: Hyperon's return-on-error wraps its result in
; `return` for use inside a `function`, so a bare call yields `(return (Error …))`, not the bare error.

!(test (if-error (Error 5 BadType) "Error!" "No error")
       "Error!")

!(test (return-on-error 5 6) 6)
