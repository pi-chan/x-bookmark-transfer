import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const TEXT_MAX_LENGTH = 200;
const MAX_SENT_IDS = 10000;
const WEBHOOK_URL_PATTERN = /^https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w-]+$/;

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

function formatMessage(tweet) {
  const lines = [];
  lines.push(`\u{1F516} ${tweet.authorHandle}\uFF08${tweet.authorName}\uFF09`);
  if (tweet.text) {
    lines.push(tweet.text);
  }
  lines.push(tweet.url);
  return lines.join('\n');
}

function trimSentIds(existing, newIds) {
  const updated = [...existing, ...newIds];
  if (updated.length > MAX_SENT_IDS) {
    return updated.slice(updated.length - MAX_SENT_IDS);
  }
  return updated;
}

function validateWebhookUrl(url) {
  if (!url) return false;
  return WEBHOOK_URL_PATTERN.test(url);
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

  return { id: tweet.id, url: tweet.url, authorHandle, authorName, text };
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

describe('formatMessage', () => {
  it('formats message with text', () => {
    const tweet = {
      authorHandle: '@testuser',
      authorName: 'Test User',
      text: 'Hello world',
      url: 'https://x.com/testuser/status/123',
    };
    const result = formatMessage(tweet);
    const expected = '\u{1F516} @testuser\uFF08Test User\uFF09\nHello world\nhttps://x.com/testuser/status/123';
    assert.equal(result, expected);
  });

  it('formats message without text', () => {
    const tweet = {
      authorHandle: '@testuser',
      authorName: 'Test User',
      text: '',
      url: 'https://x.com/testuser/status/123',
    };
    const result = formatMessage(tweet);
    const expected = '\u{1F516} @testuser\uFF08Test User\uFF09\nhttps://x.com/testuser/status/123';
    assert.equal(result, expected);
  });

  it('formats message with null text', () => {
    const tweet = {
      authorHandle: '@user',
      authorName: 'User',
      text: null,
      url: 'https://x.com/user/status/456',
    };
    const result = formatMessage(tweet);
    assert.ok(!result.includes('null'));
    assert.equal(result, '\u{1F516} @user\uFF08User\uFF09\nhttps://x.com/user/status/456');
  });

  it('includes full-width parentheses around author name', () => {
    const tweet = {
      authorHandle: '@abc',
      authorName: 'ABC',
      text: 'test',
      url: 'https://x.com/abc/status/1',
    };
    const result = formatMessage(tweet);
    assert.ok(result.includes('\uFF08ABC\uFF09'));
  });

  it('handles Japanese author name', () => {
    const tweet = {
      authorHandle: '@jp_user',
      authorName: '\u5C71\u7530\u592A\u90CE',
      text: '\u3053\u3093\u306B\u3061\u306F',
      url: 'https://x.com/jp_user/status/789',
    };
    const result = formatMessage(tweet);
    assert.ok(result.includes('\u5C71\u7530\u592A\u90CE'));
    assert.ok(result.includes('\u3053\u3093\u306B\u3061\u306F'));
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

describe('validateWebhookUrl', () => {
  it('accepts valid Discord webhook URL', () => {
    assert.equal(validateWebhookUrl('https://discord.com/api/webhooks/1234/abcdef'), true);
  });

  it('rejects empty string', () => {
    assert.equal(validateWebhookUrl(''), false);
  });

  it('rejects null', () => {
    assert.equal(validateWebhookUrl(null), false);
  });

  it('rejects undefined', () => {
    assert.equal(validateWebhookUrl(undefined), false);
  });

  it('rejects non-Discord URL', () => {
    assert.equal(validateWebhookUrl('https://example.com/webhook'), false);
  });

  it('rejects http (non-https) Discord URL', () => {
    assert.equal(validateWebhookUrl('http://discord.com/api/webhooks/123/abc'), false);
  });

  it('rejects similar-looking but different domain', () => {
    assert.equal(validateWebhookUrl('https://discord.com.evil.com/api/webhooks/123/abc'), false);
  });

  it('rejects URL with just the prefix (no ID/token)', () => {
    assert.equal(validateWebhookUrl('https://discord.com/api/webhooks/'), false);
  });

  it('rejects URL with path traversal', () => {
    assert.equal(validateWebhookUrl('https://discord.com/api/webhooks/../../other'), false);
  });

  it('rejects URL with query parameters', () => {
    assert.equal(validateWebhookUrl('https://discord.com/api/webhooks/123/abc?extra=1'), false);
  });
});

describe('validateTweet', () => {
  it('validates a correct tweet', () => {
    const tweet = {
      id: '123', url: 'https://x.com/user/status/123',
      authorHandle: '@user', authorName: 'User', text: 'hello',
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
