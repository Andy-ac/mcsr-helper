/**
 * 实时分享（live shares）—— 这一栏界面上的**每一块**（纯组件，全部只吃 props）。
 *
 * ===========================================================================
 * ★★ 为什么这里同时有"组件"和"两个视图"（Task 8 的渲染自检只认后者）
 * ===========================================================================
 * Task 6/7 的两个页面（`routes/ShareIntro.tsx` / `routes/ShareBoard.tsx`）**自己取数**，
 * 而 `renderToStaticMarkup` **不跑 effect**（也不点击、不发请求）⇒ 纯 SSR 下它们
 * 永远停在"加载中"那一屏，写在页面里的任何一块都**断言不到**。
 * 那样的自检是一条**不可能红的守卫**（`docs/pending.md §5.63`：恒真的断言比没有断言更坏）。
 * ⇒ 界面全部搬到这里，页面只做取数；渲染自检渲染的是：
 *     · `ShareIntroView`（介绍页：`summary === null` 是"还没取到/游客"，
 *       而"取数**失败**"是另一格 `summaryFailed` —— 见那个 props 的注释）
 *     · `ShareBoardView`（看板页：四种画面都在它的 props 里）
 *   这与 `components/` 里那个贡献者面板是同一个形状、同一条理由（那个文件头记着
 *   事故的来历，它也正是本仓"容器 + 纯视图"这对名字的先例）。
 *
 * ⚠️★ 名字是 **`ShareBoardRow`**，不是 `ShareRow`：数据层（Task 2）里"库里的那一行"
 *    叫 `LiveShareRow`。两个都叫 `ShareRow` 会让读代码的人分不清手里拿的到底是
 *    "库里的一行"还是"界面上的一行"（这一处是执行前扫描裁决的）。
 *
 * ===========================================================================
 * 组件清单，以及"谁能看见谁"
 * ===========================================================================
 *   · `ShareBoardRow`   —— 看板上的一行（**含别人的行**）。★ 它**没有下架按钮**：
 *     下架/恢复只挂在 `ShareMineBar` 里那几条 `mine` 行上 ⇒
 *     "别人的行没有下架按钮"是**结构上**成立的，不是靠一个 `if` 判出来的。
 *   · `ShareMineBar`    —— 「你的一条」四个形态（没有 / 在展示 / 已下架 / 到额度）。
 *     ⚠️ 它渲染 `shares.hideHint`，那句里有一对 `**` ⇒ **必须走 `em()`**；
 *     这一处也是 `services/api/src/i18n-keys.test.ts` 的 `EXPECTED_SITES` 里登记的
 *     那一处（在那里它是 `shape: 'em'`、`count: 1`）。
 *   · `ShareForm`       —— 发布表单（四档时长、默认 5、按 kind 分叉）。
 *   · `ShareGuestNotice` / `ShareVerifyNotice` —— 游客与"还没验证邮箱"那两屏。
 *   · `ShareIntroView` / `ShareBoardView` —— 两个**只吃 props**的纯视图。
 *
 * ⚠️ 这一轮**不动样式**：`styles.css` 是"每个任务只追加自己那一块"的
 *    （Task 6 追加 `.shareIntro*`、Task 7 追加看板那一块）。所以下面的类名就是
 *    与本栏目界面之间的**接口**：`.shareIntro*` 归介绍页，`.share*` 归看板。
 *    （room 的房间号要按 §7.4 用**现成的** `--fs-title-item` 档放大 —— 那是
 *     `styles.css` 末尾那一块的口径，这里只给类名，不在这里写死字号。）
 *
 * ===========================================================================
 * ⚠️ 时钟只从一个地方进来
 * ===========================================================================
 * 剩余时间由 `nowMs`（props，容器每秒推进）+ **一次响应算一次**的服务端偏移量
 * 算出来（`lib/shareTime.ts`）。这个文件里**没有任何 `Date.now()`** ——
 * 有的话"到点那一秒从画面上消失"就又变成只有人眼能验的东西了。
 * 偏移量冻在哪、为什么非冻不可，见 `useServerOffset`。
 */
import {
  DEFAULT_SHARE_DAYS,
  DEFAULT_SHARE_MINUTES,
  type LiveShare,
  parseShareDays,
  type RoomPayload,
  type SeedPayload,
  SHARE_CODE_MAX,
  SHARE_CODE_MIN,
  SHARE_CODE_PATTERN,
  SHARE_KIND_LABEL_KEYS,
  SHARE_KINDS,
  SHARE_LIMITS,
  SHARE_MINUTES,
  SHARE_NOTE_UNITS,
  SHARE_SEED_MAX,
  type ShareKind,
  type ShareListResponse,
  type ShareMinutes,
  type ShareSummary,
  textWidth,
} from '@mcsr/shared';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { em } from '@/components/Emphasis';
import { Field, Notice } from '@/components/Form';
import { remainingMs, remainText, serverOffset } from '@/lib/shareTime';

// ---------------------------------------------------------------------------
// 按 kind 分叉的词条表
// ---------------------------------------------------------------------------
/*
 * ⚠️ 三张表都写成**穷尽 `Record<ShareKind, …>`**，而不是三元链 / `if` 链：
 *    加第三个 kind 时会**编译报错**，逼着人来补一行。三元链的兜底分支天然"合法"，
 *    它会把新 kind 静默显示成另一个 kind 的名字（`SHARE_KIND_LABEL_KEYS` 的注释
 *    记着同一条规矩）。
 *
 * ⚠️ 表里存的是**词条 key**，不是译文：`t()` 在渲染点调用，语言切换才跟得上。
 *    这里没有一处带 `**`，所以不涉及 `i18n-keys.test.ts` 的形状守卫。
 */

/** 展开发布表单那个按钮：没有在展示说「挂一条」，有在展示说「换一条 / 再加一条」。 */
const SHARE_FORM_OPEN_KEYS: Record<ShareKind, { none: string; live: string }> = {
  room: { none: 'shares.formOpenRoom', live: 'shares.formOpenRoomAgain' },
  seed: { none: 'shares.formOpenSeed', live: 'shares.formOpenSeedAgain' },
};

/**
 * 表单里的提交键。
 *
 * ⚠️★ room 在**有在展示**时必须换成「发到看板（替换你正在展示的那条）」：
 *    替换掉的那一条**再也回不来**，而这件事只写在按钮上（§7.3）。
 *    seed 两处一样 —— 它不替换，只是在看板上多加一行。
 */
const SHARE_FORM_SUBMIT_KEYS: Record<ShareKind, { none: string; live: string }> = {
  room: { none: 'shares.formSubmitRoom', live: 'shares.formReplaceRoom' },
  seed: { none: 'shares.formSubmitSeed', live: 'shares.formSubmitSeed' },
};

/** 介绍页两块卡片各自的标题与说明（`introRoomsTitle/Desc` 与标签页那两条**不是**同一句）。 */
const SHARE_INTRO_KEYS: Record<ShareKind, { title: string; desc: string }> = {
  room: { title: 'shares.introRoomsTitle', desc: 'shares.introRoomsDesc' },
  seed: { title: 'shares.introSeedsTitle', desc: 'shares.introSeedsDesc' },
};

// ---------------------------------------------------------------------------
// 服务端偏移量：一次响应只算一次，然后冻住
// ---------------------------------------------------------------------------

