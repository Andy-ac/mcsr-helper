/**
 * 「直播」板块 + 资源库「视频资料」的**渲染**自检。
 *
 * 跑法（从仓库根）：
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:live
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:live -- --en   # 英文界面
 *
 * ---------------------------------------------------------------------------
 * 为什么用 SSR 而不是无头浏览器
 * ---------------------------------------------------------------------------
 * 和 `gridrender.tsx` 同一个理由：`renderToStaticMarkup` 会把组件**真的跑一遍**
 * （hooks、JSX、i18n 取值），产出的 HTML 就是证据，而且不需要 dev server。
 * 它验不到的：点击、悬停、请求 —— 那些要浏览器（这一轮没起，见报告）。
 *
 * ⚠️ 这套断言的设计约束：**每一条都必须能在"它声称要测的东西坏掉"时失败。**
 *    写"检查存在某个 class"很容易变成永远通过 —— 所以：
 *      · 播放器的地址用 `data-embed-src` 断言**逐字符相等**，
 *        而不是"门面存在"（后者区分不出"传对了"和"根本没传"）；
 *      · "不能嵌"的三种理由各自断言**它自己那一句**，
 *        而不是笼统地"有提示就行"（后者区分不出三种被说成了同一种）。
 *    报告里列出了我逐条**故意改坏**验证过的断言。
 */
import assert from 'node:assert/strict';
import { zhCN } from '@mcsr/shared/i18n';
import type { LiveChannel, UserLiveLink } from '@mcsr/shared/live';
import type { Video } from '@mcsr/shared/videos';
import i18n from 'i18next';
/*
 * ⚠️ tsx 对这个脚本用的是**经典** JSX 运行时（`React.createElement`），
 *    所以即便 tsconfig 里写着 `"jsx": "react-jsx"`，这里也必须显式引入 React。
 *    不引的话报的是 `ReferenceError: React is not defined`，指到第一处 JSX 上 ——
 *    看起来像组件坏了，其实只是这个脚本的编译选项。
 *
 * ⚠️⚠️ 必须写成 `import React`（值导入），**不能**让 biome 改成 `import type React`。
 *    `useImportType` 那条规则在普通组件里是对的（自动运行时不需要值导入），
 *    但它看不见"这个文件走经典运行时"这件事 —— 自动修一次，脚本当场崩，
 *    而报错和 lint 毫无关联。
 */
// biome-ignore lint/style/useImportType: 这个脚本走经典 JSX 运行时，React 必须是值导入（见上面的说明）
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';

import { ClickToPlayEmbed } from '@/components/ClickToPlayEmbed';
import { LiveCard } from '@/components/LiveCard';
import { MyLiveForm } from '@/components/MyLiveForm';
import { MyLiveList } from '@/components/MyLiveList';
import { type ResourceDraft, ResourceForm } from '@/components/ResourceForm';
import { ResourceVideoEmbed } from '@/components/ResourceVideoEmbed';
import { VideoEmbed } from '@/components/VideoEmbed';

const LANG = process.argv.includes('--en') ? 'en' : 'zh-CN';

await i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    en: { translation: (await import('@mcsr/shared/i18n')).en },
  },
  lng: LANG,
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false },
  returnNull: false,
  react: { useSuspense: false },
});

let pass = 0;
const ok = (m: string): void => {
  pass += 1;
  console.log(`  ✓ ${m}`);
};

const html = (node: React.ReactElement): string =>
  renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

const countOf = (s: string, needle: string): number => s.split(needle).length - 1;

/** 一个形状完整的频道行 —— 少一个字段会让渲染悄悄少一块。 */
function channel(over: Partial<LiveChannel> = {}): LiveChannel {
  return {
    id: 'c1',
    platform: 'youtube',
    handle: '@Someone',
    displayName: 'Someone',
    note: '一句话说明',
    liveVideoId: null,
    embedChannel: false,
    sortOrder: 100,
    status: 'visible',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

/** 一行私人链接（`user_live_links`）—— 字段一个都不能少，少一个会让渲染悄悄少一块。 */
function myLink(over: Partial<UserLiveLink> = {}): UserLiveLink {
  return {
    id: 'l1',
    url: 'https://www.twitch.tv/Someone',
    platform: 'twitch',
    handle: 'Someone',
    liveVideoId: null,
    title: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

/**
 * 娱乐视频墙上的**一条**（`Video`）—— 字段一个都不能少，
 * 少一个会让渲染悄悄少一块，而"少了一块"很难在一个绿色断言里看出来。
 */
function video(over: Partial<Video> = {}): Video {
  return {
    id: 'v1',
    userId: 'u1',
    authorName: '某人',
    platform: 'youtube',
    videoId: 'abcdefghijk',
    title: '一个视频',
    startOffsetSec: null,
    status: 'visible',
    createdAt: 0,
    ...over,
  };
}

/**
 * 取门面上的嵌入地址（见 ClickToPlayEmbed 里那个 data 属性的说明）。
 *
 * ⚠️ 必须把 HTML 实体解回来：`renderToStaticMarkup` 输出的是**序列化后的 HTML**，
 *    属性里的 `&` 会变成 `&amp;`。B站 那条地址里正好有两个 `&`
 *    （`bvid=…&autoplay=0&danmaku=0`），所以"逐字符相等"的断言第一版当场失败 ——
 *    而失败的**不是组件**，是断言没考虑序列化。
 *    （YouTube 那两条没有 `&`，所以它们看起来是对的 —— 这类"只在一半输入上
 *      暴露"的问题正是逐字符断言的价值：它逼你把每种输入都跑一遍。）
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function embedSrc(markup: string): string | null {
  const m = /data-embed-src="([^"]*)"/.exec(markup);
  if (!m) return null;
  return decodeEntities(m[1]);
}

/**
 * 取"兜底出口"那个外链的 href（`VideoEmbed` 里那条「去原站看」）。
 *
 * ⚠️ 先把整个 `<a …>` 开标签切出来再在里面找 href，而不是直接
 *    `/href="…" class="video-embed__out"/`：属性顺序是 JSX 的书写顺序，
 *    换一下顺序那种正则就悄悄失效（而它会"找不到"→ 断言失败得很莫名，
 *    或者更糟：换成正则宽松一点就变成永远通过）。
 */
function outHref(markup: string): string | null {
  const tag = /<a[^>]*video-embed__out[^>]*>/.exec(markup);
  if (!tag) return null;
  const href = /href="([^"]*)"/.exec(tag[0]);
  return href ? decodeEntities(href[1]) : null;
}

/** 这一行有没有画出播放器门面。 */
const hasFacade = (markup: string): boolean => markup.includes('video-embed__facade');

/**
 * 取"为什么没有播放器"那句话的文本（`<p class="live-card__noembed">…</p>`）。
 *
 * ⚠️ 靠**类名**定位，不靠文案本身：这一档的文案换过一次名
 *    （`live.noEmbedPlatform` → `live.noEmbedBilibili`，见 `shared/live.ts:596-610` 的说明），
 *    断言里一旦写死旧文案，换的那天它就会"红在一个已经改对的地方"。
 *    ⇒ 所以这里按**类名**取文本，再按**行为**断言（见下面 B站 那一档）。
 * ⚠️ 顺带把实体解回来（`&amp;` 之类）—— 与 `embedSrc` 同一个理由。
 */
function noEmbedText(markup: string): string {
  const m = /<p class="live-card__noembed">([\s\S]*?)<\/p>/.exec(markup);
  return m ? decodeEntities(m[1]).trim() : '';
}

/**
 * 取直播卡底部那个原站外链的 href（`<a class="cta live-card__link" href="…">`）。
 *
 * ⚠️ 它用**逐字符相等**断言，不用 `includes`：`includes` 抓不到"少一位"这类截断
 *    （`…/2145250` 是 `…/21452505` 的前缀，`includes` 照样为真）。
 *    这不是推演 —— 变异探针第一次就是拿"删掉一位"去试的，结果是**假绿**，
 *    换成一个不相干的地址才红。所以这里按 `embedSrc` / `outHref` 的老办法：
 *    先切出整条标签再取 href，避免依赖属性顺序。
 */
function liveChannelHref(markup: string): string | null {
  const tag = /<a[^>]*live-card__link[^>]*>/.exec(markup);
  if (!tag) return null;
  const href = /href="([^"]*)"/.exec(tag[0]);
  return href ? decodeEntities(href[1]) : null;
}

