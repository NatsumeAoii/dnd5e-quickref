(function (window, document) {
    'use strict';

    const CONFIG = Object.freeze({
        STORAGE_KEYS: Object.freeze({
            RULES_2024: 'rules2024', OPTIONAL: 'optional', HOMEBREW: 'homebrew',
            THEME: 'theme', MODE: 'mode', REDUCE_MOTION: 'reduceMotion', COOKIES_ACCEPTED: 'cookiesAccepted',
            FAVORITES: 'userFavorites', NOTES: 'userNotes',
        }),
        SESSION_STORAGE_KEYS: Object.freeze({
            RULESET_CHANGED: 'rulesetChanged', UI_SESSION: 'uiSession',
        }),
        ELEMENT_IDS: Object.freeze({
            POPUP_CONTAINER: 'popup-container', COOKIE_NOTICE: 'cookie-notice',
            ACCEPT_COOKIES_BTN: 'accept-cookies', COPYRIGHT_YEAR: 'copyright-year',
            CLOSE_ALL_POPUPS_BTN: 'close-all-popups-btn', FAVORITES_CONTAINER: 'favorites-container',
            FAVORITES_PLACEHOLDER: 'favorites-placeholder', SECTION_FAVORITES: 'section-favorites',
            ARIA_ANNOUNCER: 'aria-announcer', MAIN_SCROLL_AREA: 'main-scroll-area',
            RULE_ITEM_TEMPLATE: 'rule-item-template', POPUP_TEMPLATE: 'popup-template',
            THEME_SELECT: 'theme-select', THEME_STYLESHEET: 'theme-stylesheet',
        }),
        THEME_CONFIG: Object.freeze({
            PATH: 'themes/',
            MANIFEST: 'themes/themes.json',
        }),
        DATA_FILES: Object.freeze(['movement', 'action', 'bonusaction', 'reaction', 'condition', 'environment']),
        SECTION_CONFIG: Object.freeze([
            { id: 'basic-movement', dataKey: 'movement', type: 'Move' },
            { id: 'basic-actions', dataKey: 'action', type: 'Action' },
            { id: 'basic-bonus-actions', dataKey: 'bonusaction', type: 'Bonus action' },
            { id: 'basic-reactions', dataKey: 'reaction', type: 'Reaction' },
            { id: 'basic-conditions', dataKey: 'condition', type: 'Condition' },
            { id: 'environment-obscurance', dataKey: 'environment_obscurance', type: 'Environment' },
            { id: 'environment-light', dataKey: 'environment_light', type: 'Environment' },
            { id: 'environment-vision', dataKey: 'environment_vision', type: 'Environment' },
            { id: 'environment-cover', dataKey: 'environment_cover', type: 'Environment' },
            { id: 'environment-other', dataKey: 'environment_other', type: 'Environment' },
        ]),
        SETTINGS_CONFIG: Object.freeze([
            { id: 'optional-switch', key: 'OPTIONAL', stateProp: 'showOptional', type: 'checkbox' },
            { id: 'homebrew-switch', key: 'HOMEBREW', stateProp: 'showHomebrew', type: 'checkbox' },
            { id: 'rules2024-switch', key: 'RULES_2024', stateProp: 'use2024Rules', type: 'checkbox' },
            { id: 'reduce-motion-switch', key: 'REDUCE_MOTION', stateProp: 'reduceMotion', type: 'checkbox' },
            { id: 'theme-select', key: 'THEME', stateProp: 'theme', type: 'select' },
            { id: 'mode-switch', key: 'MODE', stateProp: 'darkMode', type: 'checkbox' },
        ]),
        CSS: Object.freeze({
            FATAL_ERROR: 'fatal-error-message', MOTION_REDUCED: 'motion-reduced',
            ITEM_CLASS: 'item', ITEM_SIZE_CLASS: 'itemsize', IS_DRAGGING: 'is-dragging',
            IS_ACTIVE: 'is-active', IS_CLOSING: 'is-closing', IS_VISIBLE: 'is-visible',
            IS_FAVORITED: 'is-favorited', IS_COLLAPSED: 'is-collapsed', LINK_DISABLED: 'is-disabled',
            POPUP_WINDOW: 'popup-window', POPUP_MODAL: 'is-modal', POPUP_CONTAINER_MODAL_OPEN: 'modal-open',
            POPUP_CLOSE_BTN: 'popup-close-btn', SECTION_CONTAINER: 'section-container', HIDDEN: 'hidden',
        }),
        DEFAULTS: Object.freeze({
            ICON: 'perspective-dice-six-faces-one', TITLE: '[Untitled Rule]', RULE_TYPE: 'Standard rule', THEME: 'original',
        }),
        ATTRIBUTES: Object.freeze({
            RULE_TYPE: 'data-rule-type', FILTERABLE: 'data-filterable', POPUP_ID: 'data-popup-id', RENDERED: 'data-rendered',
        }),
        UI_STRINGS: Object.freeze({
            NOTE_STATUS_SAVING: 'Saving...', NOTE_STATUS_SAVED: '✓ Saved',
        }),
        DESKTOP_BREAKPOINT_MIN_PX: 1024, POPUP_CASCADE_OFFSET_PX: 30, POPUP_CASCADE_WRAP_COUNT: 10,
        POPUP_Z_INDEX_BASE: 1000, ITEM_ANIMATION_DELAY_MS: 30, POPUP_ANIMATION_DURATION_MS: 300,
        NOTE_AUTOSAVE_DELAY_MS: 750, NOTE_SAVED_FADEOUT_MS: 2000,
    });

    class DOMElementNotFoundError extends Error {
        constructor(elementId) { super(`Required DOM element with ID "${elementId}" was not found.`); this.name = 'DOMElementNotFoundError'; }
    }
    class DataLoadError extends Error {
        constructor(src, details = '') { super(`Failed to load required data: ${src}. ${details}`); this.name = 'DataLoadError'; }
    }

    const debounce = (func, delay) => {
        let timeoutId;
        return (...args) => { clearTimeout(timeoutId); timeoutId = setTimeout(() => func.apply(this, args), delay); };
    };

    class DOMProvider {
        get(id) { const el = document.getElementById(id); if (!el) throw new DOMElementNotFoundError(id); return el; }
        getTemplate(id) { const tpl = this.get(id); if (!(tpl instanceof HTMLTemplateElement)) throw new TypeError(`Element "${id}" is not a <template>.`); return tpl; }
    }

    class A11yService {
        #announcerEl;
        constructor(domProvider) { try { this.#announcerEl = domProvider.get(CONFIG.ELEMENT_IDS.ARIA_ANNOUNCER); } catch { console.warn("ARIA announcer not found."); } }
        announce(message) { if (this.#announcerEl) { this.#announcerEl.textContent = message; } }
    }

    class SettingsService {
        #storage; #appState;
        constructor(storage, appState) { this.#storage = storage; this.#appState = appState; }
        #readBool = (key) => this.#storage.getItem(key) === 'true';
        #readString = (key, def) => this.#storage.getItem(key) || def;
        initialize() {
            this.#appState.settings.use2024Rules = this.#readBool(CONFIG.STORAGE_KEYS.RULES_2024);
            this.#appState.settings.showOptional = this.#readBool(CONFIG.STORAGE_KEYS.OPTIONAL);
            this.#appState.settings.showHomebrew = this.#readBool(CONFIG.STORAGE_KEYS.HOMEBREW);
            this.#appState.settings.reduceMotion = this.#readBool(CONFIG.STORAGE_KEYS.REDUCE_MOTION);
            this.#appState.settings.theme = this.#readString(CONFIG.STORAGE_KEYS.THEME, CONFIG.DEFAULTS.THEME);
            this.#appState.settings.darkMode = this.#readBool(CONFIG.STORAGE_KEYS.MODE);
        }
        update(key, value) {
            const cfg = CONFIG.SETTINGS_CONFIG.find(c => CONFIG.STORAGE_KEYS[c.key] === key);
            if (cfg) { this.#appState.settings[cfg.stateProp] = value; }
            this.#storage.setItem(key, String(value));
        }
    }

    class UserDataService {
        #storage; #appState;
        constructor(storage, appState) { this.#storage = storage; this.#appState = appState; }
        #load = (key, def) => { try { const val = this.#storage.getItem(key); return val ? JSON.parse(val) : def; } catch (e) { console.error(`Failed to parse user data for "${key}":`, e); return def; } };
        initialize() { this.#appState.user.favorites = new Set(this.#load(CONFIG.STORAGE_KEYS.FAVORITES, [])); this.#appState.user.notes = new Map(Object.entries(this.#load(CONFIG.STORAGE_KEYS.NOTES, {}))); }
        toggleFavorite(id) { this.#appState.user.favorites.has(id) ? this.#appState.user.favorites.delete(id) : this.#appState.user.favorites.add(id); this.#storage.setItem(CONFIG.STORAGE_KEYS.FAVORITES, JSON.stringify([...this.#appState.user.favorites])); }
        isFavorite = (id) => this.#appState.user.favorites.has(id);
        saveNote(id, text) { this.#appState.user.notes.set(id, text); this.#storage.setItem(CONFIG.STORAGE_KEYS.NOTES, JSON.stringify(Object.fromEntries(this.#appState.user.notes))); }
        getNote = (id) => this.#appState.user.notes.get(id) || '';
    }

    class PersistenceService {
        #storage; #appState;
        constructor(storage, appState) { this.#storage = storage; this.#appState = appState; }
        saveSession() { const state = { openPopups: [], activeZIndex: this.#appState.ui.activeZIndex }; this.#appState.ui.openPopups.forEach((el, id) => { state.openPopups.push({ id, top: el.style.top, left: el.style.left, zIndex: el.style.zIndex }); }); this.#storage.setItem(CONFIG.SESSION_STORAGE_KEYS.UI_SESSION, JSON.stringify(state)); }
        loadSession() { const saved = this.#storage.getItem(CONFIG.SESSION_STORAGE_KEYS.UI_SESSION); if (!saved) return []; try { const parsed = JSON.parse(saved); this.#appState.ui.activeZIndex = parsed.activeZIndex || this.#appState.ui.activeZIndex; return parsed.openPopups || []; } catch (e) { console.error('Failed to parse session state:', e); return []; } }
    }

    class DataService {
        #appState; constructor(appState) { this.#appState = appState; }
        getDataSourceKey = (key) => key.startsWith('environment_') ? 'environment' : key;
        async loadAllData() { const prefix = this.#appState.settings.use2024Rules ? '2024_' : ''; const promises = CONFIG.DATA_FILES.map(async (name) => { const path = `js/${prefix}data_${name}.json`; try { const res = await fetch(path); if (!res.ok) throw new DataLoadError(path, `HTTP ${res.status}`); this.#appState.data[name] = await res.json(); } catch (e) { console.error(`Data load failed for ${name}:`, e); this.#appState.data[name] = []; throw e; } }); await Promise.all(promises); }
        buildRuleMap() { this.#appState.data.ruleMap.clear(); for (const section of CONFIG.SECTION_CONFIG) { const srcKey = this.getDataSourceKey(section.dataKey); const src = this.#appState.data[srcKey]; if (Array.isArray(src)) { src.forEach(rule => { if (rule.title) { const id = `${section.type}::${rule.title}`; this.#appState.data.ruleMap.set(id, { ruleData: rule, type: section.type, sectionId: section.id }); } }); } } }
        buildLinkerData() { const titles = [...new Set([...this.#appState.data.ruleMap.keys()].map(k => k.split('::')[1]).filter(t => t.length > 2))].sort((a, b) => b.length - a.length); const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const pattern = `\\b(${titles.map(esc).join('|')})\\b`; this.#appState.data.ruleLinkerRegex = new RegExp(pattern, 'gi'); }
    }

    class TemplateService {
        #domProvider;
        constructor(domProvider) { this.#domProvider = domProvider; }
        createRuleItemElement(popupId, ruleData, isFavorite) { const tpl = this.#domProvider.getTemplate(CONFIG.ELEMENT_IDS.RULE_ITEM_TEMPLATE); const item = tpl.content.cloneNode(true).firstElementChild; item.setAttribute(CONFIG.ATTRIBUTES.RULE_TYPE, ruleData.optional || CONFIG.DEFAULTS.RULE_TYPE); item.setAttribute(CONFIG.ATTRIBUTES.POPUP_ID, popupId); item.querySelector('.item-icon').className = `item-icon iconsize icon-${ruleData.icon || CONFIG.DEFAULTS.ICON}`; item.querySelector('.item-title').textContent = ruleData.title || CONFIG.DEFAULTS.TITLE; item.querySelector('.item-desc').textContent = ruleData.subtitle || ''; item.querySelector('.favorite-btn').classList.toggle(CONFIG.CSS.IS_FAVORITED, isFavorite); return item; }
        createPopupElement(popupId, { ruleData, type, sectionId }, linkifyFn, getNoteFn) { const tpl = this.#domProvider.getTemplate(CONFIG.ELEMENT_IDS.POPUP_TEMPLATE); const popup = tpl.content.cloneNode(true).firstElementChild; const sourceSection = document.getElementById(sectionId)?.closest(`.${CONFIG.CSS.SECTION_CONTAINER}`); const borderColor = sourceSection ? window.getComputedStyle(sourceSection).borderColor : 'var(--color-hr)'; popup.setAttribute('aria-labelledby', 'popup-title-text'); popup.style.borderColor = borderColor; popup.querySelector('.popup-header').style.setProperty('--section-color', borderColor); popup.querySelector('.popup-title').textContent = ruleData.title || CONFIG.DEFAULTS.TITLE; popup.querySelector('.popup-type').textContent = type; popup.querySelector('.popup-description').innerHTML = linkifyFn(ruleData.description || ruleData.subtitle || ''); popup.querySelector('.popup-reference').textContent = ruleData.reference || ''; if (Array.isArray(ruleData.bullets)) { popup.querySelector('.popup-bullets').innerHTML = ruleData.bullets.map(b => `<p>${linkifyFn(b)}</p>`).join('<hr>'); } const textarea = popup.querySelector('.popup-notes-textarea'); const notesLabel = popup.querySelector('.popup-notes-label'); notesLabel.setAttribute('for', `notes-${popupId}`); textarea.id = `notes-${popupId}`; textarea.value = getNoteFn(popupId); return popup; }
    }

    class ViewRenderer {
        #domProvider; #appState; #userDataService; #templateService;
        constructor(domProvider, appState, userDataService, templateService) { this.#domProvider = domProvider; this.#appState = appState; this.#userDataService = userDataService; this.#templateService = templateService; }
        renderSection(parentId, rules) { const parent = this.#domProvider.get(parentId); const fragment = document.createDocumentFragment(); rules.forEach(({ popupId, ruleInfo }, index) => { const item = this.#templateService.createRuleItemElement(popupId, ruleInfo.ruleData, this.#userDataService.isFavorite(popupId)); item.style.animationDelay = `${index * CONFIG.ITEM_ANIMATION_DELAY_MS}ms`; fragment.appendChild(item); }); parent.replaceChildren(fragment); }
        renderFavoritesSection() { const favs = [...this.#appState.user.favorites].map(id => ({ popupId: id, ruleInfo: this.#appState.data.ruleMap.get(id) })).filter(item => item.ruleInfo); this.renderSection(CONFIG.ELEMENT_IDS.FAVORITES_CONTAINER, favs); this.#domProvider.get(CONFIG.ELEMENT_IDS.FAVORITES_PLACEHOLDER).style.display = favs.length > 0 ? 'none' : 'block'; this.#domProvider.get(CONFIG.ELEMENT_IDS.SECTION_FAVORITES).classList.toggle(CONFIG.CSS.HIDDEN, favs.length === 0); }
        applyAppearance({ theme, darkMode }) {
            const mode = darkMode ? 'dark' : 'light';
            document.documentElement.dataset.theme = theme;
            document.documentElement.dataset.mode = mode;
            try {
                const themeLink = this.#domProvider.get(CONFIG.ELEMENT_IDS.THEME_STYLESHEET);
                if (theme !== 'original') {
                    themeLink.href = `${CONFIG.THEME_CONFIG.PATH}${theme}.css`;
                    themeLink.disabled = false;
                } else {
                    themeLink.href = '';
                    themeLink.disabled = true;
                }
            } catch (e) {
                console.error('Failed to apply theme stylesheet:', e);
            }
        }
        applyMotionReduction = (isEnabled) => document.body.classList.toggle(CONFIG.CSS.MOTION_REDUCED, isEnabled);
        filterRuleItems(settings) { document.querySelectorAll(`.${CONFIG.CSS.ITEM_SIZE_CLASS}`).forEach(item => { if (item.getAttribute(CONFIG.ATTRIBUTES.FILTERABLE) === 'false') return; const type = item.getAttribute(CONFIG.ATTRIBUTES.RULE_TYPE); const isOpt = type === 'Optional rule'; const isHB = type === 'Homebrew rule'; const show = (!isOpt && !isHB) || (isOpt && settings.showOptional) || (isHB && settings.showHomebrew); if (item instanceof HTMLElement) item.style.display = show ? 'flex' : 'none'; }); }
        renderFatalError(msg) { const err = document.createElement('p'); err.textContent = msg; err.className = CONFIG.CSS.FATAL_ERROR; document.body.replaceChildren(err); }
        updateCopyrightYear() { try { this.#domProvider.get(CONFIG.ELEMENT_IDS.COPYRIGHT_YEAR).textContent = new Date().getFullYear().toString(); } catch (e) { console.warn(`Could not update copyright year: ${e.message}`); } }
    }

    class WindowManager {
        #domProvider; #appState; #persistenceService; #userDataService; #a11yService; #templateService; #popupContainer; #closeAllBtn; #isMobileView;
        constructor(services) { this.#domProvider = services.domProvider; this.#appState = services.appState; this.#persistenceService = services.persistenceService; this.#userDataService = services.userDataService; this.#a11yService = services.a11yService; this.#templateService = services.templateService; }
        initialize() { this.#popupContainer = this.#domProvider.get(CONFIG.ELEMENT_IDS.POPUP_CONTAINER); this.#closeAllBtn = this.#domProvider.get(CONFIG.ELEMENT_IDS.CLOSE_ALL_POPUPS_BTN); this.#handleResize(); this.#popupContainer.addEventListener('click', this.#handleContainerClick); this.#closeAllBtn.addEventListener('click', this.closeAllPopups); window.addEventListener('resize', debounce(() => this.#handleResize(), 200)); document.addEventListener('keydown', this.#handleKeyDown); }
        #linkifyContent = (html) => { if (!html || !this.#appState.data.ruleLinkerRegex) return html; const div = document.createElement('div'); div.innerHTML = html; const walk = (node) => { if (node.nodeType === 3) { const matches = [...node.textContent.matchAll(this.#appState.data.ruleLinkerRegex)]; if (matches.length > 0) { const frag = document.createDocumentFragment(); let lastIdx = 0; matches.forEach(match => { const text = match[0]; const start = match.index; if (start > lastIdx) frag.appendChild(document.createTextNode(node.textContent.substring(lastIdx, start))); const link = document.createElement('a'); link.className = 'rule-link'; link.textContent = text; const id = Array.from(this.#appState.data.ruleMap.keys()).find(key => key.toLowerCase().endsWith(`::${text.toLowerCase()}`)); if (id) link.setAttribute('data-popup-id', id); frag.appendChild(id ? link : document.createTextNode(text)); lastIdx = start + text.length; }); if (lastIdx < node.textContent.length) frag.appendChild(document.createTextNode(node.textContent.substring(lastIdx))); node.parentNode.replaceChild(frag, node); } } else if (node.nodeType === 1 && node.nodeName !== 'A' && node.nodeName !== 'BUTTON') Array.from(node.childNodes).forEach(walk); }; walk(div); return div.innerHTML; };
        #updateAllLinkStates() { const openIds = new Set(this.#appState.ui.openPopups.keys()); this.#popupContainer.querySelectorAll('a.rule-link').forEach(link => { const id = link.dataset.popupId; if (id) link.classList.toggle(CONFIG.CSS.LINK_DISABLED, openIds.has(id)); }); }
        #updateCloseBtnVisibility = () => this.#closeAllBtn?.classList.toggle(CONFIG.CSS.IS_VISIBLE, this.#appState.ui.openPopups.size > 1);
        #closePopup = (id) => { const popup = this.#appState.ui.openPopups.get(id); if (!popup) return; popup.classList.add(CONFIG.CSS.IS_CLOSING); this.#appState.ui.openPopups.delete(id); this.#a11yService.announce(`Closed popup for ${id.split('::')[1]}`); this.#updateAllLinkStates(); if (this.#isMobileView) this.#popupContainer.classList.remove(CONFIG.CSS.POPUP_CONTAINER_MODAL_OPEN); setTimeout(() => { popup.remove(); this.#updateCloseBtnVisibility(); }, CONFIG.POPUP_ANIMATION_DURATION_MS); this.#persistenceService.saveSession(); this.#updateCloseBtnVisibility(); };
        #handleKeyDown = (e) => { if (e.key !== 'Escape' || this.#appState.ui.openPopups.size === 0) return; let topId = null, maxZ = -1; this.#appState.ui.openPopups.forEach((el, id) => { const z = parseInt(el.style.zIndex || 0, 10); if (z > maxZ) { maxZ = z; topId = id; } }); if (topId) this.#closePopup(topId); };
        #bringToFront(popup) { if (popup.classList.contains(CONFIG.CSS.IS_ACTIVE)) return; this.#popupContainer.querySelectorAll(`.${CONFIG.CSS.POPUP_WINDOW}`).forEach(w => w.classList.remove(CONFIG.CSS.IS_ACTIVE)); this.#appState.ui.activeZIndex++; popup.style.zIndex = String(this.#appState.ui.activeZIndex); popup.classList.add(CONFIG.CSS.IS_ACTIVE); this.#persistenceService.saveSession(); }
        #makeDraggable(popup) { const header = popup.querySelector('.popup-header'); if (!header) return; const onMouseDown = (mdEvent) => { if (!(mdEvent.target instanceof HTMLElement) || mdEvent.target.closest(`.${CONFIG.CSS.POPUP_CLOSE_BTN}`)) return; mdEvent.preventDefault(); this.#bringToFront(popup); header.classList.add(CONFIG.CSS.IS_DRAGGING); const rect = popup.getBoundingClientRect(); const offX = mdEvent.clientX - rect.left; const offY = mdEvent.clientY - rect.top; const onMouseMove = (mmEvent) => { popup.style.left = `${mmEvent.clientX - offX}px`; popup.style.top = `${mmEvent.clientY - offY}px`; }; const onMouseUp = () => { header.classList.remove(CONFIG.CSS.IS_DRAGGING); document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); this.#persistenceService.saveSession(); }; document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp); }; header.addEventListener('mousedown', onMouseDown); }
        #createPopup(id, ruleInfo, pos) {
            const popup = this.#templateService.createPopupElement(id, ruleInfo, this.#linkifyContent, this.#userDataService.getNote);

            const textarea = popup.querySelector('.popup-notes-textarea');
            const statusEl = popup.querySelector('.popup-notes-status');
            if (textarea && statusEl) {
                const debouncedSave = debounce(() => {
                    this.#userDataService.saveNote(id, textarea.value);
                    statusEl.textContent = CONFIG.UI_STRINGS.NOTE_STATUS_SAVED;
                    this.#appState.ui.fadeTimeout = setTimeout(() => {
                        if (statusEl.textContent === CONFIG.UI_STRINGS.NOTE_STATUS_SAVED) statusEl.textContent = '';
                    }, CONFIG.NOTE_SAVED_FADEOUT_MS);
                }, CONFIG.NOTE_AUTOSAVE_DELAY_MS);

                textarea.addEventListener('input', () => {
                    clearTimeout(this.#appState.ui.fadeTimeout);
                    statusEl.textContent = CONFIG.UI_STRINGS.NOTE_STATUS_SAVING;
                    debouncedSave();
                });
            }

            if (this.#isMobileView) {
                popup.classList.add(CONFIG.CSS.POPUP_MODAL); this.#popupContainer.classList.add(CONFIG.CSS.POPUP_CONTAINER_MODAL_OPEN);
            } else {
                if (pos?.top && pos?.left) { popup.style.top = pos.top; popup.style.left = pos.left; }
                else { const offset = (this.#appState.ui.openPopups.size % CONFIG.POPUP_CASCADE_WRAP_COUNT) * CONFIG.POPUP_CASCADE_OFFSET_PX; popup.style.top = `${50 + offset}px`; popup.style.left = `${100 + offset}px`; }
                popup.addEventListener('mousedown', () => this.#bringToFront(popup), true);
                this.#makeDraggable(popup);
            }
            this.#popupContainer.appendChild(popup);
            popup.style.zIndex = pos?.zIndex || String(++this.#appState.ui.activeZIndex);
            this.#appState.ui.openPopups.set(id, popup);
            this.#a11yService.announce(`Opened popup for ${ruleInfo.ruleData.title}`);
            this.#updateAllLinkStates();
            this.#updateCloseBtnVisibility();
            this.#persistenceService.saveSession();
            popup.querySelector('.popup-content')?.focus();
        }
        #handleResize = () => { this.#isMobileView = window.innerWidth < CONFIG.DESKTOP_BREAKPOINT_MIN_PX; };
        #handleContainerClick = (e) => { const target = e.target; if (target.closest(`.${CONFIG.CSS.POPUP_CLOSE_BTN}`)) { const popup = target.closest(`.${CONFIG.CSS.POPUP_WINDOW}`); const popupId = Array.from(this.#appState.ui.openPopups.entries()).find(([, p]) => p === popup)?.[0]; if (popupId) this.#closePopup(popupId); } const link = target.closest('a.rule-link'); if (link && !link.classList.contains(CONFIG.CSS.LINK_DISABLED) && link.dataset.popupId) { e.preventDefault(); this.togglePopup(link.dataset.popupId); } };
        togglePopup(id) { if (this.#appState.ui.openPopups.has(id)) { this.#closePopup(id); } else { const rule = this.#appState.data.ruleMap.get(id); if (rule) this.#createPopup(id, rule); } }
        createPopupFromState(state) { const rule = this.#appState.data.ruleMap.get(state.id); if (rule) this.#createPopup(state.id, rule, state); }
        closeAllPopups = () => [...this.#appState.ui.openPopups.keys()].forEach(id => this.#closePopup(id));
    }

    class QuickRefApplication {
        #appState; #services = {}; #components = {}; #domProvider;
        constructor() { this.#appState = { settings: {}, user: { favorites: new Set(), notes: new Map() }, ui: { openPopups: new Map(), activeZIndex: CONFIG.POPUP_Z_INDEX_BASE, fadeTimeout: null }, data: { ruleMap: new Map(), ruleLinkerRegex: null } }; this.#domProvider = new DOMProvider(); this.#services.a11y = new A11yService(this.#domProvider); this.#services.settings = new SettingsService(window.localStorage, this.#appState); this.#services.userData = new UserDataService(window.localStorage, this.#appState); this.#services.persistence = new PersistenceService(window.sessionStorage, this.#appState); this.#services.data = new DataService(this.#appState); const templateService = new TemplateService(this.#domProvider); this.#components.viewRenderer = new ViewRenderer(this.#domProvider, this.#appState, this.#services.userData, templateService); this.#components.windowManager = new WindowManager({ domProvider: this.#domProvider, appState: this.#appState, persistenceService: this.#services.persistence, userDataService: this.#services.userData, a11yService: this.#services.a11y, templateService }); }
        async initialize() {
            this.#handlePageLoadActions();
            await this.#loadAndPopulateThemes();
            this.#services.settings.initialize();
            this.#services.userData.initialize();
            this.#components.windowManager.initialize();
            this.#applyInitialSettings();
            this.#setupSettingsHandlers();
            this.#setupCookieNoticeHandler();
            this.#attachGlobalEventHandlers();
            this.#components.viewRenderer.updateCopyrightYear();
            await this.#loadDataAndPrepareUI();
        }
        #applyInitialSettings() { this.#components.viewRenderer.applyAppearance(this.#appState.settings); this.#components.viewRenderer.applyMotionReduction(this.#appState.settings.reduceMotion); }
        #handleSettingChange = (keyName, value) => {
            const key = CONFIG.STORAGE_KEYS[keyName];
            this.#services.settings.update(key, value);
            this.#services.a11y.announce(`Setting updated: ${keyName.toLowerCase().replace('_', ' ')}.`);

            if (key === CONFIG.STORAGE_KEYS.RULES_2024) {
                window.sessionStorage.setItem(CONFIG.SESSION_STORAGE_KEYS.RULESET_CHANGED, 'true');
                window.location.reload();
            } else if (key === CONFIG.STORAGE_KEYS.THEME || key === CONFIG.STORAGE_KEYS.MODE) {
                this.#components.viewRenderer.applyAppearance(this.#appState.settings);
            } else if (key === CONFIG.STORAGE_KEYS.REDUCE_MOTION) {
                this.#components.viewRenderer.applyMotionReduction(value);
            } else {
                this.#components.viewRenderer.filterRuleItems(this.#appState.settings);
            }
        };
        async #loadAndPopulateThemes() {
            try {
                const response = await fetch(CONFIG.THEME_CONFIG.MANIFEST);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const manifest = await response.json();
                
                const selectEl = this.#domProvider.get(CONFIG.ELEMENT_IDS.THEME_SELECT);
                selectEl.innerHTML = '';
                
                manifest.themes.forEach(theme => {
                    const option = document.createElement('option');
                    option.value = theme.id;
                    option.textContent = theme.displayName;
                    selectEl.appendChild(option);
                });
            } catch (e) {
                console.error("Fatal: Could not load theme manifest.", e);
                // Fallback to a minimal default if manifest fails
                const selectEl = this.#domProvider.get(CONFIG.ELEMENT_IDS.THEME_SELECT);
                selectEl.innerHTML = `<option value="original">Original</option>`;
            }
        }
        #setupCollapsibleSections = () => { document.querySelectorAll('.section-title').forEach(header => { const section = header.closest(`.${CONFIG.CSS.SECTION_CONTAINER}`); if (!section || section.dataset.section === 'settings' || section.dataset.section === 'favorites') return; header.setAttribute('role', 'button'); header.setAttribute('tabindex', '0'); const isExpanded = !section.classList.contains(CONFIG.CSS.IS_COLLAPSED); header.setAttribute('aria-expanded', String(isExpanded)); const content = section.querySelector('.section-content'); const handler = () => { const isRendered = content.getAttribute(CONFIG.ATTRIBUTES.RENDERED) === 'true'; if (!isRendered) { this.#renderSectionContent(section); } const collapsed = section.classList.toggle(CONFIG.CSS.IS_COLLAPSED); header.setAttribute('aria-expanded', String(!collapsed)); this.#services.a11y.announce(`${section.dataset.section} section ${collapsed ? 'collapsed' : 'expanded'}.`); }; header.addEventListener('click', handler); header.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } }); }); };
        #attachGlobalEventHandlers = () => { const mainArea = document.getElementById(CONFIG.ELEMENT_IDS.MAIN_SCROLL_AREA); const clickHandler = (e) => { const item = e.target.closest(`.${CONFIG.CSS.ITEM_CLASS}`); if (!item) return; const id = item.getAttribute(CONFIG.ATTRIBUTES.POPUP_ID); if (!id) return; if (e.target.closest('.favorite-btn')) { this.#services.userData.toggleFavorite(id); const isFav = this.#services.userData.isFavorite(id); document.querySelectorAll(`[${CONFIG.ATTRIBUTES.POPUP_ID}="${id}"]`).forEach(el => el.querySelector('.favorite-btn')?.classList.toggle(CONFIG.CSS.IS_FAVORITED, isFav)); this.#components.viewRenderer.renderFavoritesSection(); this.#services.a11y.announce(`${id.split('::')[1]} ${isFav ? 'added to' : 'removed from'} favorites.`); } else if (e.target.closest('.item-content')) { this.#components.windowManager.togglePopup(id); } }; const keydownHandler = (e) => { if (e.key !== 'Enter' && e.key !== ' ') return; const target = e.target.closest('.item-content'); if (target) { e.preventDefault(); target.click(); } }; mainArea.addEventListener('click', clickHandler); mainArea.addEventListener('keydown', keydownHandler); };
        #renderSectionContent(section) {
            const content = section.querySelector('.section-content');
            if (!content) return;

            const dataSectionKey = section.dataset.section;
            if (dataSectionKey === "environment") {
                CONFIG.SECTION_CONFIG.filter(c => c.type === 'Environment').forEach(this.#renderSingleSection);
            } else {
                const dataKey = dataSectionKey.replace('-', '');
                const sectionConfig = CONFIG.SECTION_CONFIG.find(c => c.dataKey === dataKey);
                if (sectionConfig) {
                    this.#renderSingleSection(sectionConfig);
                }
            }
            content.setAttribute(CONFIG.ATTRIBUTES.RENDERED, 'true');
        }
        #renderSingleSection = (section) => { const srcKey = this.#services.data.getDataSourceKey(section.dataKey); const src = this.#appState.data[srcKey]; if (!Array.isArray(src)) { console.warn(`Data source for "${section.dataKey}" is missing.`); return; } let rules = src; if (section.dataKey.startsWith('environment_')) rules = src.filter(d => d.tags?.includes(section.dataKey)); const rulesWithIds = rules.map(rule => ({ popupId: `${section.type}::${rule.title}`, ruleInfo: { ruleData: rule, type: section.type, sectionId: section.id } })); try { this.#components.viewRenderer.renderSection(section.id, rulesWithIds); } catch (e) { console.error(`Failed to render section "${section.id}":`, e); } };
        #loadDataAndPrepareUI = async () => {
            await this.#services.data.loadAllData();
            this.#services.data.buildRuleMap();
            this.#services.data.buildLinkerData();
            
            document.querySelectorAll(`.section-container:not(.${CONFIG.CSS.IS_COLLAPSED})`).forEach(section => {
                if (section.querySelector(`[${CONFIG.ATTRIBUTES.RENDERED}="false"]`)) {
                    this.#renderSectionContent(section);
                }
            });

            this.#setupCollapsibleSections();
            this.#components.viewRenderer.renderFavoritesSection();
            this.#components.viewRenderer.filterRuleItems(this.#appState.settings);
            const popups = this.#services.persistence.loadSession();
            popups.forEach(p => this.#components.windowManager.createPopupFromState(p));
        };
        #setupCookieNoticeHandler = () => { try { const notice = document.getElementById(CONFIG.ELEMENT_IDS.COOKIE_NOTICE); const btn = document.getElementById(CONFIG.ELEMENT_IDS.ACCEPT_COOKIES_BTN); if (window.localStorage.getItem(CONFIG.STORAGE_KEYS.COOKIES_ACCEPTED) !== 'true') notice.style.display = 'block'; btn.addEventListener('click', () => { window.localStorage.setItem(CONFIG.STORAGE_KEYS.COOKIES_ACCEPTED, 'true'); notice.style.display = 'none'; }); } catch (e) { console.warn(`Could not set up cookie notice: ${e.message}`); } };
        #setupSettingsHandlers = () => { CONFIG.SETTINGS_CONFIG.forEach(({ id, key, stateProp, type }) => { try { const el = document.getElementById(id); if (type === 'checkbox' && el instanceof HTMLInputElement) { el.checked = this.#appState.settings[stateProp]; el.addEventListener('change', () => this.#handleSettingChange(key, el.checked)); } else if (type === 'select' && el instanceof HTMLSelectElement) { el.value = this.#appState.settings[stateProp]; el.addEventListener('change', () => this.#handleSettingChange(key, el.value)); } } catch (e) { console.warn(`Failed to set up setting #${id}: ${e.message}`); } }); };
        #handlePageLoadActions = () => { if (window.sessionStorage.getItem(CONFIG.SESSION_STORAGE_KEYS.RULESET_CHANGED) === 'true') { window.scrollTo(0, 0); window.sessionStorage.removeItem(CONFIG.SESSION_STORAGE_KEYS.RULESET_CHANGED); } };
    }

    document.addEventListener('DOMContentLoaded', () => {
        try {
            const app = new QuickRefApplication();
            app.initialize().catch(error => {
                console.error("Fatal Error during data load:", error);
                const vr = new ViewRenderer();
                vr.renderFatalError("Error loading application data. Please try again later.");
            });
        } catch (error) {
            console.error("A critical error occurred during application initialization:", error);
            const vr = new ViewRenderer();
            vr.renderFatalError(error instanceof DOMElementNotFoundError ? "App failed: A critical UI element is missing." : "An unexpected error occurred. Please refresh.");
        }
    });
})(window, document);