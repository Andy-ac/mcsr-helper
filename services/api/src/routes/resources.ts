/**
 * 资源库的公开读接口。
 *
 * M1 阶段**完全不需要登录** —— 这是访问模型（docs/v1-plan.md §0.1）的核心：
 * 浏览不设门槛，登录只在提交时才需要。所以这里没有任何鉴权中间件。
 *
 * 唯一需要防的是滥用，由 index.ts 里的全局限流负责。
 */
import { ResourceQuerySchema } from '@mcsr/shared/resources';
import { Hono } from 'hono';

import { getResource, listResources, listTopTags } from '../resources';

export const resourcesRoute = new Hono();

/**
 * 公开内容的缓存策略。
 *
 * ⚠️ 每个响应都必须显式带上 Cache-Control。
 * 什么都不设的话浏览器会启用启发式缓存 —— 我们已经在静态资源上踩过一次，
 * 症状是"改了没反应"。这里给一个短的公开缓存：条目内容一天也不会变几次，
 * 而 60 秒的窗口足以吸收掉列表页的重复请求。
 *
 * `stale-while-revalidate` 让浏览器在后台刷新时先拿旧数据，用户感觉不到等待。
 */
const PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=300';

/** 校验失败时把 Zod 的问题整理成人能读的形态，而不是把整个 error 对象吐出去。 */
function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((i) => ({
    field: i.path.map(String).join('.') || '(root)',
    message: i.message,
  }));
}

// ⚠️ `/tags` 必须注册在 `/:id` **之前**，否则 GET /tags 会被当成 id 为 "tags" 的条目。
resourcesRoute.get('/tags', (c) => {
  c.header('Cache-Control', PUBLIC_CACHE);
  return c.json({ tags: listTopTags() });
});

resourcesRoute.get('/', (c) => {
  const parsed = ResourceQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_query', issues: formatIssues(parsed.error) }, 400);
  }
  c.header('Cache-Control', PUBLIC_CACHE);
  return c.json(listResources(parsed.data));
});

resourcesRoute.get('/:id', (c) => {
  const resource = getResource(c.req.param('id'));
  if (!resource) {
    return c.json({ error: 'not_found' }, 404);
  }
  c.header('Cache-Control', PUBLIC_CACHE);
  return c.json(resource);
});
