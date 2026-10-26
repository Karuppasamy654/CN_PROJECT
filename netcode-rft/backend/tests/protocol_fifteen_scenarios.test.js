const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const app = require('../src/app');
const store = require('../src/services/store');
const gf256 = require('../src/services/gf256Service');
const rlnc = require('../src/services/rlncService');

const UPLOADS_DIR = path.resolve(__dirname, '../uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

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

// 1. Empty file
test('Scenario 1: Empty file (0 bytes)', async () => {
  await withServer(async (baseUrl) => {
    const emptyBuf = Buffer.alloc(0);
    const form = new FormData();
    form.append('file', new Blob([emptyBuf]), 'scenario1_empty.bin');
    form.append('protocol', 'rudp');
    form.append('blockSize', '1024');

    const res = await fetch(`${baseUrl}/api/transfers`, { method: 'POST', body: form });
    assert.strictEqual(res.status, 201);
    const t = await res.json();
    assert.strictEqual(t.fileSize, 0);
    assert.strictEqual(t.fileSha256, EMPTY_SHA);

    const calc = await (await fetch(`${baseUrl}/api/calculations/transfer/${t.id}`)).json();
    assert.strictEqual(calc.fileSplitting.totalBlocks, 0);
    assert.strictEqual(calc.rudpData.metrics.originalBlocks, 0);
  });
});

// 2. One-byte file
test('Scenario 2: One-byte file', async () => {
  await withServer(async (baseUrl) => {
    const oneBuf = Buffer.from([0x7f]);
    const form = new FormData();
    form.append('file', new Blob([oneBuf]), 'scenario2_one.bin');
    form.append('protocol', 'rudp');
    form.append('blockSize', '1024');

    const res = await fetch(`${baseUrl}/api/transfers`, { method: 'POST', body: form });
    assert.strictEqual(res.status, 201);
    const t = await res.json();
    assert.strictEqual(t.fileSize, 1);
    assert.strictEqual(t.fileSha256, sha(oneBuf));

    const calc = await (await fetch(`${baseUrl}/api/calculations/transfer/${t.id}`)).json();
    assert.strictEqual(calc.fileSplitting.totalBlocks, 1);
  });
});

// 3. File smaller than one block
test('Scenario 3: File smaller than one block (500 B < 1024 B)', async () => {
  await withServer(async (baseUrl) => {
    const buf = Buffer.alloc(500);
    for (let i = 0; i < 500; i++) buf[i] = (i * 3 + 1) & 0xff;
    const form = new FormData();
    form.append('file', new Blob([buf]), 'scenario3_small.bin');
    form.append('protocol', 'rudp');
    form.append('blockSize', '1024');

    const res = await fetch(`${baseUrl}/api/transfers`, { method: 'POST', body: form });
    const t = await res.json();
    assert.strictEqual(t.fileSize, 500);

    const calc = await (await fetch(`${baseUrl}/api/calculations/transfer/${t.id}`)).json();
    assert.strictEqual(calc.fileSplitting.totalBlocks, 1);
    assert.strictEqual(calc.fileSplitting.lastBlockSize, 500);
  });
});

// 4. File exactly one block
test('Scenario 4: File exactly one block (1024 B == 1024 B)', async () => {
  await withServer(async (baseUrl) => {
    const buf = Buffer.alloc(1024);
    for (let i = 0; i < 1024; i++) buf[i] = (i * 5 + 7) & 0xff;
    const form = new FormData();
    form.append('file', new Blob([buf]), 'scenario4_exact.bin');
    form.append('protocol', 'rudp');
    form.append('blockSize', '1024');

    const res = await fetch(`${baseUrl}/api/transfers`, { method: 'POST', body: form });
    const t = await res.json();
    assert.strictEqual(t.fileSize, 1024);

    const calc = await (await fetch(`${baseUrl}/api/calculations/transfer/${t.id}`)).json();
    assert.strictEqual(calc.fileSplitting.totalBlocks, 1);
    assert.strictEqual(calc.fileSplitting.lastBlockSize, 1024);
    assert.strictEqual(calc.fileSplitting.paddingBytes, 0);
  });
});

// 5. File with a partial final block
test('Scenario 5: File with a partial final block (2500 B, block size 1024 B -> 3 blocks: 1024, 1024, 452)', async () => {
  await withServer(async (baseUrl) => {
    const buf = Buffer.alloc(2500);
    for (let i = 0; i < 2500; i++) buf[i] = (i ^ 0x3c) & 0xff;
    const form = new FormData();
    form.append('file', new Blob([buf]), 'scenario5_partial.bin');
    form.append('protocol', 'rudp');
    form.append('blockSize', '1024');

    const res = await fetch(`${baseUrl}/api/transfers`, { method: 'POST', body: form });
    const t = await res.json();
    assert.strictEqual(t.fileSize, 2500);

    const calc = await (await fetch(`${baseUrl}/api/calculations/transfer/${t.id}`)).json();
    assert.strictEqual(calc.fileSplitting.totalBlocks, 3);
    assert.strictEqual(calc.fileSplitting.lastBlockSize, 452);
  });
});

// 6. Multiple-block file
test('Scenario 6: Multiple-block file (4096 B, block size 1024 B -> exactly 4 blocks)', async () => {
  await withServer(async (baseUrl) => {
    const buf = Buffer.alloc(4096);
    for (let i = 0; i < 4096; i++) buf[i] = (i * 13 + 3) & 0xff;
    const form = new FormData();
    form.append('file', new Blob([buf]), 'scenario6_multi.bin');
    form.append('protocol', 'rudp');
    form.append('blockSize', '1024');

    const res = await fetch(`${baseUrl}/api/transfers`, { method: 'POST', body: form });
    const t = await res.json();
    assert.strictEqual(t.fileSize, 4096);

    const calc = await (await fetch(`${baseUrl}/api/calculations/transfer/${t.id}`)).json();
    assert.strictEqual(calc.fileSplitting.totalBlocks, 4);
    assert.strictEqual(calc.fileSplitting.lastBlockSize, 1024);
  });
});

// 7. Forward data packet loss
test('Scenario 7: Forward data packet loss accounting and isolation', async () => {
  await withServer(async (baseUrl) => {
    const dummyPath = path.join(UPLOADS_DIR, `test_fwd_loss_${Date.now()}.bin`);
    fs.writeFileSync(dummyPath, Buffer.from('Forward loss payload test'));
    fs.writeFileSync(dummyPath + '.reconstructed', Buffer.from('Forward loss payload test'));

    const t = store.createTransfer({
      id: `test-fwd-loss-${Date.now()}`,
      filename: 'fwd_loss.bin',
      filePath: dummyPath,
      fileSize: 25,
      fileSha256: sha(Buffer.from('Forward loss payload test')),
      protocol: 'rudp',
      blockSize: 1024,
      K: 4,
    });

    // Simulate real events: initial tx dropped, retry transmitted and acked
    store.addEvent(t.id, { type: 'source_block_created', block_id: 0, len: 25, time: 10 });
    store.addEvent(t.id, { type: 'packet_transmitted', seq_id: 0, attempt: 1, payload_len: 25, time: 11 });
    store.addEvent(t.id, { type: 'packet_dropped', seq_id: 0, attempt: 1, reason: 'Loss simulated', time: 12 });
    store.addEvent(t.id, { type: 'rudp_timeout', seq_id: 0, attempt: 1, timeout_ms: 150, time: 161 });
    store.addEvent(t.id, { type: 'rudp_retransmit', seq_id: 0, retry_count: 1, attempt: 2, time: 162 });
    store.addEvent(t.id, { type: 'packet_transmitted', seq_id: 0, attempt: 2, payload_len: 25, time: 163 });
    store.addEvent(t.id, { type: 'packet_received', seq_id: 0, payload_len: 25, time: 164 });
    store.addEvent(t.id, { type: 'rudp_ack_sent', ack_seq: 0, time: 165 });
    store.addEvent(t.id, { type: 'rudp_ack', ack_seq: 0, attempt: 2, rtt_ms: 2.1, time: 166 });

    store.updateTransfer(t.id, { status: 'completed', exitCode: 0 });

    const calc = await (await fetch(`${baseUrl}/api/calculations/transfer/${t.id}`)).json();
    const metrics = calc.rudpData.metrics;
    assert.strictEqual(metrics.originalBlocks, 1);
    assert.strictEqual(metrics.transmissionAttempts, 2);
    assert.strictEqual(metrics.droppedPackets, 1);
    assert.strictEqual(metrics.retransmissions, 1);
    assert.strictEqual(metrics.uniquePacketsReceived, 1);
    assert.strictEqual(metrics.acksSent, 1);
    assert.strictEqual(metrics.acksReceived, 1);
  });
});

// 8. Reverse ACK loss
test('Scenario 8: Reverse ACK loss accounting and duplicate ACK handling', async () => {
  await withServer(async (baseUrl) => {
    const dummyPath = path.join(UPLOADS_DIR, `test_rev_ack_loss_${Date.now()}.bin`);
    fs.writeFileSync(dummyPath, Buffer.from('Reverse ACK loss payload test'));
    fs.writeFileSync(dummyPath + '.reconstructed', Buffer.from('Reverse ACK loss payload test'));

    const t = store.createTransfer({
      id: `test-rev-loss-${Date.now()}`,
      filename: 'rev_loss.bin',
      filePath: dummyPath,
      fileSize: 29,
      fileSha256: sha(Buffer.from('Reverse ACK loss payload test')),
      protocol: 'rudp',
      blockSize: 1024,
      K: 4,
    });

    // Forward packet arrives, receiver sends ACK, but ACK is dropped
    store.addEvent(t.id, { type: 'source_block_created', block_id: 0, len: 29, time: 10 });
    store.addEvent(t.id, { type: 'packet_transmitted', seq_id: 0, attempt: 1, payload_len: 29, time: 11 });
    store.addEvent(t.id, { type: 'packet_received', seq_id: 0, payload_len: 29, time: 12 });
    store.addEvent(t.id, { type: 'rudp_ack_sent', ack_seq: 0, time: 13 }); // 1st ACK sent

    // Sender times out, retransmits
    store.addEvent(t.id, { type: 'rudp_timeout', seq_id: 0, attempt: 1, timeout_ms: 150, time: 161 });
    store.addEvent(t.id, { type: 'rudp_retransmit', seq_id: 0, retry_count: 1, attempt: 2, time: 162 });
    store.addEvent(t.id, { type: 'packet_transmitted', seq_id: 0, attempt: 2, payload_len: 29, time: 163 });
    // Receiver receives duplicate, re-sends ACK
    store.addEvent(t.id, { type: 'packet_received', seq_id: 0, payload_len: 29, time: 164 });
    store.addEvent(t.id, { type: 'rudp_ack_sent', ack_seq: 0, time: 165 }); // 2nd ACK sent
    store.addEvent(t.id, { type: 'rudp_ack', ack_seq: 0, attempt: 2, rtt_ms: 2.2, time: 166 });

    store.updateTransfer(t.id, { status: 'completed', exitCode: 0 });

    const calc = await (await fetch(`${baseUrl}/api/calculations/transfer/${t.id}`)).json();
    const metrics = calc.rudpData.metrics;
    assert.strictEqual(metrics.originalBlocks, 1);
    assert.strictEqual(metrics.transmissionAttempts, 2);
    assert.strictEqual(metrics.droppedPackets, 0); // No forward packet dropped
    assert.strictEqual(metrics.retransmissions, 1);
    assert.strictEqual(metrics.uniquePacketsReceived, 1);
    assert.strictEqual(metrics.acksSent, 2); // 2 ACKs sent by receiver
    assert.strictEqual(metrics.acksReceived, 1); // Only 1 ACK reached sender
  });
});

// 9. Duplicate and delayed ACKs
test('Scenario 9: Duplicate and delayed ACKs are correlated to correct sequence', async () => {
  await withServer(async (baseUrl) => {
    const dummyPath = path.join(UPLOADS_DIR, `test_delayed_ack_${Date.now()}.bin`);
    fs.writeFileSync(dummyPath, Buffer.from('Delayed ACK payload'));
    fs.writeFileSync(dummyPath + '.reconstructed', Buffer.from('Delayed ACK payload'));

    const t = store.createTransfer({
      id: `test-delayed-ack-${Date.now()}`,
      filename: 'delayed_ack.bin',
      filePath: dummyPath,
      fileSize: 19,
      fileSha256: sha(Buffer.from('Delayed ACK payload')),
      protocol: 'rudp',
    });

    // Seq 0 ACK arrives
    store.addEvent(t.id, { type: 'rudp_ack_sent', ack_seq: 0, time: 10 });
    store.addEvent(t.id, { type: 'rudp_ack', ack_seq: 0, attempt: 1, rtt_ms: 1.5, time: 12 });
    // Delayed duplicate ACK for seq 0 arrives later while seq 1 is in progress
    store.addEvent(t.id, { type: 'rudp_ack', ack_seq: 0, attempt: 1, rtt_ms: 1.5, time: 50 });
    // Seq 1 ACK arrives
    store.addEvent(t.id, { type: 'rudp_ack_sent', ack_seq: 1, time: 60 });
    store.addEvent(t.id, { type: 'rudp_ack', ack_seq: 1, attempt: 1, rtt_ms: 1.2, time: 62 });

    store.updateTransfer(t.id, { status: 'completed', exitCode: 0 });

    const calc = await (await fetch(`${baseUrl}/api/calculations/transfer/${t.id}`)).json();
    assert.strictEqual(calc.rudpData.acks.length, 3);
    assert.strictEqual(calc.rudpData.acks[0].ackSeq, 0);
    assert.strictEqual(calc.rudpData.acks[1].ackSeq, 0);
    assert.strictEqual(calc.rudpData.acks[2].ackSeq, 1);
  });
});

// 10. RLNC recovery after packet loss
test('Scenario 10: RLNC recovery after packet loss (innovative coded packet restores rank)', () => {
  // Let K = 3 blocks of 4 bytes each
  const b1 = [10, 20, 30, 40];
  const b2 = [50, 60, 70, 80];
  const b3 = [90, 100, 110, 120];
  const blocks = [b1, b2, b3];

  // Packet 1: systematic for block 1 (coeffs: [1, 0, 0])
  const p1 = rlnc.computeLinearCombination(blocks, [1, 0, 0]).codedPayload;
  // Packet 2: systematic for block 2 is LOST!
  // Packet 3: systematic for block 3 (coeffs: [0, 0, 1])
  const p3 = rlnc.computeLinearCombination(blocks, [0, 0, 1]).codedPayload;
  // Packet 4: repair random linear combination (coeffs: [2, 3, 5])
  const p4 = rlnc.computeLinearCombination(blocks, [2, 3, 5]).codedPayload;

  const matrixA = [
    [1, 0, 0],
    [0, 0, 1],
    [2, 3, 5],
  ];
  const matrixC = [p1, p3, p4];

  const solved = rlnc.solveGaussJordan(matrixA, matrixC);
  assert.strictEqual(solved.rank, 3);
  assert.strictEqual(solved.isFullRank, true);

  // Verify decoded block 2 matches original b2 byte-for-byte!
  assert.deepStrictEqual(solved.matrixC[1], b2);
  // Verify all 3 decoded blocks
  assert.deepStrictEqual(solved.matrixC[0], b1);
  assert.deepStrictEqual(solved.matrixC[2], b3);
});

// 11. Insufficient RLNC equation rank
test('Scenario 11: Insufficient RLNC equation rank (rank < K fails reconstruction)', () => {
  // K = 3, but only 2 independent equations received
  const matrixA = [
    [1, 0, 0],
    [0, 1, 0],
  ];
  const matrixC = [
    [10, 20],
    [30, 40],
  ];

  const solved = rlnc.solveGaussJordan(matrixA, matrixC);
  assert.strictEqual(solved.rank, 2);
  assert.strictEqual(solved.isFullRank, false);
});

// 12. Missing or corrupted reconstructed output
test('Scenario 12: Missing reconstructed output reports FAILED', async () => {
  await withServer(async (baseUrl) => {
    const dummyPath = path.join(UPLOADS_DIR, `test_missing_recon_${Date.now()}.bin`);
    fs.writeFileSync(dummyPath, Buffer.from('Original payload'));
    // Deliberately do NOT create .reconstructed file

    const t = store.createTransfer({
      id: `test-missing-recon-${Date.now()}`,
      filename: 'missing_recon.bin',
      filePath: dummyPath,
      fileSize: 16,
      fileSha256: sha(Buffer.from('Original payload')),
      protocol: 'rudp',
    });
    store.updateTransfer(t.id, { status: 'completed', exitCode: 0 });

    const res = await (await fetch(`${baseUrl}/api/transfers/${t.id}/verification`)).json();
    assert.strictEqual(res.verified, false);
    assert.strictEqual(res.state, 'FAILED');
    assert.ok(res.message.includes('Reconstructed output file does not exist'));
  });
});

// 13. Transfer ID mismatch
test('Scenario 13: Transfer ID mismatch returns 404', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/transfers/nonexistent-transfer-99999/verification`);
    assert.strictEqual(res.status, 404);
  });
});

// 14. Source/destination size mismatch
test('Scenario 14: Source/destination size mismatch reports FAILED', async () => {
  await withServer(async (baseUrl) => {
    const dummyPath = path.join(UPLOADS_DIR, `test_size_mismatch_${Date.now()}.bin`);
    fs.writeFileSync(dummyPath, Buffer.from('Original 16 Byte'));
    fs.writeFileSync(dummyPath + '.reconstructed', Buffer.from('Truncated 12')); // 12 bytes instead of 16

    const t = store.createTransfer({
      id: `test-size-mismatch-${Date.now()}`,
      filename: 'size_mismatch.bin',
      filePath: dummyPath,
      fileSize: 16,
      fileSha256: sha(Buffer.from('Original 16 Byte')),
      protocol: 'rudp',
    });
    store.updateTransfer(t.id, { status: 'completed', exitCode: 0 });

    const res = await (await fetch(`${baseUrl}/api/transfers/${t.id}/verification`)).json();
    assert.strictEqual(res.verified, false);
    assert.strictEqual(res.state, 'FAILED');
    assert.strictEqual(res.byteEqual, false);
    assert.ok(res.message.includes('File size mismatch'));
  });
});

// 15. SHA-256 mismatch
test('Scenario 15: Single byte corruption causes SHA-256 mismatch and reports FAILED', async () => {
  await withServer(async (baseUrl) => {
    const origData = Buffer.from('Exact same size 24 bytes!!');
    const corruptedData = Buffer.from('Exact same size 24 bytes??'); // '?' instead of '!'

    const dummyPath = path.join(UPLOADS_DIR, `test_sha_mismatch_${Date.now()}.bin`);
    fs.writeFileSync(dummyPath, origData);
    fs.writeFileSync(dummyPath + '.reconstructed', corruptedData);

    const t = store.createTransfer({
      id: `test-sha-mismatch-${Date.now()}`,
      filename: 'sha_mismatch.bin',
      filePath: dummyPath,
      fileSize: origData.length,
      fileSha256: sha(origData),
      protocol: 'rudp',
    });
    store.updateTransfer(t.id, { status: 'completed', exitCode: 0 });

    const res = await (await fetch(`${baseUrl}/api/transfers/${t.id}/verification`)).json();
    assert.strictEqual(res.verified, false);
    assert.strictEqual(res.state, 'FAILED');
    assert.strictEqual(res.byteEqual, false);
    assert.ok(res.message.includes('SHA-256 cryptographic hash mismatch'));
    assert.notStrictEqual(res.origSha, res.reconSha);
  });
});
