# アプリの中身を、入れ直さずに更新する（OTA・自分のサーバー）

画面や機能の変更（JavaScript）を、IPA / APK を入れ直さずに、アプリへ届けます。
**ネイティブ部品の追加・権限の変更など、ネイティブが変わる更新は、今までどおり新しい IPA / APK が必要です。**

## しくみ（短く）

```
GitHub Actions ──作って署名──▶ あなたのサーバー（OCI）──▶ アプリが、起動のたびに確認して取得
 （秘密鍵はここだけ）          （保管して配るだけ）         取得した中身は、次の起動から使う
```

- **署名の秘密鍵は GitHub の Secrets にだけ**置きます。サーバーが乗っ取られても、偽の更新は作れません（アプリが署名を確かめて、断ります）。
- アプリは、自分の**ネイティブ部分の指紋**を送ります。サーバーは、同じ指紋の更新だけを返します。合わない更新が届くことはありません。
- **試験用アプリ**（名前は「Music space β」、本番とは別のアプリとして入ります）で先に試します。本番は、`ota/config.json` の `enabledFor` に `"prod"` を足すまで、更新を受け取りません。

## 手順

### 1. サーバーに入れる（OCI に SSH でつないで）

1. この `ota` フォルダの中の **`server.mjs`、`lib.mjs`、`deploy/` の 3 つのファイル**（`musicspace-ota.container`、`setup.sh`、`make-keys.sh`）を、サーバーの 1 つのフォルダにまとめて置きます（別途お渡しする `musicspace-ota-server.zip` を、そのまま展開すれば揃います）。
2. そのフォルダで:
   ```
   sh setup.sh
   ```
   最後に「起動しました: {"ok":true}」と出ます。**途中で出る「管理用トークン」を、必ず控えてください**（次の手順 3 で GitHub に入れます）。
3. Caddy に窓口を足します。`sudo nano /etc/caddy/Caddyfile` を開き、`144-24-127-172.sslip.io` のブロックの中（`respond 404` のような最後の行より上）に、`Caddyfile.snippet` の 3 行を足します。
   ```
   	handle /ota/* {
   		reverse_proxy 127.0.0.1:8789
   	}
   ```
   そのあと `sudo systemctl reload caddy`。確認:
   ```
   curl https://144-24-127-172.sslip.io/ota/health
   ```
   `{"ok":true}` が返れば成功です。（Caddyfile の構成が違って迷うときは、`sudo cat /etc/caddy/Caddyfile` の中身を見せてください。鍵の部分は伏せて構いません。）

### 2. 署名の鍵と証明書を作る（サーバーで）

```
sh make-keys.sh
```

Expo の公式の道具で作ります（1〜2 分かかります）。終わると、次の 2 つが画面に出ます。

- **`certificate.pem`**（公開してよい証明書）→ GitHub のリポジトリに、**`ota/certificate.pem`** という名前のファイルとして、そのまま貼り付けて作ります（Add file → Create new file）。
- **`private-key.pem`**（秘密鍵）→ GitHub の Settings → Secrets and variables → Actions → New repository secret で、名前 **`OTA_PRIVATE_KEY`**、値は画面に出た文字列を（`-----BEGIN` から `END-----` まで）そのまま。

貼り付けたら、サーバーから秘密鍵を消します: `rm ~/musicspace-ota/keys/private-key.pem`
（手順 1 で控えた管理用トークンも、同じく Secrets に **`OTA_ADMIN_TOKEN`** という名前で入れます。）

### 3. 試験用アプリを作る

GitHub の Actions → **Build iOS IPA (unsigned)** → Run workflow → **variant: trial**。
できた IPA（artifact 名は `MusicSpace-trial-unsigned-ipa`）を、いつもの方法で入れます。「Music space β」が、本番とは**別のアプリ**として入ります（Android は **Build Android APK** で同じ）。

### 4. 更新を配信してみる

1. 画面の文字を少し変えるなど、小さな変更をして GitHub に上げます。
2. Actions → **Publish an over-the-air update** → Run workflow → **channel: trial**。
3. 試験用アプリを**完全に閉じて、開き直します**。もう一度、閉じて開き直すと、新しい中身で動きます。
   （設定 → **中身の更新** で、「配信された版（日時）」と出れば、届いています。「更新を確認して取得」で、その場で確かめることもできます。）

### 5. 戻す（壊れた更新を出してしまったとき）

Actions → **Roll back an over-the-air update** → channel を選んで Run。アプリは、IPA / APK に入っている版へ戻ります。直した更新を配信すれば、また新しい中身になります。

### 6. 本番にも使う（試験用で確認できてから）

`ota/config.json` の `"enabledFor": ["trial"]` を `["trial", "prod"]` にして、本番の IPA / APK を作り直します（一度だけ）。そのあとは、channel: **main** で配信します。

## 状態を見る

サーバーで（トークンは `~/musicspace-ota/ota.env` にあります）:

```
curl -H "Authorization: Bearer $(grep OTA_ADMIN_TOKEN ~/musicspace-ota/ota.env | cut -d= -f2)" https://144-24-127-172.sslip.io/ota/admin/status
```

- `updates`: いま配っている更新（チャンネル、ネイティブの指紋、日時、署名の有無）
- `requests`: どの指紋のアプリが、何回、確認に来たか。**配信した更新の指紋と、アプリの指紋が違う**と、そのアプリには何も届きません（ここで見つけられます）
- ログ: `journalctl --user -u musicspace-ota.service -n 50 --no-pager`

## うまくいかないとき

| 症状 | 見るところ |
|---|---|
| Actions の公開で「401」 | Secrets の `OTA_ADMIN_TOKEN` が、サーバーの `ota.env` の値と同じか |
| 「署名が証明書と合いません」 | `OTA_PRIVATE_KEY` と `ota/certificate.pem` が、同じ組み合わせか（`make-keys.sh` の出力）。サーバーの証明書は `~/musicspace-ota/app/certificate.pem` |
| 公開は成功するが、アプリに届かない | `status` の `requests` に、アプリの指紋が出ているか。公開時の指紋（Actions のログの `native=…`）と同じか。違えば、そのアプリの IPA を作り直すか、同じ状態で公開し直します |
| アプリの「中身の更新」に「取得できませんでした（…）」 | 括弧の中が理由です。多くは、通信できない・証明書が合わない・サーバーの Caddy の窓口がない |
| `make-keys.sh` が失敗する | サーバーがネットにつながっているか。うまくいかなければ、出力をそのまま見せてください |
| 更新後に、アプリが起動しない | アプリは、起動に失敗した更新を自分で外し、IPA に入っている版で動きます（設定の「中身の更新」に理由が出ます）。そのうえで「戻す」を実行します |

## 守っていること

- 秘密鍵はサーバーに置きません（GitHub の Secrets にだけ）。置いたままにしないでください。
- 更新は**署名つき**だけです。サーバーも、証明書で署名を確かめてから受け取ります。
- 管理用の窓口（アップロード・公開）は、トークンが必要です。窓口は HTTPS（Caddy）だけで、サーバー自身は、この機械の中からしか見えません。
- 古い更新は、10 件まで残し、使われない資産は自動で消します。
