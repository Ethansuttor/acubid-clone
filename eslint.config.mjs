// Next 16 removed `next lint`; these are the flat configs it used to wrap.
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  ...coreWebVitals,
  ...typescript,
];

export default config;
