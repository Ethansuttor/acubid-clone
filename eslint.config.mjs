// Next 16 removed `next lint`; these are the flat configs it used to wrap.
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      ".agents/**",
      // Isolated agent checkouts: each is linted from its own root.
      ".claude/worktrees/**",
      "eval-out/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  ...coreWebVitals,
  ...typescript,
];

export default config;
