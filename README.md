# D&D 5e / 2024 Interactive Quick Reference

> **⚠️ IMPORTANT:** Please use **Ctrl + Shift + F5** or **Ctrl + R** to force refresh the page and ensure you are seeing the latest updates!

A modern, interactive, and highly customizable quick reference sheet for **Dungeons & Dragons 5th Edition**, supporting both the 2014 and 2024 rulesets.  

This project builds on the excellent foundation of [crobi/dnd5e-quickref](https://github.com/crobi/dnd5e-quickref), introducing major enhancements, new features, a revamped UI, and updated rules content.

The goal is to provide a **fast, accessible, and table-ready tool** for both Players and Dungeon Masters.

---

## Live Demo
* [natsumeaoii.github.io/dnd5e-quickref/](https://natsumeaoii.github.io/dnd5e-quickref/)
* [mfriik.github.io/dnd5e-quickref](https://mfriik.github.io/dnd5e-quickref/)
* [dnd.milobedzki.pl](https://dnd.milobedzki.pl/)
* [crobi.github.io (deprecated)](https://crobi.github.io/dnd5e-quickref/preview/quickref.html)

---

<details>
<summary><strong>Customization</strong></summary>

Customizing rules for your campaign is straightforward.  

### File Structure
Rules are stored in the `js/` directory as JSON files:
- 2014 rules: `data_action.json`, `data_condition.json`, `data_reaction.json`, etc.
- 2024 rules: `2024_data_action.json`, `2024_data_condition.json`, `2024_data_reaction.json`, etc.

### How to Add or Modify Rules
1. **Select the Correct File**  
   Edit the appropriate file depending on the ruleset (2014 or 2024).

2. **Add a New Rule**  
   Copy an existing entry and modify its properties. Ensure you use valid JSON syntax.

   Example:
   ```json
   {
       "title": "My Custom Action",
       "optional": "Homebrew rule",
       "icon": "mycustomicon",
       "subtitle": "A brief one-line description.",
       "reference": "My Campaign Guide p. 42",
       "description": "A more detailed description that appears in the popup.",
       "summary": "A short description that appears first in the popup.",
       "bullets": [
           { "type": "paragraph", "content": "Explain mechanics here." },
           { "type": "list", "items": ["Option A", "Option B"] }
       ]
   }
   ```

3. **Refresh**
   Reload the page to see your changes. If using the Node.js build process, run the build command first.

</details>

---

<details>
<summary><strong>How to Run Locally</strong></summary>

You can run this project using either **Node.js** (recommended for development/optimization) or **XAMPP** (simple static hosting).

### Option A: Node.js (Build & Optimize)
This method allows you to lint the code and generate an optimized, minified version of the site.

1.  **Install Dependencies**
    ```bash
    npm install
    ```

2.  **Build Project**
    Generates the optimized site in the `dist/` folder.
    ```bash
    npm run build
    ```

3.  **Run Locally**
    Serve the `dist` folder.
    ```bash
    npx serve dist
    ```

### Option B: XAMPP / Apache
This method runs the raw source code directly.

1.  **Install XAMPP**
    Download and install XAMPP from the official website.

2.  **Copy Files**
    Copy the entire project folder into your `htdocs` directory (usually `C:/xampp/htdocs/dnd5e-quickref`).

3.  **Start Apache**
    Open the XAMPP Control Panel and start the **Apache** module.

4.  **Access in Browser**
    Navigate to `http://localhost/dnd5e-quickref`.

</details>

---

<details>
<summary><strong>Contributing & Code Quality</strong></summary>

Contributions are welcome!

* **Report bugs** or request features by opening an issue on GitHub.
* **Submit pull requests** with fixes or enhancements.

### Linting
We enforce strict code style using ESLint (Airbnb config) and Stylelint. Before submitting a PR, please ensure your code passes the linters:

*   **Check for errors:** `npm run lint`
*   **Auto-fix errors:** `npm run lint:fix`

</details>

---


<details>
<summary><strong>Credits & Acknowledgements</strong></summary>

* **Original Concept**: [crobi/dnd5e-quickref](https://github.com/crobi/dnd5e-quickref)
* **2024 Rules Content**: [nico-713/dnd5e-quickref-2024](https://github.com/nico-713/dnd5e-quickref-2024)
* **Icons**: [Game-icons.net](http://game-icons.net/)
* **Favicon**: [IconDuck](https://iconduck.com/icons/21871/dragon)
* **Sources**:
  * Player’s Handbook (2014 & 2024) - PHB
  * Dungeon Master’s Guide (2014 & 2024) - DMG
  * Monster Manual (2014 & 2024) - MM
  * Xanathar’s Guide to Everything (2017) - XGE
  * Tasha’s Cauldron of Everything (2020) - TCE

</details>

---

<details>
<summary><strong>FAQ</strong></summary>

**Q: How do I switch between the 2014 and 2024 rules?**

A: Toggle the setting in the app. Files prefixed with `2024_` contain the updated rules.

**Q: How do I add custom homebrew content?**

A: Add or edit entries in the appropriate data file (`js/` directory). Follow the format outlined above.

**Q: I updated the code, but the browser still shows the old version.**

A: This is due to the Service Worker cache. The app is designed to work offline. To see changes immediately, use the force refresh key combo (`Ctrl + Shift + F5`) or unregister the Service Worker in your browser's DevTools.

**Q: What happens if a data file is missing or broken?**

A: The app includes custom error handling to prevent crashes and notify you of the issue.

</details>

---
