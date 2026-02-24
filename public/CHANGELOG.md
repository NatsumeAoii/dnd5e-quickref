# Changelog

All notable changes to the **D&D 5e / 2024 Interactive Quick Reference** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.2] - 2026-02-24

### Architecture & Optimization Pass
A comprehensive Zero-Mass autonomous optimization pass targeting strict architectural constraints, security, and performance.

#### Security & Edge Cases
- **Trusted Types Integration**: Fully implemented strict sanitization in the Trusted Types `default` policy (`Utils.ts`) to selectively strip `<script>`, `on*` handler attributes, and `javascript:` URIs.
- **IndexedDB Hardening**: `DBService` now handles `onblocked` rejections and automatically closes stale connections via `onversionchange`, preventing schema upgrade deadlocks across tabs.
- **Zip Bomb Defense**: Added a streaming size guard (`TransformStream`) during GZIP decompression in `UserDataService` to preemptively abort payloads exceeding the 50MB safety limit.
- **Memory Safety**: `decodeURIComponent` in `WindowManager` is now wrapped in `try/catch` to gracefully handle malformed URL payload crashes.
- **State Validation**: Strict schema and bounds validation added to `PersistenceService` for incoming `sessionStorage` parsing.
- **Cross-Tab Sync Guard**: `SyncService` updates are now version-gated to drop payloads from incompatible app versions, with added `onmessageerror` protections.
- **Mobile Exports**: `UserDataService` now prioritizes the Web Share API natively before falling back to `<a>.click()`, fixing silent download failures on iOS Safari.

#### Performance & Modularity
- **Zero-Allocation Data Caching**: Introduced a persistent `#dataCache` in `DataService` to completely eliminate redundantly fetching/parsing JSON when toggling between 2014 and 2024 rulesets.
- **Concurrency Limiting**: Network preloading of data modules is cleanly throttled (batch limit of 4) to prevent browser connection saturation.
- **Hot-Path Optimizations**: Stripped expensive `JSON.stringify` allocations out of `DataService` validation loops, iterating `Object.values()` directly.
- **Memoization Gates**: `#ruleMapDirty` flag gates redundant rule map rebuilds, while arrow-key focusables in `main.ts` are strictly cached with targeted cache invalidation to bypass layout trashing.
- **Linkify Caching**: Expensive regex `TreeWalker` rule linkification HTML is now memoized dynamically, and intelligently invalidated when the active ruleset switches.
- **Scoped DOM Traversal**: Hard-scoped `querySelectorAll` from global `document` down to `#main-scroll-area` or `#popup-container` across `ViewRenderer` and `WindowManager`.
- **CSP Hardening**: Extracted inline `onclick` handlers into `error-handler.js`, allowing strict removal of `'unsafe-inline'` from `script-src` Content-Security-Policy.
- **DOM Cleansing**: Purged `innerHTML = ''` in favor of CSP-safe `replaceChildren()`, avoiding Trusted Types bottlenecks; migrated `innerHTML` to `textContent` for plain text.
- **Regex Drift Fix**: Fixed logical drift bug in `UserDataService` where a static regex `g` flag mutated `lastIndex` across independent `.test()` calls.
- **Error Isolation**: `StateManager.publish` now wraps discrete listener callbacks in `try/catch` so a single faulty subscriber cannot collapse the event pipeline.

---

## [1.1.1] - 2026-02-24

### Fixed

- **Regex Stale State**: Reset `ruleLinkerRegex.lastIndex` before each `matchAll` call, preventing skipped rule-link matches on consecutive popup renders.
- **Section Content Flicker**: `renderOpenSections` no longer clears DOM content on collapsed sections, eliminating visible flicker during ruleset switches.
- **WakeLock Re-entrancy**: Added in-flight promise guard to `WakeLockService`, preventing duplicate `wakeLock.request()` calls on rapid `visibilitychange` events.
- **CSP Compliance**: Replaced 4 inline `onclick` assignments in the fatal error screen with `addEventListener` calls.

### Improved

#### Performance
- **O(1) Rule Link Resolution**: Pre-built `titleLookup` map in `DataService.buildLinkerData()` replaces per-match `Array.from().find()` scans in popup content linking.
- **TextEncoder Reuse**: Hoisted `TextEncoder` allocation outside the import-notes loop to avoid per-entry object creation.
- **Popup ID Lookup**: Extracted `#getPopupIdByElement()` helper in `WindowManager`, eliminating 3 repeated `Array.from(entries()).find()` chains in click handlers.

#### Code Quality
- **Deduplicated `getTopMostPopupId`**: `#handleKeyDown` now calls the existing public method instead of re-implementing the z-index scan.

