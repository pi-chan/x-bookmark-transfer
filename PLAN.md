
X Bookmark to Discord - Chrome拡張 設計書

## 概要

Xの複数アカウントのブックマークを、Discord自鯖の `#inbox-x` チャンネルに自動送信するChrome拡張。
API不要・Webhookベースでシンプルに運用する。

## 背景・課題

- Xの複数アカウントにブックマークが分散している
- ブックマークはインボックス用途（消化したら消す）
- X APIの有料プラン（$200/月〜）は使いたくない
- iPhoneでのXブックマークのワンタップ感は維持したい
- 集約先はDiscord自鯖（1人運用）

## 解決策

PCでXのブックマークページを開いた際に、Chrome拡張がDOM上のツイートを検出し、未送信分をDiscord Webhookで送信する。

---

## 機能要件

### F1: ブックマークページの自動検出

- `x.com/i/bookmarks` を開いた時に拡張が自動で動作開始する
- Content Scriptで対象ページにのみ注入

### F2: ツイート情報の抽出

- ブックマークページのDOMからツイート情報を抽出する
- 抽出する情報:
  - **ツイートID**: URLパスの末尾数値（`/status/1234567890`）
  - **ツイートURL**: `https://x.com/{user}/status/{id}`
  - **投稿者名**: 表示名
  - **投稿者ハンドル**: `@username`
  - **本文テキスト**: ツイート本文（truncateしてよい、目安200文字）
- 画像・動画の抽出は不要（URLを開けば見れるため）

### F3: 重複判定

- 送信済みツイートIDを `chrome.storage.local` に保存
- 同一プロファイル内で共有されるため、Xアカウント切り替えをしても同じIDセットを参照
- アカウントAとBで同じツイートをブックマークしていても1回のみ送信

### F4: Discord Webhook送信

- 未送信ツイートをDiscord Webhookで `#inbox-x` チャンネルに送信
- Webhook URLはオプション画面で設定

#### メッセージフォーマット

```
🔖 @username（表示名）
本文テキスト（200文字以内）
https://x.com/username/status/1234567890
```

- Embed等は使わず、プレーンテキストで送信（DiscordがURLプレビューを自動生成するため）
- 1ツイート = 1メッセージで送信（消化時の ✅ リアクション運用と相性が良い）

### F5: 送信結果の通知

- ブックマークページ上にバッジまたはトースト通知で結果を表示
  - 例: 「3件送信しました」「新規ブックマークはありません」
- 拡張アイコンにバッジで未送信件数を表示

### F6: スクロール対応

- Xのブックマークページは無限スクロールで読み込まれる
- 初回は画面に表示されている分だけを対象とする
- 「もっと読み込む」ボタン or 自動スクロール機能は将来検討（v1ではスコープ外）

### F7: オプション画面

- Discord Webhook URL の設定
- 送信済みIDのクリア（デバッグ用）
- 送信済み件数の表示

---

## 非機能要件

### 技術スタック

- Manifest V3（Chrome拡張の最新仕様）
- TypeScriptは不要（Plain JS）
- ビルドツール不要（シンプルにファイルを並べるだけ）

### パフォーマンス

- Webhook送信はレート制限を考慮し、1メッセージごとに1秒のインターバルを設ける
- Discord Webhookのレート制限: 30リクエスト/60秒

### データ保存

- `chrome.storage.local` に送信済みツイートIDをSetとして保存
- キー: `sentTweetIds`
- 値: ツイートIDの配列（文字列）
- 上限管理: 10,000件を超えたら古い方から削除

### セキュリティ

- Webhook URLは `chrome.storage.local` に保存（sync不可：URLが機密情報のため）
- Content Scriptは `x.com/i/bookmarks` のみに注入

---

## ファイル構成

```
x-bookmark-to-discord/
├── manifest.json          # 拡張マニフェスト（Manifest V3）
├── content.js             # ブックマークページに注入されるスクリプト
├── background.js          # Service Worker（Webhook送信を担当）
├── options.html           # オプション画面
├── options.js             # オプション画面のロジック
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## manifest.json 概要

```json
{
  "manifest_version": 3,
  "name": "X Bookmark to Discord",
  "version": "1.0.0",
  "description": "Xのブックマークを自動でDiscordに送信する",
  "permissions": ["storage"],
  "host_permissions": ["https://discord.com/api/webhooks/*"],
  "content_scripts": [
    {
      "matches": ["https://x.com/i/bookmarks*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "background": {
    "service_worker": "background.js"
  },
  "options_ui": {
    "page": "options.html",
    "open_in_tab": true
  },
  "action": {
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

---

## 処理フロー

```
[ユーザーがx.com/i/bookmarksを開く]
        │
        ▼
[content.js] DOMからツイート一覧を抽出
        │
        ▼
[content.js] chrome.storage.localから送信済みIDを取得
        │
        ▼
[content.js] 差分（未送信ツイート）を算出
        │
        ├── 0件 → トースト「新規ブックマークはありません」
        │
        ▼ 1件以上
[content.js → background.js] メッセージ送信をリクエスト
        │
        ▼
[background.js] Discord Webhookに1件ずつ送信（1秒間隔）
        │
        ▼
[background.js] 送信成功したIDを chrome.storage.local に追記
        │
        ▼
[background.js → content.js] 結果を返す
        │
        ▼
[content.js] トースト「3件送信しました」
```

---

## DOM抽出の方針

XのDOMは頻繁に変更されるため、以下の戦略で安定性を高める：

1. ツイートURLのリンク要素（`a[href*="/status/"]`）をアンカーにする
2. そこから親要素を辿ってツイートのコンテナを特定する
3. コンテナ内から表示名・ハンドル・本文を取得する

**注意**: XのDOM構造は予告なく変わる可能性がある。抽出に失敗した場合は、最低限ツイートURLだけでも送信する（URLさえあればDiscordのプレビューで内容は確認できる）。

---

## Discord側のチャンネル構成（参考）

拡張のスコープ外だが、運用設計として記載。

```
📥 INBOX
  #inbox-x       ← この拡張が送信する先
  #inbox-web     ← その他のURL（手動ポスト）

📦 STOCK
  #stock-dev     ← 残したい開発系情報
  #stock-life    ← 残したい生活・趣味系情報
```

### 消化フロー

1. `#inbox-x` のメッセージを上から読む
2. 読んだら ✅ リアクションをつける
3. 不要なら捨てる、残したいなら stock チャンネルに転送
4. ✅ 付きメッセージは定期的に削除（Bot or 手動、将来検討）

---

## スコープ外（将来検討）

- [ ] 自動スクロールによる全ブックマーク取得
- [ ] ✅ リアクション付きメッセージの自動削除Bot
- [ ] stockチャンネルへの転送コマンドBot
- [ ] Firefox対応
- [ ] ツイートの画像サムネイル送信（Embed利用）
- [ ] 送信済みIDの外部同期（複数PC対応）
