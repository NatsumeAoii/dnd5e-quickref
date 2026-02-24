import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const changelogPath = path.join(rootDir, 'CHANGELOG.md');
const publicChangelogPath = path.join(rootDir, 'public', 'CHANGELOG.md');
const packageJsonPath = path.join(rootDir, 'package.json');
const configTsPath = path.join(rootDir, 'src', 'config.ts');

// 1. Sync CHANGELOG.md to public/
try {
    if (!fs.existsSync(path.join(rootDir, 'public'))) {
        fs.mkdirSync(path.join(rootDir, 'public'));
    }
    fs.copyFileSync(changelogPath, publicChangelogPath);
    console.log('✅ Copied CHANGELOG.md to public/CHANGELOG.md');
} catch (e) {
    console.warn('⚠️ Could not copy CHANGELOG.md to public:', e.message);
}

// 2. Extract latest version from CHANGELOG.md
const changelog = fs.readFileSync(changelogPath, 'utf8');
const versionMatch = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m);

if (!versionMatch) {
    console.error('❌ Could not find a valid semantic version tag (e.g. ## [1.2.3]) in CHANGELOG.md');
    process.exit(1);
}

const latestVersion = versionMatch[1];
console.log(`✅ Found target version [${latestVersion}] in CHANGELOG.md`);

// 3. Update package.json
try {
    const pkgStr = fs.readFileSync(packageJsonPath, 'utf8');
    const pkgData = JSON.parse(pkgStr);

    if (pkgData.version !== latestVersion) {
        pkgData.version = latestVersion;
        fs.writeFileSync(packageJsonPath, JSON.stringify(pkgData, null, 2) + '\n');
        console.log(`✅ Updated package.json version -> ${latestVersion}`);
    } else {
        console.log(`⚡ package.json version is already ${latestVersion}`);
    }
} catch (e) {
    console.error('❌ Failed to update package.json:', e.message);
    process.exit(1);
}

// 4. Update src/config.ts
try {
    const configTs = fs.readFileSync(configTsPath, 'utf8');
    const versionRegex = /(APP_VERSION:\s*')([^']+)(')/;

    if (versionRegex.test(configTs)) {
        const newConfigTs = configTs.replace(versionRegex, `$1${latestVersion}$3`);
        if (newConfigTs !== configTs) {
            fs.writeFileSync(configTsPath, newConfigTs);
            console.log(`✅ Updated src/config.ts APP_VERSION -> ${latestVersion}`);
        } else {
            console.log(`⚡ src/config.ts APP_VERSION is already ${latestVersion}`);
        }
    } else {
        console.warn('⚠️ Could not find APP_VERSION declaration in src/config.ts');
    }
} catch (e) {
    console.error('❌ Failed to update src/config.ts:', e.message);
    process.exit(1);
}
