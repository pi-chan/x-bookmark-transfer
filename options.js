'use strict';

const NOTION_API_KEY_PATTERN = /^(ntn_|secret_)[A-Za-z0-9]+$/;
const DATABASE_ID_PATTERN = /^[a-f0-9]{32}$/;

function normalizeDatabaseId(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const stripped = raw.replace(/-/g, '').toLowerCase();
  if (DATABASE_ID_PATTERN.test(stripped)) return stripped;
  return null;
}

document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('notion-api-key');
  const databaseIdInput = document.getElementById('notion-database-id');
  const saveBtn = document.getElementById('save-btn');
  const saveStatus = document.getElementById('save-status');
  const sentCountEl = document.getElementById('sent-count');
  const clearBtn = document.getElementById('clear-btn');
  const clearStatus = document.getElementById('clear-status');

  let hasExistingApiKey = false;

  loadSettings();

  saveBtn.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    const rawDbId = databaseIdInput.value.trim();

    const updates = {};

    if (apiKey) {
      if (!NOTION_API_KEY_PATTERN.test(apiKey)) {
        showStatus(saveStatus, 'API Keyの形式が正しくありません (ntn_ または secret_ で始まる必要があります)', 'error');
        return;
      }
      updates.notionApiKey = apiKey;
    } else if (!hasExistingApiKey) {
      showStatus(saveStatus, 'API Keyを入力してください', 'error');
      return;
    }

    if (!rawDbId) {
      showStatus(saveStatus, 'Database IDを入力してください', 'error');
      return;
    }

    const databaseId = normalizeDatabaseId(rawDbId);
    if (!databaseId) {
      showStatus(saveStatus, 'Database IDの形式が正しくありません (32文字の16進数)', 'error');
      return;
    }
    updates.notionDatabaseId = databaseId;

    chrome.storage.local.set(updates, () => {
      if (updates.notionApiKey) {
        hasExistingApiKey = true;
        apiKeyInput.value = '';
        apiKeyInput.placeholder = '(設定済み - 変更する場合は新しいキーを入力)';
      }
      showStatus(saveStatus, '保存しました', 'success');
    });
  });

  clearBtn.addEventListener('click', () => {
    if (!confirm('送信済みIDをすべてクリアしますか？\n次回ブックマークページを開いた際に、すべてのブックマークが再送信されます。')) {
      return;
    }

    chrome.storage.local.set({ sentTweetIds: [] }, () => {
      sentCountEl.textContent = '0';
      showStatus(clearStatus, 'クリアしました', 'success');
    });
  });

  function loadSettings() {
    chrome.storage.local.get(['notionApiKey', 'notionDatabaseId', 'sentTweetIds'], (result) => {
      if (result.notionApiKey) {
        hasExistingApiKey = true;
        apiKeyInput.placeholder = '(設定済み - 変更する場合は新しいキーを入力)';
      }
      if (result.notionDatabaseId) {
        databaseIdInput.value = result.notionDatabaseId;
      }
      const ids = result.sentTweetIds || [];
      sentCountEl.textContent = String(ids.length);
    });
  }

  function showStatus(el, message, type) {
    el.textContent = message;
    el.className = `status ${type}`;

    setTimeout(() => {
      el.textContent = '';
      el.className = 'status';
    }, 3000);
  }
});
