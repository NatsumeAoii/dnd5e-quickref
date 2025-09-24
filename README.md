# D&D 5e / 2024 Interactive Quick Reference

This is a significantly enhanced, modern, and interactive quick reference sheet for Dungeons & Dragons 5th Edition. It builds upon the excellent foundation of the original projects by **crobi**, introducing a host of new features, a revamped UI, and support for the 2024 rules update.

The goal of this project is to provide a fast, accessible, and highly usable tool for both Players and Dungeon Masters at the gaming table.

### Live Demo (Crobi) [Deprecated]
* **[DnD5e-Quick Refrence](https://crobi.github.io/dnd5e-quickref/preview/quickref.html)**

### Live Demo (Mfriik) [Others]
* **[DnD5e-Quick Refrence](https://mfriik.github.io/dnd5e-quickref/)**
* **[DnD5e-Quick Refrence](https://dnd.milobedzki.pl/)**

---
<details>
<summary><strong>Technical Overview</strong></summary>

The project is built with vanilla HTML5, CSS3, and modern JavaScript, ensuring it is lightweight and has no external dependencies.

* **CSS**: A single, well-organized CSS file (`quickref.css`) uses CSS Variables (Custom Properties) for easy theming and maintenance. It includes a complete dark mode theme and is fully responsive using media queries.
* **JavaScript**: The application logic in `quickref.js` is architected for clarity and robustness.
    * **Modular Design**: Code is organized into services for handling settings, data loading, rendering, and window management.
    * **State Management**: User settings are persisted in the browser's `localStorage`.
    * **Dynamic Rendering**: All rule items are loaded from external `data_*.js` files and rendered dynamically, which makes customization straightforward.
    * **Error Handling**: Includes custom error handling for missing elements or data files to prevent application crashes.

</details>

---

<details>
<summary><strong>How to Customize</strong></summary>

Adding your own content is simple. The rules are not hardcoded in the HTML; they are stored in JavaScript files within the `js/` directory.

1.  **Locate the Data Files**: Open the `js/` folder. You will find files like `data_action.js`, `data_condition.js`, etc. There are corresponding `2024_` prefixed versions for the updated ruleset.
2.  **Edit the Correct File**: Open the file corresponding to the section you want to modify. For example, to add a new Bonus Action, edit `data_bonusaction.js`.
3.  **Add Your Rule**: The data is stored in a JavaScript array. Copy an existing entry and modify it with your own content. Each rule is an object with the following properties:

```javascript
// Example from data_bonusaction.js
{
    "title": "My Custom Action",
    "optional": "Homebrew rule" // Can be 'Standard rule', 'Optional rule', or 'Homebrew rule'
    "icon": "my-custom-icon", // Icon name from icons.css
    "subtitle": "A brief one-line description.",
    "reference": "My Campaign Guide p. 42", // if 'Standard rule' or 'Optional rule' must be on valid and legit sources
    "description": "A more detailed description that appears in the popup.",
    "bullets": [
        "Use bullet points for detailed mechanics.",
        "You can use <b>HTML tags</b> for formatting."
    ],
}
````

4.  **Save and Reload**: Save the file and refresh the `index.html` page to see your changes.
</details>

---

<details>
<summary><strong>Acknowledgements</strong></summary>

  * **Original Concept**: [crobi/dnd5e-quickref](https://github.com/crobi/dnd5e-quickref)
  * **2024 Rules Content**: Based on work from [nico-713/dnd5e-quickref-2024](https://github.com/nico-713/dnd5e-quickref-2024)
  * **Icons**: All icons are provided by the fantastic artists at [Game-icons.net](http://game-icons.net/)
  * **Favicon**: Sourced from [IconDuck](https://iconduck.com/icons/21871/dragon)
  * **Sources**: Player Handbook (PHB) 2014 & 2024, Dungeon Master Guide (DMG) 2014 & 2024, Monster Manual (MM) 2014 & 2024, Xanathar's Guide to Everything (XGE) 2017, & Tasha's Cauldron of Everything (TCE) 2020.
</details>