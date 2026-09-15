/**
 * 实时分享 · 看板页 `/shares/room` 与 `/shares/seed`
 * —— **两个 kind 共用这一个组件**（`kind` 是它的唯一 prop）。
 *
 * ===========================================================================
 * ⚠️★ 这个文件里**没有界面**，只有取数、刷新、本地计时与状态
 * ===========================================================================
 * 界面（标题 / 两个标签页 / 「你的一条」/ 看板 / 四种画面）**全在**
 * `components/ShareCard.tsx` 的 `ShareBoardView` 里。理由与 Task 6 的介绍页、
 * 以及 `components/` 里那个贡献者面板的「容器 + 纯视图」拆分完全相同：
 * 这个页面**自己取数**，而 `renderToStaticMarkup` **不跑 effect**（也不点击、不发请求）
 * ⇒ 整页在渲染自检里**永远停在"加载中"**，写在它里面的任何一块都**断言不到**
 * ——那是一条不可能红的守卫（`docs/pending.md §5.63`）。
 * ⇒ 这里只有：`useAuth()`、`fetchShareBoard`、`<ShareBoardView … />`。
 *    属性少传、传错都会被 **typecheck** 抓住（`src/**` 在 tsconfig 的 include 里），
 *    而 `onRetry` / `onResendVerify` / `lastUpdatedAtMs` 这三格是**刻意的必填**
 *    （Task 5 的评审改的，理由见 `ShareBoardViewProps` 那三处注释）——
 *    这个文件正是它们在仓库里**唯一的真实调用点**。
 *
 * ===========================================================================
 * ⚠️★ 游客那一支**一个请求都不发**
 * ===========================================================================
 * `GET /api/shares/:kind` 要求登录（§5.1：游客 **401**，不是空列表）⇒ 这里**先看
 * `useAuth()` 再决定发不发**，不是"发了再吃 401"：
 *   · 那一次请求必然被拒，还会在服务端留下一条"有人在试着读"的噪音
 *     （每一次游客访问都来一条，而这台服务器只有 1 核）；
 *   · 游客看到的会是"先加载、再变成要登录"那一次闪烁，而那一屏本来就不该有加载态。
 * 同一条规矩还管着**未验证邮箱**那一屏：`ShareBoardView` 那一支**不挂载**发布表单
 * （挂上去只是给他一个注定 403 的按钮），所以"谁不去请求"这件事在视图里也是结构性的。
 *
 * ===========================================================================
 * ★★ 三条刷新要求（spec §7.6），以及它们为什么住在这一个 effect 里
 * ===========================================================================
 *   ① 每 **20 秒**重拉一次；
 *   ② `document.visibilityState === 'hidden'` 时**停**，回到前台**立刻**刷一次；
 *   ③ **本地**每秒推进 `nowMs` —— 到点的行由视图当场摘掉，**不发请求**。
 * ①② 共用同一个定时器句柄（一个 `setInterval` 的起停），拆成两个 effect 的话
 * "现在到底有没有定时器"会有两份状态，而它们漂移的表现是"后台标签页还在打服务器"
 * 或者"回到前台却不刷新" —— 两种都只能靠人盯着看。
 *
 * ⚠️★ **服务端偏移量只在拿到响应那一刻算一次，不要每秒重算**。推导（含代数）写在
 *    `components/ShareCard.tsx` 的 `useServerOffset` 上：每秒重算的话
 *    `nowMs + offset` 恒等于 `serverNow` ⇒ 剩余时间每秒都是同一个数 ⇒
 *    倒计时**冻住**，"到点即消失"退化成"下一次 20 秒轮询才消失"。
 *    这个文件只推进 `nowMs` 这一个**本地读数**，偏移量的事一个字都不碰。
 *
 * ===========================================================================
 * ⚠️★ 刷新失败**绝不清空**旧列表（§7.5 第 4 行）
 * ===========================================================================
 * 所以这里**不用** `lib/useAsync.ts`：它在依赖变化时整块重来（包括退回"加载中"），
 * 而这一页要的是"刷新时保留旧列表、失败也不清空"。形状照
 * `components/` 里那个贡献者面板的那一套（`useCallback` + `useEffect` + 显式 state），
 * 但**有一处刻意不同**：失败时它 `setDraft(null)`（名单没得显示），
 * 这里**只记错误**，`loaded` 一动不动 —— 旧列表 + 「上次刷新失败了，下面是 N 秒前的数据」
 * + 重试，就是那一屏的全部（§7.5 第 4 行的原话是"绝不清空"）。
 */
