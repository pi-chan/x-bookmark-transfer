# X Bookmark to Discord - 差分設計書: 送信先をNotionに変更

## 変更概要

送信先をDiscord WebhookからNotion APIに変更する。
Chrome拡張のDOM抽出・重複判定の仕組みはそのまま活かし、送信先とメッセージ形式のみ差し替える。

---

## 変更点

### 1. 送信先の変更

- **変更前**: Discord Webhook (`https://discord.com/api/webhooks/...`)
- **変更後**: Notion API (`https://api.notion.com/v1/pages`)

### 2. Notion DB スキーマ

Notion側に以下のプロパティを持つデータベースを事前に作成しておく。

| プロパティ名 | Notion型 | 説明 |
|---|---|---|
| タイトル | title | ツイート本文の抜粋（200文字以内） |
| URL | url | ツイートURL（`https://x.com/{user}/status/{id}`） |
| 投稿者 | rich_text | `@username（表示名）` |
| ステータス | select | `📥 Inbox` / `📦 Stock` / `✅ Done` |
| ポスト日時 | date | ツイートの投稿日時（DOMから抽出） |
| 取得日時 | date | Chrome拡張が送信した日時 |

- 新規レコードのステータスは常に `📥 Inbox` で作成する
- ポスト日時はDOMの `<time>` 要素の `datetime` 属性から取得する

### 3. Notionビュー（手動で作成）

拡張のスコープ外だが、以下のビューを手動で設定する想定。

- **Inboxビュー**: ステータスが `📥 Inbox`、ポスト日時の降順
- **Stockビュー**: ステータスが `📦 Stock`、ポスト日時の降順

### 4. DOM抽出の追加項目

既存の抽出項目に加えて以下を追加：

- **ポスト日時**: ツイート内の `<time>` 要素の `datetime` 属性（ISO 8601形式）

### 5. オプション画面の変更

- **削除**: Discord Webhook URL 入力欄
- **追加**: Notion API Key（Internal Integration Token）入力欄
- **追加**: Notion Database ID 入力欄

### 6. manifest.json の変更

```diff
  "host_permissions": [
-   "https://discord.com/api/webhooks/*"
+   "https://api.notion.com/*"
  ],
```

### 7. background.js の変更

Discord Webhook送信ロジックをNotion APIページ作成に差し替える。

#### リクエスト形式

```javascript
// POST https://api.notion.com/v1/pages
// Headers:
//   Authorization: Bearer {NOTION_API_KEY}
//   Notion-Version: 2022-06-28
//   Content-Type: application/json

{
  "parent": { "database_id": "{DATABASE_ID}" },
  "properties": {
    "タイトル": {
      "title": [{ "text": { "content": "ツイート本文抜粋" } }]
    },
    "URL": {
      "url": "https://x.com/username/status/1234567890"
    },
    "投稿者": {
      "rich_text": [{ "text": { "content": "@username（表示名）" } }]
    },
    "ステータス": {
      "select": { "name": "📥 Inbox" }
    },
    "ポスト日時": {
      "date": { "start": "2025-02-10T12:34:56.000Z" }
    },
    "取得日時": {
      "date": { "start": "2025-02-12T09:00:00.000Z" }
    }
  }
}
```

### 8. レート制限の変更

- **変更前**: Discord Webhook 30リクエスト/60秒 → 1秒インターバル
- **変更後**: Notion API 3リクエスト/秒 → 400msインターバルに短縮可能

---

## 変更しない箇所

- content.js のDOM抽出ロジック（ポスト日時抽出の追加のみ）
- chrome.storage.local による送信済みツイートIDの重複判定
- 拡張アイコン・バッジ表示
- 送信結果のトースト通知

---

## Notion側の事前準備（手動）

1. Notion で Internal Integration を作成し、API Keyを取得
2. データベースを作成し、上記スキーマのプロパティを設定
3. データベースにIntegrationを接続（Share → Invite）
4. Database IDを取得（DBページURLの末尾32文字）
5. オプション画面にAPI KeyとDatabase IDを入力
