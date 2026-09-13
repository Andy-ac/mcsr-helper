import type { UserLiveLink } from '@mcsr/shared/live';
import { useRef, useState } from 'react';
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
 * ★ 这一页**不检测直播状态**（这是设计里明确排除的）
 * ---------------------------------------------------------------------------
 * 没有 API key、不轮询，所以：
 *   · **没有「直播中」标记**。加了它就得有人维护它的真假，而"某人在播
 *     界面却什么都不显示"是用户一周之内就会发现的谎；
 *   · 页面上有一句话明说"这里记的是频道，不是现在谁在播"（`live.recordsChannels`）。
 *     那句话是这一页**能一直保持诚实的唯一原因** —— 只要它还在，
 *     就不会有人指望这一页告诉他谁在线。
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

  return (
    <>
      <header className="pagehead">
        <h1 className="pagehead__title">{t('live.title')}</h1>
        <p className="pagehead__sub">{t('live.subtitle')}</p>
      </header>

      {/*
        ★ 这两句话放在列表**前面**，不是后面。
        它们是这一页的"说明书"：上面那句防止有人以为这里有"直播中"功能，
        下面那句防止有人以为它和娱乐视频是重复的。
        放在列表后面的话，只有滚到底的人才读得到 —— 而那时他已经
        对"为什么没有直播中标记"形成了自己的猜测。
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

      {list.status === 'ok' ? (
        list.data.items.length === 0 ? (
          /*
           * ⚠️ 空状态要读起来像"还没有记录"，**不是**"出错了"。
           *    这份名单本来就可能只有几条、甚至一条都没有（它刚上线时就是这样），
           *    而一个写着"加载失败"的空状态会让人来问我们是不是坏了。
           */
          <div className="state state--empty">
            <p className="state__title">{t('live.empty')}</p>
            <p className="state__hint">{t('live.emptyHint')}</p>
          </div>
        ) : (
          <ul className="live-list">
            {list.data.items.map((channel) => (
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

  const items: UserLiveLink[] = auth.user && mine.status === 'ok' ? mine.data.items : [];

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
       * ⚠️ 补丁的清理时机是这段代码里**最容易写错**的一处，两个错法都试过：
       *    · 用 `useEffect` 盯 `mine.status === 'ok'` 清 ⇒ 会在**旧数据仍为 ok 的那一帧**
       *      就清掉补丁，列表先闪回旧值、新值一个 RTT 后才到 —— 正好把"就地更新"抵消掉；
       *    · 在 `save` 里 `await fetch()` 完再清 ⇒ 要多发一次请求，而且与 `useAsync`
       *      那次拉取的返回顺序不确定。
       *    ⇒ 最终做法：**在一次提交渲染之后再清**（`setTimeout(0)` 排在提交之后），
       *      这样补丁至少生效一帧（用户看得见改动），随后 `useAsync` 的新数据接上，
       *      而 `useAsync` 自己在 `loading` 期间**不渲染列表** ⇒ 不会出现"旧值闪回"。
       */
      setPatches((p) => {
        setTimeout(() => setPatches({}), 0);
        return { ...p, [id]: patch };
      });
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

      {auth.loading ? <p className="state">{t('common.loading')}</p> : null}

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
          deletingId={deletingId}
          savingId={savingId}
        />
      ) : (
        <p className="state">{t('common.loading')}</p>
      )}
    </section>
  );
}
