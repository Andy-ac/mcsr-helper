/**
 * YouTube / Twitch 两个适配器 + 注册表凭据判断的**逐值契约**
 * （spec §5.2 / §5.3 / §5.4 / §5.5 / §9.1 ⑧）。
 *
 * ===========================================================================
 * ★★★ 这个文件里没有一条断言来自**真实的响应**
 * ===========================================================================
 * 本机与本仓**一个凭据都没有**（`MCSR_YOUTUBE_KEY` / `MCSR_TWITCH_ID` /
 * `MCSR_TWITCH_SECRET` 全都没有；spec §2.7 的实测结论说生产上也一样），
 * 所以下面每一个字段名、每一个查询参数都是从**官方文档**抄下来的，
 * 不是从一次真实调用里量出来的。**不许把这个文件读成"端到端验证过了"** ——
 * 带真凭据的验收在 Task 9 的交接清单里，而这个文件只是"我们照文档写对了"的证据。
 *
 * 具体是哪几条（整份都在这一档，逐条点出来免得下一个人再去猜）：
 *   · YouTube：`channels.list` 的 `forHandle` / `contentDetails.relatedPlaylists.uploads`；
 *     `playlistItems.list` 的 `maxResults=50` 上限与 `contentDetails.videoPublishedAt`；
 *     `videos.list` 的 `id=`「逗号分隔、最多 50 个」与 `statistics.viewCount` 是**字符串**；
 *     `nextPageToken` 缺失即没有下一页（§5.4 逐字）；
 *     `liveStreamingDetails.actualEndTime`（这一条的**字段清单**来自
 *     `docs/platform-api-feasibility-notes.md:237-263` 抄下的官方页面原文）。
 *   · Twitch：`oauth2/token` 的 client credentials、`Get Users?login=`、
 *     `Get Videos` 的 `type=archive|highlight|upload` 与 `duration="1h2m3s"`、
 *     `pagination.cursor` 缺失即没有下一页（§5.4 逐字）。
 *   · 唯一一条**量过的**东西是 YouTube 的**报错信封形状**
 *     （`docs/platform-api-feasibility-notes.md:280-286`：无 key 调用实测回 403
 *     `{"error":{"code":403,…,"errors":[{"reason":"forbidden"}]}}`）——
 *     本文件里解析 `reason` 的那条路据此写，但那是**一次 403**，不是一次成功响应。
 *
 * ===========================================================================
 * ★★ 这个文件钉得最紧的两条
 * ===========================================================================
 * 1. **时间戳一律 Unix 秒**（spec §4 那个 ★★ 块）。YouTube 给的是 ISO 8601
 *    （`contentDetails.videoPublishedAt`）、Twitch 给的是 RFC 3339（`created_at`），
 *    两者都要**除以 1000**。写错这一格没有任何异常：`published_at` 只是变成毫秒，
 *    而它是公开列表的排序键 ⇒ 顺序全对、渲染出来是几万年之后。
 *    ⇒ 两条路各自逐值断言，**外加**一条"同一个时刻喂给两个适配器必须得到同一个数"
 *      （两份实现漂了，那一条会红）。
 * 2. **两个平台的"到底了"判据不同**（§5.4 明说"不许写成一个 if"）。⇒ 除了各自的
 *    正反用例，还有一条**交叉喂**的用例：给 YouTube 的响应塞一个 Twitch 风格的
 *    `pagination.cursor`、给 Twitch 的响应塞一个 `nextPageToken`，两个都必须**不认**。
 *
 * ===========================================================================
 * 为什么所有网络都是假的（照 `tracking-bilibili.test.ts` 的理由）
 * ===========================================================================
 * 本仓每一套测试都是离线的。这里不只是"慢"的问题：这两个平台**今天一个凭据都没有**，
 * 真打出去只会得到 401/403，于是测试会变成"断言我们的错误处理"，而不是"断言我们的映射"。
 * ⇒ 所有请求都走 `createYouTubeAdapter({ fetchImpl })` / `createTwitchAdapter({ fetchImpl })`
 *   注入的假实现；Twitch 的 token 过期那条还要注入假时钟（`now`），否则那一支
 *   只能靠真等，也就等于永远没人测。
 *
 * ===========================================================================
 * ⚠️ 一条不该被后来者"顺手优化"的写法：这里的适配器**从不来自 `adapterFor()`
 * ===========================================================================
 * 注册表把适配器**按凭据缓存**（那是 Twitch 的进程内 token 缓存的前提）。于是
 * `adapterFor('twitch')` 在同一个进程里第二次返回的是**第一次那个实例** ——
 * 而第一个实例握着的 `fetchImpl` 是**另一个用例**的假实现。⇒ 凡是需要"发请求并看
 * 请求内容"的用例一律用 `createXAdapter({ fetchImpl })` 自己建实例；
 * `adapterFor()` 只在**注册表**那一组里用，而且只断言类型与身份、**一个请求都不发**。
 */

import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import type { TrackedCreator } from '@mcsr/shared';

import { adapterFor, platformStatus } from './tracking';
import { createTwitchAdapter, TwitchRejectedError } from './tracking/twitch';
import {
  InvalidCreatorInputError,
  NoCredentialsError,
  type PlatformAdapter,
  PlatformHandshakeError,
  PlatformUnavailableError,
} from './tracking/types';
import {
  createYouTubeAdapter,
  UPLOADS_PLAYLIST_META_KEY,
  YOUTUBE_ID_BATCH_MAX,
  YOUTUBE_PAGE_SIZE,
  YouTubeRejectedError,
} from './tracking/youtube';

/*
 * ★ 最后一个用例要跑一次**真的** `runOnce`（它经 `./tracked-videos` 读 SQLite）。
 * ⚠️ `DB_PATH` 必须在 `./db` **第一次被 import 之前** 设好（`getDb()` 用的是 `dbPath()`，
 *    而那个单例一旦建起来就换不掉了）—— 本文件的静态 import 里没有一个碰数据库，
 *    所以这一行就够（`./track` 与 `./tracked-videos` 都是在那个用例里**动态** import 的）。
 */
process.env.DB_PATH = ':memory:';
after(async () => {
  const { closeDb } = await import('./db');
  closeDb();
});

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/** 假的凭据。⚠️ 只用在这种"看着像真的"的位置：它们出现在断言里，所以要好认。 */
const API_KEY = 'AIzaSyFAKE-KEY-0123456789abcdefg';
const TWITCH_ID = 'fake-client-id';
const TWITCH_SECRET = 'fake-client-secret';

const CHANNEL_ID = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';
const UPLOADS_ID = 'UU_x5XG1OV2P6uZZ5FSM9Ttw';
const HANDLE = 'GoogleDevelopers';
const TWITCH_USER_ID = '141981764';
const TWITCH_LOGIN = 'twitchdev';

/**
 * 两个时刻锚点（**秒**）。
 *
 * ⚠️ 它们不是"被测代码算出来的"：下面用的是 `Date.UTC(...) / 1000`，
 *    而适配器走的是 `Date.parse(...) / 1000` —— 两条不同的路算同一个数，
 *    所以这几条断言是**不循环**的。
 *   · `2015-03-06T20:23:34Z` = `Date.UTC(2015, 2, 6, 20, 23, 34)/1000` = 1425673414
 *   · `2018-11-14T21:30:18Z` = `Date.UTC(2018, 10, 14, 21, 30, 18)/1000` = 1542231018
 */
const YT_PUBLISHED_SEC = 1_425_673_414;
const TWITCH_CREATED_SEC = 1_542_231_018;
const YT_PUBLISHED_ISO = '2015-03-06T20:23:34Z';
const TWITCH_CREATED_ISO = '2018-11-14T21:30:18Z';

/** 毫秒与秒的分界。一支 2015 年的视频用毫秒写是 13 位 —— 这条断言就是那个红灯。 */
const SECONDS_CEILING = 10_000_000_000;

/**
 * 同步那条路上的 creator：`TrackedCreator` **加上** `platformMeta`
 * （那是 `tracked-videos.ts` 的 `StoredCreator`，`TrackedCreator` 的超集）。
 */
type SyncCreator = TrackedCreator & { platformMeta?: Record<string, unknown> };

function creator(overrides: Partial<SyncCreator> = {}): SyncCreator {
  return {
    id: 'tc-1',
    platform: 'youtube',
    externalId: CHANNEL_ID,
    handle: `@${HANDLE}`,
    displayName: 'Google Developers',
    avatarUrl: null,
    backfillDone: false,
    lastSyncedAt: null,
    lastError: null,
    consecutiveFailures: 0,
    enabled: true,
    videoCount: 0,
    createdAt: YT_PUBLISHED_SEC,
    // ★ 这一格就是 §5.5 那个缺口的落点：有它，`fetchPage` 才不必每轮重打 channels.list
    platformMeta: { [UPLOADS_PLAYLIST_META_KEY]: UPLOADS_ID },
    ...overrides,
  };
}

