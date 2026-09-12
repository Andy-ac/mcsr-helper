import type { SeedCreateInput } from '@mcsr/shared/seed';
import { isSeedString, normalizeSeedInput } from '@mcsr/shared/seed';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { em } from '@/components/Emphasis';
import { Field, Notice } from '@/components/Form';
import { saveSeedRecord } from '@/lib/api';
import { useApiErrorText, useAuth } from '@/lib/auth';
import { useCan } from '@/lib/capabilities';
import { describeSeedSaveError, MIN_MATCH_ID, type SeedSaveField } from '@/lib/seedErrors';

/**
 * 补录表单 —— 把一场比赛的种子值写进**上游运营者的数据库**。
 *
 * ---------------------------------------------------------------------------
 * 这是全站唯一一处"用户的点击会改到别人的生产数据"
 * ---------------------------------------------------------------------------
 * Q15 的决定是**暂时暴露**这个写接口（用户要求的，为的是能在客户端里补录
 * 上游那 20% 覆盖之外的数据），而暴露写接口必须带守卫。守卫在服务端：
 * 登录 + 邮箱已验证 + `seed.submit` 能力 + 每小时 10 次的独立配额 + 运维开关
 * + 每次写入记审计。**界面不重复这些判断，只提前告诉用户要什么。**
 *
 * 所以这里的定位是"让用户在按下去之前知道自己在做什么"，不是安全边界 ——
 * 界面拦不住任何人，真正的拦截在 `routes/seeds.ts` 的 `requireCapability`。
 * 反过来说，**即使这里全部放行，服务端仍然是对的**：会话过期是一个真实状态，
 * 而下面每一种拒绝都有对应的处理。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 为什么先本地校验一遍（而不是直接发出去看服务端怎么说）
 * ---------------------------------------------------------------------------
 * 1. 用户立刻看到红字，不用等一个来回；
 * 2. `invalid_input` 的 400 带的是 `reason`，而 `reason` 现在**传不到前端**
 *    （见 lib/seedErrors.ts 的文件头）。本地校验把绝大多数 400 挡在门外，
 *    剩下的那条路才会掉进"我们知道有个字段不对，但不知道是哪个"。
 * 3. 种子值的校验用的是 `shared/seed.ts` 的 `isSeedString` / `normalizeSeedInput`
 *    —— 和服务端**同一份**判据。手写一份正则的话，两边一定会漂移，
 *    而在这个字段上漂移的代价是"静默地写进去一个错的种子"。
 */
