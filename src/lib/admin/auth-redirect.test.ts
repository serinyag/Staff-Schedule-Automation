import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeNextPath } from '../auth-redirect';

test('password recovery returns to the password form on the same site', () => {
  assert.equal(normalizeNextPath('/auth/complete?mode=recovery'), '/auth/complete?mode=recovery');
  assert.equal(normalizeNextPath('/availability'), '/availability');
});
test('authentication callbacks reject external and malformed redirects', () => {
  for (const path of [undefined, 'https://example.com', '//example.com', '/\\example.com', '/\n/example.com']) {
    assert.equal(normalizeNextPath(path), '/auth/redirect');
  }
});