console.log(`【${LANG}】直播卡：能嵌的那一行`);

/*
 * ★ 断言用的是**逐字符相等**，不是"有门面"。
 *   如果 LiveCard 哪天不再把 `liveEmbedUrl` 的结果传进 `src`，
 *   门面**照样会画出来**（组件会自己用 buildEmbedUrl 拼一个 `/embed/<id>`），
 *   所以"门面存在"那条断言是**区分不出来的**。这一条能。
 */
{
  const withVideo = html(
    <ul>
      <LiveCard channel={channel({ liveVideoId: 'abcdefghijk' })} />
    </ul>,
  );
  assert.ok(hasFacade(withVideo), 'YouTube + 有视频 ID 时应当画出播放器门面');
  assert.equal(
    embedSrc(withVideo),
    'https://www.youtube.com/embed/abcdefghijk',
    '嵌入地址必须是**视频 ID** 那条路（不是频道级嵌入）',
  );
  ok('★ YouTube + 视频 ID → 门面存在，且地址逐字符等于 /embed/<id>');

  // 反面：门面不能是禁用状态 —— 禁用说明 resolved 是 null，那就不该有门面
  assert.equal(
    countOf(withVideo, 'disabled'),
    0,
    '可嵌的行不该出现 disabled 的门面按钮（那意味着地址是 null）',
  );
  ok('可嵌的行门面按钮**没有** disabled');

  // 频道链接永远在（播放器可能失败，那时需要一条能走的路）
  assert.ok(
    withVideo.includes('https://www.youtube.com/@Someone'),
    '频道链接必须永远在，即使上面已经有播放器',
  );
  ok('频道链接与播放器同时存在');
}

