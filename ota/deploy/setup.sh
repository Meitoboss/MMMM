#!/bin/sh
# Installs the Music space update server as a small service (rootless Podman + systemd, like the token server).
# Run it from the folder that holds server.mjs, lib.mjs and musicspace-ota.container:   sh setup.sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
BASE="${OTA_HOME:-$HOME/musicspace-ota}"
PUBLIC_BASE="${OTA_PUBLIC_BASE:-https://144-24-127-172.sslip.io}"

for f in server.mjs lib.mjs musicspace-ota.container; do
  [ -f "$here/$f" ] || { echo "$f が見つかりません（zip を展開したフォルダで実行してください）"; exit 1; }
done

mkdir -p "$BASE/app" "$BASE/data" "$BASE/keys" "$HOME/.config/containers/systemd"
cp "$here/server.mjs" "$here/lib.mjs" "$BASE/app/"
[ -f "$BASE/keys/certificate.pem" ] && cp "$BASE/keys/certificate.pem" "$BASE/app/certificate.pem"

if [ ! -f "$BASE/ota.env" ]; then
  TOKEN=$(openssl rand -hex 32)
  umask 077
  cat > "$BASE/ota.env" <<ENV
OTA_PUBLIC_BASE=$PUBLIC_BASE
OTA_ADMIN_TOKEN=$TOKEN
OTA_DATA=/data
OTA_PORT=8789
OTA_HOST=0.0.0.0
OTA_CERT=/app/certificate.pem
OTA_KEEP=10
ENV
  echo
  echo "===== 管理用トークン（GitHub の Secrets「OTA_ADMIN_TOKEN」に入れます）====="
  echo "$TOKEN"
  echo "===== （このあとも $BASE/ota.env で見られます）====="
  echo
else
  echo "既存の設定を使います: $BASE/ota.env"
fi

sed "s#__BASE__#$BASE#g" "$here/musicspace-ota.container" > "$HOME/.config/containers/systemd/musicspace-ota.container"
systemctl --user daemon-reload
systemctl --user restart musicspace-ota.service
echo "起動を待っています…（初回は Node のイメージを取得するので、1〜2分かかります）"
i=0
until curl -fsS http://127.0.0.1:8789/ota/health >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 90 ]; then
    echo "起動できませんでした。次で理由を見てください:  journalctl --user -u musicspace-ota.service -n 40 --no-pager"
    exit 1
  fi
  sleep 2
done
echo "起動しました: $(curl -fsS http://127.0.0.1:8789/ota/health)"
[ -f "$BASE/app/certificate.pem" ] || echo "※ 署名用の証明書はまだありません。次に  sh make-keys.sh  を実行してください。"
