#!/bin/bash
# M0 #3: two concurrent yzj-cli pollers sharing one login state.
# Read-only command only (im group recent). Watches for 10000400 / auth errors
# and for token-store rewrites (a rewrite during the window = a real refresh
# happened under concurrency, which is what could race).
set -u
OUT="$(cd "$(dirname "$0")" && pwd)"
DURATION="${1:-600}"
INTERVAL="${2:-3}"
TOKEN_STORE="/Users/Apple/Library/Application Support/yzj-cli/default_cli_bb115ff4d68c492e_self.enc"

poll() {
  local id="$1" log="$OUT/poll-$1.log" n=0 fail=0
  local end=$(( $(date +%s) + DURATION ))
  while [ "$(date +%s)" -lt "$end" ]; do
    n=$((n + 1))
    local out rc
    out="$(yzj-cli im group recent --limit 1 2>&1)"
    rc=$?
    if [ $rc -ne 0 ] || printf '%s' "$out" | grep -qE '10000400|93001|"?error(Code)?"?|未登录|登录失效'; then
      fail=$((fail + 1))
      printf '%s [%s] #%d rc=%d FAIL %s\n' "$(date +%T)" "$id" "$n" "$rc" "$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-300)" >>"$log"
    fi
    sleep "$INTERVAL"
  done
  printf '%s [%s] DONE iterations=%d failures=%d\n' "$(date +%T)" "$id" "$n" "$fail" >>"$log"
}

watch_token() {
  local log="$OUT/token-store.log" prev
  prev="$(stat -f %m "$TOKEN_STORE" 2>/dev/null)"
  printf '%s start mtime=%s\n' "$(date +%T)" "$prev" >>"$log"
  local end=$(( $(date +%s) + DURATION ))
  while [ "$(date +%s)" -lt "$end" ]; do
    local now
    now="$(stat -f %m "$TOKEN_STORE" 2>/dev/null)"
    if [ "$now" != "$prev" ]; then
      printf '%s TOKEN STORE REWRITTEN mtime=%s\n' "$(date +%T)" "$now" >>"$log"
      prev="$now"
    fi
    sleep 1
  done
  printf '%s end mtime=%s\n' "$(date +%T)" "$prev" >>"$log"
}

rm -f "$OUT"/poll-*.log "$OUT"/token-store.log
poll A & poll B & watch_token &
wait
echo "=== summary"
tail -n 3 "$OUT"/poll-A.log "$OUT"/poll-B.log "$OUT"/token-store.log
