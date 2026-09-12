/**
 * 把 shared/permissions.ts 的能力名接到界面上。
 *
 * 能力名是 `<类型>.<动作>` 的形式，所以标签由两段拼接而成 ——
 * 这样 M4 新增能力（比如 calendar.review）时**不需要加任何词条**，
 * 界面自动就有了。给每个能力单写一条文案的话，
 * 加了能力忘了加词条，界面上就会出现一个空白标签，
 * 而且这种遗漏不会有任何东西提醒你。
 */
import type { Capability } from '@mcsr/shared/permissions';

export interface CapabilityGroup {
  type: string;
  label: string;
  actions: { capability: Capability; label: string }[];
}

type Translate = (key: string) => string;

/** 类型名 → 词条 key。表里没有的走兜底，宁可显示英文名也不要显示空白。 */
const TYPE_KEYS: Record<string, string> = {
  resource: 'auth.capTypeResource',
  calendar: 'auth.capTypeCalendar',
  video: 'auth.capTypeVideo',
  seed: 'auth.capTypeSeed',
  user: 'auth.capTypeUser',
  audit: 'auth.capTypeAudit',
};

/** 动作名 → 词条 key。 */
const ACTION_KEYS: Record<string, string> = {
  submit: 'auth.capActionSubmit',
  editOwn: 'auth.capActionEditOwn',
  review: 'auth.capActionReview',
  moderate: 'auth.capActionModerate',
  read: 'auth.capActionRead',
};

export function describeCapabilities(
  grouped: Record<string, Capability[]>,
  t: Translate,
): CapabilityGroup[] {
  return Object.entries(grouped).map(([type, caps]) => ({
    type,
    // ⚠️ 兜底用类型名本身（英文），而不是空字符串或 '?'。
    //    空白标签会让人以为界面坏了，而英文名至少能读懂是什么。
    label: TYPE_KEYS[type] ? t(TYPE_KEYS[type]) : type,
    actions: caps.map((cap) => {
      const action = cap.split('.')[1] ?? cap;
      return {
        capability: cap,
        label: ACTION_KEYS[action] ? t(ACTION_KEYS[action]) : action,
      };
    }),
  }));
}
