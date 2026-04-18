#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { SquareClient, type ComposeResponse } from './client.js';
import {
  prettyFeed,
  prettyUser,
  prettyUserPosts,
  prettyPostDetail,
} from './pretty.js';

// One long-lived browser + page across the whole MCP session. Binance's
// fingerprint headers are sniffed once during init and reused.
let client: SquareClient | null = null;
let initPromise: Promise<void> | null = null;

async function getClient(): Promise<SquareClient> {
  if (!client) client = new SquareClient();
  if (!initPromise) initPromise = client.init({ headless: true });
  await initPromise;
  return client;
}

const server = new Server(
  { name: 'binance-square', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

const RAW_FLAG = {
  raw: {
    type: 'boolean' as const,
    description: 'Return the full ComposeResponse envelope instead of a compact view',
    default: false,
  },
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'square_feed',
      description:
        'Fetch the Binance Square homepage recommended feed. Returns a compact list of posts (id, author, time, stats, url) by default. Use `pages` to fetch multiple consecutive pages with automatic dedup, and/or `excludeIds` to skip posts already seen.',
      inputSchema: {
        type: 'object',
        properties: {
          pageIndex: { type: 'number', description: '1-based starting page index', default: 1 },
          pageSize: { type: 'number', description: 'Server may cap/ignore this', default: 20 },
          scene: { type: 'string', default: 'web-homepage' },
          pages: {
            type: 'number',
            description: 'Fetch N consecutive pages and dedup across them',
            default: 1,
          },
          excludeIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Post ids to exclude (seeds the contentIds dedup list sent to the server)',
          },
          ...RAW_FLAG,
        },
      },
    },
    {
      name: 'square_user',
      description:
        'Fetch a Binance Square user profile. Provide either `username` or `squareUid`.',
      inputSchema: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Public username, e.g. "gzsq1234"' },
          squareUid: { type: 'string', description: 'Internal square uid (url-safe base64)' },
          ...RAW_FLAG,
        },
      },
    },
    {
      name: 'square_user_posts',
      description:
        "Fetch a user's posts by squareUid. Response includes a `timeOffset` cursor to pass back for the next page.",
      inputSchema: {
        type: 'object',
        required: ['squareUid'],
        properties: {
          squareUid: { type: 'string' },
          timeOffset: {
            type: 'number',
            description: 'Pagination cursor (ms). Omit for latest page.',
          },
          filterType: { type: 'string', default: 'ALL' },
          ...RAW_FLAG,
        },
      },
    },
    {
      name: 'square_post',
      description: 'Fetch a single Binance Square post by id, including `body` text.',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Numeric post id, e.g. "303702474979186"' },
          ...RAW_FLAG,
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const c = await getClient();
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  const raw = args.raw === true;

  let resp: ComposeResponse;
  let pretty: (d: unknown) => unknown;

  switch (req.params.name) {
    case 'square_feed': {
      const pages = numOr(args.pages, 1);
      const excludeIds = Array.isArray(args.excludeIds)
        ? (args.excludeIds as unknown[]).map(String)
        : [];
      if (pages === 1 && excludeIds.length === 0) {
        resp = await c.feedRecommend({
          pageIndex: numOr(args.pageIndex, 1),
          pageSize: numOr(args.pageSize, 20),
          scene: strOr(args.scene, 'web-homepage'),
        });
      } else {
        resp = await c.feedRecommendMulti({
          startPage: numOr(args.pageIndex, 1),
          pages,
          pageSize: numOr(args.pageSize, 20),
          scene: strOr(args.scene, 'web-homepage'),
          excludeIds,
        });
      }
      pretty = prettyFeed;
      break;
    }

    case 'square_user': {
      const username = strOr(args.username, '');
      const uid = strOr(args.squareUid, '');
      if (!username && !uid) {
        throw new Error('Either `username` or `squareUid` is required');
      }
      resp = username
        ? await c.userByUsername(username)
        : await c.userBySquareUid(uid);
      pretty = prettyUser;
      break;
    }

    case 'square_user_posts':
      resp = await c.userPosts(requireStr(args.squareUid, 'squareUid'), {
        timeOffset: typeof args.timeOffset === 'number' ? args.timeOffset : undefined,
        filterType: strOr(args.filterType, 'ALL'),
      });
      pretty = prettyUserPosts;
      break;

    case 'square_post':
      resp = await c.postDetail(requireStr(args.id, 'id'));
      pretty = prettyPostDetail;
      break;

    default:
      throw new Error(`Unknown tool: ${req.params.name}`);
  }

  if (!resp.success) {
    throw new Error(`Binance API error ${resp.code}: ${resp.message ?? 'unknown'}`);
  }

  const output = raw ? resp : pretty(resp.data);
  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
  };
});

function numOr(v: unknown, d: number): number {
  return typeof v === 'number' ? v : d;
}
function strOr(v: unknown, d: string): string {
  return typeof v === 'string' && v.length > 0 ? v : d;
}
function requireStr(v: unknown, name: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`${name} is required`);
  return v;
}

async function shutdown(): Promise<void> {
  try {
    await client?.close();
  } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const transport = new StdioServerTransport();
await server.connect(transport);
