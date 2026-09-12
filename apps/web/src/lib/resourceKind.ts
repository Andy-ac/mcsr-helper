/**
 * 资源库「类型」的显示 —— **全站唯一一处**。
 *
 * ---------------------------------------------------------------------------
 * 为什么要有这个文件（一个静默出错的真实教训）
 * ---------------------------------------------------------------------------
 * 加 `'video'` 这个 kind 之前，界面上有 **5 处**写的是二元三元式：
 *
 *     {item.kind === 'tool' ? t('resources.kindTool') : t('resources.kindWebsite')}
 *
 * （`ResourceCard` / `ResourceDetail` ×2 / `Favorites` / `ResourceReviewView`）
 *
 * 这 5 处**不会**因为多了一个 kind 而报错：三元式永远能求值，
 * 视频条目会被**安静地显示成"网站"**。没有异常、没有类型错误、
 * 没有测试会红 —— 只有用户看到"视频"条目上挂着"网站"两个字。
 *
 * 所以现在收成一处：**新增 kind 时，`switch` 少一个分支会编译不过**
 * （函数声明返回 `string`，但下面的 switch 覆盖了全部 `ResourceKind`，
 * 少一个分支时 TypeScript 会指出 `kind` 未被完全处理）。
 *
 * ⚠️ 而"显示成什么"这件事本身也有个决定：**未知取值不要伪装成"网站"**。
 *    兜底返回原始值（`video`），因为它诚实 —— 显示一个英文单词虽然不好看，
 *    但它指向的是真的问题；显示"网站"则是在撒谎，而且没人会发现。
 */
import { RESOURCE_KINDS, type ResourceKind } from '@mcsr/shared';

type Translate = (key: string) => string;

/** kind → 词条 key。**新增 kind 时这里会编译不过**（`Record` 是穷尽的）。 */
const KIND_KEYS: Record<ResourceKind, string> = {
  website: 'resources.kindWebsite',
  tool: 'resources.kindTool',
  video: 'resources.kindVideo',
};

/**
 * 把一个 kind 翻成人话。
 *
 * ⚠️ 入参是 `string` 而不是 `ResourceKind`：调用点的类型来自接口响应，
 *    而接口在版本错配时可能给出一个我们不认识的 kind。那种情况下
 *    兜底返回原始值，而不是硬塞一个已知的标签。
 */
export function resourceKindLabel(kind: string, t: Translate): string {
  const key = KIND_KEYS[kind as ResourceKind];
  return key ? t(key) : kind;
}

/**
 * 「视频资料」这个类型要不要在详情页里**嵌播放器**。
 *
 * 判断依据是"这个 URL 能不能解析成一个受支持的视频链接" ——
 * 也就是说，把 kind 设成 video 但贴了一个普通网页链接的条目，
 * 会退化成一条普通资源（一个外链），而不是一个**空白的播放器框**。
 *
 * ⚠️ 这里不 import `parseVideoUrl`：这个文件被列表页/收藏页/审核视图共用，
 *    而它们都不需要视频解析。真正的解析在 `ResourceVideoEmbed` 里做，
 *    这个函数只回答"该不该去试"。
 */
export function kindMightEmbedVideo(kind: string): boolean {
  return kind === 'video';
}

/** 类型筛选标签用的顺序 —— 和 `RESOURCE_KINDS` 一致，别在界面里另写一份。 */
export const RESOURCE_KIND_ORDER = RESOURCE_KINDS;
