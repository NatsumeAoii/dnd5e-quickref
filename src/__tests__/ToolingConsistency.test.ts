// @vitest-environment node
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
};

const readDataFile = (fileName: string) => JSON.parse(
    readFileSync(new URL(`../../js/data/${fileName}`, import.meta.url), 'utf8'),
) as Array<{ title: string; optional: string; reference?: string }>;

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

    it('keeps the curated 2014 optional DMG additions source-backed and marked consistently', () => {
        const actions = readDataFile('data_action.json');
        const environment = readDataFile('data_environment.json');
        const optionalRows = [
            actions.find((row) => row.title === 'Healing Surge*'),
            environment.find((row) => row.title === "Healer's Kit Dependency*"),
            environment.find((row) => row.title === 'Slow Natural Healing*'),
            environment.find((row) => row.title === 'Fear and Horror*'),
            environment.find((row) => row.title === 'Hitting Cover*'),
        ];

        expect(optionalRows).toHaveLength(5);
        optionalRows.forEach((row) => {
            expect(row).toBeDefined();
            expect(row?.optional).toBe('Optional rule');
            expect(row?.title.endsWith('*')).toBe(true);
            expect(row?.title.endsWith('**')).toBe(false);
            expect(row?.reference).toContain('DMG');
        });
    });
});
