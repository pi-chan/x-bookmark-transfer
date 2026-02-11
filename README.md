# X Bookmark to Discord

X (Twitter) のブックマークページを開くと、新しいブックマークを自動で Discord チャンネルへ送信する Chrome 拡張機能です。

## 背景

X のブックマークを「あとで読む」インボックスとして使っている場合、複数アカウントに散らばったブックマークを一元管理するのは手間がかかります。この拡張は、ブックマークページを開くだけで未送信のツイートを Discord Webhook 経由で自動送信し、Discord を統合インボックスとして活用できるようにします。

## 機能

- ブックマークページ (`x.com/i/bookmarks`) を開くと自動で動作
- ツイートの著者名、ハンドル、本文(200文字まで)、URL を Discord に送信
- 送信済みツイートを記憶し、同じツイートを二重送信しない
- 送信結果をトースト通知で表示
- 設定画面から Webhook URL の管理、送信履歴のクリアが可能

## 必要なもの

- Google Chrome (Manifest V3 対応)
- Discord サーバーの Webhook URL

## インストール

### 1. リポジトリを取得

```bash
git clone https://github.com/pi-chan/x-bookmark-transfer.git
```

### 2. Chrome に読み込む

1. Chrome で `chrome://extensions/` を開く
2. 右上の「デベロッパーモード」を有効にする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. クローンしたディレクトリを選択

## セットアップ

### Discord Webhook の作成

1. Discord サーバーで、送信先チャンネル (例: `#inbox-x`) の設定を開く
2. 「連携サービス」 > 「ウェブフック」 > 「新しいウェブフック」をクリック
3. Webhook URL をコピー

### 拡張機能の設定

1. Chrome ツールバーの拡張機能アイコンをクリック（またはアイコンを右クリック > 「オプション」）
2. Webhook URL 欄にコピーした URL を貼り付ける
3. 「保存」をクリック

## 使い方

1. X (`x.com`) にログインする
2. ブックマークページ (`x.com/i/bookmarks`) を開く
3. 画面に表示されているツイートが自動的に Discord へ送信される
4. 右下にトースト通知が表示され、送信件数を確認できる

### Discord 側での運用例

- 受信したメッセージに対してリアクション（例: チェックマーク）を付けて既読管理
- 重要なツイートは別チャンネルへ転送して整理

## 送信メッセージの形式

```
@handle (Display Name)
ツイートの本文テキスト（200文字まで）...
https://x.com/handle/status/123456789
```

URL をそのまま送信するため、Discord のプレビュー機能でツイートの内容が展開されます。

## 設定画面

| 項目 | 説明 |
|------|------|
| Webhook URL | Discord Webhook の URL。`https://discord.com/api/webhooks/...` の形式 |
| 送信済みツイート数 | これまでに送信したツイートの件数を表示 |
| 送信済みIDをクリア | 送信履歴をリセット（確認ダイアログあり） |

## 技術仕様

- Manifest V3 準拠
- ビルド不要（素の JavaScript で動作）
- Content Script: DOM からツイート情報を抽出
- Background Service Worker: Discord Webhook への送信を管理
- 送信済み ID は `chrome.storage.local` に保存（最大 10,000 件、超過時は古い順に削除）
- Discord レート制限に配慮し、送信間隔は 1 秒

## テスト

```bash
node --test tests/unit.test.mjs
```

## 制限事項

- 現在のバージョンでは、ページ読み込み時に表示されているツイートのみ処理（自動スクロール未対応）
- Chrome 専用（Firefox 非対応）
- X の DOM 構造変更により動作しなくなる可能性がある

## ライセンス

MIT
