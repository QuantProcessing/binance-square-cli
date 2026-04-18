import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export async function launchBrowser(headless = true): Promise<Browser> {
  return chromium.launch({
    headless,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });
}

export async function newPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    locale: 'en-US',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  return { context, page };
}
