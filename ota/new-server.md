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

## ときどき繋がらないとき

アプリは、トークンサーバーが**8秒**で答えないことが**2回**続くと、**3分間**、問い合わせをやめて、スマートフォンだけの方法で再生します。サーバーが一瞬重くなっただけでも、「しばらく繋がらない」ように見えます。

### 1. 繋がらないその瞬間に、PC で（どこで止まるかが分かります）
```
curl.exe -m 15 -s -o NUL -w "code=%{http_code}  dns=%{time_namelookup}s  connect=%{time_connect}s  tls=%{time_appconnect}s  total=%{time_total}s`n" https://130-210-45-154.sslip.io/ota/health
```
（表示は、code = コード、dns = 名前解決、connect = 接続、tls = TLS、total = 合計、です。日本語の表示にすると、PowerShell で文字化けします）

| 結果 | 意味 |
|---|---|
| dns（名前解決）が遅い、または失敗 | sslip.io（名前を引く無料サービス）の一時的な不調。サーバーの問題ではありません |
| connect（接続）が 0 秒のまま（code=000、total が 15 秒） | 名前は引けたのに、**機械に届いていません**。機械が止まっている／固まっている、OCI のネットワーク、または公開IPが変わった、のどれかです |
| tls が遅い、または失敗 | Caddy の問題（証明書の更新中など） |
| code=502 | Caddy は動いていますが、後ろのサーバー（トークン／更新）が止まっています |
| code=200 で、total が数秒以上 | サーバーが、遅くなっています（メモリ不足の疑い。アプリは8秒で諦めます） |

### 1.5 ポートごとに届くか（PC の PowerShell）
```
Test-NetConnection 130.210.45.154 -Port 22
Test-NetConnection 130.210.45.154 -Port 443
```
`TcpTestSucceeded : True` なら、そのポートに届いています。**22 も 443 も False** なら、機械か OCI のネットワークです。**22 は True で 443 だけ False** なら、Caddy か、機械の中のファイアウォールです。

### 2. その瞬間に、サーバーで（SSH でつながるなら）
```
uptime
free -m
ss -ltn | grep -E ':(80|443) '
systemctl --user show bgutil.service -p NRestarts -p ActiveEnterTimestamp
podman ps -a --format "{{.Names}} {{.Status}}"
sudo podman ps -a --format "{{.Names}} {{.Status}}"
sudo dmesg | grep -iE "out of memory|killed process" | tail -3
```
SSH も、つながらない（固まる）ときは、サーバー全体が止まっています。OCI のコンソールで、そのインスタンスの状態（実行中／停止）を見て、再起動します。Oracle は、長く使われていない Always Free のインスタンスを、止めることがあるため、状態が「停止」なら、その知らせ（メール）も確認してください。

### 3. 起きていない間の様子を、記録する
サーバーに、1分ごとに1行ずつ書き留める記録係を入れられます（何も変えません。root も不要です）。
```
（zip を展開したフォルダで）sh healthlog.sh     入れて、始める。入れると、~/healthlog/ に自分の写しを作るので、あとは、どのフォルダからでも、使えます
sh ~/healthlog/healthlog.sh problems     問題のあった行だけ（サービスが200以外、遅い、空きメモリ150MB未満、メモリ待ち、ポートが閉じている）
sh ~/healthlog/healthlog.sh show         最後の行
sh ~/healthlog/healthlog.sh stop         止める（記録は残ります）
```
記録は `~/healthlog/` に、14日分ためます。繋がらなかった時刻の前後の行を見れば、「メモリが減っていた」「サービスが200を返していなかった」などが分かります。

### 4. アプリ側の記録（スマートフォンが見た様子）
設定 →「トークンサーバー」→「通信の記録」に、トークンサーバーへの**1回ごと**の結果（時刻、成功か失敗か、かかった時間）が、残ります。直近24時間の数字と、読み方（「時間切れが多い」「つながらないが多い」「サーバーのエラーが多い」）、最近の失敗の時刻が出ます。「共有」で、全部の記録を、文章として、送れます。
- PC の記録（上の1）、サーバーの記録（上の3）、アプリの記録を、**同じ時刻で並べる**と、「回線の問題」か「サーバーの問題」かが分かります。
- アプリは、サーバーが8秒答えない状態が2回続くと、3分間、問い合わせをやめます。その間は「休止中」と記録されます。
- 曲を1曲始めるとき、トークンを2〜4個、同時に頼むので、1回の不調が、複数の記録になります。

## 固まって、SSH もつながらないとき

機械全体が固まっています（サービス1つの不調ではありません）。メモリが足りなくなって、機械が、スワップに追われて動けなくなる、というのが、典型的な形です。再起動すれば戻りますが、**再起動する前に**、原因の手がかりを、取っておきます。

### 再起動する前に（OCI のコンソールで）
1. インスタンスの詳細 →「監視」（Monitoring）で、**CPU 使用率**、**ディスクの読み書き**、**インスタンスの到達可能状態**（Instance accessibility status）を見ます。到達できない状態になっていれば、機械が、固まっています。固まる直前に、CPU やディスクが、急に増えていれば、メモリ不足の疑いが、濃くなります。
2. インスタンスの詳細 →「リソース」→「コンソール履歴」（Console history）→ 取得（Capture）→ ダウンロード。固まった機械の、直近の画面出力（カーネルのメッセージを含む、最大1MB）が残ります。`Out of memory`、`Killed process`、`blocked for more than 120 seconds` などの行を探します。（Oracle の資料には、取得の前に、「インスタンス・コンソール接続」を作るよう書かれているものもあります）
3. そのあとで、再起動します（反応しなければ「強制再起動」）。

### 再起動したあとに（サーバーで）
```
sh ~/healthlog/healthlog.sh gaps       記録が途切れた所（固まっていた時間と、その直前の様子）
sh ~/healthlog/healthlog.sh crash      前回の起動の、最後の様子（メモリ不足の跡）
sh ~/healthlog/healthlog.sh show 120   直近2時間の記録
```
`gaps` の「直前の3行」の `avail`（空きメモリ）が減っていたり、`psi`（メモリ待ち）が大きかったり、`top`（大きい順）に1つだけ大きなプログラムがいたりすれば、そのプログラムが原因です。

### 固まっても、自動で戻るようにする
```
sh selfheal.sh install     入れる（sudo を使います）
sh selfheal.sh status      いまの様子
sh selfheal.sh remove      外す
```
systemd が、30秒ごとに、ソフトウェアのウォッチドッグへ「生きている」と知らせます。機械が固まって、**60秒たっても知らせが止まったまま**なら、機械が自分で再起動します。再起動のあと、トークンサーバー、更新サーバー、Caddy は、自動で戻ります。カーネルのパニックも、30秒後に再起動になります。**固まった原因を、直すものではありません**（原因は、`gaps` と `crash` で調べます）。変えるのは、`/etc` の小さな4つのファイルだけです。

### 記録を、残るようにしておく
`sh ~/healthlog/healthlog.sh crash` が「記録が残っていません」と言ったときは、次を1回だけ実行します。
```
sudo mkdir -p /var/log/journal
sudo systemctl restart systemd-journald
```
