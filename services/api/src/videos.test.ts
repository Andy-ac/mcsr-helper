/**
 * 视频嵌入的 URL 与时间码。
 *
 * ---------------------------------------------------------------------------
 * 这组测试在防什么
 * ---------------------------------------------------------------------------
 * 嵌入 URL 拼错了**不会报错** —— 页面上就是一个白框，看起来像"网络问题"，
 * 而排查方向会被带偏到 CSP、Referer、跨域上去（那三个确实也会造成白框，
 * 所以更要命：真出问题时你分不清是哪一类）。
 *
 * 所以这里对每条 URL 都断言**具体的参数**，尤其是那几条
 * "传了也不会生效"的情况（B站的起始偏移）—— 那种必须被显式测到，
 * 否则我们会在界面上承诺一个做不到的事。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// VIDEO_ID_PATTERNS 从根导入：它住在 shared 的 constants.ts 里，
// 而 `@mcsr/shared/videos` 用它却**没有重新导出**它。
import { VIDEO_ID_PATTERNS } from '@mcsr/shared';
import {
  buildEmbedUrl,
  formatTimecode,
  formatTwitchTime,
  parseTimecode,
  platformSupportsStartOffset,
} from '@mcsr/shared/videos';

describe('★ 视频嵌入（Q21：B站/YouTube 为主，客户端内播放）', () => {
  describe('时间码解析与格式化', () => {
    it('三种写法都要接受', () => {
      assert.equal(parseTimecode('90'), 90, '纯秒数');
      assert.equal(parseTimecode('1:30'), 90, '分:秒');
      assert.equal(parseTimecode('1:02:33'), 3753, '时:分:秒');
    });

    it('⚠️ 冒号后面的段超过 59 要拒绝，而不是静默进位', () => {
      // '1:99' 若被当成 159 秒，用户填错了却看不出来 —— 视频照播，只是跳到别处
      assert.equal(parseTimecode('1:99'), null);
      assert.equal(parseTimecode('1:02:99'), null);
    });

    it('非法输入返回 null', () => {
      for (const bad of ['', '   ', 'abc', '1:2:3:4', '-5', '1.5', '1h2m3s']) {
        assert.equal(parseTimecode(bad), null, `${JSON.stringify(bad)} 应当被拒`);
      }
    });

    it('格式化：不足一小时不显示小时位', () => {
      assert.equal(formatTimecode(0), '0:00');
      assert.equal(formatTimecode(90), '1:30');
      assert.equal(formatTimecode(3753), '1:02:33');
    });

    it('★ Twitch 的 time 参数格式**和展示格式不同**', () => {
      // 混用这两个是一个很容易犯、又很难看出来的错：
      // Twitch 收到不认识的 time 会**忽略它** —— 视频照常播放，只是从 0 开始。
      assert.equal(formatTwitchTime(3753), '1h2m33s');
      assert.equal(formatTwitchTime(90), '1m30s');
      assert.equal(formatTwitchTime(33), '33s');
      assert.notEqual(formatTwitchTime(3753), formatTimecode(3753));
    });
  });

  describe('嵌入 URL', () => {
    it('YouTube：带 start 参数，不带 parent', () => {
      assert.equal(
        buildEmbedUrl('youtube', 'dQw4w9WgXcQ', null, 'mcsrhelper.com'),
        'https://www.youtube.com/embed/dQw4w9WgXcQ',
      );
      assert.equal(
        buildEmbedUrl('youtube', 'dQw4w9WgXcQ', 90, 'mcsrhelper.com'),
        'https://www.youtube.com/embed/dQw4w9WgXcQ?start=90',
      );
    });

    it('★ Twitch：parent 必填、video 必须带 v 前缀、time 用 h/m/s 形式', () => {
      const url = buildEmbedUrl('twitch', '2457619433', 3753, 'mcsrhelper.com');
      assert.ok(url !== null);
      const parsed = new URL(url);
      assert.equal(parsed.hostname, 'player.twitch.tv');
      /*
       * ★ `v` 前缀是**必需的**，官方文档原文：
       *   "In this context (the video player), the video ID must have a 'v' prefix."
       *
       * ⚠️ 这条断言以前写的是 `'2457619433'`（不带前缀）—— 也就是说这个测试
       *    当时**把 bug 钉住了**，而它看起来完全正常。
       *
       *    这个 bug 的表现是最难发现的那一种：漏前缀**不报参数错误**，
       *    播放器就是什么都不显示 —— 一个白框，像网络问题或者我们的页面坏了。
       *    而 `apps/web/src/dev/EmbedTest.tsx`（自检探针页）**一直是对的**
       *    （它拼的是 `?video=v...` 并引用了官方原文）。
       *
       *    所以教训不只是"补个前缀"：**探针页验证过 ≠ 线上那条路验证过**。
       *    探针是照着文档手写的，而生产代码走的是 buildEmbedUrl ——
       *    两边各写一遍同样的规则，其中一边漏了，探针是发现不了的。
       */
      assert.equal(parsed.searchParams.get('video'), 'v2457619433');
      assert.equal(parsed.searchParams.get('parent'), 'mcsrhelper.com');
      assert.equal(parsed.searchParams.get('time'), '1h2m33s');
    });

    it('★ Twitch 的 v 前缀只能加一次（库里存的 id 本身不带前缀）', () => {
      /*
       * 反面：加了前缀之后，如果哪天有人「顺手」在存库或解析链接时也加一次，
       * 这里就会变成 `vv2457619433`。三个地方各加一次前缀是这类 bug 的典型形状
       * —— 每一处看起来都对，合起来错。
       * 库里存的形状由 `VIDEO_ID_PATTERNS.twitch = /^\d{6,12}$/` 保证（纯数字），
       * 而这条断言钉住"拼 URL 时加且只加一次"。
       */
      const url = buildEmbedUrl('twitch', '2457619433', null, 'mcsrhelper.com');
      assert.ok(url !== null);
      const video = new URL(url).searchParams.get('video') ?? '';
      assert.equal(video.startsWith('vv'), false, '前缀被加了两次');
      assert.equal(video, 'v2457619433');
      // 而且它和 VIDEO_ID_PATTERNS 的关系是"加前缀之后才合规"，
      // 不是"存进去时就带前缀"—— 后者会让链接解析那一整条路都失败
      assert.equal(VIDEO_ID_PATTERNS.twitch.test('2457619433'), true);
      assert.equal(VIDEO_ID_PATTERNS.twitch.test('v2457619433'), false);
    });

    it('⚠️ Twitch 没有 origin 时宁可不嵌，也不发一个注定被拒的请求', () => {
      assert.equal(buildEmbedUrl('twitch', '2457619433', null, ''), null);
    });

    it('★ Twitch：parent 里不能带协议或路径（Twitch 按**域名**校验）', () => {
      /*
       * `parent` 的取值必须是主机名。传 `https://mcsrhelper.com` 或
       * `mcsrhelper.com/path` 都会被拒 —— 而拒绝的表现同样是一个白框。
       *
       * 这一条钉的是**调用方**的约定：`buildEmbedUrl` 只负责把它拼进去，
       * 不负责清洗（清洗会让"传错了"这件事变得不可见）。
       * 界面那边传的是 `location.hostname`，正好是合规的形状。
       */
      const url = buildEmbedUrl('twitch', '2457619433', null, 'mcsrhelper.com');
      assert.ok(url !== null);
      assert.equal(new URL(url).searchParams.get('parent'), 'mcsrhelper.com');
      // 反面：传一个带协议的进去时，它会被**原样**传出（不做静默修正）——
      // 这样错了能看出来，而不是被我们悄悄改成一个"看起来能用"的值
      const bad = buildEmbedUrl('twitch', '2457619433', null, 'https://mcsrhelper.com');
      assert.ok(bad !== null);
      assert.equal(new URL(bad).searchParams.get('parent'), 'https://mcsrhelper.com');
    });

    it('★ B站：传了起始偏移也**不会**出现在 URL 里（该平台不支持跳转）', () => {
      const url = buildEmbedUrl('bilibili', 'BV1xx411c7mD', 3753, 'mcsrhelper.com');
      assert.ok(url !== null);
      const parsed = new URL(url);
      assert.equal(parsed.hostname, 'player.bilibili.com');
      assert.equal(parsed.searchParams.get('bvid'), 'BV1xx411c7mD');
      assert.equal(parsed.searchParams.get('autoplay'), '0');
      // 反面断言：这两个参数都不该出现。出现了就意味着我们在界面上
      // 承诺了一件 B站做不到的事，而且没人会发现。
      assert.equal(parsed.searchParams.get('start'), null);
      assert.equal(parsed.searchParams.get('t'), null);
    });

    /**
     * ★★ 弹幕**开着**（2026-09-19，用户第 8 条）—— 这一条是**推翻旧裁决**换来的，
     *    所以它必须自己有一条断言（而不是靠渲染脚本那条"地址逐字符相等"顺带钉住：
     *    那条住在 `apps/web/scripts/liverender.tsx` 里，是**另一条线**的文件，
     *    而这个 URL 构造器是全站四条嵌入路径共用的）。
     *
     * ⚠️★ 为什么值是 `'1'` 而不是"不传"：`danmaku` 是官方表里的 **boolean**
     *    （"`false` 表示关闭弹幕，其他表示默认值"），而播放器页源码在它为 false 时
     *    `featureList.add('noDanmaku')` ⇒ **连弹幕数据都不取**（开关根本不存在）。
     *    显式写 `'1'` 是为了让下一个读的人**一眼看见**我们的选择 ——
     *    不写这一格也能得到同样的行为，但那要靠读者自己去查默认值。
     * ⚠️ 反面控制（`notEqual 0`）不是多余的：写成 `'0'` 正是被推翻的那一版，
     *    而它的表现是"用户报告的那个缺陷回来了"，没有任何别的断言会红。
     */
    it('★★ B站：弹幕参数必须是「开」（`danmaku=1`，不是被推翻的 `0`）', () => {
      const url = buildEmbedUrl('bilibili', 'BV1xx411c7mD', null, 'mcsrhelper.com');
      assert.ok(url !== null);
      const danmaku = new URL(url).searchParams.get('danmaku');
      assert.equal(
        danmaku,
        '1',
        'B站 的嵌入地址必须显式带 `danmaku=1`：`0` 会让播放器**不取弹幕数据**（连开关都没有）—— ' +
          '被推翻的那条旧裁决与它的代价写在 `packages/shared/src/videos.ts` 的 bilibili 分支上',
      );
      assert.notEqual(danmaku, '0', '`danmaku=0` 就是用户第 8 条报的那个缺陷本身');
    });

    /**
     * ⚠️ `high_quality` / `as_wide`**一个都不许加**（2026-09-19 实测）：
     *    它们不在官方参数表里、也不在播放器页的 `paramType` 表里 ⇒ 今天**完全无效**
     *    （而那个页面**永远**回 200，所以"加进去没坏"这种验证方式什么也证明不了）。
     *    这条断言钉的是"别顺手加"：加进去不会报错、也不会有任何界面变化 ——
     *    只有下一个人读代码时才知道那两个参数骗了他。
     */
    it('★ B站：不许顺手加 `high_quality` / `as_wide`（实测它们今天完全无效）', () => {
      const url = buildEmbedUrl('bilibili', 'BV1xx411c7mD', null, 'mcsrhelper.com');
      assert.ok(url !== null);
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get('high_quality'), null);
      assert.equal(parsed.searchParams.get('as_wide'), null);
      // 反面控制：这一串确实带着参数（否则上面两条在"空地址"上恒真）
      assert.equal(parsed.searchParams.get('bvid'), 'BV1xx411c7mD');
    });

    it('★ 平台是否支持跳转 —— 界面靠它决定要不要提示"该平台不支持"', () => {
      assert.equal(platformSupportsStartOffset('youtube'), true);
      assert.equal(platformSupportsStartOffset('twitch'), true);
      assert.equal(platformSupportsStartOffset('bilibili'), false);
    });
  });
});
