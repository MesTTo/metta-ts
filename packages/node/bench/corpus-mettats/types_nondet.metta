; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/types_nondet.metta for MeTTa-TS (Hyperon) conventions.

(: f (-> Type1 Type1))
(: f (-> Type2 Type2))
(= (f $a)
   (if (== $a T1in)
       T1out
       (if (== $a T2in)
           T2out
           Tdefault)))

(: T1in Type1)
(: T1out Type1)
(: T2in Type2)
(: T2out Type2)

(: T3in Type1)
(: Tdefault Type2)

!(test (f T1in) T1out)
!(test (f T2in) T2out)
!(test (f T3in) ()) ;Type1 of T3in does not go along with Type2 output
(: T3in Type2)      ;But if we make T3in also of Type2 then it is fine if output is Type2:
!(test (f T3in) Tdefault)
