import { launchBrowser, newPage } from './browser.js';
import { scrapePage } from './scraper.js';
import { SquareClient } from './client.js';
import { prettyFeed, prettyUser, prettyUserPosts, prettyPostDetail } from './pretty.js';

interface CommonOpts {
  raw?: boolean;
  pretty?: boolean;
  headful?: boolean;
  debug?: boolean;
  lang?: string;
}

export interface ScrapeOpts {
  apiPattern?: string;
  settle?: number;
  scroll?: boolean;
  debug?: boolean;
  all?: boolean;
  headful?: boolean;
}

export interface FeedOpts extends CommonOpts {
  page?: number;
  size?: number;
  scene?: string;
  pages?: number;
  excludeIds?: string;
}

export interface UserOpts extends CommonOpts {
  uid?: boolean;
}

export interface UserPostsOpts extends CommonOpts {
  timeOffset?: number;
  filterType?: string;
}

export type PostOpts = CommonOpts;

export async function runFeed(opts: FeedOpts): Promise<void> {
  const client = new SquareClient();
  await client.init({ headless: !opts.headful, debug: opts.debug, lang: opts.lang });
  try {
    const seed = (opts.excludeIds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const pages = Math.max(1, opts.pages ?? 1);

    if (pages === 1 && seed.length === 0) {
      const resp = await client.feedRecommend({
        pageIndex: opts.page ?? 1,
        pageSize: opts.size ?? 20,
        scene: opts.scene,
      });
      emit(resp, opts, prettyFeed);
      return;
    }

    const resp = await client.feedRecommendMulti({
      startPage: opts.page ?? 1,
      pages,
      pageSize: opts.size ?? 20,
      scene: opts.scene,
      excludeIds: seed,
      onPage: opts.debug
        ? ({ pageIndex, added, totalSeen }) =>
            process.stderr.write(`[debug] page ${pageIndex}: +${added} new (seen=${totalSeen})\n`)
        : undefined,
    });
    emit(resp, opts, prettyFeed);
  } finally {
    await client.close();
  }
}

export async function runUser(idOrName: string, opts: UserOpts): Promise<void> {
  const client = new SquareClient();
  await client.init({ headless: !opts.headful, debug: opts.debug, lang: opts.lang });
  try {
    const resp = opts.uid
      ? await client.userBySquareUid(idOrName)
      : await client.userByUsername(idOrName);
    emit(resp, opts, prettyUser);
  } finally {
    await client.close();
  }
}

export async function runUserPosts(squareUid: string, opts: UserPostsOpts): Promise<void> {
  const client = new SquareClient();
  await client.init({ headless: !opts.headful, debug: opts.debug, lang: opts.lang });
  try {
    const resp = await client.userPosts(squareUid, {
      timeOffset: opts.timeOffset,
      filterType: opts.filterType,
    });
    emit(resp, opts, prettyUserPosts);
  } finally {
    await client.close();
  }
}

export async function runPost(postId: string, opts: PostOpts): Promise<void> {
  const client = new SquareClient();
  await client.init({ headless: !opts.headful, debug: opts.debug, lang: opts.lang });
  try {
    const resp = await client.postDetail(postId);
    emit(resp, opts, prettyPostDetail);
  } finally {
    await client.close();
  }
}

export async function runScrape(targetUrl: string, opts: ScrapeOpts): Promise<void> {
  const browser = await launchBrowser(!opts.headful);
  try {
    const { page } = await newPage(browser);
    const apiPattern = opts.apiPattern
      ? new RegExp(opts.apiPattern, 'i')
      : /\/bapi\/composite\//i;

    const caps = await scrapePage(page, {
      url: targetUrl,
      apiPattern,
      settleMs: (opts.settle ?? 8) * 1000,
      scroll: opts.scroll ?? false,
    });

    if (opts.debug) {
      process.stderr.write(`[debug] target: ${targetUrl}\n`);
      for (const c of caps) {
        const size = JSON.stringify(c.body).length;
        process.stderr.write(`[debug] ${c.status} ${size}B ${c.url}\n`);
      }
    }

    const out = opts.all ? caps : caps.filter((c) => !isNoisy(c.url));
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  } finally {
    await browser.close();
  }
}

function emit(
  resp: { code: string; message: string | null; success: boolean; data: unknown },
  opts: { raw?: boolean; pretty?: boolean },
  pretty: (d: unknown) => unknown,
): void {
  if (!resp.success) {
    throw new Error(`API error ${resp.code}: ${resp.message ?? 'unknown'}`);
  }
  const out = opts.raw ? resp : opts.pretty ? pretty(resp.data) : resp.data;
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

function isNoisy(url: string): boolean {
  return /(tracking|metrics|analytics|log-collect|c2c|kyc|risk)/i.test(url);
}

export function sanitizeId(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid id: ${id}`);
  }
  return id;
}
