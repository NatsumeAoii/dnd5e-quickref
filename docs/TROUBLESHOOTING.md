# Troubleshooting

## App shows a blank page or "Something went wrong"

- If served via `file://`, it will not work. ES modules, `fetch()`, and the service worker require HTTP(S). Use `npm run dev`, `npm run preview`, or a static HTTP server.
- The global error boundary (`#global-error-boundary`) is revealed by `src/error-handler.ts` on uncaught errors. Open DevTools → Console for the logged `[GlobalError]` / `[UnhandledRejection]` details.
- "Factory Reset" in the error screen clears `localStorage` and `sessionStorage` for the site (after a confirm prompt) and reloads.

## Old content keeps showing after an update

The service worker caches aggressively (stale-while-revalidate). Force a refresh:

- Desktop: `Ctrl+Shift+R` (Windows) / `Cmd+Shift+R` (macOS).
- DevTools → Application → Service Workers → Unregister, then reload.
- Mobile: clear cached images/files in browser settings.

## `npm run build` modified my tracked files

Expected. `prebuild` runs `scripts/prebuild.js`, which syncs the version from the top `## [x.y.z]` heading in `CHANGELOG.md` into `package.json`, `package-lock.json`, `src/config.ts`, and `public/sw.js`, and regenerates `public/README.md`, `public/CHANGELOG.md`, and `public/data/`. Review with `git status` / `git diff` after building. To bump the release version, edit the top heading in `CHANGELOG.md` first, then run `npm run sync-version`.

## `npm run audit:data` fails

The audit (`scripts/audit-data.js`) reports the exact file and index. Common causes:

- **"public data mirror differs from data source"** — you edited `data/` but did not run `npm run sync-version`. Run it to refresh `public/data/`.
- **"icon ... has no CSS class" / "icon asset ... is missing"** — the `icon` field must match an `.icon-<name>` rule in `src/css/icons.css` whose asset exists under `public/img/`.
- **"optional rules must use one trailing \*" / "homebrew rules must use trailing **"\*\* — title star markers must match the `optional` field.
- **"row N does not match header count"** — table `rows` length must equal `headers` length.

## A rule does not render or is missing from search

`DataService.validateData()` silently drops entries that fail validation (non-string title, invalid `optional`, dangerous markup like `<script`, `on*=`, or `javascript:`, or malformed bullets). Check the entry against the `RuleData`/`Bullet` shapes in `src/types.ts` and re-run `npm run audit:data`.

## Cross-tab settings sync does nothing

`SyncService` uses `BroadcastChannel` and drops messages whose `version` does not match `CONFIG.APP_VERSION`. Both tabs must run the same app version. Browsers without `BroadcastChannel` get no sync (the service no-ops by design).

## "Keep Screen On" has no effect

It uses the Screen Wake Lock API, which is not supported in all browsers and only holds while the tab is visible. This is expected degradation, not a bug.

## Tests under src/finalization/ run unexpectedly

`vitest.config.ts` includes `src/finalization/__tests__/**`. These belong to the standalone analysis toolkit, not the app. They run with `npm test` by design and do not affect the built site.