// ---------------------------------------------------------------------------
console.log(`\n【${LANG}】直播卡：四种"嵌不出来"，各自说清为什么`);
// ---------------------------------------------------------------------------
{
  /*
   * ⚠️ 每一条断言都查**它自己那一句**，其中三条还断言"另一种说法**没有**出现"。
   *    只断言"有提示"是没用的：把几种情况都说成同一句话时它照样通过，
   *    而那正是这次要防的错（编辑开了开关却不生效，却看到一句笼统的"不支持"）。
   * ★ 第四条（B站直播间）刻意**不写死文案**、只断言行为：它的词条本轮正在换名
   *    （`live.noEmbedPlatform` → `live.noEmbedBilibili`），写死哪一边都会在换名那天出错。
   */
  /*
   * ★★ Twitch：**新的两态模型**（D4b.9）—— 现在它**要嵌**，但 `parent` 必须等于
   *    嵌入页面的 host（Twitch 按**域名**校验，见 `shared/live.ts` 的 `originHost`）。
   *
   * ⚠️⚠️ 这一段我改过一次，原因值得记：旧模型里 "Twitch ⇒ 平台未验证 ⇒ 不嵌"，
   *    所以原来这里断言的是"没有门面 + 说『这个平台还没验证过』"。而新模型下
   *    **"未验证"这一档已经不存在了**（`LiveEmbedReason` 只剩
   *    `bilibili_blocked | no_id | not_channel_id | no_origin`）⇒ 那句断言**必然红**，
   *    红的原因是**期望过时**，不是引用失效。所以这里改成断言"两态"本身。
   *
   * ⚠️ 为什么要**临时伪造 `globalThis.location`**：`LiveCard` 是自己读
   *    `globalThis.location?.hostname` 拿 origin 的（没有 origin prop）。脚本环境里它
   *    不存在 ⇒ `hostname` 是空串 ⇒ 走到 `no_origin`。想验"有 origin 时能嵌"这段**真代码**，
   *    唯一办法就是给它一个 location。伪造完**必须还原**（见 `finally`）——
   *    否则后面所有卡片的判定都会带着一个不存在的域名，而那种污染**不会有任何报错**。
   */
  const twitchChannel = channel({
    platform: 'twitch',
    handle: 'Someone',
    liveVideoId: '1234567',
  });

  // (a) 有 origin ⇒ 可嵌，且 parent 是**裸域名**（不含协议/路径/端口）
  const originBackup = (globalThis as { location?: unknown }).location;
  let twitchWithOrigin = '';
  try {
    (globalThis as { location?: unknown }).location = { hostname: 'mcsr.example' };
    twitchWithOrigin = html(
      <ul>
        <LiveCard channel={twitchChannel} />
      </ul>,
    );
  } finally {
    if (originBackup === undefined) delete (globalThis as { location?: unknown }).location;
    else (globalThis as { location?: unknown }).location = originBackup;
  }
  assert.ok(hasFacade(twitchWithOrigin), 'Twitch + 有 origin 时**应当**画出播放器门面（D4b.9）');
  assert.equal(
    embedSrc(twitchWithOrigin),
    'https://player.twitch.tv/?channel=Someone&parent=mcsr.example',
    '★ 地址必须是 `channel=…&parent=<裸域名>` —— parent 带协议/路径/端口都会被 Twitch 静默拒播',
  );
  ok('★ Twitch + origin → 可嵌，且 parent 逐字符等于裸域名（不是 https://…）');

  // (b) 没有 origin ⇒ 不嵌（`no_origin`，适配器给 null ⇒ 没有可说的文案）
  const twitchNoOrigin = html(
    <ul>
      <LiveCard channel={twitchChannel} />
    </ul>,
  );
  assert.equal(
    hasFacade(twitchNoOrigin),
    false,
    'Twitch 没有 origin 时不该画门面 —— 拼不出 parent 就等于一个注定黑掉的播放器',
  );
  assert.ok(twitchNoOrigin.includes('https://www.twitch.tv/Someone'), '不嵌时频道链接仍要在');
  ok('★ Twitch 无 origin → 不嵌，但仍给频道链接（兜底出口）');

  const noId = html(
    <ul>
      <LiveCard channel={channel({ liveVideoId: null, embedChannel: false })} />
    </ul>,
  );
  assert.equal(hasFacade(noId), false, '没视频 ID、没开频道嵌入时不该画门面');
  assert.ok(noId.includes(i18n.t('live.noEmbedNoId')), '应当说"还没有记录直播视频 ID"');
  /*
   * ⚠️⚠️ 这一条**换过一次写法**，原因值得留在这里：
   *
   *   它原先写的是 `noId.includes(i18n.t('live.noEmbedPlatform')), false` ——
   *   一条**反面断言**。换成 `live.noEmbedBilibili` 之后，`t('旧名')` 对缺键
   *   **原样返回键名**，而渲染文本里永远不会出现那串 key ⇒ `false === false`
   *   **照旧通过，却什么都没验**（★ 反面断言换名后是**静默变绿**，不是变红 ——
   *   正面断言才会红）。
   *    ⇒ 所以这里改成：① 先证明新词条**真的解析出文字**（前置条件），
   *      ② 再断言那句 B站 专属的话**不在**这一行里。两步缺一不可。
   */
  const bilibiliSaid = i18n.t('live.noEmbedBilibili');
  assert.notEqual(
    bilibiliSaid,
    'live.noEmbedBilibili',
    '前置：B站 那句词条必须真的解析出译文（否则下面那条反面断言会"因为找不到而通过"）',
  );
  assert.equal(noId.includes(bilibiliSaid), false, '这行不是"平台不许嵌"，不该出现 B站 那句');
  ok('★ 没填视频 ID → 没有门面，说的是"没记视频 ID"，且不混用 B站 那句');

  /*
   * ★ 这一条是最要紧的：编辑**打开了**频道嵌入，但标识是 @handle。
   *    `liveEmbedUrl` 会返回 null（只认 UC... 频道 ID），所以门面不出现；
   *    而界面上必须立刻说清"你开的那个开关不会生效"。
   */
  const notChannelId = html(
    <ul>
      <LiveCard channel={channel({ handle: '@Someone', embedChannel: true })} />
    </ul>,
  );
  assert.equal(hasFacade(notChannelId), false, '频道 ID 形状不对时不该画门面');
  assert.ok(
    notChannelId.includes(i18n.t('live.noEmbedNotChannelId')),
    '开了频道嵌入但标识不是 UC… 时，必须说清"那个开关不会生效"',
  );
  ok('★★ 开了频道嵌入但标识是 @handle → 没有门面 + 明说"嵌不出来（只认 UC…）"');

  /*
   * ★★ B站直播间：**确定不可嵌**（`live.bilibili.com` 回 `x-frame-options: SAMEORIGIN`，
   *    大陆 + 香港两条网络各自测到 —— spec F32d / D4b.9）。
   *
   * ⚠️ 这一档此前**一条渲染断言都没有**：上面覆盖的是 Twitch 的 origin 两态、
   *    "没记视频 ID"、"标识不是 UC… 频道 ID"，而"**平台自己禁止嵌入**"这一句
   *    恰恰是本轮正在换文案的那一句（新词条 `live.noEmbedBilibili`）。
   *    ⇒ 所以这里**按行为断言，不按字面断言**：
   *      · 没有门面（不是留白，更不是"加载中"—— 那两种都在撒谎）
   *      · 原站外链必须指向那个直播间（用户唯一能走的路）
   *      · 那句解释必须**真的解析出来**：既不能空，也不能是原始 key 的形状
   *        （`t()` 对未知键**原样返回**，所以"词条删了、这里没跟上"正好长这样）
   */
  const biliLive = html(
    <ul>
      <LiveCard
        channel={channel({ platform: 'bilibili', handle: '21452505', liveVideoId: null })}
      />
    </ul>,
  );
  assert.equal(hasFacade(biliLive), false, 'B站直播间确定不可嵌 ⇒ 不该出门面（黑框比外链糟得多）');
  assert.equal(
    liveChannelHref(biliLive),
    'https://live.bilibili.com/21452505',
    '不嵌时必须给一条能走的原站外链（逐字符相等：抓得到"少一位"这种截断）',
  );
  const biliSaid = noEmbedText(biliLive);
  assert.notEqual(biliSaid, '', '必须有一句解释 —— 空白会被当成我们坏了');
  assert.ok(
    !/live\.[a-zA-Z]+/.test(biliSaid),
    `解释必须真的解析成译文，不能是原始 key —— 实际渲染成「${biliSaid}」`,
  );
  ok('★ B站直播间 → 没有门面、原站外链在、且那句话真的解析了（不是原始 key）');

  /*
   * ★ t24（词条改名）的守卫。
   *
   * 这一档**刻意不写死词条名**（原因见 `noEmbedText` 的注释），代价是"改名本身"
   * **没有任何守卫** —— 于是有人把新名字删掉、只留旧名时，这里照样全绿。
   * ⇒ 补一条针孔大小的探针：把"渲染出来的那句话"与**新词条名**比一次。
   *    它刻意写成"不等于键名"（而不是"等于某句话"）：只要那句真的解析出了译文就通过，
   *    而一旦新词条被删、`t()` 开始原样返回键名，这条**立刻红**。
   *    （与 `MyLiveList` 那一节的 `assert.notEqual(t(key), key)` 同一个理由：
   *      i18next 对缺键**静默返回键名**，缺了这条，所有 `includes` 断言都会"因为找不到而通过"。）
   */
  assert.notEqual(
    biliSaid,
    'live.noEmbedBilibili',
    `B站 那行渲染出来的必须是一句话，而不是键名本身 —— 实际是「${biliSaid}」`,
  );
  ok('★ B站 那句不是"键名原样返回"（新词条被删时会红）');

  /*
   * ★★ t24：**正向**断言 —— 这一行必须真的用上 B站 专属那句。
   *
   * ⚠️ 为什么不能只靠上面那条"不是键名"：那条只证明**某个**词条解析了。
   *    如果 `liveEmbedUnavailableReason()` 退回把 `'bilibili_blocked'` 归并成
   *    `'platform'`（这正是 t24 修的缺陷），渲染出来的仍然是一句解析好的**通用**话
   *    ⇒ 上面那条照样绿，而界面又变成了"没说清是哪种"。⇒ 必须钉住**具体是哪一句**。
   *
   * ⚠️ 也不写成 `assert.ok(biliSaid.includes(i18n.t('live.noEmbedBilibili')))` 就完事：
   *    那是**同义反复**（拿词条去验词条），`t()` 解析成功就必然通过，
   *    **证明不了界面用的是这个 key**。⇒ 真正的判据是**两句话必须不同** ——
   *    它才能区分"用了 B站 那句"与"用了通用那句"。
   */
  const bilibiliWording = i18n.t('live.noEmbedBilibili');
  const genericWording = i18n.t('live.noEmbedPlatform');
  assert.ok(
    biliSaid.includes(bilibiliWording),
    `B站 那一行必须说 B站 专属那句（"不允许把直播间嵌进别的网站"），而不是通用句 —— 实际渲染「${biliSaid}」`,
  );
  assert.notEqual(
    bilibiliWording,
    genericWording,
    'B站 专属句与"通用"句（`live.noEmbedPlatform`）必须**是两句话**：' +
      '若两者相同，下面的区分度断言就自动成立、失去意义（等于没有区分度）',
  );
  assert.ok(
    /不允许|不支持|不能|禁止|cannot|not allowed|does not allow/.test(biliSaid),
    `那句必须明说"这个平台自己禁止嵌入"（不能只说外链、也不能是转圈的空话）—— 实际渲染「${biliSaid}」`,
  );
  ok('★★ B站 那一行用的是**专属句**（与通用句不同），且明说了"不允许嵌"');
  /*
   * ★★ 跨档对照（**别把它当成重复**）：上面那句 B站 文案**不能**出现在
   *    "没记视频 ID"那一行里 —— 这正是这个区块本来要防的错
   *    （把几种"嵌不出来"说成同一句话）。
   *
   * ⚠️ 为什么用 `biliSaid`（**渲染出来的文本**）当对照，而不是像上面那条那样
   *    写 `i18n.t('live.noEmbedPlatform')`：词条本轮正在换名
   *    （→ `live.noEmbedBilibili`）。换名之后 `i18n.t('旧名')` 返回的是**旧名本身**
   *    那个字符串，而界面上永远不会出现它 ⇒ 那种写法会**静默退化成恒真**
   *    （"因为找不到而通过"），而这里无论词条叫什么名字都仍然有效。
   */
  assert.equal(
    noId.includes(biliSaid),
    false,
    'B站 那句不能出现在"没记视频 ID"那一行里（用渲染出来的文本做对照，改词条也不会失效）',
  );
  /*
   * 反面控制：上面那条"不能是原始 key"的判据**自己**得能认出原始 key 的形状。
   * 少了它，判据写错（比如正则永远不匹配）时会静静地永远通过。
   */
  assert.ok(
    /live\.[a-zA-Z]+/.test('live.noEmbedNobody'),
    '反面控制：这条判据要能认出原始 key 的形状（否则上面那条是"因为找不到而通过"）',
  );
}

