#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# `/api/file-catalog` 回读判据：读一份**已经抓好的响应**，核对三件事，退出码表达成败。
#
#   bash deploy/verify-file-catalog.sh < captured.txt
#   bash deploy/verify-file-catalog.sh --body captured.txt
#
# 输入 = `curl` 抓下来的**正文**，后面跟着 `-w` 写的那行尾标：
#
#   curl -sS -w '\n<<<%{http_code} %{url_effective}\n' https://<域名>/api/file-catalog > captured.txt
#
#   ⚠️ 尾标是**必填**的：正文里没有状态码，而"这一条必须是 200"正是这里要判的第一件事。
#     没有尾标 = 判不了 = 退出码 2，**不是通过**（§5.74：分不清"没跑"与"没过"就是这个下场）。
#   ⚠️ 也接受带响应头的抓法（`-D -`）：以 `HTTP/` 开头的状态行会被剥掉，正文照常取。
#     但那种抓法下**仍然**需要 `<<<` 尾标 —— 状态行只说 Caddy/上游回了什么，
#     尾标里那行 `<<<200 <url>` 才是"这个正文就是那个端点回的"的证据。
#
# 三项判据：
#   ① 状态码 200
#   ② 正文是 JSON 且 `version === 1`
#   ③ `items` 是非空数组
#
# 退出码（与 deploy/verify-csp.sh 同一个约定）：
#   0 = 三项全过；1 = 有一项没过（逐项标出是哪一项）；
#   2 = 判据**根本没跑起来**（输入为空 / 没有 `<<<` 尾标 / 尾标里取不出状态码 /
#       **只有尾标、没有正文** / 找不到 node）
#   ⚠️ "**200 + 正文不是 JSON**" 是 **1 不是 2**（2026-09-24 评审的顺手 3，实测过）：
#      判据跑起来了，它的结论是"这份正文不可用" ⇒ ① 过、② 不过。
#
# ⚠️ 为什么必须有这条回读：`content/file-catalog.json` 由 `deploy.sh` 同步到服务器，而
#    **没有任何判据关心"它到没到服务器、字段全不全"**。要说准（2026-09-24 评审的必修 2 ——
#    这里原先写的是"没有任何门禁会打开那个文件"，**那句是假的**）：
#      · `biome.json` 的 `files.includes` 里有 `**/*.json` ⇒ `pnpm -w check` **会**解析并
#        格式化检查**仓库里**那份（实测：`biome check content/file-catalog.json` ⇒
#        `Checked 1 file`，exit 0）；
#      · 它不看的正是"服务器上装上了没有"，也不校验 `modId` 这类字段（那由接口每次请求时校验）。
#    ⇒ 漏装的表现是"桌面端那一栏整栏为空 + 页面上一句目录拉取失败"，而**部署照旧成功**。
#    这条回读与 CSP 那条要补的是同一种空白（§5.78），所以判据形状也照它做：
#    **吃一份抓好的响应** ⇒ 不碰生产就能证明"它会红"（试它一次，拿一份坏正文喂进去）。
#    ⚠️ 来历（免得以后又被抄）：§5.78 那句是对 `deploy/Caddyfile` 说的 —— 那个文件名
#      **不匹配任何 include**，所以真的没有门禁读它；**对 JSON 不成立**。
#    ⚠️ 预期值这里**不现读仓库里的 content/file-catalog.json**：那条路要再拉一个解析器进来，
#       而且"线上回的是不是仓库里那一份"是**另一个**问题（它属于部署清单对齐那一类，
#       由 deploy.sh 的 scp/install/清理三处对齐 + 本判据一起覆盖）。这里只答
#       "这个端点现在到底能不能给出一份可用的目录"。
# ⚠️ 只打印状态码与解析出来的读数（条数、id 列表），**不打印输入全文**：
#    输出是要贴进提交信息与报告的（§5.78 顺手立的规矩：回读脚本只打印头与状态码）。
# ---------------------------------------------------------------------------
set -uo pipefail

BODY=""

