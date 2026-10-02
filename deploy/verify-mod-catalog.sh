#!/usr/bin/env bash
#
# 判据：部署之后 `/api/mod-catalog` 能回一份**可用的** mod 目录（schema 2 的形状）。
#
# 三条检查（与 `verify-file-catalog.sh` 一一对应，只换 v2 的字段）：
#   ① HTTP 200；
#   ② 正文是 JSON 且 `schema === 2`（挡"老版本的目录文件还在服务"）；
#   ③ `releases` 是非空数组（挡"目录合法但空"—— 空目录的表现是界面上什么都没有，
#      没人会去查原因，与 file-catalog 那条的理由逐字相同）。
#
# 退出码（与 `deploy/verify-csp.sh` / `deploy/verify-file-catalog.sh` 同一个约定）：
#   0 = 三项全过；1 = 有一项没过（逐项标出是哪一项）；
#   2 = 判据**根本没跑起来** —— 没有 `--body` / 文件不存在 / 读不出 `<<<` 尾标 /
#       只有尾标没有正文 / 找不到 node / **解析器没有输出**。
#   ⚠️ 2 与 1 必须分开：把"没跑"读成"没过"会让人去查一个不存在的缺陷
#      （`AGENTS.md` §5.74 的现场）。解析器没输出那一支尤其要命：不分开的话，
#      `node` 起不来时的表现是 ② 报"服务端可能在发一份老目录"—— 一个**不存在**的缺陷。
#   ⚠️ "**200 + 正文不是 JSON**" 是 **1 不是 2**：判据跑起来了，它的结论是"这份正文不可用"。
#
# ⚠️ 这条判据**故意不比较版本**（与 `verify-file-catalog.sh` 的保留意见同形）：它只答
#    "这个端点现在到底能不能给出一份可用的目录"，**不**答"线上回的是不是仓库里这一份"
#    —— 后者属于部署清单对齐那一类（`deploy.sh` 的 scp / install / 清理三处清单 + 它自己的
#    回读一起覆盖）。所以"可用的"是**形状**意义上的（200 + schema 2 + 非空），不是逐字节相等。
#
# ⚠️ 只打印状态码、尾标里的 URL 与解析出来的读数，**不打印输入全文**：输出是要贴进提交信息
#    与报告的（`verify-file-catalog.sh` 头部立的那条规矩）。
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

