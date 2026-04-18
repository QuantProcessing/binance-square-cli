#!/usr/bin/env node
import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import { SquareClient, type ComposeResponse } from './client.js';
import {
  prettyFeed,
  prettyUser,
  prettyUserPosts,
  prettyPostDetail,
} from './pretty.js';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

// One long-lived browser + sniffed headers across the whole server process.
let client: SquareClient | null = null;
let initPromise: Promise<void> | null = null;

async function getClient(): Promise<SquareClient> {
  if (!client) client = new SquareClient();
  if (!initPromise) initPromise = client.init({ headless: true });
  await initPromise;
  return client;
}

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

interface OutputQuery {
  pretty?: string;
  raw?: string;
}

function project<T>(
  resp: ComposeResponse<T>,
  prettyFn: (d: unknown) => unknown,
  q: OutputQuery,
  reply: FastifyReply,
): unknown {
  if (!resp.success) {
    reply.status(502);
    return { error: 'upstream', code: resp.code, message: resp.message };
  }
  if (truthy(q.raw)) return resp;
  if (truthy(q.pretty)) return prettyFn(resp.data);
  return resp.data;
}

function truthy(v: string | undefined): boolean {
  return v === '1' || v === 'true' || v === 'yes';
}
function intOr(v: string | undefined, d: number): number {
  const n = v != null ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : d;
}

app.get('/health', async () => ({ ok: true, initialized: !!client }));

interface FeedQuery extends OutputQuery {
  page?: string;
  size?: string;
  scene?: string;
  pages?: string;
  excludeIds?: string;
}
app.get('/feed', async (req: FastifyRequest<{ Querystring: FeedQuery }>, reply) => {
  const q = req.query;
  const c = await getClient();
  const pages = intOr(q.pages, 1);
  const excludeIds = (q.excludeIds ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const resp =
    pages === 1 && excludeIds.length === 0
      ? await c.feedRecommend({
          pageIndex: intOr(q.page, 1),
          pageSize: intOr(q.size, 20),
          scene: q.scene,
        })
      : await c.feedRecommendMulti({
          startPage: intOr(q.page, 1),
          pages,
          pageSize: intOr(q.size, 20),
          scene: q.scene,
          excludeIds,
        });
  return project(resp, prettyFeed, q, reply);
});

interface UserQuery extends OutputQuery {
  username?: string;
  squareUid?: string;
}
app.get('/user', async (req: FastifyRequest<{ Querystring: UserQuery }>, reply) => {
  const q = req.query;
  if (!q.username && !q.squareUid) {
    reply.status(400);
    return { error: 'username or squareUid is required' };
  }
  const c = await getClient();
  const resp = q.username
    ? await c.userByUsername(q.username)
    : await c.userBySquareUid(q.squareUid!);
  return project(resp, prettyUser, q, reply);
});

interface UserPostsParams {
  squareUid: string;
}
interface UserPostsQuery extends OutputQuery {
  timeOffset?: string;
  filterType?: string;
}
app.get(
  '/user/:squareUid/posts',
  async (
    req: FastifyRequest<{ Params: UserPostsParams; Querystring: UserPostsQuery }>,
    reply,
  ) => {
    const { squareUid } = req.params;
    const q = req.query;
    if (!/^[A-Za-z0-9_-]+$/.test(squareUid)) {
      reply.status(400);
      return { error: 'invalid squareUid' };
    }
    const c = await getClient();
    const resp = await c.userPosts(squareUid, {
      timeOffset: q.timeOffset ? parseInt(q.timeOffset, 10) : undefined,
      filterType: q.filterType,
    });
    return project(resp, prettyUserPosts, q, reply);
  },
);

interface PostParams {
  id: string;
}
app.get(
  '/post/:id',
  async (req: FastifyRequest<{ Params: PostParams; Querystring: OutputQuery }>, reply) => {
    const { id } = req.params;
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      reply.status(400);
      return { error: 'invalid id' };
    }
    const c = await getClient();
    const resp = await c.postDetail(id);
    return project(resp, prettyPostDetail, req.query, reply);
  },
);

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
  } catch (e) {
    app.log.error(e, 'fastify close failed');
  }
  try {
    await client?.close();
  } catch (e) {
    app.log.error(e, 'client close failed');
  }
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: HOST, port: PORT });