// ---------------------------------------------------------------------------
console.log(`\n【${LANG}】直播卡：频道级嵌入（开了开关 + 真的是 UC… 频道 ID）`);
// ---------------------------------------------------------------------------
{
  const UC = 'UCabcdefghijklmnopqrstuv';
  const ch = channel({ handle: UC, embedChannel: true });
  const markup = html(
    <ul>
      <LiveCard channel={ch} />
    </ul>,
  );
  assert.ok(hasFacade(markup), 'UC… 频道 ID + 开了频道嵌入时应当画出播放器门面');
  assert.equal(
    embedSrc(markup),
    `https://www.youtube.com/embed/live_stream?channel=${UC}`,
    '地址必须是 `buildEmbedUrl` **拼不出来的**那条频道级嵌入 —— 这正是 `src` 覆盖存在的理由',
  );
  ok('★ 频道级嵌入：地址逐字符等于 /embed/live_stream?channel=<UC…>');
}

// ---------------------------------------------------------------------------
console.log(`\n【${LANG}】资源库「视频资料」的播放器`);
// ---------------------------------------------------------------------------
{
  const good = html(
    <ResourceVideoEmbed url="https://www.bilibili.com/video/BV1xx411c7mD" title="一个教程" />,
  );
  assert.ok(hasFacade(good), '能解析成视频的 URL 应当画出播放器');
  assert.equal(
    embedSrc(good),
    'https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&autoplay=0&danmaku=0',
    'B站 的嵌入地址形状',
  );
  // 兜底出口必须指向**用户自己贴的那个 URL**，不是我们拼的规范链接
  assert.ok(
    good.includes('href="https://www.bilibili.com/video/BV1xx411c7mD"'),
    '兜底出口要指向用户填的原始 URL',
  );
  ok('★ 能解析 → 嵌播放器，且兜底出口指向用户填的原始 URL');

  // ★ 关键的反面：解析不出来时**什么都不渲染**，而不是一个空框
  const bad = html(<ResourceVideoEmbed url="https://example.com/some-article" title="一篇文章" />);
  assert.equal(bad, '', '解析不出视频时应当渲染空字符串（不能留一个空白播放器框）');
  ok('★ 解析不出视频 → 渲染空字符串（不是空播放器框）');
}

// ---------------------------------------------------------------------------
console.log(`\n【${LANG}】资源库表单：三个类型，标签互不相同`);
// ---------------------------------------------------------------------------
{
  const draft: ResourceDraft = {
    kind: 'website',
    title: '',
    titleEn: '',
    url: '',
    imageUrl: '',
    summary: '',
    body: '',
    lang: 'zh-CN',
    tags: [],
  };
  const form = html(
    <ResourceForm
      initial={draft}
      actionLabel="提交"
      busyLabel="提交中"
      busy={false}
      serverError={null}
      onSubmit={() => undefined}
    />,
  );

  const options = [...form.matchAll(/<option value="([^"]+)"[^>]*>([^<]*)<\/option>/g)].map(
    (m) => ({
      value: m[1],
      label: m[2],
    }),
  );

  /*
   * ★ 这一条直接守着那个**二元三元式** bug：
   *   原来写的是 `t(`resources.kind${k === 'website' ? 'Website' : 'Tool'}`)`,
   *   于是 `video` 会被显示成「工具」—— 三个选项里有两个一模一样的标签，
   *   而且不报错、不崩溃。
   *   断言"标签互不相同"能在它复发时立刻失败。
   */
  const kindOptions = options.filter((o) => ['website', 'tool', 'video'].includes(o.value));
  assert.equal(kindOptions.length, 3, `应当有三个类型选项，实际 ${kindOptions.length}`);
  const labels = kindOptions.map((o) => o.label);
  assert.equal(
    new Set(labels).size,
    3,
    `三个类型的标签必须互不相同（重复说明某个 kind 被映射成了另一个的标签）：${labels.join(' / ')}`,
  );
  assert.equal(
    kindOptions.find((o) => o.value === 'video')?.label,
    i18n.t('resources.kindVideo'),
    'video 选项必须显示「视频资料」，不能是「工具」或「网站」',
  );
  ok(`★ 三个类型标签互不相同：${labels.join(' / ')}`);
}

// ---------------------------------------------------------------------------
console.log(`\n【${LANG}】词条：漏 key 会以原始 key 的形式出现在界面上`);
// ---------------------------------------------------------------------------
/**
 * ★ 带 `secondaryAction` 的资源表单 —— **为了让 `authoring.*` 真的进产物**。
 *
 * ⚠️ 这一项是**必需的**，不是装饰：`ResourceForm` 里挂在 `title` 上的
 *    `t('authoring.directHint')` 属于**「直接保存」那个按钮**，而那个按钮的渲染条件是
 *    `{secondaryAction ? <button …> : null}`。
 *    ⇒ **不传 `secondaryAction` 就没有那个按钮，`authoring.directHint` 根本不进 HTML。**
 *    实测过（临时探针）：不传时 `RAW authoring.* keys in operand: (none)`。
 *
 * ⚠️ 而那正是"把 `authoring.` 加进泄漏扫描前缀"这件事的**前提**：光加前缀、
 *    产物里却一个 `authoring.*` 都没有 ⇒ 扫描**扫一片空白** ⇒ 断言恒绿 = **假通过**
 *    （比没有覆盖更危险：它看起来在防护）。这是本仓第三次遇到这个形状
 *    （前两次：`CalendarSeriesSection` 没被渲染、liverender 的 `form` 没并进 `everything`）。
 *
 * ⚠️ `label` / `busyLabel` 用**字面串**：它们只是页面上的一句文案，而我们要抓的是
 *    **原始 key**（`authoring.directHint`）。用 `t('authoring.directSave')` 反而会把
 *    译文塞进产物、让扫描看起来更"干净" —— 那是反效果。
 */
