; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/matchnested2.metta for MeTTa-TS (Hyperon) conventions.

(= (hide $1) (empty))

!(hide ((add-atom &self (friend tim tom))
        (add-atom &self (friend tom tam))
        (add-atom &self (friend sim som))
        (add-atom &self (friend som sam))))

!(hide (match &self (, (friend $1 $2) (friend $2 $3))
                    ((add-atom &self (transitive $1 $2 $3))
                     (remove-atom &self (friend $1 $2))
                     (remove-atom &self (friend $2 $3)))))

!(test (msort (collapse (match &self (transitive $1 $2 $3) (transitive $1 $2 $3))))
       ((transitive sim som sam) (transitive tim tom tam)))
       