/**
 * ★★ 把本地时钟折算成服务端时钟的那一个偏移量 —— **只在一次新的响应上算一次**。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 为什么非"冻住"不可（把代数写出来，不然看不出哪里会坏）
 * ---------------------------------------------------------------------------
 * 每秒都要算的是：`remaining = expiresAt - nowMs - offset`。
 *
 *   · 如果**每一秒都重算** `offset = serverNow - nowMs`，那么恒有
 *     `nowMs + offset === serverNow` ⇒ `remaining` 每秒都是**同一个数**
 *     ⇒ 倒计时**根本不动**，看起来像页面卡住了；
 *     而"到点即消失"也退化成"下一次 20 秒轮询时才消失" —— 那正是 spec §7.6
 *     明确要避免的事（本地计时负责到点即消失）。
 *   · 只算一次之后：`offset` 是个常量，`nowMs` 每秒 +1s ⇒ `remaining` 每秒少 1s ✓
 *     （而且因为 `offset` 里带着服务端时刻，快/慢 3 分钟的机器显示的是**同一份**剩余时间）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 键为什么取 `board.serverNow` 而不是 `board` 这个对象本身
 * ---------------------------------------------------------------------------
 * `serverNow` 是"这一次响应"的标识（毫秒时间戳，20 秒一轮不可能撞上）。
 * 取对象本身的话，容器只要哪天顺手把响应复制一份（`{ ...board, items: … }`）
 * 传下来，每一秒都会被当成"新响应" ⇒ offset 每秒重算 ⇒ 又回到上面那个"倒计时不动"。
 *
 * ⚠️ 用的是 `useRef` 而不是 `useState`：这只影响**渲染时算出来的一个数**，
 *    不构成"要重渲染的状态"。用 `useState` 的话每来一次响应都要多跑一轮渲染；
 *    用 `useMemo` 更糟 —— React 允许把 memo 缓存丢掉，丢掉之后会用**当时**的
 *    `nowMs` 重算偏移量，于是 `remaining` 会往回跳（已经消失的行会重新出现）。
 */
function useServerOffset(board: ShareListResponse | null, nowMs: number): number {
  const anchor = useRef<{ serverNow: number; offset: number } | null>(null);

  if (board !== null && anchor.current?.serverNow !== board.serverNow) {
    anchor.current = { serverNow: board.serverNow, offset: serverOffset(board.serverNow, nowMs) };
  }

  // 还没有任何响应（加载中）时用 0 —— 那时一行都渲染不出来，这个值用不到。
  return anchor.current?.offset ?? 0;
}

// ---------------------------------------------------------------------------
// 一行里那点共同的东西：内容与「复制」
// ---------------------------------------------------------------------------

/**
 * 一条分享的**内容**：room 是一个放大的房间号，seed 是"填了的那几格"。
 *
 * ⚠️★ seed **只渲染填了的格**（§7.4）：空的格子**不渲染**，而不是渲染成一排破折号
 *    （那看起来像"这里本来该有东西，丢了"）。`optionalSeed` 把空串变成了 `undefined`，
 *    所以这里用真值判断就是判据本身。
 *
 * ⚠️ 窄化靠的是 **payload 的形状**（`'code' in payload`）而不是 `item.kind`：
 *    `LiveShare` 里 `kind` 与 `payload` 是两个并列字段，TS 不会按 `kind` 去窄化
 *    `payload`，写成 `kind === 'room'` 就只能靠类型断言。而 payload 的形状本来
 *    就是权威（服务端写入时按 kind 过 `parseSharePayload`）。
 *
 * ⚠️ `onCopy` 可选**只**因为它有两个调用点：看板上的行（每一行都要有复制，§7.4）与
 *    「你的一条」里的行（那里不接复制）。⚠️ 后者的后果写在 `ShareMineBar` 那一段注释里
 *    （一条已下架的行全页没有复制入口）—— 那是记录下来的取舍，不是漏传。
 */
function ShareContent({ item, onCopy }: { item: LiveShare; onCopy?: (text: string) => void }) {
  const { t } = useTranslation();

  if ('code' in item.payload) {
    const payload: RoomPayload = item.payload;
    return (
      <span className="share__code">
        <span className="share__codevalue">{payload.code}</span>
        {onCopy ? <ShareCopyButton text={payload.code} onCopy={onCopy} /> : null}
      </span>
    );
  }

  const payload: SeedPayload = item.payload;
  /* 四格按**固定顺序**给，即使中间有空缺（主世界 / 下界 / 末地 / RNG 是这一栏的固有顺序）。 */
  const slots: { label: string; value: string | undefined }[] = [
    { label: t('shares.formOverworld'), value: payload.overworld },
    { label: t('shares.formNether'), value: payload.nether },
    { label: t('shares.formEnd'), value: payload.end },
    { label: t('shares.formRng'), value: payload.rng },
  ];

  return (
    <span className="share__seeds">
      {slots.map((slot) =>
        slot.value ? (
          <span key={slot.label} className="share__seed">
            <span className="share__seedlabel">{slot.label}</span>
            <code className="share__seedvalue">{slot.value}</code>
            {onCopy ? <ShareCopyButton text={slot.value} onCopy={onCopy} /> : null}
          </span>
        ) : null,
      )}
    </span>
  );
}

/**
 * 「复制」—— ★ **每一行都有**（§7.4）：复制是给**看的人**用的
 * （他要把别人的房间号/种子拷进游戏），不是只给作者用的。
 *
 * ⚠️ 这里**不碰剪贴板**：`navigator.clipboard` 是浏览器 API，而且它失败了
 *    **必须看得见**（`shares.copyFailed`，§7.4 的"不许静默"）。落点在容器
 *    （`onCopy` → 容器写剪贴板、把结果放进 `notice`），这一层只把一个值交出去 ——
 *    纯组件在 SSR 下因此也渲染得出来（`renderToStaticMarkup` 里没有点击这件事）。
 *
 * ⚠️ `aria-label` 里带上要复制的那个值：一屏可能有二十几个一模一样的「复制」，
 *    读屏软件念出来全是同一个词，根本分不清是哪一个（`components/` 里那个贡献者面板
 *    的「移除」按钮带着名字与 id，是同一条理由）。
 */