usage() {
  # 只打印**本文件的注释块**：第 2 行到 `set -` 那行的上一行。
  # ⚠️ **不写死行号**（2026-09-24 评审的顺手 4）：写死的话，下次往头部插一段注释就会把
  #    `set -uo pipefail` 与 `BODY=""` 一起当成"用法"打出来 —— `deploy/verify-csp.sh` 的
  #    `sed -n '2,40p'` 今天就正越过它自己的注释块（它那边是同一个毛病，本轮不动它，只记一笔）。
  # ⚠️ 找不到边界时**报错退出**，不兜一个数字（评审 round 1 的顺手 2）：
  #    兜底会打出一段**被截断的头部**，于是"没找到边界"长得像"有一份用法说明"（§5.74 那一族）。
  local last
  last="$(grep -n '^set -' "${BASH_SOURCE[0]}" | head -n 1 | cut -d: -f1)"
  if [[ -z "$last" ]]; then
    printf '✗ 找不到注释块的边界（本文件里没有以 `set -` 开头的行）—— 打印不出用法，也不猜。\n' >&2
    printf '  修法：确认本脚本第 2 行起是注释块、紧接着一行以 `set -` 开头（那行不算用法）。\n' >&2
    exit 2
  fi
  sed -n "2,$((last - 1))p" "${BASH_SOURCE[0]}" | sed -e 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --body)
      if [[ -z "${2:-}" ]]; then
        printf '✗ --body 后面要给一个文件路径\n' >&2
        exit 2
      fi
      BODY="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      printf '✗ 未知参数: %s（用法见 --help）\n' "$1" >&2
      exit 2
      ;;
  esac
done

# ---------- 读输入 ----------
if [[ -n "$BODY" ]]; then
  if [[ ! -f "$BODY" ]]; then
    printf '✗ 找不到输入文件: %s\n' "$BODY" >&2
    exit 2
  fi
  RAW="$(cat -- "$BODY")"
else
  RAW="$(cat)"
fi
if [[ -z "$RAW" ]]; then
  printf '✗ 输入是空的 —— 需要一份抓好的响应（正文 + `<<<状态码 URL` 尾标，用法见 --help）。空的输入不能判成通过。\n' >&2
  exit 2
fi

