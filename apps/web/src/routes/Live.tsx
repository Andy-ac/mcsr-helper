import type { UserLiveLink } from '@mcsr/shared/live';
import { filterLiveChannels } from '@mcsr/shared/live';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { em } from '@/components/Emphasis';
import { LiveCard } from '@/components/LiveCard';
import { LiveManagePanel } from '@/components/LiveManagePanel';
import { MyLiveForm } from '@/components/MyLiveForm';
import { MyLiveList } from '@/components/MyLiveList';
import {
  createMyLiveLink,
  deleteMyLiveLink,
  fetchLiveChannels,
  fetchLiveChannelsFresh,
  fetchMyLiveLinks,
  updateMyLiveLink,
} from '@/lib/api';
import { useApiErrorText, useAuth } from '@/lib/auth';
import { useCan } from '@/lib/capabilities';
import { useAsync } from '@/lib/useAsync';

/**
 * 「直播」—— `/live`。一份**编辑维护的 MCSR streamer 名单**。
 *
 * ---------------------------------------------------------------------------
 * 它和「娱乐视频」的分工（两个板块都是"视频"，所以必须说清）
 * ---------------------------------------------------------------------------
 *   · `/videos` 娱乐视频：**rolling** —— 任何登录用户都能贴，贴了就可见，
 *     内容一直在变（Q6）。
 *   · `/live` 直播：**比较固定** —— 一份少数人维护的名单，变动很慢。
 *
 * 形态不同，权限形状也就不同：那边是 UGC（`video.submit`），
 * 这边是编辑维护（只有 `live.manage`）。服务端也只有这一个能力，
 * 没有 `live.submit` —— 详见 `services/api/src/routes/live.ts` 的头注释。
 *
 * ---------------------------------------------------------------------------
 * ★★ 这一页**现在检测直播状态了**（2026-09-18 用户第 10 条推翻了原来的设计）
 * ---------------------------------------------------------------------------
 * 这一节原来写着：「这一页**不检测直播状态**（这是设计里明确排除的）—— 没有 API key、
 * 不轮询，所以**没有「直播中」标记**」，并且点明页面上那句"这里记的是频道，
 * 不是现在谁在播"是这一页**能一直保持诚实的唯一原因**。
 *
 * 用户第 10 条要的正是那个标记（外加按人数降序、显示人数、搜索栏）⇒ 那条推理**被换掉**：
 *   · 现在**有人查了**：`services/api/src/live-status.ts` 这个 oneshot 作业由
 *     `deploy/mcsr-helper-live-status.timer` 每 **3 分钟**拉起一轮，把
 *     `is_live` / `viewer_count` / `live_checked_at` 写进 `live_channels`（迁移 023）；
 *   · 页面上的「直播中」徽章与人数来自 `GET /api/live` 的那三个字段；
 *   · 那句承诺**不是删掉，而是改成仍然为真的说法**（`live.recordsChannels`）：
 *     它现在明说"每几分钟查一次、可能晚几分钟"，而且点名**只查 Twitch 与 B站**
 *     —— 因为**迟到的标记 + 一句"实时"就是一句新的谎**，而"没查"与"没在播"
 *     在界面上长得一样（都是没有标记）。代词条注释里有完整的代价账。
 *
 * ⚠️ 这一页上**唯一**一处"实时性"的账（谁要改节拍先看这里）：
 *    3 分钟（作业）+ 60 秒（`max-age`）+ 300 秒（`stale-while-revalidate`）
 *    ⇒ 徽章最多可以旧到 **9 分钟**。这笔账的正文在 `routes/live.ts` 的注释里。
 *
 * ---------------------------------------------------------------------------
 * 编辑界面挂在同一页上，不是一条独立路由
 * ---------------------------------------------------------------------------
 * 判据是权限（`live.manage`，editor 及以上），和侧边栏、服务端读的是
 * **同一个权限矩阵**。放在同一页的理由见 `LiveManagePanel` 的文件头。
 */
