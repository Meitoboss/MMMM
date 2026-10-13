#!/bin/sh
# Makes the signing key and certificate with Expo's own tool (so the format is exactly what the app expects),
# gives the certificate to the server, and prints both so that you can put them on GitHub.   sh make-keys.sh
set -eu
BASE="${OTA_HOME:-$HOME/musicspace-ota}"
mkdir -p "$BASE/keys" "$BASE/app"
cd "$BASE/keys"
if [ -f private-key.pem ] || [ -f certificate.pem ]; then
  echo "鍵か証明書がすでにあります（$BASE/keys）。作り直すと、入っているアプリは更新を受け取れなくなります。"
  echo "本当に作り直すときは、先にそのファイルを退避してください。"
  exit 1
fi
rm -rf work && mkdir work
# a memory cap, so that this short job cannot starve the token server on a small machine
podman run --rm --memory=400m --memory-swap=800m -v "$BASE/keys/work:/out:Z" -w /out docker.io/library/node:22-alpine \
  sh -c "npx -y expo-updates@~29.0.0 codesigning:generate --key-output-directory keys --certificate-output-directory certs --certificate-validity-duration-years 10 --certificate-common-name 'Music space'"
KEY=$(find work -name 'private-key.pem' | head -n 1)
CERT=$(find work -name 'certificate.pem' | head -n 1)
[ -n "$KEY" ] && [ -n "$CERT" ] || { echo "鍵と証明書ができませんでした（ota/README.md の「うまくいかないとき」を見てください）"; exit 1; }
mv "$KEY" private-key.pem
mv "$CERT" certificate.pem
rm -rf work
chmod 600 private-key.pem
cp certificate.pem "$BASE/app/certificate.pem"
systemctl --user restart musicspace-ota.service
echo
echo "===== certificate.pem（GitHub の  ota/certificate.pem  というファイルに、そのまま貼り付けます）====="
cat certificate.pem
echo
echo "===== private-key.pem（GitHub の Secrets「OTA_PRIVATE_KEY」に、そのまま貼り付けます。誰にも見せないでください）====="
cat private-key.pem
echo
echo "貼り付けたら、サーバーから秘密鍵を消してください（サーバーが乗っ取られても偽の更新が作れないように）:"
echo "    rm $BASE/keys/private-key.pem"
