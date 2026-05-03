// @vitest-environment node
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
};

describe('tooling consistency', () => {
    it('runs version sync before production builds', () => {
        expect(packageJson.scripts?.prebuild).toContain('sync-version');
    });

    it('has an executable TypeScript lint script for the existing ESLint config', () => {
        expect(packageJson.scripts?.lint).toContain('eslint');
        expect(packageJson.devDependencies).toHaveProperty('eslint');
        expect(packageJson.devDependencies).toHaveProperty('@eslint/js');
        expect(packageJson.devDependencies).toHaveProperty('typescript-eslint');
    });
});
