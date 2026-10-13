#!/bin/sh
# Keeps "dnf" (the package tool) from eating the memory of this small machine.
#
# What happened: the system runs "dnf makecache" by itself (dnf-makecache.timer). It reads the huge "OCI Included Packages"
# list (about 184 MB) and then uses about 400 MB of memory. On a machine with 1 GB that already runs three services, the
# memory runs out, the swap fills up, and the machine becomes unusable for minutes (SSH too) until someone restarts it.
#
#   sh lean.sh status    what is set now, and whether dnf is running
#   sh lean.sh apply     stop the automatic makecache and switch off the two big lists (asks for sudo)
#   sh lean.sh undo      put everything back
# Nothing else is changed. The repo files are copied to *.bak-lean first.
set -eu

ROOT="${LEAN_ROOT:-}"
SUDO="${LEAN_SUDO-sudo}"
REPODIR="$ROOT/etc/yum.repos.d"
BIG='oci_included ksplice'

repo_files() { for f in "$REPODIR"/*.repo; do [ -f "$f" ] && echo "$f"; done; return 0; }

# "ol9_oci_included: enabled=1" for every big list that is found
repo_state() {
  repo_files | while IFS= read -r f; do
    awk -v file="$f" '
      /^\[/ { id = $0; sub(/^\[/, "", id); sub(/\].*$/, "", id); watch = (id ~ /^ol[0-9]*_(oci_included|ksplice)$/) }
      watch && /^enabled[ \t]*=/ { v = $0; sub(/^enabled[ \t]*=[ \t]*/, "", v); printf "  %-22s enabled=%s\n", id, v }' "$f"
  done
}

status() {
  echo "dnf-makecache.timer（自動の下調べ）: $(systemctl is-enabled dnf-makecache.timer 2>/dev/null || echo 'ない')"
  echo "大きな一覧（ol9_oci_included / ol9_ksplice）:"
  out="$(repo_state)"
  if [ -n "$out" ]; then echo "$out"; else echo "  見つかりません（この OS には、ありません）"; fi
  if ps -eo comm= 2>/dev/null | grep -qx 'dnf'; then echo "いま dnf が動いています ← 動いているあいだは、メモリを400MBほど使います"; else echo "いま dnf は動いていません"; fi
}

apply() {
  # 1. the automatic makecache: stopped now, and prevented from being switched on again by a package update
  $SUDO systemctl mask --now dnf-makecache.timer dnf-makecache.service
  # 2. the two big lists: copy the file first (once), then switch only those two off
  repo_files | while IFS= read -r f; do
    if grep -qE '^\[ol[0-9]*_(oci_included|ksplice)\]' "$f"; then
      [ -e "$f.bak-lean" ] || $SUDO cp -p "$f" "$f.bak-lean"
      $SUDO sed -i -e '/^\[ol[0-9]*_oci_included\]/,/^\[/ s/^enabled[[:space:]]*=[[:space:]]*1/enabled=0/' -e '/^\[ol[0-9]*_ksplice\]/,/^\[/ s/^enabled[[:space:]]*=[[:space:]]*1/enabled=0/' "$f"
    fi
  done
  echo "止めました。"
  echo
  status
}

undo() {
  $SUDO systemctl unmask dnf-makecache.timer dnf-makecache.service
  repo_files | while IFS= read -r f; do
    if [ -e "$f.bak-lean" ]; then $SUDO cp -p "$f.bak-lean" "$f" && $SUDO rm -f "$f.bak-lean"; fi
  done
  echo "元に戻しました（タイマーは、次の起動か、手で有効にしたときから動きます）。"
  echo
  status
}

case "${1:-status}" in
  status) status ;;
  apply) apply ;;
  undo) undo ;;
  *) echo "使い方: sh lean.sh [status|apply|undo]"; exit 1 ;;
esac
