import { VIDEO_PLATFORMS, type VideoPlatform } from '@mcsr/shared';
import { DEFAULT_PAGE_SIZE } from '@mcsr/shared/resources';
import type { TrackedCreator, TrackedCreatorSummary, TrackPlatform } from '@mcsr/shared/tracking';
import { trackedDurationRange, trackedSinceSec } from '@mcsr/shared/tracking';
import type { Video } from '@mcsr/shared/videos';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { em } from '@/components/Emphasis';
import { Notice } from '@/components/Form';
import type { TrackedCreatorFieldErrors } from '@/components/TrackedVideos';
import { TrackedCreatorsPanel, TrackedVideosSection } from '@/components/TrackedVideos';
import { VideoCard } from '@/components/VideoCard';
import { VideoForm } from '@/components/VideoForm';
import {
  addTrackedCreator,
  deleteTrackedCreator,
  fetchMyVideos,
  fetchTrackedCreatorRoster,
  fetchTrackedCreators,
  fetchTrackedVideos,
  fetchVideos,
  type TrackedVideoListResponse,
  updateTrackedCreator,
  type VideoQuery,
} from '@/lib/api';
import { useApiErrorText, useAuth } from '@/lib/auth';
import { useCan } from '@/lib/capabilities';
import { describeTrackedError } from '@/lib/trackedErrors';
import type { TrackedFilterParam, VideosTab } from '@/lib/trackedQuery';
import {
  clearedTrackedFilterParams,
  nextParamsForTrackedFilter,
  nextParamsForTrackedPlatform,
  nextParamsForVideosTab,
  readTrackedFilters,
  readTrackedPlatform,
  readVideosTab,
} from '@/lib/trackedQuery';
import { useAsync } from '@/lib/useAsync';

/**
 * 视频墙 —— `/videos`。
 *
 * ---------------------------------------------------------------------------
 * 一、公开页面：看视频**不需要登录**
 * ---------------------------------------------------------------------------
 * 这是全站的访问模型（docs/v1-plan.md §0.1）：浏览不设门槛，只有"贴"要登录。
 * 所以这个页面不挂任何鉴权，未登录的人看到的是完整的一面墙 ——
 * 不是一个"登录后可见"的空壳。
 *
 * ---------------------------------------------------------------------------
 * 二、筛选状态放在 URL 里（和 ResourceList 同一条）
 * ---------------------------------------------------------------------------
 * `?platform=&authorId=&page=&view=` —— 刷新不丢、能分享、后退键符合直觉。
 *
 * ⚠️ 空的筛选值**不拼进 URL**，而且这道关在 `fetchVideos` 里：
 *    `?platform=` 是一个合法的 400（platform 是封闭枚举，空串不是它的取值），
 *    而用户看到的是"查询参数不合法" —— 那句话指不到"你把筛选清空了"上。
 *    这个页面还多一层：从地址栏读进来的 platform 会**先对着 VIDEO_PLATFORMS 校验**，
 *    所以手打一个 `?platform=foo` 也不会变成一个用户没法自救的错误页。
 *
 * ---------------------------------------------------------------------------
 * 三、`view=mine` 是一个**视图**，不是第二个接口的副产物
 * ---------------------------------------------------------------------------
 * 「我贴的」用的是 `/api/videos/mine`，它**含被隐藏的视频**（服务端刻意不过滤
 * 状态）。这是作者唯一能知道自己那条被隐藏了的地方 ——
 * 没有它，"被隐藏"对作者表现为"凭空消失"，他会再贴一遍，
 * 然后被 UNIQUE(platform, video_id) 挡回来，报的还是"这个视频已经在墙上了"。
 */
