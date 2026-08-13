import { expect, test, type Page } from '@playwright/test';

const firstRule = '[data-popup-id].item';
const appCachePrefix = 'dnd5e-quickref-cache-';

type CacheStatus = {
    status: string;
    requestId?: string;
    errorCode?: string;
};

async function acceptCookies(page: Page): Promise<void> {
    const accept = page.locator('#accept-cookies');
    if (await accept.isVisible().catch(() => false)) await accept.click();
}

async function dismissOnboarding(page: Page): Promise<void> {
    const skip = page.locator('.onboarding-skip-btn');
    if (await skip.isVisible({ timeout: 1_000 }).catch(() => false)) await skip.click();
    await expect(page.locator('#onboarding-overlay')).toBeHidden({ timeout: 5_000 }).catch(() => undefined);
}

async function openApp(page: Page): Promise<void> {
    await page.addInitScript(() => {
        localStorage.setItem('onboardingCompleted', 'true');
    });
    await page.goto('/');
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 30_000 });
    await acceptCookies(page);
    await expect(page.locator(firstRule).first()).toBeVisible({ timeout: 30_000 });
    await dismissOnboarding(page);
}

async function openFirstPopup(page: Page): Promise<void> {
    await page.locator(`${firstRule} .item-content`).first().click();
    await expect(page.locator('dialog.popup-window').first()).toBeVisible();
}

async function installCacheStatusObserver(page: Page): Promise<void> {
    await page.evaluate(() => {
        const statuses: CacheStatus[] = [];
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data?.type === 'CACHE_STATUS') statuses.push(event.data as CacheStatus);
        });
        (window as Window & { __browserCacheStatuses?: CacheStatus[] }).__browserCacheStatuses = statuses;
    });
}

async function waitForCacheOperation(page: Page, button: string, expectedStatus: string): Promise<void> {
    const status = page.locator('#offline-status');
    await page.locator(button).click();
    await expect.poll(async () => page.evaluate(({ expectedStatus: target }) => {
        const statuses = (window as Window & { __browserCacheStatuses?: CacheStatus[] }).__browserCacheStatuses ?? [];
        const correlated = statuses.filter((entry) => typeof entry.requestId === 'string');
        const matching = correlated.find((entry) => entry.status === target);
        if (!matching) return { found: false, errorCodes: correlated.filter((entry) => entry.status === 'error').map((entry) => entry.errorCode ?? 'unknown') };
        return { found: true, requestId: matching.requestId, errorCodes: correlated.filter((entry) => entry.requestId === matching.requestId && entry.status === 'error').map((entry) => entry.errorCode ?? 'unknown') };
    }, { expectedStatus })).toMatchObject({ found: true, errorCodes: [] });
    await expect(status).toHaveText(/\S+/);
}

async function getOwnedCacheState(page: Page): Promise<{ supported: boolean; names: string[]; entries: string[] }> {
    return page.evaluate(async (prefix) => {
        if (!('caches' in window)) return { supported: false, names: [], entries: [] };
        const names = (await caches.keys()).filter((name) => name.startsWith(prefix));
        const entries: string[] = [];
        for (const name of names) {
            const cache = await caches.open(name);
            for (const request of await cache.keys()) entries.push(request.url);
        }
        return { supported: true, names, entries };
    }, appCachePrefix);
}

