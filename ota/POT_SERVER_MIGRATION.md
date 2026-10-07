# PO Token Server 移行ガイド（Podman + Caddy）

削除されたサーバーと同じ構成を新しい OCI インスタンスに復旧します。

## 前提条件

- **OCI Compute Instance**: VM.Standard.E2.1.Small 以上（2GB メモリ推奨）
- **OS**: Oracle Linux 8/9
- **アカウント**: opc ユーザー

---

## 1. インスタンス作成

OCI Console:
```
Compute → Instances → Create Compute Instance

設定:
✓ Name: musicspace-pot-server
✓ Shape: VM.Standard.E2.1.Small（2GB）
✓ Image: Oracle Linux 8 or 9
✓ VCN: 既存 VCN 選択
✓ Public IP: Assign a public IPv4 address ✓
```

作成後、新しい **パブリック IP** をメモしておく。

---

## 2. SSH 接続

```bash
ssh -i your-ssh-key.key opc@<新パブリックIP>
```

---

## 3. システム初期設定

```bash
# システムアップデート
sudo yum update -y

# 必要なパッケージ
sudo yum install -y \
  podman \
  caddy \
  wget curl htop \
  policycoreutils-python-utils
```

---

## 4. スワップ設定（2GB）

メモリ不足対策：

```bash
# 2GB のスワップを作成
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# 永続化
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 確認
free -h

# swappiness 設定（スワップ使用を抑制）
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

---

## 5. ジャーナルログ永続化

再起動後もログを残す：

```bash
# ジャーナルディレクトリ作成
sudo mkdir -p /var/log/journal
sudo chown root:systemd-journal /var/log/journal
sudo chmod 2755 /var/log/journal

# systemd 設定
echo 'Storage=persistent' | sudo tee -a /etc/systemd/journald.conf

# 再起動して反映
sudo systemctl restart systemd-journald
```

---

## 6. Podman コンテナの自動起動設定

opc ユーザーで Podman を使うための設定：

```bash
# loginctl で linger を有効化
sudo loginctl enable-linger opc

# Podman systemd ディレクトリ作成
mkdir -p ~/.config/containers/systemd
```

---

## 7. bgutil-ytdlp-pot-provider コンテナ設定

```bash
# コンテナ systemd ファイル作成
cat > ~/.config/containers/systemd/bgutil.container << 'EOF'
[Unit]
Description=bgutil-ytdlp-pot-provider (PO Token Server)
After=network-online.target
Wants=network-online.target

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
EOF

chmod 644 ~/.config/containers/systemd/bgutil.container
```

---

## 8. コンテナの起動テスト

```bash
# ユーザーセッション systemd の再読み込み
systemctl --user daemon-reload

# コンテナの状態確認
systemctl --user status bgutil.service

# ログ確認
journalctl --user -u bgutil.service -n 20

# メモリ確認
podman inspect bgutil | grep -A 5 '"Memory"'
# 出力: `"Memory": 524288000` = 500M
```

---

## 9. Caddy 設定（HTTPS 窓口）

```bash
# Caddyfile 作成
sudo tee /etc/caddy/Caddyfile > /dev/null << 'EOF'
# 自分の IP から自動ドメイン生成
# 例: 144.24.127.172 → 144-24-127-172.sslip.io

144-24-127-172.sslip.io {
  reverse_proxy 127.0.0.1:4416 {
    header_uri X-Api-Key {http.request.header.X-Api-Key}
  }
  
  # ログ設定
  log {
    level INFO
    output file /var/log/caddy/access.log {
      roll_size 100mb
      roll_keep 5
    }
  }
}
EOF

# Caddy 起動
sudo systemctl enable caddy
sudo systemctl start caddy

