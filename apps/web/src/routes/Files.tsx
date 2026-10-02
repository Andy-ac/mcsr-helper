/**
 * 「文件更新」`/files` —— 侧栏那一栏的落地页（2026-09-24；2026-10-03 加了第一部分）。
 *
 * ===========================================================================
 * ⚠️★ 这一页在**两种模式下是两个产品**，而它们共用同一份组件
 * ===========================================================================
 *   · **桌面壳里**（`window.mcsr` 存在）：数据全部来自桌面壳，
 *     **一个字节都不走 HTTP**。⚠️ 但"桌面壳"有两个世代，判据不同（Task 7）：
 *       · **0.0.5+**（`window.mcsr.modFolders` 存在）：第一部分走
 *         `modFolders.getState()`（`useModFolders()`）—— 目录行、两个筛选器、
 *         双通道更新都在那一份状态里；v1 那张带写盘按钮的表**不再渲染**
 *         （Ruling 49：新界面不暴露 v1 的写通道）。
 *       · **0.0.4**（只有 `fileUpdates`）：一个字节都不变，走下面那条 v1 的路
 *         （`useFileUpdates()`），它看到的第一部分就是 v1 那张表 —— spec §6.8 说的
 *         "老客户端的第一部分只有一行"正是这件事，那是**正确**的降级。
 *   · **浏览器里**：既没有 `window.mcsr`、也没有任何本地文件 ⇒ 走 v1 那条路
 *     （`browserState()`）：把 `GET /api/file-catalog` 的**目录**列出来（每条都是
 *     "未绑定"），并说清"本地文件的读写只发生在桌面版里"，给出装桌面版的入口。
 *     ⚠️★ 那段说明**必须在这一页上**，不能只写在桌面版里：用户在浏览器里看到的是一张
 *     "未绑定"的表，第一反应是"为什么点不动"，而不是"我需要装桌面版"。
 *     ⚠️ 装桌面版的入口**复用首页那个 `<DesktopDownload />`**，不另造一个。
 *
 * ===========================================================================
 * ⚠️ 取数不在这里，在这个页面的容器里
 * ===========================================================================
 * 两条取数都在 `components/FileUpdatesPanel.tsx` 里：`useFileUpdates()`（v1）与
 * `useModFolders()`（第一部分）。这一页只做三件事：**选哪一条路**、摆放组件、
 * 渲染标题与说明。
 * ⚠️ 为什么这么分：`renderToStaticMarkup`（Task 7 的渲染自检）**不跑 effect** ——
 *    取数写在页面里的话，自检渲染这一页永远只能看到「加载中」，页面上每一块都断言不到
 *    （`docs/pending.md §5.63`）。
 * ⚠️★ 判据只有**一处**：`useModFolders()` 的 `status === 'unavailable'` 就是"这个壳没有
 *    `modFolders`"⇒ 这一页不去**再读一次** `desktopBridge()`（这个文件里如果出现两处
 *    "我是不是 0.0.5" 的判断，它们迟早在某一支上分叉 —— `shared/desktop.ts` 的
 *    `desktopBridge()` 是那条唯一入口的注释里写着这件事）。
 */
import { useTranslation } from 'react-i18next';
import { DesktopDownload } from '@/components/DesktopDownload';
import {
  FileUpdatesPanel,
  ModCatalogScanning,
  ModCatalogSection,
  useFileUpdates,
  useModFolders,
} from '@/components/FileUpdatesPanel';
import { Notice } from '@/components/Form';

