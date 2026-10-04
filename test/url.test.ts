import assert from 'node:assert/strict';
import test from 'node:test';
import { isAllowedLink, normalizeUrl } from '../src/core/url';

const publicBase = new URL('https://example.com/start');

test('normalizes URLs by removing fragments', () => {
  assert.equal(normalizeUrl('https://example.com/page#section'), 'https://example.com/page');
});

test('allows public HTTP(S) links on the same host', () => {
  assert.equal(isAllowedLink('https://example.com/docs', publicBase, false), true);
  assert.equal(isAllowedLink('http://example.com/docs', publicBase, false), true);
});

test('rejects unsafe and external links when external crawling is disabled', () => {
  assert.equal(isAllowedLink('https://localhost/admin', publicBase, false), false);
  assert.equal(isAllowedLink('http://127.0.0.1/admin', publicBase, false), false);
  assert.equal(isAllowedLink('******example.com', publicBase, false), false);
  assert.equal(isAllowedLink('file:///etc/passwd', publicBase, false), false);
  assert.equal(isAllowedLink('https://other.example/docs', publicBase, false), false);
});
