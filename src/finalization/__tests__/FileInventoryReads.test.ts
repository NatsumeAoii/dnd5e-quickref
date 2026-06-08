// @vitest-environment node
//
// Feature: pre-ship-finalization
//
// Integration test for FileInventory.readAll full-byte reads (Task 2.4).
// Asserts that FileRecord.content is byte-identical to what is on disk for real
// fixture files, satisfying Requirement 1.2 (read complete contents from first
// byte to last byte).

// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { tmpdir } from 'node:os';
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { dirname, join } from 'node:path';
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FileInventory } from '../FileInventory';

/** Repository root, derived from this test's location (src/finalization/__tests__). */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url)) as string;

/**
 * Read a file from disk as raw bytes. Returned as a Node Buffer so tests can
 * compare against the UTF-8 re-encoding of FileRecord.content.
 */
const readDiskBytes = (absolutePath: string): { length: number; equals(other: unknown): boolean } =>
  readFileSync(absolutePath) as unknown as { length: number; equals(other: unknown): boolean };

/** UTF-8 encode a string back into bytes for a byte-for-byte comparison. */
const encodeUtf8 = (text: string): unknown =>
  (globalThis as unknown as { Buffer: { from(input: string, encoding: string): unknown } }).Buffer.from(
    text,
    'utf-8',
  );

describe('FileInventory.readAll full-byte reads', () => {
  describe('against generated fixture files', () => {
    let fixtureRoot: string;

    // Fixtures span the cases a byte-exact reader must preserve: multi-byte
    // UTF-8, CRLF line endings, an empty file, a trailing-newline file, and a
    // nested path. Each is written to disk, then read back through the inventory.
    const fixtures: ReadonlyArray<{ relPath: string; content: string }> = [
      { relPath: 'ascii.txt', content: 'plain ascii content\nsecond line' },
      { relPath: 'unicode.md', content: '# Café — D&D 5e ✦\nÆthelred ☼ 日本語 \u{1F409}' },
      { relPath: 'crlf.ts', content: 'const a = 1;\r\nconst b = 2;\r\n' },
      { relPath: 'empty.css', content: '' },
      { relPath: 'trailing-newline.json', content: '{\n  "value": 1\n}\n' },
      { relPath: 'nested/deep/config.ts', content: 'export const PORT = 5173;\n' },
    ];

    beforeAll(() => {
      fixtureRoot = mkdtempSync(join(tmpdir(), 'finalization-inventory-'));
      for (const { relPath, content } of fixtures) {
        const absolutePath = join(fixtureRoot, relPath);
        mkdirSync(dirname(absolutePath), { recursive: true });
        writeFileSync(absolutePath, content, 'utf-8');
      }
    });

    afterAll(() => {
      rmSync(fixtureRoot, { recursive: true, force: true });
    });

    it('returns content byte-identical to the bytes on disk', () => {
      const inventory = new FileInventory();
      const paths = fixtures.map((fixture) => fixture.relPath);

      const records = inventory.readAll(paths, fixtureRoot);

      expect(records).toHaveLength(fixtures.length);

      for (const record of records) {
        expect(record.readError, `${record.path} should read without error`).toBeNull();
        expect(record.content, `${record.path} should have content`).not.toBeNull();

        const diskBytes = readDiskBytes(join(fixtureRoot, record.path));

        // bytes field reflects the true on-disk byte length.
        expect(record.bytes, `${record.path} byte length`).toBe(diskBytes.length);

        // Re-encoding the decoded content yields the exact on-disk bytes.
        const reEncoded = encodeUtf8(record.content as string);
        expect(diskBytes.equals(reEncoded), `${record.path} bytes are identical`).toBe(true);
      }
    });

    it('reads an empty file as empty content with zero bytes', () => {
      const inventory = new FileInventory();

      const [record] = inventory.readAll(['empty.css'], fixtureRoot);

      expect(record.content).toBe('');
      expect(record.bytes).toBe(0);
      expect(record.readError).toBeNull();
    });

    it('preserves CRLF line endings exactly', () => {
      const inventory = new FileInventory();

      const [record] = inventory.readAll(['crlf.ts'], fixtureRoot);

      expect(record.content).toBe('const a = 1;\r\nconst b = 2;\r\n');
    });
  });

  describe('against real repository files', () => {
    // Real shipped text files of varying sizes and formats. Using committed
    // files proves the reader is byte-exact on the actual project, not only on
    // synthetic input.
    const realFiles: readonly string[] = [
      'package.json',
      'README.md',
      'index.html',
      'tsconfig.json',
      'src/finalization/types.ts',
    ];

    it('returns content byte-identical to the on-disk repository files', () => {
      const inventory = new FileInventory();

      const records = inventory.readAll(realFiles, repoRoot);

      expect(records).toHaveLength(realFiles.length);

      for (const record of records) {
        expect(record.readError, `${record.path} should read without error`).toBeNull();
        expect(record.content, `${record.path} should have content`).not.toBeNull();

        const diskBytes = readDiskBytes(join(repoRoot, record.path));

        expect(record.bytes, `${record.path} byte length`).toBe(diskBytes.length);

        const reEncoded = encodeUtf8(record.content as string);
        expect(diskBytes.equals(reEncoded), `${record.path} bytes are identical`).toBe(true);
      }
    });
  });
});