export function Videos() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const auth = useAuth();

  /*
   * 地址栏里的 platform 先校验再用。
   * 不校验的话 `?platform=foo` 会让服务端 400，而页面只会显示一句
   * "加载失败" —— 用户（或者收到这条链接的人）没有任何办法知道
   * 只要把 foo 去掉就好了。
   */
  const platformRaw = params.get('platform');
  const platform = (VIDEO_PLATFORMS as readonly string[]).includes(platformRaw ?? '')
    ? (platformRaw as VideoPlatform)
    : undefined;
  const authorId = params.get('authorId') ?? undefined;
  const page = Number(params.get('page') ?? '1') || 1;
  const mineView = params.get('view') === 'mine';

  const [refreshKey, setRefreshKey] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  /*
   * 操作结果（删除 / 隐藏 / 恢复）显示在**页面上**，不是卡片上。
   *
   * ⚠️ 卡片上显示会被卸载掉：隐藏和真删都会让那张卡片从列表里消失，
   *    而列表紧接着就重拉了 —— 于是那句"已隐藏，作者自己还看得到"
   *    连同卡片一起消失，用户只看到一行东西不见了，没有任何解释。
   */
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);

  const query: VideoQuery = { platform, authorId, page, pageSize: DEFAULT_PAGE_SIZE };

  /*
   * 有下架权的人看视频墙时**绕开浏览器缓存**（`fetchVideos` 的第三个参数）。
   *
   * ⚠️ 这不是优化，是修一个真跑出来的 bug：`/api/videos` 带
   *    `public, max-age=60`，所以编辑点完「隐藏」、`refreshKey` +1 重拉列表时，
   *    命中的是 60 秒内的旧响应 —— **那条还挂在墙上**。他会以为隐藏坏了。
   *    服务端一直是对的，错的只是这一层缓存。
   *
   * ⚠️ 为什么可以放进依赖数组（上面那条注释刚警告过多余的依赖）：
   *    只有登录且真有 resource.moderate 的人才会从 false 翻到 true，
   *    也就是**只多一次请求**，而且只在治理者身上。访客 `auth.user` 一直是
   *    null、`canModerate` 一直是 false，依赖不变，不会有第二个请求。
   *    这和上面 `mineView ? auth.user?.id : ''` 防的那件事不是一回事 ——
   *    那条防的是**每个访客**都被 me 接口的返回触发重拉。
   */
  const canModerate = useCan('resource.moderate');
  /**
   * 需求②（t14）：谁能在视频墙上看到「编辑」链接。
   * ⚠️ 与 `canModerate` 是**两个不同的能力**（下架 vs 直接改内容），
   *    刻意不复用 —— 把两者混成一个名字会让"能下架的人"顺带能改内容。
   */
  const canAuthor = useCan('content.author');

  const state = useAsync<WallData>(
    async (signal) => {
      if (mineView) {
        // 未登录就不发这个请求：它必然 401，而 401 不是"出错了"，
        // 是"你还没登录"—— 那句话由界面自己说（见下面的分支）。
        if (!auth.user) return EMPTY;
        const res = await fetchMyVideos(signal);
        // /mine 不分页：一个人的帖子数量是人眼能扫完的量级（见数据层注释）。
        // 这里把它包成同一个形状，好让下面只有一条渲染路径。
        return {
          items: res.items,
          total: res.items.length,
          page: 1,
          pageSize: res.items.length || DEFAULT_PAGE_SIZE,
        };
      }
      return fetchVideos(query, signal, canModerate);
    },
    /*
     * 依赖里每个值都列出来（本仓用 Biome，没有 eslint-disable 那条路）。
     *
     * ⚠️ 最后一项是 `mineView ? auth.user?.id : ''`，**不是** `auth.user?.id`。
     *    写成后者的话，/api/auth/me 一返回（哪怕用户只是来看视频墙、根本没点
     *    「我贴的」），依赖就变了 → 整个视频墙被重新请求一遍。
     *    那个多出来的请求在开发时看不出来（本地快），线上是白白的 24 条查询。
     */
    [
      mineView,
      platform ?? '',
      authorId ?? '',
      page,
      refreshKey,
      mineView ? (auth.user?.id ?? '') : '',
      canModerate,
    ],
  );

  // ---------------------------------------------------------------------------
  // 追踪的博主（T7）—— 这一页上**独立的一栏**，与上面那面墙没有关系（spec §8.1）
  // ---------------------------------------------------------------------------
  /*
   * 它有自己的页码、自己的刷新键、自己的取数 —— 上面那三样一个都不共用。
   * ⚠️ 页面这一层**只做三件事**：取数、判断能力、把动作的结果翻译成一句人话；
   *    界面全在 `components/TrackedVideos.tsx` 的两个纯视图里（理由见那个文件头：
   *    `renderToStaticMarkup` 不跑 effect，界面住在这里就断言不到）。
   */
  const canManageTracked = useCan('live.manage');
  const errorText = useApiErrorText();

  /*
   * 追踪那一栏的页码住在 URL 里（`?tpage=`），与上面那面墙**同一个理由**：
   * 刷新不丢、能分享、后退键符合直觉。它**单独一个参数**，不是复用 `page` ——
   * 两个列表各自翻页，共用一个页码的话翻上面那面墙会顺手把这一栏也翻走。
   */
  const trackedPage = Number(params.get('tpage') ?? '1') || 1;

  /*
   * ⚠️★ 分区参数是 `tplatform`，**不是** `platform`：上面那面墙已经占了 `platform`，
   *    共用会让两个区块互相改对方的筛选（spec §8.2；`tpage` 的注释里写着同一条理由）。
   * ⚠️ 先校验再用：手打 `?tplatform=foo` 必须退化成"全部"，不许变成 400 错误页
   *    —— 服务端的 `platform` 是封闭枚举，把 `foo` 原样发出去只会拿一句
   *    "查询参数不合法"，而那句话指不到"你把地址改坏了"上（与 `platform` 同一条纪律）。
   * ⚠️★ 这一读一写（`readTrackedPlatform` / `nextParamsForTrackedPlatform`）住在
   *    `lib/trackedQuery.ts`：页面这一层是静态渲染**够不到**的（不跑 effect、不点击），
   *    留在那里的话"换分区删 `tpage`、不碰 `platform` / `page`"这条契约就没有任何
   *    门禁看得见；抽成纯函数之后 `videorender.tsx` 的 ⑯ 能真的跑它们。
   */
  const trackedPlatform = readTrackedPlatform(params);

  /*
   * 第 9 条（2026-09-19）：五个筛选/排序参数，**同一套纪律**（先校验再用、退化成默认）。
   * ⚠️★ 它读的键是 `tsort` / `ttag` / `tdur` / `ttime` / `tcreator` —— 一个都不撞
   *    上面那面墙的四个（`platform` / `authorId` / `page` / `view`）与这一栏既有的两个
   *    （`tpage` / `tplatform`）。`lib/trackedQuery.ts` 的文件头列着这条约定。
   */
  const trackedFilters = readTrackedFilters(params);

  /*
   * 顶部两个栏目（用户第 8 条）。⚠️ 缺参数 / 认不出的值 ⇒ 那面墙（今天的行为）：
   * 一个被改坏的地址不该变成一整块错误页，也不该变成"两块都不显示"。
   */
  const videosTab = readVideosTab(params);

  const [trackedRefreshKey, setTrackedRefreshKey] = useState(0);
  const [creatorsRefreshKey, setCreatorsRefreshKey] = useState(0);
  const [addInput, setAddInput] = useState('');
  const [panelBusy, setPanelBusy] = useState(false);
  const [panelNotice, setPanelNotice] = useState<{
    kind: 'ok' | 'bad' | 'info';
    text: string;
  } | null>(null);
  const [panelFieldErrors, setPanelFieldErrors] = useState<TrackedCreatorFieldErrors>({});
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  /*
   * ★ 两个"预设"在**这里**翻译成服务端认的数字（第 9 条）：
   *   · `ttime`（最近 7 天 / 30 天 / 一年）⇒ `since`（Unix 秒）；
   *   · `tdur`（<1 分钟 / 1–5 / 5–15 / >15）⇒ `durMin` / `durMax`。
   * ⚠️★ 两张翻译表住在 `packages/shared/src/tracking.ts`（`trackedSinceSec` /
   *    `trackedDurationRange`），**不在这里写第二份**：同一个下拉框的选项与它映射出的
   *    区间一旦分家，表现是"选了 1–5 分钟、筛出来的是别的区间"—— 而那**不报错**
   *    （那两个函数的注释里写着各自防的事）。
   * ⚠️ `nowSec` 由**这里**取一次（`Date.now()`）：那两个函数**不看时钟**，
   *    理由写在 `trackedSinceSec` 上（自己读时钟的函数在测试里不可控）。
   * ⚠️ 每次渲染算一次是**故意**的：`since` 因此跟着"现在"走 —— 一份打开的页面
   *    放上一小时再点分页，重新算出来的 `since` 会比第一次晚一小时，而那正是
   *    "最近 7 天"该有的意思（缓存键随之变化，也是一次**正常**的缓存未命中）。
   */
  const trackedSince = trackedSinceSec(trackedFilters.time, Math.floor(Date.now() / 1000));
  const trackedDuration = trackedDurationRange(trackedFilters.duration);

  const trackedState = useAsync<TrackedVideoListResponse>(
    (signal) =>
      fetchTrackedVideos(
        {
          page: trackedPage,
          pageSize: DEFAULT_PAGE_SIZE,
          platform: trackedPlatform,
          sort: trackedFilters.sort,
          ...(trackedFilters.tag === undefined ? {} : { tag: trackedFilters.tag }),
          ...(trackedFilters.creatorId === undefined
            ? {}
            : { creatorId: trackedFilters.creatorId }),
          ...(trackedSince === undefined ? {} : { since: trackedSince }),
          ...(trackedDuration.durMin === undefined ? {} : { durMin: trackedDuration.durMin }),
          ...(trackedDuration.durMax === undefined ? {} : { durMax: trackedDuration.durMax }),
        },
        signal,
      ),
    /*
     * ⚠️★ 依赖数组里**每一个**能改变查询串的值都要列出来：漏一个的表现是
     *    "改了下拉框、选项变了、列表纹丝不动" —— 一次请求都不发，而且**不报错**
     *    （`useAsync` 只在依赖变化时重跑）。渲染自检看不见这一条：它不跑 effect。
     *    ⚠️ 这里逐项列 `trackedFilters.*` 而不是整个对象：对象字面量每次渲染都是新的，
     *    列整个对象会在**每一次**渲染都重发一次请求。
     *    ⚠️★ 但**不列** `trackedSince`：它是从 `trackedFilters.time` 算出来的
     *    （那个才是用户的操作），而它的值每次渲染都不同（跟着"现在"走）——
     *    列进来就等于"每一次渲染都重取一次列表"。代价写清楚：一个打开的页面**不会**
     *    在跨过整点/整天的边界时自己刷新（那时 `since` 已经变了，而列表还是旧的），
     *    下一次翻页或改筛选才会用上新的 `since`。
     * ⚠️ `trackedPlatform ?? ''` 与上面那面墙同形（`undefined` 与 `''` 在这里都是"全部"）。
     */
    [
      trackedPage,
      trackedPlatform ?? '',
      trackedFilters.sort,
      trackedFilters.tag ?? '',
      trackedFilters.duration ?? '',
      trackedFilters.time ?? '',
      trackedFilters.creatorId ?? '',
      trackedRefreshKey,
    ],
  );

  /**
   * 博主下拉的名册（第 9 条）。
   *
   * ⚠️★ 它与上面那一条**分开取数**（两个 `useAsync`）：名册失败不该让视频列表变成
   *    错误界面（那是两件不同的事），而它自己的降级是"下拉框里只剩「全部博主」"。
   * ⚠️ 它在**两栏都在的时候也照常请求**（不判断 `videosTab`）：切换标签页是**客户端的
   *    状态变化**，而按标签页条件化取数会让"切过去的那一瞬间下拉框是空的"。
   *    代价：墙上那一栏的访客也发一次 `/roster`（60 秒公开缓存，与列表同档）。
   *    ⚠️ 不这么做的另一个代价更大：把名册请求塞进"追踪那一栏的子树"里，就得让
   *    那一块自己取数 —— 而本仓的界面组件**不许取数**（不跑 effect 的那条纪律，
   *    `TrackedVideos.tsx` 的文件头写着）。
   */
  const rosterState = useAsync<{ items: TrackedCreatorSummary[] }>(
    (signal) => fetchTrackedCreatorRoster(signal),
    [],
  );

  /*
   * 名单**只在有 live.manage 时才请求**：没有能力的人请求它只会拿到 403，
   * 而 403 在页面上没有任何位置可以显示（那块面板对他根本不渲染）。
   * ⚠️ 组件那一侧还有一道 `canManage`（整块不渲染）—— 两道都要有：
   *    一道防"白白的 403 请求"，一道防"没有能力却画出了管理界面"。
   */
  const creatorsState = useAsync<{ items: TrackedCreator[] }>(
    async (signal) => (canManageTracked ? await fetchTrackedCreators(signal) : { items: [] }),
    [canManageTracked, creatorsRefreshKey],
  );

  /**
   * 追踪那一栏的翻页。
   *
   * ⚠️★ 它**不能**走上面那个 `setParam`：那个函数为了"换筛选条件要回第一页"
   *    会在 `key !== 'page'` 时顺手把 `page` 删掉 —— 拿它翻这一栏，会把上面那面墙
   *    **悄悄弹回第 1 页**。两栏各自独立分页，而这一点只在两栏都被翻过时才看得出来
   *    （所以它值得一条注释，而不是"看起来重复了一个函数"）。
   */
  function setTrackedPage(next: number) {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next > 1) p.set('tpage', String(next));
      else p.delete('tpage');
      return p;
    });
  }

  /**
   * 追踪那一栏的换分区。
   *
   * ⚠️★ 换分区 = **回到第 1 页**（与那面墙"换筛选回第一页"同一条）：停在第三页而
   *    新分区只剩一页的话，用户看到的是一片空白，他会以为"这个分区没有视频"。
   * ⚠️★ 而它**只碰** `tpage` —— **不许碰** `platform` / `page`：那两个是上面那面墙的
   *    状态，顺手删掉的表现是"在追踪那一栏点一下 B站，上面那面墙的筛选和页码
   *    一起没了"（spec §8.2 就是为这件事写的）。
   *    ⇒ 所以这里既不能走上面那个 `setParam`（它会删 `page`），也不能走
   *      `setTrackedPage`（它只认页码）。
   * ⚠️★ 具体的读写那一份住在 `lib/trackedQuery.ts`（`nextParamsForTrackedPlatform`）：
   *    它返回**下一份**查询串，这一栏只负责把它交给 `setParams`。接线（谁调用谁）
   *    仍然是静态渲染看不见的那一半，而两个纯函数的行为由 `videorender.tsx` ⑯ 钉着。
   */
  function setTrackedPlatform(next: TrackPlatform | undefined) {
    setParams((prev) => nextParamsForTrackedPlatform(prev, next));
  }

  /**
   * 顶部两个栏目（第 8 条）的切换。
   *
   * ⚠️★ 它**只碰** `vtab` —— 两栏各自的状态（墙上那面墙的四个键、追踪那一栏的七个）
   *    一个都不动：从追踪切回墙上，之前翻到第 3 页仍然是第 3 页；再切回来，
   *    筛过的条件也还在。这正是"两个栏目共用一条地址"该有的样子（而"切一次就清一次"
   *    的表现是"每次切回来都要重新筛一遍"，用户会以为地址被吃了）。
   * ⚠️ 具体的读写住在 `lib/trackedQuery.ts`（`nextParamsForVideosTab`）：谁调用谁
   *    是静态渲染看不见的那一半，而那个纯函数的行为由渲染自检钉着（⑯）。
   */
  function setVideosTab(next: VideosTab) {
    setParams((prev) => nextParamsForVideosTab(prev, next));
  }

  /**
   * 改一档筛选 / 排序（第 9 条）。
   *
   * ⚠️★ 它只把**控件给的原始值**交给纯函数写回地址栏：校验与"回到第 1 页"都在
   *    `nextParamsForTrackedFilter` 里（一处判据，两个方向都写在那里）。
   * ⚠️★ 它**不许**走上面那个 `setParam`：那个函数为了那面墙"换筛选回第一页"会删掉
   *    `page` —— 拿它改追踪那一栏的筛选，会把上面那面墙悄悄弹回第 1 页（spec §8.2）。
   *    `nextParamsForTrackedFilter` 删的是 `tpage`。
   */
  function setTrackedFilter(key: TrackedFilterParam, value: string | undefined) {
    setParams((prev) => nextParamsForTrackedFilter(prev, key, value));
  }

  /**
   * 「清除筛选」：这一栏的七个参数一起清掉（含分区与页码），墙上那面墙一个不动。
   *
   * ⚠️ 它是空态里那颗按钮的唯一出口（`clearedTrackedFilterParams` 的注释写着
   *    "为什么连分区一起清"），所以不能省。
   */
  function clearTrackedFilters() {
    setParams((prev) => clearedTrackedFilterParams(prev));
  }

  /**
   * 管理面板上那四个动作的**共同外壳**：忙碌标记、清掉上一次的结果、把失败翻成人话。
   *
   * ⚠️ 失败**必须**经 `describeTrackedError`（`lib/trackedErrors.ts`）：这一栏有
   *    两种"通用兜底会说错方向"的失败 —— `platform_not_configured`（我们没配凭据，
   *    重贴没用）与 `creator_not_found`（那条链接指向的人不存在，要改链接）。
   *    它们要的话不同（一段面板提示 vs 一格输入框红字），所以那一个函数吐的是
   *    `{ message, input }` 两格。
   */
  async function runPanelAction(action: () => Promise<string>): Promise<void> {
    setPanelBusy(true);
    setPanelNotice(null);
    setPanelFieldErrors({});
    try {
      // 成功那句话由每个动作自己给（"已排队重新回填，下一轮生效"之类）——
      // 它们说的是**下一轮会发生什么**，而那是这个外壳不知道的。
      setPanelNotice({ kind: 'ok', text: await action() });
    } catch (error) {
      const described = describeTrackedError(error, t, errorText);
      if (described.message !== null) setPanelNotice({ kind: 'bad', text: described.message });
      if (described.input !== null) setPanelFieldErrors({ input: described.input });
    } finally {
      setPanelBusy(false);
    }
  }

  async function handleAddCreator(): Promise<void> {
    const value = addInput.trim();
    /*
     * 空输入在**本地**就拦下（与 `TrackedCreatorInputSchema` 的 `min(1)` 同一个判据）：
     * 发出去只会拿一个必然 400，而那句话是服务端写的字段级说明，
     * 用户看到的是"这个字段不合法"，不是"你要贴一条链接"。
     */
    if (value === '') {
      setPanelFieldErrors({ input: t('tracked.errInputRequired') });
      return;
    }
    await runPanelAction(async () => {
      await addTrackedCreator({ input: value });
      // 成功才清空输入框：失败时把用户贴的那条留在框里，否则他得再找一遍那条链接
      //（`SeedPicker` 那句"存原文"是同一条纪律）。
      setAddInput('');
      setCreatorsRefreshKey((k) => k + 1);
      return t('tracked.okAdded');
    });
  }

  async function handleToggleCreator(id: string, enabled: boolean): Promise<void> {
    await runPanelAction(async () => {
      await updateTrackedCreator(id, { enabled });
      setCreatorsRefreshKey((k) => k + 1);
      return enabled ? t('tracked.okEnabled') : t('tracked.okDisabled');
    });
  }

  async function handleRebackfillCreator(id: string): Promise<void> {
    await runPanelAction(async () => {
      await updateTrackedCreator(id, { reBackfill: true });
      setCreatorsRefreshKey((k) => k + 1);
      return t('tracked.okRebackfill');
    });
  }

  async function handleDeleteCreator(id: string): Promise<void> {
    // 先关掉确认态：那一行马上就要消失了，留着一个指向不存在那一行的确认态
    // 会让下一次点"删除"看起来毫无反应。
    setConfirmingId(null);
    await runPanelAction(async () => {
      await deleteTrackedCreator(id);
      // ⚠️ 两个刷新键都要动：删博主会**级联删掉他的视频**（spec §4.2），
      //    所以上面那一栏的列表也变了 —— 只刷名单的话，那些视频还挂在公开列表上。
      setCreatorsRefreshKey((k) => k + 1);
      setTrackedRefreshKey((k) => k + 1);
      return t('tracked.okDeleted');
    });
  }

  const hasFilters = Boolean(platform || authorId);
  // 作者名从结果里取：接口收的是 authorId（UUID），而列表里的每一条都带着作者名。
  // 拿不到时（还没加载完 / 分享过来的链接）退回到 id 的前几位 —— 显示一个
  // 短 id 虽然不好看，但比显示一个空 chip 强，而且它确实是那个筛选条件的值。
  const authorName = state.status === 'ok' ? (state.data.items[0]?.authorName ?? null) : null;

  function setParam(key: string, value: string | undefined) {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      // 换筛选条件要回到第一页：停在第三页而结果只剩一页的话，
      // 用户看到的是一片空白，他会以为"这个筛选没有结果"。
      if (key !== 'page') next.delete('page');
      return next;
    });
  }

  function clearAll() {
    // 清筛选，但**保留视图**：清掉 view 会把用户从「我贴的」弹回墙上，
    // 而他要清的只是筛选条件。
    setParams(mineView ? { view: 'mine' } : new URLSearchParams(), { replace: true });
  }

  const totalPages =
    state.status === 'ok' && !mineView
      ? Math.max(1, Math.ceil(state.data.total / DEFAULT_PAGE_SIZE))
      : 1;
  const hiddenCount =
    state.status === 'ok' ? state.data.items.filter((v) => v.status === 'hidden').length : 0;

  return (
    <>
      <header className="pagehead">
        <div className="pagehead__row">
          <h1 className="pagehead__title">{t('videos.title')}</h1>
          {/*
            「贴个视频」长在视频墙里，而不是侧边栏。
            ⚠️ 这是**这个版块的动作**：用户是"在墙上看到缺了什么"才想贴的，
               所以入口应该在他看内容的地方（见 Layout.tsx 里那条注释）。
               仅登录后可见：没登录的人点进去只会被弹回来，
               而"看得见、点不动"比"看不见"更让人困惑。
          */}
          {auth.user ? (
            <button
              type="button"
              className="cta pagehead__action"
              aria-expanded={formOpen}
              onClick={() => setFormOpen((open) => !open)}
            >
              {formOpen ? t('common.cancel') : `+ ${t('videos.pasteAction')}`}
            </button>
          ) : null}
        </div>
        <p className="pagehead__sub">{t('videos.subtitle')}</p>
        {/*
          指向「直播」的一行。

          ⚠️ 两个板块都是"视频"，所以必须有一句话说明**为什么有两个** ——
             否则用户点进任何一个都会觉得另一个是重复的。
               · 这里：rolling，谁都能贴，一直在变
               · /live：编辑维护的一份名单，变动很慢
          放在副标题下面而不是页脚：它是"你要找的东西可能不在这页"的提示，
          而那种提示必须在用户开始翻列表**之前**就出现。
        */}
        <p className="pagehead__sub videos__toLive">
          {t('enterVideo.pointingToLive')}{' '}
          <Link className="authform__link" to="/live">
            {t('enterVideo.gotoLive')}
          </Link>
        </p>
      </header>

      {formOpen && auth.user ? (
        <VideoForm
          // 贴完立刻重拉：视频不审核，它现在就应当在墙上出现。
          onPosted={() => setRefreshKey((k) => k + 1)}
          onClose={() => setFormOpen(false)}
        />
      ) : null}

      {/*
        ★★ 顶部两个栏目（用户第 8 条：「最后将两个栏目"自己贴的视频"和"追踪的博主"分开，
        在顶部切换」）。

        ⚠️★ 形状借**本页自己**那两颗按钮（`.video-viewswitch` / `.video-viewswitch__item` /
        `is-active`）—— 它就是这一页上"切换看哪一块"的既有控件（「推荐视频 / 我的分享」），
        同一页上第二套"两个按钮的切换器"只会让用户以为是两回事。
        ⚠️ 本轮**没有**照简报里点名的 `Seeds.tsx` 那一套（`.seed__tabs`）：那份简报写的
        路径（`components/Seeds.tsx`）不存在，而 `routes/Seeds.tsx` 那两个标签页
        **没有**用 `useTabIndicator`（那是 `ResourceList` 的 `.tabs`）。
        ⇒ 就近取这一页已有的那套：零新增 CSS、零新增类名（代价：两处切换器长得一样，
        而它们本来就是"同一个页面里换一块看"的同一件事）。
        ⚠️★ 语义用 `aria-pressed`（与 `routes/Seeds.tsx` 那两颗一致），**不用**
        `role="tablist"`：真正的 tab 模式要求 `aria-controls` + `tabpanel` 一整套，
        只挂半个 `role="tab"` 会被读屏软件念成一个没有对应面板的选项卡
        （`Seeds.tsx` 那一处写着同一条理由）。
        ⚠️★ **同一时刻只渲染其中一块**（不是"两块都在、只是滚动到某一处"）：
        这也是用户原话里"分开"的意思 —— 两块加起来几十张卡一起加载，
        而它们根本不同时可见。换栏目**不重置**任何状态（理由见 `setVideosTab`）。
      */}
      <div className="video-viewswitch">
        <button
          type="button"
          className={`video-viewswitch__item${videosTab === 'wall' ? ' is-active' : ''}`}
          aria-pressed={videosTab === 'wall'}
          onClick={() => setVideosTab('wall')}
        >
          {t('videos.tabWall')}
        </button>
        <button
          type="button"
          className={`video-viewswitch__item${videosTab === 'tracked' ? ' is-active' : ''}`}
          aria-pressed={videosTab === 'tracked'}
          onClick={() => setVideosTab('tracked')}
        >
          {/*
            ⚠️ 这一颗的文字**复用** `tracked.title`（"追踪的博主"）：同一个东西不该有
            两个名字（`videos.title` 那条注释写着同一条纪律），而下面那一块的 `<h2>`
            用的正是这同一个键 —— 两者同时可见（标签在顶、标题在块内），
            换一个说法就会变成两种叫法。
          */}
          {t('tracked.title')}
        </button>
      </div>

      {/*
        ⚠️★ 下面这一大段（自贴视频墙 / 我贴的）是**原来那块**，一个字没动 ——
        只是被包进了"当前栏目是墙上"这个条件里。它和追踪那一栏是两张表、两条路
        （spec §8.1），所以两块互斥渲染不会让任何一边的数据消失。
        ⚠️ 「贴个视频」那颗按钮与它的表单**留在页面顶栏**（两栏都看得见）：
        贴出来的视频落在**这面墙**上，而按钮与墙分处两个栏目时，用户下一步会去点
        那一栏 —— 藏起来反而会让人找不到入口（表单自己带成功态与「去看墙上」，
        见 `VideoForm`）。
      */}
      {videosTab === 'wall' ? (
        <>
          {/*
            ⚠️★ 视图切换只在登录后出现 —— 没登录的人点"我贴的"只会被弹回来。
            ⚠️★ 终审 M9：登录用户在墙这一栏上会看到**两排挨着的切换器**，而它们
              借的是同一套类名（`.video-viewswitch`）⇒ 形状**一模一样**，只差文字，
              很容易被当成同一个控件重复渲染了两次。
              ⚠️ 实测**不是**重复渲染：上一排切**栏目**（自己贴的 / 追踪的），
              这一排切**视图**（全部视频 / 我贴的），两者是两条不同的轴。
              ⇒ 处置是"让它们能区分开"，不是删掉一个：这一排多一个修饰类
              `video-viewswitch--mine`，`styles.css` 把它画成明显更轻的次要控件
              （更小的尺寸、无底色无边框），且判据钉在 `videorender.tsx` 的 ⑰ 上
              （登录那一份产物里恰好两组、第二组带那个修饰类、第一组不带）。
          */}
          {auth.user ? (
            <div className="video-viewswitch video-viewswitch--mine">
              <button
                type="button"
                className={`video-viewswitch__item${mineView ? '' : ' is-active'}`}
                onClick={() => setParam('view', undefined)}
              >
                {t('videos.viewAll')}
              </button>
              <button
                type="button"
                className={`video-viewswitch__item${mineView ? ' is-active' : ''}`}
                onClick={() => setParam('view', 'mine')}
              >
                {t('videos.viewMine')}
              </button>
            </div>
          ) : null}

          {mineView && !auth.user ? (
            auth.loading ? (
              <p className="state">{t('common.loading')}</p>
            ) : (
              <>
                <Notice kind="info">{t('videos.mineNeedLogin')}</Notice>
                <p className="submitgate">
                  <Link
                    className="cta"
                    to={`/login?next=${encodeURIComponent('/videos?view=mine')}`}
                  >
                    {t('nav.login')}
                  </Link>
                </p>
              </>
            )
          ) : (
            <>
              {/*
            ⚠️ 「我贴的」不显示平台筛选：那个接口不分页也不收参数，筛选只能
               在客户端做，而"界面上的筛选"和"服务端的筛选"看起来一样、
               行为不同，是那种只有数据量大了才会暴露的差异。
          */}
              {!mineView ? (
                <div className="tagcloud">
                  <span className="tagcloud__label">{t('videos.allPlatforms')}</span>
                  <button
                    type="button"
                    className={`tagchip${platform === undefined ? ' tagchip--on' : ''}`}
                    onClick={() => setParam('platform', undefined)}
                  >
                    {t('videos.allPlatforms')}
                  </button>
                  {VIDEO_PLATFORMS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`tagchip${platform === p ? ' tagchip--on' : ''}`}
                      onClick={() => setParam('platform', p)}
                    >
                      {t(platformKey(p))}
                    </button>
                  ))}

                  {/*
                作者筛选是一个"当前条件"chip，不是一堆可选项 ——
                全站没有"列出所有作者"的接口，而这个筛选的自然入口
                是点卡片上的作者名（见 VideoCard）。没有 chip 的话，
                点完之后页面会变成"少了很多东西"，而用户看不出为什么。
              */}
                  {authorId ? (
                    <button
                      type="button"
                      className="tagchip tagchip--on"
                      title={t('videos.clearAuthor')}
                      onClick={() => setParam('authorId', undefined)}
                    >
                      {t('videos.authorFilter', { name: authorName ?? authorId.slice(0, 8) })} ×
                    </button>
                  ) : null}

                  {hasFilters ? (
                    <button type="button" className="filters__clear" onClick={clearAll}>
                      {t('videos.clearFilters')}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {state.status === 'loading' ? <WallSkeleton /> : null}

              {state.status === 'error' ? (
                <div className="state state--error">
                  <p>
                    {t('videos.loadFailed')}：{state.error}
                  </p>
                </div>
              ) : null}

              {/*
            操作结果（删除 / 隐藏 / 恢复）留在页面上 —— 见上面 flash 的说明。
            它比列表先渲染，所以"卡片消失了"和"为什么消失"是同时被看到的。
          */}
              {flash ? (
                <Notice kind={flash.ok ? 'ok' : 'bad'}>
                  {flash.text}
                  <button
                    type="button"
                    className="video-flash__close"
                    aria-label={t('common.cancel')}
                    onClick={() => setFlash(null)}
                  >
                    ×
                  </button>
                </Notice>
              ) : null}

              {state.status === 'ok' ? (
                state.data.items.length === 0 ? (
                  <div className="state state--empty">
                    <p className="state__title">
                      {mineView ? t('videos.mineEmpty') : t('videos.noResults')}
                    </p>
                    <p>{mineView ? t('videos.mineEmptyHint') : t('videos.noResultsHint')}</p>
                    {!mineView && hasFilters ? (
                      <button type="button" className="filters__clear" onClick={clearAll}>
                        {t('videos.clearFilters')}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <p className="resultcount">
                      {hasFilters && !mineView
                        ? t('videos.resultCountFiltered', { count: state.data.total })
                        : t('videos.resultCount', { count: state.data.total })}
                    </p>

                    {/*
                  被隐藏的视频只有作者自己在「我贴的」里看得见。明说这件事，
                  否则作者会以为"这些也还在墙上"，而墙上其实一条都没有。
                */}
                    {mineView && hiddenCount > 0 ? (
                      <p className="submitnote">{em(t('videos.mineHiddenNote'))}</p>
                    ) : null}

                    <ul className="video-wall">
                      {state.data.items.map((video: Video) => (
                        <VideoCard
                          key={video.id}
                          video={video}
                          onResult={(ok, text) => {
                            setFlash({ ok, text });
                            // 无论成功还是空操作都重拉：删除/隐藏会让这一条从列表里
                            // 消失，而"它是不是真的没了"只有服务端说了算 ——
                            // 在前端本地把它抹掉，就等于把服务端的判定做成了第二份。
                            setRefreshKey((k) => k + 1);
                          }}
                          // 在「我贴的」里按作者筛选没有意义（全都是我）
                          onFilterAuthor={mineView ? undefined : (id) => setParam('authorId', id)}
                          /*
                           * 需求②（t14）：「编辑」链接只对有 `content.author` 的人出现。
                           * ⚠️ 判据在**页面**这一层算（`useCan`），组件只管显不显示 ——
                           *    能力矩阵是唯一一份"谁是编辑"的定义。
                           */
                          canAuthor={canAuthor}
                        />
                      ))}
                    </ul>

                    {!mineView && totalPages > 1 ? (
                      <nav className="pager" aria-label="pagination">
                        <button
                          type="button"
                          disabled={page <= 1}
                          onClick={() => setParam('page', String(page - 1))}
                        >
                          ← {t('videos.prevPage')}
                        </button>
                        <span className="pager__pos">
                          {t('videos.page', { page, total: totalPages })}
                        </span>
                        <button
                          type="button"
                          disabled={page >= totalPages}
                          onClick={() => setParam('page', String(page + 1))}
                        >
                          {t('videos.nextPage')} →
                        </button>
                      </nav>
                    ) : null}
                  </>
                )
              ) : null}
            </>
          )}
        </>
      ) : null}

      {/*
        ★ 「追踪的博主」—— spec §6.2 的两块 + 第 9 条的筛选条。
        ⚠️★ 第 8 条起它与上面那面墙**互斥渲染**（顶部那个切换器）：用户原话是
           "将两个栏目分开，在顶部切换"。⚠️ 与 R3 那条"自贴那条路一个字不动"不冲突：
           那一条说的是**内容与行为**，而这次改的是"哪一块出现在屏幕上"——
           上面那一块的标记、取数、分页、筛选一个字节都没变（它只是被包进一个条件里）。
        ⚠️ R1 那句"两块都在 `/videos` 页里"今天仍然成立（同一个页面、同一个地址，
           只是同一时刻只显示一栏）。**不要**把它们拆成两个路由：两栏的状态住在
           同一份查询串里（墙上那四个键 + 这一栏的七个），拆路由会让"切回去"
           变成一次导航，而那次导航会把另一栏的状态留在地址里（看起来像串了数据）。
      */}
      {videosTab === 'tracked' ? (
        <>
          <TrackedVideosSection
            items={trackedState.status === 'ok' ? trackedState.data.items : []}
            total={trackedState.status === 'ok' ? trackedState.data.total : 0}
            page={trackedPage}
            pageSize={DEFAULT_PAGE_SIZE}
            empty={t('tracked.empty')}
            /*
             * ⚠️ 三个状态**分开传**，一个都不许合并：把 loading / error 折进"items 是空的"
             *    会让取数失败渲染成"还没有追踪到视频" —— 一句假话（`empty` 那一条的说明）。
             * ⚠️★ 失败那一句**先有翻译好的前言、再接原始细节**（`videos.loadFailed` +
             *    `useAsync` 给的那句）：与上面那面墙那一处逐字同形。只把原文传下去的话，
             *    英文界面上出现的是一整句中文（`API 返回 HTTP 500` 来自 `lib/api.ts`），
             *    而 `--en` 的零汉字扫描看不见这一层 —— 页面不在它的夹具里
             *    （脚本末尾的"覆盖边界"写着这件事）。
             */
            loading={trackedState.status === 'loading'}
            error={
              trackedState.status === 'error'
                ? `${t('videos.loadFailed')}：${trackedState.error}`
                : null
            }
            /*
             * ⚠️★ 分区**只影响取数**（服务端筛选，spec §5.1）：把 `trackedPlatform` 往下传
             *    是让四个按钮画对选中态，组件**不会**拿它去过滤 `items` ——
             *    在界面里再筛一次就是第二份"什么算这个分区"，而 `total` 是服务端给的。
             */
            platform={trackedPlatform}
            onPlatformChange={setTrackedPlatform}
            onPage={setTrackedPage}
            /*
             * ⚠️★ 第 9 条的四格（筛选状态 / 名册 / 改筛选 / 清除筛选）**都是必填**：
             *    少传 `filters` 或 `creators` 会让五个下拉框静默停在"全部"
             *    （而列表其实是筛过的）—— 那种界面上写着"全部"、实际只显示一部分的
             *    状态**没有任何解释**。少传两个回调则是"拉不动、而且看起来完全正常"。
             * ⚠️★ 名册取数失败 ⇒ 空数组。终审 I2 订正了这里原来那句"那**不是**假话"
             *    —— 那句话**本身是假的**，而真相分两半：
             *      · 用户没筛任何博主时，空名册的降级确实不假（"全部"就是当下的事实）；
             *      · 而地址栏里带着 `tcreator=<id>` 时，`<select>` 的 `value` 匹配不上
             *        任何 `<option>` ⇒ 浏览器把它画成**第一项**「全部博主」，可列表是
             *        **真的按那位博主筛过的** —— 用户看到一份很短的列表、下拉框却写着
             *        "全部博主"，没有任何东西解释为什么。
             *    ⇒ 第二半由 `TrackedVideos` 自己补一项解决（`tracked.creatorUnknown`），
             *      页面这一侧只负责把名册**照实**传下去（`status === 'ok' ? items : []`）。
             *    ⚠️ 代价（认下）：那一项说不出名字 —— 它要的名字正是这份读不到的名册给的，
             *      所以它只说"选了某一位"。记在 `docs/pending.md §5.103`。
             */
            filters={trackedFilters}
            creators={rosterState.status === 'ok' ? rosterState.data.items : []}
            onFilterChange={setTrackedFilter}
            onClearFilters={clearTrackedFilters}
          />

          <TrackedCreatorsPanel
            /*
             * ⚠️ 能力判据在**页面**这一层算（`useCan`）：`permissions.ts` 是"谁是编辑"
             *    的唯一定义，组件那一侧只决定显不显示。
             * ⚠️ 面板跟着**追踪那一栏**走：它维护的就是这份名单（加 / 停用 / 回填 / 删），
             *    而墙上那一栏与它无关。放在追踪那一栏里还有一个实际好处：
             *    编辑改完名单，眼下这个列表正是受影响的那一个。
             */
            canManage={canManageTracked}
            loading={creatorsState.status === 'loading'}
            busy={panelBusy}
            creators={creatorsState.status === 'ok' ? creatorsState.data.items : []}
            /*
             * ⚠️★ 取数失败**必须**自己占一格（而不是折进上面那句 `creators: []`）：
             *    折进去的话面板会渲染成"名单还是空的 —— 在上面贴一个博主的链接"，
             *    而那句是**假话**（名单不是空的，是没读到），并且会把编辑送去重贴一条
             *    **已经在名单上**的链接（再贴一次只会拿到 `duplicate`）。
             *    与上面那一栏的 `error` 是同一条纪律：三态分开传，谁都别替谁说话。
             * ⚠️ 前言复用 `videos.loadFailed`（与那面墙、与上面那一栏同一个说法），
             *    然后是 `useAsync` 给的原始细节。
             */
            loadError={
              creatorsState.status === 'error'
                ? `${t('videos.loadFailed')}：${creatorsState.error}`
                : null
            }
            input={addInput}
            fieldErrors={panelFieldErrors}
            notice={panelNotice}
            confirmingId={confirmingId}
            onInput={setAddInput}
            onAdd={() => void handleAddCreator()}
            onToggle={(id, enabled) => void handleToggleCreator(id, enabled)}
            onRebackfill={(id) => void handleRebackfillCreator(id)}
            onAskDelete={setConfirmingId}
            onDelete={(id) => void handleDeleteCreator(id)}
          />
        </>
      ) : null}
    </>
  );
}

/** 两种视图归一化之后的形状 —— 让下面只有一条渲染路径。 */
interface WallData {
  items: Video[];
  total: number;
  page: number;
  pageSize: number;
}

const EMPTY: WallData = { items: [], total: 0, page: 1, pageSize: DEFAULT_PAGE_SIZE };

/** 平台名 → 词条 key。表里没有的走 Twitch 的兜底是不可能的，所以直接穷尽。 */
function platformKey(platform: VideoPlatform): string {
  if (platform === 'bilibili') return 'videos.platformBilibili';
  if (platform === 'youtube') return 'videos.platformYoutube';
  return 'videos.platformTwitch';
}

/**
 * 加载骨架。
 *
 * ⚠️ 骨架块的高度**必须和真实嵌入框一样**（16:9）。
 *    高度对不上时，数据到达的瞬间整页会跳一下 —— 而那正是加载骨架
 *    想避免的那件事。这里复用 `.skel` 的动画，只补一个比例盒子。
 */
function WallSkeleton({ count = 6 }: { count?: number }) {
  return (
    <ul className="video-wall" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={`skel-${String(i)}`} className="video-card">
          <span className="skel video-skel__title" />
          <span className="skel video-skel__box" />
          <span className="skel skel--line" style={{ width: '40%', height: 10 }} />
        </li>
      ))}
    </ul>
  );
}
