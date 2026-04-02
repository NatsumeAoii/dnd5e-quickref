# Changelog

All notable changes to the **D&D 5e / 2024 Interactive Quick Reference** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.6] - 2026-04-02

### Dependency Maintenance & Security

Resolved outstanding security advisories and upgraded safe patch-level dependencies.

#### Security

- **4 Vulnerability Fixes via `npm audit fix`**: Resolved high-severity advisories in `rollup` (GHSA-mw96-cpmx-2vgc), `picomatch` (GHSA-3v7f-55p6-f55p, GHSA-c2c7-rcm5-vvqj), and moderate `ajv` (GHSA-2g4f-4pwh-qvx6) / `flatted` (GHSA-25h7-pfq9-p65f) via transitive dependency resolution.

#### Changed

- **Upgraded `vitest`**: 4.1.0 → 4.1.2 (patch bug fixes).
- **Upgraded `jsdom`**: 29.0.0 → 29.0.1 (patch bug fixes).
- **Upgraded `lightningcss`**: 1.31.1 → 1.32.0 (minor, additive CSS property support).
- **Deleted Orphaned ESLint Config Files**: Removed `eslint.config.js`, `config/.eslintrc.json`, and `config/.eslintignore`. No ESLint runtime or dependencies are installed; these files were non-functional dead config from a prior setup attempt.

### Frontend Reliability & UX State Review

A targeted audit of UI state transitions, async rendering flows, and modal interaction resilience.

#### Fixed

- **Search Filter Desync on Section Expand**: Expanding a collapsed section while a search query is active now re-applies the search filter to the newly rendered items. Previously, `renderSectionContent` → `filterRuleItems` only applied optional/homebrew visibility, ignoring the active search query entirely. Added `UIController.#reapplySearchFilter()` which re-dispatches the search input event to reuse the existing debounced filter logic.
- **URL Hash Not Updated on Popup Minimize**: `WindowManager.minimizePopup()` now calls `#updateURLHash()` after removing the popup from `openPopups`. Previously, the URL hash retained the popup ID after minimizing — a reload would re-open the popup in full instead of keeping it minimized.
- **Arrow Key Navigation Behind README Modal**: Added `CONFIG.ELEMENT_IDS.README_MODAL` to the `MODAL_SELECTORS` exclusion list in `NavigationService`. Previously, pressing arrow keys while the README modal was open triggered grid navigation behind it, causing unexpected focus shifts and scroll jumps.

#### Improved

- **Trusted Types Consistency**: Replaced `innerHTML` with `replaceChildren()` + `createElement` in `OnboardingService.#showStep()` for dot indicator rendering. This was the last `innerHTML` usage in the service layer, making CSP/Trusted Types compliance consistent across the entire codebase.

### Build Infrastructure

#### Fixed

- **Dev Server TypeScript Checker Failing on Test Files**: `vite-plugin-checker` was scanning test files via the main `tsconfig.json`, causing "Cannot find module 'vitest'" errors in the dev server overlay. Created `tsconfig.app.json` (extends root config, excludes `src/__tests__/`) and pointed `vite-plugin-checker` to it. The root `tsconfig.json` (used by `tsc --noEmit` and IDE tooling) still covers all source files including tests.

### Documentation

A comprehensive accuracy audit of `README.md` against the actual filesystem and codebase state.

#### Fixed

- **7 Stale File References Removed from Project Structure**: Removed references to deleted files (`eslint.config.js`, `config/.eslintrc.json`, `config/.eslintignore`) and directories that no longer exist (`css/`, `js/quickref.js`, `js/modules/` with 6 files).
- **Architecture Notes Rewritten**: Replaced the "dual-layer architecture" description (which claimed active JS modules in `js/modules/`) with an accurate characterization: the application is a pure TypeScript codebase, with `js/data/` containing only rule data JSON files.
- **TypeScript Version Updated**: Corrected version references from 5.7 to 5.9 (matching installed `typescript@5.9.3`).
- **`package.json` License Fixed**: Changed the `license` field from `"ISC"` to `"MIT"` to match `LICENSE.md`.

#### Added

- **5 Missing Files Added to Project Structure**: `tsconfig.app.json`, `vitest.config.ts`, `src/img/`, `src/services/index.ts`, `ChangelogService.ts`, and the `src/__tests__/` directory with test files.
- **Icon Inlining Convention** (Conventions section): Documented that `src/img/` WebP icons are inlined as base64 data URIs during build via the 10 KB `assetsInlineLimit` threshold.

