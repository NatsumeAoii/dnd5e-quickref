/* eslint-disable no-console */
import { execSync } from 'child_process';
import fs from 'fs-extra';
import { glob } from 'glob';
import path from 'path';

const distDir = 'dist';

function logStep(message) {
  console.log(`\n${message}`);
}

function clean() {
  logStep('Cleaning dist directory...');
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir);
}

function buildHtml() {
  logStep('Minifying HTML...');
  const options = [
    '--collapse-whitespace',
    '--remove-comments',
    '--remove-redundant-attributes',
    '--minify-css true',
    '--minify-js true',
    '--remove-script-type-attributes',
    '--remove-style-link-type-attributes',
  ];
  execSync(
    `html-minifier-terser index.html -o ${distDir}/index.html ${options.join(' ')}`,
  );

  execSync(
    `html-minifier-terser 404.html -o ${distDir}/404.html ${options.join(' ')}`,
  );
}

function buildCss() {
  logStep('Minifying CSS...');
  fs.mkdirSync(`${distDir}/css`);
  fs.mkdirSync(`${distDir}/themes`);

  execSync(
    `lightningcss --bundle --minify --sourcemap css/icons.css -o ${distDir}/css/icons.css`,
  );
  execSync(
    `lightningcss --bundle --minify --sourcemap css/quickref.css -o ${distDir}/css/quickref.css`,
  );

  const themeFiles = glob.sync('themes/*.css');
  for (const file of themeFiles) {
    const fileName = path.basename(file);
    execSync(
      `lightningcss --minify ${file} -o ${distDir}/themes/${fileName}`,
    );
  }
}

function buildJs() {
  logStep('Minifying JS...');
  fs.mkdirSync(`${distDir}/js`);

  execSync(
    `esbuild js/quickref.js --bundle --minify --sourcemap --outfile=${distDir}/js/quickref.js`,
  );

  execSync(`esbuild sw.js --minify --sourcemap --outfile=${distDir}/sw.js`);
}

function copyAssets() {
  logStep('Copying static assets...');

  fs.copySync('img', `${distDir}/img`);

  fs.copySync('favicon.ico', `${distDir}/favicon.ico`);
  fs.copySync('manifest.json', `${distDir}/manifest.json`);

  const jsonFiles = glob.sync('themes/*.json');
  for (const file of jsonFiles) {
    const dest = path.join(distDir, file);
    fs.copySync(file, dest);
  }

  fs.copySync('js/data', `${distDir}/js/data`);

  // Create .nojekyll to disable Jekyll processing on GitHub Pages
  fs.writeFileSync(path.join(distDir, '.nojekyll'), '');
}

function generateDataManifest() {
  logStep('Generating data manifest for service worker...');
  const dataFiles = glob.sync('js/data/{data_*.json,2024_data_*.json}');
  const manifest = {
    files: dataFiles.map((file) => `./${file.replace(/\\/g, '/')}`),
  };
  fs.writeJsonSync(path.join(distDir, 'js', 'data_manifest.json'), manifest, { spaces: 2 });
  console.log(`Manifest created with ${manifest.files.length} data files.`);
}

try {
  console.log('Starting production build...');
  clean();
  buildHtml();
  buildCss();
  buildJs();
  copyAssets();
  generateDataManifest();
  console.log('\nBuild complete! Files are ready in /dist');
} catch (error) {
  console.error('\nBuild failed:');
  console.error(error.message);
  process.exit(1);
}
