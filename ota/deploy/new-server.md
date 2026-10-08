# 新しいサーバーを作るとき（または、作り直すとき）

いまのアドレスは **`https://130-210-45-154.sslip.io`** です。サーバーの公開IPの `.` を `-` に替えて、`.sslip.io` を付けた名前です（IPが変わると、名前も変わります）。

OS は Oracle Linux 9（ユーザー名 `opc`）、メモリ約1GBを想定しています。**Node は、ホストに入れません**（すべてコンテナです）。

## 1. サーバー側（上から順に）

1. **OCI のコンソール:** セキュリティ・リストの「イングレス・ルール」に、`0.0.0.0/0`・TCP・ポート 80 と 443 を追加します（1ルールに1ポート）。
2. **スワップを、先に作ります**（メモリ約1GBでは、`dnf` が強制終了されます）。
   ```
   sudo fallocate -l 2G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
   sudo mkdir -p /var/log/journal && sudo systemctl restart systemd-journald
   free -h
   ```
   `swapon: swapfile has holes` と出たら、1行目を `sudo dd if=/dev/zero of=/swapfile bs=1M count=2048` に替えます。
3. **パッケージ**（重い2つの一覧を外します）:
   ```
   sudo dnf install -y --disablerepo=ol9_oci_included --disablerepo=ol9_ksplice podman unzip
   sudo firewall-cmd --permanent --add-service=http --add-service=https
   sudo firewall-cmd --reload
   sudo loginctl enable-linger opc
   ```
   それでも `Killed` なら:
   `sudo dnf install -y --disablerepo='*' --enablerepo=ol9_baseos_latest --enablerepo=ol9_appstream podman unzip`
4. **トークンサーバー:** `~/.config/containers/systemd/bgutil.container` を作ります。
   ```
   [Unit]
   Description=bgutil PO token provider
   [Container]
   Environment=NODE_OPTIONS=--max-old-space-size=256
   Image=docker.io/brainicism/bgutil-ytdlp-pot-provider
   PublishPort=127.0.0.1:4416:4416
   PodmanArgs=--init --memory=500m --memory-swap=500m
   [Service]
   Restart=always
   RestartSec=5
   [Install]
   WantedBy=default.target
   ```
   ```
   systemctl --user daemon-reload
   systemctl --user start bgutil.service
   sleep 10; curl -s http://127.0.0.1:4416/ping
   ```
5. **合言葉と Caddy:** `KEY=$(openssl rand -hex 16); echo "合言葉: $KEY"` で合言葉を作り、`/etc/caddy/Caddyfile` を作ります。
   ```
   130-210-45-154.sslip.io {
   	@ok {
   		path /ping /get_pot
   		header X-Api-Key <合言葉>
   	}
   	handle @ok {
   		reverse_proxy 127.0.0.1:4416
   	}
   	handle /ota/* {
   		reverse_proxy 127.0.0.1:8789
   	}
   	handle {
   		respond "unauthorized" 401
   	}
   }
   ```
   ```
   sudo podman run -d --name caddy --restart=always --network host \
     -v /etc/caddy/Caddyfile:/etc/caddy/Caddyfile:Z -v caddy_data:/data \
     docker.io/library/caddy:2
   sudo systemctl enable --now podman-restart.service
   ```
   設定を変えたときの反映: `sudo podman exec caddy caddy reload --config /etc/caddy/Caddyfile`
   確認（PC）: `curl.exe -s https://130-210-45-154.sslip.io/ping -H "X-Api-Key: <合言葉>"` は `{"server_uptime":…`、合言葉なしは `Unauthorized`。
6. **更新サーバー:** `musicspace-ota-server.zip` を PC から送ります（`scp -i <鍵> <zip> opc@<IP>:~/`）。
   - **`make-keys.sh` は、実行しません。** 新しく鍵を作ると、今の試験用アプリが、更新を受け取れなくなります。
   - リポジトリの `ota/certificate.pem` の中身を、`~/musicspace-ota/keys/certificate.pem` に置きます（`mkdir -p ~/musicspace-ota/keys` のあと `nano` で貼ります）。
   - zip を展開したフォルダで、`sh setup.sh` を実行します。表示される**管理用トークン**を、メモします。
   - 確認（サーバー）: `curl -s http://127.0.0.1:8789/ota/health` が `{"ok":true}`。
   - 確認（PC）: `curl.exe -s https://130-210-45-154.sslip.io/ota/health` が `{"ok":true}`。
   - アドレスの確認: `grep OTA_PUBLIC_BASE ~/musicspace-ota/ota.env` が `https://130-210-45-154.sslip.io` であること。違っていたら、次で直します。
     ```
     sed -i 's#^OTA_PUBLIC_BASE=.*#OTA_PUBLIC_BASE=https://130-210-45-154.sslip.io#' ~/musicspace-ota/ota.env
     systemctl --user restart musicspace-ota.service
     ```

## 2. GitHub 側

- Secrets の **`OTA_ADMIN_TOKEN`** を、新しい管理用トークンに書き換えます（`grep OTA_ADMIN_TOKEN ~/musicspace-ota/ota.env` で、サーバーで見られます。`OTA_PRIVATE_KEY` は、そのままです）。
- `ota/config.json` の `serverBase` が `https://130-210-45-154.sslip.io` になっていることを確かめます。
- **試験用アプリのビルド**（Actions → Build iOS IPA → variant: trial）を作り直して、入れ直します。古い試験用アプリには、前のアドレスが埋め込まれているので、更新を受け取れません。
- そのあと、Actions → Publish an over-the-air update → channel: trial で公開して、試験用アプリを2回開き直します。

## 3. アプリ側
設定の「トークンサーバー」に、URL `https://130-210-45-154.sslip.io` と、合言葉を入れて、「接続テスト」を押します。

## あとで、名前を変えたくなったら（任意）
IPが変わっても、アプリの作り直しを避けたいときは、DuckDNS の名前（`musicspace.duckdns.org`）に切り替えます。DuckDNS の IP を書き換えて、Caddyfile の1行目に名前を足し、`ota/config.json` と `OTA_PUBLIC_BASE` を新しい名前にして、**試験用アプリのビルドを、もう1回**作ります。そのあとは、サーバーを替えても、DuckDNS の IP を書き換えるだけで済みます。
