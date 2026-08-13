// @vitest-environment jsdom
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const locales = ['en_US', 'id_ID', 'fr_FR'] as const;
const requiredKeys = [
    'popup.opened', 'popup.closed', 'popup.minimized', 'popup.minimized.label', 'popup.minimized.group', 'popup.minimized.restore',
    'popup.minimized.close', 'popup.tellMore', 'popup.tellLess', 'popup.scrollTable', 'popup.unsupported',
    'favorite.add', 'favorite.remove', 'favorite.added', 'favorite.removed', 'shortcuts.title',
    'shortcuts.close', 'shortcuts.opened', 'shortcuts.closed', 'shortcuts.general', 'shortcuts.toggle',
    'shortcuts.itemNavigation', 'shortcuts.sectionNavigation', 'onboarding.skip', 'onboarding.back',
    'onboarding.next', 'onboarding.done', 'onboarding.step', 'onboarding.announcement', 'onboarding.completed', 'changelog.title',
    'changelog.opened', 'changelog.closed', 'changelog.whatsNew', 'changelog.close', 'changelog.showAll', 'changelog.loadFailedTitle', 'changelog.loadFailedBody',
    'readme.title', 'readme.close', 'readme.about', 'readme.opened', 'readme.closed', 'readme.loadFailedTitle', 'readme.loadFailedBody',
    'fatal.title', 'fatal.message', 'fatal.reload', 'fatal.reset', 'fatal.confirmReset', 'fatal.resetFailed', 'fatal.boundaryTitle', 'fatal.boundaryMessage', 'fatal.factoryReset', 'fatal.confirmFactoryReset',
    'fatal.copy', 'fatal.copied', 'fatal.report', 'backup.confirmImport', 'backup.imported', 'backup.cancelled',
    'backup.importFailed', 'notes.imported', 'notes.importFailed', 'export.failed', 'shared.received',
    'sections.state', 'settings.updated',
    'settings.offline.consent.saving', 'settings.offline.consent.preparing',
    'settings.offline.consent.failed', 'settings.offline.consent.unavailable',
] as const;

describe('runtime localization catalog', () => {
    it('defines every runtime UI key in every supported locale', () => {
        const cwd = (globalThis as typeof globalThis & { process: { cwd: () => string } }).process.cwd();
        for (const locale of locales) {
            const sourcePath = `${cwd}/data/${locale}/menu.json`;
            const publicPath = `${cwd}/public/data/${locale}/menu.json`;
            const sourceText = readFileSync(sourcePath, 'utf8');
            expect(readFileSync(publicPath, 'utf8'), `${locale}:public mirror`).toBe(sourceText);
            const menu = JSON.parse(sourceText) as { strings: Record<string, string> };
            for (const key of requiredKeys) expect(menu.strings[key], `${locale}:${key}`).toBeTypeOf('string');
        }
    });
});
