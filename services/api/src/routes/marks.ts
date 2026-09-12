/**
 * 个人标记接口：收藏 / 备注 / 评分。
 *
 * ---------------------------------------------------------------------------
 * 权限：**登录即可**，不要求邮箱验证
 * ---------------------------------------------------------------------------
 * 邮箱验证那道闸门是为"发布**公开**内容"设的（提交、修改、审核）——
 * 它要保证每条公开内容背后有一个可达的人。
 *
 * 而收藏、备注、评分是**私人的、低风险的**：备注只有自己看得到，
 * 评分最多影响一个平均值（而且展示的是平均值和人数，不是单个人的分）。
 * 拿同样一道闸门去挡它，只会让新用户的第一件事变成"去邮箱点个链接"，
 * 而收益是零。
 *
 * ⚠️ 备注绝不出现在任何**别人能看到**的响应里 —— 见 marks.ts 的说明。
 */
import { MarksInputSchema } from '@mcsr/shared/resources';
import { Hono } from 'hono';
import { type AuthVariables, requireAuth } from '../auth/middleware';
import { getMarks, listFavorites, setMarks } from '../marks';
import { resourceExists } from '../resources';

export const marksRoute = new Hono<{ Variables: AuthVariables }>();

/** 读我对某条内容的标记。没登录也能调，但只会拿到空标记。 */
marksRoute.get('/resources/:id/marks', async (c) => {
  const id = c.req.param('id');
  if (!resourceExists(id)) return c.json({ error: 'not_found' }, 404);

  const user = c.get('user');
  c.header('Cache-Control', 'no-store');
  return c.json({ marks: user ? getMarks(user.id, id) : null });
});

/** 写标记。三个字段都可选，只改传了的那个。 */
marksRoute.put('/resources/:id/marks', requireAuth, async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const id = c.req.param('id');
  if (!resourceExists(id)) return c.json({ error: 'not_found' }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = MarksInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', reason: 'bad_marks' }, 400);
  }

  const marks = setMarks(user.id, id, parsed.data, Date.now());
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, marks });
});

/** 我的收藏列表（含备注与评分）。 */
marksRoute.get('/me/favorites', requireAuth, (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const rows = listFavorites(user.id);
  c.header('Cache-Control', 'no-store');
  return c.json({
    items: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      url: r.url,
      imageUrl: r.image_url,
      summary: r.summary,
      published: r.status === 'published',
      marks: {
        favorite: r.favorite === 1,
        note: r.note,
        rating: r.rating,
        updatedAt: r.updated_at,
      },
    })),
  });
});
