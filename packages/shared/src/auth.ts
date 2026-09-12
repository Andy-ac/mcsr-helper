/**
 * 账号相关的数据契约 —— 前后端共用。
 *
 * ---------------------------------------------------------------------------
 * 访问模型（docs/v1-plan.md §0.1）决定了两件事
 * ---------------------------------------------------------------------------
 * 1. **浏览完全不需要登录**，所以注册/登录接口只服务于"要提交内容的人"。
 *    这也意味着登录页不是入口，不做什么"未登录时全站跳登录"。
 *
 * 2. **邮箱验证只挡"提交"，不挡"登录"。**
 *    这是一个刻意的选择：如果验证挡在注册上，邮件一发不出去（大陆三大邮箱的
 *    过滤策略我们控制不了），用户就被**完全挡在门外**，连浏览都受影响。
 *    挡在提交上则最坏情况是"能看不能发"，而那是可以接受的降级。
 *    参见 docs/v1-plan.md §9.2 末尾的后备方案。
 */
import { z } from 'zod';
import { LOCALES } from './constants';

/**
 * 重新导出这两个类型，让 `@mcsr/shared/auth` 成为账号相关类型的**唯一入口**。
 *
 * 否则后端要写两行 import（一个从 `@mcsr/shared` 拿类型、一个从 `./auth` 拿 schema），
 * 而多一条 import 路径就多一次"以后改错了地方"的机会。
 */
export type { Locale, UserRole } from './constants';

// ---------------------------------------------------------------------------
// 字段
// ---------------------------------------------------------------------------

/**
 * 邮箱。
 *
 * 统一**转小写后存储**，唯一的唯一索引建在小写形态上。
 *
 * 为什么：RFC 5321 规定 local part 技术上区分大小写（`Foo@x.com` 与 `foo@x.com`
 * 是两个可能不同的信箱），但现实中没有任何主流邮箱服务商这么做，用户也从不这样理解。
 * 如果我们照 RFC 严格区分，真实后果是：用户在某处用大写注册、另一处用小写登录，
 * 得到"邮箱或密码错误" —— 一个纯粹的、我们自己造出来的困惑。
 * 反过来，如果我们**不**做唯一性归一化，同一信箱可以注册出多个账号 —— 更糟。
 *
 * 254 是 RFC 5321 对邮件地址总长度的上限。
 */
export const EmailSchema = z
  .string()
  .trim()
  .max(254, { message: '邮箱地址过长' })
  .toLowerCase()
  .pipe(z.email({ message: '邮箱格式不正确' }));

/**
 * 密码：**只约束长度，不约束字符组成**。
 *
 * 这跟 NIST SP 800-63B 的建议一致，而且和很多人的直觉相反：
 *   · 强制"必须含大写+数字+符号"会把用户推向 `Password1!` 这类可预测的模式，
 *     实测反而降低强度；
 *   · 强制定期更换密码同样被 NIST 明确反对。
 * 真正有效的是**长度下限**，以及"在别处泄漏过的密码不许用"。
 * 后者需要一份泄露密码库，v1 不做（见 §8 明确不做），所以这里只留长度。
 *
 * 上限 200 是防滥用：scrypt 的代价几乎不随输入长度变化，
 * 但没有上限就允许有人拿超长输入做无意义的资源消耗。
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN, { message: `密码至少 ${PASSWORD_MIN} 位` })
  .max(PASSWORD_MAX, { message: `密码不能超过 ${PASSWORD_MAX} 位` });

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 32;

/**
 * 昵称。
 *
 * 只去掉首尾空白并限制长度，不做字符白名单 —— 白名单挡不住真正的滥用
 * （"admin"、"官方"这类才是问题），那属于审核，不属于格式校验。
 */
export const DisplayNameSchema = z
  .string()
  .trim()
  .min(DISPLAY_NAME_MIN, { message: `昵称至少 ${DISPLAY_NAME_MIN} 个字符` })
  .max(DISPLAY_NAME_MAX, { message: `昵称不能超过 ${DISPLAY_NAME_MAX} 个字符` });

// ---------------------------------------------------------------------------
// 请求
// ---------------------------------------------------------------------------

export const RegisterInputSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  displayName: DisplayNameSchema,
  /** 注册时的界面语言，用于决定验证邮件的语言。 */
  locale: z.enum(LOCALES).default('zh-CN'),
});
export type RegisterInput = z.infer<typeof RegisterInputSchema>;

/**
 * 登录入参。
 *
 * ⚠️ 这里的 `email` **不做归一化**（不转小写、不 trim 之后才比）。
 * 其实转了也无妨，但它会掩盖一件事：登录必须对"用户可能输入的任何大小写"
 * 都成功。所以归一化在账号查找那一层做（`findUserByEmail`），
 * 而不是在校验层做掉 —— 这样"登录能接受任意大小写"是一个由存储层保证的性质，
 * 不是靠入参恰好被转换过。
 */
export const LoginInputSchema = z.object({
  email: z.string().trim().max(254),
  password: z.string().max(PASSWORD_MAX),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

// ---------------------------------------------------------------------------
// 响应
// ---------------------------------------------------------------------------

/**
 * 对外可见的用户信息。
 *
 * ⚠️ **绝对不含 email。** 用户主页是公开的（§4 的 `GET /api/users/:id`），
 * 一旦这个对象带上邮箱，它就会出现在任何一个访客的浏览器里。
 * 需要邮箱的是"我自己"，那是下面单独的 UserSelf —— 两个类型分开定义，
 * 而不是靠"调用时记得别序列化那个字段"。
 */
export const UserPublicSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  role: z.enum(['user', 'reviewer', 'admin']),
  /** MC 弱验证绑定，M5 才填。这里先占位，避免之后改动公开形态。 */
  mcName: z.string().nullable(),
  createdAt: z.number().int(),
});
export type UserPublic = z.infer<typeof UserPublicSchema>;

/** 只有"我自己"能看到的形态。 */
export const UserSelfSchema = UserPublicSchema.extend({
  email: z.string(),
  locale: z.enum(LOCALES),
  /** 邮箱是否已验证 —— 前端据此决定是否显示"去验证"的提示与提交按钮的可用性。 */
  emailVerified: z.boolean(),
  /** 当前用户能否提交内容（= 已验证 且 账号未被停用）。 */
  canSubmit: z.boolean(),
});
export type UserSelf = z.infer<typeof UserSelfSchema>;

/** 注册/登录成功的统一响应。 */
export const AuthSuccessSchema = z.object({
  user: UserSelfSchema,
});
export type AuthSuccess = z.infer<typeof AuthSuccessSchema>;
