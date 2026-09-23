#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# CSP 回读判据（§5.78）：读一份**已经抓好的响应头文本**，逐项核对，退出码表达成败。
#
#   bash deploy/verify-csp.sh < captured.txt
#   bash deploy/verify-csp.sh --headers captured.txt
#   bash deploy/verify-csp.sh --caddyfile 别的/Caddyfile --headers captured.txt
#
# 输入 = **两段** HTTP 响应，按顺序拼起来，每段就是 `curl -D -` 的输出：
#
#   curl -sS -D - -o /dev/null -w '<<<%{http_code} %{url_effective}\n' https://<域名>/                  > captured.txt
#   curl -sS -D - -o /dev/null -w '<<<%{http_code} %{url_effective}\n' https://<域名>/api/ranked/status >> captured.txt
#
#   第 1 段 = 站点首页（查 CSP），第 2 段 = `/api/ranked/status`（查匿名 200）。
#   `<<<状态码 URL` 那个尾标由 curl 的 `-w` 生成：**裸响应头里没有 URL**，没有它就
#   核对不了"第二段抓的到底是不是那个端点"（那时会打一行 ⚠️，不算失败）。
#
# 退出码：
#   0 = 四项全过
#   1 = 有一项没过（逐项标出是哪一项）
#   2 = 判据**根本没跑起来**（输入是空的 / 找不到 Caddyfile / 一段状态行都没有）
#       ⇒ 2 与 0 刻意分开：§5.74 的教训是"这条检查没跑"会长得像"这项没过"，
#         而更糟的一种是长成"通过"的样子。
#
# ⚠️ 预期值**现读** `deploy/Caddyfile`（本脚本同目录，可用 `--caddyfile` 换）：
#    这里**不写死**任何域名、视频平台清单或头长度。Caddyfile 改了而这段回读没跟上的
#    表现是**这里红**，而不是这份脚本自己变成一句过期的断言。
#    ⚠️ `caddy validate` **不算**证据（它只证语法对，§5.78）—— 这里读的是**线上真响应头**。
# ⚠️ 只打印状态行与被查的那两个头的取值，**不打印输入全文**：输入里可能有 `Set-Cookie`
#    之类的东西，而这个脚本的输出是要贴进提交信息与报告的（§5.78 顺手立的规矩：
#    回读脚本只打印头与状态码）。
# ---------------------------------------------------------------------------
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CADDYFILE="$SCRIPT_DIR/Caddyfile"
HEADERS=""

# 被查的那条匿名读路径（它必须在没带任何凭据时回 200；`ranked` 那一栏唯一走我们服务器的端点）。
API_PATH="/api/ranked/status"

usage() {
  sed -n '2,40p' "${BASH_SOURCE[0]}" | sed -e 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --headers)
      if [[ -z "${2:-}" ]]; then
        printf '✗ --headers 后面要给一个文件路径\n' >&2
        exit 2
      fi
      HEADERS="$2"
      shift 2
      ;;
    --caddyfile)
      if [[ -z "${2:-}" ]]; then
        printf '✗ --caddyfile 后面要给一个文件路径\n' >&2
        exit 2
      fi
      CADDYFILE="$2"
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
if [[ -n "$HEADERS" ]]; then
  if [[ ! -f "$HEADERS" ]]; then
    printf '✗ 找不到输入文件: %s\n' "$HEADERS" >&2
    exit 2
  fi
  RAW="$(cat -- "$HEADERS")"
else
  RAW="$(cat)"
fi
if [[ -z "$RAW" ]]; then
  printf '✗ 输入是空的 —— 需要**两段**响应头（用法见 --help）。空的输入不能判成通过。\n' >&2
  exit 2
fi

