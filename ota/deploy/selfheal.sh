#!/bin/sh
# Makes the machine restart BY ITSELF when it freezes, so that nobody has to press "reboot" in the OCI console.
#
#  - the system manager (systemd) tells a software watchdog "I am alive" every 30 seconds; if that stops for 60 seconds
#    (the machine is so starved of memory that nothing runs), the watchdog restarts the machine;
#  - a kernel panic restarts the machine after 30 seconds instead of hanging for ever.
# After the restart the token server, the update server and Caddy come back by themselves.
# It changes only four small files under /etc (listed by "status") and can be undone with "remove".
#
#   sh selfheal.sh status    what is set now
#   sh selfheal.sh install   switch it on (asks for sudo)
#   sh selfheal.sh remove    switch it off again (takes full effect at the next restart)
set -eu

ROOT="${SELFHEAL_ROOT:-}"
SUDO="${SELFHEAL_SUDO-sudo}"
WATCHDOG="$ROOT/etc/systemd/system.conf.d/90-musicspace-watchdog.conf"
MODLOAD="$ROOT/etc/modules-load.d/musicspace-softdog.conf"
MODOPT="$ROOT/etc/modprobe.d/musicspace-softdog.conf"
PANIC="$ROOT/etc/sysctl.d/90-musicspace-panic.conf"

# writes standard input into a file that only root may write
put() {
  $SUDO mkdir -p "$(dirname "$1")"
  $SUDO tee "$1" >/dev/null
}

mark() { if [ -e "$1" ]; then echo "あり"; else echo "なし"; fi; }

status() {
  echo "softdog（ソフトウェアのウォッチドッグ）がこの OS にある: $(modinfo softdog >/dev/null 2>&1 && echo はい || echo いいえ)"
  echo "読み込まれている:                                       $(lsmod 2>/dev/null | grep -q '^softdog' && echo はい || echo いいえ)"
  echo "systemd の設定:    $(mark "$WATCHDOG")   ($WATCHDOG)"
  echo "起動時の読み込み:  $(mark "$MODLOAD")   ($MODLOAD)"
  echo "softdog の設定:    $(mark "$MODOPT")   ($MODOPT)"
  echo "固まり時の再起動:  $(mark "$PANIC")   ($PANIC)"
  wd="$(systemctl show -p RuntimeWatchdogUSec --value 2>/dev/null || true)"
  case "${wd:-}" in
    ''|0|0us|infinity) echo "いま動いている見張り: なし" ;;
    *) echo "いま動いている見張り: あり（systemd が、$wd ごとの合図を待っています）" ;;
  esac
  echo "カーネルのパニック後の再起動: $(sysctl -n kernel.panic 2>/dev/null || echo '?') 秒（0 は、再起動しない）"
}

install() {
  if ! modinfo softdog >/dev/null 2>&1; then
    echo "この機械の OS には、softdog が見つかりません。何も変えませんでした。"
    echo "（カーネルによっては、別の名前の入れ物が必要です。この出力を、見せてください）"
    exit 1
  fi
  printf 'options softdog soft_margin=60\n' | put "$MODOPT"
  printf 'softdog\n' | put "$MODLOAD"
  printf '# restart the machine when systemd cannot tell the watchdog "alive" for 60 seconds\n[Manager]\nRuntimeWatchdogSec=60s\n' | put "$WATCHDOG"
  printf '# restart 30 seconds after a kernel panic (and after an oops) instead of hanging\nkernel.panic = 30\nkernel.panic_on_oops = 1\n' | put "$PANIC"
  $SUDO modprobe softdog
  $SUDO sysctl -p "$PANIC" >/dev/null
  $SUDO systemctl daemon-reexec # reads the new settings of systemd without a restart of the machine
  echo "入れました。機械が固まって、60秒たっても合図が止まったままなら、自動で再起動します。"
  echo
  status
}

remove() {
  for f in "$WATCHDOG" "$MODLOAD" "$MODOPT" "$PANIC"; do $SUDO rm -f "$f"; done
  $SUDO systemctl daemon-reexec
  echo "外しました。見張りは、次に再起動するまで、動いたままです。"
}

case "${1:-status}" in
  status) status ;;
  install) install ;;
  remove) remove ;;
  *) echo "使い方: sh selfheal.sh [status|install|remove]"; exit 1 ;;
esac
