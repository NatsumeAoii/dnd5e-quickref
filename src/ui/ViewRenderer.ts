import { CONFIG } from '../config.js';
import type { DOMProvider } from '../services/DOMProvider.js';
import type { UserDataService } from '../services/UserDataService.js';
import type { StateManager } from '../state/StateManager.js';
import type { TemplateService } from './TemplateService.js';
import type { RuleInfo } from '../types.js';

export class ViewRenderer {
    #domProvider: DOMProvider;
    #stateManager: StateManager;
    #userDataService: UserDataService;
    #templateService: TemplateService;
    #notificationContainer: HTMLElement | null = null;

    constructor(domProvider: DOMProvider, stateManager: StateManager, userDataService: UserDataService, templateService: TemplateService) {
        this.#domProvider = domProvider;
        this.#stateManager = stateManager;
        this.#userDataService = userDataService;
        this.#templateService = templateService;
        try { this.#notificationContainer = this.#domProvider.get(CONFIG.ELEMENT_IDS.NOTIFICATION_CONTAINER); } catch { console.error('Notification container not found.'); }
    }

    renderSection(parentId: string, rules: { popupId: string; ruleInfo: RuleInfo }[]): void {
        const parent = this.#domProvider.get(parentId);
        const fragment = document.createDocumentFragment();
        rules.forEach(({ popupId, ruleInfo }, index) => {
            const item = this.#templateService.createRuleItemElement(popupId, ruleInfo.ruleData, this.#userDataService.isFavorite(popupId));
            (item as HTMLElement).style.animationDelay = `${index * CONFIG.ANIMATION_DURATION.ITEM_DELAY_MS}ms`;
            if (ruleInfo.ruleData.subtitle) (item as HTMLElement).dataset.tooltip = ruleInfo.ruleData.subtitle;
            fragment.appendChild(item);
        });

        if (document.startViewTransition) {
            document.startViewTransition(() => {
                parent.replaceChildren(fragment);
                this.#postRender(parent);
            });
        } else {
            parent.replaceChildren(fragment);
            this.#postRender(parent);
        }
    }

    #postRender(parent: HTMLElement): void {
        parent.querySelectorAll(`[${CONFIG.ATTRIBUTES.ICON}]`).forEach((iconEl) => {
            const iconName = iconEl.getAttribute(CONFIG.ATTRIBUTES.ICON);
            if (iconName) iconEl.classList.add(`icon-${iconName}`);
        });
        this.filterRuleItems();
    }

