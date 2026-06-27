; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/superpose_nested.metta for MeTTa-TS (Hyperon) conventions.

(= (progme)
   ((collapse (superpose ((superpose (a b c)) (superpose (x y z)))))
    (collapse (superpose (a b c)))
    (collapse (superpose ((superpose (a b c)))))
    (collapse (superpose ((superpose (a b c)) x y z )))))

; A tuple whose elements are themselves nondeterministic evaluates to the cross-product of those
; elements (each combination is one result), so (superpose ((superpose (a b c)) (superpose (x y z))))
; yields a×x, a×y, … not the union a b c x y z. This is the Hyperon semantics, verified byte-for-byte
; against the LeaTTa reference binary; PeTTa instead flattens nested superposes into a union.
!(test (progme)
       ((a x a y a z b x b y b z c x c y c z) (a b c) (a b c) (a x y z b x y z c x y z)))
