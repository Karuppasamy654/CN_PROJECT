const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const app = require('../src/app');
const store = require('../src/services/store');

const UPLOADS_DIR = path.resolve(__dirname, '../uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function computeSha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

test('Negative Test 1: Verification reports NOT_STARTED prior to launch', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const dummyPath = path.join(UPLOADS_DIR, `test_notstarted_${Date.now()}.bin`);
    fs.writeFileSync(dummyPath, Buffer.from('hello world'));
    const t = store.createTransfer({
      id: `test-transfer-notstarted-${Date.now()}`,
      filename: 'dummy.bin',
      filePath: dummyPath,
      fileSize: 11,
      fileSha256: computeSha(Buffer.from('hello world')),
      protocol: 'rlnc',
    });

    const res = await fetch(`http://localhost:${port}/api/transfers/${t.id}/verification`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.verified, false);
    assert.strictEqual(data.state, 'NOT_STARTED');
    assert.strictEqual(data.message, 'Waiting to start transfer');
  } finally {
    server.close();
  }
});

test('Negative Test 2: Stopped/Cancelled transfer reports CANCELLED and not verified', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const dummyPath = path.join(UPLOADS_DIR, `test_cancelled_${Date.now()}.bin`);
    fs.writeFileSync(dummyPath, Buffer.from('sample payload for cancel test'));
    const t = store.createTransfer({
      id: `test-transfer-cancelled-${Date.now()}`,
      filename: 'cancel.bin',
      filePath: dummyPath,
      fileSize: 30,
      fileSha256: computeSha(Buffer.from('sample payload for cancel test')),
      protocol: 'rudp',
    });

    store.updateTransfer(t.id, { status: 'cancelled' });

    const res = await fetch(`http://localhost:${port}/api/transfers/${t.id}/verification`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.verified, false);
    assert.strictEqual(data.state, 'CANCELLED');
    assert.ok(data.message.includes('cancelled'));
  } finally {
    server.close();
  }
});

test('Negative Test 3: Engine process failure or crash reports FAILED and preserves error', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const dummyPath = path.join(UPLOADS_DIR, `test_failed_${Date.now()}.bin`);
    fs.writeFileSync(dummyPath, Buffer.from('engine error payload'));
    const t = store.createTransfer({
      id: `test-transfer-failed-${Date.now()}`,
      filename: 'failed.bin',
      filePath: dummyPath,
      fileSize: 20,
      fileSha256: computeSha(Buffer.from('engine error payload')),
      protocol: 'rlnc',
    });

    store.updateTransfer(t.id, {
      status: 'failed',
      exitCode: 1,
      error: 'Engine exited with code 1 (Decoder failed to reach full rank)',
    });

    const res = await fetch(`http://localhost:${port}/api/transfers/${t.id}/verification`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.verified, false);
    assert.strictEqual(data.state, 'FAILED');
    assert.ok(data.message.includes('Decoder failed to reach full rank'));
  } finally {
    server.close();
  }
});

test('Negative Test 4: Missing reconstructed file reports FAILED', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const dummyPath = path.join(UPLOADS_DIR, `test_missing_${Date.now()}.bin`);
    fs.writeFileSync(dummyPath, Buffer.from('missing recon'));
    const t = store.createTransfer({
      id: `test-transfer-missing-${Date.now()}`,
      filename: 'missing.bin',
      filePath: dummyPath,
      fileSize: 13,
      fileSha256: computeSha(Buffer.from('missing recon')),
      protocol: 'rlnc',
    });

    store.updateTransfer(t.id, { status: 'completed', exitCode: 0 });

    const res = await fetch(`http://localhost:${port}/api/transfers/${t.id}/verification`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.verified, false);
    assert.strictEqual(data.state, 'FAILED');
    assert.ok(data.message.includes('Reconstructed output file does not exist'));
  } finally {
    server.close();
  }
});

