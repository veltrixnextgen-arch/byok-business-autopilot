import tsParser from "@typescript-eslint/parser";

// ADR-009: the shell (apps/api, apps/web) may only import trust-core
// packages through their public interface — a bare `@byok/<package>`
// import, which resolves to that package's index.ts (router dispatch,
// queue resolution, vault lifecycle, gate config). Any deeper path
// (e.g. `@byok/router/src/router.js`, `@byok/vault/kms.js`) reaches past
// that seam into implementation detail. This turns the Emergent boundary
// into something the build fails on, not just a reviewed convention.
const TRUST_CORE_PACKAGES = ["@byok/router", "@byok/vault", "@byok/cost-gate", "@byok/approval-queue"];

export default [
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/routeTree.gen.ts"],
  },
  {
    files: ["apps/api/**/*.ts", "apps/web/**/*.ts", "apps/web/**/*.tsx"],
    languageOptions: {
      parser: tsParser,
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: TRUST_CORE_PACKAGES.map((pkg) => ({
            group: [`${pkg}/*`],
            message: `Deep import into ${pkg} is not allowed here — import only its public interface (bare "${pkg}"). See ADR-009.`,
          })),
        },
      ],
    },
  },
];
