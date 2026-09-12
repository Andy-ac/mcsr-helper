/**
 * 登录状态与错误文案。
 *
 * ---------------------------------------------------------------------------
 * 为什么错误文案要按 "字段 + Zod 错误码" 映射，而不是直接显示服务端返回的字符串
 * ---------------------------------------------------------------------------
 * 服务端（services/api）的校验消息是**中文写死的**（`密码至少 8 位`）。
 * 直接把它显示出来，英文界面下就会突然冒出一句中文 —— 而且这种问题
 * 只在**出错时**才出现，正常路径的测试永远看不到它。
 *
 * 所以客户端把 Zod 的 `(path, code)` 翻译成当前语言的文案。
 * 服务端那句话仍然保留，但它的角色降级成了"给非界面的调用方看的兜底说明"。
 *
 * ⚠️ 这也意味着：**新增校验规则时要同步在这里加一条映射**，
 *    否则会退回显示服务端的中文原文。
 */

import type { UserSelf } from '@mcsr/shared/auth';
import { DISPLAY_NAME_MAX, DISPLAY_NAME_MIN, PASSWORD_MAX, PASSWORD_MIN } from '@mcsr/shared/auth';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, type FieldIssue, fetchMe } from '@/lib/api';

// ---------------------------------------------------------------------------
// 登录状态
// ---------------------------------------------------------------------------

interface AuthState {
  user: UserSelf | null;
  /** 只在**首次**确定登录状态时为 true。之后的刷新不应该让界面闪回"未登录"。 */
  loading: boolean;
  refresh: () => Promise<void>;
  /** 登录/注册/验证成功后就地把用户塞进去，省掉一次往返。 */
  setUser: (user: UserSelf | null) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserSelf | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user: me } = await fetchMe();
      setUser(me);
    } catch {
      /*
       * 拿不到就当作未登录，而且**不报错**。
       *
       * 这是刻意的降级：浏览全站本来就不需要登录（§0.1 的访问模型）。
       * 如果 API 临时抽风就把整站显示成错误页，那是把"登录态未知"
       * 放大成了"站点不可用"——而这两件事的严重程度差着量级。
       */
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({ user, loading, refresh, setUser }),
    [user, loading, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内使用');
  return ctx;
}

// ---------------------------------------------------------------------------
// 错误文案
// ---------------------------------------------------------------------------

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * 把一个字段级校验问题翻译成当前语言的文案。
 */
export function fieldIssueText(issue: FieldIssue & { code?: string }, t: Translate): string {
  const field = String(issue.field ?? '');
  switch (issue.code) {
    case 'too_small':
      if (field === 'password') return t('auth.err.passwordMin', { min: PASSWORD_MIN });
      if (field === 'displayName') return t('auth.err.nameMin', { min: DISPLAY_NAME_MIN });
      return t('auth.err.required');
    case 'too_big':
      if (field === 'password') return t('auth.err.passwordMax', { max: PASSWORD_MAX });
      if (field === 'displayName') return t('auth.err.nameMax', { max: DISPLAY_NAME_MAX });
      return t('auth.err.tooLong');
    case 'invalid_format':
    case 'invalid_string':
      if (field === 'email') return t('auth.err.emailFormat');
      return t('auth.err.invalid');
    case 'invalid_type':
      return t('auth.err.required');
    default:
      return t('auth.err.invalid');
  }
}

/**
 * 把请求失败映射成一条能给用户看的文案。
 *
 * 用 `error.code` 分支，**不用 message 文本** —— 后者一改文案就悄悄失效，
 * 而且是"测试全绿、线上文案变成英文"的那种失效。
 */
export function apiErrorText(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    // 字段级校验错误：显示第一条就够了。把所有字段的错误一次性堆出来
    // 只会让用户不知道该改哪一个。
    if (error.code === 'invalid_input' && error.issues?.[0]) {
      return fieldIssueText(error.issues[0] as FieldIssue & { code?: string }, t);
    }

    switch (error.code) {
      case 'invalid_credentials':
        return t('auth.invalidCredentials');
      case 'rate_limited':
        return t('auth.rateLimited', { seconds: error.retryAfterSec ?? 60 });
      case 'account_suspended':
        return t('auth.accountSuspended');
      case 'send_failed':
        return t('auth.sendFailed');
      case 'invalid_token':
        return t('auth.invalidToken');
      case 'email_not_verified':
        return t('auth.emailNotVerified');
      case 'unauthorized':
        return t('auth.loginAction');
      default:
        // 0 是"连不上 API"，那条 message 已经写得够具体了，直接用它
        return error.status === 0 ? error.message : t('auth.genericError');
    }
  }
  return t('auth.genericError');
}

/** 便捷 hook：省得每个组件都 import 一次 useTranslation 再包一层。 */
export function useApiErrorText(): (error: unknown) => string {
  const { t } = useTranslation();
  return useCallback((error: unknown) => apiErrorText(error, t as unknown as Translate), [t]);
}
