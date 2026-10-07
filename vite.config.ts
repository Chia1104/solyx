import { defineConfig } from "vite-plus";

import { baseConfig } from "@chiastack/oxlint/base";
import { react } from "@chiastack/oxlint/react";

// Installed agent assets and the vendored lint plugin are not project source.
const agentAndVendorPaths = [
  ".agent/**",
  ".agents/**",
  ".claude/**",
  ".codex/**",
  ".continue/**",
  ".cursor/**",
  ".gemini/**",
  ".opencode/**",
  ".pi/**",
  ".roo/**",
  ".windsurf/**",
  "tools/oxlint/anti-slop/**",
];

export default defineConfig({
  fmt: {
    printWidth: 80,
    tabWidth: 2,
    trailingComma: "es5",
    bracketSameLine: true,
    ignorePatterns: [
      ...agentAndVendorPaths,
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "coverage",
      ".vscode",
      ".idea",
    ],
    sortImports: {
      groups: [
        ["style"],
        ["builtin"],
        ["react"],
        ["external"],
        ["chiastack", "solyx"],
        ["internal"],
        ["parent"],
        ["sibling"],
        ["index"],
        "unknown",
      ],
      customGroups: [
        {
          groupName: "react",
          elementNamePattern: [
            "react",
            "react/**",
            "react-dom",
            "react-dom/**",
          ],
        },
        {
          groupName: "solyx",
          elementNamePattern: ["@solyx/*", "@solyx/**"],
        },
        {
          groupName: "chiastack",
          elementNamePattern: ["@chiastack/*", "@chiastack/**"],
        },
      ],
    },
    sortTailwindcss: {
      stylesheet: "./apps/desktop/src/renderer/styles.css",
      functions: ["clsx", "cn"],
      preserveWhitespace: true,
    },
  },
  lint: {
    extends: [baseConfig],
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    ],
    ignorePatterns: [
      ...agentAndVendorPaths,
      "**/*.d.ts",
      "dist/**",
      "build/**",
      "node_modules/**",
    ],
    options: { typeAware: true, typeCheck: true },
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      // The base preset turns the correctness category off; an unawaited order call must not slip through.
      "typescript/no-floating-promises": "error",
      "typescript/no-misused-promises": "error",
      // Dependencies mark what their next version drops; a use of it is a lint error, not a surprise at upgrade.
      "typescript/no-deprecated": "error",
      "oxc/no-accumulating-spread": "error",
      // Its preferred iterator-helper form is not in the es2023 lib, and the arrays here are small.
      "anti-slop/no-array-filter-map": "off",
      "anti-slop/no-reduce-accumulator-copy": "error",
      "anti-slop/no-chained-type-assertions": "error",
      "anti-slop/no-conditional-empty-object-spread": "error",
      "anti-slop/no-known-value-widening": "error",
      "anti-slop/no-module-mocking": "error",
      "anti-slop/no-object-parameters": "error",
      "anti-slop/no-reflect-apply": "error",
      "anti-slop/no-reflect-get": "error",
      "anti-slop/no-runtime-typeof": "error",
      "anti-slop/no-shape-in-symbol-names": "error",
      "anti-slop/no-unknown-parameters": "error",
      "anti-slop/no-unknown-returns": "error",
      "anti-slop/no-unknown-type-aliases": "error",
      "anti-slop/no-unsafe-dictionary-type": "error",
      "anti-slop/no-widen-then-assert": "error",
      "anti-slop/require-readable-spacing": "error",
      "anti-slop/require-safety-comment-for-type-assertion": "error",
    },
    overrides: [
      {
        files: ["**/*.{ts,tsx,mts,cts}"],
        rules: {
          // TypeScript intentionally allows a value and a type to share one name.
          "no-redeclare": "off",
        },
      },
      {
        files: ["apps/desktop/src/renderer/**", "packages/trading-chart/**"],
        plugins: react.plugins,
        rules: react.rules,
      },
    ],
  },
  staged: {
    "*.{js,jsx,cjs,mjs,ts,mts,tsx,json,md}":
      "vp fmt --no-error-on-unmatched-pattern",
  },
  run: {
    cache: true,
  },
});