test.describe('browser app shell', () => {
    test('loads the shell, search/filter, keyboard focus, and responsive layout', async ({ page }) => {
        const consoleErrors: string[] = [];
        page.on('console', (message) => {
            if (message.type() === 'error') consoleErrors.push(message.text());
        });
        await openApp(page);

        await expect(page.locator('#search-input')).toBeVisible();
        await expect(page.locator('[data-section="movement"]')).toBeVisible();
        await expect(page.locator('body')).not.toHaveClass(/fatal-error/);

        const initialItems = await page.locator('[data-popup-id]').count();
        const searchStart = Date.now();
        await page.locator('#search-input').fill('Dash');
        await expect(page.locator(`${firstRule}:visible`).filter({ hasText: 'Dash' }).first()).toBeVisible();
        const searchDuration = Date.now() - searchStart;
        test.info().annotations.push({ type: 'performance', description: `search-ms=${searchDuration}` });
        expect(searchDuration).toBeLessThan(3_000);
        await page.locator('#search-filter-select').selectOption('favorites');
        await expect(page.locator('#search-filter-select')).toHaveValue('favorites');
        await page.locator('#search-clear-btn').click();
        expect(await page.locator('[data-popup-id]').count()).toBe(initialItems);

        await page.locator('#search-input').focus();
        await expect(page.locator('#search-input')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(page.locator('#search-clear-btn')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(page.locator('#search-filter-select')).toBeFocused();

        await page.setViewportSize({ width: 320, height: 720 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

        const securityErrors = consoleErrors.filter((message) => /content security policy|trusted types/i.test(message));
        expect(securityErrors, securityErrors.join('\n')).toEqual([]);
    });

    test('opens, focuses, minimizes, restores, and closes a popup', async ({ page }) => {
        await openApp(page);
         await openFirstPopup(page);
         const popup = page.locator('dialog.popup-window').first();
         await expect(popup).toBeVisible();
         const popupStart = Date.now();
        await popup.locator('.popup-minimize-btn').dispatchEvent('click');
        await expect(page.locator('#minimized-popups-bar')).not.toHaveClass(/hidden/);
         const popupDuration = Date.now() - popupStart;
         test.info().annotations.push({ type: 'performance', description: `popup-minimize-ms=${popupDuration}` });
         expect(popupDuration).toBeLessThan(3_000);
        const minimized = page.locator('#minimized-popups-bar .minimized-popup-tab').first();
        if (await minimized.count()) {
            await minimized.dispatchEvent('click');
            await expect(page.locator('dialog.popup-window').first()).toBeVisible();
        }
        await page.locator('dialog.popup-window').first().locator('.popup-close-btn').click();
        await expect(page.locator('dialog.popup-window')).toHaveCount(0);
    });

    test('persists favorites and notes across a reload', async ({ page }) => {
        await openApp(page);
        const item = page.locator(firstRule).first();
        const title = await item.locator('.item-title').textContent();
        await item.locator('.favorite-btn').click();
        await expect(item.locator('.favorite-btn')).toHaveAttribute('aria-pressed', 'true');
        await item.locator('.item-content').click();
        const popup = page.locator('dialog.popup-window').first();
        const note = `browser verification ${Date.now()}`;
        await popup.locator('.popup-notes-textarea').fill(note);
        await expect(popup.locator('.popup-notes-status')).toHaveText(/saved/i, { timeout: 10_000 });
        await page.reload();
        await expect(page.locator('#app-container')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('#favorites-container .item-title').filter({ hasText: title ?? '' })).toBeVisible();
        await page.locator('#close-all-popups-btn').dispatchEvent('click');
        await expect(page.locator('dialog.popup-window')).toHaveCount(0, { timeout: 5_000 });
        await page.locator('#favorites-container').locator(firstRule).filter({ hasText: title ?? '' }).locator('.item-content').click();
        await expect(page.locator('dialog.popup-window .popup-notes-textarea')).toHaveValue(note);
    });

    test('switches locale and ruleset through the real settings controls', async ({ page }) => {
        await openApp(page);
        const initialSettingsTitle = await page.locator('[data-i18n="settings.title"]').textContent();
        await page.locator('#locale-select').selectOption('fr_FR');
        await expect(page.locator('#locale-select')).toHaveValue('fr_FR');
        await expect(page.locator('[data-i18n="settings.title"]')).not.toHaveText(initialSettingsTitle ?? '');
        await page.locator('label[for="rules2024-switch"]').scrollIntoViewIfNeeded();
        await page.locator('label[for="rules2024-switch"]').click();
        await expect(page.locator('#rules2024-switch')).toBeChecked();
        await expect(page.locator('[data-popup-id]').first()).toBeVisible({ timeout: 30_000 });
    });

    test('enters print mode and exposes performance metrics', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => {
            window.print = () => undefined;
        });
        await page.keyboard.press('Control+P');
        await expect(page.locator('body')).toHaveClass(/print-mode/);
        await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
        await expect(page.locator('body')).not.toHaveClass(/print-mode/);

        const metrics = await page.evaluate(() => {
            const entries = performance.getEntriesByType('paint');
            const lcp = performance.getEntriesByType('largest-contentful-paint').at(-1)?.startTime ?? 0;
            const cls = performance.getEntriesByType('layout-shift')
                .filter((entry) => !(entry as PerformanceEntry & { hadRecentInput?: boolean }).hadRecentInput)
                .reduce((total, entry) => total + ((entry as PerformanceEntry & { value?: number }).value ?? 0), 0);
            const inp = performance.getEntriesByType('event')
                .filter((entry) => ['click', 'keydown', 'pointerdown'].includes(entry.name))
                .reduce((max, entry) => Math.max(max, (entry as PerformanceEntry & { duration: number }).duration), 0);
            return {
                navigation: performance.getEntriesByType('navigation').length,
                firstPaint: entries.find((entry) => entry.name === 'first-paint')?.startTime ?? 0,
                lcp,
                cls,
                inp,
            };
        });
        expect(metrics.navigation).toBeGreaterThan(0);
        expect(metrics.firstPaint).toBeGreaterThanOrEqual(0);
        expect(metrics.lcp).toBeGreaterThanOrEqual(0);
        expect(metrics.cls).toBeGreaterThanOrEqual(0);
        expect(metrics.inp).toBeGreaterThanOrEqual(0);
    });

    test('registers the service worker and exercises offline cache controls when supported', async ({ page, context }) => {
        await openApp(page);
        const registration = await page.evaluate(async () => {
            if (!('serviceWorker' in navigator)) return { supported: false, scope: '', scriptURL: '', controller: false };
            const ready = await navigator.serviceWorker.ready;
            return { supported: true, scope: ready.scope, scriptURL: ready.active?.scriptURL ?? '', controller: Boolean(navigator.serviceWorker.controller) };
        });
        expect(registration.supported).toBe(true);
        expect(registration.scope).toBe(new URL('./', await page.url()).href);
        expect(registration.scriptURL).toBe(new URL('./sw.js', await page.url()).href);
        if (!registration.controller) {
            await page.reload();
            await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
        }
        await installCacheStatusObserver(page);

        const beforeRefresh = await getOwnedCacheState(page);
        await waitForCacheOperation(page, '#refresh-cache-btn', 'ready');
        const afterRefresh = await getOwnedCacheState(page);
        if (afterRefresh.supported) {
            expect(afterRefresh.names.every((name) => name.startsWith(appCachePrefix))).toBe(true);
            expect(afterRefresh.names.some((name) => name.endsWith('-staging'))).toBe(false);
            expect(afterRefresh.entries.length).toBeGreaterThan(0);
        }
        test.info().annotations.push({ type: 'cache-state', description: `before=${beforeRefresh.names.length}/${beforeRefresh.entries.length}, after-refresh=${afterRefresh.names.length}/${afterRefresh.entries.length}` });

        await waitForCacheOperation(page, '#clear-cache-btn', 'disabled');
        const afterClear = await getOwnedCacheState(page);
        if (afterClear.supported) {
            expect(afterClear.names.every((name) => name.startsWith(appCachePrefix))).toBe(true);
            expect(afterClear.names.some((name) => name.endsWith('-staging'))).toBe(false);
            expect(afterClear.entries.length).toBeLessThanOrEqual(afterRefresh.entries.length);
        }
        test.info().annotations.push({ type: 'cache-state', description: `after-clear=${afterClear.names.length}/${afterClear.entries.length}` });

        await context.setOffline(true);
        await page.reload();
        await expect(page.locator('#app-container')).toBeVisible({ timeout: 15_000 });
        await context.setOffline(false);
    });
});
