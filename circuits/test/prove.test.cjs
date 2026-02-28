const test = require('node:test');
const assert = require('node:assert/strict');

const { deriveNullifierSecret } = require('../scripts/prove.js');

const previousEnv = process.env.ZKVUB_NULLIFIER_SECRET;

test.after(() => {
  if (previousEnv === undefined) {
    delete process.env.ZKVUB_NULLIFIER_SECRET;
  } else {
    process.env.ZKVUB_NULLIFIER_SECRET = previousEnv;
  }
});

test('deriveNullifierSecret uses explicit decimal override', () => {
  const result = deriveNullifierSecret('123456789');
  assert.equal(result, '123456789');
});

test('deriveNullifierSecret accepts explicit hex override', () => {
  const result = deriveNullifierSecret('0xff');
  assert.equal(result, '255');
});

test('deriveNullifierSecret falls back to env value when override absent', () => {
  process.env.ZKVUB_NULLIFIER_SECRET = '42';
  const result = deriveNullifierSecret();
  assert.equal(result, '42');
});

test('deriveNullifierSecret generates random numeric value by default', () => {
  delete process.env.ZKVUB_NULLIFIER_SECRET;
  const first = deriveNullifierSecret();
  const second = deriveNullifierSecret();

  assert.match(first, /^[0-9]+$/);
  assert.match(second, /^[0-9]+$/);
  assert.notEqual(first, second);
});