/**
 * Twitch 那条路上的 creator：`externalId` 是 **user id**（`Get Videos` 按它查）、
 * 没有 `platformMeta`（Twitch 不需要跨轮记东西，见适配器里那一格）。
 */
function twitchCreator(overrides: Partial<SyncCreator> = {}): SyncCreator {
  return creator({
    platform: 'twitch',
    externalId: TWITCH_USER_ID,
    handle: TWITCH_LOGIN,
    displayName: 'TwitchDev',
    platformMeta: undefined,
    ...overrides,
  });
}

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
  /** 解析好的查询参数（断言里要看的是**解码后**的值）。 */
  params: URLSearchParams;
}

function toCall(input: string | URL | Request, init?: RequestInit): FetchCall {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  return { url, init, params: new URL(url).searchParams };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** 风控/网关拦下来时上游会回一整页 HTML —— 那一种也必须响亮，不许被读成空列表。 */
function htmlResponse(text: string, status = 200): Response {
  return new Response(text, { status, headers: { 'content-type': 'text/html' } });
}

/** 请求头（大小写不敏感 —— HTTP 的头名本来就不区分大小写）。 */
function headerOf(call: FetchCall, name: string): string | null {
  const raw = call.init?.headers;
  if (raw === undefined) return null;
  if (raw instanceof Headers) return raw.get(name);
  const entries: readonly (readonly [string, unknown])[] = Array.isArray(raw)
    ? raw
    : Object.entries(raw);
  const hit = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
  const value = hit?.[1];
  return typeof value === 'string' ? value : null;
}

/** 表单编码的请求体（Twitch 换 token 走的是 POST body，**不是**查询串）。 */
function formBodyOf(call: FetchCall): URLSearchParams {
  const body = call.init?.body;
  return new URLSearchParams(typeof body === 'string' ? body : String(body ?? ''));
}

/**
 * 在一组环境变量下跑一段代码，跑完**原样还原**（没配过的那几个要**删掉**）。
 *
 * ⚠️ 必须还原：`node --test` 是一个文件一个进程，而**同一个文件里的用例共享**这个进程。
 *    忘了还原就是"某些用例单独跑就绿"的那一类问题 —— 而且更糟的是，
 *    它会让后面某个用例在**被改过的环境**里打真网络。
 */
async function withEnv(
  vars: Record<string, string | undefined>,
  run: () => void | Promise<void>,
): Promise<void> {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** 三个凭据环境变量（spec §10 冻结表），一个都没有的那个状态。 */
const NO_CREDENTIALS: Record<string, undefined> = {
  MCSR_YOUTUBE_KEY: undefined,
  MCSR_TWITCH_ID: undefined,
  MCSR_TWITCH_SECRET: undefined,
};

// ---------------------------------------------------------------------------
// YouTube 夹具与假 fetch
// ---------------------------------------------------------------------------

const CHANNEL_ITEM: Record<string, unknown> = {
  kind: 'youtube#channel',
  id: CHANNEL_ID,
  snippet: {
    title: 'Google Developers',
    customUrl: `@${HANDLE}`,
    thumbnails: {
      default: { url: 'https://yt3.ggpht.com/ytc/default.jpg' },
      medium: { url: 'https://yt3.ggpht.com/ytc/medium.jpg' },
      high: { url: 'https://yt3.ggpht.com/ytc/high.jpg' },
    },
  },
  contentDetails: { relatedPlaylists: { likes: 'LL_x5XG1OV2P6uZZ5FSM9Ttw', uploads: UPLOADS_ID } },
};

/** `playlistItems.list` 的一条。⚠️ 它**不带**时长与播放量（那正是第二次批量调用的理由）。 */
function playlistItem(
  videoId: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: 'youtube#playlistItem',
    id: `UExf${videoId}`,
    snippet: {
      publishedAt: YT_PUBLISHED_ISO,
      channelId: CHANNEL_ID,
      title: `${videoId} 的标题`,
      thumbnails: { medium: { url: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` } },
      playlistId: UPLOADS_ID,
      position: 0,
      resourceId: { kind: 'youtube#video', videoId },
    },
    contentDetails: { videoId, videoPublishedAt: YT_PUBLISHED_ISO },
    ...over,
  };
}

/** `videos.list` 的一条（时长与播放量只有这里有）。 */
function videoDetail(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'youtube#video',
    id,
    contentDetails: { duration: 'PT1H2M3S' },
    statistics: { viewCount: '59997', likeCount: '1200', commentCount: '1198' },
    ...over,
  };
}

function playlistPage(items: unknown[], nextPageToken?: string): Record<string, unknown> {
  return {
    kind: 'youtube#playlistItemListResponse',
    pageInfo: { totalResults: items.length, resultsPerPage: YOUTUBE_PAGE_SIZE },
    items,
    ...(nextPageToken === undefined ? {} : { nextPageToken }),
  };
}

type YouTubeRoute = 'channels' | 'playlistItems' | 'videos';

interface YouTubeHarness {
  adapter: PlatformAdapter;
  calls: FetchCall[];
  /** 只数某一条路由上的请求。 */
  route: (name: YouTubeRoute) => FetchCall[];
}

/**
 * 一个假的 YouTube：默认有频道、有两支视频、详情齐全；要改哪一条就传哪一条的处理器。
 */
function youTube(
  handlers: Partial<
    Record<YouTubeRoute, (call: FetchCall, index: number) => Response | Promise<Response>>
  > = {},
): YouTubeHarness {
  const calls: FetchCall[] = [];
  const prefix = '/youtube/v3/';

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = toCall(input, init);
    calls.push(call);

    const at = call.url.indexOf(prefix);
    const path = (at < 0 ? '' : (call.url.slice(at + prefix.length).split('?')[0] ?? '')) as
      | YouTubeRoute
      | '';
    const handler = handlers[path as YouTubeRoute];
    if (handler) {
      const index = calls.filter((other) => other.url.includes(`${prefix}${path}`)).length - 1;
      return handler(call, index);
    }

    if (path === 'channels')
      return jsonResponse({ kind: 'youtube#channelListResponse', items: [CHANNEL_ITEM] });
    if (path === 'playlistItems') {
      return jsonResponse(playlistPage([playlistItem('vid-A'), playlistItem('vid-B')]));
    }
    if (path === 'videos') {
      const ids = (call.params.get('id') ?? '').split(',').filter(Boolean);
      return jsonResponse({
        kind: 'youtube#videoListResponse',
        items: ids.map((id) => videoDetail(id)),
      });
    }
    return jsonResponse({ error: { message: `假的 fetch 不认识这条路由：${path}` } }, 404);
  }) as typeof fetch;

  return {
    adapter: createYouTubeAdapter({ apiKey: API_KEY, fetchImpl }),
    calls,
    route: (name) => calls.filter((call) => call.url.includes(`${prefix}${name}`)),
  };
}

// ---------------------------------------------------------------------------
// Twitch 夹具与假 fetch
// ---------------------------------------------------------------------------

const TWITCH_USER: Record<string, unknown> = {
  id: TWITCH_USER_ID,
  login: TWITCH_LOGIN,
  display_name: 'TwitchDev',
  type: '',
  broadcaster_type: 'partner',
  description: '与 spec 无关的简介',
  profile_image_url: 'https://static-cdn.jtvnw.net/jtv_user_pictures/twitchdev-300x300.png',
  offline_image_url: '',
  view_count: 0,
  created_at: '2016-12-14T20:32:28Z',
};

/** `Get Videos` 的一条。⚠️ `thumbnail_url` 是**模板**（文档里就带着占位符）。 */
function twitchVideo(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '335921245',
    stream_id: '321186304704',
    user_id: TWITCH_USER_ID,
    user_login: TWITCH_LOGIN,
    user_name: 'TwitchDev',
    title: 'Twitch Developers 101',
    description: '与 spec 无关的简介',
    created_at: TWITCH_CREATED_ISO,
    published_at: TWITCH_CREATED_ISO,
    url: 'https://www.twitch.tv/videos/335921245',
    thumbnail_url:
      'https://static-cdn.jtvnw.net/cf_vods/d2nvs31859zcd8/abcdef/thumb%{width}x%{height}.jpg',
    viewable: 'public',
    view_count: 1_863_062,
    language: 'en',
    type: 'archive',
    duration: '1h2m3s',
    muted_segments: null,
    ...over,
  };
}

type TwitchRoute = 'token' | 'users' | 'videos';

interface TwitchHarness {
  adapter: PlatformAdapter;
  calls: FetchCall[];
  route: (name: TwitchRoute) => FetchCall[];
}

function twitch(
  handlers: Partial<
    Record<TwitchRoute, (call: FetchCall, index: number) => Response | Promise<Response>>
  > = {},
  now: () => number = () => 1_788_600_000_000,
): TwitchHarness {
  const calls: FetchCall[] = [];

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = toCall(input, init);
    calls.push(call);

    const path: TwitchRoute | '' = call.url.includes('/oauth2/token')
      ? 'token'
      : call.url.includes('/helix/users')
        ? 'users'
        : call.url.includes('/helix/videos')
          ? 'videos'
          : '';
    const handler = handlers[path as TwitchRoute];
    if (handler) {
      const index = calls.filter((other) => routeOf(other.url) === path).length - 1;
      return handler(call, index);
    }

    if (path === 'token') {
      return jsonResponse({
        access_token: 'app-token-1',
        expires_in: 5_011_271,
        token_type: 'bearer',
      });
    }
    if (path === 'users') return jsonResponse({ data: [TWITCH_USER] });
    if (path === 'videos') {
      return jsonResponse({ data: [twitchVideo()], pagination: {} });
    }
    return jsonResponse(
      { error: 'Not Found', status: 404, message: `假 fetch 不认识：${path}` },
      404,
    );
  }) as typeof fetch;

  return {
    adapter: createTwitchAdapter({
      clientId: TWITCH_ID,
      clientSecret: TWITCH_SECRET,
      fetchImpl,
      now,
    }),
    calls,
    route: (name) => calls.filter((call) => routeOf(call.url) === name),
  };
}

function routeOf(url: string): TwitchRoute | '' {
  if (url.includes('/oauth2/token')) return 'token';
  if (url.includes('/helix/users')) return 'users';
  if (url.includes('/helix/videos')) return 'videos';
  return '';
}

// ---------------------------------------------------------------------------
// ★★ YouTube
// ---------------------------------------------------------------------------

describe('★ YouTube 适配器（spec §5.2 / §5.4 / §5.5）', () => {
  describe('resolveCreator：一次 channels.list 拿齐 channelId + uploads + 名字', () => {
    it('★★ @handle ⇒ forHandle=@handle，upload 播放列表 ID 落进 platformMeta', async () => {
      const h = youTube();
      const ref = await h.adapter.resolveCreator(`@${HANDLE}`);

      const call = h.route('channels')[0];
      assert.ok(call, '必须打一次 channels.list');
      assert.equal(call.params.get('forHandle'), `@${HANDLE}`, '文档：forHandle 吃 @handle');
      assert.equal(
        call.params.get('part'),
        'snippet,contentDetails',
        'snippet 给名字与头像，contentDetails 给 uploads',
      );
      assert.equal(call.params.get('key'), API_KEY);
      assert.equal(call.params.get('id'), null, 'forHandle 与 id 是**两选一**，不许两个都发');

      assert.equal(ref.platform, 'youtube');
      assert.equal(ref.externalId, CHANNEL_ID, '§4.1：external_id 存 channelId');
      assert.equal(ref.handle, `@${HANDLE}`, '可读标识是 customUrl');
      assert.equal(ref.displayName, 'Google Developers', 'displayName 是频道的 title');
      assert.equal(ref.avatarUrl, 'https://yt3.ggpht.com/ytc/medium.jpg');

      /*
       * ★★ 这条断言是 §5.5 那个缺口的**唯一**证据：uploads 播放列表 ID 必须跟着
       *    CreatorRef 一起交出去（`createCreator` 落进 platform_meta），
       *    否则同步时只能每轮重打一次 channels.list —— 白烧配额，而且烧得静悄悄。
       */
      assert.deepEqual(
        ref.platformMeta,
        { [UPLOADS_PLAYLIST_META_KEY]: UPLOADS_ID },
        'uploads 播放列表 ID 必须进 platformMeta（键名与 tracking-store.test.ts 那一份一致）',
      );
      assert.equal(h.calls.length, 1, '加一个博主只打一次上游');
    });

    it('频道链接与裸 channelId 都认（走 id=），且不额外发请求', async () => {
      for (const input of [
        `https://www.youtube.com/channel/${CHANNEL_ID}`,
        `youtube.com/channel/${CHANNEL_ID}`,
        CHANNEL_ID,
      ]) {
        const h = youTube();
        const ref = await h.adapter.resolveCreator(input);
        assert.equal(ref.externalId, CHANNEL_ID, input);
        assert.equal(h.route('channels')[0]?.params.get('id'), CHANNEL_ID, input);
        assert.equal(h.route('channels')[0]?.params.get('forHandle'), null, input);
        assert.equal(h.calls.length, 1, `${input}：解析这条路不发第二个请求`);
      }
    });

    it('@handle 形式的频道链接也认（forHandle）', async () => {
      const h = youTube();
      const ref = await h.adapter.resolveCreator(`https://www.youtube.com/@${HANDLE}/videos`);
      assert.equal(ref.externalId, CHANNEL_ID);
      assert.equal(h.route('channels')[0]?.params.get('forHandle'), `@${HANDLE}`);
    });

    it('youtu.be/<videoId> 这类"视频链接"认不出 ⇒ InvalidCreatorInputError，且一个请求都不发', async () => {
      const h = youTube();
      for (const input of [
        'https://youtu.be/dQw4w9WgXcQ',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        '随便写的',
        '',
        '   ',
      ]) {
        await assert.rejects(
          () => h.adapter.resolveCreator(input),
          InvalidCreatorInputError,
          `"${input}" 不该被认成一个频道`,
        );
      }
      assert.equal(h.calls.length, 0, '认不出来就一个请求都不发（那条路是要花配额的）');
    });

    it('items 为空（这个 handle 不存在）⇒ InvalidCreatorInputError（400，不是 502）', async () => {
      const h = youTube({ channels: () => jsonResponse({ items: [] }) });
      await assert.rejects(
        () => h.adapter.resolveCreator(`@${HANDLE}`),
        (error: unknown) => {
          assert.ok(error instanceof InvalidCreatorInputError, '这是入参的问题，要管理员改链接');
          assert.equal(error.platform, 'youtube');
          return true;
        },
      );
    });

    it('★ 上游改了形状（没有 relatedPlaylists.uploads）⇒ 平台级失败，不是静默回一个空 ID', async () => {
      const h = youTube({
        channels: () =>
          jsonResponse({
            items: [{ ...CHANNEL_ITEM, contentDetails: { relatedPlaylists: { likes: 'LL-x' } } }],
          }),
      });
      await assert.rejects(() => h.adapter.resolveCreator(`@${HANDLE}`), PlatformHandshakeError);
    });

    it('★ resolveCreator 的失败只有三种类型 —— 它们都在路由那张表里（不是我们的 bug）', async () => {
      /*
       * ⚠️ 这条钉的是一个**跨任务的约束**：`POST /creators` 的失败按**类型**分派
       *    （`routes/tracking.ts` 的七行表），表外的一律 `throw` → 500"我们的 bug"。
       *    所以 resolveCreator 只许抛 InvalidCreatorInputError（400）/ PlatformHandshakeError
       *    （502）/ PlatformUnavailableError（502）这三种。
       *    ⚠️ fetchPage 那条路没有这个约束：它只被 CLI 的 catch 接住，进 `last_error`。
       */
      const cases: ReadonlyArray<{ name: string; response: Response; expected: unknown }> = [
        {
          name: 'HTTP 400（我们的请求不合法）',
          response: jsonResponse({ error: { code: 400, message: 'bad request' } }, 400),
          expected: PlatformHandshakeError,
        },
        {
          name: 'HTTP 403 keyInvalid（凭据不被接受）',
          response: jsonResponse(
            {
              error: {
                code: 403,
                message: 'API key not valid. Please pass a valid API key.',
                errors: [{ reason: 'keyInvalid' }],
              },
            },
            403,
          ),
          expected: PlatformHandshakeError,
        },
        {
          name: 'HTTP 404',
          response: jsonResponse({ error: { code: 404, message: 'not found' } }, 404),
          expected: PlatformHandshakeError,
        },
        {
          name: 'HTTP 429（配额/限流）',
          response: jsonResponse({ error: { code: 429, message: 'rate limit' } }, 429),
          expected: PlatformUnavailableError,
        },
        {
          name: 'HTTP 500',
          response: jsonResponse({ error: { code: 500, message: 'backend error' } }, 500),
          expected: PlatformUnavailableError,
        },
        {
          name: '一整页 HTML（网关拦下来的）',
          response: htmlResponse('<html>oops</html>'),
          expected: PlatformHandshakeError,
        },
      ];

      for (const item of cases) {
        const h = youTube({ channels: () => item.response });
        await assert.rejects(
          () => h.adapter.resolveCreator(`@${HANDLE}`),
          item.expected as new () => Error,
          item.name,
        );
      }
    });

    it('连不上上游（fetch 被拒）⇒ PlatformUnavailableError，而不是 TypeError', async () => {
      const adapter = createYouTubeAdapter({
        apiKey: API_KEY,
        fetchImpl: (async () => {
          throw new TypeError('fetch failed');
        }) as typeof fetch,
      });
      await assert.rejects(
        () => adapter.resolveCreator(`@${HANDLE}`),
        (error: unknown) => {
          assert.ok(
            error instanceof PlatformUnavailableError,
            '归属是"联系不上上游"，不是我们的 bug',
          );
          assert.equal(error.step, 'channels.list');
          return true;
        },
      );
    });
  });

  describe('fetchPage：playlistItems + 一批 videos.list 补时长与播放量', () => {
    it('★★ uploads 播放列表 ID 从 creator 上读回来 —— 一个 channels.list 都不发', async () => {
      const h = youTube();
      const page = await h.adapter.fetchPage(creator(), null, { storedTotal: 0 });

      assert.equal(h.route('channels').length, 0, '★ 这条就是 §5.5 省下来的那次请求');
      const call = h.route('playlistItems')[0];
      assert.ok(call, '要先翻 uploads 播放列表');
      assert.equal(call.params.get('playlistId'), UPLOADS_ID);
      assert.equal(call.params.get('maxResults'), String(YOUTUBE_PAGE_SIZE));
      assert.equal(call.params.get('part'), 'snippet,contentDetails');
      assert.equal(call.params.get('pageToken'), null, '首轮没有游标 ⇒ 不许送一个空的 pageToken');

      assert.equal(page.videos.length, 2);
      assert.equal(
        page.videos[0]?.externalId,
        'vid-A',
        '顺序照 playlistItems 给的（它本身就是新→旧）',
      );
    });

    it('★★ creator 上没有 uploadsPlaylistId ⇒ 响亮失败，而且**仍然不补** channels.list', async () => {
      const h = youTube();
      await assert.rejects(
        () => h.adapter.fetchPage(creator({ platformMeta: {} }), null, { storedTotal: 0 }),
        (error: unknown) => {
          assert.ok(
            error instanceof YouTubeRejectedError,
            '是这一个 creator 的事，不是整个平台的事',
          );
          assert.match(error.message, /uploadsPlaylistId/, '那句日志要说清楚缺的是哪一格');
          return true;
        },
      );
      assert.equal(
        h.calls.length,
        0,
        '★ 一个请求都不许发：补一次 channels.list 正是 §5.5 想省掉的那一次',
      );
    });

    it('★ videos.list 的 id 是**逗号分隔**的', async () => {
      const h = youTube();
      await h.adapter.fetchPage(creator(), null, { storedTotal: 0 });
      const call = h.route('videos')[0];
      assert.ok(call);
      assert.equal(call.params.get('id'), 'vid-A,vid-B');
      assert.equal(
        call.params.get('part'),
        'contentDetails,statistics,liveStreamingDetails',
        '时长/播放量/评论数在 contentDetails+statistics；liveReplay 的判据在 liveStreamingDetails',
      );
    });

    it('★★ 每批最多 50 个 id：51 条 ⇒ 两次调用（50 + 1）', async () => {
      assert.equal(YOUTUBE_ID_BATCH_MAX, 50, '文档硬上限：videos.list 的 id 最多 50 个');
      assert.equal(YOUTUBE_PAGE_SIZE, 50, '文档：playlistItems 的 maxResults 上限是 50');

      const ids = Array.from({ length: 51 }, (_, index) => `vid-${String(index).padStart(3, '0')}`);
      const h = youTube({
        playlistItems: () => jsonResponse(playlistPage(ids.map((id) => playlistItem(id)))),
      });
      const page = await h.adapter.fetchPage(creator(), null, { storedTotal: 0 });

      const batches = h.route('videos').map((call) => (call.params.get('id') ?? '').split(','));
      assert.equal(batches.length, 2, '51 个 id 必须**分批**，一次全部塞进去上游会 400');
      assert.equal(batches[0]?.length, 50);
      assert.equal(batches[1]?.length, 1);
      for (const batch of batches) {
        assert.ok(
          batch.length <= YOUTUBE_ID_BATCH_MAX,
          `一批 ${String(batch.length)} 个 id —— 超了 50 上游会回 400「more than 50 IDs」`,
        );
      }
      assert.equal(page.videos.length, 51, '分批不影响条数：51 条进、51 条出');
      assert.equal(h.route('channels').length, 0);
    });

    it('★ 批量详情**按 id 合并**，不按顺序 —— 上游乱序返回也绑不错', async () => {
      const h = youTube({
        videos: (call) => {
          const ids = (call.params.get('id') ?? '').split(',').filter(Boolean);
          // 故意倒着回，而且每条的时长各不相同 —— 按下标合并的实现会在这里把两支视频的时长对调
          return jsonResponse({
            items: [...ids].reverse().map((id, index) =>
              videoDetail(id, {
                contentDetails: { duration: `PT${String(index + 1)}M` },
                statistics: { viewCount: String(1000 + index) },
              }),
            ),
          });
        },
      });
      const page = await h.adapter.fetchPage(creator(), null, { storedTotal: 0 });

      assert.equal(page.videos[0]?.externalId, 'vid-A');
      assert.equal(page.videos[0]?.durationSec, 120, 'vid-A 的详情是 PT1M（倒序回来的第 2 条）');
      assert.equal(page.videos[0]?.viewCount, 1001);
      assert.equal(page.videos[1]?.externalId, 'vid-B');
      assert.equal(page.videos[1]?.durationSec, 60, 'vid-B 的详情是 PT1M… 第 1 条');
      assert.equal(page.videos[1]?.viewCount, 1000);
    });

    it('★ 六个字段各自的来源；详情缺席 ⇒ NULL，绝不是 0', async () => {
      const h = youTube({
        playlistItems: () =>
          jsonResponse(
            playlistPage([
              playlistItem('vid-A'),
              // 这一支在 videos.list 里**没有**对应条目（下架/私享）—— 上游就是这么表现的
              playlistItem('vid-gone'),
            ]),
          ),
        videos: () =>
          jsonResponse({
            items: [
              {
                kind: 'youtube#video',
                id: 'vid-A',
                contentDetails: { duration: 'PT45S' },
                statistics: { viewCount: '0', commentCount: '0' },
              },
            ],
          }),
      });
      const page = await h.adapter.fetchPage(creator(), null, { storedTotal: 0 });

      const first = page.videos[0];
      assert.equal(first?.title, 'vid-A 的标题');
      assert.equal(first?.thumbnailUrl, 'https://i.ytimg.com/vi/vid-A/mqdefault.jpg');
      assert.equal(first?.durationSec, 45);
      // ⚠️ `"0"` 是一条**真实的量测**，必须原样留下 0（"没人看"与"没给"是两件事）
      assert.equal(first?.viewCount, 0);
      assert.equal(first?.commentCount, 0);
      assert.equal(first?.isLiveReplay, false);

      const second = page.videos[1];
      assert.equal(second?.externalId, 'vid-gone', '拿不到详情也要存下来（不能静默少一支）');
      assert.equal(second?.durationSec, null, '拿不到 ⇒ NULL（填 0 会让 deriveTags 打上 short）');
      assert.equal(second?.viewCount, null);
      assert.equal(second?.commentCount, null);
    });

    it('★★ publishedAt 是 Unix **秒**（videoPublishedAt，且毫秒写法会差一千倍）', async () => {
      const h = youTube();
      const page = await h.adapter.fetchPage(creator(), null, { storedTotal: 0 });

      const publishedAt = page.videos[0]?.publishedAt;
      assert.equal(publishedAt, YT_PUBLISHED_SEC, '2015-03-06T20:23:34Z ⇒ 1425673414（秒）');
      assert.ok(
        typeof publishedAt === 'number' && publishedAt < SECONDS_CEILING,
        '毫秒的写法是 13 位 —— 这一格是排序键，写错只会让顺序看起来全对',
      );
    });

    it('videoPublishedAt 缺席 ⇒ 回落 snippet.publishedAt；两个都没有 ⇒ null', async () => {
      const h = youTube({
        playlistItems: () =>
          jsonResponse(
            playlistPage([
              // 回落：只有 snippet.publishedAt（"加进播放列表的时间"）
              {
                ...playlistItem('vid-A'),
                snippet: {
                  ...(playlistItem('vid-A').snippet as Record<string, unknown>),
                  publishedAt: TWITCH_CREATED_ISO,
                },
                contentDetails: { videoId: 'vid-A' },
              },
              // 两个都没有
              {
                ...playlistItem('vid-B'),
                snippet: {
                  ...(playlistItem('vid-B').snippet as Record<string, unknown>),
                  publishedAt: null,
                },
                contentDetails: { videoId: 'vid-B' },
              },
            ]),
          ),
        videos: () => jsonResponse({ items: [] }),
      });

      const page = await h.adapter.fetchPage(creator(), null, { storedTotal: 0 });
      assert.equal(page.videos[0]?.publishedAt, TWITCH_CREATED_SEC);
      assert.equal(
        page.videos[1]?.publishedAt,
        null,
        '拿不到 ⇒ NULL —— 不许填 0（1970 看起来像真数据）',
      );
    });

    it('★ 只认**带时区**的时间戳（无时区的写法会被当成当地时间，静默偏一个小时区）', async () => {
      /*
       * ⚠️ 两个来源**一起**喂同一个值：只改 `videoPublishedAt` 的话，坏值会被
       *    `snippet.publishedAt` 那道回落救回来（那是**想要**的行为，见上一条），
       *    于是这一组就测不到解析规则本身了 —— 这一条差点就这么写了。
       */
      const iso = (value: unknown) => ({
        ...playlistItem('vid-A'),
        snippet: {
          ...(playlistItem('vid-A').snippet as Record<string, unknown>),
          publishedAt: value,
        },
        contentDetails: { videoId: 'vid-A', videoPublishedAt: value },
      });
      const read = async (value: unknown) => {
        const h = youTube({
          playlistItems: () => jsonResponse(playlistPage([iso(value)])),
          videos: () => jsonResponse({ items: [] }),
        });
        const page = await h.adapter.fetchPage(creator(), null, { storedTotal: 0 });
        return page.videos[0]?.publishedAt;
      };

      assert.equal(await read('2015-03-06T20:23:34Z'), YT_PUBLISHED_SEC);
      assert.equal(await read('2015-03-06T20:23:34+00:00'), YT_PUBLISHED_SEC, '显式 +00:00 也认');
      assert.equal(
        await read('2015-03-06T22:23:34+02:00'),
        YT_PUBLISHED_SEC,
        '带偏移的写法要换算到 UTC，而不是照字面读',
      );
      assert.equal(await read('2015-03-06T20:23:34'), null, '★ 没有时区 ⇒ null（不当成本地时间）');
      assert.equal(
        await read('1970-01-01T00:00:00Z'),
        null,
        '0 是"没量到"，不是 1970 年的一支视频',
      );
      assert.equal(await read('这不是时间'), null);
      assert.equal(await read(12345), null, '上游给了数字（形状变了）⇒ 没有值，不是猜一个');
    });

    it('liveStreamingDetails.actualEndTime ⇒ isLiveReplay；还在直播的（没有 actualEndTime）不算', async () => {
      const h = youTube({
        playlistItems: () =>
          jsonResponse(
            playlistPage([
              playlistItem('vid-done'),
              playlistItem('vid-live'),
              playlistItem('vid-plain'),
            ]),
          ),
        videos: () =>
          jsonResponse({
            items: [
              // 已经结束的直播 = 一场"存档"（Twitch 那边 type='archive' 的同类）
              videoDetail('vid-done', {
                liveStreamingDetails: {
                  actualStartTime: '2015-03-06T19:00:00Z',
                  actualEndTime: '2015-03-06T20:00:00Z',
                },
              }),
              // 正在直播：有 start 没有 end ⇒ 还不是"回放"
              videoDetail('vid-live', {
                liveStreamingDetails: { actualStartTime: '2015-03-06T20:20:00Z' },
              }),
              videoDetail('vid-plain'),
            ],
          }),
      });
      const page = await h.adapter.fetchPage(creator(), null, { storedTotal: 0 });

      assert.equal(page.videos[0]?.isLiveReplay, true, '结束了的直播 ⇒ liveReplay');
      assert.equal(
        page.videos[1]?.isLiveReplay,
        false,
        '正在直播 ⇒ 不是回放（upsert 结束后会改回来）',
      );
      assert.equal(page.videos[2]?.isLiveReplay, false, '普通投稿');
    });

    it('★ 单条坏了（没有 videoId / 没有 title）⇒ 抛，不跳过也不写空 id', async () => {
      /*
       * ⚠️ 与 bilibili 那一条同一个理由：`externalId` 是 `UNIQUE (platform, external_id)`
       *    的一半（空串会让下面每一支视频覆盖同一行），而 `title` 在库里是 NOT NULL。
       *    "跳过这一条"则是**静默少一支视频**。
       */
      const broken = youTube({
        playlistItems: () =>
          jsonResponse(
            playlistPage([{ ...playlistItem('vid-A'), contentDetails: { videoId: null } }]),
          ),
      });
      await assert.rejects(
        () => broken.adapter.fetchPage(creator(), null, { storedTotal: 0 }),
        YouTubeRejectedError,
      );

      const noTitle = youTube({
        playlistItems: () =>
          jsonResponse(
            playlistPage([
              {
                ...playlistItem('vid-A'),
                snippet: {
                  ...(playlistItem('vid-A').snippet as Record<string, unknown>),
                  title: 42,
                },
              },
            ]),
          ),
      });
      await assert.rejects(
        () => noTitle.adapter.fetchPage(creator(), null, { storedTotal: 0 }),
        YouTubeRejectedError,
      );
    });

    it('★ 报错里不许出现 API key（它会进 last_error，而那一格管理面板看得见）', async () => {
      const failures: ReadonlyArray<Response> = [
        jsonResponse({ error: { code: 500, message: 'backend error' } }, 500),
        htmlResponse('<html>oops</html>'),
        jsonResponse({ error: { code: 403, message: 'quota' } }, 403),
      ];
      for (const response of failures) {
        const h = youTube({ playlistItems: () => response });
        await assert.rejects(
          () => h.adapter.fetchPage(creator(), null, { storedTotal: 0 }),
          (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            assert.ok(
              !message.includes(API_KEY),
              `错误信息里带着 API key（它会原样进 last_error 与 journal）：${message}`,
            );
            return true;
          },
        );
      }
    });

    it('★ §5.4：nextPageToken 缺失 ⇒ 到底了；在 ⇒ 游标就是它', async () => {
      const last = youTube({
        playlistItems: () => jsonResponse(playlistPage([playlistItem('vid-A')])),
      });
      const endPage = await last.adapter.fetchPage(creator(), null, { storedTotal: 0 });
      assert.equal(endPage.reachedEnd, true, '没有 nextPageToken 就是最后一页');
      assert.equal(endPage.nextCursor, null);

      const more = youTube({
        playlistItems: () =>
          jsonResponse(playlistPage([playlistItem('vid-A'), playlistItem('vid-B')], 'CAEQAA')),
      });
      const nextPage = await more.adapter.fetchPage(creator(), null, { storedTotal: 0 });
      assert.equal(nextPage.reachedEnd, false);
      assert.equal(nextPage.nextCursor, 'CAEQAA');

      // 而且第二次请求要把它当 pageToken 送回去
      const second = await more.adapter.fetchPage(creator(), 'CAEQAA', { storedTotal: 2 });
      assert.equal(second.videos.length, 2);
      assert.equal(more.route('playlistItems')[1]?.params.get('pageToken'), 'CAEQAA');
    });

    it('★★ §5.4：YouTube 空页**不是**"到底了" —— 判据是 token，不是空', async () => {
      /*
       * ⚠️ 这条是 bilibili 那个坑（§2.4）在 YouTube 上的**反面**：
       *    那边"空列表"会被误读成到底（因为它的判据是别的），这边若是顺手写成
       *    `items.length === 0 ⇒ reachedEnd`，就会在"上游回了个空页但还有下一页"时
       *    **静默少存**。⇒ 空页 + 有 token = 没到底，而且一个 videos.list 都不该发。
       */
      const more = youTube({
        playlistItems: () => jsonResponse(playlistPage([], 'CAEQAA')),
      });
      const page = await more.adapter.fetchPage(creator(), null, { storedTotal: 0 });
      assert.deepEqual(page.videos, []);
      assert.equal(page.reachedEnd, false, '有 nextPageToken ⇒ 还没到底，哪怕这一页是空的');
      assert.equal(page.nextCursor, 'CAEQAA');
      assert.equal(
        more.route('videos').length,
        0,
        '一条 id 都没有 ⇒ 不发那次批量调用（省一次配额）',
      );

      const done = youTube({ playlistItems: () => jsonResponse(playlistPage([])) });
      const endPage = await done.adapter.fetchPage(creator(), null, { storedTotal: 0 });
      assert.equal(endPage.reachedEnd, true, '空页 + 没有 token 才是真的到底');
      assert.equal(done.route('videos').length, 0);
    });

    it('★★ §5.4：YouTube 只认 nextPageToken —— 喂一个 Twitch 风格的 pagination.cursor 不算数', async () => {
      /*
       * 三个平台的"到底了"语义**各不相同**（§5.4："不许写成一个 if"）。
       * 这条交叉用例就是为了让"把两家的判据抄串了"当场变红：
       * 响应里有一个 `pagination.cursor`（Twitch 的判据），而 YouTube 必须**当没看见**。
       */
      const h = youTube({
        playlistItems: () =>
          jsonResponse({
            ...playlistPage([playlistItem('vid-A')]),
            pagination: { cursor: 'twitch-style-cursor' },
          }),
      });
      const page = await h.adapter.fetchPage(creator(), null, { storedTotal: 0 });
      assert.equal(page.reachedEnd, true, 'nextPageToken 不在 ⇒ 到底了，哪怕有个 Twitch 的游标在');
      assert.equal(page.nextCursor, null);
    });
  });
});

