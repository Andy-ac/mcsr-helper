/**
 * 006：本地上传的图片 + 给审核员的一句话。
 *
 * 两件事放在同一个迁移里，因为它们是同一次改动（M2 的第二轮）：
 * 配图不再必须是一个外部链接，而审核交流也不再只能靠驳回理由。
 */
export const m006UploadsAndNotes = `
  -- ---------------------------------------------------------------------
  -- 上传的图片
  -- ---------------------------------------------------------------------
  -- 主键就是内容的 sha256 —— **内容寻址**，不是自增 id。
  --
  -- 这样做的三个后果，每个都是想要的：
  --   1. 同一个文件重复上传只占一份空间（用户重试上传很常见）
  --   2. 文件名完全由内容决定，**没有任何用户可控的路径成分** ——
  --      路径穿越（../../etc/passwd）在这个形状下不可能构造出来
  --   3. URL 可以放心地设成永久缓存（内容变了 URL 就变了）
  CREATE TABLE uploads (
    id          TEXT    PRIMARY KEY,
    sha256      TEXT    NOT NULL,
    -- MIME 从**文件头**推出来并存下来，不是从扩展名推、也不是信客户端说的。
    -- 用户可能上传一个叫 .png 的 HTML，那个文件一旦被当成 text/html 提供出去，
    -- 就是一个在我们域名下执行的 XSS。
    mime        TEXT    NOT NULL,
    ext         TEXT    NOT NULL,
    size        INTEGER NOT NULL,
    uploader_id TEXT    REFERENCES users (id) ON DELETE SET NULL,
    created_at  INTEGER NOT NULL
  );

  -- 查"某个人传过什么"（配额、清理、事后追查都用得上）
  CREATE INDEX idx_uploads_uploader ON uploads (uploader_id, created_at DESC);

  -- ---------------------------------------------------------------------
  -- 给审核员的话
  -- ---------------------------------------------------------------------
  -- 提交/修改时可以附一句给审核员的话：为什么收录、哪里不确定、
  -- 上一轮被驳回的地方改了没有。
  --
  -- ⚠️ 它**不是正文的一部分**：不存在 resources 行上，永远不会出现在
  --    公开页面上。放在 revisions 上是对的 —— 它属于"这一次提交"，
  --    而不是属于"这个条目"。
  ALTER TABLE resource_revisions ADD COLUMN note_to_reviewer TEXT;
`;