export function Live() {
  const { t } = useTranslation();
  const canManage = useCan('live.manage');

  /*
   * 公开列表的刷新钥匙：编辑改完之后要通过它重新拉一次，
   * 否则编辑会看到"我加的东西没出现"，然后怀疑自己没保存成功。
   */
  const [refreshKey, setRefreshKey] = useState(0);

  /*
   * ★ 搜索框（用户第 10 条的后半句："允许用户在搜索栏搜索直播"）。
   *
   * ⚠️★ **只在本地筛，不发请求、不加服务端参数**（`filterLiveChannels` 是纯函数）。
   *    这一页一共 184 行（2026-09-18 生产实测），一次 GET 就全在手上；
   *    把词发给服务端只会多一套参数、多一条缓存规则，换不到任何东西。
   * ⚠️ 与「排行榜」那一栏的搜索**逐字同形**（`Ranked.tsx:245` 的 `liveQuery`）：
   *    同样是 `useState` + 纯函数筛手上那份列表。
   *    ⚠️★ **没有 300ms 防抖**（`ResourceList.tsx:55-76` 那一套），而这是有意的：
   *    那个防抖存在的理由是"别让每一次按键都变成一个请求"，而这里没有请求 ——
   *    对一份内存里的数组延迟 300 ms 只是白白让输入看起来卡。
   *    代价（认下）：搜索词**不写进 URL** ⇒ 不能分享/收藏一个"筛好的"链接、
   *    刷新后回到全部。与排行榜那一栏同一个取舍。
   */
  const [query, setQuery] = useState('');

  /*
   * ⚠️ 编辑和访客拿这个列表的方式**必须不一样**：
   *   · 访客：`fetchLiveChannels` —— 吃那条 60 秒的公共缓存（名单变动很慢，应当缓存）；
   *   · 编辑：`fetchLiveChannelsFresh` —— 绕开缓存。
   *
   *    不分开的话，"改完刷一次"刷出来的就是编辑自己浏览器里那份旧的，
   *    表现是"我明明隐藏了，公开列表里怎么还有"（详见 `fetchLiveChannelsFresh`
   *    的注释和里面的实测数据）。下面那个 refreshKey 存在的**全部意义**
   *    就是让编辑看到改动生效，所以那条路上不能吃缓存 —— 否则这个 key 等于没有。
   */
  const list = useAsync(
    (signal) => (canManage ? fetchLiveChannelsFresh(signal) : fetchLiveChannels(signal)),
    [refreshKey, canManage],
  );

  /*
   * ⚠️★ **前端不许再排一遍**：用户要的顺序（在播的按人数降序在前）由**服务端**给
   *    （`live.ts` 的 `LIVE_ORDER_BY`），这里 `map` 就是它的原样输出。
   *    在这里补一次 `sort` 会变成第二份真相 —— 而两份顺序漂移时，页面上看到的
   *    与被断言的那个不一样，且没有任何门禁会发现。
   * ⚠️ 这一页今天**没有**分页、没有客户端分组（整份列表一次渲染）⇒ 筛完之后
   *    剩下的行仍然是服务端那个顺序（筛不改变相对次序，`filterLiveChannels` 不排序）。
   */
  const items = list.status === 'ok' ? list.data.items : [];
  const shown = filterLiveChannels(items, query);

  return (
    <>
      <header className="pagehead">
        <h1 className="pagehead__title">{t('live.title')}</h1>
        <p className="pagehead__sub">{t('live.subtitle')}</p>
      </header>

      {/*
        ★ 这两句话放在列表**前面**，不是后面。
        它们是这一页的"说明书"：上面那句说清"这一页记的是什么、谁在替我们查、
        查到的东西有多新"，下面那句防止有人以为它和娱乐视频是重复的。
        放在列表后面的话，只有滚到底的人才读得到 —— 而那时他已经
        对"为什么这几个频道有个绿色标记"形成了自己的猜测。
        ⚠️ 上面那句在 2026-09-18 **被改写过**（原来是"这里记的是频道，
        不是现在谁在播"）：词条注释里有完整的来龙去脉与代价账。
      */}
      <p className="live__explain">{em(t('live.recordsChannels'))}</p>
      <p className="live__explain live__explain--muted">{t('live.relationToVideos')}</p>

      {list.status === 'loading' ? <p className="state">{t('common.loading')}</p> : null}

      {list.status === 'error' ? (
        <div className="state state--error">
          <p>
            {t('live.loadFailed')}：{list.error}
          </p>
        </div>
      ) : null}

      {/*
        ★ 搜索框（用户第 10 条）。
        ⚠️ 只在**名单里有东西**时渲染：一条都没有的时候，一个搜不到任何东西的输入框
           看起来像坏掉的控件（那正是空态那两句话要解释的事）。
        ⚠️ 类名复用全站现成的那一套（`.filters` / `.filters__search`），与排行榜那一栏
           同形 —— 本仓样式是全局的，能不加新类名就不加。
        ⚠️ 标签走 `sr-only` 且与占位符**同一个词条**：占位符在输入第一个字之后就没了，
           而它是这个控件**唯一**的名字（`RankedPanels.tsx:912-920` 同一条）。
      */}
      {list.status === 'ok' && items.length > 0 ? (
        <div className="filters">
          <div className="filters__search">
            <label className="sr-only" htmlFor="live-q">
              {t('live.searchLabel')}
            </label>
            <input
              id="live-q"
              type="search"
              value={query}
              placeholder={t('live.searchLabel')}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
      ) : null}

      {list.status === 'ok' ? (
        items.length === 0 ? (
          /*
           * ⚠️ 空状态要读起来像"还没有记录"，**不是**"出错了"。
           *    这份名单本来就可能只有几条、甚至一条都没有（它刚上线时就是这样），
           *    而一个写着"加载失败"的空状态会让人来问我们是不是坏了。
           */
          <div className="state state--empty">
            <p className="state__title">{t('live.empty')}</p>
            <p className="state__hint">{t('live.emptyHint')}</p>
          </div>
        ) : shown.length === 0 ? (
          /*
           * ★ 筛没了是**另一句话**（`live.searchEmpty`）：名单里**有**东西，
           *   只是这一个词没命中。写成上面那句"还没有记录任何频道"的话，
           *   用户会以为这一页空了 —— 而他刚刚才看见过那些频道。
           */
          <div className="state state--empty">
            <p className="state__hint">{t('live.searchEmpty')}</p>
          </div>
        ) : (
          <ul className="live-list">
            {shown.map((channel) => (
              <LiveCard key={channel.id} channel={channel} />
            ))}
          </ul>
        )
      ) : null}

      {/*
        ★ 「我的链接」（需求④=B）—— **所有登录用户**都能用自己的。
        ⚠️ 它**不是**公开名单的一部分：公开名单由编辑维护（`live.manage`），
           而这一块是私人的（只 `requireAuth`，没有新能力、不要求邮箱验证）。
           两件事放在同一页是有意的 —— 用户在这里看"谁在播"，顺手记"我想看的"。
        ⚠️ 判据是**登录**，不是权限：所以传 `loggedIn` 给展示组件，
           未登录时它画的是"去登录"那句，而**不是**空列表（空列表会被读成"我一条都没有"）。
      */}
      <MyLiveSection />

      {/*
        编辑界面：**同一页**，用权限决定显不显示（和「提交」长在各自版块里
        是同一条约定 —— 见 components/Layout.tsx 里那段注释）。
        界面判断只影响"显不显示"，不是安全边界：真正的拦截在服务端的
        `requireCapability('live.manage')`，手动发请求会得到 403。
      */}
      {canManage ? <LiveManagePanel onChanged={() => setRefreshKey((k) => k + 1)} /> : null}
    </>
  );
}