function ShareCopyButton({ text, onCopy }: { text: string; onCopy: (text: string) => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="ghostbtn share__copy"
      aria-label={`${t('shares.copy')}: ${text}`}
      onClick={() => onCopy(text)}
    >
      {t('shares.copy')}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 看板上的一行
// ---------------------------------------------------------------------------

export interface ShareBoardRowProps {
  item: LiveShare;
  /**
   * 剩余毫秒 —— **已经按服务端偏移算过**（由 `ShareBoardView` 算一次传下来）。
   * 调用方负责把 `<= 0`（到点）的行**去掉**再渲染：那时 `remainText` 返回空串。
   */
  remainMs: number;
  /** 「复制」按下去的落点。**必填** —— 每一行都必须有复制，不给"忘了传"的机会。 */
  onCopy: (text: string) => void;
}

/** 看板上的一行：内容 → 说明（空则不渲染）→ 谁发的 → 还剩 N 分钟（+ 「你」标记）。 */
export function ShareBoardRow({ item, remainMs, onCopy }: ShareBoardRowProps) {
  const { t } = useTranslation();
  const remain = remainText(remainMs, t);

  return (
    <li className="share__row">
      <div className="share__rowhead">
        <ShareContent item={item} onCopy={onCopy} />
        {/*
          ⚠️ 「你」标记：`mine` 是服务端算的（"是不是当前这个请求的人发的"），
             前端一个字都不重算 —— 自己推的话，"我发的那条"在两台设备上会给出不同答案。
        */}
        {item.mine ? <span className="share__you">{t('shares.boardYou')}</span> : null}
      </div>
      {/*
        ⚠️★ 说明为空时**整块不渲染**（`LiveShare.note` 的空值是 `''`，**不是** `null`）：
           渲染一个空的 `<p>` 会在两行之间留一条空白，看起来像这一行渲染坏了。
           ⚠️ 判据用 `trim()`：服务端的 note 不做 trim（`noteSchema` 只判宽度），
              所以 `'   '` 是存得进去的 —— 那种也按"没写"处理，否则又会出现那条空白。
              （渲染的仍是**原样**的 note，这里只是拿它来判断"该不该渲染"。）
      */}
      {item.note.trim() ? <p className="share__note">{item.note}</p> : null}
      <div className="share__rowfoot">
        <span className="share__by">{t('shares.boardBy', { name: item.authorName })}</span>
        {/* 到点的行已经被调用方摘掉，所以这里不会出现空串；万一出现了就整块不渲染。 */}
        {remain ? <span className="share__remain">{remain}</span> : null}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// 发布表单
// ---------------------------------------------------------------------------

export interface ShareFormProps {
  kind: ShareKind;
  /** 我**在展示**的条数 ≥ 1 —— 决定提交键的文案（room 换成"替换"那一句）。 */
  hasLive: boolean;
  /**
   * 到额度了（**只有 seed 会到**，`liveCount >= SHARE_LIMITS.seed`）⇒
   * 提交键禁用，并在旁边说明为什么（§7.3 最后一行）。
   * ⚠️ room 到"额度"就是"我正展示着一条"，那时该做的是**替换**，不是禁用。
   */
  atLimit: boolean;
  busy: boolean;
  /** 交出去的是**按 kind 拼好的 body**（形状见 §5.3）—— 由页面交给 `postShare`。 */
  onSubmit: (body: unknown) => void;
}

/**
 * 发布表单。room = 房间号 + 说明；seed = 四个种子（只有主世界必填）+ 说明；
 * 展示时长**两种 kind 不一样**（2026-09-16）：room 是四档 radio（**默认 5 分钟**），
 * seed 是**自己填的天数**（1–30，**默认 7 天**）。
 *
 * ⚠️ 值**两端 trim**（§7.3：`" A7K2P "` ⇒ `A7K2P`），中间的空白按字符集判
 *    （房间号含空格 = 非法、种子含空白 = 非法）。trim 之后**原样保存原样显示**：
 *    不折叠大小写、不做任何归一化。
 *
 * ⚠️ 字段级校验在这里做，用的是 shared 的**同一批常量与函数**
 *    （`SHARE_CODE_PATTERN` / `SHARE_CODE_MIN` / `SHARE_CODE_MAX` / `SHARE_SEED_MAX` /
 *    `SHARE_NOTE_UNITS` / `textWidth` / `parseShareDays`）——
 *    规则只有一份定义，服务端与这里各执行一遍（与 `parseSharePost` 跑两遍 schema
 *    是同一件事）。之所以要在客户端先判一次：逐字段的红字只有这里挂得上
 *    （`shares.err*` 那七条就是为这件事写的），而服务端的 400 只回 `issues` 的路径文本。
 */
export function ShareForm({ kind, hasLive, atLimit, busy, onSubmit }: ShareFormProps) {
  const { t } = useTranslation();

  const [code, setCode] = useState('');
  const [overworld, setOverworld] = useState('');
  const [nether, setNether] = useState('');
  const [end, setEnd] = useState('');
  const [rng, setRng] = useState('');
  const [note, setNote] = useState('');
  const [minutes, setMinutes] = useState<ShareMinutes>(DEFAULT_SHARE_MINUTES);
  /*
   * ★ 天数存的是**用户输入的原文**（字符串），不是解析后的数字。
   * ⚠️ 与 `components/SeedFilters.tsx` 的 `completion` 存字符串同一条理由：
   *    解析失败时那个值必须**留在输入框里**（被清空的话用户不知道自己哪里填错了），
   *    而"填错了"正是它最常见的状态。
   * ⚠️ 初值是 `String(DEFAULT_SHARE_DAYS)`（= `'7'`）：SSR 产物里输入框的 `value`
   *    就是这个字面量 `7` —— 渲染自检正是这么断言"默认 7 天"的。
   */
  const [days, setDays] = useState(String(DEFAULT_SHARE_DAYS));
  /** 逐字段的红字。key 就是下面那几个控件名，空对象 = 没有错。 */
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    // 到额度 / 正在提交：按钮本来就是禁用的，这里再挡一次（回车提交绕得过去）
    if (busy || atLimit) return;

    const next: Record<string, string> = {};
    const trimmedCode = code.trim();
    const seeds = {
      overworld: overworld.trim(),
      nether: nether.trim(),
      end: end.trim(),
      rng: rng.trim(),
    };

    if (kind === 'room') {
      /*
       * ⚠️ 长度先判、字符集后判：一个 21 字符的合法房间号，用户要改的是长度；
       *    而 `ab` 那种两个字符的，说"只能用字母数字"会让人以为自己打错了符号。
       */
      if (trimmedCode.length < SHARE_CODE_MIN || trimmedCode.length > SHARE_CODE_MAX) {
        next.code = t('shares.errCodeLength');
      } else if (!SHARE_CODE_PATTERN.test(trimmedCode)) {
        next.code = t('shares.errCodeShape');
      }
    } else {
      const checkSeed = (value: string, field: string, required: boolean) => {
        if (!value) {
          if (required) next[field] = t('shares.errSeedRequired');
          return;
        }
        // ⚠️ 空白**在中间**也算非法（§10 的已知限制：带空格的文本种子会被拒 —— 用户批准的）
        if (/\s/.test(value)) next[field] = t('shares.errSeedSpace');
        else if (value.length > SHARE_SEED_MAX) next[field] = t('shares.errSeedLength');
      };
      checkSeed(seeds.overworld, 'overworld', true);
      checkSeed(seeds.nether, 'nether', false);
      checkSeed(seeds.end, 'end', false);
      checkSeed(seeds.rng, 'rng', false);
    }

    /*
     * ★ 种子的展示天数是**自由填写**的（1–30 的整数），所以它和上面那几格一样
     *   必须在客户端判一次。⚠️ 判据**不在这里**：它住在 shared 的 `parseShareDays`
     *   （那里有"为什么不用 `Number(raw)`"以及"为什么它不写在组件里"两条理由）。
     * ⚠️ room 不走这一支：它的时长是四个 radio，选不出非法值（§13 的枚举）。
     */
    let dayCount: number | null = null;
    if (kind === 'seed') {
      dayCount = parseShareDays(days);
      if (dayCount === null) next.days = t('shares.errDays');
    }

    /*
     * 说明按**显示宽度**判（一个汉字算 2，`textWidth`）—— 所以那句文案必须把
     * "一个汉字算 2"说出来，否则写了 21 个汉字的用户会觉得上限是假的。
     */
    const noteUnits = SHARE_NOTE_UNITS[kind];
    if (textWidth(note) > noteUnits) {
      next.note = t('shares.errNoteTooLong', { max: noteUnits });
    }

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    /*
     * ⚠️ 选填的种子**只在填了的时候**才放进 body（空串一律不要）：
     *    "没填"与"填了空"在库里必须是同一件事（shared 的 `optionalSeed` 也会把
     *    空串变成 `undefined`），而少传一个键是最不容易读错的那种写法。
     * ⚠️ 两个 kind 的时长键**名字不同**（`minutes` / `days`，见 `SeedPostSchema`）：
     *    写成同一个名字会让"7 是 7 分钟还是 7 天"这个歧义从 body 一路带到库里。
     */
    onSubmit(
      kind === 'room'
        ? { code: trimmedCode, note, minutes }
        : {
            overworld: seeds.overworld,
            nether: seeds.nether || undefined,
            end: seeds.end || undefined,
            rng: seeds.rng || undefined,
            note,
            /*
             * ⚠️ `dayCount` 走到这里**一定不是 null**（上面 `next` 非空就 return 了）。
             *    写成 `?? DEFAULT_SHARE_DAYS` 是给类型收窄用的，不是一个兜底逻辑：
             *    真走到那一支说明有人在校验与提交之间插了一步，而那时发出去的是
             *    **合法的默认值**，不是 `NaN`（`NaN` 会让服务端那条 `CHECK` 直接拒）。
             */
            days: dayCount ?? DEFAULT_SHARE_DAYS,
          },
    );
  }

  const submitLabel = t(SHARE_FORM_SUBMIT_KEYS[kind][hasLive ? 'live' : 'none']);

  return (
    <form className="share__form" onSubmit={submit}>
      {kind === 'room' ? (
        <Field id="share-code" label={t('shares.formRoomCode')} hint={t('shares.formRoomCodeHint')}>
          {/*
            ⚠️★ 输入框的类名是设计系统里那一个 —— `.mcsr-field__input`（`styles.css`），
              而**不是**这里原先写的 `mcsr-input`：**全仓没有任何 `.mcsr-input` 规则**，
              所以那六个控件（房间号 / 四个种子 / 说明）一直以**浏览器默认样式**渲染在
              一个有样式的 `.share__form` 里，而这是这一栏唯一的上帖入口。
            ⚠️ 这个笔误在 Task 5 的两轮评审与 Task 6 的评审里都活着 —— 因为**全仓没有
              任何门禁会发现"组件渲染了一个不存在的类名"**：渲染自检只看文字内容、
              字体覆盖只看码点、词条守卫只看字符串。改这里之前先确认 `styles.css` 里
              真的有那一条规则，别把它"简化"回一个更短的名字。
          */}
          <input
            id="share-code"
            className="mcsr-field__input"
            type="text"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          {errors.code ? <p className="fielderr">{errors.code}</p> : null}
        </Field>
      ) : (
        <>
          <Field id="share-overworld" label={t('shares.formOverworld')}>
            {/* ⚠️ `inputMode="text"` 而不是 `type="number"`：种子是**字符串**
                （64 位整数超出 JS 的安全范围，`Number` 会静默改值 —— 见
                `components/SeedResultCard.tsx` 的文件头）。 */}
            <input
              id="share-overworld"
              className="mcsr-field__input"
              type="text"
              inputMode="text"
              value={overworld}
              onChange={(event) => setOverworld(event.target.value)}
            />
            {errors.overworld ? <p className="fielderr">{errors.overworld}</p> : null}
          </Field>
          <p className="share__formhint">{t('shares.formSeedOptional')}</p>
          <Field id="share-nether" label={t('shares.formNether')}>
            <input
              id="share-nether"
              className="mcsr-field__input"
              type="text"
              inputMode="text"
              value={nether}
              onChange={(event) => setNether(event.target.value)}
            />
            {errors.nether ? <p className="fielderr">{errors.nether}</p> : null}
          </Field>
          <Field id="share-end" label={t('shares.formEnd')}>
            <input
              id="share-end"
              className="mcsr-field__input"
              type="text"
              inputMode="text"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
            {errors.end ? <p className="fielderr">{errors.end}</p> : null}
          </Field>
          <Field id="share-rng" label={t('shares.formRng')}>
            <input
              id="share-rng"
              className="mcsr-field__input"
              type="text"
              inputMode="text"
              value={rng}
              onChange={(event) => setRng(event.target.value)}
            />
            {errors.rng ? <p className="fielderr">{errors.rng}</p> : null}
          </Field>
        </>
      )}

      <Field id="share-note" label={t('shares.formNote')} hint={t('shares.formNoteHint')}>
        <textarea
          id="share-note"
          className="mcsr-field__input"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        {errors.note ? <p className="fielderr">{errors.note}</p> : null}
      </Field>

      {/*
        ★ 展示时长**按 kind 分叉**（2026-09-16 用户要求：种子改成"以天为单位、
          最多 30 天、自行填写"），而分叉是**结构上**的（两支各自渲染自己的控件），
          不是同一个控件换一套属性 —— 两者的约束本来就不是一回事：
          room 是**四档枚举**（`minutes` 只接受那四个值，§13），seed 是**区间**（1–30）。

        ⚠️ room 那一支的受控 `checked`（不是 `defaultChecked`）：默认那一档来自
           `DEFAULT_SHARE_MINUTES`（= 5），SSR 产物里它就是那个带 `checked` 的 radio
           —— 渲染自检正是这么断言"默认选中 5 分钟"的。
        ⚠️★ seed 那一支用 `<Field>`（标签 + 提示 + 红字），与房间里其它几格同形，
           而**不用** `type="number"`：浏览器会把 `abc` 这种输入在 `value` 上**吃掉**
           （读出来是空串）⇒ "没填"与"填错了"分不出来，红字也就挂不上。
           与 `ShareForm` 里那六个输入框同一条做法（text + `inputMode`）。
      */}
      {kind === 'room' ? (
        <fieldset className="share__minutes">
          <legend className="share__minuteslegend">{t('shares.formMinutes')}</legend>
          {SHARE_MINUTES.map((value) => (
            <label key={value} className="share__minute">
              <input
                type="radio"
                name={`share-minutes-${kind}`}
                value={value}
                checked={minutes === value}
                onChange={() => setMinutes(value)}
              />
              {t('shares.minutes', { n: value })}
            </label>
          ))}
        </fieldset>
      ) : (
        <Field id="share-days" label={t('shares.formDays')} hint={t('shares.formDaysHint')}>
          <input
            id="share-days"
            className="mcsr-field__input"
            type="text"
            inputMode="numeric"
            value={days}
            onChange={(event) => setDays(event.target.value)}
          />
          {errors.days ? <p className="fielderr">{errors.days}</p> : null}
        </Field>
      )}

      {/*
        ⚠️ 到额度时**禁用**提交键（不是隐藏它）：用户要看得见"这里本来有个按钮，
           它现在按不动"，而旁边那句话告诉他为什么、下一步做什么。
      */}
      <button type="submit" className="cta share__submit" disabled={busy || atLimit}>
        {busy ? t('shares.formSubmitting') : submitLabel}
      </button>
      {atLimit ? (
        <p className="share__limit">{t('shares.atLimitSeeds', { max: SHARE_LIMITS.seed })}</p>
      ) : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// 「你的一条」
// ---------------------------------------------------------------------------

export interface ShareMineBarProps {
  kind: ShareKind;
  /** 我自己的行（**未过期的**，含已下架的）—— 到点的那些由调用方先摘掉。 */
  mine: LiveShare[];
  /** 在展示的条数（服务端的额度用量，§5.1）。 */
  liveCount: number;
  /** 这个 kind 的额度（取自响应的 `limit`，不是本地常量）。 */
  limit: number;
  nowMs: number;
  /** 已经冻住的服务端偏移量（见 `useServerOffset`）。 */
  offset: number;
  busy: boolean;
  onHide: (id: string) => void;
  onRestore: (id: string) => void;
  /**
   * ★ 「彻底删除」第二步的落点（2026-09-16 新增）。**必填** —— 与页面那三格
   * （`onRetry` / `onResendVerify` / `lastUpdatedAtMs`）同一条理由：
   * 可选 + 缺省时把按钮禁掉的话，"忘了接线"的表现是一颗**永远灰着的按钮**，
   * 而**所有门禁都绿**（渲染自检断言的是"入口在不在"，禁用也算在）。
   * 必填之后忘了传是**编译错误**，而"入口在不在"照样能被断言。
   */
  onDelete: (id: string) => void;
  onSubmit: (body: unknown) => void;
}

/**
 * 「你的一条」—— 四个形态（§7.3 第 2 行）：
 *
 * | 我的行 | room | seed |
 * |---|---|---|
 * | 一条都没有 | 「你现在没有挂东西。」+ 展开表单 | 同左 |
 * | 有在展示 | 「你正在展示这一条。」+ 那几行 + 各自的「下架」 | 「你在展示 N / 20 条」+ 同样的列表 |
 * | 已下架未过期 | 「你下架了这一条。」+「恢复」 | 混在上面那个列表里（那一行带「恢复」） |
 * | 到额度 | ——（room 到额度就是"正在展示"，该做的是替换） | 提交键禁用 + 那句话 |
 *
 * ⚠️ 两种 kind 共用**同一个列表**（每一行：内容 + 剩余 + 下架/恢复/删除），而不是
 *    room 一套、seed 一套：数据上 room 的 `mine` 也可能同时有一条 active 和一条
 *    hidden（下架过、又发过新的那种），给它写死"一条"的话第二种状态就渲染不出来。
 *    合并之后上面四格仍然是四种**不同的画面**（状态句 + 按钮 + 那个展开键都不同）。
 *
 * ===========================================================================
 * ★★ 已下架那一行的两个动作，以及"删除为什么要两步"（2026-09-16）
 * ===========================================================================
 * | 那一行 | 按钮 |
 * |---|---|
 * | `active` | 「下架」（**可逆**，所以没有确认框） |
 * | `hidden`，还没点过删除 | 「恢复」+「彻底删除」 |
 * | `hidden`，点过「彻底删除」 | 「确认彻底删除」+「取消」（**其余两个都不渲染**） |
 *
 * ⚠️★ 用户明确要的是两步（2026-09-16）：`下架 → 删除` 是**服务端的**前提
 *    （`deleteShare` 只对 `status='hidden'` 放行），而界面上的第二次点击是
 *    防手滑的那一道 —— 硬删除没有回收站。
 * ⚠️ 它与「下架」的区别正是本仓那条老规矩的应用：`shares.hideHint` 明说下架随时
 *    能恢复（**到点**才不能），而删除连行都不剩 ⇒ 它是这一栏**唯一**一个需要
 *    确认的动作。（另一处不可逆的动作是 room 的**替换**，那里用的是"把后果写在
 *    按钮上"，因为它没有第二步可站 —— 见 `SHARE_FORM_SUBMIT_KEYS`。）
 * ⚠️ 确认态是**一个 `id`**，不是每行一个布尔：同时只可能有一行在等确认
 *    （点第二行的「彻底删除」会让第一行退回原状），于是不存在"两行同时举着确认"
 *    那种要人去想"再点一下会删掉哪一条"的画面。
 * ⚠️ 它住在这一层（`ShareMineBar`）而不是每一行里：行组件是纯展示的，
 *    而这个状态要在**行之间**互斥。
 */
export function ShareMineBar(props: ShareMineBarProps) {
  const { t } = useTranslation();
  const { kind, mine, liveCount, limit, nowMs, offset, busy } = props;
  /** 正在等第二次确认的那一行（`null` = 没有）。见上面那段注释。 */
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const hasLive = mine.some((row) => row.status === 'active');
  // ⚠️ 只有 seed 会因为额度禁用提交（room 的那一档是"替换"，见 `ShareFormProps.atLimit`）
  const atLimit = kind === 'seed' && liveCount >= limit;

  return (
    <section className="share__mine">
      {mine.length === 0 ? (
        <p className="share__minestate">{t('shares.mineNone')}</p>
      ) : kind === 'seed' ? (
        <p className="share__minestate">{t('shares.mineCount', { n: liveCount, max: limit })}</p>
      ) : hasLive ? (
        <p className="share__minestate">{t('shares.mineActive')}</p>
      ) : (
        <p className="share__minestate">{t('shares.mineHidden')}</p>
      )}

      {/*
        ★ 我自己的每一行 —— 这是全站**唯一**有「下架 / 恢复 / 彻底删除」的地方。
          ⚠️ 已下架的那一条**只在这里**出现（`items` 里没有它，它已经不在看板上），
             所以"恢复"这个动作也只有这里挂得上。
        ⚠️★ 这一块**没有「复制」**（`ShareContent` 不接 `onCopy`）。理由：§7.4 的复制
             是给"要把**别人的**房间号/种子拷进游戏"的人用的，而这里每一条都是我自己
             刚填过的。⚠️ **代价记在明面上**（2026-09-15 评审指出）：一条**已下架**的行
             只出现在这个列表里，所以对那一行而言，全页**没有任何复制入口**。
             要补的话就是在这一块也接一个 `onCopy`（`ShareMineBar` 目前没有这一格，
             那是一处接口变更，不在本轮的冻结清单里）—— 记在这里，不要以为是漏了。
      */}
      {mine.length > 0 ? (
        <ul className="share__minelist">
          {mine.map((row) => {
            const remain = remainText(remainingMs(row.expiresAt, nowMs, offset), t);
            return (
              <li key={row.id} className="share__minerow">
                <ShareContent item={row} />
                {remain ? <span className="share__remain">{remain}</span> : null}
                {/*
                  ⚠️★ 三个形态是**互斥**的，而且顺序有意义：先判 `active`（它只有一个
                     动作），再判"这一行是不是正在等确认"，最后才是那两个动作。
                     ⚠️ `replaced` 走不到这里（`listMine` 不含它，§5.1）—— 真到了就是
                     走到了下面那一支，而 `hidden` 那一支的两个动作对它会各自 409。
                */}
                {row.status === 'active' ? (
                  <button
                    type="button"
                    className="ghostbtn"
                    disabled={busy}
                    onClick={() => props.onHide(row.id)}
                  >
                    {t('shares.hide')}
                  </button>
                ) : confirmId === row.id ? (
                  <>
                    {/*
                      ⚠️ 第二步的两颗按钮**替掉**了「恢复」与「彻底删除」，而不是加在
                         它们旁边：再点一次「彻底删除」不该有任何效果，而一颗按下去
                         什么都不做的按钮比没有按钮更坏（本仓老规矩）。
                      ⚠️ `onDelete` 之前先 `setConfirmId(null)`：删除成功之后这一行会
                         被回读掉，但这个 id 还留在 state 里 —— 不清的话，万一将来出现
                         "同一个 id 又回来了"的画面，它会一上来就是确认态。
                    */}
                    <button
                      type="button"
                      className="ghostbtn"
                      disabled={busy}
                      onClick={() => {
                        setConfirmId(null);
                        props.onDelete(row.id);
                      }}
                    >
                      {t('shares.deleteConfirm')}
                    </button>
                    <button
                      type="button"
                      className="ghostbtn"
                      disabled={busy}
                      onClick={() => setConfirmId(null)}
                    >
                      {t('common.cancel')}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="ghostbtn"
                      disabled={busy}
                      onClick={() => props.onRestore(row.id)}
                    >
                      {t('shares.restore')}
                    </button>
                    {/*
                      ★ 第一步。它只是把这一行切成确认态（不发请求）—— 硬删除是
                         `shares.deleteConfirm` 那颗按钮的事。
                      ⚠️ 文案不写「（不能恢复）」那种括号：第二步那一下才是终局，
                         写在第一步上会让"点了之后什么都没发生"显得像没生效。
                    */}
                    <button
                      type="button"
                      className="ghostbtn"
                      disabled={busy}
                      onClick={() => setConfirmId(row.id)}
                    >
                      {t('shares.deleteShare')}
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {/*
        ★ 「下架之后看板上就没有了，随时可以恢复。**到点**之后就不能恢复了。」
        ⚠️★ 这一句里有一对 `**` ⇒ **必须走 `em()`**（不走的话用户看到一对字面星号）。
           这一处是 `services/api/src/i18n-keys.test.ts` 的 `EXPECTED_SITES` 里登记的
           那一处（`shape: 'em'`、`count: 1`）—— 改这里之前先读那个文件。
        ⚠️ 只在"确实有东西可以下架/恢复"时渲染：没有我的行时，这句话说的是一个
           不存在的动作。
        ⚠️ 它说的是**可逆的边界**（随时能恢复，**到点**就不能），所以它必须紧贴着
           那两个按钮，而不是藏进 tooltip。
      */}
      {mine.length > 0 ? <p className="share__hidehint">{em(t('shares.hideHint'))}</p> : null}

      {/*
        ⚠️★ 用原生 `<details>` 而不是自己写一个 `useState` 开关，两个理由
           （与 `CalendarSeriesSection` 的 `.series__colors`、`LiveManagePanel` 的
           `.livemanage__advanced` 完全一致）：
             ① 闭合的 `<details>`，**内容仍然在 DOM 里** ⇒ 纯 SSR 的渲染自检
                （`renderToStaticMarkup`：不跑 effect、不点击）**看得见**表单本体。
                做成受控开关的话，SSR 里永远只有一个 summary ——
                四档时长、"默认 5"、替换那一句文案全都成了**没有任何检查覆盖**
                的东西，而它们恰恰是这一轮的功能本体。
             ② 展开态由浏览器按元素保存，不需要在这里维护一个 id 集合。
      */}
      <details className="share__postform">
        <summary className="share__postbtn">
          {t(SHARE_FORM_OPEN_KEYS[kind][hasLive ? 'live' : 'none'])}
        </summary>
        <ShareForm
          kind={kind}
          hasLive={hasLive}
          atLimit={atLimit}
          busy={busy}
          onSubmit={props.onSubmit}
        />
      </details>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 游客 / 未验证
// ---------------------------------------------------------------------------

/**
 * 游客那一屏：一句"要登录" + 登录入口。
 *
 * ⚠️ 容器在游客这一支**根本不请求任何接口**（§7.2：先看 `useAuth()` 再决定发不发）：
 *    不是"发了再吃 401"—— 那会在服务端留下一条"有人在试着读"的噪音，
 *    而游客看到的闪烁是"先加载、再变成登录可见"。
 * ⚠️ 登录入口用现成的 `nav.login`（与全站其它"去登录"的地方同一句），不新写词条。
 */
export function ShareGuestNotice() {
  const { t } = useTranslation();
  return (
    <div className="share__guest">
      <p className="share__guesttext">{t('shares.loginNeeded')}</p>
      <Link className="cta share__guestlogin" to="/login">
        {t('nav.login')}
      </Link>
    </div>
  );
}

/**
 * 「还没验证邮箱」那一屏（§7.5 第 2 行）：看板照常，只有"你的一条"换成它。
 *
 * ⚠️★ `onResend` **必填**（2026-09-15 订正，见 `ShareBoardViewProps.onResendVerify`）：
 *    这里原本写成可选、缺省时把按钮禁掉，那样调用方忘了传的后果是**一颗永远灰着的按钮**
 *    而**所有门禁都绿**（渲染自检只看"入口在不在"，禁用也算在）。改成必填之后
 *    忘了传是**编译错误** —— 与渲染自检能断言"入口在不在"这两件事都保住了。
 *    `renderToStaticMarkup` 侧照旧：它传一个空函数就行（它验的是产物，不是点击）。
 */
export function ShareVerifyNotice({ busy, onResend }: { busy: boolean; onResend: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="share__verify">
      <p className="share__verifytext">{t('shares.needVerify')}</p>
      <button type="button" className="ghostbtn" disabled={busy} onClick={onResend}>
        {t('shares.resendVerify')}
      </button>
    </div>
  );
}

/**
 * 失败那一屏上的「重试」。
 *
 * ⚠️★ `onRetry` **必填**（2026-09-15 订正，见 `ShareBoardViewProps.onRetry`）：
 *    这里原本写成可选、缺省时把按钮禁掉 —— 那样"忘了接线"的表现是一颗永远灰着的按钮，
 *    而**所有门禁都绿**（渲染自检只看"入口在不在"，禁用也算在）。必填之后
 *    忘了传是**编译错误**，而"入口在不在"照样能被渲染自检断言（脚本传空函数即可）。
 */
function ShareRetry({ busy, onRetry }: { busy: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <p className="share__actions">
      <button type="button" className="ghostbtn" disabled={busy} onClick={onRetry}>
        {t('common.retry')}
      </button>
    </p>
  );
}

// ---------------------------------------------------------------------------
// ① 介绍页的纯视图（公开）
// ---------------------------------------------------------------------------

export interface ShareIntroViewProps {
  /** 登录了吗 —— 决定条数那一行说什么（游客**不会**有 `summary`）。 */
  authed: boolean;
  /**
   * `null` = 还没取到（或游客，压根不会去取，§7.2）。
   *
   * ⚠️ 用 `null` 而不是"两个 0"来区分这两件事：游客看到"0 条在展示"会以为
   *    这里现在没人分享，而事实是**内容不给游客看**（那是本栏目唯一的那条线）。
   * ⚠️ "还在取"与"取失败了"**都是 `null`** —— 分开它们的是下面那一格，不是它。
   */
  summary: ShareSummary | null;
  /**
   * ★★ 那一次取数**失败了**（2026-09-15 补的：这是一个**计划空白**，不是实现疏漏）。
   *
   * ⚠️ 它为什么必须存在：原先这三格只有 `authed` 与 `summary`，而失败只能把
   *    `summary` 留在 `null` ⇒ 视图把它渲染成 `common.loading`（「加载中」）⇒
   *    **登录用户会一直等下去**，既没有重试，也分不出"慢"和"挂了"。
   *    这一格让"读不到"变成一件**说得出来**的事，而不是让它长得像加载中。
   * ⚠️★ 它是**必填**（不是可选）：可选 + 缺省当成"没失败"，会把"调用方忘了接线"
   *    变成一件**所有门禁都绿**的静默失效 —— 本计划在 `onRetry` / `onResendVerify`
   *    那两格上已经踩过一次（`ShareBoardViewProps` 的注释里记着那次教训）。
   */
  summaryFailed: boolean;
  /**
   * 失败了就再取一次（**必填**，理由同上）。
   *
   * ⚠️ 它**只在 `authed && summaryFailed` 时**渲染出来（视图里那个条件的原话）：
   *    这一页不自动刷新（§7.6），所以"重试"是用户唯一的第二次机会；
   *    而游客没有请求可重试，一颗按下去什么都不会发生的按钮比没有按钮更坏。
   */
  onRetry: () => void;
}

/**
 * 介绍页：标题 + 导语 + 两块可点的卡片。
 *
 * ⚠️ 导语那一句是游客**唯一**读得到的东西，所以要靠它说清两件事
 *    （会自己消失 / 内容要登录）—— 只说得清一件的话，游客会以为自己是"来晚了"。
 * ⚠️★ 游客的产物里**不许出现任何条数**（§7.2）：那一行对游客说的是另一句话，
 *    而不是一个 0。这一条由渲染自检的**产物级断言**守着。
 * ⚠️ 介绍页**不自动刷新**（§7.6）：它是静态介绍 + 一个附注性质的条数，
 *    没有"实时"的要求 —— 别因为"同属一个栏目"就顺手给它加一个定时器。
 */
export function ShareIntroView({ authed, summary, summaryFailed, onRetry }: ShareIntroViewProps) {
  const { t } = useTranslation();

  /**
   * 一块卡片上那一行条数。⚠️ 四种情况是**四句话**，不能合成一句
   * （后两句尤其不能：让"读不到"长得像"加载中"正是这一格要治的缺陷）。
   */
  function countText(cardKind: ShareKind): string {
    // ⚠️ 游客这一支排在最前：他这一次请求压根没发（§7.2），所以"失败/加载中"都不属于他
    if (!authed) return t('shares.introGuestCount');
    if (summaryFailed) return t('shares.countFailed');
    // 登录了但还没取到：说"加载中"，**不要**说"登录后可见"（他自己就是登录用户）
    if (summary === null) return t('common.loading');
    return t('shares.introCount', { n: summary[cardKind].live });
  }

  return (
    <section className="shareIntro">
      {/* 标题用栏目名（侧栏那一行是同一个词条），不新写一句 */}
      <h1 className="shareIntro__title">{t('nav.shares')}</h1>
      <p className="shareIntro__lead">{t('shares.introLead')}</p>
      <div className="shareIntro__cards">
        {SHARE_KINDS.map((cardKind) => (
          /* 整块可点（§7.2）：卡片本身就是一个链接，不是"卡片 + 里面一个小按钮" */
          <Link key={cardKind} className="shareIntro__card" to={`/shares/${cardKind}`}>
            <h2 className="shareIntro__cardtitle">{t(SHARE_INTRO_KEYS[cardKind].title)}</h2>
            <p className="shareIntro__carddesc">{t(SHARE_INTRO_KEYS[cardKind].desc)}</p>
            <p className="shareIntro__count">{countText(cardKind)}</p>
          </Link>
        ))}
      </div>
      {/*
        ★ 取数失败时的「重试」—— **只在这一档渲染**，而且是**一颗**按钮而不是每张卡片一颗：
          两张卡片的条数来自**同一次**请求（`GET /api/shares/summary` 一次给两栏）。
        ⚠️ 位置在卡片**外面**：卡片整块是一个 `<Link>`（§7.2），把按钮塞进去就是
          "一个可点元素套在另一个可点元素里" —— 点它到底算点链接还是点按钮，浏览器各说各话。
        ⚠️ 游客即使拿到了 `summaryFailed` 也不渲染它（上面 `countText` 的第一支同一条理由）：
          他没有请求可重试，一颗按下去什么都不会发生的按钮比没有按钮更坏。
      */}
      {authed && summaryFailed ? (
        <p className="shareIntro__actions">
          <button type="button" className="ghostbtn" onClick={onRetry}>
            {t('common.retry')}
          </button>
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// ② 看板页的纯视图
// ---------------------------------------------------------------------------

export interface ShareBoardViewProps {
  kind: ShareKind;
  /** 登录了吗。**未登录时容器没有取数**（那一次请求注定 401）。 */
  authed: boolean;
  /** 邮箱验证了吗。未验证时"你的一条"换成"先去验证"那一屏，看板照常（§7.5）。 */
  verified: boolean;
  /** `null` = 还没取到（加载中，或第一次就失败了）。 */
  board: ShareListResponse | null;
  /**
   * 失败提示（**已经翻译好的句子**）。两种用法，由 `staleSecs` 区分：
   *   · `board === null` ⇒ 第一次就没读到，这一屏只有它（+ 重试）；
   *   · `board !== null` ⇒ 刷新失败，但**旧列表留着**（§7.5 第 4 行：绝不清空）。
   */
  loadError: string | null;
  /** 旧数据有多旧（秒）。`null` = 没有"旧列表"这回事。 */
  staleSecs: number | null;
  /**
   * ★ **本地时钟**的读数 —— 由容器**每秒**推进一次（`Date.now()`）。
   *
   * ⚠️ 它必须是 props 而不是组件内部 `Date.now()`：渲染自检要能喂一个**固定的时刻**
   *    进来，才能把三档（还剩 12 分钟 / 不到 1 分钟 / 已经到点）分别断言出来。
   * ⚠️★ 它读的是**本地**时钟，而不是"折算成服务端时刻的现在"：
   *    · 剩余时间的服务端校正靠 `serverOffset`（差一次算一次，见 `useServerOffset`）——
   *      那个偏移量是由它和 `board.serverNow` 一起算出来的；
   *    · `lastUpdatedAtMs` 也是本地时钟，所以"多少秒前更新"就是这两个数相减，
   *      不需要（也不该）经过服务端偏移量。
   *    ⚠️ 渲染自检里让 `board.serverNow === nowMs` 就等于"本地钟与服务端钟此刻读数相同"，
   *       于是偏移量是 0、三档剩余时间都钉得住。
   */
  nowMs: number;
  /**
   * ★ 上一次**成功**取到看板的时刻（**本地时钟**）。`null` = 还没成功过。
   *
   * 它承载 `shares.updatedAgo`（「{{secs}} 秒前更新」，§7.6 第 5 条）：那一行要
   * **随本地计时走**（每一秒自己往前走），所以秒数在这里用 `nowMs` 现算，
   * 而不是由容器每隔一秒重算一个数字传下来。
   * ⚠️ 只有**成功**那一次算数：刷新失败时这个时刻**不动** —— 那正是这一行的意义
   *    （"你看到的这份数据是多久以前的"）。
   * ⚠️★ 这一格是 2026-09-15 评审之后补进冻结契约的：原先 props 清单里**没有任何一格**
   *    承载得了它，于是 §7.6 那条要求**无处落地**，而 `shares.updatedAgo` 里没有 `**`，
   *    强调守卫也看不见它（正是本仓最怕的那种静默漏项）。
   */
  lastUpdatedAtMs: number | null;
  busy: boolean;
  /** 一次操作的结果（发布/下架/复制的成功与失败）。文本由容器给（它才知道用哪句词条）。 */
  notice: { ok: boolean; text: string } | null;
  onHide: (id: string) => void;
  onRestore: (id: string) => void;
  /**
   * ★★ 「彻底删除」的落点（2026-09-16 新增）。**必填**，理由与上面三格完全相同
   *    （可选 + 缺省时禁用 = 一颗永远灰着的按钮，而所有门禁都绿）。
   *
   * ⚠️ 它只在**已下架**的那一行上渲染，而且是**两步**里的第二步
   *    （第一步只是把那一行切成确认态，不发请求）—— 硬删除没有回收站。
   *    服务端的判据同样是 `status='hidden'`，所以界面这两步与它逐条对应。
   */
  onDelete: (id: string) => void;
  onCopy: (text: string) => void;
  onSubmit: (body: unknown) => void;
  /**
   * ★★ 「重试」的落点（§7.5 第 4 行：失败那一屏要有重试）。**必填。**
   *
   * ⚠️★ 2026-09-15 的订正：这一格最初**不在**冻结清单里，当时的解法是"入口总是渲染、
   *    处理器可选、缺省时按钮禁用"。那是错的 —— 调用方忘了传的表现是**一颗永远灰着的
   *    按钮**，而**所有门禁都绿**（渲染自检断言的是"入口在不在"，禁用也算在）：
   *    入口"存在"而功能不可用，正是本计划一路在防的那种静默失效。
   *    ⇒ 改成必填：忘了传是**编译错误**。渲染自检照样能断言入口（它传一个空函数）。
   */
  onRetry: () => void;
  /**
   * ★★ 「重发验证邮件」的落点（`POST /api/auth/verify/send`）。**必填**，理由同上：
   *    §11.2 要求未验证那一屏有重发入口，而一颗永远灰着的按钮既"通过了"断言、
   *    又什么都做不了。
   */
  onResendVerify: () => void;
}

/**
 * 看板页：标题 + 两个标签页 + 回介绍页的路 + 「你的一条」+ 看板列表。
 *
 * ⚠️ 四种画面（§7.5）全部是 props 组合出来的，这个组件**不判断权限、不发请求**：
 *   · 游客                ⇒ `authed={false}`（容器那一支没有取数）
 *   · 登录但邮箱未验证     ⇒ `verified={false}`（看板照常，第 2 行换成"先验证"）
 *   · 正常                ⇒ 两块都渲染
 *   · 接口挂了            ⇒ `loadError`（有旧列表就**留着**它，一句都不清空）
 */
export function ShareBoardView(props: ShareBoardViewProps) {
  const { t } = useTranslation();
  const {
    kind,
    authed,
    verified,
    board,
    loadError,
    staleSecs,
    nowMs,
    lastUpdatedAtMs,
    busy,
    notice,
  } = props;

  /* ★ 服务端偏移量：**一次响应只算一次**，然后冻住（理由写在 useServerOffset 上） */
  const offset = useServerOffset(board, nowMs);

  /*
   * ★ 「{{secs}} 秒前更新」的秒数 —— **每一秒自己往前走**（§7.6 第 5 条），
   *   所以它是由 `nowMs` 现算的，而不是容器每隔一秒算好一个数字传下来。
   * ⚠️ 两个数都必须是**本地时钟**（见 `nowMs` / `lastUpdatedAtMs` 的注释）：
   *    "多久以前"是本地的事，掺进服务端偏移量反而会算出一个错的间隔。
   * ⚠️ `Math.max(0, …)` 是防**负数**的：`Date.now()` 被系统校时往回调（NTP）
   *   时，差值会短暂为负 —— 界面上写「-3 秒前更新」比不写更糟。宁可钳到 0。
   */
  const updatedAgoSecs =
    lastUpdatedAtMs === null ? null : Math.max(0, Math.floor((nowMs - lastUpdatedAtMs) / 1000));

  /*
   * ⚠️ 剩余时间**只算一次**（每行一次），而不是在 JSX 里反复算：
   *    `remainingMs` 是纯函数，但同一行算两遍（判到点 + 显示）就有两份可能不一致的值。
   */
  const rows =
    board === null
      ? []
      : board.items
          .map((item) => ({ item, remainMs: remainingMs(item.expiresAt, nowMs, offset) }))
          /*
           * ★★ "到点那一秒从画面上去掉"**在这里**：纯本地判断，不发请求、不等轮询。
           *    （服务端的列表查询也会滤掉它，但那是 20 秒之后的事 —— 中间这段时间
           *    界面上挂着一个已经过期的行，点下去必然 409。）
           */
          .filter((row) => row.remainMs > 0);

  /* 我自己的行同样按"到点"过滤：过期的既不在看板上，也不该留在「你的一条」里 */
  const mine =
    board === null ? [] : board.mine.filter((row) => remainingMs(row.expiresAt, nowMs, offset) > 0);

  return (
    <section className="share">
      <header className="share__head">
        <h1 className="share__title">{t('nav.shares')}</h1>
        {/*
          ⚠️ 两个标签页是**真链接**（§7.1：`/shares/room` 与 `/shares/seed` 是两个路由），
             不是本地状态切换 —— 分享出去的 URL、前进后退、刷新都要落在同一屏上。
        */}
        <nav className="share__tabs">
          {SHARE_KINDS.map((tabKind) => (
            <Link
              key={tabKind}
              className="share__tab"
              to={`/shares/${tabKind}`}
              aria-current={tabKind === kind ? 'page' : undefined}
            >
              {t(SHARE_KIND_LABEL_KEYS[tabKind])}
            </Link>
          ))}
        </nav>
        <Link className="share__back" to="/shares">
          {t('shares.backToIntro')}
        </Link>
      </header>

      {/* 操作结果（已复制 / 复制失败 / 验证邮件已发 / 各种失败）—— 文案由容器给 */}
      {notice ? <Notice kind={notice.ok ? 'ok' : 'bad'}>{notice.text}</Notice> : null}

      {!authed ? (
        /*
         * 游客：只有这一屏。⚠️ 这里**没有**看板、没有表单、也没有我的行 ——
         * "内容不给游客看"是本栏目唯一的一条线（§1.1），所以它是**结构性**的：
         * 那些块在游客这一支根本不渲染，而不是渲染出来再藏起来。
         */
        <ShareGuestNotice />
      ) : (
        <>
          {/* 第一次就没读到（手上**没有**旧列表）：只有这一句 + 重试 */}
          {board === null && loadError ? (
            <>
              <Notice kind="bad">{loadError}</Notice>
              <ShareRetry busy={busy} onRetry={props.onRetry} />
            </>
          ) : null}

          {/*
            ★ 刷新失败但**保住了旧列表**（§7.5 第 4 行）：说清"下面是旧的"、有多旧，
              并给一次重试。⚠️ 这里用 `notice--info` 而不是 `bad`：列表还是能用的，
              `bad` 那一档是 `role="alert"`，会打断读屏的朗读（见 `Notice` 的注释）。
          */}
          {board !== null && loadError ? (
            <>
              <Notice kind="info">
                {staleSecs === null ? loadError : t('shares.refreshFailed', { secs: staleSecs })}
              </Notice>
              <ShareRetry busy={busy} onRetry={props.onRetry} />
            </>
          ) : null}

          {/* 还没取到任何东西（第一次在飞） */}
          {board === null && !loadError ? <p className="state">{t('common.loading')}</p> : null}

          {board !== null ? (
            <>
              {verified ? (
                <ShareMineBar
                  kind={kind}
                  mine={mine}
                  liveCount={board.liveCount}
                  limit={board.limit}
                  nowMs={nowMs}
                  offset={offset}
                  busy={busy}
                  onHide={props.onHide}
                  onRestore={props.onRestore}
                  onDelete={props.onDelete}
                  onSubmit={props.onSubmit}
                />
              ) : (
                /*
                 * 未验证邮箱：**看板照常**（他能看），只有"你的一条"换成这一屏。
                 * ⚠️ 表单**不挂载** —— 他发不了（服务端 `requireVerified` 会 403），
                 *    挂上去只是给他一个注定失败的按钮。
                 */
                <ShareVerifyNotice busy={busy} onResend={props.onResendVerify} />
              )}

              {/*
                ★ 「{{secs}} 秒前更新」（§7.6 第 5 条）—— 看板这一刻有多新。
                ⚠️ `lastUpdatedAtMs === null`（还没成功取到过）时**整行不渲染**：
                   那时候没有任何"上一次"可言，写「0 秒前更新」是在撒谎。
                ⚠️ 它与刷新失败那一句（`shares.refreshFailed`，也带一个秒数）**会在同一次
                   渲染里同时出现**，而且两个数字相同（都从"上次成功"算起）。这不是重复：
                   那一句说的是"**这一次刷新失败了** + 一次重试"，这一行是**常显**的新鲜度
                   指示，两者职责不同，§7.5 与 §7.6 分别要求它们。要合并的话是一次产品决定，
                   不是这里的实现细节。
              */}
              <h2 className="share__boardtitle">{t('shares.boardTitle')}</h2>
              {updatedAgoSecs !== null ? (
                <p className="share__updated">{t('shares.updatedAgo', { secs: updatedAgoSecs })}</p>
              ) : null}
              {/* ⚠️ 看板被 200 行上限截断时必须说一句，**不许安静截断**（§5.1） */}
              {board.truncated ? <p className="share__truncated">{t('shares.truncated')}</p> : null}
              {rows.length === 0 ? (
                <p className="share__empty">{t('shares.boardEmpty')}</p>
              ) : (
                <ul className="share__board">
                  {rows.map((row) => (
                    <ShareBoardRow
                      key={row.item.id}
                      item={row.item}
                      remainMs={row.remainMs}
                      onCopy={props.onCopy}
                    />
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