test('Negative Test 5: Truncated reconstructed file reports FAILED (size mismatch)', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const origData = Buffer.from('1234567890abcdefghijklmnopqrstuvwxyz');
    const dummyPath = path.join(UPLOADS_DIR, `test_trunc_${Date.now()}.bin`);
    const reconPath = dummyPath + '.reconstructed';
    fs.writeFileSync(dummyPath, origData);
    // Write truncated output (only first 10 bytes)
    fs.writeFileSync(reconPath, origData.subarray(0, 10));

    const t = store.createTransfer({
      id: `test-transfer-trunc-${Date.now()}`,
      filename: 'trunc.bin',
      filePath: dummyPath,
      fileSize: origData.length,
      fileSha256: computeSha(origData),
      protocol: 'rlnc',
    });

    store.updateTransfer(t.id, { status: 'completed', exitCode: 0 });

    const res = await fetch(`http://localhost:${port}/api/transfers/${t.id}/verification`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.verified, false);
    assert.strictEqual(data.state, 'FAILED');
    assert.strictEqual(data.byteEqual, false);
    assert.ok(data.message.includes('File size mismatch'));
    assert.strictEqual(data.origSize, origData.length);
    assert.strictEqual(data.reconSize, 10);
  } finally {
    server.close();
  }
});

test('Negative Test 6: Deliberate single-byte corruption triggers SHA-256 mismatch failure', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    // 512 bytes payload
    const origData = Buffer.alloc(512);
    for (let i = 0; i < 512; i++) origData[i] = (i * 17) & 0xff;

    const dummyPath = path.join(UPLOADS_DIR, `test_corrupt_${Date.now()}.bin`);
    const reconPath = dummyPath + '.reconstructed';
    fs.writeFileSync(dummyPath, origData);

    // Corrupt exactly ONE byte in reconstructed file
    const corruptedData = Buffer.from(origData);
    corruptedData[256] ^= 0x5a; // flip bits
    fs.writeFileSync(reconPath, corruptedData);

    const t = store.createTransfer({
      id: `test-transfer-corrupt-${Date.now()}`,
      filename: 'corrupt.bin',
      filePath: dummyPath,
      fileSize: origData.length,
      fileSha256: computeSha(origData),
      protocol: 'rlnc',
    });

    store.updateTransfer(t.id, { status: 'completed', exitCode: 0 });

    const res = await fetch(`http://localhost:${port}/api/transfers/${t.id}/verification`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.verified, false);
    assert.strictEqual(data.state, 'FAILED');
    assert.strictEqual(data.byteEqual, false);
    assert.ok(data.message.includes('SHA-256 cryptographic hash mismatch'));
    assert.notStrictEqual(data.origSha, data.reconSha);
  } finally {
    server.close();
  }
});

test('Positive Control: Bit-exact reconstructed file reports SUCCESS with matching SHA-256', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const origData = Buffer.alloc(1024);
    for (let i = 0; i < 1024; i++) origData[i] = (i * 31 + 7) & 0xff;

    const dummyPath = path.join(UPLOADS_DIR, `test_success_${Date.now()}.bin`);
    const reconPath = dummyPath + '.reconstructed';
    fs.writeFileSync(dummyPath, origData);
    fs.writeFileSync(reconPath, origData); // Exact match

    const origSha = computeSha(origData);
    const t = store.createTransfer({
      id: `test-transfer-success-${Date.now()}`,
      filename: 'exact.bin',
      filePath: dummyPath,
      fileSize: origData.length,
      fileSha256: origSha,
      protocol: 'rlnc',
    });

    store.updateTransfer(t.id, { status: 'completed', exitCode: 0 });

    const res = await fetch(`http://localhost:${port}/api/transfers/${t.id}/verification`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.verified, true);
    assert.strictEqual(data.state, 'SUCCESS');
    assert.strictEqual(data.byteEqual, true);
    assert.strictEqual(data.origSha, origSha);
    assert.strictEqual(data.reconSha, origSha);
    assert.strictEqual(data.message, 'File reconstructed and verified successfully');
  } finally {
    server.close();
  }
});
