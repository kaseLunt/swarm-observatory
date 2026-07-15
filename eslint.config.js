import js from '@eslint/js'
import ts from 'typescript-eslint'

export default ts.config(
  // .superpowers is gitignored ephemeral scratch (SDD dossiers + throwaway Playwright verify drivers);
  // it is not shippable source, so exclude it from lint exactly like the build/vendored dirs above.
  { ignores: ['dist', 'contract', 'public', '.superpowers'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['tools/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
  },
)
