import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const requiredPaths = [
    'README.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'docs/QUICK_START.md',
    'docs/TROUBLESHOOTING.md',
    'data/coverage.json',
    'wiki/Home.md',
    'wiki/Build-and-Versioning.md',
    'wiki/Testing.md',
];
const errors = requiredPaths.filter((file) => !fs.existsSync(path.join(root, file))).map((file) => `missing documented path: ${file}`);
const docs = ['README.md', 'CONTRIBUTING.md', 'docs/QUICK_START.md', 'docs/TROUBLESHOOTING.md', 'wiki/Build-and-Versioning.md', 'wiki/Development-Workflow.md', 'wiki/Testing.md'].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
for (const script of ['build', 'test', 'type-check', 'audit:data', 'check:generated', 'check:docs', 'check:sw', 'test:browser']) {
    if (!packageJson.scripts?.[script] || !docs.includes(`npm run ${script}`)) errors.push(`documented command missing or not declared: npm run ${script}`);
}
const packageVersion = packageJson.version;
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
if (!changelog.includes(`## [${packageVersion}]`)) errors.push(`CHANGELOG.md does not contain package version ${packageVersion}`);
if (errors.length) { console.error(`Documentation check failed:\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log('Documentation paths, commands, and version references are consistent.');
