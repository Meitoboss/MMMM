#!/bin/sh
# A small recorder for "it sometimes does not connect": once a minute it writes ONE line about the state of this machine and of
# the three services (token server, update server, Caddy). It changes nothing and needs no root. Logs live in ~/healthlog/
# and are deleted after 14 days.
#
#   sh healthlog.sh            install and start it (run it from the folder where the file is; it then copies itself to
#                              ~/healthlog/healthlog.sh, so that the next commands work from ANY folder)
#   sh ~/healthlog/healthlog.sh show       the last lines
#   sh healthlog.sh problems   only the lines where something was wrong (the last 40)
#   sh healthlog.sh gaps       the places where the lines STOP for minutes: the machine was frozen or off (with the lines before)
#   sh healthlog.sh crash      what the PREVIOUS start of the machine wrote at its end (out of memory, hung tasks …)
#   sh healthlog.sh stop       stop it (the logs stay)
set -eu

DIR="$HOME/healthlog"
UNITS="$HOME/.config/systemd/user"

write_logger() {
  cat > "$DIR/log-once.sh" <<'LOGGER'
#!/bin/sh
# writes one line: time, load, free memory, swap in use, memory pressure, the three services, the biggest programs
DIR="$(cd "$(dirname "$0")" && pwd)"
TS="$(date '+%Y-%m-%d %H:%M:%S')"
LOG="$DIR/health-$(date +%Y%m%d).log"

LOAD="$(cut -d' ' -f1 /proc/loadavg 2>/dev/null || echo '?')"
AVAIL="$(awk '/^MemAvailable/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo '?')"
SWAP="$(awk '/^SwapTotal/ {t=$2} /^SwapFree/ {f=$2} END {printf "%d", (t-f)/1024}' /proc/meminfo 2>/dev/null || echo '?')"
PSI='-'
[ -r /proc/pressure/memory ] && PSI="$(awk '/^some/ {sub("avg10=","",$2); print $2}' /proc/pressure/memory)"

# the status code (and the time in seconds) a service answers with; 000 = no answer within 6 seconds
probe() { curl -s -o /dev/null -m 6 -w '%{http_code}/%{time_total}' "$1" 2>/dev/null || true; }
BG="$(probe http://127.0.0.1:4416/ping)"
OTA="$(probe http://127.0.0.1:8789/ota/health)"
BASE="$(sed -n 's/^OTA_PUBLIC_BASE=//p' "$HOME/musicspace-ota/ota.env" 2>/dev/null | head -n 1)"
WEB='-'
[ -n "$BASE" ] && WEB="$(probe "$BASE/ota/health")"

PORTS="$(ss -ltn 2>/dev/null | awk '$4 ~ /:(80|443)$/ {n=split($4,a,":"); print a[n]}' | sort -u | tr '\n' ',' | sed 's/,$//')"
RESTARTS="$(systemctl --user show bgutil.service -p NRestarts --value 2>/dev/null || echo '?')"
TOP="$(ps -eo rss=,comm= --sort=-rss 2>/dev/null | head -n 3 | awk '{printf "%s:%dMB,", $2, $1/1024}' | sed 's/,$//')"

echo "$TS load=$LOAD avail=${AVAIL}MB swap=${SWAP}MB psi=$PSI bgutil=${BG:-000/0} ota=${OTA:-000/0} https=$WEB ports=${PORTS:-none} bg_restarts=$RESTARTS top=$TOP" >> "$LOG"
find "$DIR" -name 'health-*.log' -mtime +14 -delete 2>/dev/null || true
LOGGER
  chmod +x "$DIR/log-once.sh"
}

