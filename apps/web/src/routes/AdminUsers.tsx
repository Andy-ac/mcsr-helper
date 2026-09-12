import {
  checkRoleChange,
  ROLE_LABEL_KEYS,
  type RoleChangeDenial,
  type UserRole,
} from '@mcsr/shared/permissions';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Notice } from '@/components/Form';
import { ApiError, changeUserRole, fetchAdminUsers } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useReview } from '@/lib/useReview';

interface Editing {
  id: string;
  /** 原来是什么角色 —— 取消时用它还原选择框 */
  from: UserRole;
  to: UserRole;
  reason: string;
}

/**
 * 账号管理 —— `/admin/users`。**只有 admin 看得到**（user.moderate）。
 *
 * ---------------------------------------------------------------------------
 * 三条规则在界面上必须看得出来，否则用户只会觉得"为什么这个框点不动"
 * ---------------------------------------------------------------------------
 *  1. **其他管理员的角色不能改** —— 管理员之间平级。所以那一行的选择框
 *     是禁用的，并且写明原因（不是灰色的谜题）。
 *  2. **自己的角色可以改** —— 自己降自己等于主动交出权限，不是权力扩张。
 *     但如果自己是最后一个管理员，服务端会挡住（否则系统再没人能改角色）。
 *  3. **改角色必须写理由** —— 服务端的 RoleChangeInputSchema 强制要求，
 *     理由会进审计日志。界面在这里就要收集，而不是让用户提交后被 400 弹回。
 *
 * ---------------------------------------------------------------------------
 * 为什么用 useReview 这个 hook
 * ---------------------------------------------------------------------------
 * 它实际上只是"取数 + 可重载"（名字来自它最初的用途）。这个页面需要
 * reload（改完角色要刷新列表），而 useAsync 没有。名字有点别扭，
 * 但比再抄一份同样的 hook 好。
 */
/** 每一种拒绝原因对应一句说明 —— 界面不能只说"不行"，要说"为什么不行"。 */
function lockHintKey(reason: RoleChangeDenial | undefined): string {
  switch (reason) {
    case 'owner_immutable':
      return 'admin.lockedOwner';
    case 'admin_self':
      return 'admin.lockedSelf';
    case 'admin_promote':
      return 'admin.lockedPromote';
    case 'admin_peer':
      return 'admin.lockedPeer';
    default:
      return 'admin.lockedGeneric';
  }
}

