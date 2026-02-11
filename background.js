'use strict';

const SEND_INTERVAL_MS = 400;
const MAX_SENT_IDS = 10000;
const NOTION_API_VERSION = '2022-06-28';
const NOTION_API_URL = 'https://api.notion.com/v1/pages';
const TWEET_URL_PATTERN = /^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d+$/;
const NOTION_API_KEY_PATTERN = /^(ntn_|secret_)[A-Za-z0-9]+$/;
const DATABASE_ID_PATTERN = /^[a-f0-9]{32}$/;
const ISO8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const MAX_RETRY_COUNT = 3;

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
  const postDatetime = typeof tweet.postDatetime === 'string'
    && ISO8601_PATTERN.test(tweet.postDatetime)
    ? tweet.postDatetime : null;

  return { id: tweet.id, url: tweet.url, authorHandle, authorName, text, postDatetime };
}

function validateNotionApiKey(key) {
  if (!key || typeof key !== 'string') return false;
  return NOTION_API_KEY_PATTERN.test(key);
}

function validateDatabaseId(id) {
  if (!id || typeof id !== 'string') return false;
  return DATABASE_ID_PATTERN.test(id);
}

function normalizeDatabaseId(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const stripped = raw.replace(/-/g, '').toLowerCase();
  if (DATABASE_ID_PATTERN.test(stripped)) return stripped;
  return null;
}

function buildNotionPayload(tweet, databaseId) {
  const titleText = tweet.text
    ? tweet.text.slice(0, 200)
    : `${tweet.authorHandle} のブックマーク`;

  const properties = {
    '\u30BF\u30A4\u30C8\u30EB': {
      title: [{ text: { content: titleText } }],
    },
    'URL': {
      url: tweet.url,
    },
    '\u6295\u7A3F\u8005': {
      rich_text: [{ text: { content: `${tweet.authorHandle}\uFF08${tweet.authorName}\uFF09` } }],
    },
    '\u30B9\u30C6\u30FC\u30BF\u30B9': {
      select: { name: '\uD83D\uDCE5 Inbox' },
    },
    '\u53D6\u5F97\u65E5\u6642': {
      date: { start: new Date().toISOString() },
    },
  };

  if (tweet.postDatetime) {
    properties['\u30DD\u30B9\u30C8\u65E5\u6642'] = {
      date: { start: tweet.postDatetime },
    };
  }

  return {
    parent: { database_id: databaseId },
    properties,
  };
}

async function handleSendTweets(tweets) {
  if (!Array.isArray(tweets)) {
    return { success: false, error: '\u4E0D\u6B63\u306A\u30EA\u30AF\u30A8\u30B9\u30C8\u3067\u3059' };
  }

  const validTweets = tweets.map(validateTweet).filter(Boolean);
  console.log(`[XBD] \u6709\u52B9\u30C4\u30A4\u30FC\u30C8: ${validTweets.length}/${tweets.length}\u4EF6`);
  if (validTweets.length === 0) {
    return { success: false, error: '\u6709\u52B9\u306A\u30C4\u30A4\u30FC\u30C8\u304C\u3042\u308A\u307E\u305B\u3093' };
  }

  const { notionApiKey, notionDatabaseId } = await chrome.storage.local.get([
    'notionApiKey',
    'notionDatabaseId',
  ]);

  if (!notionApiKey || !validateNotionApiKey(notionApiKey)) {
    console.error('[XBD] Notion API Key\u304C\u672A\u8A2D\u5B9A\u307E\u305F\u306F\u4E0D\u6B63\u3067\u3059');
    return {
      success: false,
      error: 'Notion API Key\u304C\u672A\u8A2D\u5B9A\u307E\u305F\u306F\u4E0D\u6B63\u3067\u3059\u3002\u30AA\u30D7\u30B7\u30E7\u30F3\u753B\u9762\u3067\u8A2D\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002',
    };
  }

  const databaseId = normalizeDatabaseId(notionDatabaseId);
  if (!databaseId) {
    console.error('[XBD] Database ID\u304C\u672A\u8A2D\u5B9A\u307E\u305F\u306F\u4E0D\u6B63\u3067\u3059');
    return {
      success: false,
      error: 'Database ID\u304C\u672A\u8A2D\u5B9A\u307E\u305F\u306F\u4E0D\u6B63\u3067\u3059\u3002\u30AA\u30D7\u30B7\u30E7\u30F3\u753B\u9762\u3067\u8A2D\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002',
    };
  }

  let sentCount = 0;
  let firstError = null;
  const newIds = [];

  for (let i = 0; i < validTweets.length; i++) {
    const tweet = validTweets[i];
    let sent = false;

    for (let retry = 0; retry <= MAX_RETRY_COUNT; retry++) {
      try {
        const payload = buildNotionPayload(tweet, databaseId);
        const res = await fetch(NOTION_API_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${notionApiKey}`,
            'Notion-Version': NOTION_API_VERSION,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          console.log(`[XBD] \u9001\u4FE1OK: ${tweet.id}`);
          sentCount++;
          newIds.push(tweet.id);
          sent = true;
          break;
        } else if (res.status === 429) {
          const retryAfter = parseInt(res.headers.get('Retry-After') || '1', 10);
          const waitMs = Math.min(retryAfter * 1000, 30000);
          console.warn(`[XBD] \u30EC\u30FC\u30C8\u5236\u9650: ${tweet.id} ${waitMs}ms\u5F85\u6A5F\u5F8C\u30EA\u30C8\u30E9\u30A4 (${retry + 1}/${MAX_RETRY_COUNT})`);
          await sleep(waitMs);
        } else {
          const body = await res.text().catch(() => '');
          console.error(`[XBD] \u9001\u4FE1\u5931\u6557: ${tweet.id} (HTTP ${res.status}) ${body}`);
          if (!firstError) {
            firstError = `HTTP ${res.status}: ${body.slice(0, 200)}`;
          }
          break;
        }
      } catch (err) {
        console.error(`[XBD] \u9001\u4FE1\u4F8B\u5916: ${tweet.id}: ${err.message}`);
        if (!firstError) {
          firstError = err.message;
        }
        break;
      }
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
  console.log(`[XBD] \u7D50\u679C: \u9001\u4FE1${sentCount}\u4EF6, \u5931\u6557${failedCount}\u4EF6`);
  return {
    success: sentCount > 0,
    sentCount,
    failedCount,
    error: sentCount === 0 ? (firstError || '\u3059\u3079\u3066\u306E\u9001\u4FE1\u306B\u5931\u6557\u3057\u307E\u3057\u305F') : null,
  };
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
