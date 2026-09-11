/**
 * 一个标识函数（tagged template），唯一的用途是让编辑器把模板字符串当 SQL 高亮。
 *
 * 为什么 SQL 不放在独立的 .sql 文件里：
 *   迁移脚本要在**两种**模式下都能跑 ——
 *     · 开发期：`tsx src/import.ts`
 *     · 生产：esbuild 打包成单文件
 *   而 tsx 不认识 `.sql` 扩展名（`ERR_UNKNOWN_FILE_EXTENSION`），
 *   esbuild 的 `loader: { '.sql': 'text' }` 又只在构建期生效。
 *   两边配置不一致的后果，就是"本地能跑、构建后挂了"或者反过来 ——
 *   这类问题排查起来非常费时。
 *
 * 放进 .ts 里当模板字符串，两种运行方式天然一致，还省掉了模块声明文件。
 * 代价只是少了一点语法高亮 —— 而用 `sql` 标签正好把它补回来。
 */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): string {
  if (values.length > 0) {
    throw new Error('sql`` 只接受静态字符串，不接受插值 —— 迁移脚本里不要拼接变量');
  }
  return strings.join('');
}
