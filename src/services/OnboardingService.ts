import { CONFIG } from '../config.js';
import type { A11yService } from './A11yService.js';

interface OnboardingStep {
    target: string;
    title: string;
    description: string;
    placement: 'top' | 'bottom' | 'left' | 'right';
    fallbackMessage?: string;
}

const STEPS: OnboardingStep[] = [
    {
        target: '[data-section="action"] .section-title',
        title: 'Collapsible Sections',
        description: 'Click any section header to collapse or expand it. Your preferences are saved automatically.',
        placement: 'bottom',
    },
    {
        target: '[data-section="action"] .item',
        title: 'Rule Items & Favorites',
        description: 'Click any rule to see its details in a popup. Use the ★ star icon to add it to your Favorites for quick access.',
        placement: 'bottom',
        fallbackMessage: 'Expand a section to see rule items you can click.',
    },
    {
        target: '[data-section="settings"] .section-title',
        title: 'Settings & Customization',
        description: 'Switch between 2014 and 2024 rulesets, change themes, toggle dark mode, and adjust display density.',
        placement: 'top',
    },
    {
        target: '#shortcuts-fab-btn',
        title: 'Keyboard Shortcuts',
        description: 'Click this button or press ? on your keyboard to see all available keyboard shortcuts for quick navigation.',
        placement: 'left',
        fallbackMessage: 'A keyboard shortcuts button appears on desktop screens.',
    },
];

export class OnboardingService {
    #storage: Storage;
    #a11yService: A11yService;
    #overlay: HTMLElement | null = null;
    #currentStep = 0;
    #isActive = false;
    #scrollTimer: ReturnType<typeof setTimeout> | null = null;
    #boundReposition: (() => void) | null = null;

    constructor(storage: Storage, a11yService: A11yService) {
        this.#storage = storage;
        this.#a11yService = a11yService;
    }

    shouldShow(): boolean {
        return this.#storage.getItem(CONFIG.STORAGE_KEYS.ONBOARDING_COMPLETED) !== 'true';
    }

