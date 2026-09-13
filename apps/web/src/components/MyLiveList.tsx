import type { LiveEmbedReason, UserLiveLink } from '@mcsr/shared/live';
import { liveEmbedDecision, userLiveLinkUrl } from '@mcsr/shared/live';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClickToPlayEmbed } from '@/components/ClickToPlayEmbed';
import { MyLiveForm } from '@/components/MyLiveForm';

/**
 * 「我的链接」（需求④=B）—— 直播页上那一块私人列表。
 *
 * ---------------------------------------------------------------------------
 * 为什么它是**纯展示**组件（props 注入，自己不发请求）
 * ---------------------------------------------------------------------------
 * 沿用 `CalendarSeriesSection` 的既有范式：取数留在页面（`routes/Live.tsx`），
 * 这一层只管"拿到什么就画什么"。好处是**四种状态都能被渲染自检驱动**
 * （有行 / 空态 / 未登录 / 嵌不出来），而不必起 dev server 去点它。
 *
 * ---------------------------------------------------------------------------
 * ★ 为什么每行**必须说清"为什么没有播放器"**
 * ---------------------------------------------------------------------------
 * 两种错法都会让用户以为页面坏了：
 *   · 画一个**空框**：看起来像网络问题，而用户唯一能做的是刷新；
 *   · 三种结局**说成同一句话**：认不出链接的行与"平台自己禁嵌"的行说成一样，
 *     用户就会去点一个不该点的东西（或反过来，明明能播却只给外链）。
 * 所以三档各用各的词条（`myLive.linkOnly` / `myLive.notSupported`），
 * 而判据**全部来自** `liveEmbedDecision` —— 这里**不重写一遍平台判断**。
 *
 * ⚠️ `origin` 由调用方传页面自己的 host（`globalThis.location.hostname`）：
 *    Twitch 的 `parent` 就是它，传错＝**静默拒播**（播放器区域一片空白）。
 *    缺它时判定为 `no_origin` ⇒ 宁可不嵌，也不发一个注定被拒的请求。
 */
export function MyLiveList({
  items,
  loggedIn,
  origin,
  onDelete,
  onEdit,
  rev = 0,
  deletingId,
  savingId = null,
}: {
  /** 已经取到的行（**由页面决定怎么取**：未登录时页面根本不会调接口）。 */
  items: UserLiveLink[];
  /** 未登录时画"去登录"，而**不是**空列表 —— 空列表会被读成"我一条都没有"。 */
  loggedIn: boolean;
  /** 嵌入页面自己的 host（浏览器里是 `location.hostname`）。 */
  origin: string;
  onDelete: (id: string) => void;
  /**
   * 保存某一行的改动（t37）。
   *
   * ⚠️ `title: null` 是**清空**（不是"没改"）—— 见 `MyLiveForm` 里那段说明：
   *    编辑态的提交体形状与新增态不同，这是最容易写错的一处。
   */
  onEdit: (id: string, patch: { url: string; title: string | null }) => void;
  /**
   * ★ t41：**保存代号** —— 每次"某一行保存成功"就 +1。
   *
   * ⚠️ 它存在的唯一理由：行内表单的展开态（`editing`）是**行自己的局部 state**，
   *    父组件改不到它；而 t40 时代它靠"重拉期间整块卸载"这个**副作用**顺便复位 ——
   *    t41 把"卸载"修掉之后，那个偶然复位就没了 ⇒ 保存后表单**一直开着**
   *    （`03-browser-live.mjs` 从 109/0 掉到 99/10）。
   *    ⇒ 用这个数字把"该收起来了"这件事**显式**表达出来（见 `MyLiveRow` 的 effect）。
   */
  rev?: number;
  /** 正在删的那一行（行内二次确认之后置位，用来禁用按钮）。 */
  deletingId: string | null;
  /** 正在保存的那一行（编辑表单提交中，用来禁用按钮）。 */
  savingId?: string | null;
}) {
  const { t } = useTranslation();

  /*
   * ⚠️ 未登录这一档**不是空态**：没登录的人看到"还没有添加过"会以为自己丢过数据。
   *    这两句话的区别正是这个组件存在的理由之一。
   */
  if (!loggedIn) {
    return (
      <div className="state state--empty">
        <p>{t('myLive.needLogin')}</p>
        <a className="cta" href="/login">
          {t('myLive.gotoLogin')}
        </a>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="state state--empty">
        <p>{t('myLive.empty')}</p>
      </div>
    );
  }

  return (
    <ul className="mylive-list">
      {items.map((link) => (
        <MyLiveRow
          key={link.id}
          link={link}
          origin={origin}
          onDelete={onDelete}
          onEdit={onEdit}
          rev={rev}
          deleting={deletingId === link.id}
          saving={savingId === link.id}
        />
      ))}
    </ul>
  );
}