    #updateSectionItemCount(section: Element, count: number): void {
        const title = section.querySelector(`.${CONFIG.CSS.SECTION_TITLE}`);
        if (!title) return;
        let badge = title.querySelector('.section-item-count') as HTMLElement;
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'section-item-count';
            const firstSpan = title.querySelector('span');
            if (firstSpan) firstSpan.appendChild(badge);
        }
        badge.textContent = `(${count})`;
    }

    renderFavoritesSection(): void {
        const state = this.#stateManager.getState();
        const favs = [...state.user.favorites]
            .map((id) => ({ popupId: id, ruleInfo: state.data.ruleMap.get(id)! }))
            .filter((item) => item.ruleInfo);
        this.renderSection(CONFIG.ELEMENT_IDS.FAVORITES_CONTAINER, favs);
        this.#domProvider.get(CONFIG.ELEMENT_IDS.FAVORITES_PLACEHOLDER).style.display = favs.length > 0 ? 'none' : 'block';
        this.#domProvider.get(CONFIG.ELEMENT_IDS.SECTION_FAVORITES).classList.toggle(CONFIG.CSS.HIDDEN, favs.length === 0);
    }

    applyAppearance({ theme, darkMode, density }: { theme: string; darkMode: boolean; density?: string }): void {
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.mode = darkMode ? 'dark' : 'light';
        if (density && density !== 'normal') {
            document.documentElement.dataset.density = density;
        } else {
            delete document.documentElement.dataset.density;
        }
        try {
            const themeLink = this.#domProvider.get(CONFIG.ELEMENT_IDS.THEME_STYLESHEET) as HTMLLinkElement;
            if (theme !== 'original') {
                themeLink.href = `${CONFIG.THEME_CONFIG.PATH}${theme}.css`;
                themeLink.disabled = false;
            } else {
                themeLink.href = '';
                themeLink.disabled = true;
            }
        } catch (e) { console.error('Failed to apply theme stylesheet:', e); }
    }

    applyMotionReduction = (isEnabled: boolean): void => { document.body.classList.toggle(CONFIG.CSS.MOTION_REDUCED, isEnabled); };

    filterRuleItems(): void {
        const { showOptional, showHomebrew } = this.#stateManager.getState().settings;
        const sectionCounts = new Map<Element, number>();

        this.#domProvider.queryAll(`.${CONFIG.CSS.ITEM_SIZE_CLASS}`).forEach((item) => {
            if (item.getAttribute(CONFIG.ATTRIBUTES.FILTERABLE) === 'false') return;
            const type = item.getAttribute(CONFIG.ATTRIBUTES.RULE_TYPE);
            const isOpt = type === 'Optional rule';
            const isHB = type === 'Homebrew rule';
            const show = (!isOpt && !isHB) || (isOpt && showOptional) || (isHB && showHomebrew);
            if (item instanceof HTMLElement) item.style.display = show ? 'flex' : 'none';

            const section = item.closest(`.${CONFIG.CSS.SECTION_CONTAINER}`);
            if (section) {
                if (!sectionCounts.has(section)) sectionCounts.set(section, 0);
                if (show) sectionCounts.set(section, sectionCounts.get(section)! + 1);
            }
        });

        sectionCounts.forEach((count, section) => this.#updateSectionItemCount(section, count));
    }

    renderFatalError(msg: string): void {
        const container = document.createElement('div');
        container.className = 'fatal-error-container';

        const card = document.createElement('div');
        card.className = 'fatal-error-card';

        const icon = document.createElement('div');
        icon.className = 'fatal-error-icon';
        icon.innerHTML = '⚠️';

        const title = document.createElement('h1');
        title.className = 'fatal-error-title';
        title.textContent = 'Critical Error';

        const message = document.createElement('p');
        message.className = 'fatal-error-message';
        message.innerHTML = 'The application encountered a problem it couldn\'t recover from.<br>Please try refreshing the page.';

        const codeBlock = document.createElement('div');
        codeBlock.className = 'fatal-error-code';
        codeBlock.textContent = msg;

        const actions = document.createElement('div');
        actions.className = 'fatal-error-actions';

        const reloadBtn = document.createElement('button');
        reloadBtn.className = 'btn-error-action btn-primary';
        reloadBtn.innerHTML = 'Reload Page';
        reloadBtn.onclick = () => window.location.reload();

        const resetBtn = document.createElement('button');
        resetBtn.className = 'btn-error-action btn-secondary';
        resetBtn.innerHTML = 'Reset App';
        resetBtn.onclick = async () => {
            if (window.confirm('This will clear all local data and cache. Are you sure?')) {
                try {
                    if ('serviceWorker' in navigator) {
                        const registrations = await navigator.serviceWorker.getRegistrations();
                        await Promise.all(registrations.map((r) => r.unregister()));
                    }
                    if ('caches' in window) {
                        const keys = await caches.keys();
                        await Promise.all(keys.map((key) => caches.delete(key)));
                    }
                    localStorage.clear();
                    sessionStorage.clear();
                    window.location.reload();
                } catch {
                    window.alert('Reset failed. Please clear browser data manually.');
                }
            }
        };

        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn-error-action btn-secondary';
        copyBtn.innerHTML = 'Copy Error';
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(msg).then(() => {
                copyBtn.innerHTML = 'Copied';
                setTimeout(() => { copyBtn.innerHTML = 'Copy Error'; }, 2000);
            });
        };

        const reportBtn = document.createElement('button');
        reportBtn.className = 'btn-error-action btn-secondary';
        reportBtn.innerHTML = 'Report Issue';
        reportBtn.onclick = () => {
            const body = `Error Report:\n\n${msg}\n\nUser Agent: ${navigator.userAgent}`;
            window.open(`https://github.com/NatsumeAoii/dnd5e-quickref/issues/new?title=Critical+Error&body=${encodeURIComponent(body)}`, '_blank');
        };

        actions.append(reloadBtn, resetBtn, copyBtn, reportBtn);
        card.append(icon, title, message, codeBlock, actions);
        container.appendChild(card);
        document.body.replaceChildren(container);
    }

    updateFooterInfo(): void {
        try {
            const yearEl = this.#domProvider.get(CONFIG.ELEMENT_IDS.COPYRIGHT_YEAR);
            const currentYear = new Date().getFullYear();
            yearEl.textContent = currentYear > 2016 ? `2016–${currentYear}` : '2016';
        } catch (e) { console.warn(`Could not update copyright year: ${(e as Error).message}`); }

        try {
            const versionEl = this.#domProvider.get(CONFIG.ELEMENT_IDS.APP_VERSION_DISPLAY);
            versionEl.textContent = `v${CONFIG.APP_VERSION}`;
        } catch (e) { console.warn(`Could not update app version: ${(e as Error).message}`); }
    }

    showApp(): void {
        this.#domProvider.get(CONFIG.ELEMENT_IDS.SKELETON_LOADER).classList.add(CONFIG.CSS.HIDDEN);
        const app = this.#domProvider.get(CONFIG.ELEMENT_IDS.APP_CONTAINER);
        app.classList.remove(CONFIG.CSS.HIDDEN);
        app.style.opacity = '1';
    }

    showNotification(message: string, level = 'info'): void {
        if (!this.#notificationContainer) return;
        const notification = document.createElement('div');
        notification.className = 'notification-toast';
        notification.dataset.level = level;

        const iconMap: Record<string, string> = {
            info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌',
        };
        const iconEl = document.createElement('div');
        iconEl.className = 'notification-icon';
        iconEl.textContent = iconMap[level] || 'ℹ️';

        const msgEl = document.createElement('div');
        msgEl.className = 'notification-message';
        msgEl.textContent = message;

        notification.append(iconEl, msgEl);
        this.#notificationContainer.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideInRight 0.3s reverse forwards';
            notification.addEventListener('animationend', () => notification.remove());
        }, CONFIG.ANIMATION_DURATION.NOTIFICATION_MS);
    }
}