# 確認
sudo systemctl status caddy
```

**IP → ドメイン変換例:**
```
IP: 144.24.127.172
ドメイン: 144-24-127-172.sslip.io
```

---

## 10. OCI セキュリティ リスト設定

OCI Console:

1. **Compute** → **Instances** → インスタンス選択
2. **Attached VNICs** → VNIC をクリック
3. **Security Lists** → Security List をクリック
4. **Ingress Rules** → **Add Ingress Rule**

**2つのルール追加:**

**ルール1: HTTP**
- Protocol: TCP
- Source: 0.0.0.0/0
- Destination Port Range: **80**

**ルール2: HTTPS**
- Protocol: TCP
- Source: 0.0.0.0/0
- Destination Port Range: **443**

---

## 11. 動作確認

### ローカルテスト（SSH 中）

```bash
# ヘルスチェック
curl -X GET http://127.0.0.1:4416/ping

# トークン生成テスト（API キーなし）
curl -X POST http://127.0.0.1:4416/get_pot \
  -H "Content-Type: application/json" \
  -d '{"content_binding":"dQw4w9WgXcQ"}'
```

### 外部からのテスト（PC から）

```bash
# HTTPS でテスト
curl -X POST https://144-24-127-172.sslip.io/get_pot \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: your-secret-key" \
  -d '{"content_binding":"dQw4w9WgXcQ"}'

# 期待される応答
# {"poToken":"...","expiresAt":"2026-10-08T...Z"}
```

---

## 12. アプリ側設定

Music space アプリの Settings:

- **POT Server URL**: `https://144-24-127-172.sslip.io`
- **POT Server Key**: `your-secret-key`

（IP と API キーは自分の値に置き換え）

---

## 13. 監視コマンド

### コンテナ再起動なし確認

```bash
systemctl --user show bgutil.service -p NRestarts -p ActiveEnterTimestamp

# 出力例: NRestarts=0 → 一度も異常終了なし
```

### メモリ状態確認

```bash
free -h
# スワップが利用可能か確認

df -h
# ディスク容量確認
```

### ログ確認

```bash
# 最新 50 行
journalctl --user -u bgutil.service -n 50 -f

# エラーのみ
journalctl --user -u bgutil.service -p err
```

### Caddy ログ

```bash
sudo tail -f /var/log/caddy/access.log
```

---

## トラブルシューティング

### コンテナが起動しない

```bash
# systemd 再読み込み
systemctl --user daemon-reload

# 詳細ログ
journalctl --user -u bgutil.service -n 100

# 手動で podman run テスト
podman run --rm -it \
  -e NODE_OPTIONS=--max-old-space-size=256 \
  -p 4416:4416 \
  --memory=500m --memory-swap=500m \
  docker.io/brainicism/bgutil-ytdlp-pot-provider
```

### HTTPS が機能しない

```bash
# Caddy ステータス確認
sudo systemctl status caddy

# Caddy ログ
sudo tail -f /var/log/caddy/error.log

# SSL 証明書確認
curl -v https://144-24-127-172.sslip.io
```

### メモリ不足

```bash
# 現在の利用状況
free -h
ps aux --sort=-%mem | head -10

# コンテナメモリ上限確認
podman stats bgutil

# 必要に応じてメモリ上限を調整（bgutil.container）
# --memory=500m → --memory=750m など
```

---

## セキュリティチェックリスト

- ✓ `/ping` エンドポイント → 認証なし
- ✓ `/get_pot` エンドポイント → X-Api-Key 必須
- ✓ OCI ファイアウォール（80, 443 のみ）
- ✓ Caddy で HTTPS 化
- ✓ HTTPS でのアクセスのみ推奨

---

## まとめ

| 項目 | 設定値 |
|-----|--------|
| コンテナ | bgutil-ytdlp-pot-provider |
| メモリ上限 | 500MB（スワップなし） |
| HTTPS | Caddy + sslip.io |
| 自動起動 | systemd (loginctl linger) |
| 再起動ポリシー | always, 5秒待機 |
| スワップ | 2GB（swappiness=10） |

完了後、アプリ側で URL とキーを設定すれば、トークン生成が開始されます。
