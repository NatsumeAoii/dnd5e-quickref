import tsESLint from 'typescript-eslint';
import eslint from '@eslint/js';

export default tsESLint.config(
    eslint.configs.recommended,
    ...tsESLint.configs.recommended,
    {
        ignores: ['dist/**', 'node_modules/**', '*.js', 'sw.js'],
    },
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parserOptions: {
                project: './tsconfig.json',
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
            'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
            'prefer-const': 'error',
            'no-var': 'error',
            'eqeqeq': ['error', 'smart'],
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',
        },
    },
);