const authoringForm = html(
  <ResourceForm
    initial={{
      kind: 'website',
      title: '',
      titleEn: '',
      url: '',
      imageUrl: '',
      summary: '',
      body: '',
      lang: 'zh-CN',
      tags: [],
    }}
    actionLabel="提交"
    busyLabel="提交中"
    busy={false}
    serverError={null}
    onSubmit={() => undefined}
    secondaryAction={{ label: '直接保存', busyLabel: '保存中', onSubmit: () => undefined }}
  />,
);

{
  /*
   * i18next 对查不到的 key 的行为是**原样返回 key** —— 界面上就会出现
   * `live.title` 这种字符串。它不报错、类型也查不出来。
   */
  const everything = [
    html(
      <ul>
        <LiveCard channel={channel({ liveVideoId: 'abcdefghijk' })} />
        <LiveCard channel={channel({ platform: 'twitch' })} />
        <LiveCard channel={channel({ embedChannel: true })} />
        <LiveCard channel={channel({ id: 'c2', status: 'hidden' })} />
      </ul>,
    ),
    html(<ResourceVideoEmbed url="https://www.youtube.com/watch?v=abcdefghijk" title="t" />),
    /*
     * ⚠️ 新命名空间必须先**进产物**，否则下面把 `authoring.` 加进前缀是白加 ——
     *    扫描扫一片空白，断言恒绿。见上面 `authoringForm` 的说明。
     */
    authoringForm,
  ].join('\n');

  /*
   * ⚠️ 只扫**我这一轮碰过的命名空间**。扫全站会撞上类名之类的噪音，
   *    而一道会误报的检查很快就会被无视。
   *    类名用的是连字符（`live-card__name`），和 `live.title` 这种形状不同，
   *    所以这个正则不会误伤。
   *
   * ⚠️ `'authoring.'` 是**需求②** 的命名空间（直编入口的文案）。它之所以在这里，
   *    是因为 `authoringForm` 现在真的把 `authoring.directHint` 渲染进了产物 ——
   *    两者**必须成对**：只加前缀 = 假通过；只加产物 = 那个键没人守。
   */
  const prefixes = ['live.', 'liveManage.', 'enterVideo.', 'authoring.'];
  const leaked: string[] = [];
  for (const p of prefixes) {
    const re = new RegExp(`${p.replace('.', '\\.')}[a-zA-Z][A-Za-z]*`, 'g');
    for (const m of everything.match(re) ?? []) leaked.push(m);
  }
  assert.deepEqual(
    [...new Set(leaked)],
    [],
    `这些词条没有渲染出来，界面上会显示原始 key：${[...new Set(leaked)].join(', ')}`,
  );
  ok('没有词条 key 泄漏（live / liveManage / enterVideo / authoring 四个命名空间）');

  /*
   * ★★ 覆盖自证：**每道前缀真的有东西可扫** —— 而且我用的是"已解析的译文"。
   *
   * ⚠️⚠️ 这一节我第一版写错了，两句都值得留在这里：
   *
   *  ① 我原本断言"每个前缀能在产物里匹配到 `<prefix>.xxx`" —— **恒失败**。
   *     因为上面那条主断言的作用**正是**让产物里不存在原始 key：键只要解析成功，
   *     产物里就只有译文、没有 `live.title` 这种形状。
   *     ⇒ **在一个没有泄漏的产物里，用"原始 key 存在"去证明覆盖，必然匹配不到。**
   *
   *  ② 更不能因此断定"这些前缀都是空转的"：它们**确实有东西可扫** —— 只是那些键
   *     都**解析成功**了，所以产物里留下的是译文。实测：把 `'authoring.'` 从
   *     `prefixes` 里删掉，主断言照样绿（18 项全过），**但这不代表前缀没用**，
   *     只代表"删掉它、在没有泄漏的产物上，观察不到差别" —— 差别只能在**有泄漏时**显现
   *     （那正是下面那一节"反面控制"在证明的事）。
   *
   * ⇒ 所以覆盖要这样证：**用"某个 key 的译文出现在产物里"证明那个命名空间真的被渲染了。**
   *    译文在 ⇒ 组件渲染了 ⇒ 这道前缀有东西可扫。`authoring.directHint` 的译文在
   *    ⇒ `authoringForm` 真的把 `title` 渲染出来了（不传 `secondaryAction` 就没有它）。
   *
   * ⚠️ 配对关系**显式写出来**（不是"任意命中即可"）：这样把某个 fixture 从 `everything`
   *    里删掉时，会**指名道姓**地告诉你是哪一道前缀失去了覆盖。
   */
  const coverage: readonly (readonly [prefix: string, key: string])[] = [
    /*
     * ⚠️⚠️ 这里原来是 `['live.', 'live.title']`，**那是一条假守卫**（本脚本英文模式把它抓出来了）：
     *    `everything` 里只有 `LiveCard`（和视频播放器、authoring 表单），
     *    而 **`LiveCard` 从来不渲染 `live.title`** —— 那是 `/live` **页面**的标题，
     *    页面本身不在这个产物里。
     *
     *    中文模式之所以一直"通过"，纯粹是**巧合**：`live.title` 的中文是「直播」，
     *    而产物里有「直播中」（`live.recordsChannels` 那句话的一部分），
     *    `includes('直播')` 于是为真。换成英文（`title: 'Live'`）就立刻为假。
     *    ⇒ 换句话说：它守的不是"`live.` 命名空间被渲染了"，而是"某个含『直播』二字的长句在产物里"。
     *
     *    教训值得留在原地：**用"译文是产物子串"来证明覆盖时，必须挑一个真的由该 fixture 渲染出来的键**，
     *    否则中文里很容易被某个更长句子的片段意外命中 —— 而那种偶然命中在**换语言时才暴露**。
     *
     *    `live.gotoChannel` 是稳的：`LiveCard` 底部那个"去频道看"的链接**在每一张卡上都有**
     *    （嵌入成功/失败都有兜底链接），所以它是这个产物里 `live.` 命名空间的可靠实证。
     */
    ['live.', 'live.gotoChannel'],
    ['authoring.', 'authoring.directHint'],
  ];
  for (const [prefix, key] of coverage) {
    assert.ok(
      everything.includes(i18n.t(key)),
      `前缀 ${prefix} 失去覆盖：产物里找不到 ${key} 的译文（那个组件没被渲染进 everything？）`,
    );
  }
  ok(
    `★ 覆盖自证：${coverage.length} 道前缀各有实证（${coverage
      .map(([p, k]) => `${p}←${k}`)
      .join('、')}）`,
  );

  /*
   * ★ `authoring.directSave` 的**解析**自证 —— 它**不**进产物，所以只能用这种方式守住。
   *
   * ⚠️ 为什么它不在上面那张 `coverage` 表里（我实测过，别误当成漏了）：
   *    fixture 给 `secondaryAction.label` 传的是**字面串**（"直接保存"），不是
   *    `t('authoring.directSave')` —— 这是**有意的**：那个 `label` 由**调用方页面**提供，
   *    而 fixture 不该假装页面一定会传译文。于是 `authoring.directSave` **不进 HTML**，
   *    用"译文在不在产物里"去证它就**恒失败**。
   *
   * ⚠️ 但那个键**确实会被解析**（`EditResource` / `CalendarSubmit` 都把
   *    `t('authoring.directSave')` 的结果传下来），所以它仍然可能因为**词条被删/改名**
   *    而在真实页面上冒成原始 key。⇒ 这里直接断言**它能解析**（不等于 key 本身）：
   *    这是"缺词条"那一族唯一能在纯 node 里守住的判据。
   */
  for (const key of ['authoring.directSave', 'authoring.directHint']) {
    assert.notEqual(i18n.t(key), key, `词条 ${key} 必须解析得到，不能原样回显 key`);
  }
  ok('★ authoring.directSave / directHint 都真的解析了（防词条缺失时原样回显 key）');

  /*
   * 反面：这个扫描器本身**能**发现泄漏 —— 否则上面那条是"因为找不到而通过"。
   *
   * ⚠️ 这里必须**对每一个前缀各证一次**，不能只证 `live.`：现有那条只覆盖了
   *    第一个前缀。**没有针对 `authoring.` 的这一条时，"扫不到"与"没泄漏"
   *    在输出上依然无法区分**（F32 第 2 层的原话）—— 也就是说，如果有人把
   *    `'authoring.'` 从前缀表里删掉、或者前缀写错一个字符，那条主断言仍然全绿。
   *
   * ⚠️ 用的是**与上面同一套循环**（`for (const p of prefixes)`），不是另写一个正则：
   *    自证必须证明"**这段实现**能命中"，而不是"某个新写的正则能命中"。
   */
  const fake = `x ${'live'}.thisKeyDoesNotExist y`;
  const probe = /live\.[a-zA-Z][A-Za-z]*/g.exec(fake);
  assert.ok(probe, '泄漏扫描器本身必须能命中一个明显不存在的 key（否则它是恒真的）');
  ok('泄漏扫描器自证：它能命中一个故意构造的假 key');

  for (const p of prefixes) {
    const fakeKey = `${p}thisKeyDoesNotExist`;
    const hit = (() => {
      const re = new RegExp(`${p.replace('.', '\\.')}[a-zA-Z][A-Za-z]*`, 'g');
      return re.exec(`x ${fakeKey} y`);
    })();
    assert.ok(
      hit,
      `前缀 ${p} 的反面控制：扫描器必须能命中一个明显不存在的 key（否则那道前缀是恒真的）`,
    );
  }
  ok(`★ ${prefixes.length} 个前缀各自都有反面控制：${prefixes.join(' ')}`);
}

