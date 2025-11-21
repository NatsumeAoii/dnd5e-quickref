/* eslint-disable no-console */
/* eslint-disable max-len */
/* eslint-disable class-methods-use-this */
/* eslint-disable no-new */
import { CONFIG } from './Config.js';
import { safeHTML, debounce } from './Utils.js';
import { ServiceWorkerMessenger } from './Services.js';

export class DragDropManager {
  #container;

  #userDataService;

  #draggedItem = null;

  constructor(containerId, userDataService) {
    this.#container = document.getElementById(containerId);
    this.#userDataService = userDataService;
    if (this.#container) this.#init();
  }

  #init() {
    this.#container.addEventListener('dragstart', this.#handleDragStart);
    this.#container.addEventListener('dragover', this.#handleDragOver);
    this.#container.addEventListener('drop', this.#handleDrop);
    this.#container.addEventListener('dragend', this.#handleDragEnd);
  }

  #handleDragStart = (e) => {
    const item = e.target.closest(`.${CONFIG.CSS.ITEM_CLASS}`);
    if (!item) return;
    this.#draggedItem = item;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.getAttribute(CONFIG.ATTRIBUTES.POPUP_ID));
    setTimeout(() => item.classList.add(CONFIG.CSS.IS_DRAGGING), 0);
  };

  #handleDragOver = (e) => {
    e.preventDefault();
    const target = e.target.closest(`.${CONFIG.CSS.ITEM_CLASS}`);
    if (target && target !== this.#draggedItem) {
      target.classList.add(CONFIG.CSS.DRAG_OVER);
    }
  };

  #handleDrop = (e) => {
    e.preventDefault();
    const target = e.target.closest(`.${CONFIG.CSS.ITEM_CLASS}`);
    if (target && this.#draggedItem && target !== this.#draggedItem) {
      const items = [...this.#container.children];
      const fromIndex = items.indexOf(this.#draggedItem);
      const toIndex = items.indexOf(target);

      if (fromIndex < toIndex) {
        target.after(this.#draggedItem);
      } else {
        target.before(this.#draggedItem);
      }

      const newOrder = [...this.#container.children].map((el) => el.getAttribute(CONFIG.ATTRIBUTES.POPUP_ID));
      this.#userDataService.updateFavoritesOrder(newOrder);
    }
    this.#cleanup();
  };

  #handleDragEnd = () => this.#cleanup();

  #cleanup() {
    if (this.#draggedItem) this.#draggedItem.classList.remove(CONFIG.CSS.IS_DRAGGING);
    this.#container.querySelectorAll(`.${CONFIG.CSS.DRAG_OVER}`).forEach((el) => el.classList.remove(CONFIG.CSS.DRAG_OVER));
    this.#draggedItem = null;
  }
}

export class TemplateService {
  #domProvider;

  constructor(domProvider) { this.#domProvider = domProvider; }

  #renderers = {
    paragraph: (bullet, linkifyFn) => {
      const p = document.createElement('p');
      p.innerHTML = safeHTML(linkifyFn(bullet.content || ''));
      return p;
    },
    list: (bullet, linkifyFn) => {
      const ul = document.createElement('ul');
      (bullet.items || []).forEach((itemText) => {
        const li = document.createElement('li');
        li.innerHTML = safeHTML(linkifyFn(itemText));
        ul.appendChild(li);
      });
      return ul;
    },
    table: (bullet, linkifyFn) => {
      const table = document.createElement('table');
      table.className = 'rule-table';
      if (bullet.headers?.length) {
        const thead = table.createTHead();
        const headerRow = thead.insertRow();
        bullet.headers.forEach((headerText) => {
          const th = document.createElement('th');
          th.textContent = headerText;
          headerRow.appendChild(th);
        });
      }
      if (bullet.rows?.length) {
        const tbody = table.createTBody();
        bullet.rows.forEach((rowData) => {
          const row = tbody.insertRow();
          rowData.forEach((cellData) => {
            const cell = row.insertCell();
            cell.innerHTML = safeHTML(linkifyFn(String(cellData ?? '')));
          });
        });
      }
      return table;
    },
  };

  #renderBullets(bullets, linkifyFn) {
    const fragment = document.createDocumentFragment();
    if (!Array.isArray(bullets)) return fragment;
    bullets.forEach((bullet) => {
      const renderer = this.#renderers[bullet.type];
      if (renderer) fragment.appendChild(renderer(bullet, linkifyFn));
      else {
        console.warn(`Unknown bullet type: "${bullet.type}"`);
        const p = document.createElement('p');
        p.textContent = JSON.stringify(bullet);
        fragment.appendChild(p);
      }
    });
    return fragment;
  }

  createRuleItemElement(popupId, ruleData, isFavorite) {
    const tpl = this.#domProvider.getTemplate(CONFIG.ELEMENT_IDS.RULE_ITEM_TEMPLATE);
    const item = tpl.content.cloneNode(true).firstElementChild;
    const ruleType = ruleData.optional || CONFIG.DEFAULTS.RULE_TYPE;
    const title = ruleData.title || CONFIG.DEFAULTS.TITLE;

    item.setAttribute(CONFIG.ATTRIBUTES.RULE_TYPE, ruleType);
    item.setAttribute(CONFIG.ATTRIBUTES.POPUP_ID, popupId);
    item.setAttribute('draggable', 'true');

    const iconEl = item.querySelector('.item-icon');
    iconEl.className = 'item-icon iconsize';
    iconEl.setAttribute(CONFIG.ATTRIBUTES.ICON, ruleData.icon || CONFIG.DEFAULTS.ICON);

    item.querySelector('.item-title').textContent = title;
    item.querySelector('.item-desc').textContent = ruleData.subtitle || '';
    item.querySelector('.favorite-btn').classList.toggle(CONFIG.CSS.IS_FAVORITED, isFavorite);
    return item;
  }

  createPopupElement(popupId, { ruleData, type, sectionId }, linkifyFn, getNoteFn) {
    const tpl = this.#domProvider.getTemplate(CONFIG.ELEMENT_IDS.POPUP_TEMPLATE);
    const popup = tpl.content.cloneNode(true).firstElementChild;
    const sourceSection = document.getElementById(sectionId)?.closest(`.${CONFIG.CSS.SECTION_CONTAINER}`);
    const borderColor = sourceSection ? window.getComputedStyle(sourceSection).borderColor : 'var(--color-hr)';

    popup.setAttribute('aria-labelledby', `popup-title-${popupId}`);
    popup.style.setProperty('--section-color', borderColor);

    const titleEl = popup.querySelector('.popup-title');
    titleEl.id = `popup-title-${popupId}`;
    titleEl.textContent = ruleData.title || CONFIG.DEFAULTS.TITLE;

    popup.querySelector('.popup-header').style.backgroundColor = borderColor;
    popup.querySelector('.popup-type').textContent = type;
    popup.querySelector('.popup-description').innerHTML = safeHTML(linkifyFn(ruleData.description || ruleData.subtitle || ''));
    popup.querySelector('.popup-summary').innerHTML = safeHTML(linkifyFn(ruleData.summary || ''));
    popup.querySelector('.popup-bullets').replaceChildren(this.#renderBullets(ruleData.bullets, linkifyFn));

    const refContainer = popup.querySelector('.popup-reference-container');
    const referenceEl = refContainer.querySelector('.popup-reference');
    const toggleBtn = refContainer.querySelector('.popup-toggle-details-btn');

    if (ruleData.reference) {
      referenceEl.textContent = ruleData.reference;
      referenceEl.classList.remove(CONFIG.CSS.HIDDEN);
    } else {
      referenceEl.classList.add(CONFIG.CSS.HIDDEN);
    }

    if (!ruleData.bullets?.length) {
      toggleBtn.classList.add(CONFIG.CSS.HIDDEN);
      if (!ruleData.summary) popup.querySelector('.popup-summary').classList.add(CONFIG.CSS.HIDDEN);
    }

    const textarea = popup.querySelector('.popup-notes-textarea');
    const notesLabel = popup.querySelector('.popup-notes-label');
    notesLabel.setAttribute('for', `notes-${popupId}`);
    textarea.id = `notes-${popupId}`;
    textarea.value = getNoteFn(popupId);
    return popup;
  }
}

export class ViewRenderer {
  #domProvider;

  #stateManager;

  #userDataService;

  #templateService;

  #notificationContainer;

  constructor(domProvider, stateManager, userDataService, templateService) {
    this.#domProvider = domProvider;
    this.#stateManager = stateManager;
    this.#userDataService = userDataService;
    this.#templateService = templateService;
    try { this.#notificationContainer = this.#domProvider.get(CONFIG.ELEMENT_IDS.NOTIFICATION_CONTAINER); } catch (e) { console.error('Notification container not found.'); }
  }

  renderSection(parentId, rules) {
    const parent = this.#domProvider.get(parentId);
    const fragment = document.createDocumentFragment();
    rules.forEach(({ popupId, ruleInfo }, index) => {
      const item = this.#templateService.createRuleItemElement(popupId, ruleInfo.ruleData, this.#userDataService.isFavorite(popupId));
      item.style.animationDelay = `${index * CONFIG.ANIMATION_DURATION.ITEM_DELAY_MS}ms`;
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

  #postRender(parent) {
    parent.querySelectorAll(`[${CONFIG.ATTRIBUTES.ICON}]`).forEach((iconEl) => {
      const iconName = iconEl.getAttribute(CONFIG.ATTRIBUTES.ICON);
      if (iconName) iconEl.classList.add(`icon-${iconName}`);
    });
    this.filterRuleItems();
  }

  renderFavoritesSection() {
    const state = this.#stateManager.getState();
    const favs = [...state.user.favorites]
      .map((id) => ({ popupId: id, ruleInfo: state.data.ruleMap.get(id) }))
      .filter((item) => item.ruleInfo);
    this.renderSection(CONFIG.ELEMENT_IDS.FAVORITES_CONTAINER, favs);
    this.#domProvider.get(CONFIG.ELEMENT_IDS.FAVORITES_PLACEHOLDER).style.display = favs.length > 0 ? 'none' : 'block';
    this.#domProvider.get(CONFIG.ELEMENT_IDS.SECTION_FAVORITES).classList.toggle(CONFIG.CSS.HIDDEN, favs.length === 0);
  }

  applyAppearance({ theme, darkMode }) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.mode = darkMode ? 'dark' : 'light';
    try {
      const themeLink = this.#domProvider.get(CONFIG.ELEMENT_IDS.THEME_STYLESHEET);
      if (theme !== 'original') {
        themeLink.href = `${CONFIG.THEME_CONFIG.PATH}${theme}.css`;
        themeLink.disabled = false;
      } else {
        themeLink.href = '';
        themeLink.disabled = true;
      }
    } catch (e) { console.error('Failed to apply theme stylesheet:', e); }
  }

  applyMotionReduction = (isEnabled) => document.body.classList.toggle(CONFIG.CSS.MOTION_REDUCED, isEnabled);

  filterRuleItems() {
    const { showOptional, showHomebrew } = this.#stateManager.getState().settings;
    this.#domProvider.queryAll(`.${CONFIG.CSS.ITEM_SIZE_CLASS}`).forEach((item) => {
      if (item.getAttribute(CONFIG.ATTRIBUTES.FILTERABLE) === 'false') return;
      const type = item.getAttribute(CONFIG.ATTRIBUTES.RULE_TYPE);
      const isOpt = type === 'Optional rule';
      const isHB = type === 'Homebrew rule';
      const show = (!isOpt && !isHB) || (isOpt && showOptional) || (isHB && showHomebrew);
      if (item instanceof HTMLElement) item.style.display = show ? 'flex' : 'none';
    });
  }

  renderFatalError(msg) {
    const container = document.createElement('div');
    container.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center;padding:20px;font-family:sans-serif;background:#1a1a1a;color:#fff;';

    const err = document.createElement('h2');
    err.textContent = msg;
    err.className = CONFIG.CSS.FATAL_ERROR;
    err.style.color = '#ff6b6b';

    const help = document.createElement('p');
    help.innerHTML = 'Press <strong>Ctrl + Shift + R</strong> or <strong>Ctrl + F5</strong> to force refresh.';
    help.style.marginTop = '20px';
    help.style.fontSize = '1.1em';

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset Application (Clear Cache)';
    resetBtn.style.marginTop = '20px';
    resetBtn.style.padding = '10px 20px';
    resetBtn.style.fontSize = '1em';
    resetBtn.style.cursor = 'pointer';
    resetBtn.style.background = '#d32f2f';
    resetBtn.style.color = 'white';
    resetBtn.style.border = 'none';
    resetBtn.style.borderRadius = '4px';
    resetBtn.onclick = async () => {
      try {
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((r) => r.unregister()));
        }
        localStorage.clear();
        sessionStorage.clear();
        window.location.reload();
      } catch (e) {
        console.error('Reset failed:', e);
        alert('Failed to reset automatically. Please clear your browser cache manually.');
      }
    };

    const contact = document.createElement('p');
    contact.textContent = 'If still not working, you can report this issue or message me on Discord.';
    contact.style.marginTop = '20px';
    contact.style.opacity = '0.8';

    container.appendChild(err);
    container.appendChild(help);
    container.appendChild(resetBtn);
    container.appendChild(contact);
    document.body.replaceChildren(container);
  }

  updateCopyrightYear() {
    try { this.#domProvider.get(CONFIG.ELEMENT_IDS.COPYRIGHT_YEAR).textContent = new Date().getFullYear().toString(); } catch (e) { console.warn(`Could not update copyright year: ${e.message}`); }
  }

  showApp() {
    this.#domProvider.get(CONFIG.ELEMENT_IDS.SKELETON_LOADER).classList.add(CONFIG.CSS.HIDDEN);
    const app = this.#domProvider.get(CONFIG.ELEMENT_IDS.APP_CONTAINER);
    app.classList.remove(CONFIG.CSS.HIDDEN);
    app.style.opacity = '1';
  }

  showNotification(message, level = 'info') {
    if (!this.#notificationContainer) return;
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.dataset.level = level;
    notification.textContent = message;
    notification.setAttribute('role', 'alert');
    this.#notificationContainer.appendChild(notification);
    setTimeout(() => notification.remove(), CONFIG.ANIMATION_DURATION.NOTIFICATION_MS);
  }
}

export class PopupFactory {
  #templateService;

  #userDataService;

  #stateManager;

  constructor(templateService, userDataService, stateManager) {
    this.#templateService = templateService;
    this.#userDataService = userDataService;
    this.#stateManager = stateManager;
  }

  create(id, ruleInfo, linkifyFn) {
    const popup = this.#templateService.createPopupElement(id, ruleInfo, linkifyFn, this.#userDataService.getNote);
    this.#attachNoteHandlers(popup, id);
    return popup;
  }

  #attachNoteHandlers(popup, id) {
    const textarea = popup.querySelector('.popup-notes-textarea');
    const statusEl = popup.querySelector('.popup-notes-status');
    if (!textarea || !statusEl) return;

    const debouncedSave = debounce(() => {
      this.#userDataService.saveNote(id, textarea.value);
      statusEl.textContent = CONFIG.UI_STRINGS.NOTE_STATUS_SAVED;
      const state = this.#stateManager.getState();
      state.ui.fadeTimeout = setTimeout(() => {
        if (statusEl.textContent === CONFIG.UI_STRINGS.NOTE_STATUS_SAVED) statusEl.textContent = '';
      }, CONFIG.ANIMATION_DURATION.NOTE_FADEOUT_MS);
    }, CONFIG.DEBOUNCE_DELAY.NOTE_AUTOSAVE_MS);

    textarea.addEventListener('input', () => {
      clearTimeout(this.#stateManager.getState().ui.fadeTimeout);
      statusEl.textContent = CONFIG.UI_STRINGS.NOTE_STATUS_SAVING;
      debouncedSave();
    });
  }
}

export class WindowManager {
  #domProvider;

  #stateManager;

  #persistenceService;

  #a11yService;

  #popupFactory;

  #viewRenderer;

  #dataService;

  #popupContainer;

  #closeAllBtn;

  #isMobileView = false;

  #TYPE_ENCODING = Object.freeze({
    Action: 'Ac', 'Bonus action': 'Ba', Condition: 'Co', Environment: 'En', Move: 'Mo', Reaction: 'Re',
  });

  #TYPE_DECODING = Object.freeze(Object.fromEntries(Object.entries(this.#TYPE_ENCODING).map(([k, v]) => [v, k])));

  constructor(services) {
    this.#domProvider = services.domProvider;
    this.#stateManager = services.stateManager;
    this.#persistenceService = services.persistence;
    this.#a11yService = services.a11y;
    this.#popupFactory = services.popupFactory;
    this.#viewRenderer = services.viewRenderer;
    this.#dataService = services.data;
  }

  initialize() {
    this.#popupContainer = this.#domProvider.get(CONFIG.ELEMENT_IDS.POPUP_CONTAINER);
    this.#closeAllBtn = this.#domProvider.get(CONFIG.ELEMENT_IDS.CLOSE_ALL_POPUPS_BTN);
    this.#handleResize();
    this.#popupContainer.addEventListener('click', this.#handleContainerClick);
    this.#closeAllBtn.addEventListener('click', this.closeAllPopups);
    window.addEventListener('resize', debounce(this.#handleResize, CONFIG.DEBOUNCE_DELAY.RESIZE_MS));
    document.addEventListener('keydown', this.#handleKeyDown);
    window.addEventListener('hashchange', this.#handleHashChange);
  }

  #toShortId = (fullId) => {
    if (!fullId?.includes('::')) return fullId;
    const [type, title] = fullId.split('::');
    const encodedType = this.#TYPE_ENCODING[type];
    return encodedType ? `${encodedType}-${encodeURIComponent(title)}` : fullId;
  };

  #fromShortId = (shortId) => {
    if (!shortId?.includes('-')) return shortId;
    const separatorIndex = shortId.indexOf('-');
    const encodedType = shortId.substring(0, separatorIndex);
    const encodedTitle = shortId.substring(separatorIndex + 1);
    const type = this.#TYPE_DECODING[encodedType];
    return type ? `${type}::${decodeURIComponent(encodedTitle)}` : shortId;
  };

  #linkifyContent = (html) => {
    const state = this.#stateManager.getState();
    if (!html || !state.data.ruleLinkerRegex) return html;

    const container = document.createElement('div');
    container.innerHTML = safeHTML(html);

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    let node = walker.nextNode();
    while (node !== null) {
      textNodes.push(node);
      node = walker.nextNode();
    }

    textNodes.forEach((textNode) => {
      const text = textNode.nodeValue;
      const matches = Array.from(text.matchAll(state.data.ruleLinkerRegex));
      if (matches.length === 0) return;

      const fragment = document.createDocumentFragment();
      let lastIndex = 0;

      matches.forEach((match) => {
        const matchText = match[0];
        const matchIndex = match.index;

        if (matchIndex > lastIndex) {
          fragment.appendChild(document.createTextNode(text.substring(lastIndex, matchIndex)));
        }

        const link = document.createElement('a');
        link.className = 'rule-link';
        link.textContent = matchText;
        const id = Array.from(state.data.ruleMap.keys())
          .find((key) => key.toLowerCase().endsWith(`::${matchText.toLowerCase()}`));

        if (id) {
          link.setAttribute(CONFIG.ATTRIBUTES.POPUP_ID, id);
          const preload = () => {
            const ruleInfo = state.data.ruleMap.get(id);
            if (ruleInfo) {
              const sectionConfig = CONFIG.SECTION_CONFIG.find((c) => c.id === ruleInfo.sectionId);
              if (sectionConfig) this.#dataService.ensureSectionDataLoaded(this.#dataService.getDataSourceKey(sectionConfig.dataKey));
            }
          };
          link.addEventListener('mouseenter', preload, { once: true });
          link.addEventListener('focus', preload, { once: true });
          fragment.appendChild(link);
        } else {
          fragment.appendChild(document.createTextNode(matchText));
        }
        lastIndex = matchIndex + matchText.length;
      });

      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
      }
      textNode.parentNode.replaceChild(fragment, textNode);
    });

    return container.innerHTML;
  };

  #updateAllLinkStates() {
    const openIds = new Set(this.#stateManager.getState().ui.openPopups.keys());
    document.querySelectorAll('a.rule-link').forEach((link) => {
      const id = link.dataset.popupId;
      if (id) link.classList.toggle(CONFIG.CSS.LINK_DISABLED, openIds.has(id));
    });
  }

  #updateCloseBtnVisibility = () => this.#closeAllBtn?.classList.toggle(CONFIG.CSS.IS_VISIBLE, this.#stateManager.getState().ui.openPopups.size > 1);

  #updateURLHash() {
    const openIds = Array.from(this.#stateManager.getState().ui.openPopups.keys());
    const hash = openIds.map(this.#toShortId).join(',');
    window.history.replaceState(null, '', hash ? `#${hash}` : window.location.pathname + window.location.search);
  }

  #closePopup = (id) => {
    const state = this.#stateManager.getState();
    const popup = state.ui.openPopups.get(id);
    if (!popup) return;
    popup.classList.add(CONFIG.CSS.IS_CLOSING);
    state.ui.openPopups.delete(id);
    this.#a11yService.announce(`Closed popup for ${id.split('::')[1]}`);
    this.#updateAllLinkStates();
    if (this.#isMobileView) this.#popupContainer.classList.remove(CONFIG.CSS.POPUP_CONTAINER_MODAL_OPEN);
    document.body.style.setProperty('--is-modal-open', state.ui.openPopups.size > 0 ? '1' : '0');
    setTimeout(() => {
      popup.close();
      popup.remove();
      this.#updateCloseBtnVisibility();
    }, CONFIG.ANIMATION_DURATION.POPUP_MS);
    this.#persistenceService.saveSession();
    this.#updateCloseBtnVisibility();
    this.#updateURLHash();
  };

  #handleKeyDown = (e) => {
    const state = this.#stateManager.getState();
    if (e.key !== 'Escape' || state.ui.openPopups.size === 0) return;
    let topId = null; let maxZ = -1;
    state.ui.openPopups.forEach((el, id) => { const z = parseInt(el.style.zIndex || 0, 10); if (z > maxZ) { maxZ = z; topId = id; } });
    if (topId) this.#closePopup(topId);
  };

  #bringToFront(popup) {
    if (popup.classList.contains(CONFIG.CSS.IS_ACTIVE)) return;
    this.#popupContainer.querySelectorAll(`.${CONFIG.CSS.POPUP_WINDOW}`).forEach((w) => w.classList.remove(CONFIG.CSS.IS_ACTIVE));
    const state = this.#stateManager.getState();
    state.ui.activeZIndex++;
    popup.style.zIndex = String(state.ui.activeZIndex);
    popup.classList.add(CONFIG.CSS.IS_ACTIVE);
    this.#persistenceService.saveSession();
  }

  #makeDraggable(popup) {
    const header = popup.querySelector('.popup-header');
    if (!header) return;
    const onMouseDown = (mdEvent) => {
      if (!(mdEvent.target instanceof HTMLElement) || mdEvent.target.closest(`.${CONFIG.CSS.POPUP_CLOSE_BTN}`)) return;
      mdEvent.preventDefault();
      this.#bringToFront(popup);
      header.classList.add(CONFIG.CSS.IS_DRAGGING);
      const rect = popup.getBoundingClientRect();
      const offX = mdEvent.clientX - rect.left;
      const offY = mdEvent.clientY - rect.top;
      const onMouseMove = (mmEvent) => {
        const PADDING = CONFIG.LAYOUT.POPUP_VIEWPORT_PADDING_PX;
        const newLeft = Math.max(PADDING, Math.min(mmEvent.clientX - offX, window.innerWidth - popup.offsetWidth - PADDING));
        const newTop = Math.max(PADDING, Math.min(mmEvent.clientY - offY, window.innerHeight - popup.offsetHeight - PADDING));
        popup.style.left = `${newLeft}px`;
        popup.style.top = `${newTop}px`;
      };
      const onMouseUp = () => {
        header.classList.remove(CONFIG.CSS.IS_DRAGGING);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        this.#persistenceService.saveSession();
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };
    header.addEventListener('mousedown', onMouseDown);
  }

  #createPopup(id, ruleInfo, pos) {
    const popup = this.#popupFactory.create(id, ruleInfo, this.#linkifyContent);
    if (this.#isMobileView) {
      popup.classList.add(CONFIG.CSS.POPUP_MODAL);
      this.#popupContainer.classList.add(CONFIG.CSS.POPUP_CONTAINER_MODAL_OPEN);
    } else {
      if (pos?.top && pos?.left) { popup.style.top = pos.top; popup.style.left = pos.left; } else {
        const offset = (this.#stateManager.getState().ui.openPopups.size % CONFIG.LAYOUT.POPUP_CASCADE_WRAP_COUNT) * CONFIG.LAYOUT.POPUP_CASCADE_OFFSET_PX;
        popup.style.top = `${50 + offset}px`; popup.style.left = `${100 + offset}px`;
      }
      popup.addEventListener('mousedown', () => this.#bringToFront(popup), true);
      this.#makeDraggable(popup);
    }
    this.#popupContainer.appendChild(popup);

    if (document.startViewTransition) {
      document.startViewTransition(() => popup.show());
    } else {
      popup.show();
    }

    const state = this.#stateManager.getState();
    popup.style.zIndex = pos?.zIndex || String(++state.ui.activeZIndex);
    state.ui.openPopups.set(id, popup);
    document.body.style.setProperty('--is-modal-open', '1');
    this.#a11yService.announce(`Opened popup for ${ruleInfo.ruleData.title}`);
    this.#updateAllLinkStates();
    this.#updateCloseBtnVisibility();
    this.#persistenceService.saveSession();
    this.#updateURLHash();
    popup.querySelector('.popup-content')?.focus();
  }

  #handleResize = () => { this.#isMobileView = window.innerWidth < CONFIG.LAYOUT.DESKTOP_BREAKPOINT_MIN_PX; };

  #handleContainerClick = (e) => {
    const { target } = e;
    if (target.closest(`.${CONFIG.CSS.POPUP_CLOSE_BTN}`)) {
      const popup = target.closest(`.${CONFIG.CSS.POPUP_WINDOW}`);
      const popupId = Array.from(this.#stateManager.getState().ui.openPopups.entries()).find(([, p]) => p === popup)?.[0];
      if (popupId) this.#closePopup(popupId);
    }
    const link = target.closest('a.rule-link');
    if (link && !link.classList.contains(CONFIG.CSS.LINK_DISABLED) && link.dataset.popupId) {
      e.preventDefault();
      this.togglePopup(link.dataset.popupId);
    }
    const toggleBtn = target.closest('.popup-toggle-details-btn');
    if (toggleBtn) {
      const popup = toggleBtn.closest('.popup-window');
      if (popup) {
        const summary = popup.querySelector('.popup-summary');
        const bullets = popup.querySelector('.popup-bullets');
        const isCurrentlyHidden = bullets.classList.contains('hidden');
        bullets.classList.toggle('hidden', !isCurrentlyHidden);
        summary.classList.toggle('hidden', isCurrentlyHidden);
        toggleBtn.textContent = isCurrentlyHidden ? 'Tell Me Less' : 'Tell Me More';
        toggleBtn.setAttribute('aria-expanded', String(isCurrentlyHidden));
      }
    }
  };

  #handleHashChange = () => {
    const state = this.#stateManager.getState();
    let idsFromHash = new Set();

    // URLPattern API Implementation for Routing
    if ('URLPattern' in window) {
      // eslint-disable-next-line no-undef
      const pattern = new URLPattern({ hash: '*' });
      const match = pattern.exec(window.location.href);
      if (match && match.hash.input) {
        // URLPattern gives us the raw hash, but we still need to split it for multi-window support
        idsFromHash = new Set(match.hash.input.substring(1).split(',').filter(Boolean).map(this.#fromShortId));
      }
    } else {
      // Fallback
      idsFromHash = new Set(window.location.hash.substring(1).split(',').filter(Boolean).map(this.#fromShortId));
    }

    const openIds = new Set(state.ui.openPopups.keys());
    [...openIds].filter((id) => !idsFromHash.has(id)).forEach((id) => this.#closePopup(id));
    [...idsFromHash].filter((id) => !openIds.has(id)).forEach((id) => this.togglePopup(id));
  };

  togglePopup(id) {
    const state = this.#stateManager.getState();
    if (state.ui.openPopups.has(id)) this.#closePopup(id);
    else {
      const rule = state.data.ruleMap.get(id);
      if (rule) this.#createPopup(id, rule);
      else {
        this.#a11yService.announce(CONFIG.UI_STRINGS.RULE_NOT_FOUND);
        this.#viewRenderer.showNotification(CONFIG.UI_STRINGS.RULE_NOT_FOUND, 'error');
      }
    }
  }

  createPopupFromState(state) { const rule = this.#stateManager.getState().data.ruleMap.get(state.id); if (rule) this.#createPopup(state.id, rule, state); }

  loadPopupsFromURL() { this.#handleHashChange(); }

  closeAllPopups = () => [...this.#stateManager.getState().ui.openPopups.keys()].forEach((id) => this.#closePopup(id));

  getTopMostPopupId() {
    const state = this.#stateManager.getState();
    if (state.ui.openPopups.size === 0) return null;
    let topId = null; let maxZ = -1;
    state.ui.openPopups.forEach((el, id) => { const z = parseInt(el.style.zIndex || '0', 10); if (z > maxZ) { maxZ = z; topId = id; } });
    return topId;
  }
}

export class UIController {
  #domProvider;

  #stateManager;

  #services;

  #components;

  constructor(domProvider, stateManager, services, components) {
    this.#domProvider = domProvider;
    this.#stateManager = stateManager;
    this.#services = services;
    this.#components = components;
  }

  initialize() {
    this.setupEventSubscriptions();
    this.applyInitialSettings();
    this.setupSettingsHandlers();
    this.setupCookieNoticeHandler();
    this.bindGlobalEventListeners();
    this.#components.viewRenderer.updateCopyrightYear();
    this.#handleShareTarget();
  }

  setupEventSubscriptions() {
    this.#stateManager.subscribe('settingChanged', this.#handleSettingChangeEvent.bind(this));
    this.#stateManager.subscribe('favoritesChanged', () => {
      this.#components.viewRenderer.renderFavoritesSection();
      // Re-initialize drag and drop after render
      new DragDropManager(CONFIG.ELEMENT_IDS.FAVORITES_CONTAINER, this.#services.userData);
    });
    this.#stateManager.subscribe('externalStateChange', this.#handleExternalStateChange.bind(this));
  }

  applyInitialSettings() {
    const { settings } = this.#stateManager.getState();
    this.#components.viewRenderer.applyAppearance(settings);
    this.#components.viewRenderer.applyMotionReduction(settings.reduceMotion);
    this.#services.wakeLock.setEnabled(settings.keepScreenOn);
  }

  async #switchRuleset() {
    this.#components.windowManager.closeAllPopups();
    await this.#services.data.ensureAllDataLoadedForActiveRuleset();
    this.#services.data.buildRuleMap();
    this.#services.data.buildLinkerData();
    this.#components.viewRenderer.renderFavoritesSection();

    await this.renderOpenSections();
  }

  async renderOpenSections() {
    const rerenderPromises = [];
    this.#domProvider.queryAll(`.${CONFIG.CSS.SECTION_CONTAINER}[data-section]`).forEach((section) => {
      const sectionId = section.getAttribute('id');
      if (sectionId === CONFIG.ELEMENT_IDS.SECTION_FAVORITES || sectionId === 'section-settings') return;
      const content = section.querySelector(`.${CONFIG.CSS.SECTION_CONTENT}`);
      if (content) {
        content.setAttribute(CONFIG.ATTRIBUTES.RENDERED, 'false');
        const row = content.querySelector('.section-row');
        if (row) row.innerHTML = '';
      }
      if (!section.classList.contains(CONFIG.CSS.IS_COLLAPSED)) rerenderPromises.push(this.renderSectionContent(section));
    });
    await Promise.all(rerenderPromises);
  }

  #handleSettingChangeEvent = async ({ key, value }) => {
    this.#services.a11y.announce(`Setting updated: ${key.toLowerCase().replace('_', ' ')}.`);
    const { settings } = this.#stateManager.getState();
    if (key === 'RULES_2024') await this.#switchRuleset();
    else if (key === 'THEME' || key === 'MODE') this.#components.viewRenderer.applyAppearance(settings);
    else if (key === 'REDUCE_MOTION') this.#components.viewRenderer.applyMotionReduction(value);
    else if (key === 'WAKE_LOCK') this.#services.wakeLock.setEnabled(value);
    else this.#components.viewRenderer.filterRuleItems();
  };

  #handleExternalStateChange = ({ type, payload }) => {
    if (type === 'SETTING_CHANGE') {
      this.#services.settings.update(CONFIG.STORAGE_KEYS[payload.key], payload.value, false);
      const config = CONFIG.SETTINGS_CONFIG.find((c) => c.key === payload.key);
      if (config) {
        const el = this.#domProvider.get(config.id);
        if (el.type === 'checkbox') el.checked = payload.value;
        else el.value = payload.value;
      }
    } else if (type === 'FAVORITE_TOGGLE') {
      this.#services.userData.toggleFavorite(payload.id, false);
    } else if (type === 'NOTE_UPDATE') {
      this.#services.userData.saveNote(payload.id, payload.text, false);
    }
  };

  #handleShareTarget = () => {
    const params = new URLSearchParams(window.location.search);
    const title = params.get('title');
    const text = params.get('text');
    if (title || text) {
      const query = (text || title || '').trim();
      if (query) {
        this.#components.viewRenderer.showNotification(`Shared content received: ${query}`);
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  };

  async loadAndPopulateThemes() {
    try {
      const response = await fetch(CONFIG.THEME_CONFIG.MANIFEST);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const manifest = await response.json();
      const selectEl = this.#domProvider.get(CONFIG.ELEMENT_IDS.THEME_SELECT);
      selectEl.innerHTML = '';
      manifest.themes.forEach((theme) => {
        const option = document.createElement('option');
        option.value = theme.id;
        option.textContent = theme.displayName;
        selectEl.appendChild(option);
      });
    } catch (e) {
      console.error('Fatal: Could not load theme manifest.', e);
      this.#domProvider.get(CONFIG.ELEMENT_IDS.THEME_SELECT).innerHTML = '<option value="original">Original</option>';
    }
  }

  setupCollapsibleSections = () => {
    this.#domProvider.queryAll(`.${CONFIG.CSS.SECTION_TITLE}`).forEach((header) => {
      const section = header.closest(`.${CONFIG.CSS.SECTION_CONTAINER}`);
      if (!section || section.dataset.section === 'settings' || section.dataset.section === 'favorites') return;
      header.setAttribute('role', 'button');
      header.setAttribute('tabindex', '0');
      const isExpanded = !section.classList.contains(CONFIG.CSS.IS_COLLAPSED);
      header.setAttribute('aria-expanded', String(isExpanded));
      const handler = async () => {
        const collapsed = section.classList.toggle(CONFIG.CSS.IS_COLLAPSED);
        header.setAttribute('aria-expanded', String(!collapsed));
        if (!collapsed) await this.renderSectionContent(section);
        this.#services.a11y.announce(`${section.dataset.section} section ${collapsed ? 'collapsed' : 'expanded'}.`);
      };
      header.addEventListener('click', handler);
      header.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
    });
  };

  bindGlobalEventListeners = () => {
    const mainArea = this.#domProvider.get(CONFIG.ELEMENT_IDS.MAIN_SCROLL_AREA);
    mainArea.addEventListener('click', this.#handleMainAreaClick);
    mainArea.addEventListener('keydown', this.#handleMainAreaKeydown);
    try { this.#domProvider.get(CONFIG.ELEMENT_IDS.REPORT_RULE_BTN).addEventListener('click', this.#handleReportClick); } catch (e) { console.warn('Report rule button not found.'); }
    try { this.#domProvider.get(CONFIG.ELEMENT_IDS.EXPORT_NOTES_BTN).addEventListener('click', () => this.#services.userData.exportNotes()); } catch (e) { console.warn('Export notes button not found.'); }
  };

  #handleReportClick = () => {
    const topId = this.#components.windowManager.getTopMostPopupId();
    const repoUrl = 'https://github.com/NatsumeAoii/dnd5e-quickref/issues/new';
    let issueUrl;
    if (topId) {
      const title = `Rule Report: ${topId.replace('::', ' - ')}`;
      const body = `I'd like to report an issue with the following rule:\n\nRule ID: \`${topId}\`\n\nIssue: \n(Please describe the problem, e.g., typo, incorrect information, missing detail)\n\n/Reference (if any): \n(e.g., PHB p.123)\n`;
      issueUrl = `${repoUrl}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    } else {
      const title = 'General Rule Report';
      const body = 'I\'d like to report a missing rule or a general issue.\n\nIssue: \n\n(Please describe the problem)\n';
      issueUrl = `${repoUrl}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    }
    window.open(issueUrl, '_blank', 'noopener,noreferrer');
  };

  #handleMainAreaClick = (e) => {
    const item = e.target.closest(`.${CONFIG.CSS.ITEM_CLASS}`);
    if (!item) return;
    const id = item.getAttribute(CONFIG.ATTRIBUTES.POPUP_ID);
    if (!id) return;

    if (e.target.closest('.favorite-btn')) {
      this.#services.userData.toggleFavorite(id);
      const isFav = this.#services.userData.isFavorite(id);
      this.#domProvider.queryAll(`[${CONFIG.ATTRIBUTES.POPUP_ID}="${id}"]`).forEach((el) => {
        el.querySelector('.favorite-btn')?.classList.toggle(CONFIG.CSS.IS_FAVORITED, isFav);
      });
      this.#services.a11y.announce(`${id.split('::')[1]} ${isFav ? 'added to' : 'removed from'} favorites.`);
    } else if (e.target.closest('.item-content')) {
      this.#components.windowManager.togglePopup(id);
    }
  };

  #handleMainAreaKeydown = (e) => { if (e.key !== 'Enter' && e.key !== ' ') return; const target = e.target.closest('.item-content'); if (target) { e.preventDefault(); target.click(); } };

  async renderSectionContent(section) {
    const content = section.querySelector(`.${CONFIG.CSS.SECTION_CONTENT}`);
    if (!content || content.getAttribute(CONFIG.ATTRIBUTES.RENDERED) === 'true') return;
    const dataSectionKey = section.getAttribute(CONFIG.ATTRIBUTES.SECTION_KEY);

    if (dataSectionKey === 'environment') {
      await this.#services.data.ensureSectionDataLoaded('environment');
      this.#services.data.buildRuleMap();
      CONFIG.SECTION_CONFIG.filter((c) => c.type === 'Environment').forEach(this.#renderSingleSection);
    } else {
      const dataKey = dataSectionKey.replace('-', '');
      await this.#services.data.ensureSectionDataLoaded(dataKey);
      this.#services.data.buildRuleMap();
      const sectionConfig = CONFIG.SECTION_CONFIG.find((c) => c.dataKey === dataKey);
      if (sectionConfig) this.#renderSingleSection(sectionConfig);
    }
    content.setAttribute(CONFIG.ATTRIBUTES.RENDERED, 'true');
  }

  #renderSingleSection = (section) => {
    const state = this.#stateManager.getState();
    const srcKey = this.#services.data.getDataSourceKey(section.dataKey);
    const { use2024Rules } = state.settings;
    const rulesetKey = use2024Rules ? '2024' : '2014';
    const src = state.data.rulesets[rulesetKey][srcKey];
    if (!Array.isArray(src)) { console.warn(`Data source for "${section.dataKey}" is missing.`); return; }
    let rules = src;
    if (section.dataKey.startsWith('environment_')) rules = src.filter((d) => d.tags?.includes(section.dataKey));
    const rulesWithIds = rules.map((rule) => ({
      popupId: `${section.type}::${rule.title}`,
      ruleInfo: { ruleData: rule, type: section.type, sectionId: section.id },
    }));
    try { this.#components.viewRenderer.renderSection(section.id, rulesWithIds); } catch (e) { console.error(`Failed to render section "${section.id}":`, e); }
  };

  setupCookieNoticeHandler = () => {
    try {
      const notice = this.#domProvider.get(CONFIG.ELEMENT_IDS.COOKIE_NOTICE);
      const acceptBtn = this.#domProvider.get(CONFIG.ELEMENT_IDS.ACCEPT_COOKIES_BTN);
      const remindBtn = this.#domProvider.get(CONFIG.ELEMENT_IDS.REMIND_COOKIES_LATER_BTN);
      const hasAccepted = window.localStorage.getItem(CONFIG.STORAGE_KEYS.COOKIES_ACCEPTED) === 'true';
      const hasDismissedReminder = window.sessionStorage.getItem(CONFIG.SESSION_STORAGE_KEYS.COOKIES_REMINDER_DISMISSED) === 'true';

      if (!hasAccepted && !hasDismissedReminder) notice.style.display = 'block';

      const dismissNotice = () => {
        notice.classList.add(CONFIG.CSS.IS_CLOSING);
        notice.addEventListener('animationend', () => { notice.style.display = 'none'; }, { once: true });
      };
      acceptBtn.addEventListener('click', () => {
        window.localStorage.setItem(CONFIG.STORAGE_KEYS.COOKIES_ACCEPTED, 'true');
        ServiceWorkerMessenger.setCachingPolicy(true);
        dismissNotice();
      });
      remindBtn.addEventListener('click', () => {
        window.sessionStorage.setItem(CONFIG.SESSION_STORAGE_KEYS.COOKIES_REMINDER_DISMISSED, 'true');
        dismissNotice();
      });
    } catch (e) { console.warn(`Could not set up cookie notice: ${e.message}`); }
  };

  setupSettingsHandlers = () => {
    CONFIG.SETTINGS_CONFIG.forEach(({
      id, key, stateProp, type,
    }) => {
      try {
        const el = this.#domProvider.get(id);
        const { settings } = this.#stateManager.getState();
        if (type === 'checkbox' && el instanceof HTMLInputElement) {
          el.checked = settings[stateProp];
          el.addEventListener('change', () => this.#services.settings.update(CONFIG.STORAGE_KEYS[key], el.checked));
        } else if (type === 'select' && el instanceof HTMLSelectElement) {
          el.value = settings[stateProp];
          el.addEventListener('change', () => this.#services.settings.update(CONFIG.STORAGE_KEYS[key], el.value));
        }
      } catch (e) { console.warn(`Failed to set up setting #${id}: ${e.message}`); }
    });
  };
}
