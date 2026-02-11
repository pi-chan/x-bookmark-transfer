import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const TEXT_MAX_LENGTH = 200;
const MAX_SENT_IDS = 10000;
const NOTION_API_KEY_PATTERN = /^(ntn_|secret_)[A-Za-z0-9]+$/;
const DATABASE_ID_PATTERN = /^[a-f0-9]{32}$/;
const ISO8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function extractText(raw) {
  const trimmed = raw.trim();
  if (trimmed.length <= TEXT_MAX_LENGTH) return trimmed;
  return trimmed.slice(0, TEXT_MAX_LENGTH) + '...';
}

function parseStatusHref(href) {
  const match = href.match(/\/([^/]+)\/status\/(\d+)/);
  if (!match) return null;
  const [, username, tweetId] = match;
  return { username, tweetId };
}

function trimSentIds(existing, newIds) {
  const updated = [...existing, ...newIds];
  if (updated.length > MAX_SENT_IDS) {
    return updated.slice(updated.length - MAX_SENT_IDS);
  }
  return updated;
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

const TWEET_URL_PATTERN = /^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d+$/;

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

function buildNotionPayload(tweet, databaseId) {
  const titleText = tweet.text
    ? tweet.text.slice(0, 200)
    : `${tweet.authorHandle} \u306E\u30D6\u30C3\u30AF\u30DE\u30FC\u30AF`;

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

function filterUnsent(tweetIds, sentIds) {
  const sentSet = new Set(sentIds);
  return tweetIds.filter((id) => !sentSet.has(id));
}

describe('extractText', () => {
  it('returns empty string for empty input', () => {
    assert.equal(extractText(''), '');
  });

  it('trims whitespace', () => {
    assert.equal(extractText('  hello  '), 'hello');
  });

  it('returns text as-is when within limit', () => {
    const text = 'a'.repeat(200);
    assert.equal(extractText(text), text);
  });

  it('truncates text exceeding 200 characters and appends ellipsis', () => {
    const text = 'a'.repeat(250);
    const result = extractText(text);
    assert.equal(result.length, 203);
    assert.equal(result, 'a'.repeat(200) + '...');
  });

  it('handles exactly 200 characters without truncation', () => {
    const text = 'x'.repeat(200);
    assert.equal(extractText(text), text);
  });

  it('handles 201 characters with truncation', () => {
    const text = 'x'.repeat(201);
    const result = extractText(text);
    assert.equal(result, 'x'.repeat(200) + '...');
  });

  it('handles multibyte characters', () => {
    const text = '\u3042'.repeat(201);
    const result = extractText(text);
    assert.equal(result, '\u3042'.repeat(200) + '...');
  });
});

describe('parseStatusHref', () => {
  it('extracts username and tweetId from valid href', () => {
    const result = parseStatusHref('/elonmusk/status/1234567890');
    assert.deepEqual(result, { username: 'elonmusk', tweetId: '1234567890' });
  });

  it('handles href with leading path segments', () => {
    const result = parseStatusHref('/some/path/user123/status/9876543210');
    assert.deepEqual(result, { username: 'user123', tweetId: '9876543210' });
  });

  it('returns null for href without /status/ pattern', () => {
    assert.equal(parseStatusHref('/user/likes'), null);
  });

  it('returns null for href with non-numeric tweet id', () => {
    assert.equal(parseStatusHref('/user/status/abc'), null);
  });

  it('returns null for empty string', () => {
    assert.equal(parseStatusHref(''), null);
  });

  it('handles underscore in username', () => {
    const result = parseStatusHref('/user_name/status/111');
    assert.deepEqual(result, { username: 'user_name', tweetId: '111' });
  });
});

describe('validateNotionApiKey', () => {
  it('accepts valid ntn_ prefixed key', () => {
    assert.equal(validateNotionApiKey('ntn_abc123DEF456'), true);
  });

  it('accepts valid secret_ prefixed key', () => {
    assert.equal(validateNotionApiKey('secret_abc123DEF456'), true);
  });

  it('rejects empty string', () => {
    assert.equal(validateNotionApiKey(''), false);
  });

  it('rejects null', () => {
    assert.equal(validateNotionApiKey(null), false);
  });

  it('rejects undefined', () => {
    assert.equal(validateNotionApiKey(undefined), false);
  });

  it('rejects key without valid prefix', () => {
    assert.equal(validateNotionApiKey('invalid_abc123'), false);
  });

  it('rejects key with special characters', () => {
    assert.equal(validateNotionApiKey('ntn_abc!@#'), false);
  });

  it('rejects prefix only', () => {
    assert.equal(validateNotionApiKey('ntn_'), false);
  });
});

describe('validateDatabaseId', () => {
  it('accepts valid 32-char hex string', () => {
    assert.equal(validateDatabaseId('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'), true);
  });

  it('rejects empty string', () => {
    assert.equal(validateDatabaseId(''), false);
  });

  it('rejects null', () => {
    assert.equal(validateDatabaseId(null), false);
  });

  it('rejects too short', () => {
    assert.equal(validateDatabaseId('a1b2c3d4'), false);
  });

  it('rejects too long', () => {
    assert.equal(validateDatabaseId('a'.repeat(33)), false);
  });

  it('rejects non-hex characters', () => {
    assert.equal(validateDatabaseId('g1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'), false);
  });

  it('rejects uppercase hex', () => {
    assert.equal(validateDatabaseId('A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4'), false);
  });
});

describe('normalizeDatabaseId', () => {
  it('returns 32-char hex as-is', () => {
    assert.equal(normalizeDatabaseId('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'), 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4');
  });

  it('strips hyphens from UUID format', () => {
    assert.equal(normalizeDatabaseId('a1b2c3d4-e5f6-a1b2-c3d4-e5f6a1b2c3d4'), 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4');
  });

  it('returns null for empty string', () => {
    assert.equal(normalizeDatabaseId(''), null);
  });

  it('returns null for null', () => {
    assert.equal(normalizeDatabaseId(null), null);
  });

  it('returns null for invalid input', () => {
    assert.equal(normalizeDatabaseId('not-a-valid-id'), null);
  });

  it('returns null for too short after stripping', () => {
    assert.equal(normalizeDatabaseId('a1b2-c3d4'), null);
  });

  it('normalizes uppercase hex to lowercase', () => {
    assert.equal(normalizeDatabaseId('A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4'), 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4');
  });
});

describe('buildNotionPayload', () => {
  it('builds payload with all fields', () => {
    const tweet = {
      id: '123',
      url: 'https://x.com/testuser/status/123',
      authorHandle: '@testuser',
      authorName: 'Test User',
      text: 'Hello world',
      postDatetime: '2025-02-10T12:34:56.000Z',
    };
    const result = buildNotionPayload(tweet, 'abc123def456abc123def456abc123de');

    assert.equal(result.parent.database_id, 'abc123def456abc123def456abc123de');
    assert.equal(result.properties['\u30BF\u30A4\u30C8\u30EB'].title[0].text.content, 'Hello world');
    assert.equal(result.properties['URL'].url, 'https://x.com/testuser/status/123');
    assert.equal(result.properties['\u6295\u7A3F\u8005'].rich_text[0].text.content, '@testuser\uFF08Test User\uFF09');
    assert.equal(result.properties['\u30B9\u30C6\u30FC\u30BF\u30B9'].select.name, '\uD83D\uDCE5 Inbox');
    assert.ok(result.properties['\u53D6\u5F97\u65E5\u6642'].date.start);
    assert.equal(result.properties['\u30DD\u30B9\u30C8\u65E5\u6642'].date.start, '2025-02-10T12:34:56.000Z');
  });

  it('uses fallback title when text is empty', () => {
    const tweet = {
      id: '456',
      url: 'https://x.com/user/status/456',
      authorHandle: '@user',
      authorName: 'User',
      text: '',
      postDatetime: null,
    };
    const result = buildNotionPayload(tweet, 'abc123def456abc123def456abc123de');
    assert.equal(result.properties['\u30BF\u30A4\u30C8\u30EB'].title[0].text.content, '@user \u306E\u30D6\u30C3\u30AF\u30DE\u30FC\u30AF');
  });

  it('omits post datetime when null', () => {
    const tweet = {
      id: '789',
      url: 'https://x.com/user/status/789',
      authorHandle: '@user',
      authorName: 'User',
      text: 'test',
      postDatetime: null,
    };
    const result = buildNotionPayload(tweet, 'abc123def456abc123def456abc123de');
    assert.equal(result.properties['\u30DD\u30B9\u30C8\u65E5\u6642'], undefined);
  });

  it('sets status to Inbox', () => {
    const tweet = {
      id: '1',
      url: 'https://x.com/u/status/1',
      authorHandle: '@u',
      authorName: 'U',
      text: 'x',
      postDatetime: null,
    };
    const result = buildNotionPayload(tweet, 'abc123def456abc123def456abc123de');
    assert.equal(result.properties['\u30B9\u30C6\u30FC\u30BF\u30B9'].select.name, '\uD83D\uDCE5 Inbox');
  });

  it('handles Japanese text in title', () => {
    const tweet = {
      id: '2',
      url: 'https://x.com/jp/status/2',
      authorHandle: '@jp',
      authorName: '\u5C71\u7530',
      text: '\u3053\u3093\u306B\u3061\u306F\u4E16\u754C',
      postDatetime: null,
    };
    const result = buildNotionPayload(tweet, 'abc123def456abc123def456abc123de');
    assert.equal(result.properties['\u30BF\u30A4\u30C8\u30EB'].title[0].text.content, '\u3053\u3093\u306B\u3061\u306F\u4E16\u754C');
  });
});

describe('trimSentIds', () => {
  it('merges new ids with existing ids', () => {
    const result = trimSentIds(['1', '2'], ['3', '4']);
    assert.deepEqual(result, ['1', '2', '3', '4']);
  });

  it('returns all ids when under limit', () => {
    const existing = Array.from({ length: 100 }, (_, i) => String(i));
    const newIds = ['new1', 'new2'];
    const result = trimSentIds(existing, newIds);
    assert.equal(result.length, 102);
  });

  it('trims oldest ids when exceeding MAX_SENT_IDS', () => {
    const existing = Array.from({ length: MAX_SENT_IDS }, (_, i) => String(i));
    const newIds = ['a', 'b', 'c'];
    const result = trimSentIds(existing, newIds);
    assert.equal(result.length, MAX_SENT_IDS);
    assert.equal(result[result.length - 1], 'c');
    assert.equal(result[result.length - 2], 'b');
    assert.equal(result[result.length - 3], 'a');
    assert.equal(result[0], '3');
  });

  it('handles empty existing ids', () => {
    const result = trimSentIds([], ['1', '2']);
    assert.deepEqual(result, ['1', '2']);
  });

  it('handles empty new ids', () => {
    const result = trimSentIds(['1', '2'], []);
    assert.deepEqual(result, ['1', '2']);
  });

  it('keeps exactly MAX_SENT_IDS when exactly at limit', () => {
    const existing = Array.from({ length: MAX_SENT_IDS - 1 }, (_, i) => String(i));
    const newIds = ['last'];
    const result = trimSentIds(existing, newIds);
    assert.equal(result.length, MAX_SENT_IDS);
    assert.equal(result[result.length - 1], 'last');
    assert.equal(result[0], '0');
  });

  it('preserves newest ids when trimming', () => {
    const existing = Array.from({ length: MAX_SENT_IDS }, (_, i) => `old-${i}`);
    const newIds = ['new-0', 'new-1'];
    const result = trimSentIds(existing, newIds);
    assert.equal(result.length, MAX_SENT_IDS);
    assert.ok(result.includes('new-0'));
    assert.ok(result.includes('new-1'));
    assert.ok(!result.includes('old-0'));
    assert.ok(!result.includes('old-1'));
  });
});

describe('validateTweet', () => {
  it('validates a correct tweet with postDatetime', () => {
    const tweet = {
      id: '123', url: 'https://x.com/user/status/123',
      authorHandle: '@user', authorName: 'User', text: 'hello',
      postDatetime: '2025-02-10T12:00:00.000Z',
    };
    const result = validateTweet(tweet);
    assert.deepEqual(result, tweet);
  });

  it('returns null for null input', () => {
    assert.equal(validateTweet(null), null);
  });

  it('returns null for non-object input', () => {
    assert.equal(validateTweet('string'), null);
  });

  it('returns null for non-numeric id', () => {
    assert.equal(validateTweet({ id: 'abc', url: 'https://x.com/u/status/1' }), null);
  });

  it('returns null for invalid url', () => {
    assert.equal(validateTweet({ id: '123', url: 'https://evil.com/phish' }), null);
  });

  it('returns null for url with path traversal', () => {
    assert.equal(validateTweet({ id: '123', url: 'https://x.com/../status/123' }), null);
  });

  it('truncates long authorName', () => {
    const tweet = {
      id: '1', url: 'https://x.com/u/status/1',
      authorHandle: '@u', authorName: 'a'.repeat(200), text: '',
    };
    const result = validateTweet(tweet);
    assert.equal(result.authorName.length, 100);
  });

  it('handles missing optional fields gracefully', () => {
    const tweet = { id: '1', url: 'https://x.com/u/status/1' };
    const result = validateTweet(tweet);
    assert.equal(result.authorHandle, '');
    assert.equal(result.authorName, '');
    assert.equal(result.text, '');
    assert.equal(result.postDatetime, null);
  });

  it('sets postDatetime to null for non-string value', () => {
    const tweet = {
      id: '1', url: 'https://x.com/u/status/1',
      authorHandle: '@u', authorName: 'U', text: '',
      postDatetime: 12345,
    };
    const result = validateTweet(tweet);
    assert.equal(result.postDatetime, null);
  });

  it('sets postDatetime to null for non-ISO8601 string', () => {
    const tweet = {
      id: '1', url: 'https://x.com/u/status/1',
      authorHandle: '@u', authorName: 'U', text: '',
      postDatetime: 'not-a-date',
    };
    const result = validateTweet(tweet);
    assert.equal(result.postDatetime, null);
  });

  it('accepts valid ISO8601 postDatetime', () => {
    const tweet = {
      id: '1', url: 'https://x.com/u/status/1',
      authorHandle: '@u', authorName: 'U', text: '',
      postDatetime: '2025-02-10T12:34:56.000Z',
    };
    const result = validateTweet(tweet);
    assert.equal(result.postDatetime, '2025-02-10T12:34:56.000Z');
  });

  it('accepts ISO8601 without milliseconds', () => {
    const tweet = {
      id: '1', url: 'https://x.com/u/status/1',
      authorHandle: '@u', authorName: 'U', text: '',
      postDatetime: '2025-02-10T12:34:56Z',
    };
    const result = validateTweet(tweet);
    assert.equal(result.postDatetime, '2025-02-10T12:34:56Z');
  });
});

describe('filterUnsent', () => {
  it('filters out already sent ids', () => {
    const result = filterUnsent(['1', '2', '3'], ['2']);
    assert.deepEqual(result, ['1', '3']);
  });

  it('returns all ids when none are sent', () => {
    const result = filterUnsent(['1', '2', '3'], []);
    assert.deepEqual(result, ['1', '2', '3']);
  });

  it('returns empty when all are sent', () => {
    const result = filterUnsent(['1', '2'], ['1', '2']);
    assert.deepEqual(result, []);
  });

  it('returns empty for empty input', () => {
    const result = filterUnsent([], ['1']);
    assert.deepEqual(result, []);
  });

  it('handles large sent id sets efficiently', () => {
    const sentIds = Array.from({ length: 10000 }, (_, i) => String(i));
    const tweetIds = ['9999', '10000', '10001'];
    const result = filterUnsent(tweetIds, sentIds);
    assert.deepEqual(result, ['10000', '10001']);
  });
});
