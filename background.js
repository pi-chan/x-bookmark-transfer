'use strict';

const SEND_INTERVAL_MS = 1000;
const MAX_SENT_IDS = 10000;
const WEBHOOK_URL_PATTERN = /^https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w-]+$/;
const TWEET_URL_PATTERN = /^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d+$/;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SEND_TWEETS') {
    handleSendTweets(message.tweets).then(sendResponse).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
});

function validateTweet(tweet) {
  if (!tweet || typeof tweet !== 'object') return null;
  if (typeof tweet.id !== 'string' || !/^\d+$/.test(tweet.id)) return null;
  if (typeof tweet.url !== 'string' || !TWEET_URL_PATTERN.test(tweet.url)) return null;

  const authorHandle = typeof tweet.authorHandle === 'string'
    ? tweet.authorHandle.slice(0, 50) : '';
  const authorName = typeof tweet.authorName === 'string'
    ? tweet.authorName.slice(0, 100) : '';
  const text = typeof tweet.text === 'string'
    ? tweet.text.slice(0, 200) : '';

  return { id: tweet.id, url: tweet.url, authorHandle, authorName, text };
}

async function handleSendTweets(tweets) {
  if (!Array.isArray(tweets)) {
    return { success: false, error: '不正なリクエストです' };
  }

  const validTweets = tweets.map(validateTweet).filter(Boolean);
  if (validTweets.length === 0) {
    return { success: false, error: '有効なツイートがありません' };
  }

  const { webhookUrl } = await chrome.storage.local.get('webhookUrl');
  if (!webhookUrl || !WEBHOOK_URL_PATTERN.test(webhookUrl)) {
    return { success: false, error: 'Webhook URLが未設定または不正です。オプション画面で設定してください。' };
  }

  let sentCount = 0;
  const newIds = [];

  for (let i = 0; i < validTweets.length; i++) {
    const tweet = validTweets[i];

    try {
      const content = formatMessage(tweet);
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (res.ok) {
        sentCount++;
        newIds.push(tweet.id);
      } else if (res.status === 429) {
        console.error(`Rate limited at tweet ${tweet.id}. Stopping.`);
        break;
      } else {
        console.error(`Webhook error for tweet ${tweet.id}: ${res.status}`);
      }
    } catch (err) {
      console.error(`Failed to send tweet ${tweet.id}:`, err);
    }

    if (i < validTweets.length - 1) {
      await sleep(SEND_INTERVAL_MS);
    }
  }

  if (newIds.length > 0) {
    await saveSentIds(newIds);
  }

  updateBadge(sentCount);

  const failedCount = validTweets.length - sentCount;
  return {
    success: sentCount > 0,
    sentCount,
    failedCount,
    error: sentCount === 0 ? 'すべての送信に失敗しました' : null,
  };
}

function formatMessage(tweet) {
  const lines = [];
  lines.push(`\u{1F516} ${tweet.authorHandle}\uFF08${tweet.authorName}\uFF09`);
  if (tweet.text) {
    lines.push(tweet.text);
  }
  lines.push(tweet.url);
  return lines.join('\n');
}

async function saveSentIds(newIds) {
  const { sentTweetIds = [] } = await chrome.storage.local.get('sentTweetIds');
  const updated = [...sentTweetIds, ...newIds];

  const trimmed = updated.length > MAX_SENT_IDS
    ? updated.slice(updated.length - MAX_SENT_IDS)
    : updated;

  await chrome.storage.local.set({ sentTweetIds: trimmed });
}

function updateBadge(count) {
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#1d9bf0' });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