# ---------- 读输入（形状照 `verify-file-catalog.sh` 的读入段，但**有一处必须不同**）----------
# ⚠️★ 那一版读的是 here-string（`done <<<"$RAW"`）⇒ **最后一行没有结尾换行也不会丢**；
#    这里读的是**文件**（`done <"$BODY"`），而 `read` 在"读到了内容、但没有结尾换行"时返回
#    **非零** ⇒ 循环少转一圈，最后那一行（通常正是尾标）被丢掉。
#    现场：合法正文 + `<<<200 https://…`（**无结尾换行**）⇒ 报"没有尾标"、退出 **2**
#    —— 一条**假"没跑"**；同一份字节末尾加一个 `\n` 就是 **0**。
#    `|| [ -n "$line" ]` 补的就是这一圈：没有结尾换行时，最后那一段照样进循环。
#    （这条原先写的是"与 `verify-file-catalog.sh:106-137` 同形"—— 那个说法在这一点上不成立。）
# 一次读完，同时把**尾标**（`<<<状态码 URL`）与**正文**分开：
#   · 尾标是**必填**的：正文里没有状态码，而"必须是 200"正是这里要判的第一件事；
#   · `HTTP/…` 开头的**状态行**（`curl -D -` 那种抓法）不算正文 —— 但**只有状态行**会被剥掉：
#     `-D -` 的其余响应头行（`content-type:` 之类）**两个脚本都不支持**，它们会落进正文里、
#     让 `JSON.parse` 失败 ⇒ 那是一条假红。所以请用 `-w` 尾标那种抓法（`deploy.sh` 就是这么抓的）。
#     这一条写在这里是为了不让那个限制变成"服务端可能在发一份老目录"（§5.74 同族）。
#   · 每行剥掉 CR（Windows 上转存过的响应会带它）并剥掉行首 BOM —— 不剥的话 `JSON.parse`
#     会失败，而那会被读成"服务端可能在发一份老目录"（一条**假红**）。
BOM="$(printf '\xef\xbb\xbf')"
TRAILER=""
PAYLOAD=""
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  line="${line#"$BOM"}"
  if [[ "$line" == "<<<"* ]]; then
    if [[ -z "$TRAILER" ]]; then TRAILER="$line"; fi
    continue
  fi
  if [[ "$line" == HTTP/* ]]; then continue; fi
  PAYLOAD+="$line"$'\n'
done <"$BODY"

if [[ -z "$TRAILER" ]]; then
  echo "✗ 捕获文件里没有『<<<状态码 URL』尾标 —— 正文里没有状态码，判不了『必须是 200』⇒ 这条检查没跑" >&2
  exit 2
fi

# `<<<状态码 URL`：状态码在第一个字段里（带着 `<<<` 前缀），URL 是第二个。
# URL 留着打印 —— 正文被路由错（例如抓到了别的端点）时，它是唯一能看出来的线索。
STATUS="$(printf '%s' "$TRAILER" | awk '{ sub(/^<<</, "", $1); print $1 }')"
TRAILER_URL="$(printf '%s' "$TRAILER" | awk '{ print $2 }')"
if [[ -z "$STATUS" ]]; then
  echo "✗ 尾标里取不出状态码：$TRAILER ⇒ 这条检查没跑" >&2
  exit 2
fi

if [[ -z "$(printf '%s' "$PAYLOAD" | tr -d '[:space:]')" ]]; then
  echo "✗ 捕获文件里没有正文（只有尾标）—— 判不了 ②③ ⇒ 这条检查没跑" >&2
  exit 2
fi

# ---------- 解析器守卫（必须在**任何一项结果打印之前**）----------
# ⚠️ 用 node 而不是 grep/awk 抠 JSON：`"schema": 2` 这种串会因为**空格或键序**变了而匹配不上，
#    那种假红会教人无视这份输出。`node` 在这里是**必然有**的（deploy.sh 本机就要跑 pnpm/vite
#    构建），找不到它时按"判据没跑起来"（退出码 2）处理，**不许**降级成"看着像通过"。
# ⚠️ 守卫放在这里、不是紧挨着下面那段 node 调用：找不到解析器时**一条结果都不许打印**
#    —— 先打出「✓ ① HTTP 200」再退出 2 的话，"这条检查没跑成"会被读成"有一项过了"（§5.74）。
if ! command -v node >/dev/null 2>&1; then
  echo "✗ 找不到 node —— 这一条判据需要一个 JSON 解析器，不用 grep 抠串（理由见脚本头）。" >&2
  exit 2
fi

# ---------- 解析（node，现读输入）----------
# 一次调用打印所有读数（与 v1 的 `REPORT` 同形）：`parse=ok|fail` 把"正文不是 JSON"与
# "JSON 但字段不对"分开，schema 与 releases 各自成行。
REPORT="$(printf '%s' "$PAYLOAD" | node -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (error) {
    console.log("parse=fail");
    console.log("parseError=" + String(error.message).split("\n")[0]);
    return;
  }
  console.log("parse=ok");
  const isObject = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
  console.log("schema=" + String(isObject ? (parsed.schema ?? "") : ""));
  const releases = isObject ? parsed.releases : undefined;
  console.log("releasesIsArray=" + (Array.isArray(releases) ? "yes" : "no"));
  console.log("releasesCount=" + (Array.isArray(releases) ? String(releases.length) : "-"));
});
')"

# ⚠️ **解析器没有输出** ⇒ 判据没跑成（退出 2），不是"内容不合规"。
#    不做这一支时的表现：`node` 起不来（或中途崩了）⇒ schema 读到空 ⇒ ② 报
#    "schema=（期望 2）—— 服务端可能在发一份老目录"，也就是把"没跑"读成"没过"（§5.74）。
#    先例：`deploy/verify-file-catalog.sh:173-176`。
if [[ -z "$REPORT" ]]; then
  echo "✗ 解析那一步没有输出（node 没跑起来？）—— 判据没跑成，不是通过。" >&2
  exit 2
fi

field() { printf '%s\n' "$REPORT" | sed -n "s/^$1=//p" | head -n 1; }
PARSE="$(field parse)"
SCHEMA="$(field schema)"
RELEASES_IS_ARRAY="$(field releasesIsArray)"
RELEASES_COUNT="$(field releasesCount)"

fail=0
pass_it() { printf '  ✓ %s\n' "$*"; }
fail_it() { fail=1; printf '  ✗ %s\n' "$*"; }

printf '\n/api/mod-catalog 回读\n'
printf '  输入：状态码 %s' "$STATUS"
if [[ -n "$TRAILER_URL" ]]; then printf '（%s）' "$TRAILER_URL"; else printf '（尾标里没有 URL）'; fi
printf '；正文解析 %s\n' "$PARSE"
if [[ "$PARSE" != "ok" ]]; then printf '     解析失败：%s\n' "$(field parseError)"; fi

# ---------- ① 200 ----------
printf '\n① 状态码 200\n'
if [[ "$STATUS" == "200" ]]; then
  pass_it "状态码 200"
else
  fail_it "状态码是「${STATUS}」而不是 200 —— 端点没在给目录（500 的原因看 journalctl 里 mod-catalog 前缀那一行）"
fi

# ---------- ② schema === 2 ----------
printf '\n② 正文是 JSON 且 schema === 2\n'
if [[ "$PARSE" != "ok" ]]; then
  fail_it '正文不是合法 JSON（网页 / 错误页 / 被截断都可能长这样）'
elif [[ "$SCHEMA" == "2" ]]; then
  pass_it 'schema = 2'
else
  fail_it "schema 是「${SCHEMA}」而不是 2（客户端只认 2 —— 服务端可能在发一份老目录）"
fi

# ---------- ③ releases 是非空数组 ----------
printf '\n③ releases 是非空数组\n'
if [[ "$RELEASES_IS_ARRAY" != "yes" ]]; then
  fail_it 'releases 不是数组（或这个键不存在）'
elif [[ "$RELEASES_COUNT" == "0" ]]; then
  fail_it 'releases 是空数组 —— 端点能跑，但目录里一条 release 都没有（部署漏了这一份，或文件被清空了）'
else
  pass_it "releases 有 ${RELEASES_COUNT} 条"
fi

printf '\n'
if [[ "$fail" -eq 0 ]]; then
  printf '✓ /api/mod-catalog 回读三项全过\n'
  exit 0
fi
printf '✗ /api/mod-catalog 回读没过（上面标了是哪一项）。\n' >&2
printf '  排查：① 服务器上 /srv/mcsr-helper/content/mod-catalog.json 在不在（deploy.sh 的 scp / install / 清理三处清单）\n' >&2
printf '        ② 内容合不合法：journalctl -u mcsr-helper-api -n 50 --no-pager | grep mod-catalog\n' >&2
exit 1
