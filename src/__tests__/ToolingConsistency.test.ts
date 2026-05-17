// @vitest-environment node
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    author?: string;
    bugs?: { url?: string };
    description?: string;
    homepage?: string;
    keywords?: string[];
    license?: string;
    module?: string;
    private?: boolean;
    repository?: { type?: string; url?: string };
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
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const gitignore = readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8');
const quickrefCss = readFileSync(new URL('../css/quickref.css', import.meta.url), 'utf8');
const configSource = readFileSync(new URL('../config.ts', import.meta.url), 'utf8');
const serviceWorkerSource = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
const deployWorkflow = readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const readText = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const hasGitignoreEntry = (entry: string): boolean => gitignore.split(/\r?\n/).includes(entry);
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasMetaContent = (attribute: 'name' | 'property', key: string, content: string): boolean => {
    const pattern = new RegExp(`<meta\\s+${attribute}="${escapeRegExp(key)}"\\s+content="${escapeRegExp(content)}"\\s*/?>`, 's');
    return pattern.test(indexHtml);
};

const supportedLocales = ['en_US', 'id_ID', 'fr_FR'] as const;
const readDataFile = (fileName: string, locale = 'en_US') => JSON.parse(
    readFileSync(new URL(`../../data/${locale}/rules/${fileName}`, import.meta.url), 'utf8'),
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

const dataFiles = readdirSync(new URL('../../data/en_US/rules/', import.meta.url))
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

    it('marks the package as a private static app with complete public metadata', () => {
        expect(packageJson.private).toBe(true);
        expect(packageJson.description?.trim()).toBeTruthy();
        expect(packageJson.module).toBe('src/main.ts');
        expect(packageJson.author?.trim()).toBeTruthy();
        expect(packageJson.homepage).toBe('https://natsumeaoii.github.io/dnd5e-quickref/');
        expect(packageJson.repository).toMatchObject({
            type: 'git',
            url: 'https://github.com/NatsumeAoii/dnd5e-quickref.git',
        });
        expect(packageJson.bugs?.url).toBe('https://github.com/NatsumeAoii/dnd5e-quickref/issues');
        expect(packageJson.keywords).toEqual(expect.arrayContaining(['dnd5e', 'quick-reference', 'vite', 'typescript']));
    });

    it('keeps generated, dependency, local environment, OS, and log files ignored', () => {
        expect(hasGitignoreEntry('/dist/')).toBe(true);
        expect(hasGitignoreEntry('/build/')).toBe(true);
        expect(hasGitignoreEntry('/node_modules/')).toBe(true);
        expect(hasGitignoreEntry('.env')).toBe(true);
        expect(hasGitignoreEntry('.env.local')).toBe(true);
        expect(hasGitignoreEntry('.DS_Store')).toBe(true);
        expect(hasGitignoreEntry('*.log')).toBe(true);
    });

    it('does not commit local editor settings with machine-specific ports', () => {
        expect(existsSync(new URL('../../.vscode/settings.json', import.meta.url))).toBe(false);
    });

    it('declares canonical and social metadata for the public static entry point', () => {
        const publicUrl = 'https://natsumeaoii.github.io/dnd5e-quickref/';
        const publicImageUrl = `${publicUrl}img/web-app-manifest-512x512.png`;

        expect(indexHtml).toContain(`<link rel="canonical" href="${publicUrl}" />`);
        expect(hasMetaContent('property', 'og:title', 'D&D5e QuickRef')).toBe(true);
        expect(hasMetaContent('property', 'og:description', 'A quick, searchable reference guide for Dungeons & Dragons 5th Edition (D&D 5e) rulesets.')).toBe(true);
        expect(hasMetaContent('property', 'og:image', publicImageUrl)).toBe(true);
        expect(hasMetaContent('property', 'og:url', publicUrl)).toBe(true);
        expect(hasMetaContent('property', 'og:type', 'website')).toBe(true);
        expect(hasMetaContent('name', 'twitter:card', 'summary')).toBe(true);
        expect(hasMetaContent('name', 'twitter:title', 'D&D5e QuickRef')).toBe(true);
        expect(hasMetaContent('name', 'twitter:description', 'A quick, searchable reference guide for Dungeons & Dragons 5th Edition (D&D 5e) rulesets.')).toBe(true);
        expect(hasMetaContent('name', 'twitter:image', publicImageUrl)).toBe(true);
    });

    it('keeps screen font sizes relative for user scaling', () => {
        expect(quickrefCss).not.toMatch(/font-size:\s*\d+px/);
    });

    it('styles every in-app README modal class emitted by ReadmeService', () => {
        [
            '.readme-modal-overlay',
            '.readme-modal',
            '.readme-modal-header',
            '.readme-close-btn',
            '.readme-modal-body',
            '.readme-section-block',
            '.readme-ordered-list',
            '.readme-list-nested',
            '.readme-code-block',
            '.readme-details',
            '.readme-table-wrapper',
        ].forEach((selector) => {
            expect(quickrefCss).toContain(selector);
        });
    });

    it('keeps the changelog modal width aligned with the README modal width', () => {
        const getRuleDeclaration = (selector: string, property: string): string => {
            const rule = quickrefCss.match(new RegExp(`${escapeRegExp(selector)}\\s*\\{(?<body>[^}]+)\\}`, 's'));
            const declaration = rule?.groups?.body.match(new RegExp(`${escapeRegExp(property)}\\s*:\\s*([^;]+);`));
            return declaration?.[1].trim() ?? '';
        };

        expect(getRuleDeclaration('.changelog-modal', 'width')).toBe(getRuleDeclaration('.readme-modal', 'width'));
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
        supportedLocales.forEach((locale) => {
            expect(readText(`../../public/data/${locale}/menu.json`).replace(/\r\n/g, '\n'))
                .toBe(readText(`../../data/${locale}/menu.json`).replace(/\r\n/g, '\n'));
            dataFiles.forEach((fileName: string) => {
                const source = readText(`../../data/${locale}/rules/${fileName}`).replace(/\r\n/g, '\n');
                const publicMirror = readText(`../../public/data/${locale}/rules/${fileName}`).replace(/\r\n/g, '\n');
                expect(publicMirror).toBe(source);
            });
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

        supportedLocales.forEach((locale) => {
            dataFiles.forEach((fileName: string) => {
                readDataFile(fileName, locale).forEach((row) => {
                    if (!row.icon) return;
                    const assetPath = iconClasses.get(row.icon);
                    expect(assetPath, `${locale}/${fileName}: ${row.title ?? '(untitled)'} uses missing icon "${row.icon}"`).toBeDefined();
                    expect(
                        existsSync(new URL(`../../public/${assetPath?.replace(/^.*public\//, '')}`, import.meta.url)),
                        `${locale}/${fileName}: ${row.title ?? '(untitled)'} icon asset "${assetPath}" is missing`,
                    ).toBe(true);
                });
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

        supportedLocales.forEach((locale) => {
            dataFiles.forEach((fileName: string) => {
                readDataFile(fileName, locale).forEach((row, index) => {
                    const location = `${locale}/${fileName}[${index}] ${row.title ?? '(untitled)'}`;
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
