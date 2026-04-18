#!/usr/bin/env node
import { Command, type Command as Cmd } from 'commander';
import {
  runFeed,
  runUser,
  runUserPosts,
  runPost,
  runScrape,
  sanitizeId,
  type ScrapeOpts,
  type FeedOpts,
  type UserOpts,
  type UserPostsOpts,
  type PostOpts,
} from './commands.js';

const program = new Command();
program
  .name('bsq')
  .description('Binance Square CLI (unofficial, browser-based via Playwright)')
  .version('0.1.0');

const commonOutputOpts = (c: Cmd): Cmd =>
  c
    .option('--raw', 'Emit the full ComposeResponse envelope', false)
    .option('--pretty', 'Emit a compact, human-friendly projection', false)
    .option('--headful', 'Run with a visible browser window', false)
    .option('--debug', 'Log diagnostics to stderr', false);

commonOutputOpts(
  program
    .command('feed')
    .description('Square homepage recommended feed')
    .option('-p, --page <n>', 'Starting page index (1-based)', (v) => parseInt(v, 10), 1)
    .option('-s, --size <n>', 'Page size (server often ignores this)', (v) => parseInt(v, 10), 20)
    .option('--scene <name>', 'Feed scene', 'web-homepage')
    .option('--pages <n>', 'Fetch N consecutive pages, dedup across them', (v) => parseInt(v, 10), 1)
    .option('--exclude-ids <csv>', 'Comma-separated post ids to exclude (seeds contentIds)'),
).action((opts: FeedOpts) => runFeed(opts));

commonOutputOpts(
  program
    .command('user <idOrUsername>')
    .description('User profile detail (by username; pass --uid to use a squareUid)')
    .option('--uid', 'Treat the argument as a squareUid instead of a username', false),
).action((idOrName: string, opts: UserOpts) => runUser(idOrName, opts));

commonOutputOpts(
  program
    .command('user-posts <squareUid>')
    .description("List a user's posts by squareUid")
    .option('--time-offset <ms>', 'Pagination cursor (ms timestamp)', (v) => parseInt(v, 10))
    .option('--filter-type <type>', 'Filter (ALL, ARTICLE, ...)', 'ALL'),
).action((squareUid: string, opts: UserPostsOpts) => runUserPosts(squareUid, opts));

commonOutputOpts(
  program
    .command('post <id>')
    .description('Single post detail'),
).action((id: string, opts: PostOpts) => runPost(sanitizeId(id), opts));

const addScrapeOpts = (c: Cmd): Cmd =>
  c
    .option('--api-pattern <regex>', 'Regex to filter captured API URLs', '/bapi/composite/')
    .option('--settle <seconds>', 'Seconds to wait for API calls', (v) => parseInt(v, 10), 8)
    .option('--scroll', 'Auto-scroll to trigger lazy loads', false)
    .option('--all', 'Keep noisy responses too', false)
    .option('--debug', 'Log captured URLs to stderr', false)
    .option('--headful', 'Run with a visible browser window', false);

addScrapeOpts(
  program
    .command('visit <url>')
    .description('Visit an arbitrary URL and capture API responses'),
).action((url: string, opts: ScrapeOpts) => runScrape(url, opts));

program.parseAsync().catch((err) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
