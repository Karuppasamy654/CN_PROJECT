const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const app = require('../src/app');

// Helper to execute in-memory API calls against an ephemeral server
async function withServer(fn) {
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  try {
    await fn(baseUrl);
  } finally {
    server.close();
  }
}

test('0-Byte Empty File: Policy, Zero Blocks, Zero Generations, and Hash Match', async () => {
  await withServer(async (baseUrl) => {
    const emptyBuf = Buffer.alloc(0);
    const origSha = crypto.createHash('sha256').update(emptyBuf).digest('hex');
    assert.strictEqual(origSha, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

    // 1. Upload 0-byte file
    const formData = new FormData();
    const blob = new Blob([emptyBuf], { type: 'application/octet-stream' });
    formData.append('file', blob, 'zero_byte.txt');
    formData.append('protocol', 'rlnc');
    formData.append('blockSize', '512');
    formData.append('K', '4');

    const res = await fetch(`${baseUrl}/api/transfers`, {
      method: 'POST',
      body: formData,
    });
    assert.strictEqual(res.status, 201);
    const transfer = await res.json();

    // Verify metadata calculation
    assert.strictEqual(transfer.fileSize, 0);
    assert.strictEqual(transfer.fileSha256, origSha);

    // 2. Query calculations endpoint for 0-byte transfer
    const calcRes = await fetch(`${baseUrl}/api/calculations/transfer/${transfer.id}`);
    assert.strictEqual(calcRes.status, 200);
    const calcData = await calcRes.json();

    assert.strictEqual(calcData.fileSplitting.fileSize, 0);
    assert.strictEqual(calcData.fileSplitting.totalBlocks, 0);
    assert.strictEqual(calcData.fileSplitting.totalGenerations, 0);
    assert.strictEqual(calcData.sourceBlocks.length, 0);
    assert.strictEqual(calcData.matrixA.length, 0);
    assert.strictEqual(calcData.matrixC.length, 0);
    assert.strictEqual(calcData.rank, 0);
    assert.strictEqual(calcData.requiredRank, 0);
  });
});

test('Reliable UDP 0-Byte File: Calculation Route Returns Valid RUDP Protocol Structure', async () => {
  await withServer(async (baseUrl) => {
    const emptyBuf = Buffer.alloc(0);
    const formData = new FormData();
    const blob = new Blob([emptyBuf], { type: 'application/octet-stream' });
    formData.append('file', blob, 'empty_rudp.bin');
    formData.append('protocol', 'rudp');

    const res = await fetch(`${baseUrl}/api/transfers`, {
      method: 'POST',
      body: formData,
    });
    assert.strictEqual(res.status, 201);
    const transfer = await res.json();

    const calcRes = await fetch(`${baseUrl}/api/calculations/transfer/${transfer.id}`);
    assert.strictEqual(calcRes.status, 200);
    const calcData = await calcRes.json();

    assert.strictEqual(calcData.protocol, 'rudp');
    assert.ok(calcData.rudpData, 'Should return rudpData object');
    assert.strictEqual(calcData.rudpData.totalBlocks, 0);
    assert.strictEqual(calcData.rudpData.acks.length, 0);
    assert.strictEqual(calcData.rudpData.retransmits.length, 0);
  });
});

test('RLNC 1-Byte File: Exactly 1 Source Block and Valid Metadata', async () => {
  await withServer(async (baseUrl) => {
    const oneByteBuf = Buffer.from('Z');
    const origSha = crypto.createHash('sha256').update(oneByteBuf).digest('hex');

    const formData = new FormData();
    const blob = new Blob([oneByteBuf], { type: 'application/octet-stream' });
    formData.append('file', blob, 'single_byte.txt');
    formData.append('protocol', 'rlnc');
    formData.append('blockSize', '512');
    formData.append('K', '4');

    const res = await fetch(`${baseUrl}/api/transfers`, {
      method: 'POST',
      body: formData,
    });
    assert.strictEqual(res.status, 201);
    const transfer = await res.json();

    assert.strictEqual(transfer.fileSize, 1);
    assert.strictEqual(transfer.fileSha256, origSha);

    const calcRes = await fetch(`${baseUrl}/api/calculations/transfer/${transfer.id}`);
    assert.strictEqual(calcRes.status, 200);
    const calcData = await calcRes.json();

    assert.strictEqual(calcData.fileSplitting.fileSize, 1);
    assert.strictEqual(calcData.fileSplitting.totalBlocks, 1);
    assert.strictEqual(calcData.fileSplitting.totalGenerations, 1);
    assert.strictEqual(calcData.requiredRank, 1); // targetK dynamically clamped to min(K, totalBlocks) = 1
  });
});

test('Transfer Isolation: Separate Transfers Have Independent Calculation State', async () => {
  await withServer(async (baseUrl) => {
    // Transfer A
    const bufA = Buffer.from('AlphaPayloadData');
    const formA = new FormData();
    formA.append('file', new Blob([bufA]), 'fileA.txt');
    formA.append('protocol', 'rlnc');
    const resA = await fetch(`${baseUrl}/api/transfers`, { method: 'POST', body: formA });
    const transA = await resA.json();

    // Transfer B
    const bufB = Buffer.from('BetaCompletelyDifferentBytesXYZ123LongerContent');
    const formB = new FormData();
    formB.append('file', new Blob([bufB]), 'fileB.txt');
    formB.append('protocol', 'rlnc');
    const resB = await fetch(`${baseUrl}/api/transfers`, { method: 'POST', body: formB });
    const transB = await resB.json();

    assert.notStrictEqual(transA.id, transB.id);
    assert.notStrictEqual(transA.fileSha256, transB.fileSha256);
    assert.notStrictEqual(transA.fileSize, transB.fileSize);

    const calcA = await (await fetch(`${baseUrl}/api/calculations/transfer/${transA.id}`)).json();
    const calcB = await (await fetch(`${baseUrl}/api/calculations/transfer/${transB.id}`)).json();

    assert.strictEqual(calcA.transferId, transA.id);
    assert.strictEqual(calcB.transferId, transB.id);
    assert.strictEqual(calcA.fileSplitting.fileSize, transA.fileSize);
    assert.strictEqual(calcB.fileSplitting.fileSize, transB.fileSize);
    assert.notStrictEqual(calcA.fileSplitting.fileSize, calcB.fileSplitting.fileSize);
  });
});
