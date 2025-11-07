# D&D 5e / 2024 Interactive Quick Reference

A modern, interactive, and highly customizable quick reference sheet for **Dungeons & Dragons 5th Edition**, supporting both the 2014 and 2024 rulesets.  

This project builds on the excellent foundation of [crobi/dnd5e-quickref](https://github.com/crobi/dnd5e-quickref), introducing major enhancements, new features, a revamped UI, and updated rules content.

The goal is to provide a **fast, accessible, and table-ready tool** for both Players and Dungeon Masters.

---

## Live Demo

* [mfriik.github.io/dnd5e-quickref](https://mfriik.github.io/dnd5e-quickref/)
* [dnd.milobedzki.pl](https://dnd.milobedzki.pl/)
* [crobi.github.io (deprecated)](https://crobi.github.io/dnd5e-quickref/preview/quickref.html)

---

<details>
<summary><strong>Customization</strong></summary>

Customizing rules for your campaign is straightforward.  

### File Structure
Rules are stored in the `js/` directory:
- 2014 rules: `data_action.js`, `data_condition.js`, etc.
- 2024 rules: `2024_data_action.js`, `2024_data_condition.js`, etc.

### How to Add or Modify Rules
1. **Select the Correct File**  
   Edit the appropriate file depending on the ruleset (2014 or 2024).

2. **Add a New Rule**  
   Copy an existing entry and modify its properties.  

   Example (JavaScript-based data files):
   ```javascript
   {
       "title": "My Custom Action",
       "optional": "Homebrew rule", // Standard, Optional, or Homebrew
       "icon": "mycustomicon",    // Icon name from icons.css
       "subtitle": "A brief one-line description.",
       "reference": "My Campaign Guide p. 42",
       "description": "A more detailed description that appears in the popup.",
       "bullets": [
           "Use bullet points for mechanics.",
           "You can use <b>HTML</b> formatting."
       ],
   }
    ```

Example (JSON-based data files):

```json
{
    "title": "My Custom Action",
    "subtitle": "Quick description",
    "icon": "my-custom-icon",
    "description": "Longer text appears in the popup.",
    "bullets": [
        { "type": "paragraph", "content": "Explain mechanics here." },
        { "type": "list", "items": ["Option A", "Option B"] }
    ]
}
```

3. **Save & Refresh**
   Reload `index.html` to apply changes.

</details>

---

<details>
<summary><strong>How to Run Locally</strong></summary>

1. **Download and Install XAMPP (with PHP 8)**
   Get XAMPP from the [official site](https://www.apachefriends.org/).
   Follow their installation instructions. If you feel lost, check YouTube tutorials.

2. **Copy the Project Files**
   Place this project folder inside your XAMPP installation directory, e.g.:

   ```
   C:/xampp/htdocs/dnd-quickref
   ```

3. **Start Apache**
   Open the XAMPP Control Panel and start the **Apache** service.

4. **Run in Browser**
   Open a web browser and navigate to:

   ```
   http://localhost/dnd-quickref
   ```

   (Replace `dnd-quickref` with the actual folder name you used.)

That’s it — the quick reference should now be running locally!

</details>

---

<details>
<summary><strong>Contributing</strong></summary>

Contributions are welcome!

* **Report bugs** or request features by opening an issue on GitHub.
* **Submit pull requests** with fixes or enhancements.

</details>

---

<details>
<summary><strong>FAQ</strong></summary>

**Q: How do I switch between the 2014 and 2024 rules?**

A: Toggle the setting in the app. Files prefixed with `2024_` contain the updated rules.

**Q: How do I add custom homebrew content?**

A: Add or edit entries in the appropriate data file (`js/` directory). Follow the format outlined above.

**Q: What happens if a data file is missing or broken?**

A: The app includes custom error handling to prevent crashes and notify you of the issue.

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