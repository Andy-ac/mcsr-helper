import type { ResourceDetail } from '@mcsr/shared/resources';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { updateResourceFlags, updateResourceVisibility } from '@/lib/api';
import { useCan } from '@/lib/capabilities';

/**
 * 内容治理条：精选 / 官方 / 下架。
 *
 * 它和「修改」是两件不同的事：
 *   · 修改 → 提一份改动，**走审核**，通过之前线上一个字不变；
 *   · 治理 → 直接决定这条内容**以什么姿态出现在站上**（推荐吗？还在吗？）。
 * 所以它单独一个组件、单独一套权限，不混进编辑流程里。
 *
 * ⚠️ 为什么状态放在这个组件里，而不是提到详情页：
 *    治理动作的结果（新的 featured / status）服务端已经返回了，而详情页的
 *    数据来自 useAsync（没有 reload）。把状态收在这里 = 不用重拉整个页面，
 *    也不会出现"点了没反应"—— 服务端说什么就是什么，立刻反映在按钮上。
 */
export function ModerationBar({ resource }: { resource: ResourceDetail }) {
  const { t } = useTranslation();
  const canFeature = useCan('resource.feature');
  const canModerate = useCan('resource.moderate');

  const [featured, setFeatured] = useState(resource.featured);
  const [official, setOfficial] = useState(resource.official);
  const [hidden, setHidden] = useState(resource.status === 'hidden');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 两个能力都没有的人不该看到这条 —— 返回 null 而不是渲染一个空盒子
  if (!canFeature && !canModerate) return null;

  async function toggleFlag(key: 'featured' | 'official', next: boolean) {
    setBusy(key);
    setError(null);
    try {
      await updateResourceFlags(resource.id, { [key]: next });
      if (key === 'featured') setFeatured(next);
      else setOfficial(next);
    } catch {
      setError(t('moderate.failed'));
    } finally {
      setBusy(null);
    }
  }

  async function toggleVisibility(next: boolean) {
    setBusy('visibility');
    setError(null);
    try {
      const res = await updateResourceVisibility(resource.id, next);
      setHidden(res.status !== 'published');
    } catch {
      setError(t('moderate.failed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="moderatebar">
        <span className="moderatebar__label">{t('moderate.title')}</span>

        {canFeature ? (
          <>
            <button
              type="button"
              className={featured ? 'tagchip tagchip--on' : 'tagchip'}
              disabled={busy !== null}
              onClick={() => void toggleFlag('featured', !featured)}
            >
              {t('resources.featured')}
            </button>
            <button
              type="button"
              className={official ? 'tagchip tagchip--on' : 'tagchip'}
              disabled={busy !== null}
              onClick={() => void toggleFlag('official', !official)}
            >
              {t('resources.official')}
            </button>
          </>
        ) : null}

        {canModerate ? (
          hidden ? (
            <button
              type="button"
              className="ghostbtn"
              disabled={busy !== null}
              onClick={() => void toggleVisibility(true)}
            >
              {t('moderate.restore')}
            </button>
          ) : (
            <button
              type="button"
              className="dangerbtn"
              disabled={busy !== null}
              onClick={() => void toggleVisibility(false)}
            >
              {t('moderate.hide')}
            </button>
          )
        ) : null}

        {error ? <span className="fielderr">{error}</span> : null}
      </section>

      {/*
        下架之后**必须**说清楚它现在不在站上，并给出恢复入口。
        不说的话，编辑者会以为"点了没反应"—— 页面还在、内容也还在显示，
        而他刚做的决定其实已经生效了。
      */}
      {hidden ? (
        <>
          <p className="submitnote">{t('moderate.hiddenNote')}</p>
          <p className="muted">
            <Link to="/resources">{t('resources.backToList')}</Link>
            {' · '}
            {/* 列表页的「显示已下架」开关就是为这一刻准备的 —— 否则下架之后
                编辑者再也找不到这条内容，那不是下架，是一条单向的路。 */}
            {t('moderate.showHidden')}
          </p>
        </>
      ) : null}
    </>
  );
}
