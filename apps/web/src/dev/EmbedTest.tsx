import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import './embed-test.css';

/**
 * 一次性的嵌入自检页（TEMP —— 验证完就可以删掉这个目录）。
 *
 * 为什么必须放在生产域名下测：
 *   浏览器是否发送 Referer 取决于**加载页面的 origin 与策略**，
 *   在 file:// 或本地随便起个服务里测，结论对线上毫无参考价值。
 *
 * 为什么用**普通 iframe**而不是 YouTube IFrame API / Twitch JS API：
 *   1. 生产方式就是普通 iframe（见 docs/v1-plan.md §5）；
 *   2. 那两套 JS API 需要放宽 Caddy 的 `script-src`（当前是 'self'），
 *      而生产环境根本不需要加载它们 —— 为了测试放宽生产策略是本末倒置。
 *   所以这里测的**就是生产将要跑的东西**。
 */

type Probe = {
  state: 'measuring' | 'done';
  referer: string;
  suppressed: boolean;
};

const DEFAULTS = {
  // bilibili 官方播放器文档里用的示例视频
  bilibili: 'BV1B7411m7LV',
  // 一个众所周知允许嵌入的视频，仅作连通性测试，换成你想测的即可
  youtube: 'dQw4w9WgXcQ',
  // Twitch 用**频道名**而不是 VOD ID：VOD 会过期，频道不会。
  // （第一版填的是你数据库 MatchVod 表里的 2457619433，那个 VOD 是 2025-05 的，早就失效了）
  twitch: 'twitchdev',
};

/** 纯数字 → VOD；其他 → 频道名。 */
function isVodId(value: string) {
  return /^\d+$/.test(value.trim());
}

