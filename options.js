'use strict';

const WEBHOOK_URL_PATTERN = /^https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w-]+$/;

document.addEventListener('DOMContentLoaded', () => {
  const webhookUrlInput = document.getElementById('webhook-url');
  const saveBtn = document.getElementById('save-btn');
  const saveStatus = document.getElementById('save-status');
  const sentCountEl = document.getElementById('sent-count');
  const clearBtn = document.getElementById('clear-btn');
  const clearStatus = document.getElementById('clear-status');

  loadSettings();

  saveBtn.addEventListener('click', () => {
    const url = webhookUrlInput.value.trim();

    if (!url) {
      showStatus(saveStatus, 'URLを入力してください', 'error');
      return;
    }

    if (!WEBHOOK_URL_PATTERN.test(url)) {
      showStatus(saveStatus, 'Discord Webhook URLの形式が正しくありません', 'error');
      return;
    }

    chrome.storage.local.set({ webhookUrl: url }, () => {
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
    chrome.storage.local.get(['webhookUrl', 'sentTweetIds'], (result) => {
      if (result.webhookUrl) {
        webhookUrlInput.value = result.webhookUrl;
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
