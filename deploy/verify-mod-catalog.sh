#!/usr/bin/env bash
#
# 判据：部署之后 /api/mod-catalog 真的在提供**这一版**的目录。
#
# 三条检查（与 verify-file-catalog.sh 一一对应，只换 v2 的字段）：
#   ① HTTP 200；
#   ② 是 JSON 且 schema === 2（挡"老版本的目录文件还在服务"）；
#   ③ releases 是非空数组（挡"目录合法但空"—— 空目录的表现是界面上什么都没有，
#      没人会去查原因，与 file-catalog 那条的理由逐字相同）。
#
# 退出码：0 = 通过；1 = 有一项没过；2 = **这条检查根本没跑成**（读不懂输入）。
# ⚠️ 2 与 1 必须分开：把"没跑"读成"没过"会让人去查一个不存在的缺陷
#    （`AGENTS.md` §5.74 的现场）。
set -uo pipefail

BODY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --body)
      # ⚠️ 必须先检查有没有值：`shift 2` 在 $# = 1 时**不生效**（bash 报
      #    "shift count out of range" 但 $# 不变）⇒ 下面那个 while 会永远转下去。
      #    现场：`verify-mod-catalog.sh --body`（不带值）实测**无限循环**，
      #    退化成"这条检查既没通过也没退出"。契约是"没跑成 ⇒ 2"。
      #    形状照 `deploy/verify-file-catalog.sh:73-76`。
      if [ -z "${2:-}" ]; then
        echo "✗ --body 后面要给一个文件路径 ⇒ 这条检查没跑" >&2
        exit 2
      fi
      BODY="$2"
      shift 2
      ;;
    *)
      echo "用法：verify-mod-catalog.sh --body <curl 捕获文件>" >&2
      exit 2
      ;;
  esac
done

if [ -z "$BODY" ]; then
  echo "✗ 没有给 --body ⇒ 这条检查没跑" >&2
  exit 2
fi

if [ ! -f "$BODY" ]; then
  echo "✗ 捕获文件不存在：$BODY ⇒ 这条检查没跑" >&2
  exit 2
fi

# curl 的输出形状：正文 + 一行 `<<<状态码 URL`
STATUS="$(grep -o '<<<[0-9]\{3\}' "$BODY" | tail -1 | tr -d '<')"
if [ -z "$STATUS" ]; then
  echo "✗ 捕获文件里读不到状态码那一行 ⇒ 这条检查没跑" >&2
  exit 2
fi

JSON="$(sed '/^<<</d' "$BODY")"

# ---------- 解析器守卫（必须在**任何一项结果打印之前**）----------
# ⚠️ 用 node 而不是 grep/awk 抠 JSON：`"schema": 2` 这种串会因为**空格或键序**变了而匹配不上，
#    那种假红会教人无视这份输出。`node` 在这里是**必然有**的（deploy.sh 本机就要跑 pnpm/vite
#    构建），找不到它时按"判据没跑起来"（退出码 2）处理，**不许**降级成"看着像通过"。
# ⚠️ 守卫放在这里、不是紧挨着下面那两段 node 调用：找不到解析器时**一条结果都不许打印**
#    —— 先打出「✓ ① HTTP 200」再退出 2 的话，"这条检查没跑成"会被读成"有一项过了"（§5.74）。
if ! command -v node >/dev/null 2>&1; then
  echo "✗ 找不到 node —— 这一条判据需要一个 JSON 解析器，不用 grep 抠串（理由见脚本头）。" >&2
  exit 2
fi

fail=0

if [ "$STATUS" != "200" ]; then
  echo "  ✗ ① HTTP $STATUS（期望 200）"
  fail=1
else
  echo "  ✓ ① HTTP 200"
fi

SCHEMA="$(printf '%s' "$JSON" | node -e '
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  try {
    const parsed = JSON.parse(raw);
    process.stdout.write(String(parsed.schema ?? ""));
  } catch {
    process.stdout.write("");
  }
});
')"

if [ "$SCHEMA" != "2" ]; then
  echo "  ✗ ② schema=$SCHEMA（期望 2）—— 服务端可能在发一份老目录"
  fail=1
else
  echo "  ✓ ② schema = 2"
fi

COUNT="$(printf '%s' "$JSON" | node -e '
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  try {
    const parsed = JSON.parse(raw);
    process.stdout.write(Array.isArray(parsed.releases) ? String(parsed.releases.length) : "");
  } catch {
    process.stdout.write("");
  }
});
')"

if [ -z "$COUNT" ] || [ "$COUNT" = "0" ]; then
  echo "  ✗ ③ releases 不是非空数组（读到 '${COUNT}'）"
  fail=1
else
  echo "  ✓ ③ releases 有 $COUNT 条"
fi

exit "$fail"