BOM="$(printf '\xef\xbb\xbf')"
TRAILER=""
PAYLOAD=""
while IFS= read -r line; do
  line="${line%$'\r'}"
  line="${line#"$BOM"}"
  # `<<<状态码 URL`（curl -w 写的）；`HTTP/…` 状态行（`-D -` 抓法的产物）：都不属于正文
  if [[ "$line" == "<<<"* ]]; then
    if [[ -z "$TRAILER" ]]; then TRAILER="$line"; fi
    continue
  fi
  if [[ "$line" == HTTP/* ]]; then continue; fi
  PAYLOAD+="$line"$'\n'
done <<<"$RAW"

if [[ -z "$TRAILER" ]]; then
  printf '✗ 输入里没有 `<<<状态码 URL` 尾标 —— 正文里没有状态码，判不了"必须是 200"。\n' >&2
  printf '  抓法（尾标由 curl 的 -w 生成）：curl -sS -w '"'"'\\n<<<%%{http_code} %%{url_effective}\\n'"'"' <url>\n' >&2
  exit 2
fi
# `<<<状态码 URL`：状态码在**第一个**字段里（带着 `<<<` 前缀），URL 是第二个
# —— 与 verify-csp.sh 里 `trailer_of` 那段的读法一致（那里只取 URL，所以它的 `$2` 就是 URL）。
STATUS="$(printf '%s' "$TRAILER" | awk '{ sub(/^<<</, "", $1); print $1 }')"
TRAILER_URL="$(printf '%s' "$TRAILER" | awk '{ print $2 }')"
if [[ -z "$STATUS" ]]; then
  printf '✗ 尾标里取不出状态码：%s\n' "$TRAILER" >&2
  exit 2
fi
if [[ -z "$(printf '%s' "$PAYLOAD" | tr -d '[:space:]')" ]]; then
  printf '✗ 输入里没有正文（只有尾标）—— 判不了 ②③。\n' >&2
  exit 2
fi

# ---------- 解析（node，现读输入）----------
# ⚠️ 用 node 而不是 grep/awk 抠 JSON：`"version": 1` 这种串会因为**空格或键序**变了而匹配不上，
#    那种假红会教人无视这份输出。`node` 在这里是**必然有**的（deploy.sh 本机就要跑 pnpm/vite 构建），
#    找不到它时按"判据没跑起来"（退出码 2）处理，**不许**降级成"看着像通过"。
if ! command -v node >/dev/null 2>&1; then
  printf '✗ 找不到 node —— 这一条判据需要一个 JSON 解析器，不用 grep 抠串（理由见脚本头）。\n' >&2
  exit 2
fi

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
  console.log("isObject=" + (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? "yes" : "no"));
  console.log("version=" + JSON.stringify(parsed === null || typeof parsed !== "object" ? null : parsed.version));
  const items = parsed === null || typeof parsed !== "object" ? undefined : parsed.items;
  console.log("itemsIsArray=" + (Array.isArray(items) ? "yes" : "no"));
  console.log("itemsCount=" + (Array.isArray(items) ? String(items.length) : "-"));
  if (Array.isArray(items)) {
    const ids = items.map((it) => (it && typeof it === "object" && typeof it.id === "string" ? it.id : "(" + typeof it + ")"));
    console.log("ids=" + ids.join(","));
  }
});
')"
if [[ -z "$REPORT" ]]; then
  printf '✗ 解析那一步没有输出（node 没跑起来？）—— 判据没跑成，不是通过。\n' >&2
  exit 2
fi

field() { printf '%s\n' "$REPORT" | sed -n "s/^$1=//p" | head -n 1; }
PARSE="$(field parse)"
IS_OBJECT="$(field isObject)"
VERSION="$(field version)"
ITEMS_IS_ARRAY="$(field itemsIsArray)"
ITEMS_COUNT="$(field itemsCount)"
IDS="$(field ids)"

FAIL=0
fail() { FAIL=1; printf '  ✗ %s\n' "$*"; }
pass_it() { printf '  ✓ %s\n' "$*"; }

printf '\n/api/file-catalog 回读\n'
printf '  输入：状态码 %s' "$STATUS"
if [[ -n "$TRAILER_URL" ]]; then printf '（%s）' "$TRAILER_URL"; else printf '（尾标里没有 URL）'; fi
printf '；正文解析 %s\n' "$PARSE"
if [[ "$PARSE" != "ok" ]]; then
  printf '     解析失败：%s\n' "$(field parseError)"
fi

# ---------- ① 200 ----------
printf '\n① 状态码 200\n'
if [[ "$STATUS" == "200" ]]; then
  pass_it "状态码 200"
else
  # ⚠️ 这句是**双引号**字符串：里面**不能**出现反引号（会被 bash 当成命令替换 —— 现场就是
  #    `line 179: [file-catalog]: command not found`，而那一行判据照样打印出来，
  #    看着像"这项没过"。§5.58 同族）。
  fail "状态码是「${STATUS}」而不是 200 —— 端点没在给目录（500 的原因看 journalctl 里 file-catalog 前缀那一行）"
fi

# ---------- ② version === 1 ----------
printf '\n② 正文是 JSON 且 version === 1\n'
if [[ "$PARSE" != "ok" ]]; then
  fail '正文不是合法 JSON（网页 / 错误页 / 被截断都可能长这样）'
elif [[ "$IS_OBJECT" != "yes" ]]; then
  fail '正文是一个 JSON，但不是对象（目录的形状是 { version, items }）'
elif [[ "$VERSION" == "1" ]]; then
  pass_it 'version = 1'
else
  fail "version 是「${VERSION}」而不是 1（客户端只认 1）"
fi

# ---------- ③ items 是非空数组 ----------
printf '\n③ items 是非空数组\n'
if [[ "$ITEMS_IS_ARRAY" != "yes" ]]; then
  fail 'items 不是数组（或这个键不存在）'
elif [[ "$ITEMS_COUNT" == "0" ]]; then
  fail 'items 是空数组 —— 端点能跑，但目录里一条都没有（部署漏了这一份，或文件被清空了）'
else
  pass_it "items 有 ${ITEMS_COUNT} 条：${IDS:-（没有 id）}"
fi

printf '\n'
if [[ "$FAIL" -eq 0 ]]; then
  printf '✓ /api/file-catalog 回读三项全过\n'
  exit 0
fi
printf '✗ /api/file-catalog 回读没过（上面标了是哪一项）。\n' >&2
printf '  排查：① 服务器上 /srv/mcsr-helper/content/file-catalog.json 在不在（deploy.sh 的三处清单）\n' >&2
printf '        ② 内容合不合法：journalctl -u mcsr-helper-api -n 50 --no-pager | grep file-catalog\n' >&2
printf '  本机复跑（只读）：curl -sS -w '"'"'\\n<<<%%{http_code} %%{url_effective}\\n'"'"' https://<域名>/api/file-catalog | bash deploy/verify-file-catalog.sh\n' >&2
exit 1
