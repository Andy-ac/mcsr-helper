import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

/**
 * Markdown 渲染 —— **全站唯一的入口**。
 *
 * ⚠️ 它存在的唯一目的：让 `rehype-sanitize` 不可能被漏掉。
 *
 * 正文是用户提交的内容，而 react-markdown 默认允许原始 HTML ——
 * 不过滤的话，一个 `<img onerror=...>` 就能在每个访客的浏览器里执行脚本。
 *
 * 这段配置原本只写在资源详情页里。M2 之后要渲染正文的地方变成了四个
 * （详情页、提交预览、编辑页、审核对比），各抄一遍的结果是
 * "新加的那个页面忘了写 rehypePlugins" —— 而漏掉这一行**不会有任何报错**，
 * 只会静默地少一道防线，直到有人拿它打进来。
 *
 * 所以：渲染 Markdown 只走这里。
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          // 正文里的链接一律新窗口打开，并带上 noopener/noreferrer：
          // 否则被链接的页面能通过 window.opener 操作我们的页面。
          a: ({ href, children: kids }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {kids}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