/**
 * 「我的链接」这一块 —— 取数、增删都在这儿，展示交给 `MyLiveList`（纯展示）。
 *
 * ⚠️ 为什么单独一个内部组件而不是直接写在 `Live` 里：它自己要有**取数 + 增删 +
 *    局部错误**三样状态，塞进 `Live` 会让"公开名单"和"私人列表"的取数混在一起
 *    （两者刷新时机、鉴权、失败文案都不同）。
 *
 * ⚠️ 未登录时**根本不调接口**（不是调了再过滤）：那条路会稳定回 401，
 *    而把 401 渲染成"加载失败"会让人以为我们的服务坏了。
 */
function MyLiveSection() {
  const { t } = useTranslation();
  const auth = useAuth();
  const errorText = useApiErrorText();

  /*
   * ⚠️ 嵌入判定要的是**页面自己的 host**（Twitch 的 `parent` 就是它）。
   *    `location` 在 SSR / 脚本环境里可能不存在，所以走 `?.` ——
   *    与 `LiveCard` / `ClickToPlayEmbed` 同一写法（三处都不能漏 `?.`）。
   */
  const origin = globalThis.location?.hostname ?? '';

  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const mine = useAsync(
    (signal) => (auth.user ? fetchMyLiveLinks(signal) : Promise.resolve({ items: [] })),
    [reloadKey, auth.user],
  );

  /*
   * ★★ t41 返工（verifier 在 t40 上复测判未达标）：**重拉期间不能再让 `items` 塌成 `[]`。**
   *
   * ⚠️⚠️ 这里踩的是一个比"整块消失"**更糟**的坑，值得写清楚：
   *    `useAsync` 每次重跑都**先把状态置回 `loading`、旧数据被丢掉**（`useAsync.ts:34`），
   *    所以原来这行的三目在重拉期间会给出 **`[]`**。
   *    · t40 之前：那个状态**什么都不渲染** ⇒ 看起来"整块消失"（难看的空档）；
   *    · t40 之后：有 `hasLoaded` 就渲染列表 ⇒ `MyLiveList` 拿到 **0 条**
   *      ⇒ 它渲染**空态那句话**「还没有添加过。」—— 而那句正是它自己的注释写明
   *      **"不能给可能有数据的人看"**的一句。⇒ verifier 的原话：**"从『没东西』变成『说错话』"。**
   *    ⚠️ 而且窗口**等于整次重拉时长**：扣住 `GET /api/live/mine` 的响应 700ms
   *      ⇒ 空态窗口 727ms / 715ms（慢网络下就是几百毫秒的假话）。
   *
   * ⇒ 修法：用 ref **保留"上一次成功拿到的那份 rows"**，重拉期间照旧渲染它（再叠加 `patches`）。
   *    · `status === 'ok'` 时才刷新这份快照 ⇒ **不会闪回旧值**（新数据一到就整份替换）；
   *    · 首次加载仍走骨架（`hasLoaded.current === false`）——
   *      那时"一条都没有"与"还没拿到"本来就不该混淆。
   */
  const lastOkItems = useRef<UserLiveLink[]>([]);
  if (mine.status === 'ok') lastOkItems.current = mine.data.items;

  /*
   * ⚠️ 只有**首次成功之后**才用这份快照：否则首次加载时 `shown` 会是 `[]`，
   *    而调用方那层判断（`hasLoaded.current`）此时还是 false ⇒ 走骨架，不会说错话。
   */
  const items: UserLiveLink[] = auth.user
    ? mine.status === 'ok'
      ? mine.data.items
      : lastOkItems.current
    : [];

  /**
   * ★ 改完**就地更新**（t37 验收第 2 条），而不是重拉整页。
   *
   * ⚠️ 为什么需要它：`useAsync` 每次重跑都先把状态置回 `loading`、旧数据被丢掉
   *    （`useAsync.ts:34`）⇒ 只调 `setReloadKey` 会让整块列表**闪一下"加载中"**，
   *    那既不叫"就地更新"，也是用户能直接看到的一次抖动。
   *
   * ⚠️ 为什么**还要**在后台静默重拉：`platform` / `handle` 是服务端**从新链接重新解析**
   *    出来的（YouTube 换成 Twitch，平台就变了，而"能嵌/不能嵌 + 那句解释"全跟着变），
   *    本地只能先近似地改 `url`/`title`。⇒ 先用本地补丁给**即时反馈**，
   *    再让服务端把**派生字段**补齐 —— 这才是"就地更新"与"派生字段必须由服务端算"两件事
   *    都成立的做法。
   */
  const [patches, setPatches] = useState<Record<string, { url: string; title: string | null }>>({});

  /*
   * ★ F2 的关键：**「是否已经成功取到过一次」** —— 用 ref 而不是 state。
   *
   * ⚠️ 用 ref 的理由：它只影响"首次要不要画骨架"，**不需要触发重渲染**；
   *    写成 state 会多一次无意义的渲染，而这块正在治的正是"多余的一次渲染
   *    会让列表闪一下"。
   * ⚠️ 判据**不能**是 `items.length > 0`：用户"确实一条都没有"是**合法终态**，
   *    与"还在加载"必须区分开 —— 否则空列表的用户会永远看到"加载中"。
   */
  const hasLoaded = useRef(false);
  if (mine.status === 'ok') hasLoaded.current = true;

  /*
   * ★★ t41：**补丁活到"服务端新数据真的到了"为止**（见 `save` 里那段三种清法对比）。
   *
   * ⚠️ 判据这里踩过一个坑，写下来：`useAsync` 在 loading 期间**保留上一次的 `data`**
   *    ⇒ 不能只看 `status === 'ok'` 就清补丁 —— 那一刻 `data` 很可能还是**旧的一份**，
   *    清掉补丁就把旧值放回屏幕上了（正是它要防的事）。
   *    ⇒ 所以额外记一个「这次重拉到哪里为止」的标记：状态**离开 `ok`** 时说明新一轮
   *      开始了，之后**再次回到 `ok`** 才说明新数据落定、可以安全清补丁。
   *    ⚠️ 首次挂载时 `status === 'loading'`、`hasLoaded` 仍为 false ⇒ 不标记，
   *      否则首次加载会被当成"一次重拉结束"而误清（虽然那时本来也没补丁）。
   */
  const refetching = useRef(false);
  if (mine.status !== 'ok' && hasLoaded.current) refetching.current = true;
  /*
   * ★★ t41：`rev` —— 行内表单保存之后，用它让那一行**重挂载**（收起编辑表单）。
   *
   * ⚠️ 为什么必须显式做：行的"展开"态是 `MyLiveRow` 的**局部 state**，父组件改不到。
   *    t40 时代它靠"重拉期间列表整块卸载"这个**副作用**顺便复位；t41 把卸载修掉之后
   *    那个复位就没了 ⇒ 保存后表单一直开着，`03-browser-live.mjs` 从 109/0 掉到 99/10。
   *    ⇒ 用 `rev` 把"该收起来了"这件事**显式**表达出来（见 `MyLiveList` 的 key）。
   */
  const [rev, setRev] = useState(0);
  /*
   * ⚠️ 依赖里用 `mine.status === 'ok' ? mine.data : null`，**不是 `mine.data`** ——
   *    后者在联合类型上不成立（`data` 只属于 `ok` 那一支），TS 会直接报错。
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: mine.status 是**纯触发器** —— 它标记「这一轮重拉的开始与结束」，effect 体内只读 ref
  useEffect(() => {
    if (refetching.current && mine.status === 'ok') {
      refetching.current = false;
      setPatches({});
    }
  }, [mine.status, mine.status === 'ok' ? mine.data : null]);

  const shown: UserLiveLink[] = items.map((it) => {
    const patch = patches[it.id];
    if (!patch) return it;
    return { ...it, url: patch.url, title: patch.title };
  });

  async function add(input: { url: string; title?: string }) {
    setFailure(null);
    setBusy(true);
    try {
      await createMyLiveLink(input);
      // 加完立刻重拉：列表是服务端算出来的（platform/handle 由它解析），不能本地拼一行
      setReloadKey((k) => k + 1);
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  /**
   * 保存某一行的改动（t37）。
   *
   * ⚠️ 两步走（见上面 `patches` 的说明）：
   *   ① **就地更新** —— 先把 `url`/`title` 打上本地补丁，给用户即时反馈，
   *      而且不闪 `loading`（验收第 2 条要的就是这个）；
   *   ② **后台静默重拉** —— `platform` / `handle` 是服务端**从新链接重新解析**出来的
   *      （YouTube 换成 Twitch 平台就变了，而"能嵌/不能嵌 + 那句解释"全跟着变），
   *      本地补丁**不碰**派生字段，所以必须让服务端把那一行补齐。
   *      补丁在重拉成功后才清掉（见下面的 `patches` 清理 effect），否则会有一帧"旧平台判定 + 新链接"。
   */
  async function save(id: string, patch: { url: string; title: string | null }) {
    setFailure(null);
    setSavingId(id);
    try {
      await updateMyLiveLink(id, patch);
      /*
       * ① **就地更新**：立刻把这一行换成新值 —— 用户马上看到自己改的东西，
       *    而且**不闪 loading**（验收第 2 条要的就是这个）。
       * ② 再重拉一次，让服务端把 `platform` / `handle` 这些**派生字段**补齐
       *    （把 YouTube 换成 Twitch，平台就变了，"能嵌/不能嵌 + 那句解释"全跟着变）。
       *
       * ⚠️ 补丁的清理时机是这段代码里**最容易写错**的一处（三个错法我都试过，代价各不相同）：
       *    · `useEffect` 盯 `mine.status === 'ok'` 清 ⇒ 会在**旧数据仍为 ok 的那一帧**
       *      就清掉补丁，列表先闪回旧值、新值一个 RTT 后才到 —— 正好把"就地更新"抵消掉；
       *    · `save` 里 `await` 第二次 `fetch` 再清 ⇒ 多发一次请求，且与 `useAsync`
       *      那次拉取的返回顺序不确定；
       *    · ★★ **`setTimeout(0)` 在一次提交后就清** ⇒ t40 时代"碰巧能用"：那时候
       *      列表在 `loading` 期间**整块不渲染**，所以清掉补丁也没有旧值可闪。
       *      但 t41 改成"重拉期间继续渲染上一份 rows"之后，**它立刻变成真缺陷**：
       *      补丁一清 → 列表拿 `lastOkItems`（**旧标题**）渲染 → 用户刚保存的名字闪回旧的。
       *      实测代价：`03-browser-live.mjs` 从 **109 passed / 0 failed** 掉到
       *      **99 / 10**（"the row shows the NEW name immediately" 失败，并连带打乱后续删除步骤）。
       *    ⇒ 最终做法（t41）：**让补丁活到"服务端的新数据真的到了"为止** —— 见下面的
       *      `patches` 清理 effect（它按"数据是否已重新到位"清，而不是按"过了几帧"清）。
       */
      setPatches((p) => ({ ...p, [id]: patch }));
      /*
       * ★★ t41：**这一行该收起来了。**
       *
       * ⚠️ 为什么必须显式做：行内表单的展开态（`editing`）是 `MyLiveRow` 的**局部 state**，
       *    父组件改不到；t40 时代它靠"重拉期间整块卸载"这个**副作用**顺便复位，
       *    而 t41 把卸载修掉之后那个偶然复位就没了 ⇒ 保存后表单**一直开着**
       *    （`03-browser-live.mjs` 因此从 109/0 掉到 99/10：那一行此刻是表单、
       *    不是展示态，`the row shows the NEW name immediately` 拿到 `null`）。
       *    ⇒ `rev + 1` ⇒ `MyLiveRow` 的 effect 收起编辑表单（见那里的注释）。
       */
      setRev((r) => r + 1);
      setReloadKey((k) => k + 1);
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setSavingId(null);
    }
  }

  async function remove(id: string) {
    setFailure(null);
    setDeletingId(id);
    try {
      await deleteMyLiveLink(id);
      setReloadKey((k) => k + 1);
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="mylive" aria-label={t('myLive.title')}>
      <h2 className="mylive__title">{t('myLive.title')}</h2>

      {/*
        ★ 隐私说明（2026-09-13，用户原话：「明确说明是给自己看的，不会公开让别人看到」）。

        ⚠️ 位置是刻意的：**在标题下面、且在登录判断之外** —— 无论写没写链接、
           登录没登录，这句话都在。放到列表里或表单旁边都不行：
           · 放进列表 ⇒ 一条都没添加时（最需要知道这件事的那一刻）它反而不在；
           · 放进表单 ⇒ 只有已登录的人看得到，而"别人能不能看到"正是**还没敢写**的人在问。

        ⚠️ 它与公开名单（`live_channels`）**不是一回事**，文案里已写明"不进公开的直播名单"。
           这份是 `user_live_links`，每个查询都按 `user_id` 收口（见 zh-CN 词条上的注释）。

        ⚠️ `check:live` 里有一条**源码级**断言盯着这个 `<p>` 真的渲染 `t('myLive.privacy')`
           （`Live.tsx` 是路由、要取数，node 渲染脚本画不出整页，所以这里只能用源码形状守）。
           动这行之前先看那条断言。
      */}
      <p className="mylive__privacy">{t('myLive.privacy')}</p>

      {auth.loading ? <p className="state">{t('common.loading')}</p> : null}

      {!auth.loading && auth.user ? (
        <MyLiveForm
          busy={busy}
          error={failure}
          /*
           * ⚠️ 新增态只可能给 `title: string | undefined`（"没起名字"= **不传这个键**），
           *    不会是 `null` —— `null` 是**编辑态清空**的语义，只出现在 `save` 那条路上。
           *    所以这里按 `UserLiveLinkInput` 的形状收窄，而不是把 `null` 混进来。
           */
          onSubmit={(input) => {
            /*
             * ⚠️ 逐步取值再拼，而不是把 `input` 直接传下去：可选属性上的
             *    `!== null` 收窄**不会**传导到整个对象（`input` 仍是
             *    `title?: string | null | undefined`，`add` 只收 `string | undefined`）。
             *    顺手在这里把"没起名字"落实成**不传这个键**。
             */
            const title = input.title;
            if (title === null || title === undefined) {
              void add({ url: input.url });
              return;
            }
            void add({ url: input.url, title });
          }}
        />
      ) : null}

      {/*
        ⚠️ 取数失败单独说，**不并进**上面那个表单的 error：
           表单的错误是"你这次提交没成"，而这条是"列表没拿到" ——
           混在一起会让用户去改一个本来正确的链接。
      */}
      {auth.user && mine.status === 'error' ? (
        <div className="state state--error">
          <p>
            {t('live.loadFailed')}：{mine.error}
          </p>
        </div>
      ) : null}

      {/*
        ★★ t41 / F3（t40 引入）：这里**原来还有一块** `{auth.loading ? <p>加载中…</p> : null}`
        —— 与上面（登录态判断那段）的那一块**在同一条渲染路径上**，于是 `auth.loading`
        为真时 `.mylive` 里会渲染出 **「加载中… 加载中…」两遍**（verifier 扣住
        `/api/auth/me` 拉长窗口后确定性复现，连续 8 个样本）。⇒ **删掉这一块**，只保留上面那一处。
      */}

      {/*
        ★★ F2（t38 实测）：**后台重拉期间列表不能消失**。

        原来的写法是 `mine.status === 'loading' ? null : <MyLiveList …/>` ——
        而 `useAsync` 每次重跑（`setReloadKey`）都会**先把状态置回 `loading`**
        （`useAsync.ts:34`）⇒ 行内保存后的整块列表会**消失 25–75ms**（实测 6 轮里 5 轮
        出现 1–3 个「0 行」样本）。那不是"更新中"的视觉暗示，而是**页面看起来塌了一块**。

        ⚠️ 两头都要满足（t37 当初刻意选「渲染 null」正是为了避免其中一个）：
        · **不能消失** ⇒ 有数据时即使正在重拉也要继续画；
        · **不能闪回旧值** ⇒ 用 `patches` 里的新值渲染，而不是等重拉结果
          （`save` 在同一个事件处理器里先写补丁再触发重拉，所以不存在"旧值一帧"）。

        ⚠️ **只有首次取数**才不画列表（那时 `items` 是空数组，画了就会先闪一下
           "还没有添加过"）；那次之后**永不再摘掉列表**。
           `hasLoaded` 用 ref 而不是 `items.length > 0`：用户**确实一条都没有**是
           合法终态，与"还在加载"必须能区分开。
        ⚠️ `mine.status === 'error'` 时同样**保留列表**：那说明这次重拉失败了，
           而**旧数据仍在手上** —— 把它换成一片空白或"加载失败"是把一次失败
           放大成"列表没了"。取数失败由上面那块提示单独说明（两者不混用）。
      */}
      {hasLoaded.current ? (
        <MyLiveList
          items={shown}
          loggedIn={auth.user !== null}
          origin={origin}
          onDelete={(id) => void remove(id)}
          onEdit={(id, patch) => void save(id, patch)}
          rev={rev}
          deletingId={deletingId}
          savingId={savingId}
        />
      ) : (
        <p className="state">{t('common.loading')}</p>
      )}
    </section>
  );
}
