/**
 * ★★ 子项目 C（下载进度与取消）· Task 5：**四处下载共用**的那一条进度行（spec §4）。
 *
 * ===========================================================================
 * ⚠️★ 这一层只排版：判断全在共享内核的 `progressLineOf` 里
 * ===========================================================================
 * 速度 / ETA / 百分比 / "有没有字节" / "能不能取消" 四件事都由
 * `progressLineOf`（`@mcsr/shared/downloadProgress`，T1 建的）算好再交下来 ——
 * 于是"样本不足显示 `—`（不猜）"这类规则**只有一处实现、也只被一处断言钉住**。
 * ⚠️★ 反过来说：谁把判断搬进这个文件（比如自己写 `view.rate === null ? '—' : …`），
 *    就是把同一条规则变成两份会漂的文本，而漂的表现是"某一处显示 0 B/s"
 *    （那正是 D2 要消灭的"把'还没量出来'说成'真的 0'"）。
 *
 * ===========================================================================
 * ⚠️★ 三处细节是**承重**的（都有断言，改它们会红）
 * ===========================================================================
 *   · `now` 是**可选入参**、默认取当前时刻：渲染自检要**写死时钟**（不写死的话，
 *     样本会在慢机器上漂出 `PROGRESS_RATE_WINDOW_MS` 那个 3 秒窗口 ⇒ 偶发变红），
 *     而产品运行时不传 ⇒ 每次重渲染都取当下（进度是**走的**，不是一次快照）。
 *     ⚠️ 代价（认）：这一层因此**不是纯函数**（默认值里有 `Date.now()`）——
 *     "可复现"靠调用方把 `now` 喂进来，自检那边照做。
 *   · 写盘相位（`installing`）**没有字节**：那一刻"已下多少"已经不是进度了
 *     （下载早就完成），印一个不动的数字只会让人以为卡住了 —— 文案换成
 *     `files.progressInstall`，而取消按钮**置灰并写明为什么**（D4：写盘中中断会留下半成品；
 *     置灰而不说话等于一个坏按钮）。
 *   · `cancelling: true` ⇒ 按钮文案变 `files.progressCancelling` **并且**保持置灰：
 *     连点两次不该发两次请求（用户点过之后也要有回应 —— 一个不动的按钮会被读成"没生效"）。
 *
 * ===========================================================================
 * ⚠️★ 文件名那一格：三种相位各印一次，但**位置不同**（不是三条不同的规则）
 * ===========================================================================
 * "用户要知道正在下哪一个"对三种相位都成立，而三种相位的**主语长度**不同：
 *   · 批量（`itemCount > 1`）⇒ `files.progressBatch` 自带 `{{name}}`；
 *   · 写盘 ⇒ `files.progressInstall` 自带 `{{name}}`；
 *   · 单行下载 ⇒ `files.progressLine` 只有四个数（那两个词条里没有名字），
 *     所以名字由这一层补一格 `dlprogress__file` 印在旁边。
 * ⚠️ 换句话说：**词条的形状**决定这一格的排版，而不是"哪个相位更重要"。
 *
 * ===========================================================================
 * ⚠️★ 它会被 `apps/web/scripts/foldersrender.tsx` **直接渲染**（㊶）
 * ===========================================================================
 * 那支脚本不跑 effect、不点事件 ⇒ 这个组件的 props 必须是**纯数据**、而且
 * "没有 effect / 没有事件"时也要画得出来（今天它只有 `useTranslation()`，满足）。
 * ⚠️ 它**刻意不用** JSX-free 那种写法（那是 `apps/web/scripts/**` 的惯例，这里不是脚本；
 *    这个文件在 tsconfig 的 `include` 里 ⇒ automatic runtime 正常生效）。
 */
import {
  type DownloadProgress,
  progressLineOf,
  type TimedSample,
} from '@mcsr/shared/downloadProgress';
import { useTranslation } from 'react-i18next';

export function DownloadProgressLine({
  progress,
  onCancel,
  now = Date.now(),
}: {
  /** 这一帧 + 页面自己攒的样本窗口（`PageProgress`；样本**只从 `onProgress` 收**）。 */
  progress: { frame: DownloadProgress; samples: readonly TimedSample[] };
  /** 停掉当前这一趟（`ModPageAction` 的 `cancel-download`；取消**不**由页面决定范围）。 */
  onCancel: () => void;
  /** ⚠️ 自检写死的那口钟；产品不传（见文件头）。 */
  now?: number;
}) {
  const { t } = useTranslation();
  const view = progressLineOf({ progress: progress.frame, samples: progress.samples, now });
  /** ★ D4：写盘相位一律不给取消（那一刻中断会留下半成品）。 */
  const blocked = view.installing;
  return (
    <p className="dlprogress" data-progress-modid={progress.frame.modid}>
      <span className="dlprogress__text">
        {view.itemCount > 1
          ? t('files.progressBatch', {
              index: view.itemIndex,
              count: view.itemCount,
              name: view.fileName,
            })
          : view.installing
            ? t('files.progressInstall', { name: view.fileName })
            : t('files.progressLine', {
                done: view.received,
                total: view.total,
                percent: view.percent,
                rate: view.rate,
                eta: view.eta,
              })}
      </span>
      {/*
       * ★ 单行下载那一支的名字（那两个词条里没有 `{{name}}`，见文件头那一段）。
       * ⚠️ 只在**那一条**上补：批量与写盘的名字已经在句子里面了，再印一遍就是同屏两次。
       */}
      {view.itemCount > 1 || view.installing ? null : (
        <span className="dlprogress__file">{view.fileName}</span>
      )}
      <button
        type="button"
        className="ghostbtn dlprogress__cancel"
        data-action="cancel-download"
        disabled={blocked || view.cancelling}
        onClick={onCancel}
      >
        {view.cancelling ? t('files.progressCancelling') : t('common.cancel')}
      </button>
      {blocked ? (
        <span className="dlprogress__note">{t('files.progressCancelBlocked')}</span>
      ) : null}
    </p>
  );
}
