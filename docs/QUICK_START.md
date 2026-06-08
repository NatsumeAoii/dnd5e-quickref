# Quick Start

The fastest path from zero to a running app.

## Prerequisites

- Node.js 22 or newer (`node --version`). Enforced by `package.json` `engines`.
- npm (bundled with Node).

## Run it

```bash
git clone https://github.com/NatsumeAoii/dnd5e-quickref.git
cd dnd5e-quickref
npm install
npm run dev
```

Vite opens `http://localhost:5173/` automatically (`server.open: true` in `vite.config.ts`). Edit any file under `src/` or `data/` and the page hot-reloads.

## Verify a production build

```bash
npm run build      # type-checks, syncs version, builds to dist/
npm run preview    # serves dist/ over local HTTP for final checks
```

> `npm run build` runs `prebuild` first, which **rewrites tracked files** (`package.json`, `package-lock.json`, `src/config.ts`, `public/sw.js`, `public/CHANGELOG.md`, `public/README.md`, and the `public/data/` mirror) to match the top version in `CHANGELOG.md`. Run `git status` after a build.

## Before opening a pull request

```bash
npm test
npm run type-check
npm run lint
npm run lint:css
npm run audit:data
npm run build
```

All six commands are defined in `package.json`. CI (`.github/workflows/deploy.yml`) currently runs only `npm ci` and `npm run build` on push to `master`.

## Important: do not open index.html via file://

The app uses ES modules, `fetch()`, and a service worker, all of which require an HTTP(S) origin. Use `npm run dev`, `npm run preview`, or any static HTTP server (XAMPP/Apache, Nginx). Opening the file directly will not work.
