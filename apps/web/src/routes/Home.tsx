import { Button } from '@mcsr/ui';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { DesktopDownload } from '@/components/DesktopDownload';
import { em } from '@/components/Emphasis';
import { fetchHealth, type HealthResponse } from '@/lib/api';
import { NAV_SECTIONS, type NavSection } from '@/lib/nav';
import { useAsync } from '@/lib/useAsync';

/*
 * ===========================================================================
 * 首页（2026-09-14 改版）
 * ===========================================================================
 * 用户原话：「将主页上的『资源库』以及底下的两个框去掉，改成和左侧一样的几个
 * 栏目的说明文本、网页和 api 的连通性测试」。
 *
 * 拆开是三件事，这里各自有一处落点：
 *   ① hero 里那个「资源库 →」按钮 —— **删掉**（它底下的栏目清单里就有资源库）；
 *   ② 它底下那两张卡（`API` 状态卡 + `M1` 计划卡）—— **删掉**；
 *   ③ 换成 `SectionList`（栏目说明）+ `StatusRow` × 2（网页 / 接口连通性）。
 *
 * 这一页最要紧的不是排版，而是**两块内容都不许撒谎**：
 *   · 栏目表与左侧导航是同源事实（见 `HOME_SECTIONS` 那段注释）；
 *   · 连通性那一块的每一行都必须对应一次**真的发生过的测量**，
 *     而不是一个写死的绿点（见 `StatusRow` / `probeHealth` 的注释）。
 *
 * ⚠️ 展示被拆成了纯组件（`SectionList` / `StatusRow`：只收 props、自己不发请求），
 *    页面组件负责取数与状态拼装。理由是**可验证性**：`useAsync` 在 SSR 下不跑
 *    effect，所以整页在 `renderToStaticMarkup` 里永远停在"检查中" ——
 *    只有把展示拆出来，`scripts/homerender.tsx` 才能把"成功 / 失败 / 检查中"
 *    三种状态分别渲染出来做断言。
 *    （本仓先例：`CalendarSeriesSection` 与 `LiveCard` 都是"容器取数、展示收 props"。）
 */

/**
 * 「这一栏的一句话说明」的词条 key：`home.desc.<block>`。
 *
 * ⚠️ 刻意用 `block`（这张表的**短名**）而不是从 `to` 里抠路径：`block` 的取值与
 *    `home.desc.*` 那六条**逐一对应**（`resources` / `calendar` / `videos` /
 *    `live` / `seeds` / `profile`），字段职责见 `lib/nav.ts`。
 * ⚠️ 返回值写成模板字面量类型 ⇒ **key 是可穷尽的**：`block` 多一个取值，
 *    这里的返回类型跟着多一个；而 `home.desc.*` 缺那一条时 `t()` 会把 key
 *    原样印在页面上 —— 那种"看不出是 bug"的失败由 `check:home` 的针孔探针兜住。
 * ⚠️ 短名与路由**恰好**一一对应，但它们是两件事：改路由不会自动改短名
 *    （短名连着颜色与说明词条）。
 */
function sectionDescKey(block: NavSection['block']): `home.desc.${NavSection['block']}` {
  return `home.desc.${block}`;
}

/**
 * 连通性一行的状态。
 *
 * ⚠️★ 刻意做成**三选一的联合类型**，而不是 `{ tone: 'ok'|'bad'|'wait', text, detail }`
 *    那种"谁都能拼"的形状：颜色、状态文字、以及"要不要显示错误原文"必须**同源**。
 *    拼装式写法能写出"标签写着「连不上」、壳子是绿的"这种组合，而那一行恰恰是
 *    这一块唯一会造成的实质伤害（用户以为服务是好的）。联合类型让它写不出来。
 */
export type StatusState =
  | { status: 'checking' }
  | { status: 'ok'; details: readonly string[] }
  | { status: 'error'; message: string };

export interface StatusRowProps {
  /** 「网页」/「接口」 */
  label: string;
  state: StatusState;
  /**
   * 下面那行小字：解释这一行绿/红/灰**各自意味着什么**。
   *
   * ⚠️ 收 `ReactNode` 而不是 `string`：它是**词条**，而词条里用 `**这样**` 表示强调
   *    （中英两份都是这个约定）。写死成 `string` 的话，调用方就只能把词条原样塞进来，
   *    于是界面上直接出现一对星号 —— 那是一个已经踩过的界面缺陷，修法是调用点套
   *    `em()`（见 `components/Emphasis.tsx` 的注释，全仓 11 处在这么做）。
   */
  note: ReactNode;
  /** 被测端点自己的文本（接口那一行用）。网页那一行没有端点，所以可空。 */
  endpoint?: string | null;
  /**
   * 手动重试。⚠️ 只有"真的能再测一次"的行才该传它 —— 网页那一行没有可重发的请求，
   * 给它编一个"重新 ping 网页"的按钮就是在编一个不存在的动作。
   */
  onRetry?: (() => void) | null;
}

