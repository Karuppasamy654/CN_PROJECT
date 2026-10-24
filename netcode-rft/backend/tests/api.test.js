const test = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');

test('Health check endpoint returns ok and engine status', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://localhost:${port}/api/health`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.status, 'ok');
    assert.ok(data.engine);
  } finally {
    server.close();
  }
});

test('GF(256) calculation API returns step trace', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://localhost:${port}/api/calculations/gf256`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a: '0x02', b: '0x03', op: 'mul' }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.op, 'mul');
    assert.ok(data.hexResult);
  } finally {
    server.close();
  }
});

test('Upload rejects missing file and invalid parameters', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    // Missing file
    const res1 = await fetch(`http://localhost:${port}/api/transfers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ protocol: 'rlnc' }),
    });
    assert.strictEqual(res1.status, 400);

    // Non-existent transfer
    const res2 = await fetch(`http://localhost:${port}/api/transfers/non-existent-id`);
    assert.strictEqual(res2.status, 404);

    // Non-existent transfer download
    const res3 = await fetch(`http://localhost:${port}/api/transfers/non-existent-id/download`);
    assert.strictEqual(res3.status, 404);
  } finally {
    server.close();
  }
});

test('RLNC calculation endpoint computes linear combination and traces', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://localhost:${port}/api/calculations/rlnc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blocks: [[1, 2, 3], [4, 5, 6]],
        coeffs: [1, 2],
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.equation, 'B1 ⊕ 2·B2');
    assert.strictEqual(data.codedPayload.length, 3);
  } finally {
    server.close();
  }
});
