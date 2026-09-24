/**
 * 「文件更新」`/files` —— 侧栏那一栏的落地页（2026-09-24）。
 *
 * ===========================================================================
 * ⚠️★ 这一页在**两种模式下是两个产品**，而它们共用同一份组件
 * ===========================================================================
 *   · **桌面壳里**（`window.mcsr` 存在）：数据全部来自
 *     `desktopBridge().fileUpdates`（订阅 + 首拉），**一个字节都不走 HTTP** ——
 *     `shared/desktop.ts` 的 `fileUpdates` 那段写着，那份状态是页面**唯一**的数据来源。
 *     所以这一页在桌面壳里**不许**去发 `/api/file-catalog`：主进程自己会拉目录，
 *     两份来源只会给出两个会漂的答案（而漂的那一份会让用户按错误的版本号点「更新」）。
 *   · **浏览器里**：既没有 `window.mcsr`、也没有任何本地文件。这一页只做两件事 ——
 *     把 `GET /api/file-catalog` 的**目录**列出来（每条都是"未绑定"），以及说清
 *     "本地文件的读写只发生在桌面版里"，并给出装桌面版的入口。
 *     ⚠️★ 那段说明**必须在这一页上**，不能只写在桌面版里：用户在浏览器里看到的是一张
 *     "未绑定"的表，第一反应是"为什么点不动"，而不是"我需要装桌面版"。
 *     ⚠️ 装桌面版的入口**复用首页那个 `<DesktopDownload />`**，不另造一个：
 *     它自己会判"已经在桌面壳里就不显示"、也会在安装包还没发布时静默不渲染，
 *     再写一个入口就等于第二份会漂的判断（它那三段注释逐条写着为什么）。
 *
 * ===========================================================================
 * ⚠️ 取数不在这里，在这个页面的容器里
 * ===========================================================================
 * `useFileUpdates()`（`components/FileUpdatesPanel.tsx`）里：订阅 / 首拉 / 拉目录，
 * 以及七个动作的包装。这一页只做三件事：**取数据**、摆放 `<FileUpdatesPanel>`、
 * 渲染标题与说明。
 * ⚠️ 为什么这么分：`renderToStaticMarkup`（Task 7 的渲染自检）**不跑 effect** ——
 *    取数写在页面里的话，自检渲染这一页永远只能看到「加载中」，页面上每一块都断言不到
 *    （`docs/pending.md §5.63`）。
 */
import { useTranslation } from 'react-i18next';
import { DesktopDownload } from '@/components/DesktopDownload';
import { FileUpdatesPanel, useFileUpdates } from '@/components/FileUpdatesPanel';
import { Notice } from '@/components/Form';

export function Files() {
  const { t } = useTranslation();
  const data = useFileUpdates();

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
           而桌面态真正能重试的是 Task 6 那颗「检查」（T4 的 `check()` 会重拉一次目录），
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
  );
}