// ---------------------------------------------------------------------------
// ★★ Twitch
// ---------------------------------------------------------------------------

describe('★ Twitch 适配器（spec §5.3 / §5.4）', () => {
  describe('app access token（client credentials，进程内缓存）', () => {
    it('★ 换 token：POST + 表单体里的三样，且 key/secret **不在 URL 上**', async () => {
      const h = twitch();
      await h.adapter.resolveCreator(`twitch.tv/${TWITCH_LOGIN}`);

      const call = h.route('token')[0];
      assert.ok(call, 'helix 之前必须先拿 app access token');
      assert.equal(call.url, 'https://id.twitch.tv/oauth2/token');
      assert.equal(
        call.params.toString(),
        '',
        '客户端密钥不许出现在 URL 上（URL 会进日志、代理与错误信息）',
      );
      const form = formBodyOf(call);
      assert.equal(form.get('client_id'), TWITCH_ID);
      assert.equal(form.get('client_secret'), TWITCH_SECRET);
      assert.equal(form.get('grant_type'), 'client_credentials');
      assert.equal(call.init?.method, 'POST');

      // helix 那边带的是 token，不是密钥
      const users = h.route('users')[0];
      assert.equal(headerOf(users ?? call, 'Authorization'), 'Bearer app-token-1');
      assert.equal(headerOf(users ?? call, 'Client-Id'), TWITCH_ID);
    });

    it('★★ token 在**实例内**缓存：两次 fetchPage 只换一次 token', async () => {
      const h = twitch({
        videos: (_call, index) =>
          jsonResponse({
            data: [twitchVideo({ id: `vid-${String(index)}` })],
            pagination: {},
          }),
      });
      await h.adapter.fetchPage(twitchCreator(), null, { storedTotal: 0 });
      await h.adapter.fetchPage(twitchCreator(), null, { storedTotal: 1 });

      assert.equal(h.route('videos').length, 2);
      assert.equal(
        h.route('token').length,
        1,
        '★ 每个 creator 都换一次 token 就是每轮多打 N 次上游（§5.3 要的是进程内缓存）',
      );
    });

    it('★ token 过期（expires_in 之后）⇒ 再换一次', async () => {
      let nowMs = 1_788_600_000_000;
      const h = twitch(
        {
          token: (_call, index) =>
            jsonResponse({
              access_token: `app-token-${String(index + 1)}`,
              expires_in: 3600,
              token_type: 'bearer',
            }),
        },
        () => nowMs,
      );
      await h.adapter.fetchPage(twitchCreator(), null, { storedTotal: 0 });
      assert.equal(h.route('token').length, 1);

      // 一小时之后（expires_in=3600 ⇒ 正好过期）
      nowMs += 3_600_000;
      await h.adapter.fetchPage(twitchCreator(), null, { storedTotal: 1 });
      assert.equal(h.route('token').length, 2, '过期了要换新的，不能一直拿着旧 token 去撞 401');
      assert.equal(
        headerOf(h.route('videos')[1] ?? h.calls[0]!, 'Authorization'),
        'Bearer app-token-2',
      );
    });

    it('★ token 那一步失败 ⇒ PlatformHandshakeError（本轮放弃这个平台），且一个 helix 请求都不发', async () => {
      for (const response of [
        jsonResponse({ status: 400, message: 'invalid client secret' }, 400),
        jsonResponse({ status: 403, message: 'invalid client' }, 403),
        htmlResponse('<html>oops</html>'),
      ]) {
        const h = twitch({ token: () => response });
        await assert.rejects(
          () => h.adapter.resolveCreator(`twitch.tv/${TWITCH_LOGIN}`),
          PlatformHandshakeError,
        );
        assert.equal(
          h.route('users').length,
          0,
          '拿不到 token 就别接着打：那正是"不能带着空 cookie 继续打"（§5.1）的同一条',
        );
      }
    });

    it('★ 换 token 的失败也**不许**把 client secret 写进错误信息', async () => {
      const h = twitch({ token: () => jsonResponse({ status: 400, message: 'bad secret' }, 400) });
      await assert.rejects(
        () => h.adapter.resolveCreator(`twitch.tv/${TWITCH_LOGIN}`),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.ok(!message.includes(TWITCH_SECRET), `错误信息里带着 client secret：${message}`);
          return true;
        },
      );
    });
  });

  describe('resolveCreator：Get Users?login=', () => {
    it('★ twitch.tv/<login> ⇒ user id + display_name + 头像', async () => {
      const h = twitch();
      const ref = await h.adapter.resolveCreator(`twitch.tv/${TWITCH_LOGIN}`);

      const call = h.route('users')[0];
      assert.equal(call?.params.get('login'), TWITCH_LOGIN);
      assert.equal(ref.platform, 'twitch');
      assert.equal(ref.externalId, TWITCH_USER_ID, '§4.1：external_id 存 Twitch user id');
      assert.equal(
        ref.handle,
        TWITCH_LOGIN,
        '可读标识是 login（user_login 才是登录名，login 就是它）',
      );
      assert.equal(ref.displayName, 'TwitchDev');
      assert.equal(
        ref.avatarUrl,
        'https://static-cdn.jtvnw.net/jtv_user_pictures/twitchdev-300x300.png',
      );
      assert.equal(
        (ref as { platformMeta?: unknown }).platformMeta,
        undefined,
        'Twitch 没有要跨轮记的"平台小东西"（游标已经是自己的一列）⇒ 不填',
      );
    });

    it('链接的几种写法都认，且不发多余请求', async () => {
      for (const input of [
        `https://www.twitch.tv/${TWITCH_LOGIN}`,
        `https://twitch.tv/${TWITCH_LOGIN}/`,
        `m.twitch.tv/${TWITCH_LOGIN}`,
        `twitch.tv/${TWITCH_LOGIN}`,
      ]) {
        const h = twitch();
        const ref = await h.adapter.resolveCreator(input);
        assert.equal(ref.externalId, TWITCH_USER_ID, input);
        assert.equal(h.route('users').length, 1, input);
        assert.equal(h.calls.length, 2, `${input}：1 次换 token + 1 次 Get Users`);
      }
    });

    it('视频链接 / 目录页 / 乱写 ⇒ InvalidCreatorInputError，一个请求都不发', async () => {
      const h = twitch();
      for (const input of [
        'https://www.twitch.tv/videos/335921245',
        'twitch.tv/directory/game/Minecraft',
        '',
        '   ',
      ]) {
        await assert.rejects(
          () => h.adapter.resolveCreator(input),
          InvalidCreatorInputError,
          `"${input}" 不该被认成一个频道`,
        );
      }
      assert.equal(h.calls.length, 0, '认不出来就一个请求都不发（连 token 都不换）');
    });

    it('Get Users 空 data（这个 login 不存在）⇒ InvalidCreatorInputError，且不打视频', async () => {
      const h = twitch({ users: () => jsonResponse({ data: [] }) });
      await assert.rejects(
        () => h.adapter.resolveCreator(`twitch.tv/${TWITCH_LOGIN}`),
        InvalidCreatorInputError,
      );
      assert.equal(h.route('videos').length, 0);
    });

    it('★ resolveCreator 的失败只有三种类型 —— 400/404 那种"我们的请求不对"也算平台级', async () => {
      /*
       * ⚠️ 与 YouTube 那一条同一个理由：resolveCreator 的唯一消费者是 HTTP 路由，
       *    而路由按**类型**分派；表外的类型会变成 500"我们的 bug"。
       *    ⇒ Twitch 这边的 `TwitchRejectedError` 在 `resolveCreator` 里被贴成平台级。
       */
      for (const status of [400, 404]) {
        const h = twitch({
          users: () => jsonResponse({ error: 'Bad Request', status, message: 'bad login' }, status),
        });
        await assert.rejects(
          () => h.adapter.resolveCreator(`twitch.tv/${TWITCH_LOGIN}`),
          PlatformHandshakeError,
          `HTTP ${String(status)}`,
        );
      }

      const down = twitch({ users: () => jsonResponse({ error: 'Service Unavailable' }, 503) });
      await assert.rejects(
        () => down.adapter.resolveCreator(`twitch.tv/${TWITCH_LOGIN}`),
        PlatformUnavailableError,
        '5xx 是"过一会儿再来"，不是"我们的 bug"',
      );
    });

    it('★ 形状变了（data 不是数组 / 没有 id）⇒ 平台级失败', async () => {
      const notArray = twitch({ users: () => jsonResponse({ data: { id: TWITCH_USER_ID } }) });
      await assert.rejects(
        () => notArray.adapter.resolveCreator(`twitch.tv/${TWITCH_LOGIN}`),
        PlatformHandshakeError,
      );

      const noId = twitch({ users: () => jsonResponse({ data: [{ login: TWITCH_LOGIN }] }) });
      await assert.rejects(
        () => noId.adapter.resolveCreator(`twitch.tv/${TWITCH_LOGIN}`),
        PlatformHandshakeError,
      );
    });

    it('连不上上游 ⇒ PlatformUnavailableError', async () => {
      const adapter = createTwitchAdapter({
        clientId: TWITCH_ID,
        clientSecret: TWITCH_SECRET,
        fetchImpl: (async () => {
          throw new TypeError('fetch failed');
        }) as typeof fetch,
      });
      await assert.rejects(
        () => adapter.resolveCreator(`twitch.tv/${TWITCH_LOGIN}`),
        PlatformUnavailableError,
      );
    });
  });

  describe('fetchPage：Get Videos', () => {
    it('★ query：user_id / first=100 / type=…（§5.3 逐字），首轮没有 after', async () => {
      const h = twitch();
      await h.adapter.fetchPage(twitchCreator(), null, { storedTotal: 0 });

      const call = h.route('videos')[0];
      assert.ok(call);
      assert.equal(
        call.params.get('user_id'),
        TWITCH_USER_ID,
        '§5.3：按 user_id 查，不是 user_login',
      );
      assert.equal(call.params.get('user_login'), null);
      assert.equal(call.params.get('first'), '100', '文档：Get Videos 的 first 上限是 100');
      assert.equal(
        call.params.get('type'),
        'archive,highlight,upload',
        '§5.3 冻结的那一格（⚠️ 见 twitch.ts 里那条"文档上最可疑"的注释）',
      );
      assert.equal(call.params.get('after'), null, '首轮不许送一个空的 after');
    });

    it('★ 第二页把上一次的 cursor 当 after 送回去', async () => {
      const h = twitch({
        videos: (_call, index) =>
          index === 0
            ? jsonResponse({
                data: [twitchVideo({ id: 'v1' })],
                pagination: { cursor: 'cursor-1' },
              })
            : jsonResponse({ data: [twitchVideo({ id: 'v2' })], pagination: {} }),
      });
      const first = await h.adapter.fetchPage(twitchCreator(), null, {
        storedTotal: 0,
      });
      assert.equal(first.nextCursor, 'cursor-1');

      const second = await h.adapter.fetchPage(twitchCreator(), 'cursor-1', {
        storedTotal: 1,
      });
      assert.equal(h.route('videos')[1]?.params.get('after'), 'cursor-1');
      assert.equal(second.videos[0]?.externalId, 'v2');
    });

    it('★ §5.4：pagination.cursor 缺失 ⇒ 到底了；在 ⇒ 还没到底', async () => {
      const end = twitch({ videos: () => jsonResponse({ data: [twitchVideo()], pagination: {} }) });
      const endPage = await end.adapter.fetchPage(twitchCreator(), null, {
        storedTotal: 0,
      });
      assert.equal(endPage.reachedEnd, true);
      assert.equal(endPage.nextCursor, null);

      const more = twitch({
        videos: () => jsonResponse({ data: [twitchVideo()], pagination: { cursor: 'next' } }),
      });
      const nextPage = await more.adapter.fetchPage(twitchCreator(), null, {
        storedTotal: 0,
      });
      assert.equal(nextPage.reachedEnd, false);
      assert.equal(nextPage.nextCursor, 'next');
    });

    it('★★ §5.4：Twitch 只认 pagination.cursor —— 喂一个 nextPageToken 不算数', async () => {
      const h = twitch({
        videos: () =>
          jsonResponse({ data: [twitchVideo()], pagination: {}, nextPageToken: 'youtube-style' }),
      });
      const page = await h.adapter.fetchPage(twitchCreator(), null, {
        storedTotal: 0,
      });
      assert.equal(page.reachedEnd, true, 'cursor 不在 ⇒ 到底了，哪怕有个 YouTube 的 token 在');
      assert.equal(page.nextCursor, null);
    });

    it("★ type==='archive' ⇒ isLiveReplay；highlight / upload ⇒ false", async () => {
      const h = twitch({
        videos: () =>
          jsonResponse({
            data: [
              twitchVideo({ id: 'v-archive', type: 'archive' }),
              twitchVideo({ id: 'v-highlight', type: 'highlight' }),
              twitchVideo({ id: 'v-upload', type: 'upload' }),
            ],
            pagination: {},
          }),
      });
      const page = await h.adapter.fetchPage(twitchCreator(), null, {
        storedTotal: 0,
      });
      assert.equal(page.videos[0]?.isLiveReplay, true, 'archive = 一场直播的存档');
      assert.equal(page.videos[1]?.isLiveReplay, false, 'highlight 是剪辑，不是回放');
      assert.equal(page.videos[2]?.isLiveReplay, false);
    });

    it("★ duration '1h2m3s' ⇒ 3723（接 Task 2 的纯函数），拿不到 ⇒ NULL", async () => {
      const h = twitch({
        videos: () =>
          jsonResponse({
            data: [
              twitchVideo({ id: 'v1', duration: '1h2m3s' }),
              twitchVideo({ id: 'v2', duration: '3m21s' }),
              twitchVideo({ id: 'v3', duration: '0s' }),
              twitchVideo({ id: 'v4', duration: undefined }),
            ],
            pagination: {},
          }),
      });
      const page = await h.adapter.fetchPage(twitchCreator(), null, {
        storedTotal: 0,
      });
      assert.equal(page.videos[0]?.durationSec, 3723);
      assert.equal(page.videos[1]?.durationSec, 201);
      assert.equal(page.videos[2]?.durationSec, null, "'0s' 不是一支 0 秒的 VOD，是'没给'");
      assert.equal(page.videos[3]?.durationSec, null, '字段缺失 ⇒ NULL');
    });

    it('★★ created_at 是 Unix **秒**，而且与 YouTube 那条路给出同一个数', async () => {
      const h = twitch();
      const page = await h.adapter.fetchPage(twitchCreator(), null, {
        storedTotal: 0,
      });
      const created = page.videos[0]?.publishedAt;
      assert.equal(
        created,
        TWITCH_CREATED_SEC,
        `2018-11-14T21:30:18Z ⇒ ${String(TWITCH_CREATED_SEC)}（秒）`,
      );
      assert.ok(
        typeof created === 'number' && created < SECONDS_CEILING,
        '毫秒的写法是 13 位 —— 这一格是排序键',
      );

      /*
       * ★ 同一个时刻，喂给**两个适配器**（YouTube 走 Date.parse 的那一份实现、
       *   Twitch 走它自己那一份），必须得到**同一个数**。
       *   ⇒ 两份"ISO → 秒"的实现漂掉时，红的会是这一条，而不是某天发现两个平台的
       *     视频在列表里排错了位置。⚠️ 这条断言是那两份重复实现被允许存在的**理由**。
       */
      const yt = youTube({
        playlistItems: () =>
          jsonResponse(
            playlistPage([
              {
                ...playlistItem('vid-A'),
                contentDetails: { videoId: 'vid-A', videoPublishedAt: TWITCH_CREATED_ISO },
              },
            ]),
          ),
        videos: () => jsonResponse({ items: [] }),
      });
      const ytPage = await yt.adapter.fetchPage(creator(), null, { storedTotal: 0 });
      assert.equal(
        ytPage.videos[0]?.publishedAt,
        created,
        '同一个时刻在两条路上必须是同一个秒数（两份实现的漂移要在这里红）',
      );
    });

    it('★ 封面模板的 %{width}/%{height} 要换掉；播放量直接用；评论数没有 ⇒ NULL', async () => {
      const h = twitch();
      const page = await h.adapter.fetchPage(twitchCreator(), null, {
        storedTotal: 0,
      });
      const video = page.videos[0];
      assert.equal(
        video?.thumbnailUrl,
        'https://static-cdn.jtvnw.net/cf_vods/d2nvs31859zcd8/abcdef/thumb320x180.jpg',
        '占位符不换掉的话那张图 404（文档给的就是模板地址）',
      );
      assert.equal(video?.viewCount, 1_863_062);
      assert.equal(
        video?.commentCount,
        null,
        'Twitch 的 Get Videos 没有评论数（§2.6 的字段清单里就没有）⇒ NULL，不是 0',
      );
      assert.equal(video?.title, 'Twitch Developers 101');
    });

    it('★ 单条坏了（没有 id / 没有 title）⇒ 抛，不静默跳过', async () => {
      const noId = twitch({
        videos: () => jsonResponse({ data: [twitchVideo({ id: null })], pagination: {} }),
      });
      await assert.rejects(
        () => noId.adapter.fetchPage(twitchCreator(), null, { storedTotal: 0 }),
        TwitchRejectedError,
      );

      const noTitle = twitch({
        videos: () => jsonResponse({ data: [twitchVideo({ title: 42 })], pagination: {} }),
      });
      await assert.rejects(
        () => noTitle.adapter.fetchPage(twitchCreator(), null, { storedTotal: 0 }),
        TwitchRejectedError,
      );
    });

    it('data 不是数组（接口形状变了）⇒ 平台级失败，不是"这一页没有视频"', async () => {
      const h = twitch({ videos: () => jsonResponse({ data: { video: twitchVideo() } }) });
      await assert.rejects(
        () => h.adapter.fetchPage(twitchCreator(), null, { storedTotal: 0 }),
        PlatformHandshakeError,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// 注册表（spec §9.1 ⑧）
// ---------------------------------------------------------------------------

describe('★ 注册表：没凭据的平台是"跳过"，不是"崩"（spec §9.1 ⑧）', () => {
  it('★ 没凭据 ⇒ adapterFor 抛 NoCredentialsError，platformStatus 说 skipped:no-credentials', async () => {
    await withEnv(NO_CREDENTIALS, () => {
      assert.deepEqual(platformStatus(), {
        bilibili: 'ok',
        youtube: 'skipped:no-credentials',
        twitch: 'skipped:no-credentials',
      });

      for (const [platform, env] of [
        ['youtube', 'MCSR_YOUTUBE_KEY'],
        ['twitch', 'MCSR_TWITCH_ID'],
      ] as const) {
        assert.throws(
          () => adapterFor(platform),
          (error: unknown) => {
            assert.ok(error instanceof NoCredentialsError, `${platform} 应当抛 NoCredentialsError`);
            assert.equal(error.platform, platform);
            assert.ok(
              error.requiredEnv.includes(env),
              `那行日志要告诉运维去配什么：${error.requiredEnv.join(',')}`,
            );
            return true;
          },
        );
      }
    });
  });

  it('★ 配了凭据 ⇒ platformStatus 说 ok，adapterFor 回一个真适配器（不再是占位）', async () => {
    await withEnv(
      { MCSR_YOUTUBE_KEY: API_KEY, MCSR_TWITCH_ID: TWITCH_ID, MCSR_TWITCH_SECRET: TWITCH_SECRET },
      () => {
        assert.deepEqual(platformStatus(), { bilibili: 'ok', youtube: 'ok', twitch: 'ok' });

        /*
         * ⚠️ 这里**只能**断言"它不再抛、而且两件事它都会做"：`adapterFor` 回的是
         *    **生产实例**（真的 `fetch`），这里打不动它 —— 一次 `resolveCreator`
         *    就是一次真上游请求。映射对不对归上面那些注入假 fetch 的用例管。
         */
        for (const platform of ['youtube', 'twitch'] as const) {
          const adapter = adapterFor(platform);
          assert.equal(typeof adapter.resolveCreator, 'function', platform);
          assert.equal(typeof adapter.fetchPage, 'function', platform);
        }
      },
    );
  });

  it('★★ 两次 adapterFor 必须是**同一个实例**（否则"进程内 token 缓存"形同虚设）', async () => {
    /*
     * ⚠️ 这条看着像"实现细节"，其实是一条**成本**断言：CLI 是**每个 creator** 要一次
     *    `deps.adapters(platform)`（`track.ts` 的 runOnce 就在循环里），而 Twitch 的
     *    token 缓存在**实例**上。每次都新建实例 ⇒ 每个 creator 换一次 token
     *    ⇒ 20 个博主每轮多打 20 次上游，而 §5.3 要的是"进程内缓存"。
     * ⚠️ 这一组**不发任何请求**（所以它拿到的是真实例也没关系）：它只看身份。
     */
    await withEnv(
      { MCSR_TWITCH_ID: TWITCH_ID, MCSR_TWITCH_SECRET: TWITCH_SECRET, MCSR_YOUTUBE_KEY: API_KEY },
      () => {
        assert.equal(adapterFor('twitch'), adapterFor('twitch'), 'twitch 必须是同一个实例');
        assert.equal(adapterFor('youtube'), adapterFor('youtube'), 'youtube 同一套凭据也给同一个');
      },
    );
  });

  it('★ 换了一套凭据就是**另一个**适配器（缓存不许把旧 token 带去新凭据）', async () => {
    await withEnv({ MCSR_TWITCH_ID: TWITCH_ID, MCSR_TWITCH_SECRET: TWITCH_SECRET }, () => {
      const first = adapterFor('twitch');
      process.env.MCSR_TWITCH_SECRET = `${TWITCH_SECRET}-rotated`;
      const second = adapterFor('twitch');
      assert.notEqual(first, second, '密钥换了还复用旧实例 = 拿旧 token 撞 401');
      process.env.MCSR_TWITCH_SECRET = TWITCH_SECRET;
    });
  });

  it('★ "配了但是空的"（systemd 的 Environment=FOO=）也算没配', async () => {
    await withEnv(
      { MCSR_YOUTUBE_KEY: '   ', MCSR_TWITCH_ID: TWITCH_ID, MCSR_TWITCH_SECRET: undefined },
      () => {
        const status = platformStatus();
        assert.equal(status.youtube, 'skipped:no-credentials', '空串不是凭据');
        assert.equal(status.twitch, 'skipped:no-credentials', 'Twitch 要 id **和** secret 两个');
        assert.throws(() => adapterFor('twitch'), NoCredentialsError);
        assert.throws(() => adapterFor('youtube'), NoCredentialsError);
      },
    );
  });

  it('+ platformStatus() 仍然返回副本（改它不影响下一次调用）', async () => {
    await withEnv(NO_CREDENTIALS, () => {
      const first = platformStatus();
      first.bilibili = 'skipped:no-credentials';
      first.youtube = 'ok';
      assert.equal(platformStatus().bilibili, 'ok');
      assert.equal(platformStatus().youtube, 'skipped:no-credentials');
    });
  });
});

// ---------------------------------------------------------------------------
// ★★ §5.5 那条路的端到端：它到底有没有把 ID 送到 fetchPage
// ---------------------------------------------------------------------------

describe('★★ §5.5：uploads 播放列表 ID 从库到适配器全程都在（缺口真的关上了）', () => {
  it('★★ resolveCreator → createCreator → pickDueCreators → fetchPage，入参上带着那个 ID', async () => {
    /*
     * ⚠️ 这条是**别的断言盖不到**的那一段：上面每一条都在"适配器自己"这一层里
     *    （creator 是手搓的），而 T4 的两条（`tracking-store.test.ts:554` 落库、
     *    `:715` 从待办里读回来）各自只盖住一半。中间那一步 —— **CLI 把哪个对象交给
     *    `fetchPage`** —— 只有这条会红：`runOnce` 里只要有人 `.map(toCreator)` 一下
     *    （把 `StoredCreator` 降回公开形状），`platformMeta` 就**静默**没了，
     *    而后果是每轮白烧一次 `channels.list` 配额，日志上什么都看不出来。
     *
     * ⚠️ 这一段用一个真的 `runOnce` + 一个真的（内存）库，但**适配器是假的**
     *    （`RunDeps.adapters` 注入）⇒ 依然一个网络请求都没有。
     */
    const { createCreator } = await import('./tracked-videos');
    const { runOnce } = await import('./track');

    // 第一步：让**真的** YouTube 适配器（假 fetch）给出一个 ref —— 写那一侧也算进来了。
    const ref = await youTube().adapter.resolveCreator(`@${HANDLE}`);

    const created = createCreator(ref, null, YT_PUBLISHED_SEC);
    assert.ok(created.ok, '夹具博主没建起来 —— 后面的断言全都无从谈起');

    /*
     * ⚠️ 收集器是**数组**而不是 `let seen = null`：TS 不看闭包里的赋值，
     *    `let` 那版会把 `seen` 一直窄成 `null`（那里的 `seen.creatorId` 是 `never`）。
     */
    const seen: { creatorId: string; meta: unknown }[] = [];
    const adapter: PlatformAdapter = {
      async resolveCreator() {
        throw new Error('runOnce 不该走 resolveCreator：把链接解析成博主是路由（T5）的事');
      },
      async fetchPage(pageCreator) {
        seen.push({ creatorId: pageCreator.id, meta: (pageCreator as SyncCreator).platformMeta });
        return { videos: [], nextCursor: null, reachedEnd: true };
      },
    };

    await runOnce({
      adapters: () => adapter,
      platformStatus: () => ({ bilibili: 'ok', youtube: 'ok', twitch: 'ok' }),
      now: () => YT_PUBLISHED_SEC,
      limits: { backfill: 5, pages: 5, incremental: 5 },
    });

    assert.equal(seen.length, 1, 'runOnce 必须把库里的那一行交给 fetchPage（而且只交一次）');
    const call = seen.at(0);
    assert.ok(call, '没抓到 fetchPage 的入参 —— 后面两条断言全都无从谈起');
    assert.equal(call.creatorId, created.creator.id, '交给适配器的必须是库里那一行');
    assert.deepEqual(
      call.meta,
      { [UPLOADS_PLAYLIST_META_KEY]: UPLOADS_ID },
      '★★ 这一格空掉的话，fetchPage 就只能每轮再打一次 channels.list（§5.5 那段代价）',
    );
  });
});