import type { ShareKind, ShareListResponse } from '@mcsr/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShareBoardView } from '@/components/ShareCard';
import {
  ApiError,
  fetchShareBoard,
  postShare,
  sendVerifyEmail,
  setShareVisibility,
} from '@/lib/api';
import { useApiErrorText, useAuth } from '@/lib/auth';
import { describeShareError } from '@/lib/shareErrors';

/** 看板每 20 秒重拉一次（§7.6 第 1 条）。 */
const REFRESH_MS = 20_000;
/** 本地计时的一拍（§7.6 第 3 条）。 */
const TICK_MS = 1_000;

/**
 * 成功取到的那一份看板 —— **连同它属于哪个 kind**。
 *
 * ⚠️★ 为什么 `kind` 必须存在一起（不然就是一个真会发生的串台）：
 *    `/shares/room` 与 `/shares/seed` 是**同一个组件**的两条路由，而 react-router
 *    在两条**兄弟路由之间**切换时**不会重新挂载** —— 它建出来的元素树每一层的类型
 *    都一样（`RenderedRoute` → `Layout` → `Suspense` → 本组件），React 于是按
 *    "同类型就地更新"处理，state 是**留着**的。只存响应体的话，切过去的那一瞬间
 *    `board` 里还是另一个 kind 的行，而它们会**原样渲染在种子的看板上**
 *    （房间号、说明、作者名一个不少）。存上 kind、只认相符的那一份之后，
 *    "串台"在结构上就不可能发生 —— 不依赖上面那条路由行为将来变不变。
 */
interface LoadedBoard {
  kind: ShareKind;
  board: ShareListResponse;
  /**
   * 这一次**成功**取到的**本地**时刻（`ShareBoardViewProps.lastUpdatedAtMs` 的真相，
   * §7.6 第 5 条）。
   * ⚠️ 刷新失败时它**不动** —— 那正是「{{secs}} 秒前更新」那一行的意义。
   */
  atMs: number;
}

/**
 * 看板页（`kind` ∈ `room` | `seed`）。
 *
 * ⚠️ 路由在 `App.tsx` 上挂两次（`/shares/room`、`/shares/seed`），**两个 kind 一个组件**：
 *    写成两个页面的话，两边的刷新、保留旧列表、错误处理会各自漂移一份 ——
 *    而它们本来就该逐字一样。标签页是**真链接**（视图里那两个 `<Link>`），
 *    所以分享出去的 URL、前进后退、刷新都落在同一屏上。
 */