#### Removed

- **ESLint Code Quality Section**: Removed the entire ESLint subsection from Contributing (including manual install instructions for `@eslint/js` and `typescript-eslint`). Replaced with a Known Limitations note that the project has no ESLint configuration.
- **3 Stale Known Limitations Bullets**: Removed "Legacy dual-layer" (inaccurate), "ESLint dependencies not in package.json" (config deleted), and "`package.json` license says ISC" (now fixed).

---

## [1.1.5] - 2026-03-31

### Correctness & Robustness Pass II

A second targeted review addressing logic bugs, security hardening, and consistency across services.

#### Fixed
- **WakeLock Not Re-Acquiring**: `WakeLockService` now listens for the sentinel's `release` event to clear stale references. Previously, the browser-initiated release (e.g., tab hidden) left a dangling reference that prevented re-acquisition on visibility restore.
- **Gamepad Button Rapid-Fire**: `GamepadService` A-button press now fires once per press via a `#buttonHeld` guard. Previously, `click()` fired every animation frame (~60fps) while the button was held, causing dozens of popup opens or favorites toggles per second.
- **ArrowLeft Navigation Direction**: `NavigationService` ArrowLeft with no focused item now wraps to the last focusable element instead of jumping to the first, making directional intent consistent with ArrowRight behavior.
- **prefers-reduced-motion Ignored**: `PerformanceOptimizer.shouldReduceMotion()` now checks the OS-level `prefers-reduced-motion: reduce` media query in addition to hardware/network heuristics, per WCAG 2.1 SC 2.3.3.
- **Search Filter Leaking on Ruleset Switch**: `UIController.#switchRuleset()` now clears the search input before re-rendering, preventing stale `matchingIds` from the previous ruleset from ghosting section visibility.
- **Import Sanitizer Single-Match**: Restored the `g` flag on `UserDataService.#DANGEROUS_PATTERN` (used with `.replace()`). Without it, only the first occurrence of a dangerous pattern was stripped during note import.
- **Service Worker Dead Code**: Removed an unreachable second caching guard in `sw.js` `tryCachePut()` — the broader check on the preceding line already covered all cases.

#### Improved
- **Trusted Types Compliance**: Replaced `innerHTML` with `createElement`/`textContent` DOM construction in `KeyboardShortcutsService.#createModal()` and `ViewRenderer.renderFatalError()`. These were the last two raw `innerHTML` usages outside the sanitized `safeHTML()` pipeline.
- **BroadcastChannel Resilience**: `SyncService.#handleMessage()` now validates incoming payloads with type guards before destructuring, preventing runtime throws when other extensions or libraries post non-object messages to the shared channel.
- **Duplicate Rule Diagnostics**: `DataService.buildRuleMap()` now logs a warning when two different rules produce the same `type::title` key, making silent overwrites visible. Uses object identity check to suppress false positives from shared data sources (environment sub-sections).

#### Changed
- **DBService `getAll()` Refactored**: Replaced the hand-rolled cursor-based implementation (with its own manual retry logic) with `IDBObjectStore.getAllKeys()` + `IDBObjectStore.getAll()` routed through the existing `#withTransaction` helper. Retry behavior is now consistent across all DB operations (`put`, `delete`, `getAll`).

### Documentation

A grounded review of `README.md` to fix stale references, fill gaps, and improve contributor onboarding accuracy.

#### Fixed
- **Missing `test` Script in npm Scripts Table**: Added `test` / `vitest run` row. The script was in `package.json` but omitted from the documentation table.
- **Stale `prebuild` Description**: Updated to reflect that `prebuild.js` now copies both `CHANGELOG.md` and `README.md` to `public/` in addition to syncing the version string.
- **Stale `scripts/build.js` References**: Removed `build.js` from the Project Structure tree and the Known Limitations section. The file no longer exists; the active build pipeline uses `vite build`.
- **Missing Services in Project Structure Tree**: Added `NavigationService.ts` and `ReadmeService.ts` to the `src/services/` directory listing. Both were present in `services/index.ts` but omitted from the documented tree.