#### CI/CD
- **Split `deploy.yml`**: Separated monolithic `build-and-deploy` into independent `build` and `deploy` jobs with `needs:` dependency.
- **Upgraded `upload-pages-artifact`**: v3 → v4 (uses `node20` runtime, avoids deprecated `node16`).
- **Removed redundant `configure-pages` step**: Base path is already set via `vite.config.ts`.
- **Automatic Changelog Sync**: Added a `prebuild` script to automatically copy `CHANGELOG.md` to `public/CHANGELOG.md` so it is always included in the final production build (`dist/`).

---

## [1.1.0] - 2026-02-18

### Added

#### New Features
- **Onboarding Tour**: First-visit guided walkthrough highlighting key features (collapsible sections, favorites, settings, shortcuts).
- **Keyboard Shortcuts Panel**: Press `?` or click the floating `?` button to view all available shortcuts.
- **Keyboard Shortcuts**: `Esc` (close popup), `Ctrl+E` (expand/collapse all), `Ctrl+P` (print mode), `Ctrl+W` (close all popups), `T` (scroll to top).
- **Arrow Key Navigation**: `←/→` navigate between items, `↑/↓` jump between sections, `Enter/Space` activate focused item.
- **Popup Minimize**: Minimize popups to a bottom tab bar and restore them with a click.
- **Popup Resize**: Drag popup edges to resize on desktop (≥1024px); dimensions persist across sessions.
- **Print Mode**: `Ctrl+P` toggles a print-friendly view that expands all sections and hides interactive chrome.
- **Shortcuts FAB**: Floating `?` button on the right side (desktop only) for quick access to keyboard shortcuts.

#### Code Quality & Infrastructure
- **ErrorService**: Centralized error reporting with structured logging and in-memory ring buffer.
- **Input Validation**: Import notes now validates file size (5MB), note count (500), per-note size (10KB), key format, and strips dangerous HTML.
- **ESLint Integration**: Flat config with `typescript-eslint`, `consistent-type-imports`, `no-eval`, and security rules.

### Improved

#### UI/UX
- **Section Collapse Memory**: Collapse/expand state persists in localStorage across page reloads.
- **Section Transitions**: Replaced `max-height` hack with smooth `grid-template-rows` animation for collapse/expand.
- **Skeleton Loader**: Refined loading skeleton with title bars and item grids matching actual layout.
- **Error Boundary**: Enhanced global error handler to capture unhandled promise rejections with structured output.
- **FAB Buttons**: Unified all floating action buttons to consistent 44px size and even spacing.

#### Performance
- **CSS Audit**: Removed dead selectors, consolidated redundant rules, improved transition performance.
- **Content Visibility**: Applied `content-visibility: auto` with `contain-intrinsic-size` for lazy section rendering.

---

## [1.0.0] - 2026-02-12

### Initial Release of the Modernized Stack

This version represents a complete rewrite and modernization of the original `dnd5e-quickref` project, migrating from vanilla HTML/JS to a robust TypeScript + Vite architecture while maintaining the original design philosophy.

### Added

#### Core Features
- **Dual Ruleset Support**: Toggle between **2014 (Legacy)** and **2024 (One D&D)** rulesets instantly via settings.
- **Offline PWA**: Full Progressive Web App support using a Service Worker for 100% offline functionality.
- **Deep Linking**: Added a 🔗 "Copy Link" button to every popup header for easy sharing of specific rules.
- **Customization**:
    - JSON-based custom rules support (Homebrew/Optional toggle).
    - Theme Engine with 6 bundled themes (Original, Sepia, High Contrast, Nord, Cyberpunk, Steampunk).
    - Notes system with **Export/Import (GZIP)** support for backup and transfer.

#### UI Enhancements
- **Sticky Headers**: Section titles now stick to the top of the viewport for easier navigation.
- **Back-to-Top Button**: A floating action button (FAB) appears after scrolling past 400px.
- **Item Count Badges**: Section titles now display the number of visible items (e.g., `Conditions (15)`).
- **Tooltip Previews**: Hovering over items with subtitles now shows a tooltip preview.
- **Responsive Layout**: Improved grid system for large screens (up to 5 columns on 1600px+).

#### Technical Improvements
- **TypeScript 5.7**: Strict type checking for better stability and maintainability.
- **Vite 6**: Fast development server and optimized production builds.
- **LightningCSS**: High-performance CSS minification and transformation.
- **Accessibility**:
    - "Reduce Motion" setting.
    - Full keyboard navigation support (`Tab`, `Enter`, `Space`).
    - ARIA labels and announcements for screen readers.

### Changed
- **Architecture**: Moved from monolithic `index.html` scripts to a modular `src/` structure with Services, Controllers, and Components.
- **State Management**: Replaced direct DOM manipulation with a centralized `StateManager`.
- **Data Loading**: Fetches rule data asynchronously with retry logic and caching.

---

## [Legacy] - Pre-2026

### Reference (Original Project)
The original project by `crobi`, built using vanilla JavaScript and HTML.

- **Features**: Basic single-page reference for D&D 5e (2014) rules.
- **Stack**: HTML, CSS, JavaScript (ES5/ES6).
- **Hosting**: GitHub Pages.
