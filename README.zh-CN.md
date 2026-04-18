# binance-square-cli

[English](./README.md) · **简体中文**

[币安广场](https://www.binance.com/zh-CN/square) 非官方 CLI / MCP / HTTP 服务端。由于币安未公开广场 API，本工具通过 Playwright 无头 Chromium 嗅探一次指纹头，然后复用这些头直连内部 `/bapi/composite/*` 接口。

只读，免登录。

## 为什么要用 Playwright 而不是裸 HTTP

币安前端通过 axios 拦截器给每个 API 请求注入一组指纹头 —— `bnc-uuid`、`csrftoken`、`device-info`（含 canvas/WebGL/audio 指纹的 base64 JSON）、`x-trace-id` 等。缺这些头直接请求会拿到 `data: null`。本工具不去复现指纹算法，而是在真实浏览器里打开 `/<lang>/square`，嗅到第一个 composite 请求的头，后续所有调用都复用（`x-trace-id` 每次新生成）。

冷启约 5 秒，后续每次请求约 200ms。

## 安装

```bash
npm install
# postinstall 会下载 Chromium（约 150MB）
```

编译 TypeScript：

```bash
npm run build
```

## CLI

```bash
# 首页推荐流
node dist/index.js feed --pretty
node dist/index.js feed --page 2 --size 20

# 连续抓 N 页，自动跨页去重
node dist/index.js feed --pretty --pages 3

# 用已看过的 id 作为服务端去重种子
node dist/index.js feed --pretty --exclude-ids 313714906103617,313590566577730

# 用户资料（按 username，或加 --uid 按 squareUid）
node dist/index.js user gzsq1234 --pretty
node dist/index.js user New5jCFqC0D5Opz178dklQ --uid --pretty

# 某用户的帖子列表（默认以当前时间为游标）
node dist/index.js user-posts New5jCFqC0D5Opz178dklQ --pretty
node dist/index.js user-posts New5jCFqC0D5Opz178dklQ --time-offset 1775004554999

# 单帖详情
node dist/index.js post 303702474979186 --pretty

# 中文内容
node dist/index.js user gzsq1234 --lang zh-CN --pretty

# 通用抓包兜底：访问任意广场 URL 并 dump 捕获的 JSON 响应
node dist/index.js visit https://www.binance.com/zh-CN/square --debug
```

所有直连 API 命令共享的参数：

| 参数 | 含义 |
| --- | --- |
| `--pretty` | 精简视图（id / 作者 / 时间 / stats / url）|
| `--raw` | 完整 `ComposeResponse` 外壳 |
| `--headful` | 显示浏览器窗口（调试用）|
| `--debug` | 向 stderr 打印诊断信息（嗅到的头等）|
| `--lang <code>` | 语言/URL 路径段：`en`（默认）、`zh-CN`、`zh-TW`、`ja`、`ko` ... |

默认输出：`resp.data`（去掉外壳）。

`--lang` 只是改了浏览器打开的 URL `/<lang>/square` —— 嗅到的 `lang` 头会随之进入所有后续 API 调用，币安返回相应语言字段（例如用户标签 `"低频交易者"` vs `"Occasional Trader"`）。服务端或 MCP 这类常驻进程请改用环境变量 `BSQ_LANG=zh-CN`。

## MCP server

Stdio 传输，4 个工具：

| 工具 | 用途 |
| --- | --- |
| `square_feed` | 首页推荐流（支持 `pages` 多页去重、`excludeIds` 跳过已看）|
| `square_user` | 用户资料（`username` 或 `squareUid` 二选一）|
| `square_user_posts` | 按 `squareUid` 分页拉取用户发帖（游标：`timeOffset`）|
| `square_post` | 单帖详情含正文 |

所有工具默认返回精简视图（~1–3KB），方便塞进 LLM context；传 `raw: true` 取完整外壳。

### 启动

```bash
npm run mcp                        # 开发（tsx）
node dist/mcp.js                   # 编译后
BSQ_LANG=zh-CN node dist/mcp.js    # 中文
```

语言在进程级通过 `BSQ_LANG` 设定（默认 `en`），切换语言需要重启 —— 一个进程只服务于一个语言（因为嗅到的头绑定了对应语言的浏览器上下文）。

### 接入 Claude Code / Desktop / Cursor

在 `.mcp.json` 或 `claude_desktop_config.json` 里加：

```json
{
  "mcpServers": {
    "binance-square": {
      "command": "node",
      "args": ["/绝对路径/binance-square-cli/dist/mcp.js"]
    }
  }
}
```

Docker 版：

```json
{
  "mcpServers": {
    "binance-square": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "--entrypoint", "node", "bsq", "dist/mcp.js"]
    }
  }
}
```

服务端会话期间复用同一个长生命周期 `SquareClient` —— Chromium 常驻、指纹头复用。收到 `SIGINT` / `SIGTERM` 时优雅关闭。

## HTTP 服务端

基于 Fastify 薄封装同一个 `SquareClient`，面向其他服务调用。整个进程共享一个浏览器。

```bash
npm run server                         # 开发（tsx）
node dist/server.js                    # 编译后
PORT=8080 node dist/server.js
BSQ_LANG=zh-CN node dist/server.js     # 中文（进程级）
```

无鉴权、无缓存 —— 需要就放在反向代理 / 内网里。语言进程级锁定在 `BSQ_LANG`，多语言场景请起多实例，前面加个路由。

路由（全 GET）：

| 路径 | 参数 |
| --- | --- |
| `/health` | — |
| `/feed` | `page`、`size`、`scene`、`pages`、`excludeIds`（逗号分隔）|
| `/user` | `username` **或** `squareUid` |
| `/user/:squareUid/posts` | `timeOffset`、`filterType` |
| `/post/:id` | — |

输出形态由 query 参数控制：

- 默认：`resp.data`（去掉外壳）
- `?pretty=1`：精简投影（id / 作者 / 时间 / stats / url）
- `?raw=1`：完整 `ComposeResponse` 外壳

示例：

```bash
curl 'http://localhost:3000/feed?pretty=1&pages=3'
curl 'http://localhost:3000/user?username=gzsq1234&pretty=1'
curl 'http://localhost:3000/user/New5jCFqC0D5Opz178dklQ/posts?pretty=1'
curl 'http://localhost:3000/post/303702474979186?pretty=1'
```

## Docker

```bash
docker build -t bsq .

docker run --rm bsq feed --pretty
docker run --rm bsq feed --lang zh-CN --pretty
docker run --rm bsq user gzsq1234 --pretty
docker run --rm -e BSQ_LANG=zh-CN -i --entrypoint node bsq dist/mcp.js              # MCP 模式
docker run --rm -e BSQ_LANG=zh-CN -p 3000:3000 --entrypoint node bsq dist/server.js # REST 服务
```

基础镜像：`mcr.microsoft.com/playwright:v1.48.0-jammy`（预装 Chromium 和 CJK 字体，所以中文内容的序列化/展示正常）。

## 已知接口

| 用途 | Method | Path |
| --- | --- | --- |
| 首页 feed | POST | `/bapi/composite/v9/friendly/pgc/feed/feed-recommend/list` |
| 用户资料 | POST | `/bapi/composite/v3/friendly/pgc/user/client` |
| 用户发帖列表 | GET | `/bapi/composite/v2/friendly/pgc/content/queryUserProfilePageContentsWithFilter` |
| 单帖详情 | GET | `/bapi/composite/v3/friendly/pgc/special/content/detail/{id}` |

全部走长生命周期的 Playwright 页面调用，axios 拦截器的指纹头因此得以保留。

## Schema 注意

- feed 用 `authorName` / `date`（**秒**）/ `cardType`；user-posts 和 post-detail 用 `displayName` / `createTime`（**毫秒**）/ `contentType`。`--pretty` 投影已统一两者。
- 帖子详情的 `body` 是 layout 引擎的 JSON 结构。纯文本请读 `bodyTextOnly`（`--pretty` 已返回）。
- feed 的 `pageSize` 只是建议值 —— 服务端常常固定返回约 21 条（含一条 `KOL_RECOMMEND_GROUP` 广告位）。真正分页要把已看过的每个 `id` 作为 `contentIds` 回传，否则第 2 页会和第 1 页重叠。CLI `--pages N` / MCP `pages` 参数会自动处理；`--exclude-ids` / `excludeIds` 用于手动种子去重集。
- `user-posts` 用 `timeOffset`（毫秒游标）翻页。下一页 = 上一页响应 `data.timeOffset`。

## 目录结构

```
src/
  index.ts      CLI 入口（commander）
  mcp.ts        MCP server（stdio）
  server.ts     HTTP server（Fastify）
  client.ts     SquareClient：浏览器生命周期、头嗅探、post()/get()
  scraper.ts    响应拦截兜底（给还没逆向的接口用）
  browser.ts    Playwright 启动辅助
  pretty.ts     feed/user/post 的精简投影
  commands.ts   CLI 命令实现
Dockerfile
```
