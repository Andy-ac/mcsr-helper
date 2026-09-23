import { DISPLAY_NAME_MAX, DISPLAY_NAME_MIN } from '@mcsr/shared/auth';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '@/components/Form';

/**
 * 「改我的昵称」那一块（账号页 `/me` 上昵称那一行）。
 *
 * ---------------------------------------------------------------------------
 * 为什么它也是**纯展示**组件（props 注入，自己不发请求）
 * ---------------------------------------------------------------------------
 * 与 `MyLiveList` / `MyLiveForm` 同一条理由：取数与提交留在页面（`routes/Account.tsx`），
 * 这一层只管"拿到什么就画什么"。好处是**四种状态都能被渲染自检驱动**
 * （收起态 / 编辑态 / 服务端 400 那两句 / 成功那两句），而不必起 dev server 去点。
 * ⇒ 于是 `apps/web/scripts/accountrender.tsx` 能对同一个组件断言四件事，
 * 而不是只断言"入口那个按钮在"。
 *
 * ⚠️ 展开动作本身（点「修改」→ 出现输入框）是**交互**，静态渲染的射程之外；
 *    这里覆盖的是"把 props 给对了会渲染成什么样"，交互那一半归浏览器层。
 *    （与 `liverender.tsx` 里行内编辑那一节同形，那一段写着同样的边界。）
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 长度规则**从 shared 取**，本地不写第二份
 * ---------------------------------------------------------------------------
 * `displayNameError` 用的是 `DISPLAY_NAME_MIN` / `DISPLAY_NAME_MAX`，
 * 而服务端校验的是同一个 `DisplayNameSchema`。本地那一层只是**先挡一下**，
 * 判据本身只有一份 —— 另写一份的具体后果：某一侧改了阈值，另一侧还在按旧值放行，
 * 而两边都"看起来是对的"，用户遇到的是"本地说太长、服务端说太短"。
 */
type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * 本地校验：返回一句**已经翻好**的话，`null` = 通过。
 *
 * ⚠️ 文案走 `auth.err.nameMin` / `auth.err.nameMax` —— 这两条本来就在字典里
 *    （`lib/auth.tsx` 的 `fieldIssueText` 里写着它们），刻意**不新增**两条"本地专用"的
 *    同义句：同一个问题在两处各养一条文案，改的时候必然只改一处。
 *
 * ⚠️★ 而这一层**不是可有可无的**（这是读代码时最容易高估服务端那条路的地方）：
 *    服务端 400 的 `issues[]` 里**只有 `{ field, message }`、没有 Zod 的 `code`**
 *    （`routes/auth.ts` 的 `formatIssues` 就是这么发的），而 `fieldIssueText` 是
 *    **按 `code` 分支**的（`case 'too_small'` …）⇒ 它落到兜底那句
 *    `auth.err.invalid`（"填写的内容不合法"）。也就是说：**"昵称至少 2 个字符"
 *    这句话，今天只有本地这一层说得出来。**
 *    ⚠️ 但那条断言（`accountrender.tsx` 的 ⑤）读的是**本地构造的夹具**，它**看不见服务端**：
 *      服务端哪天开始发 `code`，**是不会让它红的**。守着"服务端今天只发
 *      `{ field, message }`"的是**服务端那一侧**的一条断言 ——
 *      `services/api/src/auth/display-name.test.ts` 里钉 `issues[]` **键集**的那一条。
 *      那条红了，就是回来改这一段的信号。
 *
 * ⚠️ 抽成**导出的纯函数**是为了让渲染自检能直接驱动它（"太短"与"太长"各说各的话，
 *    而且都不能是空串）。写在 submit 的那个闭包里的话，SSR 里永远碰不到它 ——
 *    那就又变成"界面上有这个错误文案，但没有任何断言看过它"。
 */
export function displayNameError(value: string, t: Translate): string | null {
  const trimmed = value.trim();
  if (trimmed.length < DISPLAY_NAME_MIN) {
    return t('auth.err.nameMin', { min: DISPLAY_NAME_MIN });
  }
  if (trimmed.length > DISPLAY_NAME_MAX) {
    return t('auth.err.nameMax', { max: DISPLAY_NAME_MAX });
  }
  return null;
}

