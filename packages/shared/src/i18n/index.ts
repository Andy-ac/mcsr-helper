import { en } from './en';
import { type TranslationSchema, zhCN } from './zh-CN';

export type { TranslationSchema };
export { en, zhCN };

export const resources = {
  'zh-CN': { translation: zhCN },
  en: { translation: en },
} as const;

/**
 * 把 schema 里的嵌套结构拍平成点号路径，得到全部合法 key。
 * 例如 `'nav.resources' | 'seed.invalid' | ...`
 */
type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends Record<string, unknown>
    ? Leaves<T[K], `${P}${K}.`>
    : `${P}${K}`;
}[keyof T & string];

export type TranslationKey = Leaves<TranslationSchema>;
