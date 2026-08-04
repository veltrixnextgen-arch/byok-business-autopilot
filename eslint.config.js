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
    // .output/.vercel/.nitro are build artifacts (see .gitignore) — CI
    // runs `npm run typecheck` (a real `vite build`) before `npm run lint`,
    // so these exist on disk at lint time. Nitro's own generated chunks
    // carry inline eslint-disable comments for rules (eslint-plugin-unicorn)
    // this repo's config never loads, which ESLint treats as an error for
    // an unknown rule ID, not a no-op.
    ignores: ["**/dist/**", "**/node_modules/**", "**/routeTree.gen.ts", "**/.output/**", "**/.vercel/**", "**/.nitro/**"],
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
