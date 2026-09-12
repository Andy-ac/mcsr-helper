import type { SeedInfo, SeedQueryResult, SeedRecord } from '@mcsr/shared/seed';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Notice } from '@/components/Form';
import {
  buildSeedFilterParams,
  EMPTY_SEED_FILTERS,
  type SeedFilterState,
  SeedFiltersPanel,
} from '@/components/SeedFilters';
import { SeedInfoPanel, SeedResultCard } from '@/components/SeedResultCard';
import { SeedSaveForm } from '@/components/SeedSaveForm';
import { fetchRandomSeed, fetchSeedByMatchId, fetchSeedInfo, searchSeed } from '@/lib/api';
import { useApiErrorText } from '@/lib/auth';
import {
  describeSeedQueryError,
  MIN_MATCH_ID,
  MIN_SEEDINFO_MATCH_ID,
  type SeedQueryFailure,
  type SeedQueryField,
} from '@/lib/seedErrors';

/**
 * `/seeds` —— Ranked Seeds 检索页（M4）。
 *
 * ---------------------------------------------------------------------------
 * 这一页的定位：它**不是**我们的数据，是上游的
 * ---------------------------------------------------------------------------
 * 页面上的每一条种子都来自用户自己的那个上游服务（约 300 万条，实时）。
 * 所以这一页有三件事和我们自己的内容页不一样：
 *
 *   1. **不能缓存"随机"**（服务端已经保证了，见 routes/seeds.ts）—— 这里
 *      不做任何本地缓存，因为"随机"的全部价值就是每次不一样。
 *   2. **"查不到"是常态**：上游只覆盖约 80% 的历史比赛。所以 404 在这里
 *      显示成一条**说明**加一个**下一步**（补录），不是红色报错。
 *   3. **有配额**：每 IP 每分钟 20 次 + 全局每秒 5 次。所以这一页**不做**
 *      任何自动轮询 / 预取 —— 每一次请求都由用户的一个明确动作触发。
 *      （这一条是设计约束，不是优化：上游是用户自己的一台 1 核机器。）
 *
 * ---------------------------------------------------------------------------
 * 两块内容（Q16）
 * ---------------------------------------------------------------------------
 *   1. Ranked Seeds —— 真正能用的检索
 *   2. 社区种子分享 · 即将开放 —— 按 Q7/Q8 先留空，但要说清"不是坏了"
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 这一页**没有**任何"数据可能延迟"的提示，那是**故意的**
 * ---------------------------------------------------------------------------
 * 上游文档写着 `/seedinfo` 可能有数天延迟，但用户 2026-09-12 更正：
 * 两个端点都是实时的，是文档没跟上（Q18）。假提示比没有提示更糟 ——
 * 用户会因此不去信任一个其实准确的数字。**不要加回来。**
 * 而"约 80% 覆盖"仍然是真的，所以它照常显示。
 */

/** 「结构与变种」的加载状态。 */
type InfoState =
  | { status: 'loading' }
  | { status: 'ok'; info: SeedInfo }
  | { status: 'error'; message: string };

