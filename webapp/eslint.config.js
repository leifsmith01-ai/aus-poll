import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

// Flat config (ESLint 9). The ruleset is intentionally pragmatic: genuine
// correctness issues (undefined vars, broken hook rules) are errors, while
// stylistic noise and the stricter advisory rules are downgraded to warnings
// so the large existing App.jsx doesn't block CI. `npm run lint` fails only on
// errors, so warnings can be burned down over time (e.g. during the planned
// App.jsx refactor).
export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      // Only the two classic hook rules — the rest of react-hooks v7's
      // recommended set is advisory and noisy against the current monolith.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-constant-binary-expression': 'warn',
      'no-undef': 'error',
    },
  },
  {
    // Node-side scripts (build/data helpers).
    files: ['**/*.mjs', 'scripts/**/*.js', 'vite.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    files: ['**/*.test.{js,jsx}', '**/__tests__/**'],
    languageOptions: { globals: { ...globals.node } },
  },
];