/**
 * 一行。
 *
 * 单独拆出来是因为它自己有**局部**状态（删除二次确认、行内编辑展开），
 * 而那两个状态都只属于"这一行" —— 提到列表层会让删 A 行时 B 行的确认按钮也亮起来。
 */
function MyLiveRow({
  link,
  origin,
  onDelete,
  onEdit,
  rev,
  deleting,
  saving,
}: {
  link: UserLiveLink;
  origin: string;
  onDelete: (id: string) => void;
  onEdit: (id: string, patch: { url: string; title: string | null }) => void;
  /** ★ t41：保存代号（父层每次"某行保存成功"就 +1）—— 它变化 ⇒ 收起本行的编辑表单。 */
  rev: number;
  deleting: boolean;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  /*
   * ★ 行内编辑（t37）：`updateMyLiveLink` 此前**零调用者** —— 贴错了只能删掉重贴。
   *   展开态与删除确认一样是**这一行**的状态，所以放在这里而不是列表层。
   */
  const [editing, setEditing] = useState(false);

  /*
   * ★★ t41：**`rev` 变了就把编辑表单收起来。**
   *
   * ⚠️ 为什么必须有这一段：`editing` 是本行的局部 state，父组件改不到它。
   *    t40 时代它靠一个**偶然**复位 —— 重拉期间列表整块卸载 ⇒ 行被重挂载 ⇒ `editing` 回 false。
   *    t41 把"重拉期间继续渲染列表"修好之后，那个**副作用没了** ⇒ 保存成功后
   *    编辑表单**一直开着**，于是 `03-browser-live.mjs` 的
   *    `the row shows the NEW name immediately` 拿到 `null`（那一刻那一行还是**表单**），
   *    整脚本从 **109 passed / 0 failed** 掉到 **99 / 10**。
   *    ⇒ 把"该收起来了"**显式**表达出来，不再依赖卸载。
   *
   * ⚠️ 用 ref 记住上一次的 `rev`，**不是**把 `rev` 放进 key —— 放进 key 会连带把
   *    删除确认态 `confirming` 也重置，那是另一件事的副作用（而且 key 一变就是重挂载，
   *    代价比"改一个 state"大）。
   */
  const seenRev = useRef(rev);
  useEffect(() => {
    if (seenRev.current !== rev) {
      seenRev.current = rev;
      setEditing(false);
    }
  }, [rev]);

  /*
   * 外链**一定存在**：认得出平台就按平台拼频道页，认不出就用用户原样那条 ——
   * 所以这一行永远不会是一个死链（这也是 `userLiveLinkUrl` 存在的理由）。
   */
  const goingTo = userLiveLinkUrl(link);
  const title = link.title ?? link.url;

  /*
   * ★ 行内编辑（t37）：展开时**整行换成编辑表单**，而不是把表单塞在内容下面。
   *
   *    理由有两个：
   *    ① 编辑时用户看的是"这一条现在是什么"，而下面的播放器/解释文字都是
   *       根据**旧链接**算出来的 —— 留着它们会与正在改的输入框互相矛盾；
   *    ② 收起时整行恢复原样，不需要"编辑态与展示态如何共存"这层复杂度。
   *
   * ⚠️ 它放在两次提前返回**之前**：编辑与"这一行能不能嵌"无关，
   *    否则"认不出平台"的行就改不了 —— 而那种行恰恰最需要改（链接贴错了）。
   */
  if (editing) {
    return (
      <li className="mylive-row">
        <MyLiveForm
          mode="edit"
          initial={{ url: link.url, title: link.title }}
          busy={saving}
          error={null}
          onSubmit={(patch) => onEdit(link.id, { url: patch.url, title: patch.title ?? null })}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  /*
   * ⚠️ 这一行**认不出平台**（用户贴的链接我们解析不出来）⇒ 只给原站入口。
   *
   *    ★ 这一句必须放在 `liveEmbedDecision` **之前**，三个理由：
   *    ① 它的入参 `platform` 是**非空**的（`LiveEmbedChannel` 只收真平台）——
   *       传 `null` 类型就不对，"认不出平台"本来也不是"某个平台不可嵌"；
   *    ② 它同时把 `link.platform` 收窄成非空，后面就不用写 `!` 断言
   *       （断言会把这个组件最该被检查的地方静默关掉）；
   *    ③ ★★ **实测后果**（我探过）：`liveEmbedDecision` 的尾部对"没被任何分支处理的
   *       platform"有一个兜底 `return { embed: false, reason: 'bilibili_blocked' }`
   *       （`shared/live.ts:558-562`，注释说"归到平台自己禁止嵌入这一档，它比
   *       '没记视频 ID' 更接近实情"）。**那个理由对"库里存了个陌生平台"成立，
   *       对 `null` 不成立** —— 认不出平台时我们并不知道任何平台，说"这个平台不支持
   *       站内播放"就是**另一句假话**。所以这一档必须在这里拦下、用 `myLive.linkOnly`。
   *       ⚠️ 顺序颠倒（先算判定再判 null）就会让这一行说成"平台不支持" ——
   *       而**门禁全绿**（断言只看有没有一句解释）。
   */
  if (link.platform === null) {
    return <Row why={t('myLive.linkOnly')} />;
  }

  /*
   * ⚠️ 判据用共享层的 `liveEmbedDecision`，**不在这里重写平台判断**。
   *    私人列表这一行没有 `embedChannel` 开关（默认关），所以不传它。
   */
  const decision = liveEmbedDecision(
    /*
     * ⚠️ `handle` 可能为 null（链接认出平台、但只解析到"某一场视频"），而
     *    `LiveEmbedChannel` 要的是**非空**标识。这里用空串而不是 `!`：
     *    `liveEmbedDecision` 对空标识本来就有明确答复（`no_id` ⇒ 不嵌），
     *    所以空串是**如实传递**"没有标识"，而不是把类型糊过去。
     *    （用 `!` 断言的话，将来谁把空串塞进播放地址，就没有任何东西会拦住。）
     */
    { platform: link.platform, handle: link.handle ?? '', liveVideoId: link.liveVideoId },
    origin,
  );

  if (!decision.embed) {
    return <Row why={whyKey(decision.reason, t)} />;
  }

  return (
    <Row>
      {/*
        ★ 能嵌就直接画播放器，**不再加一句"可以在这里看"** ——
          播放器本身就是最好的说明，多一句话只是噪音。
        ⚠️ `src` 必须显式传：直播那一行拼出来的是**频道/视频级**地址
          （由 `liveEmbedDecision` 给），`buildEmbedUrl` 按 platform+id 拼不出这个形状。
      */}
      <ClickToPlayEmbed
        platform={link.platform}
        idLabel={link.handle ?? title}
        title={title}
        startOffsetSec={null}
        src={decision.url}
      />
    </Row>
  );

  /**
   * 行的外壳。⚠️ 它**定义在两次提前返回之后**，所以闭包里的 `link.platform`
   * 已经被收窄成非空 —— 写在外面的话，闭包捕获的是收窄前的类型，
   * 三个分支都会报"`null` 不能赋给 `platform`"（这个坑我踩过，别挪上去）。
   *
   * 抽成函数是因为三种结局**共用同一个外壳**（标题 / 徽章 / 兜底外链 / 删除两步），
   * 写在三个分支里复制三遍，就会出现"某个分支忘了给外链"这种只有走到那条路
   * 才看得见的缺陷。
   */
  function Row({ why, children }: { why?: string; children?: ReactNode }) {
    const { t } = useTranslation();
    return (
      <li className="mylive-row">
        <div className="mylive-row__head">
          {/*
            ⚠️ 标题可空：用户没起名字时**显示链接本身**，而不是留一行空白 ——
                留空白会让"我到底加过这一条吗"变成猜谜。
          */}
          <h3 className="mylive-row__title">{title}</h3>
          {/*
            ★★ F1（t38 实测）：**认不出平台的行不能渲染徽章节点**。
            原来的写法是 `<span className="badge badge--kind">{link.platform}</span>` ——
            `platform` 为 `null` 时 React 仍会画出那个 `<span>`，只是**文字为空**。
            于是那一行会出现一个**空的 18×4 可见方块**（`.badge` 有背景色与内边距），
            看起来像"我们这里坏了一块"，而用户完全不知道它代表什么。
            ⚠️ 判据**不能**写成 `children` 为空就不画 —— 那对"文字为空但节点在"是无效的
            （旧实现正是这种形态）。这里用**条件渲染**：拿不到平台就**没有这个节点**。
          */}
          {link.platform ? <span className="badge badge--kind">{link.platform}</span> : null}
        </div>

        {why ? <p className="mylive-row__why">{why}</p> : null}
        {children}

        <div className="mylive-row__foot">
          <a className="cta" href={goingTo} target="_blank" rel="noopener noreferrer nofollow">
            {t('live.gotoChannel')}
          </a>
          {/*
            ★ 「改」（t37）：`updateMyLiveLink` 此前**零调用者**（贴错了只能删掉重贴）。
            ⚠️ 删除确认展开时**不画它**：那一排此刻在问"确定删吗"，
               旁边再摆一个"改"会让两个动作的语义互相干扰。
          */}
          {confirming ? null : (
            <button type="button" className="ghostbtn" onClick={() => setEditing(true)}>
              {t('myLive.editAction')}
            </button>
          )}
          {confirming ? (
            <>
              <span className="mylive-row__confirm">{t('myLive.deleteConfirm')}</span>
              <button
                type="button"
                className="ghostbtn"
                disabled={deleting}
                onClick={() => onDelete(link.id)}
              >
                {t('common.confirm')}
              </button>
              <button type="button" className="ghostbtn" onClick={() => setConfirming(false)}>
                {t('common.cancel')}
              </button>
            </>
          ) : (
            <button type="button" className="ghostbtn" onClick={() => setConfirming(true)}>
              {t('myLive.deleteAction')}
            </button>
          )}
        </div>
      </li>
    );
  }
}

/**
 * "嵌不出来"的原因 → 该说的那句话。
 *
 * ⚠️ 刻意写成**穷尽的 `switch`**（每个 case 都 return，没有 `default`）：
 *    少写一种时 TypeScript 会因为函数可能返回 `undefined` 而编译不过，
 *    而那正是我们要的 —— **有一次兜底，就会有一种情况被默默说成另一种**。
 *    （与 `LiveCard` 里那个穷尽 `Record` 同一个理由。）
 *
 * ⚠️ 分成两条而不是一条通用话：
 *   · `bilibili_blocked` 是**确定**不可嵌（平台用 `x-frame-options` 自己禁的）
 *     ⇒ 必须说清是"平台不许"，否则用户会以为是我们的问题、反复刷新；
 *   · 其余三种都归"只能给你原站入口"，因为它们对用户而言可行动的只有一件事：
 *     **点外链**。把"这条链接我们认不出平台"说成"平台不支持"是**反的** ——
 *     用户会去改一个本来正确的链接。
 */
function whyKey(reason: LiveEmbedReason, t: (key: string) => string): string {
  switch (reason) {
    case 'bilibili_blocked':
      return t('myLive.notSupported');
    case 'no_origin':
    case 'no_id':
    case 'not_channel_id':
      return t('myLive.linkOnly');
  }
}