export function AdminUsers() {
  const { t } = useTranslation();
  const auth = useAuth();
  const { state, reload } = useReview((signal) => fetchAdminUsers(signal), []);

  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await changeUserRole(editing.id, editing.to, editing.reason.trim());
      setOkMessage(t('admin.roleChanged', { role: t(ROLE_LABEL_KEYS[editing.to]) }));
      setEditing(null);
      reload();
    } catch (err) {
      // 三种失败对用户意味着完全不同的下一步，所以分开说
      const code = err instanceof ApiError ? err.code : undefined;
      setError(
        code === 'admin_peer'
          ? t('admin.errPeer')
          : code === 'last_admin'
            ? t('admin.errLastAdmin')
            : code === 'invalid_input'
              ? t('admin.errReason')
              : t('admin.errFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (state.status === 'loading') return <p className="state">{t('common.loading')}</p>;

  if (state.status === 'error') {
    return (
      <>
        <header className="pagehead">
          <h1 className="pagehead__title">{t('admin.title')}</h1>
        </header>
        <Notice kind="bad">
          {state.error instanceof ApiError && state.error.status === 403
            ? t('admin.forbidden')
            : t('admin.loadFailed')}
        </Notice>
      </>
    );
  }

  const { items, total, roles } = state.data;

  return (
    <>
      <header className="pagehead">
        <div className="pagehead__row">
          <h1 className="pagehead__title">{t('admin.title')}</h1>
          <button type="button" className="ghostbtn" onClick={reload}>
            {t('review.refresh')}
          </button>
        </div>
        <p className="pagehead__sub">{t('admin.subtitle', { count: total })}</p>
      </header>

      {okMessage ? <Notice kind="ok">{okMessage}</Notice> : null}
      {error ? <Notice kind="bad">{error}</Notice> : null}

      <table className="admintable">
        <thead>
          <tr>
            <th>{t('admin.colAccount')}</th>
            <th>{t('admin.colVerified')}</th>
            <th>{t('admin.colCreated')}</th>
            <th>{t('admin.colRole')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((u) => {
            const isSelf = u.id === auth.user?.id;
            /*
             * 这一行的角色能不能改 —— **用服务端同一个函数判**（checkRoleChange）。
             *
             * ⚠️ 这里不是"界面再实现一遍规则"，而是读同一份定义：
             *    两边各写一遍的话，一定会出现"界面放行、服务端拒绝"
             *    （用户白填一遍）或者更糟的"界面禁用了、服务端其实没拦"（越权通道）。
             *
             * 前面那条注释说的"禁用一个框而不给理由，用户只会以为是界面坏了"
             * 依然成立 —— 所以下面每种拒绝原因都有对应的说明文字。
             */
            const judgement = checkRoleChange({
              actorRole: (auth.user?.role ?? 'user') as UserRole,
              targetRole: u.role,
              targetIsSelf: isSelf,
              // 判"能不能改这一行"时用任意一个不同的角色去试 ——
              // 真正决定权限的是 actor/target 的关系，nextRole 只影响
              // "自己降自己"和"升成管理员"这两条。这里取管理员的视图。
              nextRole: u.role === 'admin' ? 'editor' : 'admin',
            });
            const locked = !judgement.ok;
            const rowEditing = editing?.id === u.id;

            return (
              <tr key={u.id} className={rowEditing ? 'is-editing' : ''}>
                <td>
                  <div className="adminuser__name">
                    {u.displayName}
                    {isSelf ? (
                      <span className="badge badge--mine">{t('admin.selfBadge')}</span>
                    ) : null}
                  </div>
                  <div className="adminuser__email">{u.email}</div>
                </td>
                <td>
                  {u.emailVerified ? (
                    t('admin.yes')
                  ) : (
                    <span className="muted">{t('admin.no')}</span>
                  )}
                </td>
                <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                <td>
                  <select
                    className="mcsr-field__input"
                    value={rowEditing ? editing.to : u.role}
                    disabled={locked || busy}
                    onChange={(e) =>
                      setEditing({
                        id: u.id,
                        from: u.role,
                        to: e.target.value as UserRole,
                        reason: '',
                      })
                    }
                  >
                    {roles.map((r) => (
                      <option key={r} value={r}>
                        {t(ROLE_LABEL_KEYS[r])}
                      </option>
                    ))}
                  </select>

                  {locked ? (
                    <p className="mcsr-field__hint">{t(lockHintKey(judgement.reason))}</p>
                  ) : null}

                  {rowEditing ? (
                    <div className="adminrow__edit">
                      {/* 理由必填（服务端也强制）—— 它会进审计日志 */}
                      <input
                        className="mcsr-field__input mcsr-field__input--prose"
                        value={editing.reason}
                        onChange={(e) => setEditing({ ...editing, reason: e.target.value })}
                        placeholder={t('admin.reasonPlaceholder')}
                        maxLength={300}
                      />
                      <button
                        type="button"
                        className="cta"
                        disabled={busy || editing.reason.trim().length === 0}
                        onClick={() => void save()}
                      >
                        {busy ? t('admin.saving') : t('admin.save')}
                      </button>
                      <button
                        type="button"
                        className="ghostbtn"
                        disabled={busy}
                        onClick={() => {
                          setEditing(null);
                          setError(null);
                        }}
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/*
        最后管理员的保护是服务端的事，但界面必须**提前**说清楚 ——
        否则用户会在"为什么我不能把自己降级"上卡住。
      */}
      <p className="muted">{t('admin.lastAdminNote')}</p>
    </>
  );
}