# the lines where a service did not answer with 200, memory ran low, or the machine was waiting for memory
problems() {
  cat "$DIR"/health-*.log 2>/dev/null | awk '
    function code(s) { sub(/\/.*/, "", s); return s }
    function secs(s) { sub(/.*\//, "", s); return s + 0 }
    {
      bad = 0
      for (i = 1; i <= NF; i++) {
        split($i, kv, "=")
        if (kv[1] == "avail") { v = kv[2]; sub(/MB/, "", v); if (v != "?" && v + 0 < 150) bad = 1 }
        if (kv[1] == "psi") { if (kv[2] != "-" && kv[2] + 0 >= 10) bad = 1 }
        if (kv[1] == "bgutil" || kv[1] == "ota" || (kv[1] == "https" && kv[2] != "-")) { if (code(kv[2]) != "200" || secs(kv[2]) > 3) bad = 1 }
        if (kv[1] == "ports" && (kv[2] !~ /80/ || kv[2] !~ /443/)) bad = 1
      }
      if (bad) print
    }' | tail -n 40
}

# where the one-line-a-minute record has a hole: while the machine is frozen (or off) nothing writes
gaps() {
  cat "$DIR"/health-*.log 2>/dev/null | awk -v min="${1:-150}" '
    function dfc(y, m, d,   era, yoe, doy, doe) {
      if (m <= 2) y -= 1
      era = int((y >= 0 ? y : y - 399) / 400)
      yoe = y - era * 400
      doy = int((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
      doe = yoe * 365 + int(yoe / 4) - int(yoe / 100) + doy
      return era * 146097 + doe - 719468
    }
    function ep(date, time,   a, b) { split(date, a, "-"); split(time, b, ":"); return dfc(a[1] + 0, a[2] + 0, a[3] + 0) * 86400 + b[1] * 3600 + b[2] * 60 + b[3] }
    function dur(s,   m, h) {
      if (s < 120) return s "秒"
      m = int(s / 60 + 0.5)
      if (m < 60) return m "分"
      h = int(m / 60)
      return (m % 60 == 0) ? h "時間" : h "時間" (m % 60) "分"
    }
    $1 ~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$/ && $2 ~ /^[0-9][0-9]:[0-9][0-9]:[0-9][0-9]$/ {
      t = ep($1, $2)
      if (prev != "" && t - prev >= min) {
        n++
        block[n] = "=== ここで " dur(t - prev) " 途切れています（" ptime " → " $2 "）===\n  途切れる直前の3行:\n    " l3 "\n    " l2 "\n    " l1 "\n  戻って、最初の行:\n    " $0
      }
      l3 = l2; l2 = l1; l1 = $0; prev = t; ptime = $2
    }
    END {
      if (n == 0) { print "途切れ（" min "秒以上）は、ありません"; exit }
      from = (n > 5) ? n - 4 : 1
      for (i = from; i <= n; i++) print block[i] "\n"
      print "（再起動のあいだも、途切れとして出ます。固まっていたのか、自分で再起動したのかは、時刻で見分けてください）"
    }'
}

# the end of the previous start of the machine, from the journal (needs it to be kept on disk: /var/log/journal)
crash() {
  command -v journalctl >/dev/null 2>&1 || { echo "journalctl がありません"; return 1; }
  echo "=== 起動の履歴（新しいものが下）"
  sudo -n journalctl --list-boots --no-pager 2>/dev/null | tail -n 4 || true
  if ! sudo -n journalctl -b -1 -n 1 --no-pager >/dev/null 2>&1; then
    echo
    echo "前回の起動の記録が、残っていません。次の2行を実行すると、次回から残ります:"
    echo "  sudo mkdir -p /var/log/journal"
    echo "  sudo systemctl restart systemd-journald"
    return 0
  fi
  echo
  echo "=== 前回の起動の、メモリ不足・固まりの跡"
  found="$(sudo -n journalctl -b -1 -k --no-pager 2>/dev/null | grep -iE 'out of memory|oom-kill|killed process|hung task|blocked for more than|soft lockup|rcu.*stall|call trace' | tail -n 15 || true)"
  if [ -n "$found" ]; then echo "$found"; else echo "（見つかりませんでした: メモリ不足の記録は、ありません）"; fi
  echo
  echo "=== 前回の起動の、最後の20行"
  sudo -n journalctl -b -1 --no-pager -n 20 2>/dev/null || true
}

case "${1:-install}" in
  gaps)
    gaps "${2:-150}"
    ;;
  crash)
    crash
    ;;
  show)
    tail -n "${2:-40}" "$DIR"/health-*.log 2>/dev/null || echo "まだ記録がありません（インストールの1分後から）"
    ;;
  problems)
    out="$(problems)"
    if [ -n "$out" ]; then echo "$out"; else echo "問題のあった行は、まだありません"; fi
    ;;
  stop)
    systemctl --user disable --now healthlog.timer 2>/dev/null || true
    echo "止めました（記録は $DIR に残っています）"
    ;;
  install)
    command -v curl >/dev/null 2>&1 || { echo "curl がありません"; exit 1; }
    mkdir -p "$DIR" "$UNITS"
    # keep a copy next to the log, so that the commands below do not depend on the folder you happen to be in
    self="$0"
    case "$self" in /*) ;; *) self="$(pwd)/$self" ;; esac
    if [ -f "$self" ] && [ "$self" != "$DIR/healthlog.sh" ]; then cp "$self" "$DIR/healthlog.sh"; fi
    write_logger
    cat > "$UNITS/healthlog.service" <<UNIT
[Unit]
Description=one line about the health of this machine
[Service]
Type=oneshot
ExecStart=$DIR/log-once.sh
Nice=10
UNIT
    cat > "$UNITS/healthlog.timer" <<'UNIT'
[Unit]
Description=every minute
[Timer]
OnBootSec=60s
OnUnitActiveSec=60s
AccuracySec=5s
[Install]
WantedBy=timers.target
UNIT
    "$DIR/log-once.sh" # the first line, at once
    if [ "${HEALTHLOG_NO_SYSTEMD:-0}" != "1" ]; then
      systemctl --user daemon-reload
      systemctl --user enable --now healthlog.timer
    fi
    echo "始めました。1分ごとに、1行ずつ ~/healthlog/ に書きます。"
    echo "どこからでも、次のように使えます:"
    echo "  いまの様子:           sh ~/healthlog/healthlog.sh show"
    echo "  問題のあった行だけ:   sh ~/healthlog/healthlog.sh problems"
    echo "  記録が途切れた所:     sh ~/healthlog/healthlog.sh gaps"
    echo "  前回の起動の跡:       sh ~/healthlog/healthlog.sh crash"
    echo "最初の1行:"
    tail -n 1 "$DIR"/health-*.log
    ;;
  *)
    echo "使い方: sh healthlog.sh [install|show|problems|gaps|crash|stop]"
    exit 1
    ;;
esac
