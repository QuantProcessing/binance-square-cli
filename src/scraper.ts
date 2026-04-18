import type { Page, Response } from 'playwright';

export interface CapturedResponse {
  url: string;
  status: number;
  method: string;
  requestBody: unknown;
  body: unknown;
}

export interface ScrapeOpts {
  url: string;
  apiPattern: RegExp;
  settleMs?: number;
  scroll?: boolean;
}

export async function scrapePage(page: Page, opts: ScrapeOpts): Promise<CapturedResponse[]> {
  const captured: CapturedResponse[] = [];
  const seen = new Set<string>();

  const onResponse = async (resp: Response) => {
    const url = resp.url();
    if (!opts.apiPattern.test(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    const ct = resp.headers()['content-type'] ?? '';
    if (!ct.includes('application/json')) return;
    try {
      const body = await resp.json();
      const req = resp.request();
      let requestBody: unknown = null;
      const post = req.postData();
      if (post) {
        try { requestBody = JSON.parse(post); } catch { requestBody = post; }
      }
      captured.push({
        url,
        status: resp.status(),
        method: req.method(),
        requestBody,
        body,
      });
    } catch {
      // non-JSON or stream, skip
    }
  };

  page.on('response', onResponse);

  try {
    await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (opts.scroll) {
      await autoScroll(page);
    }
    await page.waitForTimeout(opts.settleMs ?? 8000);
  } finally {
    page.off('response', onResponse);
  }

  return captured;
}

async function autoScroll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let total = 0;
      const step = 600;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        total += step;
        if (total >= 4000) {
          clearInterval(timer);
          resolve();
        }
      }, 400);
    });
  });
}
