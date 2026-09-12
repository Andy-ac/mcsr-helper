/**
 * 011 的两个新维度：`level`（专业程度）与 `scope`（参与范围）。
 *
 * ---------------------------------------------------------------------------
 * 这个文件守的三件事
 * ---------------------------------------------------------------------------
 * 1. **筛选是"且"的语义**。三个单选维度各自等值匹配，叠加起来是 AND。
 *    标签（多选）是"任一命中"，两者语义不同 —— 把它们搞混的后果是
 *    "我筛了职业赛，结果业余的也出来了"，而那种错很难被看出来。
 * 2. **非法筛选值一律当"不限"，不能当"筛不到"**。查询参数是用户可以手打的，
 *    `?level=pro`（大小写错）如果被当成一个合法值原样送进 SQL，就会返回空集 ——
 *    看起来像"日历里没有这类赛事"，而库里明明有一条 PRO 的。
 *    宁可多给，也不要给一个**看起来像正确答案的**错误答案。
 * 3. **011 之前提交的待审快照仍然能审核通过**。老快照的 JSON 里**没有**
 *    这两个字段，直接取值会得到 `undefined`，而 node:sqlite 对 `undefined`
 *    绑参是**报错**的 —— 那条待审事件会在审批那一刻把整个动作炸掉，
 *    而报错信息指向绑参数量，和真正的原因（旧数据）毫无关系。
 */
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.MCSR_MAIL_DRIVER = 'console';
process.env.MCSR_SCRYPT_TEST_PARAMS = 'N=1024,r=8,p=1';

const { app } = await import('./index');
const { closeDb, getDb } = await import('./db');
const { resetAll } = await import('./auth/ratelimit');
const { SITE } = await import('@mcsr/shared');
const { CALENDAR_TYPE } = await import('./calendar/events');

const PASSWORD = 'a good long passphrase';

after(() => closeDb());
beforeEach(() => {
  resetAll();
  getDb().exec('DELETE FROM content_revisions');
  getDb().exec('DELETE FROM calendar_events');
});

async function call(
  method: string,
  path: string,
  options: { json?: unknown; cookie?: string } = {},
): Promise<{
  status: number;
  body: Record<string, unknown>;
  text: string;
  setCookie: string | null;
}> {
  const headers: Record<string, string> = { origin: SITE.productionOrigin };
  if (options.json !== undefined) headers['content-type'] = 'application/json';
  if (options.cookie) headers.cookie = options.cookie;

  const response = await app.request(path, {
    method,
    headers,
    ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    body: (() => {
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        return {};
      }
    })(),
    setCookie: response.headers.getSetCookie?.()[0] ?? null,
  };
}

let seq = 0;
async function makeUser(role: 'user' | 'reviewer' = 'user') {
  seq += 1;
  const email = `dim${String(seq)}.${Date.now()}@example.com`;
  await call('POST', '/api/auth/register', {
    json: { email, password: PASSWORD, displayName: `维度${String(seq)}`, locale: 'zh-CN' },
  });
  getDb()
    .prepare('UPDATE users SET email_verified_at = ?, role = ? WHERE email = ?')
    .run(Date.now(), role, email);
  const login = await call('POST', '/api/auth/login', { json: { email, password: PASSWORD } });
  return { email, cookie: (login.setCookie ?? '').split(';')[0] as string };
}

/** 一份合法入参。默认**不填**两个新维度（它们是可空的）。 */
function input(overrides: Record<string, unknown> = {}) {
  return {
    title: '维度测试赛事',
    startsAtLocal: '2030-09-05T16:00',
    startsAtTz: 'Asia/Shanghai',
    tags: ['TOURNAMENT'],
    ...overrides,
  };
}

async function submit(cookie: string, overrides: Record<string, unknown> = {}) {
  const res = await call('POST', '/api/calendar', { json: input(overrides), cookie });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id as string;
}

/** 提交并直接批准（走真实 HTTP 审核路由）。 */
async function publish(cookie: string, reviewer: string, overrides: Record<string, unknown> = {}) {
  const id = await submit(cookie, overrides);
  const ok = await call('POST', `/api/admin/review/calendar/${id}/approve`, { cookie: reviewer });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  return id;
}

