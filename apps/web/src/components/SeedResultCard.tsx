import type { SeedInfo, SeedRecord, SeedString } from '@mcsr/shared/seed';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { structureLabel } from '@/lib/seedLabels';

/**
 * 一条种子的展示卡片 + 它的"结构与变种"面板。
 *
 * ---------------------------------------------------------------------------
 * ⚠️⚠️ 这个文件里最重要的一条规则：种子**从头到尾是字符串**
 * ---------------------------------------------------------------------------
 * 界面上写的每一个种子值都直接来自 API 的字符串，中间**不经过**任何
 * `Number` / `parseInt` / `+v`。原因见 packages/shared/src/seed.ts 的文件头：
 * Minecraft 种子是 64 位整数，而 JS 的 Number 只能精确到 2^53-1，所以
 *
 *     Number('7304888896886165976') → 7304888896886166000
 *
 * **不报错、不抛异常**，只是静默地给玩家一个错的种子 ——
 * 他拿去开世界生成不出预期的地形，而且无从排查是哪一层截断的。
 *
 * 所以：
 *   · 显示用**原始字符串**（不加千位分隔符 —— 手动复制时逗号会一起被带走）
 *   · 复制也用**原始字符串**，和显示的是同一个（带逗号的种子粘不进 Minecraft）
 *   · 输入框用 `inputMode="text"`，**不是** `type="number"`（见 SeedSaveForm）
 */

// ---------------------------------------------------------------------------
// 复制
// ---------------------------------------------------------------------------

/**
 * 把文本放进剪贴板。成功返回 true。
 *
 * 两条路，因为只走第一条是不够的：
 *   1. `navigator.clipboard.writeText` —— 现代接口，但**只在安全上下文里存在**。
 *      本地开发用 `http://localhost:5173` 时它是有的（localhost 被当作安全上下文），
 *      而如果有人用局域网 IP 打开 dev server，这个 API 会直接是 undefined。
 *      它也可能因为我们没有 clipboard-write 权限而 reject。
 *      两种失败都不该让按钮变成"点了没反应"。
 *   2. `document.execCommand('copy')` —— 已废弃，但它是唯一在非安全上下文里
 *      还能用的办法，而且桌面端明确开了 `clipboard-sanitized-write` 权限
 *      （见 docs/m4-decisions.md §6.1，那个权限就是为这个按钮开的）。
 *
 * ⚠️ 为什么值得写这么长：种子是 19 位数字（`7304888896886165976`），
 *    手抄进 Minecraft 不现实，而抄错一位会生成一个完全不同的世界。
 *    这个按钮坏了，整个查询功能就只剩"能看不能用"。
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 不安全上下文 / 权限被拒 / 用户手势判定失败 —— 都掉到下面的兜底
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    /*
     * 用 fixed + 负 top 挪出视口，而**不是** display:none ——
     * 后者选不中，`select()` 会静默地什么都不选，于是"复制"成功但内容是空的。
     */
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

type CopyState = 'idle' | 'ok' | 'fail';

/**
 * 单条种子值 + 复制按钮。
 *
 * 每个值自己持有"已复制"状态：三个按钮共用一个状态的话，
 * 点主世界会让下界那一行也显示"已复制"。
 */
