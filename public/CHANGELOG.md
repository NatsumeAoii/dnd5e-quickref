# Changelog

All notable changes to the **D&D 5e / 2024 Interactive Quick Reference** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
