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
<summary><strong>Project Structure</strong></summary>

```
dnd5e-quickref/
├── index.html                    # Vite HTML entry point and static templates
├── package.json                  # npm metadata, scripts, and dev dependencies
├── vite.config.ts                # Vite build/dev-server configuration
├── tsconfig.json                 # TypeScript project configuration
├── tsconfig.app.json             # TypeScript config used by vite-plugin-checker
├── vitest.config.ts              # Vitest test configuration
├── eslint.config.js              # ESLint flat config
├── config/                       # Stylelint and legacy ESLint config files
├── scripts/
│   ├── prebuild.js               # Syncs versions and copies README/CHANGELOG to public/
│   └── audit-data.js             # Validates rule data, icons, tags, and public mirrors
├── src/
│   ├── main.ts                   # Application bootstrap and service wiring
│   ├── error-handler.ts          # Global runtime error screen wiring
│   ├── config.ts                 # Centralized constants and storage keys
│   ├── types.ts                  # Shared TypeScript interfaces
│   ├── css/                      # Application CSS and icon classes
│   ├── services/                 # Data, persistence, settings, sync, a11y, and modal services
│   ├── state/                    # StateManager pub/sub state container
│   ├── ui/                       # Rendering, popup, template, and drag/drop UI modules
│   ├── utils/                    # Shared utilities and Trusted Types helpers
│   └── __tests__/                # Vitest regression tests
├── data/
│   ├── en_US/
│   │   ├── menu.json             # English UI/menu strings
│   │   └── rules/                # English 2014 and 2024 rule JSON
│   └── id_ID/
│       ├── menu.json             # Indonesian UI/menu strings with English fallbacks where clearer
│       └── rules/                # Indonesian rule data slot; initially seeded from en_US
├── public/
│   ├── sw.js                     # Service worker
│   ├── manifest.json             # PWA manifest
│   ├── README.md                 # Generated copy of README.md for the in-app README modal
│   ├── CHANGELOG.md              # Generated copy of CHANGELOG.md for the in-app changelog modal
│   ├── data/                     # Generated public mirror of data/ used by runtime fetches
│   ├── img/                      # Icons and PWA images
│   └── themes/                   # Theme CSS files and theme manifest
├── .github/workflows/deploy.yml  # GitHub Pages build/deploy workflow
├── CHANGELOG.md
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── LICENSE.md
└── SECURITY.md
```

</details>

### Architecture Notes

The active app is a static Vite + TypeScript browser application. `index.html` loads `src/error-handler.ts` first, then `src/main.ts`; `QuickRefApplication` constructs services, UI components, renders rule sections, restores popup state, registers shortcuts, and registers the service worker.

Rule content is JSON data rather than TypeScript. `data/<locale>/rules/` is the source data directory, and `public/data/` is generated by `npm run sync-version` for runtime fetches and service-worker caching. Do not edit `public/data/` directly.

Data flows through a service-oriented architecture:
1. `LocalizationService` loads `data/<locale>/menu.json` and applies menu/UI labels with `en_US` fallback.
2. `DataService` fetches and caches JSON rule data from `data/<locale>/rules/`.
3. `StateManager` provides a pub/sub event bus.
4. `UIController` orchestrates the presentation layer.
5. `ViewRenderer` renders sections and items from the data.
6. `WindowManager` manages popup lifecycle, hash links, minimized tabs, and session restore.

---

## Customization

### Adding Custom Rules (JSON)

Rules are stored in `data/<locale>/rules/`. To add your own:

1. Open `data/en_US/rules/data_*.json` (2014) or `data/en_US/rules/2024_data_*.json` (2024).
   `npm run sync-version` copies `data/` into `public/data/`; do not edit the public mirror by hand.
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

### Adding or Updating Translations

1. Add or update menu strings in `data/<locale>/menu.json`.
2. Add rule files under `data/<locale>/rules/` using the same filenames as `data/en_US/rules/`.
3. Keep rule filenames lowercase: `data_<category>.json` and `2024_data_<category>.json`.
4. If an Indonesian translation is ambiguous, uncommon at the table, or likely to confuse D&D players, keep the English term.
5. Run `npm run sync-version` to refresh `public/data/`, then run `npm run audit:data`.

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

## Q&A

<details>
<summary><strong>How do I install this as an App (PWA)?</strong></summary>

- **Android (Chrome)**: Menu (⋮) → "Install App" or "Add to Home Screen".
- **iOS (Safari)**: Share button → "Add to Home Screen".
- **Desktop (Chrome/Edge)**: Click the Install icon in the address bar.

</details>

<details>
<summary><strong>How do I switch between 2014 and 2024 rules?</strong></summary>

Open **Settings** (bottom of the page) → toggle **"Use 2024 Rules"**. The app reloads with the new dataset.

</details>

<details>
<summary><strong>Why does the app still show the old version after update?</strong></summary>

The Service Worker caches aggressively for offline support. To force an update:

- **PC**: `Ctrl + Shift + R` (Windows) or `Cmd + Shift + R` (Mac).
- **Mobile**: Settings → Privacy → Clear Browsing Data (Cached Images and Files).
- **Advanced**: DevTools (F12) → Application → Service Workers → "Unregister", then reload.

</details>

<details>
<summary><strong>Can I backup and restore my notes?</strong></summary>

Yes. Notes are stored in your browser's IndexedDB.