# ---------- 切开响应块（按 `HTTP/` 开头的状态行）----------
# BOM 与 CR：本仓踩过两次编码坑（§5.14 行数被吃掉、§5.104 CRLF 咬掉最后一行），
# 所以这里两种都剥掉 —— 否则一份用 PowerShell 落盘的副本会得到假红。
BOM="$(printf '\xef\xbb\xbf')"
STATUS_LINES=()
BLOCKS=()
cur=""
while IFS= read -r line; do
  line="${line%$'\r'}"
  line="${line#"$BOM"}"
  if [[ "$line" == HTTP/* ]]; then
    if [[ -n "$cur" ]]; then BLOCKS+=("$cur"); fi
    STATUS_LINES+=("$line")
    cur=""
    continue
  fi
  cur+="$line"$'\n'
done <<<"$RAW"
if [[ -n "$cur" ]]; then BLOCKS+=("$cur"); fi

if [[ "${#STATUS_LINES[@]}" -eq 0 ]]; then
  printf '✗ 输入里一段状态行都没有（没有以 `HTTP/` 开头的行）—— 判据没能跑起来，不是"通过"。\n' >&2
  exit 2
fi

# 某个响应块里的头（同名头有多个时逐个打印）
header_of() { # $1 = 块序号, $2 = 头名
  printf '%s' "${BLOCKS[$1]:-}" | awk -v want="$2" '
    {
      line = $0
      sub(/\r$/, "", line)
      p = index(line, ":")
      if (p == 0) next
      name = substr(line, 1, p - 1)
      if (tolower(name) != tolower(want)) next
      v = substr(line, p + 1)
      sub(/^[ \t]+/, "", v)
      sub(/[ \t]+$/, "", v)
      print v
    }'
}

# `-w '<<<状态码 URL'` 那个尾标（没有就回空）
trailer_of() { # $1 = 块序号
  printf '%s' "${BLOCKS[$1]:-}" | awk '/^<<</ { print; exit }'
}

status_code_of() { # $1 = 块序号
  printf '%s' "${STATUS_LINES[$1]:-}" | awk '{ print $2 }'
}

# 把一段 CSP 里某个指令的取值按空白拆成一行一个
tokens_of_directive() { # stdin = CSP 文本, $1 = 指令名
  awk -v want="$1" '
    {
      n = split($0, parts, ";")
      for (i = 1; i <= n; i++) {
        seg = parts[i]
        gsub(/^[ \t]+/, "", seg)
        gsub(/[ \t]+$/, "", seg)
        if (seg == "") continue
        m = split(seg, tok, /[ \t]+/)
        if (tok[1] == want) for (j = 2; j <= m; j++) print tok[j]
      }
    }'
}

# 在换行分隔的清单里找一项（**固定串**，不等于正则 —— 取值里有 `'self'` 这种带引号的）
list_has() { # $1 = 清单, $2 = 要找的项
  printf '%s\n' "$1" | grep -qxF -- "$2"
}

list_minus() { # 打印"在 $1 里、不在 $2 里"的行
  printf '%s\n' "$1" | grep -v '^$' | while IFS= read -r item; do
    if ! list_has "$2" "$item"; then printf '%s\n' "$item"; fi
  done
}

# ---------- 现读 Caddyfile 里的 CSP ----------
if [[ ! -f "$CADDYFILE" ]]; then
  printf '✗ 找不到 Caddyfile: %s（它才是预期值的唯一来源）\n' "$CADDYFILE" >&2
  exit 2
fi
CSP_LINE_NOS="$(grep -nE '^[[:space:]]*Content-Security-Policy[[:space:]]+"' "$CADDYFILE" | cut -d: -f1)"
CSP_LINE_COUNT="$(printf '%s\n' "$CSP_LINE_NOS" | grep -c .)"
if [[ "$CSP_LINE_COUNT" != "1" ]]; then
  printf '✗ %s 里 `Content-Security-Policy "..."` 有 %s 处（预期恰好 1 处）—— 预期值取不到，不猜。\n' \
    "$CADDYFILE" "$CSP_LINE_COUNT" >&2
  exit 2
fi
CSP_LINE_NO="$CSP_LINE_NOS"
EXPECTED_CSP="$(sed -nE 's/^[[:space:]]*Content-Security-Policy[[:space:]]+"(.*)"[[:space:]]*$/\1/p' "$CADDYFILE")"
if [[ -z "$EXPECTED_CSP" ]]; then
  printf '✗ 从 %s 第 %s 行取不出 CSP 的值（引号形式变了？）\n' "$CADDYFILE" "$CSP_LINE_NO" >&2
  exit 2
fi
EXPECT_CONNECT="$(printf '%s' "$EXPECTED_CSP" | tokens_of_directive connect-src)"
EXPECT_FRAME="$(printf '%s' "$EXPECTED_CSP" | tokens_of_directive frame-src)"

# ---------- 线上那一侧 ----------
LIVE_CSP_ALL="$(header_of 0 Content-Security-Policy)"
LIVE_CSP_COUNT="$(printf '%s\n' "$LIVE_CSP_ALL" | grep -c .)"
LIVE_CSP="$(printf '%s' "$LIVE_CSP_ALL" | head -n 1)"
LIVE_CONNECT="$(printf '%s' "$LIVE_CSP" | tokens_of_directive connect-src)"
LIVE_FRAME="$(printf '%s' "$LIVE_CSP" | tokens_of_directive frame-src)"

FAIL=0
fail() { FAIL=1; printf '  ✗ %s\n' "$*"; }
pass_it() { printf '  ✓ %s\n' "$*"; }

printf '\nCSP 回读（§5.78）\n'
printf '  判据来源：%s（第 %s 行，现读）\n' "$CADDYFILE" "$CSP_LINE_NO"
printf '  connect-src 预期：%s\n' "$(printf '%s' "$EXPECT_CONNECT" | tr '\n' ' ')"
printf '  frame-src   预期：%s\n' "$(printf '%s' "$EXPECT_FRAME" | tr '\n' ' ')"
printf '  输入：%s 段响应 ——' "${#STATUS_LINES[@]}"
for i in "${!STATUS_LINES[@]}"; do printf ' [%s]%s' "$((i + 1))" "${STATUS_LINES[$i]}"; done
printf '\n'
if [[ "${#BLOCKS[@]}" -lt 2 ]]; then
  printf '  ⚠️ 只有 %s 段响应：③ 要的是第 2 段（`%s`），没有它判不了。\n' "${#BLOCKS[@]}" "$API_PATH"
fi

# ---------- ① connect-src 的预期取值都在，且没有多出来的 ----------
printf '\n① connect-src：与 Caddyfile 一致（两个域名在，且没有多出来的）\n'
if [[ "$LIVE_CSP_COUNT" -eq 0 ]]; then
  fail '响应里没有 Content-Security-Policy 头 —— 这一条与 ②④ 都没得判'
elif [[ "$LIVE_CSP_COUNT" -gt 1 ]]; then
  fail "响应里有 ${LIVE_CSP_COUNT} 个 Content-Security-Policy 头（浏览器会求交集，这里不猜哪一个说了算）"
else
  printf '     实际：%s\n' "$(printf '%s' "$LIVE_CONNECT" | tr '\n' ' ')"
  MISSING="$(list_minus "$EXPECT_CONNECT" "$LIVE_CONNECT")"
  EXTRA="$(list_minus "$LIVE_CONNECT" "$EXPECT_CONNECT")"
  if [[ -z "$MISSING" && -z "$EXTRA" ]]; then
    pass_it '取值与 Caddyfile 逐项相同'
  else
    if [[ -n "$MISSING" ]]; then
      fail "connect-src 少了：$(printf '%s' "$MISSING" | tr '\n' ' ')"
    fi
    if [[ -n "$EXTRA" ]]; then
      fail "connect-src 多了（Caddyfile 里没有）：$(printf '%s' "$EXTRA" | tr '\n' ' ')"
    fi
  fi
fi

# ---------- ② connect-src 里没有通配符 ----------
# 判据是"通配符形态"，三种都算：`*`、`https:` 这种 scheme-source、带 `*` 的主机。
# ⚠️ 只看 connect-src：`img-src` 里合法地写着 `https:`，拿这一条扫整条策略只会恒红。
printf '\n② connect-src：没有通配符（`*` / scheme-source / `https://*.example.com`）\n'
if [[ -z "$LIVE_CONNECT" ]]; then
  fail '取不到 connect-src（没有 CSP 头，或者那一条指令不见了）'
else
  WILDCARDS="$(printf '%s\n' "$LIVE_CONNECT" | grep -v '^$' | grep -E '(\*|^[A-Za-z][A-Za-z0-9+.-]*:$)')"
  if [[ -z "$WILDCARDS" ]]; then
    pass_it '一个通配符都没有'
  else
    fail "connect-src 里有通配符：$(printf '%s' "$WILDCARDS" | tr '\n' ' ')"
  fi
fi

# ---------- ③ /api/ranked/status 匿名 200 ----------
printf '\n③ %s：匿名（不带任何凭据）回 200\n' "$API_PATH"
if [[ "${#BLOCKS[@]}" -lt 2 ]]; then
  fail "输入里没有第 2 段响应 —— 判不了（要抓的是「${API_PATH}」）"
else
  API_STATUS="$(status_code_of 1)"
  API_TRAILER="$(trailer_of 1)"
  if [[ "$API_STATUS" == "200" ]]; then
    pass_it "状态码 200（${STATUS_LINES[1]}）"
  else
    fail "状态码是「${API_STATUS}」而不是 200（${STATUS_LINES[1]}）"
  fi
  if [[ -n "$API_TRAILER" ]]; then
    # 尾标形如 `<<<200 https://…/api/ranked/status`：`$1` 里带着 `<<<` 前缀，URL 是 `$2`。
    API_URL="$(printf '%s' "$API_TRAILER" | awk '{ print $2 }')"
    if [[ "$API_URL" == *"$API_PATH" ]]; then
      pass_it "第 2 段抓的确实是 ${API_URL}"
    else
      fail "第 2 段抓的是「${API_URL}」而不是「*${API_PATH}」—— 这条判据读的不是它以为的那个端点"
    fi
  else
    printf '     ⚠️ 输入里没有 `<<<状态码 URL` 尾标（裸响应头里没有 URL）⇒ 无法核对第 2 段真的是 `%s`。\n' "$API_PATH"
  fi
fi

# ---------- ④ frame-src 与 Caddyfile 一致 ----------
printf '\n④ frame-src：与 Caddyfile 逐项一致（多一个少一个都算错）\n'
if [[ -z "$LIVE_FRAME" ]]; then
  fail '取不到 frame-src（没有 CSP 头，或者那一条指令不见了）'
else
  printf '     实际：%s\n' "$(printf '%s' "$LIVE_FRAME" | tr '\n' ' ')"
  FRAME_MISSING="$(list_minus "$EXPECT_FRAME" "$LIVE_FRAME")"
  FRAME_EXTRA="$(list_minus "$LIVE_FRAME" "$EXPECT_FRAME")"
  if [[ -z "$FRAME_MISSING" && -z "$FRAME_EXTRA" ]]; then
    pass_it '取值与 Caddyfile 逐项相同'
  else
    if [[ -n "$FRAME_MISSING" ]]; then
      fail "frame-src 少了（Caddyfile 里有）：$(printf '%s' "$FRAME_MISSING" | tr '\n' ' ')"
    fi
    if [[ -n "$FRAME_EXTRA" ]]; then
      fail "frame-src 多了（Caddyfile 里没有）：$(printf '%s' "$FRAME_EXTRA" | tr '\n' ' ')"
    fi
  fi
fi

printf '\n'
if [[ "$FAIL" -eq 0 ]]; then
  printf '✓ CSP 回读四项全过\n'
  exit 0
fi
printf '✗ CSP 回读没过（上面标了是哪一项）。\n' >&2
printf '  排查：线上响应头对不对 → 是不是有人手改了服务器上的 /etc/caddy/Caddyfile（下次部署会被抹掉）\n' >&2
printf '  本机复跑（只读）：curl -sS -D - -o /dev/null -w '"'"'<<<%%{http_code} %%{url_effective}\\n'"'"' https://<域名>/ | bash deploy/verify-csp.sh\n' >&2
exit 1
