import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // eslint-plugin-react 7.37 doesn't understand ESLint 10's flat-config
    // context API; pinning the react version skips its broken auto-detect
    // path (`detectReactVersion` crashes with `getFilename is not a function`).
    settings: { react: { version: "19.2.5" } },
  },
  {
    // Project-wide no-unused-vars configuration: allow underscore-prefixed
    // names (matches the React/TypeScript ecosystem norm) and don't flag
    // `catch (e)` when the error is intentionally ignored — that's the most
    // common idiom in async code.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_|^e$|^err$|^error$",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      // React-Compiler-readiness checks ship at error severity in
      // eslint-plugin-react-hooks 7.x. They flag legitimate idioms (sync a
      // local state to an external value via useEffect) as if they were
      // bugs. We surface them as warnings so they show up in `lint` output
      // without blocking CI, until we adopt the React Compiler properly.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
    },
  },
  {
    // Electron main / preload / settings and one-off Node scripts are
    // CommonJS by design — they cannot use ESM `import` syntax in the
    // contexts where they run. Don't lint them as if they were ESM modules.
    // (Placed last so this override beats the project-wide rule above.)
    files: ["src/electron/**/*.js", "scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // Test files use `as any` extensively for mock construction and casting
    // DB query results. Surface as warnings (still visible in `lint`) rather
    // than blocking CI on every new test fixture.
    files: ["tests/**/*.{ts,tsx}", "**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
]);

export default eslintConfig;