export function Files() {
  const { t } = useTranslation();
  const data = useFileUpdates();
  /*
   * ★ 第一部分的数据源（Task 7）。⚠️ 它在浏览器 / 0.0.4 里恒为 `unavailable`
   *   （那条路一个字节都不变），只有 0.0.5+ 的壳才会给出 `ready`。
   */
  const mods = useModFolders();

  /**
   * ⚠️ 判据是 `handlers`（只有桌面壳里才有），不是**再读一次** `desktopBridge()`：
   *    这个页面里如果出现两处"我是不是桌面壳"的判断，它们迟早在某一支上分叉
   *    （`shared/desktop.ts` 的 `desktopBridge()` 是那条唯一入口的注释里写着这件事）。
   */
  const desktop = data.handlers !== null;

  return (
    <>
      <header className="pagehead">
        <h1 className="pagehead__title">{t('files.title')}</h1>
        <p className="pagehead__sub">{t('files.intro')}</p>
      </header>

      {/*
        ★ 浏览器态的两件事，紧贴在标题下面（读者第一眼就该看到"这里不是桌面版"）：
        一句说明 + 一个真实的下载入口。桌面壳里这两样都不渲染。
        ⚠️★ 这一句走的是 `<Notice>`，而 `Notice` 对**字符串子节点**会 `em()`
        （`components/Form.tsx` 里那句 `typeof children === 'string' ? em(children)`）
        ⇒ 它里面的 `**` 会变成粗体，**不是**字面星号。这一条值里的标记去掉是照控制器的
        carry-in（值就是纯文本），**不是**因为这里会印星号 —— 会印星号的是
        `files.autoHint` 那一处渲染点（裸 `<p>`）。两条理由不同，
        完整的那一段写在 `packages/shared/src/i18n/zh-CN.ts` 的 `files` 那一节。
      */}
      {desktop ? null : (
        <div className="files__browser">
          <Notice kind="info">{t('files.browserOnly')}</Notice>
          <DesktopDownload />
        </div>
      )}

      {/*
        ===================================================================
        ★★ 两条路的分岔口（Task 7）：`unavailable` ⇒ v1 那条路（一个字节不变）
        ===================================================================
        ⚠️★ 三条支路**互斥**，而且都能从这一屏看出自己在哪一支：
          · `unavailable`（浏览器 / 0.0.4）⇒ 下面那三块 v1 的老画面；
          · `loading` ⇒ 「正在扫描…」（Ruling 42：首拉可能等一次补扫）；
          · `failed` ⇒ 一句带原因的话（**不许**留一个「正在扫描…」，那是撒谎：
            `ShareIntro` 的注释里记着同一条 —— 分不出"慢"和"挂了"就是撒谎）。
      */}
      {mods.status === 'unavailable' ? (
        <>
          {data.status === 'loading' ? <p className="state">{t('common.loading')}</p> : null}

          {/*
            ⚠️★ 连第一份状态都没拿到 —— 这句话**必须**说出来。留一个「加载中」的话，
            用户既没有重试、也分不出"慢"和"挂了"（`ShareIntro` 的注释里记着同一条）。
            ⚠️ 两条路的原因**不是同一件事**，所以是两条词条：
               · 浏览器 = 网页自己拉的目录失败（`files.catalogError`，`{{reason}}` 是服务端
                 那个机器可读的码或 HTTP 状态码）；
               · 桌面壳 = 主进程那半边**根本没回话**（`files.stateError`）。
            ⚠️ 主进程**回了一份状态、里面写着目录拉取失败**那一支不走这里，它走面板
               （`state.catalogError`，那句话由主进程写好、面板原样显示）—— 见
               `components/FileUpdatesPanel.tsx` 里 `catalogError` 那一段。
            ⚠️ 这一段**刻意没有就地重试按钮**（代价写明：要用户自己刷新这一页）：
               两种原因都不是"再点一次就会好" —— 浏览器这边多半是"这一次部署没把目录
               文件送到服务器上"，桌面壳那边是"那条 IPC 通道根本没人接"。
               而桌面态真正能重试的是 v1 那颗「检查」（T4 的 `check()` 会重拉一次目录），
               浏览器这半边没有第二个取数动作，刷新就是重试。
          */}
          {data.status === 'failed' ? (
            <Notice kind="bad">
              {data.failedAt === 'catalog'
                ? t('files.catalogError', { reason: data.reason })
                : t('files.stateError', { reason: data.reason })}
            </Notice>
          ) : null}

          {data.status === 'ready' ? (
            <FileUpdatesPanel
              state={data.state}
              handlers={data.handlers}
              actionError={data.actionError}
            />
          ) : null}
        </>
      ) : mods.status === 'loading' ? (
        /*
         * ★★ Ruling 42：第一次 `getState()` 会先等一次**补扫**（读每个 jar 的内部版本
         * 与哈希），可能要几秒 ⇒ 从第一帧就说"正在扫描…"，否则这一页看起来是挂了。
         */
        <ModCatalogScanning />
      ) : mods.status === 'failed' ? (
        /*
         * ⚠️ 与 v1 的 `stateError` **不是同一条词条**：这一条说的是新通道
         * （`modFolders.getState()`）拿不到。两条通道的失败原因不同，所以不合并。
         */
        <Notice kind="bad">{t('files.partOneStateError', { reason: mods.reason })}</Notice>
      ) : (
        /*
         * ★ 第一部分（spec §6.8）。⚠️ 第二部分与底部缺失清单是 **Task 8** 的事：
         *   它们挂在 `T8` 的 `ModFoldersPanel` / `MissingModsList` 上（`mods.state.folders` /
         *   `mods.state.missing` 已经在这一份状态里，T8 直接用）。
         */
        <ModCatalogSection
          state={mods.state}
          handlers={mods.handlers}
          actionError={mods.actionError}
        />
      )}
    </>
  );
}