    start(): void {
        if (!this.shouldShow() || this.#isActive) return;
        this.#isActive = true;
        this.#currentStep = 0;
        this.#createOverlay();
        this.#showStep(0);
    }

    #createOverlay(): void {
        this.#overlay = document.createElement('div');
        this.#overlay.id = CONFIG.ELEMENT_IDS.ONBOARDING_OVERLAY;
        this.#overlay.className = 'onboarding-overlay';
        this.#overlay.setAttribute('role', 'dialog');
        this.#overlay.setAttribute('aria-modal', 'true');
        this.#overlay.setAttribute('aria-label', 'Welcome tour');
        this.#overlay.innerHTML = `
            <div class="onboarding-spotlight"></div>
            <div class="onboarding-tooltip" role="alertdialog" tabindex="-1">
                <div class="onboarding-tooltip-header">
                    <h3 class="onboarding-tooltip-title"></h3>
                    <button class="onboarding-skip-btn" aria-label="Skip tour">✕</button>
                </div>
                <p class="onboarding-tooltip-body"></p>
                <div class="onboarding-tooltip-footer">
                    <div class="onboarding-dots"></div>
                    <div class="onboarding-nav">
                        <button class="onboarding-prev-btn">← Back</button>
                        <button class="onboarding-next-btn">Next →</button>
                    </div>
                </div>
            </div>`;

        this.#overlay.querySelector('.onboarding-skip-btn')!.addEventListener('click', () => this.#complete());
        this.#overlay.querySelector('.onboarding-prev-btn')!.addEventListener('click', () => this.#prev());
        this.#overlay.querySelector('.onboarding-next-btn')!.addEventListener('click', () => this.#next());

        this.#overlay.addEventListener('click', (e) => {
            if (e.target === this.#overlay) this.#complete();
        });

        this.#overlay.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.stopPropagation(); this.#complete(); }
            else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.stopPropagation(); this.#next(); }
            else if (e.key === 'ArrowLeft') { e.stopPropagation(); this.#prev(); }
        });

        document.body.appendChild(this.#overlay);

        // Store bound reference so we can remove it on cleanup
        this.#boundReposition = (): void => { if (this.#isActive) this.#positionCurrentStep(); };
        window.addEventListener('resize', this.#boundReposition, { passive: true });
        window.addEventListener('scroll', this.#boundReposition, { passive: true });
    }

    #positionCurrentStep(): void {
        if (!this.#overlay) return;
        const step = STEPS[this.#currentStep];
        if (!step) return;
        const targetEl = document.querySelector(step.target) as HTMLElement | null;
        const tooltip = this.#overlay.querySelector('.onboarding-tooltip') as HTMLElement | null;
        const spotlight = this.#overlay.querySelector('.onboarding-spotlight') as HTMLElement | null;
        if (!tooltip || !spotlight) return;
        this.#positionElements(targetEl, tooltip, spotlight, step.placement);
    }

    #showStep(index: number): void {
        if (!this.#overlay || index < 0 || index >= STEPS.length) return;

        // Cancel any pending scroll-position timer from previous step
        if (this.#scrollTimer !== null) {
            clearTimeout(this.#scrollTimer);
            this.#scrollTimer = null;
        }

        this.#currentStep = index;
        const step = STEPS[index];

        const titleEl = this.#overlay.querySelector('.onboarding-tooltip-title');
        const bodyEl = this.#overlay.querySelector('.onboarding-tooltip-body');
        if (titleEl) titleEl.textContent = step.title;
        if (bodyEl) bodyEl.textContent = step.description;

        const dotsContainer = this.#overlay.querySelector('.onboarding-dots');
        if (dotsContainer) {
            dotsContainer.innerHTML = STEPS.map((_, i) =>
                `<span class="onboarding-dot${i === index ? ' is-active' : ''}" aria-label="Step ${i + 1}"></span>`
            ).join('');
        }

        const prevBtn = this.#overlay.querySelector('.onboarding-prev-btn') as HTMLElement | null;
        const nextBtn = this.#overlay.querySelector('.onboarding-next-btn') as HTMLElement | null;
        if (prevBtn) prevBtn.style.visibility = index === 0 ? 'hidden' : 'visible';
        if (nextBtn) nextBtn.textContent = index === STEPS.length - 1 ? 'Done ✓' : 'Next →';

        const targetEl = document.querySelector(step.target) as HTMLElement | null;
        const tooltip = this.#overlay.querySelector('.onboarding-tooltip') as HTMLElement | null;
        const spotlight = this.#overlay.querySelector('.onboarding-spotlight') as HTMLElement | null;
        if (!tooltip || !spotlight) return;

        if (targetEl) {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            this.#scrollTimer = setTimeout(() => {
                this.#scrollTimer = null;
                if (this.#isActive) this.#positionElements(targetEl, tooltip, spotlight, step.placement);
            }, 350);
        } else {
            if (step.fallbackMessage && bodyEl) bodyEl.textContent = step.fallbackMessage;
            this.#showCentered(tooltip, spotlight);
        }

        this.#a11yService.announce(`Step ${index + 1} of ${STEPS.length}: ${step.title}`);
        tooltip.focus();
    }

    #positionElements(targetEl: HTMLElement | null, tooltip: HTMLElement, spotlight: HTMLElement, placement: string): void {
        tooltip.style.transform = '';

        if (!targetEl) {
            this.#showCentered(tooltip, spotlight);
            return;
        }

        const rect = targetEl.getBoundingClientRect();
        const pad = 8;

        spotlight.style.cssText = `
            display: block;
            top: ${rect.top - pad}px;
            left: ${rect.left - pad}px;
            width: ${rect.width + pad * 2}px;
            height: ${rect.height + pad * 2}px;
        `;

        // Measure tooltip off-screen
        tooltip.style.visibility = 'hidden';
        tooltip.style.display = 'block';
        const ttRect = tooltip.getBoundingClientRect();
        const ttWidth = ttRect.width || 320;
        const ttHeight = ttRect.height || 180;
        tooltip.style.visibility = '';

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const margin = 16;

        let top = 0;
        let left = 0;

        switch (placement) {
            case 'bottom':
                top = rect.bottom + margin;
                left = rect.left + rect.width / 2 - ttWidth / 2;
                if (top + ttHeight > vh - margin) top = rect.top - ttHeight - margin;
                break;
            case 'top':
                top = rect.top - ttHeight - margin;
                left = rect.left + rect.width / 2 - ttWidth / 2;
                if (top < margin) top = rect.bottom + margin;
                break;
            case 'left':
                top = rect.top + rect.height / 2 - ttHeight / 2;
                left = rect.left - ttWidth - margin;
                if (left < margin) left = rect.right + margin;
                break;
            case 'right':
                top = rect.top + rect.height / 2 - ttHeight / 2;
                left = rect.right + margin;
                if (left + ttWidth > vw - margin) left = rect.left - ttWidth - margin;
                break;
        }

        top = Math.max(margin, Math.min(top, vh - ttHeight - margin));
        left = Math.max(margin, Math.min(left, vw - ttWidth - margin));

        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;
    }

    #showCentered(tooltip: HTMLElement, spotlight: HTMLElement): void {
        spotlight.style.display = 'none';
        tooltip.style.top = '50%';
        tooltip.style.left = '50%';
        tooltip.style.transform = 'translate(-50%, -50%)';
    }

    #next(): void {
        if (this.#currentStep >= STEPS.length - 1) { this.#complete(); return; }
        this.#showStep(this.#currentStep + 1);
    }

    #prev(): void {
        if (this.#currentStep > 0) this.#showStep(this.#currentStep - 1);
    }

    #complete(): void {
        this.#isActive = false;
        this.#storage.setItem(CONFIG.STORAGE_KEYS.ONBOARDING_COMPLETED, 'true');

        // Cancel pending scroll timer
        if (this.#scrollTimer !== null) {
            clearTimeout(this.#scrollTimer);
            this.#scrollTimer = null;
        }

        // Remove window event listeners to prevent memory leak
        if (this.#boundReposition) {
            window.removeEventListener('resize', this.#boundReposition);
            window.removeEventListener('scroll', this.#boundReposition);
            this.#boundReposition = null;
        }

        this.#overlay?.remove();
        this.#overlay = null;
        this.#a11yService.announce('Welcome tour completed.');
    }

    get isActive(): boolean { return this.#isActive; }
}
