// Two overlapping post shapes exist:
//  - feed-recommend   uses authorName / date(sec) / cardType / subTitle
//  - user-posts /post-detail use displayName / createTime(ms) / contentType / body
// We normalize both here.

interface AnyPost {
  id?: string | number;
  cardType?: string;
  contentType?: number | string;
  authorName?: string;
  displayName?: string;
  username?: string;
  squareAuthorId?: string;
  squareUid?: string;
  title?: string | null;
  subTitle?: string | null;
  body?: string | null;
  bodyTextOnly?: string | null;
  date?: number;
  createTime?: number;
  firstReleaseTime?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  viewCount?: number;
  webLink?: string;
  shareLink?: string;
}

export function prettyFeed(data: unknown): unknown {
  const d = data as { vos?: AnyPost[] } | null;
  return (d?.vos ?? []).map(prettyPost);
}

export function prettyUserPosts(data: unknown): unknown {
  const d = data as { contents?: AnyPost[]; timeOffset?: number; isExistSecondPage?: boolean } | null;
  return {
    timeOffset: d?.timeOffset,
    hasMore: d?.isExistSecondPage,
    posts: (d?.contents ?? []).map(prettyPost),
  };
}

export function prettyPostDetail(data: unknown): unknown {
  const p = data as AnyPost | null;
  if (!p) return null;
  return {
    ...(prettyPost(p) as object),
    body: p.bodyTextOnly ?? p.body ?? null,
  };
}

function prettyPost(p: AnyPost): unknown {
  return {
    id: p.id != null ? String(p.id) : null,
    type: p.cardType ?? String(p.contentType ?? ''),
    author: p.authorName ?? p.displayName ?? p.username ?? null,
    squareUid: p.squareAuthorId ?? p.squareUid ?? null,
    title: p.title ?? p.subTitle ?? null,
    time: formatTime(p),
    stats: {
      like: p.likeCount,
      comment: p.commentCount,
      share: p.shareCount,
      view: p.viewCount,
    },
    url: p.webLink ?? p.shareLink ?? null,
  };
}

function formatTime(p: AnyPost): string | null {
  // date is seconds (feed); createTime/firstReleaseTime are ms (user-posts)
  if (p.createTime) return new Date(p.createTime).toISOString();
  if (p.firstReleaseTime) return new Date(p.firstReleaseTime).toISOString();
  if (p.date) return new Date(p.date * 1000).toISOString();
  return null;
}

interface UserDetail {
  squareUid?: string;
  username?: string;
  displayName?: string;
  biography?: string;
  avatar?: string;
  totalFollowerCount?: number;
  totalFollowCount?: number;
  totalListedPostCount?: number;
  totalLikeCount?: number;
  totalShareCount?: number;
  totalArticleCount?: number;
  createTime?: number;
  accountLang?: string;
  userShareLink?: string;
  userTags?: Array<{ name: string; desc?: string }>;
  holdTokens?: Array<{ code?: string; name?: string }>;
}

export function prettyUser(data: unknown): unknown {
  const u = data as UserDetail | null;
  if (!u) return null;
  return {
    squareUid: u.squareUid,
    username: u.username,
    displayName: u.displayName,
    biography: u.biography,
    avatar: u.avatar,
    lang: u.accountLang,
    createdAt: u.createTime ? new Date(u.createTime).toISOString() : null,
    stats: {
      followers: u.totalFollowerCount,
      following: u.totalFollowCount,
      posts: u.totalListedPostCount,
      articles: u.totalArticleCount,
      likes: u.totalLikeCount,
      shares: u.totalShareCount,
    },
    tags: (u.userTags ?? []).map((t) => t.name),
    holdTokens: (u.holdTokens ?? []).map((t) => t.code),
    shareLink: u.userShareLink,
  };
}