/**
 * 一行连通性状态。**纯展示**：不取数、不判断、不自己发请求。
 *
 * ⚠️ 三样东西（`pill--*` 的颜色、那句状态文字、错误原文要不要出现）全部由
 *    `state` 一个 switch 派生 —— 见 `StatusState` 的注释。
 * ⚠️ 失败时**原样**显示错误文本：一句笼统的"出错了"会让人重试三次还是同样的结果。
 */
export function StatusRow({ label, state, note, endpoint = null, onRetry = null }: StatusRowProps) {
  const { t } = useTranslation();

  let pill = 'pill pill--wait';
  let statusText = t('home.statusChecking');
  if (state.status === 'ok') {
    pill = 'pill pill--ok';
    statusText = t('home.statusOk');
  } else if (state.status === 'error') {
    pill = 'pill pill--bad';
    statusText = t('home.statusFail');
  }

  return (
    <div className={`homeconn__row homeconn__row--${state.status}`}>
      <span className="homeconn__label">{label}</span>
      <span className={pill}>{statusText}</span>

      {state.status === 'ok' ? (
        <span className="homeconn__details">
          {state.details.map((detail) => (
            <span className="homeconn__detail" key={detail}>
              {detail}
            </span>
          ))}
        </span>
      ) : null}

      {state.status === 'error' ? <span className="homeconn__error">{state.message}</span> : null}

      {endpoint ? <code className="homeconn__endpoint">{endpoint}</code> : null}

      {onRetry ? (
        <span className="homeconn__retry">
          <Button onClick={onRetry} size="sm" variant="ghost">
            {t('common.retry')}
          </Button>
        </span>
      ) : null}

      <span className="homeconn__note">{note}</span>
    </div>
  );
}

/**
 * 栏目说明列表。**纯展示**，只收 props。
 *
 * ⚠️ 清单必须来自 `items`，**不能**在组件里写死那六行（写死的话"首页少了一栏 /
 *    顺序变了"不会有任何报错）。调用方传的是 `NAV_SECTIONS` —— 与左侧导航
 *    **同一份常量**（`lib/nav.ts` 的注释写了为什么只能有一份）。
 *    （`check:home` 用"只传一行就只该渲染一行"钉住"清单来自 props"这一点。）
 * ⚠️ 名字取 `labelKey`（`nav.*`），说明按**短名** `block` 推 `home.desc.<block>`
 *    —— 两者都不在这里写第二遍。
 * ⚠️ 用 `<Link>`（站内路由）而不是 `<a href>`：后者会整页刷新，和站里其它入口
 *    不一致，也会丢掉 SPA 的路由过渡。
 */
