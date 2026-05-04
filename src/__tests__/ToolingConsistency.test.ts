// @vitest-environment node
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    license?: string;
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
    version?: string;
};
const packageLock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8')) as {
    packages?: Record<string, { license?: string; version?: string }>;
    version?: string;
};
const rootChangelog = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
const publicChangelog = readFileSync(new URL('../../public/CHANGELOG.md', import.meta.url), 'utf8');
const configSource = readFileSync(new URL('../config.ts', import.meta.url), 'utf8');
const serviceWorkerSource = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
const deployWorkflow = readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const readText = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

const readDataFile = (fileName: string) => JSON.parse(
    readFileSync(new URL(`../../js/data/${fileName}`, import.meta.url), 'utf8'),
) as Array<{
    title?: string;
    optional?: string;
    icon?: string;
    reference?: string;
    tags?: string[];
    bullets?: Array<{
        type?: string;
        content?: string;
        items?: unknown[];
        headers?: unknown[];
        rows?: unknown[];
    }>;
}>;

const dataFiles = readdirSync(new URL('../../js/data/', import.meta.url))
    .filter((name: string) => name.endsWith('.json'))
    .sort();

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

    it('exposes a deterministic data audit command', () => {
        expect(packageJson.scripts?.['audit:data']).toBe('node scripts/audit-data.js');
        expect(existsSync(new URL('../../scripts/audit-data.js', import.meta.url))).toBe(true);
    });

    it('keeps package metadata aligned with the project license', () => {
        expect(readText('../../LICENSE.md')).toContain('# MIT License');
        expect(packageJson.license).toBe('MIT');
        expect(packageLock.packages?.['']?.license).toBe('MIT');
    });

    it('deploys from the repository default branch used by this checkout', () => {
        expect(deployWorkflow).toContain('branches: ["master"]');
        expect(readText('../../README.md')).toContain('Pushing to `master` triggers');
    });

    it('keeps all release metadata synchronized from the top changelog entry', () => {
        const versionMatch = rootChangelog.match(/^## \[(\d+\.\d+\.\d+)\]/m);
        expect(versionMatch?.[1]).toBe(packageJson.version);
        expect(packageLock.version).toBe(packageJson.version);
        expect(packageLock.packages?.['']?.version).toBe(packageJson.version);
        expect(configSource).toContain(`APP_VERSION: '${packageJson.version}'`);
        expect(serviceWorkerSource).toContain(`CACHE_VERSION = '${packageJson.version}'`);
        expect(publicChangelog).toBe(rootChangelog);
    });

    it('keeps data files mirrored for runtime and public assets', () => {
        dataFiles.forEach((fileName: string) => {
            const source = readText(`../../js/data/${fileName}`).replace(/\r\n/g, '\n');
            const publicMirror = readText(`../../public/js/data/${fileName}`).replace(/\r\n/g, '\n');
            expect(publicMirror).toBe(source);
        });
    });

    it('keeps every data icon backed by a CSS icon class and image asset', () => {
        const iconsCss = readText('../css/icons.css');
        const iconClasses = new Map<string, string>();
        iconsCss.replace(
            /\.icon-([a-z0-9_-]+)\s*\{\s*background-image:\s*url\(["']?([^"')]+)["']?\)/gi,
            (_match: string, iconName: string, assetPath: string) => {
                iconClasses.set(iconName, assetPath);
                return '';
            },
        );

        dataFiles.forEach((fileName: string) => {
            readDataFile(fileName).forEach((row) => {
                if (!row.icon) return;
                const assetPath = iconClasses.get(row.icon);
                expect(assetPath, `${fileName}: ${row.title ?? '(untitled)'} uses missing icon "${row.icon}"`).toBeDefined();
                expect(
                    existsSync(new URL(`../../public/${assetPath?.replace(/^.*public\//, '')}`, import.meta.url)),
                    `${fileName}: ${row.title ?? '(untitled)'} icon asset "${assetPath}" is missing`,
                ).toBe(true);
            });
        });
    });

    it('keeps rule data schema and optional markers renderable', () => {
        const allowedRuleTypes = new Set(['Standard rule', 'Optional rule', 'Homebrew rule']);
        const allowedBulletTypes = new Set(['paragraph', 'list', 'table']);
        const allowedEnvironmentTags = new Set([
            'environment_obscurance',
            'environment_light',
            'environment_vision',
            'environment_cover',
            'environment_other',
        ]);

        dataFiles.forEach((fileName: string) => {
            readDataFile(fileName).forEach((row, index) => {
                const location = `${fileName}[${index}] ${row.title ?? '(untitled)'}`;
                expect(typeof row.title, `${location}: title`).toBe('string');
                expect(row.title?.trim().length, `${location}: title`).toBeGreaterThan(0);
                expect(typeof row.icon, `${location}: icon`).toBe('string');
                expect(row.icon?.trim().length, `${location}: icon`).toBeGreaterThan(0);
                expect(allowedRuleTypes.has(row.optional ?? ''), `${location}: optional`).toBe(true);
                if (row.optional === 'Optional rule') {
                    expect(row.title?.endsWith('*'), `${location}: optional marker`).toBe(true);
                    expect(row.title?.endsWith('**'), `${location}: optional marker`).toBe(false);
                }
                if (row.optional === 'Homebrew rule') {
                    expect(row.title?.endsWith('**'), `${location}: homebrew marker`).toBe(true);
                }
                if (fileName.includes('environment')) {
                    expect(row.tags?.length, `${location}: environment tags`).toBeGreaterThan(0);
                    row.tags?.forEach((tag) => expect(allowedEnvironmentTags.has(tag), `${location}: tag ${tag}`).toBe(true));
                }
                row.bullets?.forEach((bullet, bulletIndex) => {
                    const bulletLocation = `${location}: bullets[${bulletIndex}]`;
                    expect(allowedBulletTypes.has(bullet.type ?? ''), `${bulletLocation}: type`).toBe(true);
                    if (bullet.type === 'paragraph') expect(typeof bullet.content, `${bulletLocation}: content`).toBe('string');
                    if (bullet.type === 'list') {
                        expect(Array.isArray(bullet.items), `${bulletLocation}: items`).toBe(true);
                        bullet.items?.forEach((item) => expect(typeof item, `${bulletLocation}: item`).toBe('string'));
                    }
                    if (bullet.type === 'table') {
                        expect(Array.isArray(bullet.headers), `${bulletLocation}: headers`).toBe(true);
                        expect(Array.isArray(bullet.rows), `${bulletLocation}: rows`).toBe(true);
                        const headerCount = bullet.headers?.length ?? 0;
                        bullet.rows?.forEach((rowData, rowIndex) => {
                            expect(Array.isArray(rowData), `${bulletLocation}: row ${rowIndex}`).toBe(true);
                            expect((rowData as unknown[]).length, `${bulletLocation}: row ${rowIndex}`).toBe(headerCount);
                        });
                    }
                });
            });
        });
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
            expect(row?.title?.endsWith('*')).toBe(true);
            expect(row?.title?.endsWith('**')).toBe(false);
            expect(row?.reference).toContain('DMG');
        });
    });
});
