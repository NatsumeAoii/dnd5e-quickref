# Architecture Overview

## What this is

A static, framework-free Progressive Web App that renders an interactive D&D 5e (2014) and 2024 quick-reference sheet. Built with Vite 6 and TypeScript 5.7 in strict mode. The production output is plain static files in `dist/` served by GitHub Pages. Runtime dependencies are minimal: `dompurify` (HTML sanitization) and `web-vitals` (telemetry).

## Runtime entry path

Tracing a load from trigger to first paint (grounded in `index.html` and `src/main.ts`):

1. `index.html` loads `/src/css/critical.css`, then `/src/error-handler.ts` as a module. `error-handler.ts` installs `window.onerror` and `window.onunhandledrejection` handlers that reveal the `#global-error-boundary` element, and wires the "Reload Page" / "Factory Reset" buttons.
2. `main.ts` runs on `DOMContentLoaded` (or immediately if already parsed) and constructs `QuickRefApplication`, the composition root.
3. `QuickRefApplication`:
   - `#initializeServices()` — instantiates all 18 services (see below).
   - `#initializeComponents()` — instantiates `TemplateService`, `ViewRenderer`, `PopupFactory`, `WindowManager`.
   - `#initializeController()` — instantiates `UIController`.
   - `start()` — initializes settings, loads localization, loads user data, loads DOMPurify + themes + active-ruleset rule data in parallel, builds the rule map, renders favorites and open sections, restores popups from session and URL hash, wires keyboard shortcuts and modals, then registers the service worker (`./sw.js`).

## Layers

```
index.html / error-handler.ts   (bootstrap + global error boundary)
        |
   main.ts (QuickRefApplication) (composition root, startup sequencing)
        |
 +------+--------+---------------+---------------+
 services/      state/          ui/             utils/
 (data, i18n,   StateManager    controllers,    TrieMatcher,
  persistence,  (pub/sub bus)   renderer,       Utils, webVitals
  sync, a11y,                   popups, DnD
  SW messaging)
```

### Services (`src/services/`)

`DataService` (fetch + validate + cache rule JSON, build rule/linker maps), `LocalizationService` (load `menu.json`, apply i18n with `en_US` fallback), `SettingsService`, `PersistenceService` (sessionStorage popup/session state), `UserDataService` (favorites + notes, import/export), `DBService` (IndexedDB with in-memory `Map` fallback), `SyncService` (cross-tab via `BroadcastChannel`, version-gated), `A11yService`, `GamepadService`, `WakeLockService`, `KeyboardShortcutsService`, `NavigationService`, `OnboardingService`, `ChangelogService`, `ReadmeService`, `ErrorService`, `PerformanceOptimizer`, `ServiceWorkerMessenger`, `DOMProvider`.

### State (`src/state/StateManager.ts`)

A single `StateManager` holds `AppState` (settings, user, ui, data) and a typed pub/sub bus. `StateEventMap` types the known events (`settingChanged`, `favoritesChanged`, `externalStateChange`) for compile-time safety. `publish` isolates listener errors so one throwing subscriber cannot break the others.

### UI (`src/ui/`)

`UIController` orchestrates presentation; `ViewRenderer` renders sections/items; `PopupFactory`/`WindowManager` manage popup lifecycle, hash links, minimized tabs, and session restore; `PopupLinkifier` cross-links rule references; `SearchController`, `CookieNoticeController`, `AppShortcutsController`, and `DragDropManager` handle focused concerns.

## Data flow

1. Source rule data lives in `data/<locale>/rules/` as JSON arrays of rule objects (shape defined in `src/types.ts`: `RuleData` + `Bullet`).
2. `npm run sync-version` (via `scripts/prebuild.js`) copies `data/` into `public/data/`. **The runtime fetches from `public/data/` (and the service-worker cache); never edit `public/data/` by hand.**
3. At runtime `DataService` fetches JSON with a 10s timeout, runs `validateData()` (rejects non-arrays, missing titles, invalid `optional` types, non-string icons, dangerous markup, malformed bullet/table shapes), caches it per ruleset, and builds a `ruleMap` plus an Aho-Corasick `TrieMatcher` for cross-linking.
4. `scripts/audit-data.js` (`npm run audit:data`) verifies the `public/data/` mirror byte-matches the source, every `icon` maps to a CSS class and an existing asset, optional/homebrew star markers are correct, environment tags are valid, and table rows match header counts.

## Security boundaries

- Strict CSP with Trusted Types declared in `index.html` (`require-trusted-types-for 'script'`, no `unsafe-inline` in `script-src`).
- All untrusted input is validated at boundaries: fetched JSON (`DataService`), URL hash (`WindowManager`), storage (`PersistenceService`), note imports (`UserDataService`, with gzip magic-byte + size checks), and `BroadcastChannel` messages (`SyncService`, version-gated).
- Rendering prefers `textContent`/`createElement`/`replaceChildren`; limited trusted rule markup goes through DOMPurify (`safeHTML`).

## The `src/finalization/` toolkit (not part of the app)

A standalone, pure code-analysis toolkit (file inventory, ten domain detectors/fixers, a bounded recheck/verify orchestrator, and a report builder) with extensive property-based tests. It performs no I/O in its core and is **not imported by the application**. It is included only by `vitest.config.ts`, so its tests run under `npm test`. It does not appear in `dist/`.
