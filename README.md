# D&D 5e / 2024 Interactive Quick Reference

A modern, interactive quick reference sheet for **Dungeons & Dragons 5th Edition**, supporting both the **2014** and **2024** rulesets.

Built on [crobi/dnd5e-quickref](https://github.com/crobi/dnd5e-quickref) with a revamped TypeScript architecture, offline PWA support, and a rich feature set for players and DMs.

**Live Demo** — [natsumeaoii.github.io/dnd5e-quickref](https://natsumeaoii.github.io/dnd5e-quickref/)

---

## Features

### Core
- **Dual Ruleset Support** — Switch between 2014 and 2024 rules instantly
- **Offline PWA** — Service Worker caches everything for full offline use
- **Customization** — Linking, Favorites, Notes (with import/export), and Themes
- **Deep Linking** — Share specific rules directly via URL

### Technical
- **Modern Stack** — Built with Vite 6 + TypeScript 5.7
- **Performance** — LightningCSS optimizations + zero runtime dependencies
- **Accessibility** — Full keyboard support, screen reader optimized, reduced motion

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Build | [Vite](https://vite.dev/) 6 |
| Language | TypeScript 5.7 (strict) |
| CSS | Vanilla CSS + [LightningCSS](https://lightningcss.dev/) |
| Icons | [Game-icons.net](https://game-icons.net/) (WebP images) |
| Hosting | GitHub Pages (static) |

---

## Getting Started

### Prerequisites

- **[Node.js](https://nodejs.org/) 22+** and **npm** (required for development and building).
- A modern web browser (Edge, Chrome, Firefox, Safari).
- **Git** (optional, for cloning the repository).

### Development

1. **Clone the repository:**
   ```bash
   git clone https://github.com/natsumeaoii/dnd5e-quickref.git
   cd dnd5e-quickref
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```
   Vite opens the app automatically at `http://localhost:5173/`. File changes trigger hot-reload.

### Production Build

1. **Build the project:**
   ```bash
   npm run build
   ```
   npm runs `prebuild` first, which syncs the app version from `CHANGELOG.md`, copies the changelog into `public/`, updates service-worker cache version metadata, then type-checks with `tsc --noEmit` and produces an optimized bundle in `dist/`.

   For release version changes, update the top semantic-version heading in `CHANGELOG.md`, then run:
   ```bash
   npm run sync-version
   ```
   `sync-version` also keeps the root package-lock metadata aligned.

2. **Preview the build locally:**
   ```bash
   npm run preview
   ```
   Serves `dist/` on a local HTTP server for final verification before deployment.

### Static Hosting (XAMPP / Apache / Nginx)

For environments without Node.js:

1. Build the project using `npm run build`, or download a release artifact.
2. Copy the **contents** of `dist/` (not `src/`) to your web server's public directory (e.g. `C:/xampp/htdocs/dnd5e`).
3. Open the corresponding URL (e.g. `http://localhost/dnd5e`).

> **Note**: The app must be served over HTTP/HTTPS. Opening via `file://` will not work due to browser security restrictions on ES modules and Service Workers.

---

## npm Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `vite` | Start the Vite dev server with HMR |
| `sync-version` | `node scripts/prebuild.js` | Sync version from `CHANGELOG.md` to `package.json`, `package-lock.json`, `src/config.ts`, `public/sw.js`, and copy `CHANGELOG.md` to `public/` |
| `prebuild` | `npm run sync-version` | Automatic version/changelog sync before `npm run build` |
| `build` | `tsc --noEmit && vite build` | Type-check then produce production bundle in `dist/`; npm runs `prebuild` first |
| `preview` | `vite preview` | Serve the production build locally |
| `type-check` | `tsc --noEmit` | Run TypeScript type-checking without emitting |
| `lint` | `eslint "src/**/*.ts"` | Lint TypeScript files via ESLint |
| `lint:css` | `stylelint "src/**/*.css"` | Lint CSS files via Stylelint |
| `audit:data` | `node scripts/audit-data.js` | Validate rule data mirrors, icon mappings, optional markers, environment tags, and bullet/table shapes |
| `test` | `vitest run` | Run the Vitest test suite once |

> `npm run build` can mutate tracked version/changelog files through `prebuild`. Check `git status` after release builds.

---

<details>
<summary><b>Project Structure</b></summary>

```
dnd5e-quickref/
├── index.html               # Main HTML entry point (Vite root)
├── package.json              # Node metadata, scripts, dependencies
├── vite.config.ts            # Vite build configuration
├── tsconfig.json             # TypeScript compiler options
├── eslint.config.js          # ESLint flat config (typescript-eslint)
│
├── src/                      # TypeScript source (modern layer)
│   ├── main.ts               # Application bootstrap & initialization
│   ├── error-handler.ts      # Global error boundary module
│   ├── config.ts             # Centralized configuration constants
│   ├── types.ts              # Shared TypeScript interfaces
│   ├── css/
│   │   ├── quickref.css      # Main application styles
│   │   └── icons.css         # Icon sprite definitions
│   ├── services/             # Business logic & infrastructure
│   │   ├── DataService.ts    # Rule data fetching, caching, & validation
│   │   ├── DBService.ts      # IndexedDB wrapper for notes storage
│   │   ├── UserDataService.ts# Import/export notes (GZIP, Web Share API)
│   │   ├── SettingsService.ts# Settings persistence (localStorage)
│   │   ├── PersistenceService.ts # Session state persistence
│   │   ├── SyncService.ts    # Cross-tab sync via BroadcastChannel
│   │   ├── KeyboardShortcutsService.ts # Keyboard shortcut handling
│   │   ├── GamepadService.ts # Gamepad input support
│   │   ├── OnboardingService.ts # First-visit guided tour
│   │   ├── A11yService.ts    # Accessibility helpers
│   │   ├── WakeLockService.ts# Screen Wake Lock API
│   │   ├── ErrorService.ts   # Structured error logging
│   │   ├── PerformanceOptimizer.ts # Performance helpers
│   │   ├── ServiceWorkerMessenger.ts # SW communication bridge
│   │   └── DOMProvider.ts    # Cached DOM element references
│   ├── state/
│   │   └── StateManager.ts   # Pub/sub event bus for app state
│   ├── ui/                   # Presentation layer
│   │   ├── UIController.ts   # Top-level UI orchestration
│   │   ├── ViewRenderer.ts   # Section & item rendering
│   │   ├── WindowManager.ts  # Popup lifecycle (open/close/minimize/resize)
│   │   ├── PopupFactory.ts   # Popup DOM construction
│   │   ├── TemplateService.ts# HTML template cloning & population
│   │   └── DragDropManager.ts# Drag-and-drop for favorites reordering
│   └── utils/
│       └── Utils.ts          # Shared utilities & Trusted Types policy
│
├── js/                       # Legacy JavaScript layer
│   ├── quickref.js           # Legacy entry point (still bundled)
│   ├── data/                 # Rule data JSON files
│   │   ├── data_*.json       # 2014 ruleset (6 categories)
│   │   └── 2024_data_*.json  # 2024 ruleset (6 categories)
│   └── modules/              # Legacy JS modules
│       ├── Config.js
│       ├── DataService.js
│       ├── Services.js
│       ├── StateManager.js
│       ├── UIComponents.js
│       └── Utils.js
│
├── css/                      # Legacy CSS (consumed by legacy JS layer)
│   ├── quickref.css
│   └── icons.css
│
├── public/                   # Static assets (copied verbatim to dist/)
│   ├── sw.js                 # Service Worker (cache-first strategy)
│   ├── manifest.json         # PWA manifest
│   ├── 404.html              # Custom 404 page
│   ├── 404.js                # Custom 404 redirect/theme helper
│   ├── favicon.ico
│   ├── img/                  # Icons & rule images (WebP, PNG, SVG)
│   ├── themes/
│   │   ├── themes.json       # Theme registry
│   │   ├── sepia.css
│   │   ├── high-contrast.css
│   │   ├── nord.css
│   │   ├── cyberpunk.css
│   │   └── steampunk.css
│   └── js/data/              # (Mirrors js/data/ in public for SW pre-caching)
│
├── config/                   # Linter configurations
│   ├── .eslintrc.json        # Legacy ESLint config (superseded by root flat config)
│   ├── .eslintignore
│   ├── .stylelintrc.json     # Stylelint config
│   └── .stylelintignore
│
├── scripts/                  # Build & automation scripts
│   ├── prebuild.js           # Version sync: changelog, package metadata, config, and service worker
│   └── audit-data.js         # Rule data mirror/schema/icon audit
│   └── build.js              # Legacy build script (not wired to npm scripts)
│
├── .github/workflows/
│   └── deploy.yml            # GitHub Actions: build → deploy to GitHub Pages
│
├── CHANGELOG.md              # Version history (Keep a Changelog format)
├── LICENSE.md                # MIT License
└── dist/                     # Build output (gitignored)
```
</details>

### Architecture Notes

The codebase has a **dual-layer architecture**:

- **Modern layer** (`src/`): TypeScript modules processed by Vite. This is the primary application code. Entry point is `src/main.ts`, loaded via `<script type="module">` in `index.html`.
- **Legacy layer** (`js/`, `css/`): The original vanilla JavaScript from the upstream `crobi/dnd5e-quickref` project. The `js/data/` directory contains the rule data JSON files consumed by both layers. The JS modules in `js/modules/` are bundled via the legacy `js/quickref.js` entry point.

Data flows through a service-oriented architecture:
1. `DataService` fetches and caches JSON rule data from `js/data/`
2. `StateManager` provides a pub/sub event bus
3. `UIController` orchestrates the presentation layer
4. `ViewRenderer` renders sections and items from the data
5. `WindowManager` manages the popup lifecycle

---

## Customization

### Adding Custom Rules (JSON)

Rules are stored in `js/data/`. To add your own:

1. Open `js/data/data_*.json` (2014) or `js/data/2024_data_*.json` (2024).
   If you are editing built-in shipped data, mirror the same change in `public/js/data/`.
2. Insert a JSON object into the array:

   ```json
   {
       "title": "My Custom Rule**",
       "optional": "Homebrew rule",
       "icon": "magicswirl",
       "subtitle": "Short card subtitle",
       "reference": "PHB p. 123",
       "description": "One sentence shown near the top of the popup.",
       "summary": "A concise quick-reference ruling for the popup summary box.",
       "bullets": [
           {
               "type": "paragraph",
               "content": "Use paragraph bullets for short explanatory text."
           },
           {
               "type": "list",
               "items": [
                   "Use list bullets for compact rule steps.",
                   "Limited inline markup such as <b>bold</b> and <i>italic</i> is supported."
               ]
           },
           {
               "type": "table",
               "headers": ["Case", "Result"],
               "rows": [["Example", "Outcome"]]
           }
       ]
   }
   ```

- **`optional`**: Controls visibility.
  - `"Standard rule"` — Always shown.
  - `"Optional rule"` — Hidden unless "Show Optional Rules" is enabled in Settings.
  - `"Homebrew rule"` — Hidden unless "Show Homebrew Rules" is enabled in Settings.
- **`icon`**: Corresponds to an image filename in `public/img/` (without extension).
- **`title` markers**: Use one trailing `*` for optional rules and two trailing `**` for homebrew rules.
- **`bullets`**: Supports `paragraph`, `list`, and `table` objects. Keep rule text concise and source-backed.

### Adding Custom Themes

1. Create a CSS file in `public/themes/` (e.g. `my-theme.css`).
2. Override CSS custom properties. See `public/themes/sepia.css` for an example.
3. Register the theme in `public/themes/themes.json`:
   ```json
   {
     "id": "my-theme",
     "displayName": "My Custom Theme"
   }
   ```
4. Reload — the new theme appears in the Settings dropdown.

---

## Deployment

### GitHub Pages (Automated)

Pushing to `master` triggers the GitHub Actions workflow (`.github/workflows/deploy.yml`):

1. Checks out the repository.
2. Sets up Node.js (version read from `package.json` `engines` field).
3. Runs `npm ci` and `npm run build`.
4. Deploys `dist/` to GitHub Pages.

### Manual Deployment

Run `npm run build` and upload the `dist/` directory to any static hosting provider (Netlify, Vercel, Cloudflare Pages, S3, etc.). The app uses relative paths (`base: './'` in Vite config), so it works in any subdirectory.

---

## FAQ

<details>
<summary><b>How do I install this as an App (PWA)?</b></summary>

- **Android (Chrome)**: Menu (⋮) → "Install App" or "Add to Home Screen".
- **iOS (Safari)**: Share button → "Add to Home Screen".
- **Desktop (Chrome/Edge)**: Click the Install icon in the address bar.
</details>

<details>
<summary><b>How do I switch between 2014 and 2024 rules?</b></summary>

Open **Settings** (bottom of the page) → toggle **"Use 2024 Rules"**. The app reloads with the new dataset.
</details>

<details>
<summary><b>Why does the app still show the old version after update?</b></summary>

The Service Worker caches aggressively for offline support. To force an update:

- **PC**: `Ctrl + Shift + R` (Windows) or `Cmd + Shift + R` (Mac).
- **Mobile**: Settings → Privacy → Clear Browsing Data (Cached Images and Files).
- **Advanced**: DevTools (F12) → Application → Service Workers → "Unregister", then reload.
</details>

<details>
<summary><b>Can I backup and restore my notes?</b></summary>

Yes. Notes are stored in your browser's IndexedDB.

- **Export**: Settings → "Export Notes" → save the `.json.gz` file.
- **Import**: Settings → "Import Notes" → select the backup. Notes merge; duplicates overwrite by ID.
- **Limits**: Max 500 notes, 10 KB per note, 5 MB per import file.
</details>

<details>
<summary><b>What keyboard shortcuts are available?</b></summary>

Press `?` (or click the floating **?** button on desktop) to open the shortcuts panel. Available shortcuts:

| Shortcut | Action |
|----------|--------|
| `?` | Toggle keyboard shortcuts panel |
| `Esc` | Close topmost popup |
| `Ctrl+W` | Close all popups |
| `Ctrl+E` | Expand/collapse all sections |
| `Ctrl+P` | Toggle print mode |
| `T` | Scroll to top |
| `← →` | Navigate between items in a section |
| `↑ ↓` | Navigate between sections |
| `Enter` / `Space` | Activate focused item |

Shortcuts are disabled while typing in inputs, textareas, or select fields.
</details>

<details>
<summary><b>Does the app support gamepad navigation?</b></summary>

Yes. Connect any standard gamepad — the app auto-detects it via the Gamepad API.

- **Left stick** — Navigate between items (X axis) and sections (Y axis).
- **A button** (button 0) — Activate the focused item.
</details>

<details>
<summary><b>How does deep linking work?</b></summary>

Each rule popup has a **link icon** (🔗) in its header. Clicking it copies a URL containing the rule title as a hash parameter. When someone opens that URL, the app scrolls to the matching section and opens the popup automatically.
</details>

<details>
<summary><b>How do favorites work?</b></summary>

Click the **star** (★) on any rule item to add it to your Favorites section (appears at the top of the page). Favorites are stored in `localStorage` and persist across sessions. You can **drag and drop** favorites to reorder them.
</details>

<details>
<summary><b>How do I change the theme or enable dark mode?</b></summary>

Open **Settings** → use the **Color Theme** dropdown (Original, Sepia, High Contrast, Nord, Cyberpunk, Steampunk) and the **Dark Mode** toggle. Both persist in `localStorage`. See the [Adding Custom Themes](#adding-custom-themes) section to create your own.
</details>

<details>
<summary><b>What does "Display Density" do?</b></summary>

Settings → **Display Density** adjusts the spacing and sizing of rule items. Options: **Compact**, **Normal** (default), **Comfortable**. Useful for different screen sizes or personal preference.
</details>

<details>
<summary><b>What does "Keep Screen On" do?</b></summary>

Enabling **Keep Screen On** in Settings uses the [Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API) to prevent your device's screen from dimming or locking while the app is visible. Useful during game sessions. The lock is automatically released when the tab loses visibility and re-acquired when it becomes visible again. Not all browsers support this API.
</details>

<details>
<summary><b>How do I use print mode?</b></summary>

Press `Ctrl+P` or use the print button. Print mode expands all sections and hides interactive UI (popups, FABs, settings) so the page prints cleanly. Press `Ctrl+P` again to exit print mode.
</details>

<details>
<summary><b>Does the app sync across tabs?</b></summary>

Yes. The app uses `BroadcastChannel` to synchronize settings changes (theme, ruleset, etc.) across open tabs in the same browser. Changes made in one tab are reflected instantly in others, provided both tabs are running the same app version.
</details>

---

## Contributing

### Quick Start

```bash
git clone https://github.com/natsumeaoii/dnd5e-quickref.git
cd dnd5e-quickref
npm install
npm run dev
```

### Code Quality

- **TypeScript**: Strict mode enabled. Run `npm run type-check` before committing.
- **ESLint**: Flat config in `eslint.config.js`. Enforces `consistent-type-imports`, `no-eval`, `eqeqeq`, and `no-console` (except `warn`/`error`/`info`).
- **Stylelint**: CSS linting via `npm run lint:css` using config in `config/.stylelintrc.json`.
- **Vitest**: Focused regression tests for services, state, utilities, data guardrails, and runtime behavior.

### Conventions

- TypeScript source lives in `src/`. Do not add new `.js` files to `js/modules/`.
- Rule data (JSON) lives in `js/data/`. Each category has paired files: `data_<category>.json` (2014) and `2024_data_<category>.json` (2024).
- Public data mirrors live in `public/js/data/`; keep mirrors identical when editing shipped rules.
- Static assets belong in `public/`. Vite copies them to `dist/` verbatim.
- Version is single-sourced from `CHANGELOG.md`. The `sync-version` script propagates it to `package.json` and `src/config.ts`, then copies the changelog to `public/CHANGELOG.md`.

### Testing

> **Note**: This project uses **Vitest** for unit testing core logic (services, utilities, state handlers). 
> - Run tests once: `npm run test`
> - Run tests in watch mode: `npx vitest`

---

## Known Limitations & Pitfalls

- **Test coverage is incomplete**: Vitest coverage is focused on core state, services, utilities, data guardrails, and selected runtime behaviors. Full visual regression coverage and legacy JS coverage are not present.
- **Legacy dual-layer**: The `js/` and `css/` directories contain the original vanilla JS codebase. These are still present for backwards compatibility but are progressively being superseded by `src/`.
- **`scripts/build.js` is a legacy artifact**: It references dependencies (`fs-extra`, `glob`, `esbuild`, `html-minifier-terser`) that are not listed in `package.json`. It is not wired to any npm script. The active build pipeline uses `vite build`.
- **Service Worker caching**: The SW uses a stale-while-revalidate strategy. Users may see stale content until the background update completes on next navigation. Hard-refresh forces a fresh load.
- **`file://` protocol unsupported**: ES modules and Service Workers require HTTP(S).

---

## Credits & Acknowledgements

- **Original Project** — [crobi/dnd5e-quickref](https://github.com/crobi/dnd5e-quickref)
   - Live Demo: https://crobi.github.io/dnd5e-quickref/preview/quickref.html
   - License: [MIT](https://github.com/crobi/dnd5e-quickref/blob/master/LICENSE.md)
- **2024 Rules Content** — [nico-713/dnd5e-quickref-2024](https://github.com/nico-713/dnd5e-quickref-2024)
   - Live Demo: https://nico-713.github.io/dnd5e-quickref-2024/
   - License: [MIT](https://github.com/nico-713/dnd5e-quickref-2024/blob/master/LICENSE.md)
- **Based Inspiration** — [mfriik/dnd5e-quickref](https://github.com/mfriik/dnd5e-quickref)
   - Live Demo: https://dnd.milobedzki.pl/
   - License: [MIT](https://github.com/mfriik/dnd5e-quickref/blob/master/LICENSE.md)
- **Icons** — [Game-icons.net](https://game-icons.net/)
- **Favicon** — [IconDuck](https://iconduck.com/icons/21871/dragon)
- **Sources**:
  - Player's Handbook 2014 & 2024 (PHB)
  - Dungeon Master's Guide 2014 & 2024 (DMG)
  - Monster Manual 2014 & 2025 (MM)
  - Xanathar's Guide to Everything (XGE)
  - Tasha's Cauldron of Everything (TCE)

---

## License

[MIT](./LICENSE.md) — Copyright © 2016–2026 NatsumeAoii and contributors.
