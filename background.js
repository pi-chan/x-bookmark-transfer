'use strict';

const SEND_INTERVAL_MS = 400;
const MAX_SENT_IDS = 10000;
const NOTION_API_VERSION = '2022-06-28';
const NOTION_API_URL = 'https://api.notion.com/v1/pages';
const NOTION_QUERY_URL = 'https://api.notion.com/v1/databases';
const QUERY_BATCH_SIZE = 50;
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
    'タイトル': {
      title: [{ text: { content: titleText } }],
    },
    'URL': {
      url: tweet.url,
    },
    '投稿者': {
      rich_text: [{ text: { content: `${tweet.authorHandle}（${tweet.authorName}）` } }],
    },
    'ステータス': {
      select: { name: '📥 Inbox' },
    },
    '取得日時': {
      date: { start: new Date().toISOString() },
    },
  };

  if (tweet.postDatetime) {
    properties['ポスト日時'] = {
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
    return { success: false, error: '不正なリクエストです' };
  }

  const validTweets = tweets.map(validateTweet).filter(Boolean);
  console.log(`[XBD] 有効ツイート: ${validTweets.length}/${tweets.length}件`);
  if (validTweets.length === 0) {
    return { success: false, error: '有効なツイートがありません' };
  }

  const { notionApiKey, notionDatabaseId } = await chrome.storage.local.get([
    'notionApiKey',
    'notionDatabaseId',
  ]);

  if (!notionApiKey || !validateNotionApiKey(notionApiKey)) {
    console.error('[XBD] Notion API Keyが未設定または不正です');
    return {
      success: false,
      error: 'Notion API Keyが未設定または不正です。オプション画面で設定してください。',
    };
  }

  const databaseId = normalizeDatabaseId(notionDatabaseId);
  if (!databaseId) {
    console.error('[XBD] Database IDが未設定または不正です');
    return {
      success: false,
      error: 'Database IDが未設定または不正です。オプション画面で設定してください。',
    };
  }

  const urlsToCheck = validTweets.map((t) => t.url);
  let existingUrls;
  try {
    existingUrls = await queryExistingUrls(urlsToCheck, notionApiKey, databaseId);
  } catch (err) {
    console.error(`[XBD] Notion Query 失敗、重複チェックをスキップ: ${err.message}`);
    existingUrls = new Set();
  }

  const alreadyExistingIds = [];
  const tweetsToSend = [];
  for (const tweet of validTweets) {
    if (existingUrls.has(tweet.url)) {
      console.log(`[XBD] Notion既存スキップ: ${tweet.id}`);
      alreadyExistingIds.push(tweet.id);
    } else {
      tweetsToSend.push(tweet);
    }
  }

  if (alreadyExistingIds.length > 0) {
    console.log(`[XBD] Notion既存分: ${alreadyExistingIds.length}件をスキップ`);
  }

  let sentCount = 0;
  let firstError = null;
  const newIds = [];

  for (let i = 0; i < tweetsToSend.length; i++) {
    const tweet = tweetsToSend[i];

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
          console.log(`[XBD] 送信OK: ${tweet.id}`);
          sentCount++;
          newIds.push(tweet.id);
          break;
        } else if (res.status === 429) {
          const retryAfter = parseInt(res.headers.get('Retry-After') || '1', 10);
          const waitMs = Math.min(retryAfter * 1000, 30000);
          console.warn(`[XBD] レート制限: ${tweet.id} ${waitMs}ms待機後リトライ (${retry + 1}/${MAX_RETRY_COUNT})`);
          await sleep(waitMs);
        } else {
          const body = await res.text().catch(() => '');
          console.error(`[XBD] 送信失敗: ${tweet.id} (HTTP ${res.status}) ${body}`);
          if (!firstError) {
            firstError = `HTTP ${res.status}: ${body.slice(0, 200)}`;
          }
          break;
        }
      } catch (err) {
        console.error(`[XBD] 送信例外: ${tweet.id}: ${err.message}`);
        if (!firstError) {
          firstError = err.message;
        }
        break;
      }
    }

    if (i < tweetsToSend.length - 1) {
      await sleep(SEND_INTERVAL_MS);
    }
  }

  const idsToCache = [...alreadyExistingIds, ...newIds];
  if (idsToCache.length > 0) {
    await saveSentIds(idsToCache);
  }

  updateBadge(sentCount);

  const skippedCount = alreadyExistingIds.length;
  const failedCount = tweetsToSend.length - sentCount;
  console.log(`[XBD] 結果: 送信${sentCount}件, スキップ${skippedCount}件, 失敗${failedCount}件`);
  return {
    success: sentCount > 0 || skippedCount > 0,
    sentCount,
    skippedCount,
    failedCount,
    error: sentCount === 0 && skippedCount === 0 ? (firstError || 'すべての送信に失敗しました') : null,
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

function buildNotionQueryFilter(urls) {
  return {
    or: urls.map((url) => ({
      property: 'URL',
      url: { equals: url },
    })),
  };
}

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function queryExistingUrls(urls, notionApiKey, databaseId) {
  if (urls.length === 0) return new Set();

  const existingUrls = new Set();
  const batches = chunkArray(urls, QUERY_BATCH_SIZE);

  for (const batch of batches) {
    const filter = buildNotionQueryFilter(batch);
    let retries = 0;

    while (retries <= MAX_RETRY_COUNT) {
      try {
        const res = await fetch(`${NOTION_QUERY_URL}/${databaseId}/query`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${notionApiKey}`,
            'Notion-Version': NOTION_API_VERSION,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ filter, page_size: 100 }),
        });

        if (res.ok) {
          const data = await res.json();
          for (const page of data.results) {
            const urlProp = page.properties?.URL?.url;
            if (urlProp) {
              existingUrls.add(urlProp);
            }
          }
          break;
        } else if (res.status === 429) {
          const retryAfter = parseInt(res.headers.get('Retry-After') || '1', 10);
          const waitMs = Math.min(retryAfter * 1000, 30000);
          console.warn(`[XBD] Notion Query レート制限: ${waitMs}ms待機後リトライ (${retries + 1}/${MAX_RETRY_COUNT})`);
          await sleep(waitMs);
          retries++;
        } else {
          const body = await res.text().catch(() => '');
          console.error(`[XBD] Notion Query 失敗 (HTTP ${res.status}): ${body}`);
          if (res.status === 401 || res.status === 403) {
            throw new Error(`Notion Query 認証エラー (HTTP ${res.status})`);
          }
          break;
        }
      } catch (err) {
        console.error(`[XBD] Notion Query 例外: ${err.message}`);
        break;
      }
    }
  }

  return existingUrls;
}