export function ShareBoard({ kind }: { kind: ShareKind }) {
  const { t } = useTranslation();
  const errorText = useApiErrorText();
  const auth = useAuth();

  /** 成功取到的那一份（`null` = 还没成功过）。 */
  const [loaded, setLoaded] = useState<LoadedBoard | null>(null);
  /** 取数失败时那句话（**已经翻好**）。⚠️ 它与 `loaded` 是两件事：失败不动 `loaded`。 */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** ★ 本地时钟的读数，**每秒**推进一次。⚠️ 服务端偏移量不在这里算（见文件头）。 */
  const [nowMs, setNowMs] = useState(() => Date.now());
  /** 有操作在飞（发布 / 下架 / 恢复 / 重发验证邮件）。⚠️ **不包括**取数 —— 见下面 `busy` 的用法。 */
  const [busy, setBusy] = useState(false);
  /** 一次操作的结果（已复制 / 复制失败 / 各种失败）。文本由这里给，视图只负责摆。 */
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  /**
   * 正在飞的那一次请求。
   *
   * ⚠️ 它存在的唯一理由是**取消**：卸载、登出、换 kind 时都要把它停掉。
   *    不停的话，一个已经不属于任何人的响应回来照样会 `setState` ——
   *    换人那一支尤其糟（上一个人的看板会落到新会话的界面上）。
   */
  const inflight = useRef<AbortController | null>(null);

  /**
   * 发不发请求的**唯一**依据是"谁登录着"（`userId`），不是 `auth.loading`。
   * ⚠️ 取的是 **id** 而不是 `auth.user` 那个对象：对象在 `refresh()` 重取同一个人
   *    的资料后会换一个新的，取对象会让这一页白发一次请求（与
   *    `routes/ShareIntro.tsx`、`routes/CalendarDetail.tsx` 同一条做法）。
   */
  const userId = auth.user?.id ?? null;

  /**
   * 把看板再拉一次。**成功时替换旧列表，失败时一个字都不清。**
   *
   * ⚠️ 抽成 `useCallback` 是为了让三种调用点共用同一件事：20 秒的轮询、
   *    「重试」按钮、以及一次操作成功之后的回读。写成三处各发一次请求的话，
   *    "失败时保留旧列表"这条规矩要写三遍，漏掉任何一遍都不会有任何报错。
   */
  const load = useCallback(async (): Promise<void> => {
    /*
     * ⚠️ 上一趟还在飞就先取消它：20 秒一轮不可能撞上，但「重试」连点两下、
     *    或者"切回前台立刻刷一次"与手动重试同时发生时会 —— 而两个响应乱序回来时，
     *    先发的那个会把后发的那个盖掉（界面上就是"刷新之后数据反而变旧了"）。
     */
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;

    try {
      const data = await fetchShareBoard(kind, controller.signal);
      // 中途被取消（卸载 / 登出 / 换 kind）：这一份响应已经不属于任何人了
      if (controller.signal.aborted) return;
      // ⚠️ `kind` 一起存 —— 理由见 `LoadedBoard` 那段注释（两条路由不会重挂）
      setLoaded({ kind, board: data, atMs: Date.now() });
      /*
       * ⚠️ 清错误**只在成功这一支**，不在开头。
       *    在开头清的话，每 20 秒的轮询都会让「上次刷新失败了」那一句闪一下
       *    （消失 → 请求飞着 → 失败后又出现），而它在这段时间里**仍然是真的**
       *    （你看到的确实还是旧数据）。
       */
      setLoadError(null);
    } catch (err) {
      // abort 是我方主动取消，不是失败
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (controller.signal.aborted) return;
      /*
       * ★★ 失败**只记错误**（§7.5 第 4 行："绝不清空"）。
       * ⚠️ 这里**不要**加 `setLoaded(null)` —— 加了的话，刷新一失败整块看板就变空，
       *    而那正是这一条要求要防的事（用户会以为"这里没人分享了"）。
       *
       * ⚠️ 走 `describeShareError` 而不是直接用通用兜底：这一条路上唯一真会出现的
       *    分支是 `unauthorized`（页面开着、会话到点了），而它要说的是这一栏自己的
       *    那句话（"登录之后才能看这里分享的东西…"）；通用映射对 401 回的是
       *    `auth.loginAction`（「登录」两个字），接在「没读到看板。」后面不成句子。
       *    （`email_not_verified` / `at_limit` / `invalid_state` 三个分支从读接口
       *     **到不了** —— 看看板只要求登录，§6.1 的那张表。）
       */
      setLoadError(`${t('shares.loadFailed')} ${describeShareError(err, t, errorText, kind)}`);
    }
  }, [kind, errorText, t]);

  /*
   * ★★ 取数 + 20 秒轮询 + 可见性（§7.6 的 ①② 都在这一个 effect 里）。
   *
   * ⚠️ 依赖是 `[userId, load]`：`load` 里面带着 `kind`，所以换标签页也会重来一次。
   *    `errorText` 只在**语言变了**的时候换身份（`useApiErrorText` 是 `useCallback([t])`），
   *    所以这里**不会**因为每秒一次的 `setNowMs` 重渲染而反复起停定时器
   *    （真那样的话就是每秒发一次请求，而且没有任何门禁会红）。
   */
  useEffect(() => {
    if (userId === null) {
      /*
       * ★★ 游客：**一个请求都不发**（§7.5 第 1 行，理由见文件头）。
       * ⚠️ 顺手把手上的东西清掉：这一支也是**登出**时唯一会跑到的地方，
       *    上一个人的看板与那句话不该继续待在组件里（视图那一支虽然渲染的是"要登录"，
       *    但值留着就是留着 —— 与 `routes/ShareIntro.tsx` 里那句 `setSummary(null)`
       *    是同一条理由）。⚠️ `notice` 也一起清：它渲染在四种画面的**上面**
       *    （`ShareBoardView` 里那一条提示在 authed 分支之外），不清的话
       *    登出之后那句「已复制」会留在"要登录"那一屏上。
       *    ⚠️ 已经是这些值时 React 会跳过重渲染。
       */
      setLoaded(null);
      setLoadError(null);
      setNotice(null);
      return;
    }

    /** 定时器句柄。`null` = 现在没在轮询（不可见，或者还没开始）。 */
    let timer: number | null = null;
    const start = (): void => {
      if (timer !== null) return;
      timer = window.setInterval(() => void load(), REFRESH_MS);
    };
    const stop = (): void => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };

    // 挂载 / 换人 / 换 kind：先来一次（第一次取数不该等 20 秒）
    void load();
    if (document.visibilityState === 'visible') start();

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        /*
         * ★ 后台标签页**停止轮询**（§7.6 第 2 条）：不停的话，一个挂着不管的页面
         *   会一直打服务器，而这台服务器只有 1 核。
         */
        stop();
        return;
      }
      /*
       * ★ 回到前台：**先把本地时钟推到当下，再立刻刷一次数据** —— 两件事都要做。
       *
       * ⚠️ 缺了推时钟这一半会留下一屏**假数据**：浏览器把后台页的 `setInterval`
       *    压到远低于 1 秒（spec §8 那条订正写明了这一点），所以切回来的那一刻
       *    `nowMs` 可能停在几分钟前 —— 那时**早就到点的行还挂在画面上**，而且
       *    `remainingMs` 还是正的（看起来"还剩 3 分钟"），点下去必然 409 `expired`。
       *    刷一次数据解决列表，推一次时钟解决画面上的倒计时与"到点即消失"。
       * ⚠️ 缺了刷新那一半则要等下一次 20 秒轮询才补上（也就是最多 20 秒的旧数据）。
       */
      setNowMs(Date.now());
      void load();
      start();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      // 取消正在飞的那一次（卸载 / 登出 / 换 kind 都会走到这里，理由见 `inflight`）
      inflight.current?.abort();
    };
  }, [userId, load]);

  /*
   * ★ 本地计时：每秒推进一次 `nowMs`（§7.6 第 3 条）。
   *   「到点那一秒从画面上消失」全靠它 —— 视图按 `remainingMs > 0` 当场把行摘掉，
   *   **不发任何请求**（这是本栏目对"分钟粒度不会撒谎"的交代，§7.4）。
   *
   * ⚠️ 它**不跟着可见性停**：后台页的定时器本来就被浏览器压到一分钟一次，
   *    停掉它反而要在切回来时补一拍 —— 而那一拍上面已经补了（`setNowMs`）。
   * ⚠️ 这一支里**只有本地读数**。把服务端偏移量也在这里算一遍是这一栏最容易犯的
   *    错（倒计时会冻住），推导见 `components/ShareCard.tsx` 的 `useServerOffset`。
   */
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  /**
   * 发布一条（`body` 由 `ShareForm` 按 kind 拼好，形状见 §5.3）。
   *
   * ⚠️ 成功之后**立刻回读一次**：看板是"20 秒一变"的，不回读的话，刚挂上去的那条
   *    （或者刚被替换掉的那条）会在这段时间里与「你的一条」对不上。
   * ⚠️ 成功**不另发一句提示**：新行出现在看板上就是反馈，而冻结清单里也没有
   *    "发布成功"那句话（§8）—— 失败必须有话说，成功不用再说一遍。
   */
  async function publish(body: unknown): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      await postShare(kind, body);
      await load();
    } catch (err) {
      setNotice({ ok: false, text: describeShareError(err, t, errorText, kind) });
      /*
       * ⚠️★ `invalid_state` 说的是"你看的那份数据已经旧了"（`lib/shareErrors.ts`
       *    的文件头写着调用方应当顺手刷新）—— 不刷的话，那一行还挂在屏幕上，
       *    用户再点一次还是同一句话，而他没有任何办法知道该刷新。
       */
      if (err instanceof ApiError && err.code === 'invalid_state') await load();
    } finally {
      setBusy(false);
    }
  }

  /**
   * 下架 / 恢复我自己的那一条。
   *
   * ⚠️ 传的是**想要的结果**（`visible`），不是"翻一下"：连点两下或者重试时，
   *    "翻一下"会得到与意图相反的结果（同 `lib/api.ts` 里 `setShareVisibility` 的注释）。
   * ⚠️ 恢复只有本人能做（§4.2）：管理员走到这里一律 403，所以界面上（结构上）
   *    只有 `mine` 那几行有这两个按钮。
   */
  async function setVisible(id: string, visible: boolean): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      await setShareVisibility(id, visible);
      // 回读：下架之后那一行必须**马上**从看板上消失（不然要等 20 秒的轮询）
      await load();
    } catch (err) {
      setNotice({ ok: false, text: describeShareError(err, t, errorText, kind) });
      if (err instanceof ApiError && err.code === 'invalid_state') await load();
    } finally {
      setBusy(false);
    }
  }

  /**
   * 「复制」—— 落点在**容器**里，因为 `navigator.clipboard` 是浏览器 API，
   * 而它失败**必须看得见**（§7.4 的"不许静默"）。
   *
   * ⚠️ 非 HTTPS（或者没有权限、或者文档不在焦点里）时 `navigator.clipboard`
   *    会 reject 甚至根本不存在 ⇒ catch 里那句 `copyFailed` 是**用户唯一**能拿到的解释。
   */
  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ ok: true, text: t('shares.copied') });
    } catch {
      setNotice({ ok: false, text: t('shares.copyFailed') });
    }
  }

  /**
   * 重发验证邮件 —— `POST /api/auth/verify/send`（与 `routes/Account.tsx` 同一个端点、
   * 同一个函数 `sendVerifyEmail`，所以未验证那一屏的入口不会是死按钮）。
   */
  async function resendVerify(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const res = await sendVerifyEmail();
      /*
       * ⚠️ `alreadyVerified` 也要有话说（服务端在"其实已经验证过"时回它）：
       *    与 `routes/Account.tsx` 逐字一样的两句话，不在这里另编一句 ——
       *    "已发出"与"你早就验证过了"是两件事，合成一句会骗其中一种人。
       */
      setNotice({
        ok: true,
        text: res.alreadyVerified ? t('auth.accountVerified') : t('shares.verifySent'),
      });
    } catch (err) {
      setNotice({ ok: false, text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  /*
   * ⚠️ 两份 state 合成"屏幕上该显示什么"：**kind 不相符的一律当作还没取到**
   *    （理由见 `LoadedBoard`）。两条路由共用同一个组件实例，这一步不能省。
   */
  const board = loaded !== null && loaded.kind === kind ? loaded.board : null;
  const lastUpdatedAtMs = loaded !== null && loaded.kind === kind ? loaded.atMs : null;
  /*
   * 「下面是 N 秒前的数据」里的那个 N。
   * ⚠️ 它与视图里 `updatedAgoSecs` 是**同一个算式**（`nowMs` 与 `lastUpdatedAtMs`
   *    两个**本地**读数相减，钳到 0 防系统校时把差值变成负数），而且必须一致：
   *    两句话会在同一次渲染里同时出现，数字不同就是自相矛盾。
   */
  const staleSecs =
    lastUpdatedAtMs === null ? null : Math.max(0, Math.floor((nowMs - lastUpdatedAtMs) / 1000));

  return (
    <ShareBoardView
      kind={kind}
      /*
       * ⚠️★ `auth.loading` 也走"登录了这一支"（与 `routes/ShareIntro.tsx` 同一个判断）：
       *    那半秒里 `user` 还是 `null`，传 `false` 会让**已经登录的人**先看到一句
       *    「登录之后才能看…」。走这一支的话，屏幕上说的是 `common.loading`
       *    （全站其它页面在这段时间里说的也是同一句话）。
       *    ⚠️ 这只是**画面**：`userId` 仍然是 `null`，所以那半秒**一个请求都不发**
       *    （发早了就是一次注定 401 的请求）。
       */
      authed={auth.loading || auth.user !== null}
      /*
       * ⚠️ 未验证邮箱只是"你的一条"换成"先去验证"，看板照常（§7.5 第 2 行）。
       *    `loading` 那半秒里它是 `false`，但这时 `board` 也是 `null` ⇒ 那一支
       *    （只在 `board !== null` 里渲染）根本到不了，不会闪出一句"先验证邮箱"。
       */
      verified={auth.user?.emailVerified ?? false}
      board={board}
      loadError={loadError}
      staleSecs={staleSecs}
      nowMs={nowMs}
      lastUpdatedAtMs={lastUpdatedAtMs}
      busy={busy}
      notice={notice}
      onHide={(id) => void setVisible(id, false)}
      onRestore={(id) => void setVisible(id, true)}
      onCopy={(text) => void copy(text)}
      onSubmit={(body) => void publish(body)}
      // ★ 必填的三格里的两格：重试 = 把取数再跑一遍；重发验证 = 那个端点
      onRetry={() => void load()}
      onResendVerify={() => void resendVerify()}
    />
  );
}