export function DisplayNameField({
  current,
  editing,
  busy,
  error,
  saved,
  onEdit,
  onDirty,
  onSubmit,
  onCancel,
}: {
  /** 当前昵称（就是页面上正在显示的那一个）。 */
  current: string;
  /** 是否展开了行内编辑。 */
  editing: boolean;
  /** 提交中（按钮禁用）。 */
  busy: boolean;
  /** 上一次失败的**本地或服务端**那句话（已由页面翻好）。`null` = 没有错误。 */
  error: string | null;
  /** 改成功之后那句话（已由页面翻好）。`null` = 没有提示。 */
  saved: string | null;
  /** 点「修改」。 */
  onEdit: () => void;
  /**
   * 用户**动过输入框**（每敲一次叫一次）。
   *
   * ⚠️★ 这个回调存在的原因：`error` 是**页面**传下来的（服务端那一句），而
   *    "一改就把上一次的红字擦掉"这件事组件自己**做不了** —— 它只能清自己的
   *    `localError`。少了这个回调，服务端报错之后继续打字，那句说的是**上一个**
   *    输入值的红字会一直挂着（界面看的是 `shown = localError ?? error`）。
   *    ⚠️ 它**不被任何自动化判据覆盖**：`onChange` 是事件处理器，
   *      `renderToStaticMarkup` 一行都不跑 ⇒ `accountrender.tsx` 末尾把它列进了
   *      "没被覆盖"的那几样。别在这里写"已验证"。
   */
  onDirty: () => void;
  /** 提交新昵称（**已经 trim 过**，而且已经过了本地校验）。 */
  onSubmit: (displayName: string) => void;
  /** 点「取消」：收起编辑态。 */
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  if (editing) {
    return (
      <div className="namefield">
        {/*
          ⚠️ 输入值存在**下面那个组件**的局部 state 里，挂载时的初值就是当前昵称 ——
              展开时它拿到的就是当前昵称，所以"点开之后输入框里是空的"这种错法
              会在渲染自检里当场露出来（`value="<当前昵称>"` 找不到）。
        */}
        <DisplayNameEditor
          initial={current}
          busy={busy}
          error={error}
          onDirty={onDirty}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      </div>
    );
  }

  return (
    <div className="namefield">
      <div className="namefield__row">
        <span className="namefield__value">{current}</span>
        {/*
          ⚠️ 入口按钮用的是 `ghostbtn`（与 `MyLiveList` 每一行的「改」同一个类）：
              账号页上主按钮（`cta`）是"离开这一页"或"提交"那种动作，改名入口不是那一档。
        */}
        <button type="button" className="ghostbtn" onClick={onEdit} disabled={busy}>
          {t('auth.nameEditAction')}
        </button>
      </div>
      {saved ? <p className="namefield__note namefield__note--ok">{saved}</p> : null}
      {/*
        ⚠️ 这句**无条件**渲染（不是只在改名之后才说）：用户需要知道"这个名字是公开的"
        —— 资源作者、贡献者面板、审核记录里都用它。只有改完才说的话，
        他就是**在不知情的情况下**改了一次自己以为私密的资料。
      */}
      <p className="namefield__note">{t('auth.namePublicNote')}</p>
    </div>
  );
}

/**
 * 展开之后的编辑态：输入框 + 「保存」+「取消」。
 *
 * ⚠️ 单独一层是因为它自己有局部 state（正在输入的那个值）。
 *    留在 `DisplayNameField` 里的话，收起再展开时输入框会**留着上一次没提交的内容**
 *    （state 挂在父组件上不会被重置），而用户看到的是"我上次没保存的东西还在"。
 */
function DisplayNameEditor({
  initial,
  busy,
  error,
  onDirty,
  onSubmit,
  onCancel,
}: {
  initial: string;
  busy: boolean;
  error: string | null;
  onDirty: () => void;
  onSubmit: (displayName: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  const [localError, setLocalError] = useState<string | null>(null);

  /*
   * ⚠️ 本地那句**优先**于服务端那句：本地那句是"刚刚这一次点击"产生的，
   *    而 `error` 是**上一次**请求的残留。今天两者同时非 null 的路很窄
   *    （页面在提交开始时、以及用户一打字时都会清 `error`），这里的 `??`
   *    是保底的顺序，不是唯一那道防线。
   */
  const shown = localError ?? error;

  return (
    <form
      className="namefield__form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        const problem = displayNameError(value, t as unknown as Translate);
        if (problem) {
          // 本地挡住：不发的请求就不会在服务端留下一条审计，也不会多一次往返
          setLocalError(problem);
          return;
        }
        setLocalError(null);
        onSubmit(value.trim());
      }}
    >
      <Field id="account-display-name" label={t('auth.displayName')} hint={shown ?? undefined}>
        <input
          id="account-display-name"
          className="mcsr-field__input mcsr-field__input--prose"
          type="text"
          name="displayName"
          value={value}
          placeholder={t('auth.displayNamePlaceholder')}
          // nickname：与注册页同一个 autoComplete —— 密码管理器知道这两处是同一个字段
          autoComplete="nickname"
          onChange={(event) => {
            setValue(event.target.value);
            /*
             * 一改就把上一次的红字擦掉 —— **两句都擦**：本地那句（`localError`）在这里清，
             * 服务端那句是页面传下来的（`error`），只能通过 `onDirty` 让页面清掉。
             * ⚠️ 只清本地那一半是上一版的真实缺陷（`31648dd` 里能看到那三行）：那时服务端
             *    报错之后继续打字，输入框下面挂着的还是**上一个**输入值的那句话。
             */
            setLocalError(null);
            onDirty();
          }}
        />
      </Field>

      <div className="authform__actions">
        {/*
          ⚠️ `common.save` / `common.cancel`：与 `MyLiveForm` 的行内编辑同一组词条
              （那边是 `myLive.saveAction` + `common.cancel`）。"保存""取消"这两个词
              在 `common` 里已经有了，再给这一块各写一条同义的新词条 = 同一个词两处维护。
        */}
        <button type="submit" className="cta" disabled={busy}>
          {t('common.save')}
        </button>
        <button type="button" className="ghostbtn" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