- **Export**: Settings → "Export Notes" → save the `.json.gz` file.
- **Import**: Settings → "Import Notes" → select the backup. Notes merge; duplicates overwrite by ID.
- **Limits**: Max 500 notes, 10 KB per note, 5 MB per import file.

</details>

<details>
<summary><strong>What keyboard shortcuts are available?</strong></summary>

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
<summary><strong>Does the app support gamepad navigation?</strong></summary>

Yes. Connect any standard gamepad — the app auto-detects it via the Gamepad API.

- **Left stick** — Navigate between items (X axis) and sections (Y axis).
- **A button** (button 0) — Activate the focused item.

</details>

<details>
<summary><strong>How does deep linking work?</strong></summary>

Each rule popup has a **link icon** (🔗) in its header. Clicking it copies a URL containing the rule title as a hash parameter. When someone opens that URL, the app scrolls to the matching section and opens the popup automatically.

</details>

<details>
<summary><strong>How do favorites work?</strong></summary>

Click the **star** (★) on any rule item to add it to your Favorites section (appears at the top of the page). Favorites are stored in `localStorage` and persist across sessions. You can **drag and drop** favorites to reorder them.

</details>

<details>
<summary><strong>How do I change the theme or enable dark mode?</strong></summary>

Open **Settings** → use the **Color Theme** dropdown (Original, Sepia, High Contrast, Nord, Cyberpunk, Steampunk) and the **Dark Mode** toggle. Both persist in `localStorage`. See the [Adding Custom Themes](#adding-custom-themes) section to create your own.

</details>

<details>
<summary><strong>What does "Display Density" do?</strong></summary>

Settings → **Display Density** adjusts the spacing and sizing of rule items. Options: **Compact**, **Normal** (default), **Comfortable**. Useful for different screen sizes or personal preference.

</details>

<details>
<summary><strong>What does "Keep Screen On" do?</strong></summary>

Enabling **Keep Screen On** in Settings uses the [Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API) to prevent your device's screen from dimming or locking while the app is visible. Useful during game sessions. The lock is automatically released when the tab loses visibility and re-acquired when it becomes visible again. Not all browsers support this API.

</details>

<details>
<summary><strong>How do I use print mode?</strong></summary>

Press `Ctrl+P` or use the print button. Print mode expands all sections and hides interactive UI (popups, FABs, settings) so the page prints cleanly. Press `Ctrl+P` again to exit print mode.

</details>

<details>
<summary><strong>Does the app sync across tabs?</strong></summary>

Yes. The app uses `BroadcastChannel` to synchronize settings changes (theme, ruleset, etc.) across open tabs in the same browser. Changes made in one tab are reflected instantly in others, provided both tabs are running the same app version.

</details>

<details>
<summary><strong>Which rule data directory should I edit?</strong></summary>

Edit `data/<locale>/rules/` as the source data directory. `npm run sync-version` copies those files into `public/data/`, and `npm run audit:data` verifies that the public mirror matches.

</details>

<details>
<summary><strong>Why can `npm run build` change files?</strong></summary>

`npm run build` runs `prebuild`, which calls `npm run sync-version`. That script reads the latest semantic version heading from `CHANGELOG.md`, syncs version metadata into `package.json`, `package-lock.json`, `src/config.ts`, and `public/sw.js`, then copies `README.md` and `CHANGELOG.md` into `public/` for the in-app modals.

</details>

<details>
<summary><strong>Can I open `index.html` directly from the filesystem?</strong></summary>

No. The app uses ES modules, `fetch()`, and a service worker, so it must be served over HTTP or HTTPS. Use `npm run dev`, `npm run preview`, XAMPP/Apache, Nginx, or another static HTTP server.

</details>

<details>
<summary><strong>What should I run before opening a pull request?</strong></summary>

Run `npm test`, `npm run type-check`, `npm run lint`, `npm run lint:css`, `npm run audit:data`, and `npm run build`. These commands are all defined in `package.json`; GitHub Pages deployment currently runs `npm ci` and `npm run build`.

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

- TypeScript source lives in `src/`. Do not add new browser application logic under `data/`; that directory is static JSON content.
- Rule data (JSON) lives in `data/<locale>/rules/`. Each category has paired files: `data_<category>.json` (2014) and `2024_data_<category>.json` (2024).
- Public data mirrors live in `public/data/` and are generated by `npm run sync-version`; do not edit them directly.
- Static assets belong in `public/`. Vite copies them to `dist/` verbatim.
- Version is single-sourced from `CHANGELOG.md`. The `sync-version` script propagates it to `package.json` and `src/config.ts`, then copies the changelog to `public/CHANGELOG.md`.

### Testing

> **Note**: This project uses **Vitest** for unit testing core logic (services, utilities, state handlers).
> - Run tests once: `npm run test`
> - Run tests in watch mode: `npx vitest`

---

## Known Limitations & Pitfalls

- **Test coverage is incomplete**: Vitest coverage is focused on core state, services, utilities, data guardrails, and selected runtime behaviors. Full end-to-end and visual regression coverage are not present.
- **Duplicated public data is intentional**: `data/` is the source data directory, while `public/data/` is the runtime/static mirror used by browser fetches and service-worker caching.
- **Generated public docs can drift locally**: `public/README.md` and `public/CHANGELOG.md` are copied from the root docs by `npm run sync-version`, which also runs automatically before `npm run build`.
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