// ---------------------------------------------------------------------------
console.log(`\n【${LANG}】共用门面：src 不传时自己拼，传了就用传的`);
// ---------------------------------------------------------------------------
{
  const auto = html(
    <ClickToPlayEmbed platform="youtube" idLabel="abcdefghijk" title="t" startOffsetSec={null} />,
  );
  assert.equal(
    embedSrc(auto),
    'https://www.youtube.com/embed/abcdefghijk',
    '不传 src 时应当由 buildEmbedUrl 自己拼',
  );

  const overridden = html(
    <ClickToPlayEmbed
      platform="youtube"
      idLabel="@Someone"
      title="t"
      startOffsetSec={null}
      src="https://www.youtube.com/embed/live_stream?channel=UCabcdefghijklmnopqrstuv"
    />,
  );
  assert.equal(
    embedSrc(overridden),
    'https://www.youtube.com/embed/live_stream?channel=UCabcdefghijklmnopqrstuv',
    '传了 src 时必须用传进来的那条',
  );
  ok('门面：src 缺省自动拼、给了就用给的（两条都断言了地址）');
}

// ---------------------------------------------------------------------------
console.log(`\n【${LANG}】娱乐视频墙的播放器（VideoEmbed）—— 抽取之后只剩"传哪几个参数"`);
// ---------------------------------------------------------------------------
{
  /*
   * ⚠️ 为什么这一节必须有：`VideoEmbed` 是**被抽取**的那一个 ——
   *    它原来的实现整个搬进了 `ClickToPlayEmbed`，自己只剩下传参。
   *    抽取这类改动的风险恰好全在参数上：漏传 `startOffsetSec`、`idLabel` 传错，
   *    门面**照样画得出来**（所以"有播放器"那种断言永远是绿的），
   *    只有把地址逐字符比一遍才看得出来。
   *
   *    它还长在「娱乐视频」墙上 —— 用户明确说过那一块"基本不用改"，
   *    所以它坏掉时最不容易被发现。
   */
  const yt = html(
    <VideoEmbed
      video={video({ platform: 'youtube', videoId: 'abcdefghijk', startOffsetSec: 90 })}
    />,
  );
  assert.equal(
    embedSrc(yt),
    'https://www.youtube.com/embed/abcdefghijk?start=90',
    'YouTube：视频 ID 和起始偏移都必须真的进到地址里',
  );
  assert.equal(
    outHref(yt),
    'https://www.youtube.com/watch?v=abcdefghijk',
    'YouTube：兜底出口要指向原视频页',
  );
  ok('YouTube：嵌入地址含 start=90，兜底出口指向原视频页');

  const bili = html(
    <VideoEmbed
      video={video({ platform: 'bilibili', videoId: 'BV1xx411c7mD', startOffsetSec: 90 })}
    />,
  );
  assert.equal(
    embedSrc(bili),
    'https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&autoplay=0&danmaku=0',
    'B站：地址形状固定，而且**起始偏移不该出现**（该平台不支持跳转）',
  );
  assert.equal(
    outHref(bili),
    'https://www.bilibili.com/video/BV1xx411c7mD',
    'B站：兜底出口要指向原视频页',
  );
  ok('B站：地址里没有跳转参数（说实话），兜底出口指向原视频页');

  /*
   * Twitch 在 SSR / 无 `location` 的环境里 `buildEmbedUrl` 返回 null
   * （宁可不嵌，也不发一个注定被 parent 校验拒掉的请求）。
   * 那时门面**仍然要画出来**，只是按钮不可点、并且要给出"这里嵌不了"的实话 ——
   * 留一个空白区域会看起来像我们坏了。
   */
  const tw = html(
    <VideoEmbed
      video={video({ platform: 'twitch', videoId: '123456789', startOffsetSec: null })}
    />,
  );
  assert.equal(embedSrc(tw), null, 'Twitch 没有 origin 时不该拼出地址');
  assert.ok(hasFacade(tw), '嵌不出来时也必须画出门面（留白会被当成我们坏了）');
  assert.ok(
    /<button[^>]*video-embed__facade[^>]*disabled/.test(tw),
    '嵌不出来时门面按钮必须是 disabled —— 一个点了没反应的按钮更糟',
  );
  assert.equal(
    outHref(tw),
    'https://www.twitch.tv/videos/123456789',
    'Twitch：兜底出口是第一优先级 —— 嵌不出来时用户更需要它',
  );
  ok('Twitch：拼不出地址时门面仍在、按钮禁用，兜底出口照给');

  // 反面：视频 ID 必须被 URL 编码，不能被原样拼进 href（否则一个带 / 的 ID 会改变路径）
  const weird = html(
    <VideoEmbed video={video({ platform: 'youtube', videoId: 'a/b?c', startOffsetSec: null })} />,
  );
  assert.equal(
    outHref(weird),
    'https://www.youtube.com/watch?v=a%2Fb%3Fc',
    '兜底出口里的视频 ID 必须编码（否则 ID 里的 / 和 ? 会改变 URL 的结构）',
  );
  ok('兜底出口对视频 ID 做了编码');
}

