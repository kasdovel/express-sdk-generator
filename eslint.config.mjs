// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // ── Global ignores ──────────────────────────────────────────────────────────
  // Build output, deps, turbo cache, and everything the generator emits into the
  // example. Generated SDK/spec/docs are artifacts, not source — never lint them.
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      'examples/*/sdk/**',
      'examples/*/docs/**',
      'examples/*/openapi.json',
      'examples/*/openapi.yaml',
    ],
  },

  // ── Base JS/TS recommended + type-aware rules ───────────────────────────────
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // Auto-discovers the nearest tsconfig per file — the right model for a
        // pnpm/turbo monorepo where each package owns its own tsconfig.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      // Zero-drift codebase leans on inference; allow deliberate `any` but flag it.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Enforce the `import type` discipline that verbatimModuleSyntax requires.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      // Unused vars are errors, but allow the `_`-prefix escape hatch.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Promise-returning fns passed to Express handlers/middleware are common;
      // keep floating-promise safety but allow void-returning attributes.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },

  // ── CLI: a Node command-line tool, console output is the point ───────────────
  {
    files: ['packages/cli/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // ── Config & script files (no type info / run outside src) ───────────────────
  {
    files: ['**/*.{js,mjs,cjs}', '**/*.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // ── Test files live outside each package's `src` tsconfig `include`, so the
  // type-aware project service can't see them. Lint them without type info —
  // still catches unused vars, etc. — and relax fixture/mock noise.
  {
    files: ['**/*.test.ts', '**/test/**/*.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-empty-function': 'off',
    },
  },

  // Turn off rules that conflict with Prettier formatting. Keep last.
  prettier,
);