export function Seeds() {
  const { t } = useTranslation();
  const errorText = useApiErrorText();

  // ---- 检索（随机 / 带条件）----
  const [filters, setFilters] = useState<SeedFilterState>(EMPTY_SEED_FILTERS);
  const [searchBusy, setSearchBusy] = useState(false);
  const [result, setResult] = useState<SeedQueryResult | null>(null);
  const [searchFailure, setSearchFailure] = useState<SeedQueryFailure | null>(null);
  /**
   * 上一次结果是在什么条件下抽出来的（序列化后的筛选参数）。
   *
   * ⚠️ 它守的是这个陷阱：用户抽到一条种子 → 改了条件 → **没再点按钮**。
   *    这时卡片上还是旧条件下的那条种子，而用户会理所当然地以为
   *    "它满足我现在选的条件"。他拿去开世界，地形和预期不符，
   *    而且几乎不可能查出真因 —— 因为界面上没有任何东西是错的，
   *    错的是"这个结果属于哪一次查询"这件事没有被记下来。
   */
  const [resultKey, setResultKey] = useState<string | null>(null);

  // ---- 按比赛 ID 查 ----
  const [matchIdInput, setMatchIdInput] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookup, setLookup] = useState<SeedRecord | null>(null);
  /** 刚才查的那个 ID（不是输入框里现在的文字）—— 补录要预填的是**它**。 */
  const [lookupId, setLookupId] = useState<number | null>(null);
  const [lookupFailure, setLookupFailure] = useState<SeedQueryFailure | null>(null);

  // ---- 结构与变种 ----
  /*
   * ⚠️ 一次只开一条，而且**不缓存**。
   *
   * 存成一个 Map 看起来更"完整"，但代价是每次点开都要打一次上游
   * （一个 matchId 一次），而我方每 IP 每分钟只有 20 次配额。
   * 打开一条就关掉上一条，等于把"同时打几个请求"这件事从设计上排除掉。
   */
  const [infoMatchId, setInfoMatchId] = useState<number | null>(null);
  const [infoState, setInfoState] = useState<InfoState | null>(null);
  /**
   * 这个面板属于哪一张卡片。
   *
   * ⚠️ 只记 matchId 是不够的：检索结果和按 ID 查的结果**可能是同一场比赛**，
   *    那时两块都会满足 `infoMatchId === matchId`，同一份信息在两处同时展开
   *    —— 看起来像渲染重复，而且两个按钮的 aria-expanded 都会是 true。
   *    所以"它属于谁"必须一起记下来。
   */
  const [infoOwner, setInfoOwner] = useState<'search' | 'lookup' | null>(null);

  // ---- 词条表：我们**实际见过**的词条 ----
  /*
   * 上游没有"列出全部词条"的接口，所以词条表 = 起点表 + 这里累积的东西
   * （见 SeedFilters.tsx 的 SEED_VARIATION_BASE）。每次成功拿到一条
   * `seedinfo`，就把它里面的词条并进来 —— 于是上游新增的分组和词条
   * 会随着使用自己出现，而不是永远困在那张起点表里。
   */
  const [observedVariations, setObservedVariations] = useState<readonly string[]>([]);

  // ---- 补录 ----
  const [saveOpen, setSaveOpen] = useState(false);
  const [savePrefill, setSavePrefill] = useState<string | undefined>(undefined);

  /** 把一条 SeedInfo 里的词条并进"见过的"那张表。 */
  function harvest(info: SeedInfo) {
    if (info.variations.length === 0) return;
    setObservedVariations((prev) => [...new Set([...prev, ...info.variations])]);
  }

  /*
   * 每次渲染算一次，下面的按钮标签、端点选择和"结果是否过期"都用它 ——
   * 算两遍的话，两边对"有没有条件"的判断迟早会分叉（比如以后往里加一个
   * 只影响其中一个的字段）。
   */
  const builtFilters = buildSeedFilterParams(filters);
  const builtKey = JSON.stringify(builtFilters.params);

  // -------------------------------------------------------------------------
  // 检索
  // -------------------------------------------------------------------------

  async function runSearch() {
    setSearchFailure(null);

    if (Object.keys(builtFilters.errors).length > 0) {
      setSearchFailure({
        kind: 'field',
        message: t('seedsPage.errGeneric'),
        fieldErrors: builtFilters.errors as Partial<Record<SeedQueryField, string>>,
      });
      return;
    }

    /*
     * ★ 条件为空 → `/random`；有任意一个条件 → `/search`。
     *
     * ⚠️ 这个分支**不能**省：服务端对带筛选参数的 `/random` 返回 400
     *    `use_search_endpoint`，而不是静默忽略。静默忽略的后果是界面把一条
     *    **不符合用户条件**的种子当结果展示 —— 用户看得见，我们看不见。
     *    所以宁可 400，也不要那个"看起来正常"的结果。
     */
    const useSearch = builtFilters.hasAny;

    setSearchBusy(true);
    try {
      const data = useSearch ? await searchSeed(builtFilters.params) : await fetchRandomSeed();
      setResult(data);
      setResultKey(builtKey);
    } catch (error) {
      setResult(null);
      setResultKey(null);
      setSearchFailure(describeSeedQueryError(error, t, errorText, 'search', MIN_MATCH_ID));
    } finally {
      setSearchBusy(false);
    }
  }

  // -------------------------------------------------------------------------
  // 按比赛 ID 查
  // -------------------------------------------------------------------------

  async function runLookup() {
    setLookupFailure(null);

    const raw = matchIdInput.trim();
    /*
     * ⚠️ 先本地判形状，**不对任意字符串 parseInt**。
     *
     *    服务端就是这么做的（`parseMatchId` 先跑 `/^\d{1,15}$/` 再 Number），
     *    而它这么做的理由在这里同样成立：`'3650001abc'`、`'3.6e6'`、
     *    `'+3650001'` 被 parseInt 之后会变成一个数字，而那个数字对应的是
     *    **另一场比赛** —— 用户会拿到一条别人的种子，而且看不出任何异常。
     *    matchId 本身是 15 位以内的小整数，用 Number 是安全的
     *    （这和种子值完全不同，那里必须全程字符串）。
     */
    if (!/^\d{1,15}$/.test(raw) || Number(raw) < MIN_MATCH_ID) {
      setLookup(null);
      setLookupId(null);
      setLookupFailure({
        kind: 'field',
        message: t('seedsPage.errGeneric'),
        fieldErrors: {
          matchId: /^\d{1,15}$/.test(raw)
            ? t('seedsPage.errMatchIdTooSmall', { min: MIN_MATCH_ID })
            : t('seedsPage.errMatchIdFormat'),
        },
      });
      return;
    }

    const matchId = Number(raw);
    setLookupBusy(true);
    try {
      const data = await fetchSeedByMatchId(matchId);
      setLookup(data.seed);
      setLookupId(matchId);
    } catch (error) {
      setLookup(null);
      setLookupId(matchId);
      setLookupFailure(describeSeedQueryError(error, t, errorText, 'lookup', MIN_MATCH_ID));
    } finally {
      setLookupBusy(false);
    }
  }

  // -------------------------------------------------------------------------
  // 结构与变种
  // -------------------------------------------------------------------------

  async function loadInfo(matchId: number, owner: 'search' | 'lookup') {
    if (infoOwner === owner && infoMatchId === matchId && infoState?.status === 'ok') {
      // 再点一次 = 收起。省一次上游请求，而且它本来就是同一个答案。
      setInfoMatchId(null);
      setInfoState(null);
      setInfoOwner(null);
      return;
    }

    setInfoMatchId(matchId);
    setInfoOwner(owner);
    setInfoState({ status: 'loading' });
    try {
      // ⚠️ info 的下界比种子值低（100876 < 3650001）：老比赛可能只有结构信息。
      //    所以这里**不**复用查找种子值时那个下界。
      const data = await fetchSeedInfo(matchId);
      setInfoState({ status: 'ok', info: data.info });
      harvest(data.info);
    } catch (error) {
      // 这里的失败只影响这一小块，不该把整页变成错误页
      setInfoState({
        status: 'error',
        message: describeSeedQueryError(error, t, errorText, 'lookup', MIN_SEEDINFO_MATCH_ID)
          .message,
      });
    }
  }

  /** 结果卡片上的那个按钮。 */
  function infoActionFor(matchId: number | null, owner: 'search' | 'lookup') {
    // matchId 为 null 时拿不到结构与变种（那个端点就是按 ID 查的），
    // 所以不渲染按钮 —— 渲染一个点了必然失败的按钮比不渲染更糟。
    if (matchId === null) return null;
    const open = infoOwner === owner && infoMatchId === matchId && infoState?.status === 'ok';
    return (
      <button
        type="button"
        className="ghostbtn"
        aria-expanded={open}
        onClick={() => void loadInfo(matchId, owner)}
      >
        {t('seedsPage.viewInfo')}
      </button>
    );
  }

  /** 挂在结果卡片里的那块面板。只有**当前那张卡片**上展开的那一条才渲染。 */
  function infoSlotFor(matchId: number | null, owner: 'search' | 'lookup') {
    if (matchId === null || infoOwner !== owner || infoMatchId !== matchId || infoState === null) {
      return null;
    }
    if (infoState.status === 'loading') {
      return <p className="muted">{t('seedsPage.loading')}</p>;
    }
    if (infoState.status === 'error') return <p className="fielderr">{infoState.message}</p>;
    return <SeedInfoPanel info={infoState.info} />;
  }

  // -------------------------------------------------------------------------

  const searchFieldErrors = searchFailure?.fieldErrors ?? {};
  const lookupFieldErrors = lookupFailure?.fieldErrors ?? {};

  function openSaveForm(matchId?: number) {
    setSavePrefill(matchId === undefined ? undefined : String(matchId));
    setSaveOpen(true);
  }

  return (
    <>
      <header className="pagehead">
        <h1 className="pagehead__title">{t('seedsPage.title')}</h1>
        <p className="pagehead__sub">{t('seedsPage.subtitle')}</p>
      </header>

      {/*
        ★ "约 80%" 这条说明是这一页最重要的一句话。
        它把"查不到"从"出错了"变成"这一条不在库里" —— 少了它，
        用户每一次 404 都会来问一次。
      */}
      <Notice kind="info">{t('seedsPage.coverage')}</Notice>

      {/* ==================================================================
          Ranked Seeds
          ================================================================== */}
      <section className="seed__block">
        <h2 className="seed__blocktitle">{t('seedsPage.searchTitle')}</h2>
        <p className="mcsr-field__hint">{t('seedsPage.searchHint')}</p>

        <SeedFiltersPanel
          state={filters}
          onChange={setFilters}
          observedVariations={observedVariations}
          fieldErrors={{
            overworld: searchFieldErrors.overworld,
            nether: searchFieldErrors.nether,
            variations: searchFieldErrors.variations,
            completion: searchFieldErrors.completion,
          }}
        />

        <div className="seed__actions">
          <button
            type="button"
            className="cta"
            disabled={searchBusy}
            onClick={() => void runSearch()}
          >
            {searchBusy
              ? t('seedsPage.searching')
              : builtFilters.hasAny
                ? t('seedsPage.searchAction')
                : t('seedsPage.randomAction')}
          </button>
          {/*
            这一句解释了同一个按钮为什么会先去两个不同的端点。
            不说的话，用户没有理由知道"没填条件"和"填了条件"走的不是同一条路。
          */}
          <span className="mcsr-field__hint">{t('seedsPage.filterNote')}</span>
        </div>

        {searchFailure ? (
          <Notice kind="bad">
            {searchFailure.message}
            {searchFailure.hint ? <> {searchFailure.hint}</> : null}
          </Notice>
        ) : null}

        {/*
          `availableCounts` 是 number | null。
          ⚠️ null 时必须说"上游没有给出命中数"，**不能渲染 0** ——
          0 的意思是"一条都没有"，而这时我们手里明明拿着一条种子。
        */}
        {result ? (
          <>
            <p className="seed__hits">
              {result.availableCounts === null
                ? t('seedsPage.hitsUnknown')
                : t('seedsPage.hits', { count: result.availableCounts })}
            </p>
            {/*
              ⚠️ 条件改过之后，卡片上那条种子**不再对应**当前的条件。
              不说的话，用户会以为它满足现在的筛选，然后拿着一条不符合
              预期的种子去开世界。这一句只在真的不一样时才出现。
            */}
            {resultKey !== null && resultKey !== builtKey ? (
              <p className="seed__stale">{t('seedsPage.resultStale')}</p>
            ) : null}
            <SeedResultCard
              record={result.seed}
              infoAction={infoActionFor(result.seed.matchId, 'search')}
            >
              {infoSlotFor(result.seed.matchId, 'search')}
            </SeedResultCard>
          </>
        ) : (
          <p className="state state--empty">{t('seedsPage.resultEmpty')}</p>
        )}
      </section>

      {/* ==================================================================
          按比赛 ID 查
          ================================================================== */}
      <section className="seed__block">
        <h2 className="seed__blocktitle">{t('seedsPage.lookupTitle')}</h2>
        <p className="mcsr-field__hint">{t('seedsPage.lookupHint')}</p>

        <div className="seed__lookuprow">
          <label className="sr-only" htmlFor="seed-matchid">
            {t('seedsPage.matchIdLabel')}
          </label>
          <input
            id="seed-matchid"
            className="mcsr-field__input"
            /*
             * ⚠️ `inputMode="numeric"` 只换手机键盘，**不动值的类型** ——
             * 这和 `type="number"` 是两回事（后者在种子输入框上是灾难，
             * 见 SeedSaveForm 的说明）。
             */
            inputMode="numeric"
            value={matchIdInput}
            onChange={(e) => setMatchIdInput(e.target.value)}
            placeholder={t('seedsPage.matchIdPlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runLookup();
            }}
          />
          <button
            type="button"
            className="cta"
            disabled={lookupBusy}
            onClick={() => void runLookup()}
          >
            {lookupBusy ? t('seedsPage.lookupBusy') : t('seedsPage.lookupAction')}
          </button>
        </div>
        <p className="mcsr-field__hint">{t('seedsPage.matchIdRange', { min: MIN_MATCH_ID })}</p>
        {lookupFieldErrors.matchId ? <p className="fielderr">{lookupFieldErrors.matchId}</p> : null}

        {/*
          ★ 404 分两种，而**下一步完全不同**：
            · kind === 'not_found' → 这场比赛不在上游（约 20%）→ 补录
            · kind === 'no_match'  → 条件太窄（只可能来自检索那一侧）→ 放宽条件
          所以这一块单独渲染 not_found：它给的不是一句抱歉，而是**两个出口**。
        */}
        {lookupFailure?.kind === 'not_found' ? (
          <div className="seed__notfound">
            <p className="seed__notfoundtitle">{t('seedsPage.notFoundTitle')}</p>
            <p>{t('seedsPage.notFoundBody')}</p>
            <p className="mcsr-field__hint">
              {t('seedsPage.notFoundInfoHint', { min: MIN_SEEDINFO_MATCH_ID })}
            </p>
            <div className="seed__actions">
              {lookupId !== null ? (
                <>
                  <button
                    type="button"
                    className="ghostbtn"
                    onClick={() => void loadInfo(lookupId, 'lookup')}
                  >
                    {t('seedsPage.infoOnlyAction')}
                  </button>
                  <button type="button" className="cta" onClick={() => openSaveForm(lookupId)}>
                    {t('seedsPage.saveTitle')}
                  </button>
                </>
              ) : null}
            </div>
            {/*
              ⚠️ 这一块里也要把面板渲染出来。
              上面那个"只查结构与变种"按钮展开的面板本来挂在结果卡片里，
              而**这条路恰恰没有卡片**（查种子值 404 了，所以 lookup 是 null）——
              不在这里补一处，面板就会"加载成功但哪儿都不显示"。
            */}
            {lookupId !== null ? infoSlotFor(lookupId, 'lookup') : null}
          </div>
        ) : null}

        {lookupFailure && lookupFailure.kind !== 'not_found' ? (
          <Notice kind="bad">
            {lookupFailure.message}
            {lookupFailure.hint ? <> {lookupFailure.hint}</> : null}
          </Notice>
        ) : null}

        {lookup ? (
          <SeedResultCard record={lookup} infoAction={infoActionFor(lookup.matchId, 'lookup')}>
            {infoSlotFor(lookup.matchId, 'lookup')}
          </SeedResultCard>
        ) : null}
      </section>

      {/* ==================================================================
          补录（Q15）
          ================================================================== */}
      <section className="seed__block">
        <h2 className="seed__blocktitle">{t('seedsPage.saveTitle')}</h2>

        {/*
          表单默认**收起**。
          它不是这一页的主线（主线是查），而且它写的是别人的生产数据 ——
          摊在页面上会让人以为它是常规操作。展开动作由"查不到 → 补录"
          那个按钮触发，那时它带着刚查过的 matchId 一起出现。
        */}
        {saveOpen ? (
          <SeedSaveForm
            /*
              ⚠️ `key` 是必需的，不是装饰：SeedSaveForm 用 useState 初始化
                 预填的 matchId，而 useState 的初值**只在挂载时读一次**。
                 不换 key 的话，从"查不到 A → 补录"再走到"查不到 B → 补录"，
                 输入框里会一直留着 A 的 ID —— 而用户以为自己在补录 B。
            */
            key={savePrefill ?? 'blank'}
            initialMatchId={savePrefill}
            onCancel={() => setSaveOpen(false)}
            /*
              写成功之后**不**自动去查一次：那会立刻消耗一次上游配额，
              而用户可能只是想把几条补完再一起看。他自己点一下"查询"就行。
            */
          />
        ) : (
          <p className="seed__actions">
            <button type="button" className="ghostbtn" onClick={() => openSaveForm()}>
              {t('seedsPage.saveTitle')}
            </button>
            <span className="mcsr-field__hint">{t('seedsPage.saveIntro')}</span>
          </p>
        )}
      </section>

      {/* ==================================================================
          社区种子分享 · 即将开放（Q7 / Q8 / Q16）
          ==================================================================
          ⚠️ 这一块**一个按钮都没有**，而且是**故意的**。
             一个点不动的按钮比一块说明文字更让人困惑：用户会去点它，
             然后怀疑是网络问题或者自己的浏览器坏了。
             这里要说清三件事：要做什么、为什么现在没有、以及**它不是坏了**。
      */}
      <section className="seed__block seed__block--soon">
        <h2 className="seed__blocktitle">{t('seedsPage.communityTitle')}</h2>
        <p>{t('seedsPage.communityBody')}</p>
        <p className="muted">{t('seedsPage.communityWhy')}</p>
        <p className="mcsr-field__hint">{t('seedsPage.communityNote')}</p>
      </section>
    </>
  );
}
