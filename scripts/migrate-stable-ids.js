import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = path.join(root, 'data');
const locales = ['en_US', 'id_ID', 'fr_FR'];
const rulesets = ['2014', '2024'];
const categoryForFile = (file) => file.replace(/^2024_/, '').replace(/^data_/, '').replace(/\.json$/, '');
const slug = (title) => title.replace(/\*+$/u, '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'rule';

const sourceDir = path.join(dataRoot, 'en_US', 'rules');
for (const ruleset of rulesets) {
    const prefix = ruleset === '2024' ? '2024_' : '';
    const files = fs.readdirSync(sourceDir).filter((file) => file.startsWith(prefix) && file.endsWith('.json')).sort();
    for (const file of files) {
        const category = categoryForFile(file);
        const canonical = JSON.parse(fs.readFileSync(path.join(sourceDir, file), 'utf8'));
        for (const locale of locales) {
            const target = path.join(dataRoot, locale, 'rules', file);
            const rows = JSON.parse(fs.readFileSync(target, 'utf8'));
            if (rows.length !== canonical.length) throw new Error(`${locale}/${file}: record count differs from en_US`);
            const migrated = rows.map((row, index) => ({ ...row, id: `core.${ruleset}.${category}.${index + 1}-${slug(canonical[index].title ?? row.title ?? '')}` }));
            fs.writeFileSync(target, `${JSON.stringify(migrated, null, 4)}\n`);
        }
    }
}
console.log('Stable IDs migrated for all supported locale/ruleset files.');
