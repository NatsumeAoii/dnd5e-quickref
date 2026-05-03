# Contributing

## Project Scope

This is a static Vite + TypeScript app for D&D 5e quick reference data, UI, notes, favorites, offline support, and accessibility-focused interaction. Keep contributions within the current stack unless there is a clear technical reason to discuss a larger change first.

Good contributions usually fit one of these categories:

- Correctness fixes for rules data, UI behavior, persistence, service worker behavior, or accessibility.
- Small UX improvements that preserve the existing layout and interaction model.
- Focused robustness improvements with tests.
- Documentation updates that match the current codebase.
- Build, lint, or release workflow fixes.

Avoid broad rewrites, unrelated refactors, new frameworks, or new runtime dependencies without prior discussion.

## Requirements

- Node.js 22 or newer.
- npm.
- A modern browser for manual verification.

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

## Validation Commands

Run the relevant checks before opening a pull request:

```bash
npm test
npm run type-check
npm run lint
npm run lint:css
npm run build
```

For release/version changes, `npm run build` runs `prebuild`, which calls `npm run sync-version`. That syncs the top version in `CHANGELOG.md` into `package.json`, `package-lock.json`, `src/config.ts`, and copies `CHANGELOG.md` to `public/CHANGELOG.md`.

## Development Guidelines

- Preserve public behavior unless the change fixes a bug.
- Keep changes reviewable as one coherent pull request.
- Prefer the existing services, state manager, UI classes, and utility patterns.
- Add tests for bug fixes and behavior changes.
- Validate user-controlled input at boundaries: URL hashes, storage, imports, service worker messages, BroadcastChannel messages, and fetched JSON.
- Use `textContent`, `createElement`, and `replaceChildren` for static DOM where possible.
- Only use `safeHTML` for trusted app-rendered rule markup that needs limited inline formatting.
- Keep accessibility intact: semantic controls, keyboard support, focus-visible states, live region announcements, and reduced-motion behavior.
- Avoid leaking internal error details in user-facing notifications.
- Do not add runtime dependencies unless the benefit clearly outweighs bundle and maintenance cost.

## Data Changes

Rules live in:

- `js/data/`
- `public/js/data/`

When changing rule data:

- Keep 2014 and 2024 data files consistent with the intended ruleset.
- Preserve existing field names and response shapes.
- Use existing icon names from `public/img/`.
- Keep limited HTML markup simple. Current rule data primarily uses `<b>` and `<i>`.
- Check that linked rule titles still resolve in popups and search.

## Service Worker Changes

Service worker changes can affect update behavior, cache freshness, and offline use.

When touching `public/sw.js`:

- Keep cache matching rules explicit.
- Do not cache user data.
- Preserve the consent boundary for non-core content.
- Test online load, offline load, and app update behavior where possible.
- Add or update service worker tests for message handling and cache strategy changes.

## UI Changes

The app should remain simple, dense, and reference-focused. Preserve the existing layout unless the issue specifically requires layout work.

Check:

- Keyboard navigation.
- Popup open, close, minimize, resize, and hash links.
- Search and filters.
- Favorites and drag reorder.
- Notes autosave and import/export.
- Print mode.
- Mobile modal popup behavior.
- Dark mode, themes, density, and reduced motion.

## Pull Request Checklist

- The change has a clear reason and narrow scope.
- Tests were added or updated when behavior changed.
- `npm test` passes.
- `npm run type-check` passes.
- `npm run lint` passes.
- `npm run lint:css` passes.
- `npm run build` passes.
- Changelog updated when the change is user-visible, release-relevant, or behavior-changing.
- No hardcoded secrets, private data, or unrelated generated files are included.

## Reporting Bugs

Include:

- Browser and OS.
- URL or ruleset mode if relevant.
- Steps to reproduce.
- Expected behavior.
- Actual behavior.
- Console errors, screenshots, exported test data, or affected rule IDs when useful.

For security-sensitive reports, avoid posting exploit details publicly. Contact a maintainer through the repository's GitHub channels first.
