import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

const BASE = 'https://www.binance.com';
const API_PATTERN = /\/bapi\/composite\//i;

// Headers Binance's axios interceptor attaches. We sniff them once from a
// natural request during init(), then replay them for subsequent calls so we
// don't have to reimplement their canvas/audio/webgl fingerprint.
const REPLAY_HEADER_KEYS = [
  'bnc-uuid',
  'bnc-time-zone',
  'csrftoken',
  'clienttype',
  'lang',
  'versioncode',
  'device-info',
  'fvideo-id',
  'fvideo-token',
] as const;

export interface FeedRecommendParams {
  pageIndex?: number;
  pageSize?: number;
  scene?: string;
  contentIds?: string[];
}

export interface ComposeResponse<T = unknown> {
  code: string;
  message: string | null;
  messageDetail: string | null;
  data: T;
  success: boolean;
}

export class SquareClient {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private sniffedHeaders: Record<string, string> = {};

  async init(opts: { headless?: boolean; debug?: boolean } = {}): Promise<void> {
    this.browser = await chromium.launch({
      headless: opts.headless ?? true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });
    this.context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
      locale: 'en-US',
      viewport: { width: 1440, height: 900 },
    });
    this.page = await this.context.newPage();

    // Sniff headers from any natural composite API request
    this.page.on('request', (req) => {
      if (!API_PATTERN.test(req.url())) return;
      if (this.sniffedHeaders['device-info']) return;
      const h = req.headers();
      for (const k of REPLAY_HEADER_KEYS) {
        if (h[k]) this.sniffedHeaders[k] = h[k];
      }
      if (opts.debug && this.sniffedHeaders['device-info']) {
        process.stderr.write(
          `[debug] sniffed headers: ${Object.keys(this.sniffedHeaders).join(', ')}\n`,
        );
      }
    });

    await this.page.goto(`${BASE}/en/square`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    // Wait until we've captured the fingerprint headers
    const deadline = Date.now() + 15_000;
    while (!this.sniffedHeaders['device-info'] && Date.now() < deadline) {
      await this.page.waitForTimeout(200);
    }
    if (!this.sniffedHeaders['device-info']) {
      throw new Error(
        'Failed to sniff Binance fingerprint headers; the homepage may have been blocked or changed.',
      );
    }
  }

  async feedRecommend(params: FeedRecommendParams = {}): Promise<ComposeResponse> {
    return this.post('/bapi/composite/v9/friendly/pgc/feed/feed-recommend/list', {
      pageIndex: params.pageIndex ?? 1,
      pageSize: params.pageSize ?? 20,
      scene: params.scene ?? 'web-homepage',
      contentIds: params.contentIds ?? [],
    });
  }

  async feedRecommendMulti(opts: {
    startPage?: number;
    pages?: number;
    pageSize?: number;
    scene?: string;
    excludeIds?: string[];
    onPage?: (info: { pageIndex: number; added: number; totalSeen: number }) => void;
  }): Promise<ComposeResponse<{ vos: unknown[] }>> {
    const startPage = opts.startPage ?? 1;
    const pages = Math.max(1, opts.pages ?? 1);
    const pageSize = opts.pageSize ?? 20;
    const seen = new Set<string>(opts.excludeIds ?? []);
    const merged: unknown[] = [];

    for (let i = 0; i < pages; i++) {
      const resp = await this.feedRecommend({
        pageIndex: startPage + i,
        pageSize,
        scene: opts.scene,
        contentIds: [...seen],
      });
      if (!resp.success) {
        return { ...resp, data: { vos: merged } };
      }
      const vos = (resp.data as { vos?: Array<{ id?: string | number }> } | null)?.vos ?? [];
      let added = 0;
      for (const v of vos) {
        const id = v.id != null ? String(v.id) : '';
        if (!id) {
          merged.push(v);
          continue;
        }
        if (seen.has(id)) continue;
        seen.add(id);
        merged.push(v);
        added++;
      }
      opts.onPage?.({ pageIndex: startPage + i, added, totalSeen: seen.size });
      if (added === 0) break;
    }

    return {
      code: '000000',
      message: null,
      messageDetail: null,
      success: true,
      data: { vos: merged },
    };
  }

  async userByUsername(
    username: string,
    opts: { getFollowCount?: boolean; queryFollowersInfo?: boolean; queryRelationTokens?: boolean } = {},
  ): Promise<ComposeResponse> {
    return this.post('/bapi/composite/v3/friendly/pgc/user/client', {
      username,
      getFollowCount: opts.getFollowCount ?? true,
      queryFollowersInfo: opts.queryFollowersInfo ?? true,
      queryRelationTokens: opts.queryRelationTokens ?? true,
    });
  }

  async userBySquareUid(
    squareUid: string,
    opts: { getFollowCount?: boolean; queryFollowersInfo?: boolean } = {},
  ): Promise<ComposeResponse> {
    return this.post('/bapi/composite/v3/friendly/pgc/user/client', {
      squareUid,
      getFollowCount: opts.getFollowCount ?? true,
      queryFollowersInfo: opts.queryFollowersInfo ?? true,
    });
  }

  async post<T = unknown>(path: string, payload: unknown): Promise<ComposeResponse<T>> {
    if (!this.page) throw new Error('SquareClient not initialized');
    const traceId = cryptoUuid();
    const headers: Record<string, string> = {
      ...this.sniffedHeaders,
      'content-type': 'application/json',
      'x-trace-id': traceId,
      'x-ui-request-trace': traceId,
    };

    const { status, text } = await this.page.evaluate(
      async ({ path, payload, headers }) => {
        const r = await fetch(path, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          credentials: 'include',
        });
        return { status: r.status, text: await r.text() };
      },
      { path, payload, headers },
    );

    return parseResponse<T>('POST', path, status, text);
  }

  async get<T = unknown>(path: string, query: Record<string, string | number | undefined> = {}): Promise<ComposeResponse<T>> {
    if (!this.page) throw new Error('SquareClient not initialized');
    const traceId = cryptoUuid();
    const headers: Record<string, string> = {
      ...this.sniffedHeaders,
      'x-trace-id': traceId,
      'x-ui-request-trace': traceId,
    };

    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const fullPath = qs ? `${path}?${qs}` : path;

    const { status, text } = await this.page.evaluate(
      async ({ path, headers }) => {
        const r = await fetch(path, { method: 'GET', headers, credentials: 'include' });
        return { status: r.status, text: await r.text() };
      },
      { path: fullPath, headers },
    );

    return parseResponse<T>('GET', fullPath, status, text);
  }

  async userPosts(
    squareUid: string,
    opts: { timeOffset?: number; filterType?: string } = {},
  ): Promise<ComposeResponse> {
    return this.get('/bapi/composite/v2/friendly/pgc/content/queryUserProfilePageContentsWithFilter', {
      targetSquareUid: squareUid,
      timeOffset: opts.timeOffset ?? Date.now(),
      filterType: opts.filterType ?? 'ALL',
    });
  }

  async postDetail(postId: string): Promise<ComposeResponse> {
    return this.get(`/bapi/composite/v3/friendly/pgc/special/content/detail/${encodeURIComponent(postId)}`);
  }

  async close(): Promise<void> {
    await this.page?.close();
    await this.context?.close();
    await this.browser?.close();
    this.page = null;
    this.context = null;
    this.browser = null;
  }
}

function parseResponse<T>(
  method: string,
  path: string,
  status: number,
  text: string,
): ComposeResponse<T> {
  if (status < 200 || status >= 300) {
    throw new Error(`${method} ${path} ${status}: ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text) as ComposeResponse<T>;
  } catch {
    throw new Error(`${method} ${path}: non-JSON response: ${text.slice(0, 500)}`);
  }
}

function cryptoUuid(): string {
  // Node 20+ provides crypto.randomUUID on globalThis
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const h = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
