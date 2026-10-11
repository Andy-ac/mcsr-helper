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
 * ⚠️★★ 两档：行内档印"文件名 + 字节行"，汇总档印"第 N/M 项"**再**字节行（spec §4）
 * ===========================================================================
 * `variant` 说这一格画在**哪一档**上（默认 `'inline'`）：
 *   · `'inline'`（`FolderJarList` / `VersionModList`）：**永远**印
 *     `<文件名> + <字节行>`（`files.progressLine`），**不**印序号 ——
 *     ⚠️★ **哪怕这一趟是批量的**：行内那一行说的是**这一项自己**的字节 / 速度 / ETA；
 *   · `'summary'`（`VersionFolderList` 的文件夹块）：批量时**先**印
 *     `files.progressBatch`（"正在更新 <modid>（第 N / M 项）"），**再**印字节行。
 *     ⚠️★★ 那两句话**都要印**：spec §4 第 2 档说的是在文件夹块上"**另加一行**"，
 *     而它自己的例子（`12.4/27.1 MB · 46%`）里**也有字节** ⇒ 只印序号句的话，
 *     用户在最常走的那条路（48 个 mod 的整夹「全部更新」）上**一个字节读数都看不到**
 *     （T5 复审第二轮咬的正是这条缺口，判据在 `foldersrender.tsx` ㊶）。
 *   · 写盘相位（`installing`）**两档一样**：只有 `files.progressInstall`（`{{name}}` 自带）
 *     —— 没有字节、没有 ETA，也没有序号句（那一刻"整趟的第几项"不是用户要的读数）。
 * ⚠️★ 于是"文件名那一格"（`dlprogress__file`）**只在名字不在句子里的时候补**：
 *    `'inline'` 档补（`files.progressLine` 的形状里没有名字）；
 *    写盘相位**不**补（名字在 `files.progressInstall` 里）；
 *    `'summary'` 批量档**不**补（名字已经在 `files.progressBatch` 那一句里）。
 *    ⚠️ T9 之前 `'summary'` 批量档补的是**文件**名（老词条里有 `{{name}}`）；T9 把那一句
 *    改成带 **mod 名**（`{{modid}}`，A19 的"在装什么"要 mod 名**与**文件名两样）⇒
 *    文件名那一格照旧由 `files.progressLine` 之外的那个 span 说 —— **两样都在同一行里**。
 * ⚠️ 换句话说：**词条的形状**决定这一格的排版，而不是"哪个相位更重要"。
 *
 * ===========================================================================
 * ⚠️★ T9：这一行里的「已更新 N」（`files.progressUpdated`）是**另一格**
 * ===========================================================================
 * 它说的是"**这一趟真的写盘成功了几个文件**"（`view.updatedCount`，主进程数出来的），
 * 与"第 i / n 项"（**处理到**第几项）**不是一回事**（spec A20 / §8 明写要分开）：
 * 跳过与失败都不进那个数。两个相位都印它（进行中就要看得见），`0` 时不印。
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
  variant = 'inline',
  now = Date.now(),
}: {
  /** 这一帧 + 页面自己攒的样本窗口（`PageProgress`；样本**只从 `onProgress` 收**）。 */
  progress: { frame: DownloadProgress; samples: readonly TimedSample[] };
  /** 停掉当前这一趟（`ModPageAction` 的 `cancel-download`；取消**不**由页面决定范围）。 */
  onCancel: () => void;
  /** ★★ 这一格画在**哪一档**上（两档各印什么见文件头；默认 `'inline'` = 行内那一行）。 */
  variant?: 'inline' | 'summary';
  /** ⚠️ 自检写死的那口钟；产品不传（见文件头）。 */
  now?: number;
}) {
  const { t } = useTranslation();
  const view = progressLineOf({ progress: progress.frame, samples: progress.samples, now });
  /** ★ D4：写盘相位一律不给取消（那一刻中断会留下半成品）。 */
  const blocked = view.installing;
  /**
   * ★★ 那一句"整趟的第几项"（`files.progressBatch`；T9 起它**带上 mod 名**）。
   *
   * ⚠️ 三个条件缺一不可：**汇总档** + **批量**（`itemCount > 1`）+ **不在写盘相位**。
   *    行内档**永远**是 `null` —— 行内那一行说的是"这一项自己"，不是"整趟的第几项"；
   *    而它**不**因为是批量就少印字节行（见文件头那一段）。
   */
  const batchSentence =
    variant === 'summary' && !view.installing && view.itemCount > 1
      ? t('files.progressBatch', {
          modid: progress.frame.modid,
          index: view.itemIndex,
          count: view.itemCount,
        })
      : null;
  /**
   * ★★ T9（spec A20 / §8）：那一句「**已更新 N**」（`files.progressUpdated`）。
   *
   * ⚠️★ 判据是"**这一趟真的写盘成功了几个**"（`view.updatedCount`，主进程数、共享内核透出来）
   *    —— 它与上面那句的"第 i / n 项"**不是一回事**，两句话说的两件事都要在这一行里看得见。
   * ⚠️★ **两个相位都印**（下载中与写盘中）——A20 明写"进行中的那一行与收尾汇总都显示它"。
   *    它**不**跟着 `installing` 消失：写盘那一刻"已经装成几个"照旧是用户要的读数
   *    （T5 那条"写盘相位不印字节"说的是**字节**：那一刻的字节不是进度）。
   * ⚠️★ `updatedCount === 0` 时**不印**（一个字都没装成的时候印「已更新 0」是噪声；
   *    而"一个都没装成"这件事由收尾那行汇总（`lastRunSummary`）如实说）。
   * ⚠️ 单独一格（不是塞进 `files.progressLine` 里）：那一句的词条是四处下载共用的，
   *    而这一格只在"有东西真的写下去了"时才有意义。
   */
  const updatedSentence =
    view.updatedCount > 0 ? t('files.progressUpdated', { count: view.updatedCount }) : null;
  return (
    <p className="dlprogress" data-progress-modid={progress.frame.modid}>
      {/*
       * ★ 名字那一格：**只在名字不在句子里**的时候补（见文件头）——
       * 行内档（单项下载与"批量里的那一项"两档）都在这里补；汇总档批量与写盘的名字在句子里。
       */}
      {view.installing || batchSentence !== null ? null : (
        <span className="dlprogress__file">{view.fileName}</span>
      )}
      <span className="dlprogress__text">
        {batchSentence === null ? null : `${batchSentence} `}
        {view.installing
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
       * ★★ T9：机器读数那一格（`data-updated`）与文案那一格**成对**——
       *    自检据此断"这一行的『已更新』就是帧里那个数"（只断文案的话，
       *    一个把 2 印成 3 的实现在"文案在不在"这条判据上照样绿）。
       *    ⚠️ 它此时**一定**有值（`null` 那一支不画这个 span）。
       */}
      {updatedSentence === null ? null : (
        <span className="dlprogress__updated" data-updated={view.updatedCount}>
          {updatedSentence}
        </span>
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