export function EmbedTest() {
  const host = globalThis.location.hostname;
  const [probe, setProbe] = useState<Probe>({ state: 'measuring', referer: '', suppressed: false });
  const [headers, setHeaders] = useState<Record<string, string>>({});
  const [ids, setIds] = useState(DEFAULTS);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const probeRef = useRef<HTMLIFrameElement>(null);

  // ① 读自己页面的响应头 —— CSP 和 Referrer-Policy 是决定嵌入能否工作的两个头
  useEffect(() => {
    fetch(globalThis.location.href, { method: 'GET', credentials: 'same-origin' })
      .then((r) => {
        const wanted = [
          'content-security-policy',
          'referrer-policy',
          'x-content-type-options',
          'x-frame-options',
        ];
        const found: Record<string, string> = {};
        for (const k of wanted) {
          const v = r.headers.get(k);
          if (v) found[k] = v;
        }
        setHeaders(found);
      })
      .catch(() => setHeaders({ error: '无法读取响应头' }));
  }, []);

  // ② 探针结果：主路径是探针主动 postMessage 上报，不依赖读取时机。
  //    第一版只在 iframe 的 load 事件里读 DOM，而探针当时是异步写数据的，
  //    于是永远读到空值 —— 报出"没有发送 Referer"的假阴性（而 YouTube 其实正常）。
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; referer?: string } | null;
      if (!data || data.type !== 'mcsr-referer-probe') return;
      const ref = typeof data.referer === 'string' ? data.referer : '';
      setProbe({ state: 'done', referer: ref, suppressed: ref.length === 0 });
    };
    globalThis.addEventListener('message', onMessage);

    // 兜底：同源可直接读 DOM（探针现在同步写入，load 时已经就绪）
    const frame = probeRef.current;
    const readDom = () => {
      if (!frame) return;
      try {
        const ref = frame.contentDocument?.body?.dataset.referer ?? '';
        setProbe((prev) =>
          prev.state === 'done'
            ? prev
            : { state: 'done', referer: ref, suppressed: ref.length === 0 },
        );
      } catch {
        /* 忽略：主路径是 postMessage */
      }
    };
    frame?.addEventListener('load', readDom);

    return () => {
      globalThis.removeEventListener('message', onMessage);
      frame?.removeEventListener('load', readDom);
    };
  }, []);

  const urls = useMemo(
    () => ({
      bilibili: `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(ids.bilibili)}&autoplay=0&danmaku=false`,
      youtube: `https://www.youtube.com/embed/${encodeURIComponent(ids.youtube)}`,
      // ⚠️ Twitch 有两个容易踩的点：
      //   1. parent 是**必填**，必须是实际承载页面的域名（localhost 开发时就是 "localhost"）
      //   2. VOD 的 video 参数**必须带 "v" 前缀**。官方文档原文：
      //      "In this context (the video player), the video ID must have a 'v' prefix."
      //      漏了前缀不会报参数错误，播放器只会显示不出来。
      twitch: isVodId(ids.twitch)
        ? `https://player.twitch.tv/?video=v${encodeURIComponent(ids.twitch.trim())}&parent=${encodeURIComponent(host)}&autoplay=false`
        : `https://player.twitch.tv/?channel=${encodeURIComponent(ids.twitch.trim())}&parent=${encodeURIComponent(host)}&autoplay=false`,
    }),
    [ids, host],
  );

  const onLoaded = useCallback((key: string) => {
    setLoaded((prev) => (prev[key] === true ? prev : { ...prev, [key]: true }));
  }, []);

  const csp = headers['content-security-policy'] ?? '';
  const frameSrc = csp.match(/frame-src ([^;]+)/)?.[1] ?? '';
  const frameSrcOk = ['youtube.com', 'player.twitch.tv', 'player.bilibili.com'].every((d) =>
    frameSrc.includes(d),
  );

  return (
    <div className="et">
      <header className="et__head">
        <h1>嵌入自检 / Embed smoke test</h1>
        <p>
          一次性页面，用来亲眼确认三个平台的官方播放器能不能在应用里播。
          <strong> 结论以你眼睛看到的画面为准</strong>，下面的状态只是辅助。
        </p>
        <span className="et__temp">TEMP · 验证完可删除 apps/web/src/dev/</span>
      </header>

      {/* ---------------- 诊断 ---------------- */}
      <section className="et__section">
        <h2>1 · 环境诊断</h2>
        <dl className="et__diag">
          <dt>origin</dt>
          <dd>{globalThis.location.origin}</dd>

          <dt>运行环境</dt>
          <dd>
            {'mcsr' in globalThis ? 'Electron 桌面壳' : '浏览器'}
            {' · '}
            {globalThis.navigator.userAgent.slice(0, 70)}…
          </dd>

          <dt>Referrer-Policy</dt>
          <dd
            className={
              headers['referrer-policy'] === 'strict-origin-when-cross-origin'
                ? 'et__good'
                : 'et__bad'
            }
          >
            {headers['referrer-policy'] ?? '（未读到）'}
            {headers['referrer-policy'] === 'strict-origin-when-cross-origin'
              ? '   ✅ YouTube 要求的取值'
              : headers['referrer-policy']
                ? '   ⚠️ 不是 YouTube 推荐值 —— 若为 no-referrer / same-origin 会导致 Error 153'
                : ''}
          </dd>

          <dt>Referer 探针</dt>
          <dd className={probe.state !== 'done' ? '' : probe.suppressed ? 'et__bad' : 'et__good'}>
            {probe.state === 'measuring'
              ? '测量中…'
              : probe.suppressed
                ? '❌ 浏览器没有发送 Referer —— YouTube 一定会报 Error 153'
                : `✅ 已发送：${probe.referer}`}
          </dd>

          <dt>CSP frame-src</dt>
          <dd className={frameSrcOk ? 'et__good' : 'et__bad'}>
            {frameSrc || '（CSP 里没有 frame-src）'}
            {frameSrcOk
              ? '   ✅ 三个平台齐全'
              : '   ❌ 缺少平台 —— 对应的视频会被 CSP 拦掉且界面上没有任何提示'}
          </dd>
        </dl>
      </section>

      {/* ---------------- 三个嵌入 ---------------- */}
      <section className="et__section">
        <h2>2 · 三个平台</h2>
        <div className="et__grid">
          <Panel
            name="YouTube"
            state={loaded.youtube}
            note="Error 153 = Referer 缺失；101/150 = 视频作者禁止嵌入（不是你的问题）"
          >
            <IdRow
              label="视频 ID"
              value={ids.youtube}
              placeholder="11 位 ID"
              onChange={(v) => setIds((s) => ({ ...s, youtube: v }))}
            />
            <div className="et__frame">
              <iframe
                key={urls.youtube}
                src={urls.youtube}
                title="youtube embed"
                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                onLoad={() => onLoaded('youtube')}
              />
            </div>
          </Panel>

          <Panel
            name="Twitch"
            state={loaded.twitch}
            note={`parent 已自动填为当前域名。纯数字 = VOD（会自动补上官方要求的 "v" 前缀）；其他 = 频道名。Twitch 要求最小 400×300，播放需要手动点一下。频道离线时播放器仍会正常渲染，那也说明嵌入是通的。`}
          >
            <IdRow
              label="频道 / VOD"
              value={ids.twitch}
              placeholder="频道名，或 VOD 数字 ID"
              onChange={(v) => setIds((s) => ({ ...s, twitch: v }))}
            />
            {/* 实时显示最终生成的 URL —— 参数拼错时一眼就能看出来 */}
            <p
              className="et__notes"
              style={{ listStyle: 'none', paddingLeft: 0, wordBreak: 'break-all' }}
            >
              {urls.twitch}
            </p>
            <div className="et__frame">
              <iframe
                key={urls.twitch}
                src={urls.twitch}
                title="twitch embed"
                allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                allowFullScreen
                onLoad={() => onLoaded('twitch')}
              />
            </div>
          </Panel>

          <Panel
            name="bilibili"
            state={loaded.bilibili}
            note="官方未说明桌面 WebView 场景，所以这是三个里最不确定的一个。画质受登录状态限制，能看到画面就说明嵌入本身没问题。"
          >
            <IdRow
              label="BV 号"
              value={ids.bilibili}
              placeholder="BV1..."
              onChange={(v) => setIds((s) => ({ ...s, bilibili: v }))}
            />
            <div className="et__frame">
              <iframe
                key={urls.bilibili}
                src={urls.bilibili}
                title="bilibili embed"
                scrolling="no"
                allowFullScreen
                onLoad={() => onLoaded('bilibili')}
              />
            </div>
          </Panel>
        </div>
      </section>

      {/* ---------------- 判断标准 ---------------- */}
      <section className="et__section">
        <h2>3 · 怎么判断</h2>
        <div className="et__check">
          <h3>合格标准（三个都要满足）</h3>
          <ol>
            <li>
              <b>能看到播放器界面</b>（封面 + 播放按钮），不是纯黑或纯白方块
            </li>
            <li>
              <b>点播放能出声出画面</b> —— 这一步不能省，只有真正解码播放才算通过
            </li>
            <li>
              <b>在 Electron 桌面壳里再测一遍</b>（<code>pnpm dev</code>）， 且{' '}
              <code>pnpm dev</code> 与浏览器结果一致
            </li>
          </ol>

          <h3 style={{ marginTop: 18 }}>看到错误时怎么读</h3>
          <table className="et__table">
            <thead>
              <tr>
                <th>现象</th>
                <th>含义</th>
                <th>处理</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Error 153</td>
                <td>播放器没收到 Referer</td>
                <td>检查上文「Referer 探针」和响应头；不要用 file:// 加载</td>
              </tr>
              <tr>
                <td>Error 101 / 150</td>
                <td>视频作者禁止嵌入</td>
                <td>换一个视频 ID 再试，**不是**你的配置问题</td>
              </tr>
              <tr>
                <td>纯黑 / 空白</td>
                <td>CSP 拦掉了 iframe</td>
                <td>看控制台是否有 CSP 报错；对照上面 frame-src</td>
              </tr>
              <tr>
                <td>Twitch「请到 Twitch 观看」</td>
                <td>parent 参数不匹配</td>
                <td>确认 parent 等于地址栏的域名（含 localhost）</td>
              </tr>
              <tr>
                <td>Twitch 播放器全黑 / 不出来</td>
                <td>VOD 的 video 参数漏了 "v" 前缀，或该 VOD 已过期</td>
                <td>
                  页面上的 URL 已经自动补 "v"；若仍不显示，多半是 <b>VOD 已被 Twitch 删除</b>
                  （普通主播的 回放只保留 14–60 天）—— 换成频道名再试
                </td>
              </tr>
              <tr>
                <td>bilibili 空白</td>
                <td>官方未覆盖桌面 WebView</td>
                <td>记下来，M1–M6 把它放在 feature flag 后面</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 离屏探针 iframe */}
      <iframe
        ref={probeRef}
        className="et__probe"
        src="/referer-probe.html"
        title="referer probe"
      />
    </div>
  );
}

function Panel({
  name,
  state,
  note,
  children,
}: {
  name: string;
  state: boolean | undefined;
  note: string;
  children: ReactNode;
}) {
  const cls = state === undefined ? 'et__panel' : state ? 'et__panel et__panel--pass' : 'et__panel';
  return (
    <article className={cls}>
      <div className="et__panelhead">
        <span className="et__platform">{name}</span>
        <span className={`et__state${state ? ' et__state--ok' : ''}`}>
          {state ? 'iframe 已加载' : '等待加载…'}
        </span>
      </div>
      {children}
      <p className="et__notes" style={{ listStyle: 'none', paddingLeft: 0 }}>
        {note}
      </p>
    </article>
  );
}

function IdRow({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="et__idrow">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        // 和 SeedInput 同样的理由：长数字串（Twitch VOD ID）不要用 type="number"
        inputMode="text"
        spellCheck={false}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