#### Added
- **ESLint Dependency Gap Note** (Code Quality + Known Limitations): Documented that `@eslint/js` and `typescript-eslint` are imported by `eslint.config.js` but not listed in `devDependencies`, with manual install instructions.
- **`package.json` License Mismatch** (Known Limitations): Flagged that the `license` field says `ISC` while `LICENSE.md` specifies MIT.
- **Vitest `jsdom` Environment Note** (Testing): Documented the `// @vitest-environment jsdom` pragma for DOM-dependent tests and confirmed `jsdom` is already in `devDependencies`.

---

## [1.1.4] - 2026-03-19

### Correctness & Robustness Pass

A targeted review addressing edge cases, mobile touch interactions, and race conditions.

#### Fixed
- **Touch Listener Memory Leak**: `DragDropManager` now binds `pointerdown` through a shared `AbortController`, ensuring listeners are properly garbage collected when the favorites section re-renders.
- **Orphaned Touch State**: Added `pointercancel` handling to `DragDropManager` to correctly clean up document-level listeners and visual clones if a system gesture or incoming call interrupts a drag action.
- **Stale DOM References**: Added null-guards in `NavigationService` to prevent throwing errors if `focus()` or `scrollIntoView()` are called on elements that have been removed from the DOM mid-navigation.
- **Event Payload Type Safety**: Strict validation added to `UIController.#handleSettingChangeEvent` to prevent destructuring crashes on malformed `externalStateChange` events.
- **Mobile Export Failures**: `exportFavorites` now mirrors `exportNotes` by prioritizing the native Web Share API on mobile devices, gracefully falling back to a `try/catch` wrapped `URL.createObjectURL` download sequence to fix silent failures in iOS Safari WebViews.
- **State Save Race Condition**: `WindowManager.#closePopup` now defers `saveSession()` until *after* the popup DOM removal animation completes, preventing transient closing states from being serialized to storage.

#### Improved
- **Search Key Rate**: Hoisted settings property resolution (`showOptional`, `showHomebrew`) outside the per-item filtering loop in `UIController`, significantly reducing object reads per keystroke during active searching.
- **Key Event Throttling**: Replaced an `Array.includes` linear lookup with an `O(1)` `Set.has` check for rapid-fire `keydown` validation in `NavigationService`.

---

## [1.1.3] - 2026-03-17

### Documentation Overhaul

A comprehensive rewrite of `README.md` for developer onboarding and end-user clarity.

#### Fixed
- **Node Version Mismatch**: Corrected prerequisite from "Node.js 18+" to "Node.js 22+" to match `package.json` `engines` field.
- **Duplicate Heading**: Removed duplicate `## Getting Started` section header.
- **Icon Field Docs**: Corrected custom rule `icon` field description from CSS sprite class reference to `public/img/` filename reference.

#### Added
- **Project Structure**: Full annotated directory tree covering `src/`, `js/`, `css/`, `public/`, `config/`, and `scripts/`.
- **Architecture Notes**: Documented the dual-layer architecture (legacy JS + modern TypeScript) and data flow through services.
- **npm Scripts Table**: Documented all available scripts (`dev`, `prebuild`, `build`, `preview`, `type-check`, `lint:css`).
- **Deployment Section**: Documented GitHub Actions CI/CD pipeline and manual deployment workflow.
- **Contributing Guide**: Quick start, code quality tools (TypeScript strict, ESLint, Stylelint), and project conventions.
- **Known Limitations**: Documented legacy `build.js` (dead code), missing test framework, SW caching behavior, and `file://` restriction.
- **Expanded FAQ** (9 new entries):
  - Keyboard shortcuts (with full shortcut table)
  - Gamepad navigation
  - Deep linking
  - Favorites (star, drag-and-drop reorder)
  - Themes and dark mode
  - Display density
  - Keep Screen On (Wake Lock API)
  - Print mode
  - Cross-tab sync (BroadcastChannel)
- **Import Limits**: Added concrete limits (500 notes, 10 KB/note, 5 MB/file) to notes backup FAQ.
- **Expanded Credits**: Added live demo links, license links, and full source book names.

### UI/UX

#### Added
- **In-App Changelog Modal**: Clicking the version number in the footer now opens a styled "What's New" modal instead of navigating to the raw `CHANGELOG.md` file. Shows the 3 most recent versions by default with a "Show All Versions" expansion. Content is fetched on-demand and cached. Rendered via `createElement`/`textContent` for CSP compliance (no `innerHTML`). New `ChangelogService` follows the existing `KeyboardShortcutsService` modal pattern.

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
