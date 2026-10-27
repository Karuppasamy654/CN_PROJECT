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

test('GF(256) exact regression: inv(170)=13, coded payload 0x31, and Gauss-Jordan reconstruction', () => {
  // 1. Inverses
  assert.strictEqual(gf256.inv(170), 13);
  assert.strictEqual(gf256.mul(170, 13), 1);

  // 2. Coded payload generation
  const c = [170, 111, 38, 121];
  const x = [17, 34, 51, 68];
  const m0 = gf256.mul(c[0], x[0]);
  const m1 = gf256.mul(c[1], x[1]);
  const m2 = gf256.mul(c[2], x[2]);
  const m3 = gf256.mul(c[3], x[3]);
  assert.strictEqual(m0, 216); // 0xD8
  assert.strictEqual(m1, 191); // 0xBF
  assert.strictEqual(m2, 132); // 0x84
  assert.strictEqual(m3, 210); // 0xD2
  const y = m0 ^ m1 ^ m2 ^ m3;
  assert.strictEqual(y, 49);   // 0x31

  // 3. Gauss-Jordan row normalization and elimination
  const norm_c0 = gf256.mul(170, 13);
  const norm_c1 = gf256.mul(111, 13);
  const norm_c2 = gf256.mul(38, 13);
  const norm_c3 = gf256.mul(121, 13);
  const norm_payload = gf256.mul(49, 13);
  assert.strictEqual(norm_c0, 1);
  assert.strictEqual(norm_c1, 145);
  assert.strictEqual(norm_c2, 147);
  assert.strictEqual(norm_c3, 111);
  assert.strictEqual(norm_payload, 96); // 0x60

  // Eliminate Col 2 (x1 = 34, factor = 145)
  const term1 = gf256.mul(145, 34);
  assert.strictEqual(term1, 232); // 0xE8
  const p1 = norm_payload ^ term1;
  assert.strictEqual(p1, 136);    // 0x88

  // Eliminate Col 3 (x2 = 51, factor = 147)
  const term2 = gf256.mul(147, 51);
  assert.strictEqual(term2, 250); // 0xFA
  const p2 = p1 ^ term2;
  assert.strictEqual(p2, 114);    // 0x72

  // Eliminate Col 4 (x3 = 68, factor = 111)
  const term3 = gf256.mul(111, 68);
  assert.strictEqual(term3, 99);  // 0x63
  const p3 = p2 ^ term3;
  assert.strictEqual(p3, 17);     // 0x11 (recovered x0)
});

