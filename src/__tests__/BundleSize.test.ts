// @vitest-environment jsdom
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { gzipSync } from 'node:zlib';
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { resolve, dirname } from 'node:path';
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url)) as string;
const projectRoot = resolve(currentDir, '../..') as string;
const distAssetsDir = resolve(projectRoot, 'dist/assets') as string;
const packageJsonPath = resolve(projectRoot, 'package.json') as string;

/** Maximum allowed gzipped size for the main entry chunk (50KB). */
const MAX_MAIN_CHUNK_GZIPPED_BYTES = 50 * 1024;

/**
 * Finds the main entry chunk JS file in dist/assets.
 * The main chunk follows the pattern: index-{hash}.js (not .map files).
 */
function findMainChunk(): { filename: string; content: string } | null {
    if (!existsSync(distAssetsDir)) return null;

    const files = readdirSync(distAssetsDir) as string[];
    const mainChunkFile = files.find(
        (f: string) => f.startsWith('index-') && f.endsWith('.js') && !f.endsWith('.js.map')
    );

    if (!mainChunkFile) return null;

    const content = readFileSync(resolve(distAssetsDir, mainChunkFile), 'utf-8') as string;
    return { filename: mainChunkFile, content };
}

describe('Bundle Size Verification', () => {
    describe('Main entry chunk size', () => {
        it('should be less than 50KB gzipped', () => {
            const chunk = findMainChunk();
            expect(chunk, 'dist/assets directory must contain a main entry chunk (run `npm run build` first)').not.toBeNull();

            const gzipped = gzipSync(chunk!.content) as { length: number };
            const gzippedSizeKB = gzipped.length / 1024;

            expect(
                gzipped.length,
                `Main chunk "${chunk!.filename}" is ${gzippedSizeKB.toFixed(2)}KB gzipped, exceeds ${MAX_MAIN_CHUNK_GZIPPED_BYTES / 1024}KB limit`
            ).toBeLessThan(MAX_MAIN_CHUNK_GZIPPED_BYTES);
        });
    });

    describe('DOMPurify code splitting', () => {
        it('should not include DOMPurify in the main entry chunk', () => {
            const chunk = findMainChunk();
            expect(chunk, 'dist/assets directory must contain a main entry chunk (run `npm run build` first)').not.toBeNull();

            const content = chunk!.content;

            // DOMPurify library implementation markers. These are internal to the library
            // and would only appear in a chunk if DOMPurify's code was bundled there.
            // Note: ALLOWED_TAGS/ALLOWED_ATTR may appear as config property names in calling
            // code — those are usage references, not the library itself.
            const domPurifyLibrarySignatures = [
                '@license DOMPurify',
                'FORBID_TAGS',
                'SANITIZE_DOM',
                'RETURN_TRUSTED_TYPE',
            ];

            const foundSignatures = domPurifyLibrarySignatures.filter((sig) => content.includes(sig));

            expect(
                foundSignatures,
                `Main chunk "${chunk!.filename}" contains DOMPurify signatures: ${foundSignatures.join(', ')}. DOMPurify should be in a separate async chunk.`
            ).toHaveLength(0);
        });

        it('should have DOMPurify in a separate async chunk', () => {
            expect(existsSync(distAssetsDir), 'dist/assets directory must exist (run `npm run build` first)').toBe(true);

            const files = readdirSync(distAssetsDir) as string[];
            const purifyChunk = files.find(
                (f: string) => f.includes('purify') && f.endsWith('.js') && !f.endsWith('.js.map')
            );

            expect(
                purifyChunk,
                'A separate DOMPurify async chunk (containing "purify" in filename) should exist in dist/assets'
            ).toBeDefined();
        });
    });

    describe('Tree-shaking configuration', () => {
        it('should have sideEffects: false in package.json', () => {
            const content = readFileSync(packageJsonPath, 'utf-8') as string;
            const packageJson = JSON.parse(content) as { sideEffects?: boolean };

            expect(
                packageJson.sideEffects,
                'package.json must have "sideEffects": false for optimal tree-shaking'
            ).toBe(false);
        });
    });
});
