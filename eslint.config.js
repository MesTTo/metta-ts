// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/*.config.*", "packages/*/src/prelude.ts", "docs/**", "corpus/**", "**/src/gen/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["packages/*/src/**/*.ts"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Convention C2: every switch on a discriminated union is exhaustive (type-aware).
      // A `default` clause counts as exhaustive (we use it for the catch-all cases).
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      // C9/C8: we use `!` deliberately after explicit bounds checks in the hot path.
      "@typescript-eslint/no-non-null-assertion": "off",
      // C1: never delete a property (V8 dictionary mode).
      "no-restricted-syntax": ["error", { selector: "UnaryExpression[operator='delete']", message: "Do not delete properties (V8 dictionary mode); set to undefined." }],
    },
  },
  prettier,
);
