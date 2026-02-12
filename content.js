(function () {
  'use strict';

  const TEXT_MAX_LENGTH = 200;
  const TWEET_WAIT_TIMEOUT_MS = 10000;
  const SCROLL_WAIT_MS = 1500;
  const MAX_NO_NEW_SCROLLS = 3;
  const CUTOFF_MONTHS = 3;
  const STATUS_FADE_MS = 5000;

  let aborted = false;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isTooOld(postDatetime) {
    if (!postDatetime) return false;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - CUTOFF_MONTHS);
    return new Date(postDatetime) < cutoff;
  }

  // --- UI ---

  const PANEL_STYLES = {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    zIndex: '2147483647',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    alignItems: 'flex-end',
  };

  const BTN_BASE = {
    border: 'none',
    borderRadius: '20px',
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    color: '#fff',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    transition: 'opacity 0.2s ease',
  };

  function createPanel() {
    const existing = document.getElementById('xbd-panel');
    if (existing) return existing;

    const panel = document.createElement('div');
    panel.id = 'xbd-panel';
    Object.assign(panel.style, PANEL_STYLES);
    document.body.appendChild(panel);
    return panel;
  }

  function createButton(label, color, onClick) {
    const btn = document.createElement('button');
    btn.textContent = label;
    Object.assign(btn.style, BTN_BASE, { backgroundColor: color });
    btn.addEventListener('click', onClick);
    return btn;
  }

  function showStatus(text) {
    const panel = createPanel();
    let statusEl = document.getElementById('xbd-status');
    if (!statusEl) {
      statusEl = document.createElement('div');
      statusEl.id = 'xbd-status';
      Object.assign(statusEl.style, {
        backgroundColor: 'rgba(29, 155, 240, 0.95)',
        color: '#fff',
        padding: '8px 16px',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        transition: 'opacity 0.3s ease',
      });
      panel.prepend(statusEl);
    }
    statusEl.textContent = text;
    statusEl.style.opacity = '1';
  }

  function fadeStatus() {
    const statusEl = document.getElementById('xbd-status');
    if (!statusEl) return;
    setTimeout(() => {
      statusEl.style.opacity = '0';
      setTimeout(() => statusEl.remove(), 300);
    }, STATUS_FADE_MS);
  }

  function showStartButton() {
    const panel = createPanel();

    const oldStart = document.getElementById('xbd-start');
    if (oldStart) oldStart.remove();
    const oldAbort = document.getElementById('xbd-abort');
    if (oldAbort) oldAbort.remove();

    const btn = createButton('Notionへ送信', '#1d9bf0', onStart);
    btn.id = 'xbd-start';
    panel.appendChild(btn);
  }

  function showAbortButton() {
    const panel = createPanel();

    const oldStart = document.getElementById('xbd-start');
    if (oldStart) oldStart.remove();

    const btn = createButton('中止', '#f4212e', onAbort);
    btn.id = 'xbd-abort';
    panel.appendChild(btn);
  }

  function removeAbortButton() {
    const el = document.getElementById('xbd-abort');
    if (el) el.remove();
  }

  // --- Tweet extraction ---

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
      const postDatetime = extractPostDatetime(article);

      tweets.push({ id: tweetId, url, authorName, authorHandle, text, postDatetime });
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

  function extractPostDatetime(article) {
    const timeEl = article.querySelector('time[datetime]');
    if (!timeEl) return null;
    return timeEl.getAttribute('datetime') || null;
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

  // --- Collection ---

  async function collectAllTweets() {
    console.log('[XBD] スクロール収集開始');
    const collected = new Map();
    let noNewCount = 0;
    let reachedCutoff = false;

    while (noNewCount < MAX_NO_NEW_SCROLLS && !reachedCutoff && !aborted) {
      const tweets = extractTweets();
      let addedCount = 0;

      for (const tweet of tweets) {
        if (collected.has(tweet.id)) continue;

        if (isTooOld(tweet.postDatetime)) {
          console.log(`[XBD] ${CUTOFF_MONTHS}ヶ月以上前のポストを検出、収集を終了: ${tweet.id}`);
          reachedCutoff = true;
          break;
        }

        collected.set(tweet.id, tweet);
        addedCount++;
      }

      if (addedCount > 0) {
        noNewCount = 0;
      } else {
        noNewCount++;
      }

      console.log(`[XBD] スクロール中: ${collected.size}件検出`);
      showStatus(`スクロール中... ${collected.size}件検出`);

      if (!reachedCutoff && !aborted) {
        window.scrollBy(0, window.innerHeight);
        await sleep(SCROLL_WAIT_MS);
      }
    }

    if (aborted) {
      console.log(`[XBD] 中止されました (収集済み: ${collected.size}件)`);
    } else {
      console.log(`[XBD] スクロール完了: 合計${collected.size}件`);
    }
    return Array.from(collected.values());
  }

  // --- Actions ---

  async function onStart() {
    aborted = false;
    showAbortButton();
    showStatus('スクロール中...');

    await waitForTweets();
    const tweets = await collectAllTweets();

    if (aborted) {
      showStatus('中止しました');
      fadeStatus();
      removeAbortButton();
      showStartButton();
      return;
    }

    if (tweets.length === 0) {
      console.log('[XBD] ブックマーク0件');
      showStatus('ブックマークが見つかりませんでした');
      fadeStatus();
      removeAbortButton();
      showStartButton();
      return;
    }

    const { sentTweetIds = [] } = await chrome.storage.local.get('sentTweetIds');
    const sentSet = new Set(sentTweetIds);
    const unsent = tweets.filter((t) => !sentSet.has(t.id));

    if (unsent.length === 0) {
      console.log(`[XBD] 新規なし (検出: ${tweets.length}件, 送信済み: ${sentSet.size}件)`);
      showStatus('新規ブックマークはありません');
      fadeStatus();
      removeAbortButton();
      showStartButton();
      return;
    }

    console.log(`[XBD] 送信開始: ${unsent.length}件`);
    showStatus(`${unsent.length}件を送信中...`);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SEND_TWEETS',
        tweets: unsent,
      });

      if (!response) {
        showStatus('送信エラー: バックグラウンド処理が応答しませんでした');
      } else if (response.success) {
        console.log(`[XBD] 完了: 送信${response.sentCount}件, 失敗${response.failedCount}件`);
        const msg = response.failedCount > 0
          ? `${response.sentCount}件送信 (${response.failedCount}件失敗)`
          : `${response.sentCount}件送信しました`;
        showStatus(msg);
      } else {
        console.error(`[XBD] 送信エラー: ${response.error || '不明なエラー'}`);
        showStatus(`送信エラー: ${response.error || '不明なエラー'}`);
      }
    } catch (err) {
      console.error(`[XBD] 例外: ${err.message}`);
      showStatus(`送信エラー: ${err.message}`);
    }

    fadeStatus();
    removeAbortButton();
    showStartButton();
  }

  function onAbort() {
    aborted = true;
    console.log('[XBD] 中止リクエスト');
  }

  // --- Init ---

  waitForTweets().then(() => showStartButton());
})();
