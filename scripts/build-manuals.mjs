// `pnpm manuals:pdf` — docs/manual-*.md → docs/pdf/manual-*.pdf (letter, one page each).
// Uses the local Chrome/Chromium through puppeteer-core (a dependency of the API).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');
const { PDFDocument } = require('pdf-lib');

const docs = fileURLToPath(new URL('../docs', import.meta.url));
const out = `${docs}/pdf`;
const CHROME = [
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
const executablePath = CHROME.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No encontré Chrome/Chromium. Define CHROMIUM_PATH.');
  process.exit(1);
}

const css = `
  @page { size: letter; margin: 0.55in 0.6in; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10.5pt; line-height: 1.38; color: #1f2430; margin: 0; }
  h1 { color: #1F3A7A; font-size: 17pt; margin: 0 0 2px; border-bottom: 3px solid #1F3A7A; padding-bottom: 4px; }
  h1 + p { margin: 4px 0 8px; color: #4a5163; }
  h2 { color: #1F3A7A; font-size: 11.5pt; margin: 10px 0 3px; }
  ol, ul { margin: 2px 0 4px; padding-left: 22px; }
  li { margin: 1px 0; }
  p { margin: 4px 0; }
  strong { color: #12245a; }
  .strip { height: 6px; display: flex; margin-bottom: 10px; }
  .strip span { flex: 1; }
`;

mkdirSync(out, { recursive: true });
const files = readdirSync(docs).filter((f) => /^manual-.*\.md$/.test(f));
const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
let failed = false;
try {
  for (const file of files) {
    const html = `<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><style>${css}</style></head>
      <body><div class="strip"><span style="background:#F8CBAD"></span><span style="background:#9BC2E6"></span><span style="background:#A9D08E"></span><span style="background:#B4A7D6"></span></div>
      ${marked.parse(readFileSync(`${docs}/${file}`, 'utf8'))}</body></html>`;
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'letter',
      printBackground: true,
      preferCSSPageSize: true,
    });
    await page.close();
    const pages = (await PDFDocument.load(pdf)).getPageCount();
    const target = `${out}/${file.replace(/\.md$/, '.pdf')}`;
    writeFileSync(target, pdf);
    console.log(
      `${pages === 1 ? '✓' : '✗'} ${file} → docs/pdf (${pages} ${pages === 1 ? 'página' : 'páginas'})`,
    );
    if (pages !== 1) failed = true;
  }
} finally {
  await browser.close();
}
if (failed) {
  console.error('Algún manual pasa de una página: recórtalo.');
  process.exit(1);
}
