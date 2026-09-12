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
import type { LiveChannel } from '@mcsr/shared/live';
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
console.log(`\n【${LANG}】直播卡：三种"嵌不出来"，各自说清为什么`);
// ---------------------------------------------------------------------------
{
  /*
   * ⚠️ 三条断言各自查**自己那一句**，而且都断言"另一种说法**没有**出现"。
   *    只断言"有提示"是没用的：把三种情况都说成同一句话时它照样通过，
   *    而那正是这次要防的错（编辑开了开关却不生效，却看到一句笼统的"不支持"）。
   */
  const twitch = html(
    <ul>
      {/*
        ⚠️ 平台的标识形状**不一样**：Twitch 是用户名（不带 @），
        YouTube 才用 `@handle`。第一版这里沿用了基础 fixture 的 `@Someone`，
        于是拼出来的链接是 `twitch.tv/%40Someone` —— 断言当场失败了。
        那是**测试的错**（假数据不真实），不是组件的错；
        但它正好说明这条断言是有效的：它比对的是真正的链接。
      */}
      <LiveCard
        channel={channel({ platform: 'twitch', handle: 'Someone', liveVideoId: '1234567' })}
      />
    </ul>,
  );
  assert.equal(hasFacade(twitch), false, 'Twitch 不该画出门面（宁可不嵌，也不要一个黑框）');
  assert.ok(twitch.includes(i18n.t('live.noEmbedPlatform')), 'Twitch 应当说"这个平台还没验证过"');
  assert.equal(
    twitch.includes(i18n.t('live.noEmbedNotChannelId')),
    false,
    'Twitch 那行不该同时出现"标识不是频道 ID"那句（那是第三种情况的说法）',
  );
  assert.ok(twitch.includes('https://www.twitch.tv/Someone'), 'Twitch 那行仍然要给频道链接');
  ok('★ Twitch → 没有门面，说的是"平台没验证"，且**不**混用第三种的说法');

  const noId = html(
    <ul>
      <LiveCard channel={channel({ liveVideoId: null, embedChannel: false })} />
    </ul>,
  );
  assert.equal(hasFacade(noId), false, '没视频 ID、没开频道嵌入时不该画门面');
  assert.ok(noId.includes(i18n.t('live.noEmbedNoId')), '应当说"还没有记录直播视频 ID"');
  assert.equal(
    noId.includes(i18n.t('live.noEmbedPlatform')),
    false,
    '这行不是"平台不支持"，不该出现那句',
  );
  ok('★ 没填视频 ID → 没有门面，说的是"没记视频 ID"，且不混用"平台"那句');

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
  ].join('\n');

  /*
   * ⚠️ 只扫**我这一轮碰过的命名空间**。扫全站会撞上类名之类的噪音，
   *    而一道会误报的检查很快就会被无视。
   *    类名用的是连字符（`live-card__name`），和 `live.title` 这种形状不同，
   *    所以这个正则不会误伤。
   */
  const prefixes = ['live.', 'liveManage.', 'enterVideo.'];
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
  ok('没有词条 key 泄漏（live / liveManage / enterVideo 三个命名空间）');

  // 反面：这个扫描器本身**能**发现泄漏 —— 否则上面那条是"因为找不到而通过"
  const fake = `x ${'live'}.thisKeyDoesNotExist y`;
  const probe = /live\.[a-zA-Z][A-Za-z]*/g.exec(fake);
  assert.ok(probe, '泄漏扫描器本身必须能命中一个明显不存在的 key（否则它是恒真的）');
  ok('泄漏扫描器自证：它能命中一个故意构造的假 key');
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

console.log('');
console.log(`通过 ${pass} 项。`);
console.log('');
console.log('⚠️ 这个脚本验的是**渲染**：没有点击、没有请求、没有悬停。');
console.log('   要验交互（加/改/隐藏/删除、live_exists 指向那一行）需要 dev server + 浏览器。');
