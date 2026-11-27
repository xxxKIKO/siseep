// Generates the PWA icons from an image (default: public/favicon.svg).
// With the school's real logo: pnpm icons:build "C:/ruta/logo.png"
utaogo.png"
// Uses the local Chrome/Chromium (puppeteer-core), the same one the API uses for PDFs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// puppeteer-core is a dependency of the API.
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');

const webDir = fileURLToPath(new URL('../apps/web', import.meta.url));
const source = resolve(process.argv[2] ?? `${webDir}/public/favicon.svg`);
const outDir = `${webDir}/public/icons`;
const NAVY = '#1F3A7A';

const CHROME_CANDIDATES = [
  process.env.CHROMIUM_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].filter(Boolean);
const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No encontré Chrome/Chromium. Define CHROMIUM_PATH.');
  process.exit(1);
}
if (!existsSync(source)) {
  console.error(`No existe la imagen: ${source}`);
  process.exit(1);
}

const mime = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[
  extname(source).toLowerCase()
];
if (!mime) {
  console.error('Usa una imagen SVG, PNG o JPG.');
  process.exit(1);
}
const dataUri = `data:${mime};base64,${readFileSync(source).toString('base64')}`;

// name, size, padding (maskable icons need a safe zone), background
const ICONS = [
  ['icon-192.png', 192, 0, 'transparent'],
  ['icon-512.png', 512, 0, 'transparent'],
  ['icon-maskable-512.png', 512, 0.18, NAVY],
  ['apple-touch-icon.png', 180, 0.08, '#FFFFFF'],
];

mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  for (const [name, size, padding, background] of ICONS) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    const inner = Math.round(size * (1 - padding * 2));
    await page.setContent(
      `<body style="margin:0;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${background}">
        <img src="${dataUri}" style="width:${inner}px;height:${inner}px;object-fit:contain" />
      </body>`,
      { waitUntil: 'load' },
    );
    const png = await page.screenshot({ type: 'png', omitBackground: background === 'transparent' });
    writeFileSync(`${outDir}/${name}`, png);
    console.log(`✓ ${name} (${size}×${size})`);
  }
} finally {
  await browser.close();
}
