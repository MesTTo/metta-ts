// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { defineConfig } from "vitepress";

// The MeTTa TS documentation site. Structure mirrors metta-lang.dev/docs/learn: a Learn track for the
// MeTTa language itself, plus TypeScript-specific tracks (using MeTTa from TypeScript, the typed eDSL,
// and advanced topics) since this implementation runs in the same language you embed it in.
export default defineConfig({
  title: "MeTTa TS",
  description: "A pure-TypeScript implementation of MeTTa, the OpenCog Hyperon language.",
  // Served as a project page at https://mestto.github.io/Meta-TypeScript-Talk/.
  base: "/Meta-TypeScript-Talk/",
  cleanUrls: true,
  markdown: {
    // MeTTa is Scheme-like; highlight ```metta blocks with the Scheme grammar.
    languageAlias: { metta: "scheme" },
    // Match metta-lang.dev: the GitHub Light/Dark themes.
    theme: { light: "github-light", dark: "github-dark" },
  },
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/introduction" },
      { text: "Learn MeTTa", link: "/learn/evaluation/main-concepts" },
      { text: "TypeScript", link: "/typescript/running-metta" },
      { text: "eDSL", link: "/edsl/overview" },
      { text: "Advanced", link: "/advanced/concurrency" },
      { text: "Reference", link: "/reference/packages" },
      { text: "Playground", link: "/playground" },
      { text: "GitHub", link: "https://github.com/MesTTo/Meta-TypeScript-Talk" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Introduction", link: "/guide/introduction" },
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Playground", link: "/playground" },
        ],
      },
      {
        text: "Learn MeTTa",
        collapsed: false,
        items: [
          {
            text: "Introduction to evaluation",
            collapsed: false,
            items: [
              { text: "Main concepts", link: "/learn/evaluation/main-concepts" },
              { text: "Basic evaluation", link: "/learn/evaluation/basic-evaluation" },
              { text: "Recursion and control", link: "/learn/evaluation/recursion" },
              { text: "Free variables and nondeterminism", link: "/learn/evaluation/nondeterminism" },
            ],
          },
          { text: "Exercises", link: "/learn/exercises" },
        ],
      },
      {
        text: "Using MeTTa from TypeScript",
        collapsed: false,
        items: [
          { text: "Running MeTTa in TypeScript", link: "/typescript/running-metta" },
          { text: "Grounded operations", link: "/typescript/grounded-operations" },
          { text: "Embedding TypeScript objects", link: "/typescript/embedding-objects" },
          { text: "Async MeTTa", link: "/typescript/async" },
          { text: "JavaScript interop", link: "/typescript/js-interop" },
        ],
      },
      {
        text: "The typed eDSL",
        collapsed: false,
        items: [{ text: "Overview", link: "/edsl/overview" }],
      },
      {
        text: "Advanced",
        collapsed: false,
        items: [
          { text: "Concurrency and transactions", link: "/advanced/concurrency" },
          { text: "Scaling to millions of atoms", link: "/advanced/scaling" },
          { text: "Distributed AtomSpace", link: "/advanced/das" },
        ],
      },
      {
        text: "API reference",
        collapsed: false,
        items: [
          { text: "Packages overview", link: "/reference/packages" },
          { text: "@metta-ts/core", link: "/reference/core" },
          { text: "@metta-ts/hyperon", link: "/reference/hyperon" },
          { text: "@metta-ts/edsl", link: "/reference/edsl" },
          { text: "@metta-ts/node and browser", link: "/reference/node-browser" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/MesTTo/Meta-TypeScript-Talk" }],
    search: { provider: "local" },
    footer: {
      message: "Released under the MIT License.",
      copyright: "MeTTa TS",
    },
  },
});