export function SeedValue({
  label,
  value,
}: {
  label: string;
  /** ⚠️ 必须是字符串。类型上就挡住 Number（见文件头）。 */
  value: SeedString;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<CopyState>('idle');
  /*
   * ⚠️ 类型写成 `ReturnType<typeof setTimeout>` 而不是 `number`：
   *    这个仓库同时装了 @types/node，于是 `setTimeout` 的返回类型是 `Timeout`
   *    而不是 DOM 的 `number`，写 `number` 会直接编译不过。
   *    （它**只**用来 clear，所以具体是哪个类型无关紧要。）
   */
  const timer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);

  // 组件卸载时清掉定时器：不清的话会在已卸载的组件上 setState
  useEffect(
    () => () => {
      if (timer.current !== null) globalThis.clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    const ok = await copyToClipboard(value);
    setState(ok ? 'ok' : 'fail');
    if (timer.current !== null) globalThis.clearTimeout(timer.current);
    timer.current = globalThis.setTimeout(() => setState('idle'), 2000);
  }

  return (
    <div className="seed__value">
      <span className="seed__valuelabel">{label}</span>
      <code className="seed__digits" title={value}>
        {/*
          ⚠️ **原样输出，不加千位分隔符**（用户 2026-09-16）：分组虽然方便肉眼核对位数，
          但手动选中复制时逗号会一起被带走，而带逗号的种子粘不进 Minecraft ——
          那种"看着没问题、粘进去用不了"的错，比看不清位数难查得多。
          复制按钮走的也是**同一个**原始值，显示与复制不再有第二个版本。
        */}
        {value}
      </code>
      <button type="button" className="ghostbtn seed__copy" onClick={copy}>
        {state === 'ok' ? t('seedsPage.copied') : t('seedsPage.copy')}
      </button>
      {state === 'fail' ? <p className="fielderr">{t('seedsPage.copyFailed')}</p> : null}
    </div>
  );
}

/** 比赛 ID + 比赛时间。 */
function SeedMeta({ record }: { record: SeedRecord }) {
  const { t } = useTranslation();
  return (
    <div className="seed__meta">
      <span className="seed__metaitem">
        {t('seedsPage.matchIdLabel')}
        <code className="seed__matchid">{record.matchId ?? '—'}</code>
      </span>
      <span className="seed__metaitem">
        {t('seedsPage.matchDateLabel')}
        {/*
          上游两个端点里 `matchDate` 一个是数字毫秒、一个是字符串（实测不一致之六），
          归一化在服务端做完了，所以这里拿到的一定是毫秒数或 null。
          null 是真实存在的（老比赛可能没有时间），必须说"没有"，**不能**显示成 0
          —— 1970 年 1 月 1 日看起来像一条真实数据。
        */}
        {record.matchDate === null
          ? t('seedsPage.matchDateUnknown')
          : new Date(record.matchDate).toLocaleString()}
      </span>
    </div>
  );
}

/**
 * 一条种子的卡片。
 *
 * `infoAction` 是**调用方给的按钮**，而不是这里写死的一个：
 * 同一个 matchId 可能同时出现在"检索结果"和"按 ID 查"两块里，
 * 所以按钮和它控制的那个面板属于谁，只有页面知道（见 Seeds.tsx 的 infoOwner）。
 */
export function SeedResultCard({
  record,
  infoAction,
  children,
}: {
  record: SeedRecord;
  infoAction?: ReactNode;
  /** "结构与变种"面板 —— 由页面挂在这里，因为它要负责去重和记住见过的词条。 */
  children?: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div className="seed__card">
      <SeedMeta record={record} />

      <div className="seed__values">
        <SeedValue label={t('seedsPage.overworldSeed')} value={record.overworldSeed} />
        <SeedValue label={t('seedsPage.netherSeed')} value={record.netherSeed} />
        {record.theEndSeed === null ? (
          <div className="seed__value seed__value--missing">
            <span className="seed__valuelabel">{t('seedsPage.theEndSeed')}</span>
            <span className="seed__missing">{t('seedsPage.theEndMissing')}</span>
          </div>
        ) : (
          <SeedValue label={t('seedsPage.theEndSeed')} value={record.theEndSeed} />
        )}
      </div>

      {infoAction ? <div className="seed__actions">{infoAction}</div> : null}
      {children}
    </div>
  );
}

/**
 * `SeedInfo` 的展示 —— 结构与变种。
 *
 * ⚠️ 变种词条**原样输出**，一个大写转换都没有。
 *    它们是命名空间 id（`biome:structure:plains`），大写之后就和上游对不上，
 *    而界面上看起来完全正常，只是再也搜不到东西。
 *
 * ⚠️ `end_spawn:*` 在这里**保留**。它在筛选里被剔掉了（上游有 bug，Q17），
 *    但它真的存在于种子数据里（实测 `end_spawn:buried:56`）——
 *    从结果里删掉等于对用户撒谎。这个不对称是刻意的。
 */
export function SeedInfoPanel({ info }: { info: SeedInfo }) {
  const { t } = useTranslation();

  return (
    <div className="seed__info">
      <h4 className="seed__infotitle">{t('seedsPage.infoTitle')}</h4>

      <dl className="seed__infolist">
        <dt>{t('seedsPage.infoOverworld')}</dt>
        {/*
          主世界结构可以是 null —— 约 1.5% 的种子没有主世界结构，而那是
          **合法状态**，不是缺数据（见 shared/constants.ts 的注释）。
          所以这里说"无"，不说"未知"。
        */}
        <dd>
          {info.overworld === null ? t('seedsPage.infoNone') : structureLabel(info.overworld, t)}
        </dd>

        <dt>{t('seedsPage.infoNether')}</dt>
        <dd>{info.nether === null ? t('seedsPage.infoNone') : structureLabel(info.nether, t)}</dd>

        <dt>{t('seedsPage.infoEndTowers')}</dt>
        <dd>
          {info.endTowers.length === 0 ? (
            t('seedsPage.infoNone')
          ) : (
            <>
              {/* 这些是 Y 坐标，不是种子值 —— 所以它们可以安全地当成数字渲染 */}
              <span className="seed__towers">{info.endTowers.join(', ')}</span>
              <span className="mcsr-field__hint">{t('seedsPage.endTowersHint')}</span>
            </>
          )}
        </dd>
      </dl>

      <div className="seed__variationlist">
        <span className="seed__valuelabel">{t('seedsPage.infoVariations')}</span>
        {info.variations.length === 0 ? (
          <p className="muted">{t('seedsPage.infoNoVariations')}</p>
        ) : (
          <>
            {/*
              去重：上游**自己**会给重复词条（实测那条 `biome:structure:plains`
              出现了两次，见 services/api/src/seeds/upstream.ts 的说明）。
              不去重的话界面上会出现两个一模一样的 chip，看起来像渲染 bug。
              （注意服务端刻意没有去重，因为"上游给了什么"是事实；
               去重是展示层的事，放在这里。）
            */}
            {[...new Set(info.variations)].map((variation) => (
              <span key={variation} className="seed__tag">
                {variation}
              </span>
            ))}
            <p className="mcsr-field__hint">{t('seedsPage.variationsRawNote')}</p>
          </>
        )}
      </div>
    </div>
  );
}