export function SectionList({ items }: { items: readonly NavSection[] }) {
  const { t } = useTranslation();
  return (
    <ul className="homesec__list">
      {items.map((item) => {
        const name = t(item.labelKey);
        const desc = t(sectionDescKey(item.block));
        return (
          <li className="homesec__item" key={item.to}>
            {/*
              ⚠️ 尚未实现的栏目（`milestone` 非空）**不渲染成链接** —— 语义与左侧
                 逐字一致（`Layout.tsx` 里那一支渲染成不可点的 `span`）。
                 首页若给它一个链接，用户点进去只会得到空白/404，
                 而**放一个点了没反应的链接比不放更糟**（`lib/nav.ts` 的原话）。
            */}
            {item.milestone ? (
              <span
                aria-disabled="true"
                className="homesec__row homesec__row--todo"
                title={item.milestone}
              >
                <span className="homesec__name">{name}</span>
                <span className="homesec__desc">{desc}</span>
              </span>
            ) : (
              <Link className="homesec__row" to={item.to}>
                <span className="homesec__name">{name}</span>
                <span className="homesec__desc">{desc}</span>
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** 一次健康检查的结果：响应体本身 + **这次**请求量到的往返毫秒。 */
export interface HealthProbe {
  health: HealthResponse;
  roundTripMs: number;
}

/**
 * 真的发一次 `GET /api/health`，并量出这次请求的往返毫秒。
 *
 * ⚠️ 计时必须在**发起请求的前后各夹一次**，而不是"渲染时算一次"：渲染时刻与这次
 *    请求之间隔着一个渲染周期（还可能隔着一次重渲染），那个数就不属于这次请求了。
 * ⚠️ 这个数包含 JSON 解析，是"浏览器视角的端到端往返"，不是纯网络 RTT ——
 *    界面上说的也是"往返"，没说是 RTT。
 */
async function probeHealth(signal: AbortSignal): Promise<HealthProbe> {
  const startedAt = nowMs();
  const health = await fetchHealth(signal);
  return { health, roundTripMs: Math.round(nowMs() - startedAt) };
}

/**
 * 单调时钟，毫秒（小数）。
 *
 * ⚠️ 用 `performance.now()` 而**不是** `Date.now()`：后者只有毫秒整数分辨率，
 *    在 Windows 上还可能被系统时钟粒度放大到 15ms 一级 —— 一次本机健康检查的往返
 *    往往就是几毫秒，用它会量出一堆 0。
 * ⚠️ 没有 `performance` 的运行时（Node 的老版本、某些测试环境）退回 `Date.now()`：
 *    它只是不让这里抛，正常路径永远走上面那条。SSR 里连这个函数都不会被调用
 *    （`useAsync` 不跑 effect，见 `lib/useAsync.ts`）。
 */
function nowMs(): number {
  const perf = globalThis.performance;
  return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
}

/**
 * 「网页」那一行的数：**首屏耗时**。
 *
 * ⚠️ 这一行的语义是"**这一页自己有没有渲染出来**"，不是"从服务器 ping 网页"——
 *    不存在那种动作，编一个出来就是假数据。能读到这一行，答案就已经是"渲染出来了"；
 *    这里附上的数只是把这个答案**量化**，让它不是一个装饰性的绿点。
 * ⚠️ 取 `domContentLoadedEventEnd`（DCL 之后才有值），拿不到再退 `loadEventEnd`
 *    （load 事件之前它是 0），两个都没有才退 `performance.now()`。取整用 `Math.round`。
 * ⚠️ 只在**客户端挂载后**调用（见下面那个 `useEffect`）：首屏那次 render 里
 *    `performance` 可能不存在（SSR），而这两个字段在事件发生前是 0 —— 那时印出来
 *    的会是一个假的 0，比不印更糟。
 */
function readFirstPaintMs(): number {
  const perf = globalThis.performance;
  if (!perf) return 0; // SSR：没有 performance 就没有数可报（调用方那时显示"检查中"）
  let measured = 0;
  try {
    const nav = perf.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    measured = nav?.domContentLoadedEventEnd || nav?.loadEventEnd || 0;
  } catch {
    measured = 0; // 拿不到导航计时就退回 now()
  }
  return Math.round(measured > 0 ? measured : perf.now());
}

export function Home() {
  const { t } = useTranslation();
  const [reloadKey, setReloadKey] = useState(0);
  /*
   * ⚠️ 重试就是**把这个 key 加一**：`useAsync` 的依赖变了 ⇒ abort 掉上一次、
   *    重新发一次请求。**不做轮询、也不自动重试** —— 这一页不是监控面板，
   *    自动重试会把"刚刚连不上"这件事悄悄抹掉（用户再也不会知道刚才那一下是失败的）。
   */
  const probe = useAsync<HealthProbe>((signal) => probeHealth(signal), [reloadKey]);

  /*
   * 首屏耗时只在挂载后量一次（理由见 `readFirstPaintMs`）。
   * ⚠️ 挂载前那一瞬间显示「检查中」而不是「正常 0 ms」：那时我们**确实还没量到数**，
   *    印一个 0 就是在编。这一瞬间只有几毫秒，而它是诚实的。
   */
  const [firstPaintMs, setFirstPaintMs] = useState<number | null>(null);
  useEffect(() => {
    setFirstPaintMs(readFirstPaintMs());
  }, []);

  let webState: StatusState = { status: 'checking' };
  if (firstPaintMs !== null) {
    // 这一行永远是绿的：能读到它，就已经说明页面渲染出来了（所以它没有失败态）。
    webState = { status: 'ok', details: [t('home.webLoaded', { ms: firstPaintMs })] };
  }

  let apiState: StatusState = { status: 'checking' };
  if (probe.status === 'error') {
    apiState = { status: 'error', message: probe.error };
  } else if (probe.status === 'ok') {
    apiState = {
      status: 'ok',
      details: [
        t('home.apiVersion', { version: probe.data.health.version }),
        t('home.apiRoundTrip', { ms: probe.data.roundTripMs }),
      ],
    };
  }

  return (
    <>
      <section className="hero">
        <h1 className="hero__title">{t('home.tagline')}</h1>
        <p className="hero__sub">{t('home.subtitle')}</p>
      </section>

      <DesktopDownload />

      <section className="homesec">
        <h2 className="homesec__title">{t('home.sectionsTitle')}</h2>
        <p className="homesec__hint">{em(t('home.sectionsHint'))}</p>
        <SectionList items={NAV_SECTIONS} />
      </section>

      <section className="homeconn">
        <h2 className="homeconn__title">{t('home.statusTitle')}</h2>
        <p className="homeconn__hint">{em(t('home.statusHint'))}</p>
        {/*
          「网页」那一行**没有重试按钮**：它没有可重发的请求，而"重新测网页"这件事
          在技术上就是刷新页面本身。给它一个按钮等于编一个不存在的动作。
        */}
        <StatusRow label={t('home.statusWeb')} note={em(t('home.webNote'))} state={webState} />
        <StatusRow
          endpoint={t('home.apiEndpoint')}
          label={t('home.statusApi')}
          note={em(t('home.apiNote'))}
          onRetry={() => setReloadKey((k) => k + 1)}
          state={apiState}
        />
      </section>
    </>
  );
}
