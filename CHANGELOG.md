# Changelog

All notable changes to the **D&D 5e / 2024 Interactive Quick Reference** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
