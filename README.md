# D&D 5e / 2024 Interactive Quick Reference

A modern, interactive quick reference sheet for **Dungeons & Dragons 5th Edition**, supporting both the **2014** and **2024** rulesets.

Built on [crobi/dnd5e-quickref](https://github.com/crobi/dnd5e-quickref) with a revamped TypeScript architecture, offline PWA support, and a rich feature set for players and DMs.

---

## Live Demo

- [natsumeaoii.github.io/dnd5e-quickref](https://natsumeaoii.github.io/dnd5e-quickref/)

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
| Icons | [Game-icons.net](https://game-icons.net/) (CSS sprites) |
| Hosting | GitHub Pages (static) |

---

## Getting Started

## Getting Started

<details>
<summary><b>Prerequisites</b></summary>

   - **[Node.js](https://nodejs.org/) 18+** and **npm** (Required only for development/building).
   - A modern web browser (Edge, Chrome, Firefox, Safari).
   - **Git** (Optional, for cloning the repository).
</details>

<details>
<summary><b>Development (Node.js)</b></summary>

   **Recommended for developers who want to modify the code.**
   
   1. **Clone the repository:**
      ```bash
      git clone https://github.com/natsumeaoii/dnd5e-quickref.git
      cd dnd5e-quickref
      ```

   2. **Install dependencies:**
      ```bash
      npm install
      ```
      *This downloads all necessary libraries defined in `package.json`.*

   3. **Start the development server:**
      ```bash
      npm run dev
      ```
      The app will be available at `http://localhost:5173/`. Changes to files will automatically reload the browser.
</details>

<details>
<summary><b>Production Build</b></summary>

   **For deploying to a live server.**
   
   1. **Build the project:**
      ```bash
      npm run build
      ```
      This compiles TypeScript, optimizes CSS/JS, and outputs everything to the `dist/` folder.

   2. **Preview the build locally:**
      ```bash
      npm run preview
      ```
      Runs a local server hosting the `dist/` folder to verify everything works before deploying.
</details>

<details>
<summary><b>Static Hosting (XAMPP / Apache)</b></summary>

   **For users without Node.js.**
   
   1. Download the latest release (or build the project using `npm run build`).
   2. Copy the contents of the `dist/` folder (NOT the `src/` folder) to your web server's public directory.
      - Example: `C:/xampp/htdocs/dnd5e`.
   3. Open your browser to the corresponding URL (e.g., `http://localhost/dnd5e`).
   
   > **Note**: The app must be served via HTTP/HTTPS; getting it to work directly from the file system (`file://`) is not supported due to browser security restrictions on modules and service workers.
</details>

---

## Customization

<details>
<summary><b>How to Add Custom Rules (JSON)</b></summary>

   Rules are stored in `js/data/`. To add your own:

   1. **Locate the file**: Open `js/data/data_*.json` (for 2014) or `js/data/2024_data_*.json` (for 2024).
   2. **Add a new entry**: Insert a JSON object into the array.
   3. **Format**:

   ```json
   {
       "title": "My Custom Spell",
       "optional": "Homebrew rule",
       "icon": "spell-book",
       "subtitle": "Level 3 Evocation",
       "reference": "PHB p. 123",
       "description": "<p>A detailed description of the spell effect.</p>",
       "bullets": [
           "Range: 120 feet",
           "Duration: Instantaneous",
           "You can use <b>HTML tags</b> like bold or list items."
       ]
   }
   ```
   
   - **`optional`**: Controls visibility.
     - `"Standard rule"`: Always shown.
     - `"Optional rule"`: Hidden unless "Show Optional Rules" is enabled.
     - `"Homebrew rule"`: Hidden unless "Show Homebrew Rules" is enabled.
   - **`icon`**: Matches a class name from `css/icons.css` (e.g., `icon-spell-book`).
</details>

<details>
<summary><b>How to Add Custom Themes</b></summary>

   1. **Create the CSS file**: Add a new CSS file in `public/css/themes/` (e.g., `my-theme.css`).
   2. **Define Variables**: Override the CSS variables (colors, fonts). See `public/css/themes/sepia.css` for an example.
   3. **Register the Theme**: Open `public/themes/themes.json` and add an entry:
      ```json
      {
        "id": "my-theme",
        "displayName": "My Custom Theme"
      }
      ```
   4. **Reload**: The new theme will appear in the Settings dropdown.
</details>

---

## FAQ

<details>
<summary><b>How do I install this as an App (PWA)?</b></summary>

   This app is a Progressive Web App (PWA) and can be installed on your device for offline use.

   - **Android (Chrome)**:
     1. Open the menu (three dots `⋮`).
     2. Tap **"Install App"** or **"Add to Home Screen"**.
     
   - **iOS (Safari)**:
     1. Tap the **Share** button (box with arrow).
     2. Scroll down and tap **"Add to Home Screen"**.
     
   - **PC / Mac (Chrome/Edge)**:
     1. Look for the **Install icon** (monitor with arrow) in the address bar.
     2. Click it and select **Install**.
</details>

<details>
<summary><b>How do I switch between 2014 and 2024 rules?</b></summary>

   1. Open the **Settings** section (bottom of the page).
   2. Toggle the **"Use 2024 Rules"** switch.
   3. The app will instantly reload with the new data set.
</details>

<details>
<summary><b>Why does the app still show the old version after update?</b></summary>

   The Service Worker caches the app aggressively to ensuring it works offline. To force an update:

   - **PC**: Press `Ctrl + Shift + R` (Windows) or `Cmd + Shift + R` (Mac).
   - **Mobile**: Go to Settings > Privacy > Clear Browsing Data (Cached Images and Files).
   - **Advanced**: Open DevTools (F12) > Application > Service Workers > Click "Unregister", then reload.
</details>

<details>
<summary><b>Can I backup and restore my notes?</b></summary>

   **Yes!** Your notes are stored in your browser's local database. To transfer them:

   1. **Export**: 
      - Go to **Settings**.
      - Click **"Export Notes"**.
      - Save the `.json.gz` file.
      
   2. **Import**:
      - On the new device/browser, go to **Settings**.
      - Click **"Import Notes"**.
      - Select your backup file.
      - Your notes will be merged (existing notes with the same ID will be overwritten).
</details>

---

## Credits & Acknowledgements

- **Original Project** — [crobi/dnd5e-quickref](https://github.com/crobi/dnd5e-quickref)
- **2024 Rules Content** — [nico-713/dnd5e-quickref-2024](https://github.com/nico-713/dnd5e-quickref-2024)
- **Icons** — [Game-icons.net](https://game-icons.net/)
- **Favicon** — [IconDuck](https://iconduck.com/icons/21871/dragon)
- **Sources**: PHB, DMG, MM (2014 & 2024), XGE, TCE

---

## License

[MIT](./LICENSE.md) — Copyright © 2016–2026 NatsumeAoii and contributors.
