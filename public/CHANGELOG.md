# Changelog

All notable changes to the **D&D 5e / 2024 Interactive Quick Reference** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.7] - 2026-05-17

### Added
- **Locale Data Structure**: Moved rule JSON source files into `data/en_US/rules/` and added `data/id_ID/` with `menu.json` translation files and seeded rule-data files.
- **Language Setting**: Added an English/Indonesian language selector for localized menu text and locale-specific rule data loading.
- **README Modal Regression Coverage**: Added focused tests for README modal focus behavior, ordered setup steps, nested code examples, strong-formatted links, and emitted modal styling contracts.
- **Modal Width Contract Coverage**: Added a tooling regression that keeps the changelog modal width aligned with the README modal width.

### Changed
- **Runtime Data Paths**: Rule data now loads from `data/<locale>/rules/` instead of `js/data/`.
- **Data Sync Workflow**: `npm run sync-version` now copies the root `data/` tree into `public/data/` for static hosting and service-worker caching.
- **Changelog Modal Width**: The changelog modal now uses the same desktop width and mobile max-width behavior as the README modal.
- **Print Icon Fallback Caching**: Duplicate rule icons now reuse resolved print fallback image URLs during rendering, reducing repeated style-resolution work without changing visible icons.
- **Repository Upload Hygiene**: Kept generated output, dependencies, logs, local environment files, and local editor settings out of upload scope; `.vscode/settings.json` is no longer kept as a tracked machine-local file.

### Fixed
- **README Modal Ordered Lists**: Numbered README setup steps now render as semantic ordered lists instead of loose paragraphs with raw numbering.
- **README Modal Code Blocks in Lists**: Indented fenced code examples now stay attached to their owning README list item and have list indentation stripped from the rendered code.
- **README Modal Inline Links**: Markdown links nested inside strong text, such as `**[Node.js](https://nodejs.org/) 22+**`, now render as real links without leaking raw markdown.
- **README Modal Details Summaries**: Details summaries using either `<b>` or `<strong>` tags now render clean text labels without exposing wrapper markup.
- **README Modal Focus Management**: The README modal traps keyboard focus while open and restores focus to the opener when closed.

### Security
- **Safe README Rendering**: README modal content continues to render through `createElement` and `textContent`, with external links opened using `target="_blank"` and `rel="noopener noreferrer"`.

---

## [1.1.6] - 2026-05-04

### Rule Data Source Audit & Runtime Hardening

A source-grounded cleanup and hardening pass focused on 2014/2024 rule data accuracy, optional-rule labeling, runtime failure bounds, build/deploy consistency, and regression coverage.

#### Fixed
- **2024 Spellcasting Action Economy**: Updated Magic and Bonus Action spellcasting summaries to use the 2024 spell-slot-per-turn rule instead of the obsolete 2014 bonus-action cantrip restriction.
- **2024 Rule Accuracy**: Corrected several action, movement, condition, reaction, and environment entries, including shield management, stabilization with and without a Healer's Kit, Grappled targeting language, and movement/environment edge cases.
- **Optional vs. Homebrew Labels**: Reclassified entries that were incorrectly presented as 2024 official optionals when they are legacy 2014 DMG options or homebrew table rules.
- **Data Mirror Drift**: Synchronized matching `js/data/` and `public/js/data/` JSON files so runtime data and service-worker-cached data stay aligned.
- **Deploy Branch Drift**: Aligned the GitHub Pages workflow and README deployment instructions with the repository's `master` branch.
- **License Metadata Drift**: Updated package metadata to match the MIT license used by `LICENSE.md` and project documentation.
- **Notes Import Merge Semantics**: Duplicate note imports now overwrite by rule ID as documented, while safe punctuation in rule IDs is accepted.
- **Data Load Failure Bounds**: Timed-out data requests no longer retry repeatedly, and non-JSON responses are reported as data-load errors instead of raw parser failures.
- **Rule Link Boundaries**: Linkification now handles titles ending in punctuation, such as parenthetical rule names.
- **Malformed Rule Data Bounds**: Invalid bullet payloads are now rejected during data validation before they can reach popup rendering or search indexing.
- **Section State Recovery**: Malformed persisted section-collapse state now falls back to defaults instead of crashing section setup.

#### Added
- **Curated 2014 DMG Optionals**: Added source-backed optional references for `Healing Surge*`, `Healer's Kit Dependency*`, `Slow Natural Healing*`, `Fear and Horror*`, and `Hitting Cover*`.
- **Data Consistency Coverage**: Added a regression test that verifies the curated 2014 optional additions remain DMG-referenced and use the correct single-star optional marker.
- **Data Audit Command**: Added `npm run audit:data` to validate data mirrors, icon mappings, optional/homebrew markers, environment tags, and bullet/table shapes.
- **Boundary Regression Coverage**: Added tests for malformed runtime rule data and malformed stored section state.