/** 公开列表的 id 集合。 */
async function listedIds(query = ''): Promise<string[]> {
  const res = await call('GET', `/api/calendar?from=0${query}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return (res.body.items as Array<{ id: string }>).map((e) => e.id);
}

// ---------------------------------------------------------------------------

describe('★ 日历的两个新维度：迁移、往返与筛选', () => {
  it('迁移 011 的两列存在、可空、且默认是 NULL', () => {
    const cols = getDb().prepare('PRAGMA table_info(calendar_events)').all() as unknown as Array<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>;

    for (const name of ['level', 'scope']) {
      const col = cols.find((c) => c.name === name);
      assert.ok(col, `calendar_events 里应当有 ${name} 列`);
      assert.equal(col.notnull, 0, `${name} 必须可空 —— 排位节点没有这一维，硬填会逼人瞎填`);
      assert.equal(col.dflt_value, null, `${name} 不该有默认值（NULL 才是"没填"）`);
    }
  });

  it('提交时填了就能读回来；没填就是 null', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');

    const withDims = await publish(author.cookie, reviewer.cookie, {
      title: '有维度的',
      level: 'PRO',
      scope: 'GLOBAL',
    });
    const without = await publish(author.cookie, reviewer.cookie, { title: '没维度的' });

    const detail = await call('GET', `/api/calendar/${withDims}`);
    const event = detail.body.event as Record<string, unknown>;
    assert.equal(event.level, 'PRO');
    assert.equal(event.scope, 'GLOBAL');

    const plain = await call('GET', `/api/calendar/${without}`);
    const plainEvent = plain.body.event as Record<string, unknown>;
    assert.equal(plainEvent.level, null, '没填就是 null，不是空字符串');
    assert.equal(plainEvent.scope, null);
  });

  it('非法取值被 Zod 挡住 → 400（而不是静默存进去）', async () => {
    const author = await makeUser();

    for (const bad of [
      { level: 'pro' },
      { level: 'SEMI' },
      { scope: 'WORLD' },
      { level: 'PRO', scope: '国家' },
    ]) {
      const res = await call('POST', '/api/calendar', { json: input(bad), cookie: author.cookie });
      assert.equal(res.status, 400, `${JSON.stringify(bad)} 应当被拒：${JSON.stringify(res.body)}`);
      assert.equal(res.body.error, 'invalid_input');
    }
  });

  it('★ 筛选是等值匹配，三个维度叠加是 AND', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');

    const proGlobal = await publish(author.cookie, reviewer.cookie, {
      title: '职业全球',
      level: 'PRO',
      scope: 'GLOBAL',
    });
    const proCountry = await publish(author.cookie, reviewer.cookie, {
      title: '职业国家级',
      level: 'PRO',
      scope: 'COUNTRY',
    });
    const casualGlobal = await publish(author.cookie, reviewer.cookie, {
      title: '休闲全球',
      level: 'CASUAL',
      scope: 'GLOBAL',
    });

    // 只筛 level
    const onlyPro = await listedIds('&level=PRO');
    assert.ok(onlyPro.includes(proGlobal) && onlyPro.includes(proCountry));
    assert.ok(!onlyPro.includes(casualGlobal), '筛 PRO 不该把 CASUAL 带出来');

    // 只筛 scope
    const onlyGlobal = await listedIds('&scope=GLOBAL');
    assert.ok(onlyGlobal.includes(proGlobal) && onlyGlobal.includes(casualGlobal));
    assert.ok(!onlyGlobal.includes(proCountry));

    // 两个一起 = AND，只剩一条
    const both = await listedIds('&level=PRO&scope=GLOBAL');
    assert.deepEqual(both, [proGlobal], '三个维度叠加必须是"且"，不是"或"');
  });

  it('★ 非法筛选值当"不限"，**不能**当"筛不到"', async () => {
    /*
     * 这正是"一个看起来像正确答案的错误答案"那一类：
     * `?level=pro` 如果原样进 SQL，会返回空集，而用户会以为
     * "日历里没有职业赛" —— 库里明明有。宁可多给几条。
     */
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const id = await publish(author.cookie, reviewer.cookie, {
      title: '有维度的',
      level: 'PRO',
      scope: 'GLOBAL',
    });

    for (const bad of ['pro', 'SEMI', 'WORLD', '国家', '1']) {
      const ids = await listedIds(`&level=${encodeURIComponent(bad)}`);
      assert.ok(
        ids.includes(id),
        `level=${bad} 是非法值，应当当作"不限"（返回全部），而不是筛不到`,
      );
    }
    // 空串同样是不限
    assert.ok((await listedIds('&level=')).includes(id));
  });

  it('轮次（stage）现在也能筛，而且和另外两个维度一样是等值匹配', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');

    const final = await publish(author.cookie, reviewer.cookie, { title: '决赛', stage: 'FINAL' });
    const semi = await publish(author.cookie, reviewer.cookie, {
      title: '半决赛',
      stage: 'SEMIFINAL',
    });

    const finals = await listedIds('&stage=FINAL');
    assert.ok(finals.includes(final));
    assert.ok(!finals.includes(semi), '筛决赛不该把半决赛带出来');

    // 非法 stage 同样当不限
    assert.ok((await listedIds('&stage=nope')).includes(semi));
  });

  it('保留"没填"的事件：它们不会出现在任何单选维度里，但永远出现在"不限"里', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    // 排位节点这类事件本来就没有专业程度/参与范围
    const milestone = await publish(author.cookie, reviewer.cookie, {
      title: '排位节点',
      tags: ['RANKED_MILESTONE'],
    });

    assert.ok((await listedIds('')).includes(milestone), '不限的时候必须能看到它');

    for (const q of ['&level=PRO', '&level=CASUAL', '&scope=GLOBAL']) {
      const ids = await listedIds(q);
      assert.ok(
        !ids.includes(milestone),
        `${q} 是一个等值条件，没填这一维的事件不该匹配（而 \`= NULL\` 在 SQL 里本来就不成立）`,
      );
    }
  });

  it('★★ 011 之前提交的待审快照（JSON 里没有这两个字段）仍然能审核通过', async () => {
    /*
     * 这是本轮唯一一处**只有旧数据才能触发**的路径，所以必须显式造出来：
     * 直接写一条 payload 里缺 level/scope 的 content_revision，
     * 再把 pending_revision 指过去，然后走真实 HTTP 审核路由批准它。
     *
     * 没有 `?? null` 兜底的话，这里会在绑参时抛错，而错误信息是
     * "Wrong number of parameter bindings" 之类 —— 指向的是绑参数量，
     * 和真正的原因（旧快照缺字段）毫无关系。
     */
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const id = await submit(author.cookie, { title: '旧快照' });

    // 造一份 011 之前的形状：没有 level / scope
    const oldPayload = JSON.stringify({
      title: '旧快照（011 之前提交的）',
      titleEn: null,
      descriptionMd: '',
      startsAtLocal: '2030-09-05T16:00',
      startsAtTz: 'Asia/Shanghai',
      endsAtLocal: null,
      endsAtTz: null,
      allDay: false,
      url: null,
      location: null,
      tags: ['TOURNAMENT'],
      stage: null,
      lang: 'zh-CN',
    });
    getDb()
      .prepare(
        `INSERT INTO content_revisions
           (id, type, entity_id, revision, payload, status, editor_id, note_to_reviewer, created_at)
         VALUES (?, ?, ?, 2, ?, 'pending', NULL, NULL, ?)`,
      )
      .run('rev-old-shape', CALENDAR_TYPE, id, oldPayload, Date.now());
    getDb().prepare('UPDATE calendar_events SET pending_revision = 2 WHERE id = ?').run(id);

    const approved = await call('POST', `/api/admin/review/calendar/${id}/approve`, {
      cookie: reviewer.cookie,
    });
    assert.equal(approved.status, 200, `旧快照必须能批：${JSON.stringify(approved.body)}`);

    const detail = await call('GET', `/api/calendar/${id}`);
    const event = detail.body.event as Record<string, unknown>;
    assert.equal(event.title, '旧快照（011 之前提交的）', '内容应当来自那份旧快照');
    assert.equal(event.level, null, '旧快照缺的字段落成 NULL，而不是炸掉');
    assert.equal(event.scope, null);
  });

  it('ICS 的 CATEGORIES 带上两个新维度，而且不出现空项', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');

    await publish(author.cookie, reviewer.cookie, {
      title: 'ICS 维度',
      level: 'PRO',
      scope: 'COUNTRY',
      stage: 'FINAL',
    });

    const ics = await call('GET', '/api/calendar.ics');
    const line = ics.text.split('\r\n').find((l) => l.startsWith('CATEGORIES'));
    assert.ok(line, 'ICS 里应当有 CATEGORIES 行');
    assert.equal(
      line,
      'CATEGORIES:TOURNAMENT,FINAL,PRO,COUNTRY',
      `顺序是 标签 → 轮次 → 专业程度 → 参与范围，实际：${String(line)}`,
    );
    assert.ok(!line.includes(',,'), '不能出现空项（严格解析器会把带空项的值判为坏值）');
  });

  it('没填任一可选维度时，CATEGORIES 里不会多出空项', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    await publish(author.cookie, reviewer.cookie, { title: '只有标签' });

    const ics = await call('GET', '/api/calendar.ics');
    const line = ics.text.split('\r\n').find((l) => l.startsWith('CATEGORIES'));
    assert.equal(line, 'CATEGORIES:TOURNAMENT');
  });
});
