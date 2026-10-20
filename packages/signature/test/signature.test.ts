import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SECRET_PREFIX,
  buildSignatureHeader,
  generateSigningSecret,
  signPayload,
  verifySignature,
} from '../src/index';

const payload = JSON.stringify({ id: 'evt_1', type: 'order.paid', data: { total: 1299 } });
const secret = 'whsec_primary_secret_for_tests';
const timestamp = 1760880000;

test('generated secrets are prefixed and unique', () => {
  const first = generateSigningSecret();
  const second = generateSigningSecret();
  assert.ok(first.startsWith(SECRET_PREFIX));
  assert.notEqual(first, second);
  assert.ok(first.length > 40);
});

test('accepts a signature produced with the active secret', () => {
  const header = buildSignatureHeader({ payload, secrets: [secret], timestamp });
  const result = verifySignature({ payload, header, secrets: [secret], nowSeconds: timestamp });
  assert.deepEqual(result, { valid: true, timestamp });
});

test('signs with every active secret during a rotation', () => {
  const next = 'whsec_rotated_secret_for_tests';
  const header = buildSignatureHeader({ payload, secrets: [secret, next], timestamp });
  assert.equal(header.split('v1=').length - 1, 2);
  for (const candidate of [secret, next]) {
    const result = verifySignature({
      payload,
      header,
      secrets: [candidate],
      nowSeconds: timestamp,
    });
    assert.equal(result.valid, true, `consumer holding ${candidate} should accept the request`);
  }
});

test('rejects a payload modified after signing', () => {
  const header = buildSignatureHeader({ payload, secrets: [secret], timestamp });
  const tampered = payload.replace('1299', '1');
  const result = verifySignature({
    payload: tampered,
    header,
    secrets: [secret],
    nowSeconds: timestamp,
  });
  assert.deepEqual(result, { valid: false, reason: 'no_signature_match' });
});

test('rejects a signature replayed outside the tolerance window', () => {
  const header = buildSignatureHeader({ payload, secrets: [secret], timestamp });
  const result = verifySignature({
    payload,
    header,
    secrets: [secret],
    nowSeconds: timestamp + 301,
  });
  assert.deepEqual(result, { valid: false, reason: 'timestamp_out_of_tolerance' });
});

test('rejects a signature moved to a different timestamp', () => {
  const digest = signPayload(payload, secret, timestamp);
  const result = verifySignature({
    payload,
    header: `t=${timestamp + 10},v1=${digest}`,
    secrets: [secret],
    nowSeconds: timestamp + 10,
  });
  assert.deepEqual(result, { valid: false, reason: 'no_signature_match' });
});

test('reports why malformed headers were refused', () => {
  const cases: Array<[string | undefined, string]> = [
    [undefined, 'missing_header'],
    ['v1=abc', 'missing_timestamp'],
    [`t=${timestamp}`, 'malformed_header'],
    [`t=not-a-number,v1=abc`, 'missing_timestamp'],
  ];
  for (const [header, reason] of cases) {
    const result = verifySignature({ payload, header, secrets: [secret], nowSeconds: timestamp });
    assert.deepEqual(result, { valid: false, reason }, `header ${String(header)}`);
  }
});

test('tolerates whitespace and unknown signature versions', () => {
  const digest = signPayload(payload, secret, timestamp);
  const header = `t=${timestamp}, v0=legacy, v1=${digest}`;
  const result = verifySignature({ payload, header, secrets: [secret], nowSeconds: timestamp });
  assert.equal(result.valid, true);
});

test('ignores signature candidates of the wrong length without throwing', () => {
  const result = verifySignature({
    payload,
    header: `t=${timestamp},v1=zz`,
    secrets: [secret],
    nowSeconds: timestamp,
  });
  assert.deepEqual(result, { valid: false, reason: 'no_signature_match' });
});