#### Improved
- **Rule Text Quality**: Rephrased short descriptions, long summaries, and bullet details where the local book audit showed unclear, stale, or misleading wording.
- **Popup Text Formatting**: Improved popup title/reference wrapping, long inline content handling, and rule-table overflow behavior while preserving the existing layout and renderer model.
- **Search Coverage**: Search indexes now include summaries, bullet details, table cells, and references instead of only title/description/subtitle text.
- **Service-Worker Versioning**: The service-worker cache version now syncs from the app version during `sync-version`.
- **Build Warning Hygiene**: Normalized icon asset paths and moved the global error boundary into a bundled TypeScript module so production builds surface fewer unrelated warnings.
- **404 Page Portability**: Removed hardcoded project-base asset links from the 404 page and moved its redirect logic into an external script.
- **User-Facing Error Boundary**: The global error boundary now shows a safe generic message while logging diagnostics to the console, and destructive local reset now requires confirmation.
- **Trusted Types/CSP Hygiene**: Replaced remaining `cssText` writes and narrowed Trusted Types helper typing.
- **Repository Hygiene**: Expanded `.gitignore` coverage for local secrets, certificate/key material, database dumps, archives, caches, and editor backup files while keeping example env templates trackable.

---

## [1.1.5] - 2026-05-03

### Robustness & Regression Hardening

A follow-up hardening pass focused on browser runtime boundaries, Trusted Types behavior, persistence correctness, service-worker freshness, and automated regression coverage.

#### Fixed
- **Trusted Types Modal Rendering**: Rebuilt the keyboard shortcuts and onboarding modals with `createElement`/`replaceChildren` instead of static `innerHTML`, preventing the default Trusted Types policy from stripping required dialog controls.
- **Trusted Types Sanitizer Recursion**: Reworked `safeHTML` sanitization so the default Trusted Types policy no longer re-enters protected HTML sinks and overflows the call stack.
- **Notes Import Round Trip**: Notes for optional and homebrew rule IDs ending in `*` or `**` now import correctly instead of being skipped by an overly strict key validator.
- **Plain-Text Note Preservation**: Imported notes are preserved literally because they are stored in textarea values, avoiding destructive removal of harmless text such as `javascript:` or `<script>` examples.
- **Out-of-Order Note Saves**: Note writes for the same rule now queue per ID so older async writes cannot overwrite newer text.
- **IndexedDB Commit Semantics**: `DBService` now resolves writes only after transaction completion, not request success, preventing false "saved" states after aborted transactions.
- **Versioned Service-Worker Cache Reads**: JSON and bundled assets now keep query strings during cache lookup, preventing stale `?v=` data from being served after app updates.
- **Service Worker Claim Message**: Added handling for the app's `CLAIM` message so readiness and controller takeover behavior match the messenger contract.
- **URL Hash Input Bounds**: Popup IDs restored from the URL hash are now length- and count-bounded before data loading, avoiding unnecessary work from malformed hashes.
- **Print Restore Fallback**: Print mode now has a bounded restore fallback in addition to `afterprint`, preventing the page from staying in print state if the event is missed.
- **Theme and Density Validation**: Stored and synced appearance values are now validated before applying dataset values or theme stylesheet paths.
- **Rule Link Aliases**: Linkification now recognizes titles with optional/homebrew trailing star markers through normalized aliases.

#### Improved
- **Regression Coverage**: Added focused tests for Trusted Types modal behavior, sanitizer recursion, note import/export edge cases, service-worker caching, IndexedDB transaction handling, URL hash hardening, print fallback, linker aliases, and tooling consistency.
- **Tooling Enforcement**: Added an executable TypeScript lint script for the existing ESLint configuration and fixed surfaced lint issues.
- **Version Sync**: Added `prebuild` version synchronization so production builds copy the changelog and keep `package.json` and `src/config.ts` aligned.
- **Dependency Audit**: Updated dev tooling within existing semver ranges; `npm audit` now reports zero vulnerabilities.

#### Documentation
- **Contribution Guide**: Added `CONTRIBUTING.md` with setup, validation commands, data-editing guidance, service-worker cautions, UI review checks, and pull request expectations.
- **Code of Conduct**: Added `CODE_OF_CONDUCT.md` covering expected behavior, unacceptable behavior, reporting, scope, and enforcement.

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