export function SeedSaveForm({
  initialMatchId,
  onDone,
  onCancel,
}: {
  /** 从"查不到"那条路过来时预填比赛 ID —— 用户刚刚才查过它。 */
  initialMatchId?: string;
  onDone?: (matchId: number) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const auth = useAuth();
  const errorText = useApiErrorText();
  const canSubmit = useCan('seed.submit');

  const [draft, setDraft] = useState({
    matchId: initialMatchId ?? '',
    overworldSeed: '',
    netherSeed: '',
    theEndSeed: '',
    matchDate: '',
  });
  const [errors, setErrors] = useState<Partial<Record<SeedSaveField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [action, setAction] = useState<{ to: string; labelKey: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  function set(key: keyof typeof draft, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  /**
   * 客户端的字段校验。**返回 null 表示这一组能发**。
   *
   * 判据逐条对应服务端 `parseSaveInput`：
   *   · matchId —— `/^\d{1,15}$/` + `>= MIN_MATCH_ID`（服务端先正则定形状再
   *     Number()，绝不对任意字符串 parseInt：`'3650001abc'` / `'3.6e6'` /
   *     `' 3650001 '` 在那边全是 400，因为 parseInt 会把它们解释成**另一场**比赛）
   *   · 三个种子值 —— `normalizeSeedInput` + `isSeedString`（同一份判据）
   *   · matchDate —— 长度 ≤ 32 且字符集 `[0-9T:.Z+-]`（服务端的从宽校验）
   */
  function validate(): { input: SeedCreateInput; errors: Partial<Record<SeedSaveField, string>> } {
    const next: Partial<Record<SeedSaveField, string>> = {};

    const rawId = draft.matchId.trim();
    let matchId = 0;
    if (!/^\d{1,15}$/.test(rawId)) {
      next.matchId = t('seedsPage.saveErrMatchId', { min: MIN_MATCH_ID });
    } else {
      const value = Number(rawId);
      // matchId 是**小数字**（15 位以内），用 Number 是安全的 ——
      // 这和种子值的情况完全不同，那里必须全程用字符串（见 shared/seed.ts）。
      if (!Number.isSafeInteger(value) || value < MIN_MATCH_ID) {
        next.matchId = t('seedsPage.saveErrMatchId', { min: MIN_MATCH_ID });
      } else {
        matchId = value;
      }
    }

    /** 每个种子字段自己的红字 —— 三句是分开的，因为它们要改的地方不同。 */
    const SEED_FIELD_KEY: Record<'overworldSeed' | 'netherSeed' | 'theEndSeed', string> = {
      overworldSeed: 'seedsPage.saveErrOverworldSeed',
      netherSeed: 'seedsPage.saveErrNetherSeed',
      theEndSeed: 'seedsPage.saveErrTheEndSeed',
    };

    /**
     * 种子值：先规范化再判合法性。
     * `normalizeSeedInput` 对非法输入**抛错**（那是它的契约），所以这里包一层。
     * 用户从聊天窗口复制过来的值几乎一定带空格，而那不该变成一个红字。
     */
    function seedValue(
      raw: string,
      field: 'overworldSeed' | 'netherSeed' | 'theEndSeed',
      optional: boolean,
    ): string | null {
      const trimmed = raw.trim();
      if (!trimmed) {
        // 可选字段留空是**正常**的（末地种子确实可能没有），不当错误
        if (!optional) next[field] = t(SEED_FIELD_KEY[field]);
        return null;
      }

      let normalized: string;
      try {
        normalized = normalizeSeedInput(trimmed);
      } catch {
        next[field] = t(SEED_FIELD_KEY[field]);
        return null;
      }

      /*
       * ⚠️ 再跑一遍 isSeedString。这不是把规范化逻辑抄第二份，而是
       *    "**要发出去的那个值**必须通过校验"的最后一道断言 ——
       *    服务端的 requireSeedString 里也有同样的一遍，理由逐字相同。
       *    正常情况永远走不到这里（normalizeSeedInput 不可能返回非法值），
       *    所以它一旦触发，说明我们对 shared 的假设已经错了。
       */
      if (!isSeedString(normalized)) {
        next[field] = t(SEED_FIELD_KEY[field]);
        return null;
      }
      return normalized;
    }

    const overworldSeed = seedValue(draft.overworldSeed, 'overworldSeed', false) ?? '';
    const netherSeed = seedValue(draft.netherSeed, 'netherSeed', false) ?? '';
    const theEndSeed = seedValue(draft.theEndSeed, 'theEndSeed', true);

    const rawDate = draft.matchDate.trim();
    let matchDate: string | null = null;
    if (rawDate) {
      if (rawDate.length > 32 || !/^[0-9T:.Z+-]+$/.test(rawDate)) {
        next.matchDate = t('seedsPage.saveErrMatchDate');
      } else {
        matchDate = rawDate;
      }
    }

    const input: SeedCreateInput = { matchId, overworldSeed, netherSeed };
    /*
     * ⚠️ 空的**可选**字段是**不发**，不是发 null（见 shared/seed.ts 的
     *    SeedCreateInput 注释）。虽然服务端两种都收，但"不发"表达的是
     *    "用户没提供这个信息"，而 null 表达的是"用户说它是空的" ——
     *    现在这个区别没有后果，以后未必没有。
     */
    if (theEndSeed !== null) input.theEndSeed = theEndSeed;
    if (matchDate !== null) input.matchDate = matchDate;

    return { input, errors: next };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setAction(null);

    const { input, errors: fieldErrors } = validate();
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    setBusy(true);
    try {
      const result = await saveSeedRecord(input);
      setDone(result.matchId);
      onDone?.(result.matchId);
    } catch (error) {
      const failure = describeSeedSaveError(error, t, errorText);
      setErrors(failure.fieldErrors);
      setFormError(failure.formError);
      setAction(failure.action ?? null);
    } finally {
      setBusy(false);
    }
  }

  // -------------------------------------------------------------------------
  // 三道闸门（和服务端同一套：登录 / 已验证 / seed.submit）
  // -------------------------------------------------------------------------
  /*
   * ⚠️ 判定的**顺序**和服务端的 requireCapability 一致：先说"你没登录"，
   *    再说"你邮箱没验证"，最后才是"你没这个权限"。
   *    顺序反过来的话，一个没登录的人会看到"你没有补录权限" ——
   *    那是一句他无法处理、也不属实的话。
   *
   * ⚠️ 而且这三条**只是提前告知**：真正的拦截在服务端，所以下面每条被拒的
   *    回复（401 / 403 / 403 email_not_verified）在 submit 的 catch 里都有处理。
   *    会话过期是一个真实状态 —— 页面开着、cookie 过期了、再点一下。
   */
  if (auth.loading) return <p className="state">{t('seedsPage.loading')}</p>;

  if (!auth.user) {
    return (
      <Notice kind="info">
        {t('seedsPage.saveNeedLogin')}{' '}
        <Link to="/login?next=%2Fseeds">{t('seedsPage.saveNeedLoginAction')}</Link>
      </Notice>
    );
  }
  if (!auth.user.emailVerified) {
    return (
      <Notice kind="bad">
        {t('seedsPage.saveNeedVerify')} <Link to="/me">{t('seedsPage.saveNeedVerifyAction')}</Link>
      </Notice>
    );
  }
  if (!canSubmit) {
    return <Notice kind="info">{t('seedsPage.saveNeedCapability')}</Notice>;
  }

  if (done !== null) {
    return (
      <>
        <Notice kind="ok">{t('seedsPage.saveDone', { matchId: done })}</Notice>
        {onCancel ? (
          <p className="seed__actions">
            <button type="button" className="ghostbtn" onClick={onCancel}>
              {t('seedsPage.saveCancel')}
            </button>
          </p>
        ) : null}
      </>
    );
  }

  const fieldError = (key: SeedSaveField) =>
    errors[key] ? <p className="fielderr">{errors[key]}</p> : null;

  return (
    <form className="authform seed__saveform" onSubmit={submit} noValidate>
      {/*
        ★ 这句必须在**按钮上面**，而且必须显眼。
        这是全站唯一一处用户的点击会改到别人生产数据的地方 ——
        他有权在按下去之前知道，而不是事后从别处听说。
      */}
      <Notice kind="info">{t('seedsPage.saveWarning')}</Notice>
      <p className="mcsr-field__hint">{t('seedsPage.saveIntro')}</p>

      {formError ? (
        <Notice kind="bad">
          {formError}
          {action ? (
            <>
              {' '}
              <Link to={action.to}>{t(action.labelKey)}</Link>
            </>
          ) : null}
        </Notice>
      ) : null}

      <div className="formrow">
        <Field id="seed-save-match" label={t('seedsPage.saveMatchId')}>
          {/*
            ⚠️ 这里**可以**用数值键盘（matchId 是 15 位以内的小整数），
               但**不能**用 `type="number"`：它的上下箭头、滚轮改值、
               以及某些浏览器里对 `e` 的科学计数法处理，都会让一个手滑变成
               一个合法的**另一场比赛**。inputMode 只影响手机键盘，不影响值。
          */}
          <input
            id="seed-save-match"
            className="mcsr-field__input"
            inputMode="numeric"
            value={draft.matchId}
            onChange={(e) => set('matchId', e.target.value)}
            placeholder={t('seedsPage.matchIdPlaceholder')}
          />
          {fieldError('matchId')}
        </Field>

        <Field
          id="seed-save-date"
          label={t('seedsPage.saveMatchDate')}
          hint={t('seedsPage.saveMatchDateHint')}
        >
          <input
            id="seed-save-date"
            className="mcsr-field__input"
            value={draft.matchDate}
            onChange={(e) => set('matchDate', e.target.value)}
          />
          {fieldError('matchDate')}
        </Field>
      </div>

      {/*
        ⚠️⚠️ 下面两个输入框是**整个页面最危险的两个控件**，而它们的危险
        恰恰在于"看起来很正常就能用"：type="number" 会把
        7304888896886165976 静默变成 7304888896886166000 并照常提交。
        所以它们是 `inputMode="text"` + 不做任何数值转换（见 shared/seed.ts）。
      */}
      <Field
        id="seed-save-overworld"
        label={t('seedsPage.saveOverworldSeed')}
        hint={t('seedsPage.saveSeedHint')}
      >
        <input
          id="seed-save-overworld"
          className="mcsr-field__input"
          inputMode="text"
          autoComplete="off"
          value={draft.overworldSeed}
          onChange={(e) => set('overworldSeed', e.target.value)}
        />
        {fieldError('overworldSeed')}
      </Field>

      <Field
        id="seed-save-nether"
        label={t('seedsPage.saveNetherSeed')}
        hint={t('seedsPage.saveSeedHint')}
      >
        <input
          id="seed-save-nether"
          className="mcsr-field__input"
          inputMode="text"
          autoComplete="off"
          value={draft.netherSeed}
          onChange={(e) => set('netherSeed', e.target.value)}
        />
        {fieldError('netherSeed')}
      </Field>

      <Field
        id="seed-save-end"
        label={t('seedsPage.saveTheEndSeed')}
        hint={t('seedsPage.saveTheEndHint')}
      >
        <input
          id="seed-save-end"
          className="mcsr-field__input"
          inputMode="text"
          autoComplete="off"
          value={draft.theEndSeed}
          onChange={(e) => set('theEndSeed', e.target.value)}
        />
        {fieldError('theEndSeed')}
      </Field>

      <p className="mcsr-field__hint">{em(t('seedsPage.saveQuotaNote'))}</p>

      <div className="authform__actions">
        <button type="submit" className="cta" disabled={busy}>
          {busy ? t('seedsPage.saveBusy') : t('seedsPage.saveAction')}
        </button>
        {onCancel ? (
          <button type="button" className="ghostbtn" onClick={onCancel} disabled={busy}>
            {t('seedsPage.saveCancel')}
          </button>
        ) : null}
      </div>
    </form>
  );
}
