(function () {
  'use strict';

  const TOAST_DURATION_MS = 3000;
  const TEXT_MAX_LENGTH = 200;
  const TWEET_WAIT_TIMEOUT_MS = 10000;

  function extractTweets() {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    const seen = new Set();
    const tweets = [];

    for (const article of articles) {
      const statusLink = article.querySelector('a[href*="/status/"]');
      if (!statusLink) continue;

      const href = statusLink.getAttribute('href');
      const match = href.match(/\/([^/]+)\/status\/(\d+)/);
      if (!match) continue;

      const [, username, tweetId] = match;
      if (seen.has(tweetId)) continue;
      seen.add(tweetId);

      const url = `https://x.com/${username}/status/${tweetId}`;
      const authorHandle = `@${username}`;
      const authorName = extractAuthorName(article) || username;
      const text = extractText(article);

      tweets.push({ id: tweetId, url, authorName, authorHandle, text });
    }

    return tweets;
  }

  function extractAuthorName(article) {
    const userNameEl = article.querySelector('[data-testid="User-Name"]');
    if (!userNameEl) return null;

    const spans = userNameEl.querySelectorAll('span');
    for (const span of spans) {
      const text = span.textContent.trim();
      if (text && !text.startsWith('@')) {
        return text;
      }
    }
    return null;
  }

  function extractText(article) {
    const tweetTextEl = article.querySelector('[data-testid="tweetText"]');
    if (!tweetTextEl) return '';

    const raw = tweetTextEl.textContent.trim();
    if (raw.length <= TEXT_MAX_LENGTH) return raw;
    return raw.slice(0, TEXT_MAX_LENGTH) + '...';
  }

  function waitForTweets() {
    return new Promise((resolve) => {
      const existing = document.querySelectorAll('article[data-testid="tweet"]');
      if (existing.length > 0) {
        resolve();
        return;
      }

      const observer = new MutationObserver((_mutations, obs) => {
        const articles = document.querySelectorAll('article[data-testid="tweet"]');
        if (articles.length > 0) {
          obs.disconnect();
          resolve();
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        resolve();
      }, TWEET_WAIT_TIMEOUT_MS);
    });
  }

  function showToast(message) {
    const existing = document.getElementById('xbd-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'xbd-toast';
    toast.textContent = message;
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      padding: '12px 20px',
      backgroundColor: 'rgba(29, 155, 240, 0.95)',
      color: '#fff',
      borderRadius: '8px',
      fontSize: '14px',
      fontWeight: '500',
      zIndex: '2147483647',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      transition: 'opacity 0.3s ease',
    });

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, TOAST_DURATION_MS);
  }

  async function run() {
    await waitForTweets();

    const tweets = extractTweets();
    if (tweets.length === 0) {
      console.log('[XBD] ブックマーク0件');
      showToast('ブックマークが見つかりませんでした');
      return;
    }

    const { sentTweetIds = [] } = await chrome.storage.local.get('sentTweetIds');
    const sentSet = new Set(sentTweetIds);
    const unsent = tweets.filter((t) => !sentSet.has(t.id));

    if (unsent.length === 0) {
      console.log(`[XBD] 新規なし (検出: ${tweets.length}件, 送信済み: ${sentSet.size}件)`);
      showToast('新規ブックマークはありません');
      return;
    }

    console.log(`[XBD] 送信開始: ${unsent.length}件`);
    showToast(`${unsent.length}件を送信中...`);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SEND_TWEETS',
        tweets: unsent,
      });

      if (!response) {
        showToast('送信エラー: バックグラウンド処理が応答しませんでした');
        return;
      }

      if (response.success) {
        console.log(`[XBD] 完了: 送信${response.sentCount}件, 失敗${response.failedCount}件`);
        const msg = response.failedCount > 0
          ? `${response.sentCount}件送信（${response.failedCount}件失敗）`
          : `${response.sentCount}件送信しました`;
        showToast(msg);
      } else {
        console.error(`[XBD] 送信エラー: ${response.error || '不明なエラー'}`);
        showToast(`送信エラー: ${response.error || '不明なエラー'}`);
      }
    } catch (err) {
      console.error(`[XBD] 例外: ${err.message}`);
      showToast(`送信エラー: ${err.message}`);
    }
  }

  run();
})();
