import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { em } from '@/components/Emphasis';
import { LiveCard } from '@/components/LiveCard';
import { LiveManagePanel } from '@/components/LiveManagePanel';
import { fetchLiveChannels, fetchLiveChannelsFresh } from '@/lib/api';
import { useCan } from '@/lib/capabilities';
import { useAsync } from '@/lib/useAsync';

/**
 * 「直播」—— `/live`。一份**编辑维护的 MCSR streamer 名单**。
 *
 * ---------------------------------------------------------------------------
 * 它和「娱乐视频」的分工（两个板块都是"视频"，所以必须说清）
 * ---------------------------------------------------------------------------
 *   · `/videos` 娱乐视频：**rolling** —— 任何登录用户都能贴，贴了就可见，
 *     内容一直在变（Q6）。
 *   · `/live` 直播：**比较固定** —— 一份少数人维护的名单，变动很慢。
 *
 * 形态不同，权限形状也就不同：那边是 UGC（`video.submit`），
 * 这边是编辑维护（只有 `live.manage`）。服务端也只有这一个能力，
 * 没有 `live.submit` —— 详见 `services/api/src/routes/live.ts` 的头注释。
 *
 * ---------------------------------------------------------------------------
 * ★ 这一页**不检测直播状态**（这是设计里明确排除的）
 * ---------------------------------------------------------------------------
 * 没有 API key、不轮询，所以：
 *   · **没有「直播中」标记**。加了它就得有人维护它的真假，而"某人在播
 *     界面却什么都不显示"是用户一周之内就会发现的谎；
 *   · 页面上有一句话明说"这里记的是频道，不是现在谁在播"（`live.recordsChannels`）。
 *     那句话是这一页**能一直保持诚实的唯一原因** —— 只要它还在，
 *     就不会有人指望这一页告诉他谁在线。
 *
 * ---------------------------------------------------------------------------
 * 编辑界面挂在同一页上，不是一条独立路由
 * ---------------------------------------------------------------------------
 * 判据是权限（`live.manage`，editor 及以上），和侧边栏、服务端读的是
 * **同一个权限矩阵**。放在同一页的理由见 `LiveManagePanel` 的文件头。
 */
export function Live() {
  const { t } = useTranslation();
  const canManage = useCan('live.manage');

  /*
   * 公开列表的刷新钥匙：编辑改完之后要通过它重新拉一次，
   * 否则编辑会看到"我加的东西没出现"，然后怀疑自己没保存成功。
   */
  const [refreshKey, setRefreshKey] = useState(0);

  /*
   * ⚠️ 编辑和访客拿这个列表的方式**必须不一样**：
   *   · 访客：`fetchLiveChannels` —— 吃那条 60 秒的公共缓存（名单变动很慢，应当缓存）；
   *   · 编辑：`fetchLiveChannelsFresh` —— 绕开缓存。
   *
   *    不分开的话，"改完刷一次"刷出来的就是编辑自己浏览器里那份旧的，
   *    表现是"我明明隐藏了，公开列表里怎么还有"（详见 `fetchLiveChannelsFresh`
   *    的注释和里面的实测数据）。下面那个 refreshKey 存在的**全部意义**
   *    就是让编辑看到改动生效，所以那条路上不能吃缓存 —— 否则这个 key 等于没有。
   */
  const list = useAsync(
    (signal) => (canManage ? fetchLiveChannelsFresh(signal) : fetchLiveChannels(signal)),
    [refreshKey, canManage],
  );

  return (
    <>
      <header className="pagehead">
        <h1 className="pagehead__title">{t('live.title')}</h1>
        <p className="pagehead__sub">{t('live.subtitle')}</p>
      </header>

      {/*
        ★ 这两句话放在列表**前面**，不是后面。
        它们是这一页的"说明书"：上面那句防止有人以为这里有"直播中"功能，
        下面那句防止有人以为它和娱乐视频是重复的。
        放在列表后面的话，只有滚到底的人才读得到 —— 而那时他已经
        对"为什么没有直播中标记"形成了自己的猜测。
      */}
      <p className="live__explain">{em(t('live.recordsChannels'))}</p>
      <p className="live__explain live__explain--muted">{t('live.relationToVideos')}</p>

      {list.status === 'loading' ? <p className="state">{t('common.loading')}</p> : null}

      {list.status === 'error' ? (
        <div className="state state--error">
          <p>
            {t('live.loadFailed')}：{list.error}
          </p>
        </div>
      ) : null}

      {list.status === 'ok' ? (
        list.data.items.length === 0 ? (
          /*
           * ⚠️ 空状态要读起来像"还没有记录"，**不是**"出错了"。
           *    这份名单本来就可能只有几条、甚至一条都没有（它刚上线时就是这样），
           *    而一个写着"加载失败"的空状态会让人来问我们是不是坏了。
           */
          <div className="state state--empty">
            <p className="state__title">{t('live.empty')}</p>
            <p className="state__hint">{t('live.emptyHint')}</p>
          </div>
        ) : (
          <ul className="live-list">
            {list.data.items.map((channel) => (
              <LiveCard key={channel.id} channel={channel} />
            ))}
          </ul>
        )
      ) : null}

      {/*
        编辑界面：**同一页**，用权限决定显不显示（和「提交」长在各自版块里
        是同一条约定 —— 见 components/Layout.tsx 里那段注释）。
        界面判断只影响"显不显示"，不是安全边界：真正的拦截在服务端的
        `requireCapability('live.manage')`，手动发请求会得到 403。
      */}
      {canManage ? <LiveManagePanel onChanged={() => setRefreshKey((k) => k + 1)} /> : null}
    </>
  );
}
