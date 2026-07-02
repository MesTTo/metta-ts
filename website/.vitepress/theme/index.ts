// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import MettaRunner from "./MettaRunner.vue";
import "./custom.css";

// Extend the default VitePress theme with the live MeTTa sandbox component, available in any page as
// <MettaRunner>.
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("MettaRunner", MettaRunner);
  },
} satisfies Theme;
