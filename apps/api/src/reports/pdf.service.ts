import { existsSync } from 'node:fs';
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Browser, PDFOptions } from 'puppeteer-core';
import puppeteer from 'puppeteer-core';
import { AppConfigService } from '../config/app-config.service';

/** Where Chrome/Chromium usually lives (Docker image, Linux CI, Windows, macOS). */
const CANDIDATE_PATHS = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export function findChromium(configured?: string): string | null {
  const explicit = configured || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (explicit) return existsSync(explicit) ? explicit : null;
  return CANDIDATE_PATHS.find((path) => existsSync(path)) ?? null;
}

/**
 * HTML → PDF with one reused Chromium instance and a small queue (PDF_CONCURRENCY jobs at a
 * time), so report cards for a whole group do not exhaust the server's memory.
 */
@Injectable()
export class PdfService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfService.name);
  private browser: Promise<Browser> | null = null;
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly config: AppConfigService) {}

  async render(html: string, options: PDFOptions = {}): Promise<Buffer> {
    await this.acquire();
    try {
      const browser = await this.getBrowser();
      const page = await browser.newPage();
      try {
        await page.setContent(html, { waitUntil: 'load' });
        const pdf = await page.pdf({
          format: 'letter',
          printBackground: true,
          margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' },
          ...options,
        });
        return Buffer.from(pdf);
      } finally {
        await page.close().catch(() => undefined);
      }
    } finally {
      this.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browser) await (await this.browser).close().catch(() => undefined);
  }

  private getBrowser(): Promise<Browser> {
    if (!this.browser) {
      const executablePath = findChromium(this.config.get('CHROMIUM_PATH'));
      if (!executablePath) {
        throw new ServiceUnavailableException(
          'No se encontró Chrome/Chromium para generar el PDF. Configura CHROMIUM_PATH.',
        );
      }
      this.browser = puppeteer
        .launch({
          executablePath,
          headless: true,
          args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
        })
        .then((browser) => {
          // If Chromium dies, the next request launches a new one.
          browser.on('disconnected', () => {
            this.logger.warn('Chromium disconnected');
            this.browser = null;
          });
          return browser;
        })
        .catch((error: unknown) => {
          this.browser = null;
          throw error;
        });
    }
    return this.browser;
  }

  private async acquire(): Promise<void> {
    if (this.running < this.config.get('PDF_CONCURRENCY')) {
      this.running++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.running++;
  }

  private release(): void {
    this.running--;
    this.waiting.shift()?.();
  }
}