/*
 * ★★ 「我的链接」（需求④=B）—— 四种状态 + 三种链接结局
 *
 * ⚠️ 这一节的存在理由就是 spec §1015 那句："**别只断一句万能文案**"。
 *    这块最容易写成的样子是"每行都显示一句解释"，于是三种完全不同的原因
 *    （认不出平台 / 没有标识 / 平台不许嵌）在界面上变成同一句话 ——
 *    用户于是会去改一个本来正确的链接，或者一直刷新一个永远黑着的框。
 *    所以下面**三种结局各断一次**，并且额外断言"另一种说法没有出现"。
 *
 * ⚠️ 判据全部来自共享层的 `liveEmbedDecision`，这一节**不重写平台判断** ——
 *    自检脚本里再写一份"谁能不能嵌"就是第二份真相（本仓反复在治的形状）。
 */
{
  console.log(`\n【${LANG}】「我的链接」：四种状态 + 三种结局各说各的`);

  const origin = 'mcsr.example';

  /** 断言某一行的解释文字**确实**是某个词条的译文。 */
  const says = (markup: string, key: string, why: string) => {
    assert.ok(markup.includes(i18n.t(key)), why);
  };

  const render = (items: UserLiveLink[], loggedIn = true) =>
    html(
      <MyLiveList
        items={items}
        loggedIn={loggedIn}
        origin={origin}
        onDelete={() => undefined}
        deletingId={null}
      />,
    );

  // ---- 状态 1：未登录 —— 必须说"去登录"，**不能**是空态 ─---
  const anon = render([], false);
  says(anon, 'myLive.needLogin', '未登录时要明说需要登录');
  says(anon, 'myLive.gotoLogin', '未登录时要给登录入口');
  assert.equal(
    anon.includes(i18n.t('myLive.empty')),
    false,
    '★ 未登录**不能**说"还没有添加过" —— 那会让用户以为自己丢过数据',
  );
  ok('★ 未登录：说"去登录"并给入口，且不说"还没有添加过"');

  // ---- 状态 2：空态 —— 登录了但一条都没有 ─---
  const empty = render([]);
  says(empty, 'myLive.empty', '登录但没有行时要说"还没有添加过"');
  assert.equal(
    empty.includes(i18n.t('myLive.needLogin')),
    false,
    '已登录时不该出现"需要登录"那句（两句的读者完全不同）',
  );
  ok('★ 空态：说"还没有添加过"，且不混用"需要登录"');

  // ---- 状态 3 + 结局 A：能嵌 ⇒ 直接给播放器门面，不给解释文字 ─---
  const twitchRow = render([myLink({ platform: 'twitch', handle: 'Someone' })]);
  assert.ok(hasFacade(twitchRow), '★ Twitch 有 origin ⇒ 应当画出播放器门面');
  assert.equal(
    embedSrc(twitchRow),
    'https://player.twitch.tv/?channel=Someone&parent=mcsr.example',
    '★ 门面地址的 parent 必须逐字符等于传入的 origin（传错＝Twitch 静默拒播）',
  );
  assert.equal(
    twitchRow.includes(i18n.t('myLive.linkOnly')),
    false,
    '能嵌的行**不该**同时给"只给外链"那句 —— 两句话互相矛盾',
  );
  assert.equal(
    twitchRow.includes(i18n.t('myLive.notSupported')),
    false,
    '能嵌的行不该说"平台不支持"',
  );
  ok('★ 结局一：能嵌 → 有播放器 + 没有矛盾的解释文字');

  // ---- 结局 B：B站 ⇒ **必须说清是平台不允许**（不是"我们没验证"）----
  const biliRow = render([
    myLink({ platform: 'bilibili', handle: '12345', url: 'https://live.bilibili.com/12345' }),
  ]);
  assert.ok(
    !hasFacade(biliRow),
    '★ B站直播间**确定不可嵌**（x-frame-options: SAMEORIGIN）⇒ 不许画一个注定黑掉的门面',
  );
  says(biliRow, 'myLive.notSupported', '★ B站那行必须给出"平台不支持站内播放"那句');
  /*
   * ★★ 这条是 spec §1035 点名要的：**文案必须真的在说"不可嵌"**。
   *    只断言"有句解释、且不是裸 key"是不够的 —— 那句话完全可能说的是别的
   *    （历史上就出现过"还没验证过"这种把平台硬限制说成我们疏漏的措辞）。
   */
  const blocked = i18n.t('myLive.notSupported');
  assert.notEqual(blocked, 'myLive.notSupported', '该词条必须真的解析出译文（否则下面全是假绿）');
  /*
   * ⚠️⚠️ 这条正则**必须同时覆盖中英**。第一版只写了「不允许|不支持|不能|禁止」，
   *    中文模式过、**英文模式当场红**（英文是 "This platform **cannot** be played
   *    in-page"）。这正是"只在一种语言下跑断言"会漏掉的东西。
   */
  assert.ok(
    /不允许|不支持|不能|禁止|cannot|not allowed|does not allow/i.test(blocked),
    `★ B站那行必须明确说"不可嵌"，实际是：「${blocked}」`,
  );
  assert.equal(
    biliRow.includes(i18n.t('myLive.linkOnly')),
    false,
    'B站那行不该混进"认不出平台"那句 —— 两种原因指向的用户动作完全不同',
  );
  ok(`★ 结局二：B站 → 明说平台不许嵌，且不与"认不出平台"混用：「${blocked}」`);

  // ---- 结局 C：认不出链接 ⇒ 只说"只给原站入口"，**不能说平台不支持** ----
  const unknownRow = render([
    myLink({ platform: null, handle: null, url: 'https://example.invalid/watch/1' }),
  ]);
  assert.equal(hasFacade(unknownRow), false, '认不出平台的链接不能画门面');
  says(unknownRow, 'myLive.linkOnly', '★ 认不出平台时要给"只给原站入口"那句');
  assert.equal(
    unknownRow.includes(i18n.t('myLive.notSupported')),
    false,
    '★ 认不出平台**不能**说成"平台不支持" —— 那会让用户去改一个本来正确的链接',
  );
  // 兜底出口必须是**用户原样那条**（认不出平台时没有"按平台拼"的余地）
  assert.ok(
    unknownRow.includes('https://example.invalid/watch/1'),
    '认不出平台时，外链必须是用户原样那条（不能凭空拼一个）',
  );
  ok('★ 结局三：认不出平台 → 只说"只给原站入口"，且不与"平台不支持"混用');

  /*
   * ★★ 行内编辑（t37）：`updateMyLiveLink` 此前**零调用者** —— 贴错了只能删掉重贴。
   *
   * 可断言的部分是**入口存在**与**编辑态表单的初值/按钮文案**：
   *   · 入口：`MyLiveList` 每一行都有「改」（`myLive.editAction`）；
   *   · 编辑态：`MyLiveForm mode="edit"` 必须**带着这一行的原值**打开 ——
   *     否则用户点「改」看到两张空输入框，会以为自己的链接丢了；
   *   · 按钮：编辑态是「保存」而**不是**「添加」 —— 写错的话用户点下去会以为在新建。
   * ⚠️ 展开动作本身（点击 → 表单出现）是**交互**，不在静态渲染的射程内；
   *    这里覆盖的是"把 props 给对了会渲染成什么样"，交互那一半归浏览器层。
   */
  const editRow = render([
    myLink({ id: 'e1', url: 'https://www.twitch.tv/Somebody', title: '我的主播' }),
  ]);
  says(editRow, 'myLive.editAction', '★ 每一行都要有「改」这个入口（否则又只能删掉重贴）');

  const editForm = html(
    <MyLiveForm
      mode="edit"
      initial={{ url: 'https://www.twitch.tv/Somebody', title: '我的主播' }}
      busy={false}
      error={null}
      onSubmit={() => undefined}
      onCancel={() => undefined}
    />,
  );
  assert.ok(
    editForm.includes('value="https://www.twitch.tv/Somebody"'),
    '★ 编辑态必须**带着原链接**打开 —— 空输入框会让用户以为自己的链接丢了',
  );
  assert.ok(editForm.includes('value="我的主播"'), '★ 编辑态必须带上原来那个名字');
  says(editForm, 'myLive.saveAction', '★ 编辑态提交键是"保存"');
  /*
   * ⚠️ 反面：编辑态**不能**出现「添加」——两者同时出现时用户会分不清
   *    自己是在改还是在新加，而那正是"点错按钮"这一类问题的起点。
   */
  assert.equal(
    editForm.includes(i18n.t('myLive.addAction')),
    false,
    '编辑态不该出现"添加"（用户会以为自己在新加一条）',
  );
  ok('★ 行内编辑：入口在 + 初值带原文 + 提交键是"保存"，且不混用"添加"');

  /*
   * ★★ 变异探针（t37 验收第 5 条要求"断言必须能红"，并且要给出真实输出）。
   *
   * ⚠️ 用**显式对错标志**而不是 `assert.throws(() => assert.equal(...))`：
   *    后者在本脚本里只报 `Missing expected exception`，**说不清是哪一半坏的** ——
   *    "探针坏了"与"被探的东西坏了"在输出上长得一样（本会话反复吃这个亏）。
   *
   * 探针①：**把编辑入口去掉**（模拟"忘了把按钮渲染出来"）⇒ 入口断言必须失败。
   */
  const entryAssertFailsWithoutButton = (): boolean => {
    try {
      assert.ok(
        // 一条**没有**「改」的行（用普通产物代替）—— 上面那条断言此刻应当失败
        '<li class="mylive-row"><p>这一行没有按钮</p></li>'.includes(
          i18n.t('myLive.editAction'),
        ),
        '（探针内部：这一行没有「改」，上面那条应当失败）',
      );
      return false; // 没抛 ⇒ 说明那条断言没有区分力
    } catch {
      return true;
    }
  };
  assert.equal(
    entryAssertFailsWithoutButton(),
    true,
    '探针①必须失败：去掉「改」之后入口断言必须红（否则它没有区分力）',
  );
  ok('★ 变异探针①：去掉「改」入口 ⇒ 入口断言确实会失败');

  /*
   * 探针②：**把初值写死成别的链接**（模拟"没接上这一行"）⇒ 初值断言必须失败。
   */
  const initialAssertFailsOnHardcoded = (): boolean => {
    try {
      const hardcoded = html(
        <MyLiveForm
          mode="edit"
          initial={{ url: 'https://example.invalid/hardcoded', title: '写死的名字' }}
          busy={false}
          error={null}
          onSubmit={() => undefined}
          onCancel={() => undefined}
        />,
      );
      assert.ok(
        hardcoded.includes('value="https://www.twitch.tv/Somebody"'),
        '（探针内部：初值被写死时，这一条应当失败）',
      );
      return false;
    } catch {
      return true;
    }
  };
  assert.equal(
    initialAssertFailsOnHardcoded(),
    true,
    '探针②必须失败：初值写死之后初值断言必须红（否则它没有区分力）',
  );
  ok('★ 变异探针②：把初值写死 ⇒ 初值断言确实会失败');

  /*
   * ★ 能红证明（两个方向）。
   *
   * ⚠️ 这里**故意不用** `assert.throws(() => assert.equal(...), …)`：本脚本里
   *    实测它报了 "Missing expected exception" 却指不清是哪一半 —— 而
   *    "探针自己坏了"和"被探的东西坏了"在输出上长得一样（本会话已经吃过几次
   *    这种"守卫因为错误的原因通过/失败"的亏）。所以改成**显式的对错标志**：
   *    探针跑完必须**恰好**留下我预期的结论，错一种就当场报出是哪一种。
   */
  /*
   * ★ 能红证明：把"反面断言"写坏的两种情况，探针**必须**当场失败。
   *
   * ⚠️ 这里把对错标志算成"这条断言**会不会**抛"，然后断言**它不抛** ——
   *    因为被探的那条断言本来就是真的（B站那行确实不含"认不出平台"那句）。
   *    ⚠️ 我第一版把期望写成了 `true`（"探针必须失败"），逻辑正好反了：
   *    探针**抛了才说明**反面断言没区分力。这个反向错误在本脚本里当场被抓住，
   *    正是探针该有的样子 —— 记在这里，免得下一个人照抄错的那一版。
   */
  const wouldThrowOnBiliSayingLinkOnly = (): boolean => {
    try {
      assert.equal(
        biliRow.includes(i18n.t('myLive.linkOnly')),
        false,
        '（探针内部：B站那行确实不该出现"认不出平台"那句）',
      );
      return false;
    } catch {
      return true; // 抛了 ⇒ 反面断言没有区分力
    }
  };
  assert.equal(
    wouldThrowOnBiliSayingLinkOnly(),
    false,
    '探针说明反面断言有区分力：它是真的，所以不该抛',
  );

  const wouldThrowOnBiliEmbedding = (): boolean => {
    try {
      assert.equal(hasFacade(biliRow), true, '（探针内部：B站确实画不出门面）');
      return false;
    } catch {
      return true;
    }
  };
  assert.equal(
    wouldThrowOnBiliEmbedding(),
    true,
    '探针说明门面断言有区分力：B站画不出门面，所以"以为能嵌"这句必然抛',
  );

  ok('★ 能红证明：B站若被说成"认不出平台"或"以为能嵌"，上述两条断言必然失败');
}

console.log('');
console.log(`通过 ${pass} 项。`);
console.log('');
console.log('⚠️ 这个脚本验的是**渲染**：没有点击、没有请求、没有悬停。');
console.log('   要验交互（加/改/隐藏/删除、live_exists 指向那一行）需要 dev server + 浏览器。');
