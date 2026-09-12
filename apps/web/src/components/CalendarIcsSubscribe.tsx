import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { calendarIcsUrl, calendarWebcalUrl } from '@/lib/api';

/**
 * ICS 订阅入口 —— **日历页上最重要的一个控件**。
 *
 * M4 的验收标准里有一条就是它：「订阅的 ICS 能在手机自带日历里看到」。
 * 所以这个块的存在理由不是"提供下载"，而是把那条 URL **交到用户手机上**，
 * 而且要在一台只有触摸屏的设备上做得到。
 *
 * ---------------------------------------------------------------------------
 * 为什么是"订阅"而不是"下载"
 * ---------------------------------------------------------------------------
 * 下载下来的 `.ics` 是**一次性快照**：存进手机那一刻是什么样，以后就一直是
 * 那样。新批准的赛事不会自己出现，改过时间的活动也不会更新 —— 而用户会以为
 * 自己的日历是准的。日历客户端的"订阅/账户"功能才是每隔几小时自动拉一次的那条路。
 * 所以这里第一句话就在讲这件事，而不是把两个按钮并排一放让用户自己猜。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 复制按钮必须有三条路，少一条就会在某个真实环境里什么都不发生
 * ---------------------------------------------------------------------------
 *   1. `navigator.clipboard.writeText` —— 首选。但它要求**安全上下文**
 *      （https 或 localhost），而且会被权限策略拒绝。
 *   2. `document.execCommand('copy')` —— 已经过时，但它是**同步**的，
 *      仍然算在用户手势里。当 1 被拒（Electron 的权限白名单只开了
 *      `clipboard-sanitized-write`，策略随时可能变）时它是唯一还能成功的那条。
 *   3. **把文本选中**，让用户自己按 Ctrl+C / 长按。这一步**无论成败都要做**，
 *      因为它是前两条都失败时的兜底 —— 而"点了没反应"是最没法排查的一种失败。
 *
 * 三条路走完之后一定会有一个明确的结果状态（已复制 / 请手动复制），
 * 不会出现"按钮按下去什么都不发生"。
 */
export function CalendarIcsSubscribe() {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');

  const url = calendarIcsUrl();
  const webcal = calendarWebcalUrl();

  /*
   * `calendarIcsUrl()` 用 `location.origin` 拼绝对地址 —— 这是对的
   * （这条 URL 要进手机日历客户端的输入框，那里没有"当前页面"的概念）。
   *
   * ⚠️ 但 `origin` 在拿不到的时候不是空串：`file://` 下它是字符串 `'null'`，
   *    而 `'null'` 是**真值**。于是拼出来是 `null/api/calendar.ics` ——
   *    一个看起来像路径、粘到手机上必然失败的地址。
   *    所以这里判的是"它到底是不是一个 http(s) 地址"，而不是"它是不是空的"。
   */
  const usable = /^https?:\/\//.test(url);

  async function copy() {
    // ① 先选中：它是前两条路都失败时的兜底，而且对用户没有任何副作用
    const field = inputRef.current;
    field?.focus();
    field?.select();

    try {
      if (!navigator.clipboard?.writeText) throw new Error('no async clipboard');
      await navigator.clipboard.writeText(url);
      setState('copied');
      return;
    } catch {
      /* 落到下面那条同步的老路 */
    }

    try {
      if (document.execCommand('copy')) {
        setState('copied');
        return;
      }
    } catch {
      /* 两条都失败 —— 落到下面的手动提示 */
    }

    setState('manual');
  }

  if (!usable) {
    // 拿不到站点地址时**不要**显示一个坏链接加一堆步骤。说清楚为什么、怎么办。
    return (
      <section className="calendar-ics">
        <h2 className="calendar-ics__title">{t('calendar.icsTitle')}</h2>
        <p className="calendar-ics__note">{t('calendar.icsNoOrigin')}</p>
      </section>
    );
  }

  return (
    <section className="calendar-ics">
      <h2 className="calendar-ics__title">{t('calendar.icsTitle')}</h2>

      {/*
        「为什么订阅比下载好」放在 URL 之前。
        放在按钮后面的话，用户已经复制走那条链接了，这句话就不再有人读 ——
        而它是这个块唯一真正要传达的东西。
      */}
      <p className="calendar-ics__why">{t('calendar.icsWhy')}</p>

      <label className="calendar-ics__label" htmlFor="cal-ics-url">
        {t('calendar.icsUrlLabel')}
      </label>
      <div className="calendar-ics__row">
        <input
          id="cal-ics-url"
          ref={inputRef}
          className="calendar-ics__url"
          // readOnly 而不是 disabled：disabled 的输入框不能被选中，
          // 而"选中它"正是复制失败时的兜底动作。
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          // 手机上长按输入框会弹出系统菜单，这就是第三条路
          spellCheck={false}
          autoComplete="off"
        />
        <button type="button" className="cta calendar-ics__copy" onClick={() => void copy()}>
          {state === 'copied' ? t('calendar.icsCopied') : t('calendar.icsCopy')}
        </button>
      </div>

      {state === 'manual' ? (
        <p className="calendar-ics__result" role="status">
          {t('calendar.icsCopyManual')}
        </p>
      ) : null}
      {state === 'copied' ? (
        <p className="calendar-ics__result" role="status">
          {t('calendar.icsCopiedHint')}
        </p>
      ) : null}

      {/*
        webcal:// —— iOS / macOS 上一键交给系统日历。
        桌面浏览器通常没有注册这个协议的处理器，点了没反应，
        所以下面那行说明是必需的，不能只留一个按钮。
      */}
      {webcal ? (
        <div className="calendar-ics__row">
          <a className="ghostbtn calendar-ics__webcal" href={webcal}>
            {t('calendar.icsWebcal')}
          </a>
          <span className="calendar-ics__hint">{t('calendar.icsWebcalHint')}</span>
        </div>
      ) : null}

      {/*
        三条分平台的步骤。刻意**写成完整的一句话**而不是"1. 2. 3."的列表：
        手机上用户要照着做，一句话里连着念下来比在标签和菜单之间来回对号
        更不容易走错（这些都是逐级菜单，中间的层级名一个都不能漏）。
      */}
      <dl className="calendar-ics__steps">
        <dt>{t('calendar.icsIosTitle')}</dt>
        <dd>{t('calendar.icsIos')}</dd>
        <dt>{t('calendar.icsAndroidTitle')}</dt>
        <dd>{t('calendar.icsAndroid')}</dd>
        <dt>{t('calendar.icsDesktopTitle')}</dt>
        <dd>{t('calendar.icsDesktop')}</dd>
      </dl>

      <p className="calendar-ics__note">{t('calendar.icsRefresh')}</p>
      <p className="calendar-ics__note">{t('calendar.icsPublishedOnly')}</p>
    </section>
  );
}
