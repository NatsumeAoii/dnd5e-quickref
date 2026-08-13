import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const publicDataDir = path.join(rootDir, 'public', 'data');
const iconsCssPath = path.join(rootDir, 'src', 'css', 'icons.css');
const publicDir = path.join(rootDir, 'public');
const coveragePath = path.join(dataDir, 'coverage.json');

const allowedRuleTypes = new Set(['Standard rule', 'Optional rule', 'Homebrew rule']);
const allowedBulletTypes = new Set(['paragraph', 'list', 'table']);
const allowedEnvironmentTags = new Set([
    'environment_obscurance',
    'environment_light',
    'environment_vision',
    'environment_cover',
    'environment_other',
]);

const errors = [];
const localeDirs = fs.readdirSync(dataDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const readText = (filePath) => fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');

const addError = (message) => {
    errors.push(message);
};

const stableIdsBySource = new Map();
const canonicalStableIds = new Map();

if (!fs.existsSync(coveragePath)) addError('missing data/coverage.json coverage manifest');
else {
    const coverage = readJson(coveragePath);
    const expectedCategories = ['movement', 'action', 'bonus_action', 'reaction', 'condition', 'environment'];
    if (!Array.isArray(coverage.categories) || expectedCategories.some((category) => !coverage.categories.includes(category))) {
        addError('coverage.json categories do not describe the supported corpus');
    }
    if (!Array.isArray(coverage.locales) || coverage.locales.some((locale) => !localeDirs.includes(locale))) {
        addError('coverage.json locales do not match data directories');
    }
    if (!Array.isArray(coverage.rulesets) || !coverage.rulesets.includes('2014') || !coverage.rulesets.includes('2024')) {
        addError('coverage.json must list both supported rulesets');
    }
    if (typeof coverage.sourcePolicy !== 'string' || !coverage.sourcePolicy.trim()) addError('coverage.json is missing sourcePolicy');
    if (typeof coverage.lastUpdated !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(coverage.lastUpdated)) addError('coverage.json lastUpdated must be YYYY-MM-DD');
}

const iconsCss = fs.readFileSync(iconsCssPath, 'utf8');
const iconClasses = new Map();
iconsCss.replace(
    /\.icon-([a-z0-9_-]+)\s*\{\s*background-image:\s*url\(["']?([^"')]+)["']?\)/gi,
    (_match, iconName, assetPath) => {
        iconClasses.set(iconName, assetPath);
        return '';
    },
);

let auditedFileCount = 0;
let auditedRecordCount = 0;

for (const locale of localeDirs) {
    const rulesDir = path.join(dataDir, locale, 'rules');
    const publicRulesDir = path.join(publicDataDir, locale, 'rules');
    const menuPath = path.join(dataDir, locale, 'menu.json');
    const publicMenuPath = path.join(publicDataDir, locale, 'menu.json');

    if (!fs.existsSync(menuPath)) addError(`${locale}: missing menu.json`);
    else if (!fs.existsSync(publicMenuPath)) addError(`${locale}: missing public menu mirror`);
    else if (readText(publicMenuPath) !== readText(menuPath)) addError(`${locale}: public menu mirror differs from data source`);

    if (!fs.existsSync(rulesDir)) {
        addError(`${locale}: missing rules directory`);
        continue;
    }

    const dataFiles = fs.readdirSync(rulesDir)
        .filter((name) => name.endsWith('.json'))
        .sort();

    for (const fileName of dataFiles) {
        auditedFileCount++;
        const sourcePath = path.join(rulesDir, fileName);
        const publicPath = path.join(publicRulesDir, fileName);
        if (!fs.existsSync(publicPath)) {
            addError(`${locale}/${fileName}: missing public data mirror`);
            continue;
        }
        if (readText(publicPath) !== readText(sourcePath)) {
            addError(`${locale}/${fileName}: public data mirror differs from data source`);
        }

        const rows = readJson(sourcePath);
        if (!Array.isArray(rows)) {
            addError(`${locale}/${fileName}: root value must be an array`);
            continue;
        }

        rows.forEach((row, index) => {
            auditedRecordCount++;
            const title = typeof row?.title === 'string' ? row.title : '';
            const location = `${locale}/${fileName}[${index}] ${title || '(untitled)'}`;

            if (!title.trim()) addError(`${location}: missing title`);
            if (row?.id !== undefined) {
                if (typeof row.id !== 'string' || !/^(?:[a-z0-9][a-z0-9_-]*\.){1,4}[a-z0-9_-]+(?:-[a-z0-9-]+)*$/.test(row.id)) addError(`${location}: invalid stable id`);
                else {
                    const sourceKey = `${locale}/${fileName}`;
                    const fileIds = stableIdsBySource.get(sourceKey) ?? new Set();
                    if (fileIds.has(row.id)) addError(`${location}: duplicate stable id "${row.id}"`);
                    fileIds.add(row.id);
                    stableIdsBySource.set(sourceKey, fileIds);
                }
            } else addError(`${location}: missing stable id`);
            const parityKey = `${fileName}[${index}]`;
            if (locale === 'en_US') canonicalStableIds.set(parityKey, row.id);
            else if (canonicalStableIds.get(parityKey) !== row.id) addError(`${location}: stable id differs from en_US at ${parityKey}`);
            if (typeof row?.icon !== 'string' || !row.icon.trim()) {
                addError(`${location}: missing icon`);
            } else {
                const assetPath = iconClasses.get(row.icon);
                if (!assetPath) {
                    addError(`${location}: icon "${row.icon}" has no CSS class`);
                } else {
                    const normalizedAssetPath = assetPath.includes('/public/')
                        ? assetPath.slice(assetPath.indexOf('/public/') + '/public/'.length)
                        : assetPath.replace(/^(\.\.\/)+/, '');
                    if (!fs.existsSync(path.join(publicDir, normalizedAssetPath))) {
                        addError(`${location}: icon asset "${assetPath}" is missing`);
                    }
                }
            }

            if (!allowedRuleTypes.has(row?.optional)) addError(`${location}: invalid optional value "${row?.optional}"`);
            if (row?.optional === 'Optional rule' && (!title.endsWith('*') || title.endsWith('**'))) {
                addError(`${location}: optional rules must use one trailing *`);
            }
            if (row?.optional === 'Homebrew rule' && !title.endsWith('**')) {
                addError(`${location}: homebrew rules must use trailing **`);
            }

            if (fileName.includes('environment')) {
                if (!Array.isArray(row?.tags) || row.tags.length === 0) addError(`${location}: missing environment tags`);
                row?.tags?.forEach((tag) => {
                    if (!allowedEnvironmentTags.has(tag)) addError(`${location}: unknown environment tag "${tag}"`);
                });
            }

            row?.bullets?.forEach((bullet, bulletIndex) => {
                const bulletLocation = `${location}: bullets[${bulletIndex}]`;
                if (!allowedBulletTypes.has(bullet?.type)) addError(`${bulletLocation}: invalid type "${bullet?.type}"`);
                if (bullet?.type === 'paragraph' && typeof bullet.content !== 'string') addError(`${bulletLocation}: missing paragraph content`);
                if (bullet?.type === 'list' && !Array.isArray(bullet.items)) addError(`${bulletLocation}: missing list items`);
                if (bullet?.type === 'table') {
                    if (!Array.isArray(bullet.headers)) addError(`${bulletLocation}: missing table headers`);
                    if (!Array.isArray(bullet.rows)) addError(`${bulletLocation}: missing table rows`);
                    const headerCount = Array.isArray(bullet.headers) ? bullet.headers.length : 0;
                    bullet.rows?.forEach((tableRow, rowIndex) => {
                        if (!Array.isArray(tableRow) || tableRow.length !== headerCount) {
                            addError(`${bulletLocation}: row ${rowIndex} does not match header count`);
                        }
                    });
                }
            });
        });
    }
}

if (errors.length > 0) {
    console.error(`Data audit failed with ${errors.length} issue(s):`);
    errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
}

console.log(`Data audit passed for ${auditedRecordCount} rule record(s) in ${auditedFileCount} rule data file(s) across ${localeDirs.length} locale(s); every audited record has a stable ID and matching public mirror.`);
