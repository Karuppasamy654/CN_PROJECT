const test = require('node:test');
const assert = require('node:assert');
const gf256 = require('../src/services/gf256Service');
const rlnc = require('../src/services/rlncService');

test('GF(256) addition and subtraction (XOR)', () => {
  assert.strictEqual(gf256.add(0x57, 0x83), 0x57 ^ 0x83);
  assert.strictEqual(gf256.sub(0x57, 0x83), 0x57 ^ 0x83);
});

test('GF(256) multiplication identity and inverses', () => {
  assert.strictEqual(gf256.mul(0x57, 0), 0);
  assert.strictEqual(gf256.mul(0x57, 1), 0x57);

  for (let i = 1; i < 256; i++) {
    const inv = gf256.inv(i);
    assert.strictEqual(gf256.mul(i, inv), 1);
  }
});

test('GF(256) step-by-step calculator', () => {
  const step = gf256.calculateStepByStep(0x02, 0x03, 'mul');
  assert.strictEqual(step.op, 'mul');
  assert.ok(step.steps.length > 0);
  assert.ok(step.hexResult);
});

test('RLNC equation formatting', () => {
  const eq = rlnc.formatEquation([1, 0, 5, 2], 4);
  assert.strictEqual(eq, 'B1 ⊕ 5·B3 ⊕ 2·B4');
});
