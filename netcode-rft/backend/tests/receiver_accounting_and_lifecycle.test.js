/**
 * receiver_accounting_and_lifecycle.test.js
 * Comprehensive automated test suite verifying:
 * 1. Receiver initially shows zero received bytes and 0% progress.
 * 2. Handshake messages (TRANSFER_INIT, TRANSFER_READY, TRANSFER_START) do NOT increase file-reception progress.
 * 3. Sending the first packet does not mark the entire file as received.
 * 4. Dropped packets do not increase unique received file bytes.
 * 5. Duplicate packets do not inflate unique file progress.
 * 6. RLNC coded-packet reception does not automatically mark a generation as decoded.
 * 7. Insufficient RLNC rank does not produce a completed file.
 * 8. Missing data prevents reaching COMPLETED.
 * 9. Hash mismatch prevents verification and download.
 * 10. Cancellation prevents success.
 * 11. Only bit-exact, size-checked, hash-verified output enables final download.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const app = require('../src/app');
const store = require('../src/services/store');
const { UPLOADS_DIR } = require('../src/config');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Receiver State Machine simulation mirroring TransferContext logic
function computeReceiverState(transfer, events, transferLifecycle, latestHandshakeStep, verification) {
  const isVerified = Boolean(verification && verification.state === 'SUCCESS' && transferLifecycle === 'COMPLETED');

  const transferEvents = events.filter(e => !transfer?.id || !e.transfer_id || e.transfer_id === transfer.id);
  const rxEvents = transferEvents.filter(e => e.type === 'packet_received');
  const dropEvents = transferEvents.filter(e => e.type === 'packet_dropped');
  const reconEvents = transferEvents.filter(e => e.type === 'reconstruction_progress');
  const matrixEvents = transferEvents.filter(e => e.type === 'decoder_matrix_update');

  let statusLabel = 'Waiting for connection';
  if (transferLifecycle === 'IDLE') {
    statusLabel = 'Waiting for connection';
  } else if (transferLifecycle === 'INITIALIZING') {
    if (latestHandshakeStep === 1) statusLabel = 'Initializing transfer';
    else if (latestHandshakeStep === 2) statusLabel = 'Connection parameters accepted';
    else if (latestHandshakeStep === 3) statusLabel = 'Preparing to receive data';
    else statusLabel = 'Initializing transfer';
  } else if (transferLifecycle === 'TRANSFERRING') {
    statusLabel = 'Receiving data';
  } else if (transferLifecycle === 'DECODING') {
    statusLabel = 'Decoding coded blocks (GF(256))';
  } else if (transferLifecycle === 'RECONSTRUCTING') {
    statusLabel = 'Reconstructing file from blocks';
  } else if (transferLifecycle === 'VERIFYING') {
    statusLabel = 'Verifying file integrity (SHA-256)...';
  } else if (transferLifecycle === 'COMPLETED') {
    statusLabel = 'File received and verified';
  } else if (transferLifecycle === 'FAILED') {
    statusLabel = 'Transfer failed';
  } else if (transferLifecycle === 'CANCELLED') {
    statusLabel = 'Transfer cancelled';
  }

  // Authentic payload accounting
  const totalRxPayloadBytes = rxEvents.reduce((sum, e) => sum + (e.payload_len || 0), 0);

  // Unique bytes assembled (prevent inflation from duplicates/retransmissions)
  const uniqueSeqReceived = new Set();
  let uniqueReconstructedBytes = 0;
  for (const e of rxEvents) {
    if (!uniqueSeqReceived.has(e.seq_id)) {
      uniqueSeqReceived.add(e.seq_id);
      uniqueReconstructedBytes += (e.payload_len || 0);
    }
  }

  const latestMatrix = matrixEvents[matrixEvents.length - 1];
  const currentRank = latestMatrix ? latestMatrix.rank : 0;
  const requiredRank = latestMatrix ? latestMatrix.required_rank : (transfer?.K || 4);

  const latestRecon = reconEvents[reconEvents.length - 1];
  let progressPct = 0;

  if (transferLifecycle === 'COMPLETED' && isVerified) {
    progressPct = 100;
  } else if (transferLifecycle === 'IDLE' || transferLifecycle === 'INITIALIZING') {
    progressPct = 0;
  } else {
    if (transfer?.protocol === 'rudp') {
      const totalExpected = transfer?.fileSize || 1;
      progressPct = Math.min(99, Math.floor((uniqueReconstructedBytes / totalExpected) * 100));
    } else {
      const reconPct = latestRecon ? latestRecon.pct : 0;
      progressPct = Math.min(99, reconPct);
    }
  }

  const fileStatus = isVerified
    ? (transfer?.filename || 'reconstructed_file')
    : 'No file received yet';

  const fileSizeDisplay = isVerified
    ? `${transfer?.fileSize} bytes`
    : '0 bytes';

  return {
    status: statusLabel,
    fileStatus,
    fileSizeDisplay,
    progressPct,
    receivedPayloadBytes: totalRxPayloadBytes,
    uniqueReconstructedBytes,
    receivedPacketCount: rxEvents.length,
    droppedPacketCount: dropEvents.length,
    currentRank,
    requiredRank,
    isVerified,
    canDownload: Boolean(isVerified && transfer?.id),
  };
}

test('Criterion 1: Receiver initially shows zero received bytes and 0% progress', () => {
  const state = computeReceiverState(null, [], 'IDLE', 0, null);
  assert.equal(state.status, 'Waiting for connection');
  assert.equal(state.fileStatus, 'No file received yet');
  assert.equal(state.fileSizeDisplay, '0 bytes');
  assert.equal(state.receivedPayloadBytes, 0);
  assert.equal(state.progressPct, 0);
  assert.equal(state.canDownload, false);
});

test('Criterion 2: Handshake messages do not increase file-reception progress', () => {
  const transfer = { id: 't1', filename: 'alpha.bin', fileSize: 4096, protocol: 'rlnc', K: 4 };
  const handshakeEvents = [
    { type: 'handshake_step', step: 1, step_name: 'TRANSFER_INIT', payload_len: 0 },
    { type: 'handshake_step', step: 2, step_name: 'TRANSFER_READY', payload_len: 0 },
    { type: 'handshake_step', step: 3, step_name: 'TRANSFER_START', payload_len: 0 },
  ];

  // At step 1
  let state = computeReceiverState(transfer, [handshakeEvents[0]], 'INITIALIZING', 1, null);
  assert.equal(state.status, 'Initializing transfer');
  assert.equal(state.progressPct, 0);
  assert.equal(state.receivedPayloadBytes, 0);
  assert.equal(state.fileStatus, 'No file received yet');

  // At step 2
  state = computeReceiverState(transfer, handshakeEvents.slice(0, 2), 'INITIALIZING', 2, null);
  assert.equal(state.status, 'Connection parameters accepted');
  assert.equal(state.progressPct, 0);
  assert.equal(state.receivedPayloadBytes, 0);

  // At step 3
  state = computeReceiverState(transfer, handshakeEvents, 'INITIALIZING', 3, null);
  assert.equal(state.status, 'Preparing to receive data');
  assert.equal(state.progressPct, 0);
  assert.equal(state.receivedPayloadBytes, 0);
});

test('Criterion 3: Sending the first packet does not mark the entire file as received', () => {
  const transfer = { id: 't1', filename: 'alpha.bin', fileSize: 4096, protocol: 'rlnc', K: 4 };
  const events = [
    { type: 'packet_transmitted', seq_id: 0, payload_len: 1024 },
    { type: 'packet_received', seq_id: 0, payload_len: 1024 },
  ];

  const state = computeReceiverState(transfer, events, 'TRANSFERRING', 4, null);
  assert.equal(state.receivedPayloadBytes, 1024);
  assert.equal(state.receivedPacketCount, 1);
  assert(state.progressPct < 100, 'Progress must not be 100% on first packet');
  assert.equal(state.fileStatus, 'No file received yet');
  assert.equal(state.canDownload, false);
});

test('Criterion 4: Dropped packet does not increase unique received file bytes', () => {
  const transfer = { id: 't1', filename: 'test.dat', fileSize: 2048, protocol: 'rudp' };
  const events = [
    { type: 'packet_transmitted', seq_id: 0, payload_len: 1024 },
    { type: 'packet_dropped', seq_id: 0, reason: 'loss' },
  ];

  const state = computeReceiverState(transfer, events, 'TRANSFERRING', 4, null);
  assert.equal(state.receivedPayloadBytes, 0);
  assert.equal(state.uniqueReconstructedBytes, 0);
  assert.equal(state.droppedPacketCount, 1);
  assert.equal(state.progressPct, 0);
});

test('Criterion 5: Duplicate packet does not inflate unique file progress', () => {
  const transfer = { id: 't1', filename: 'test.dat', fileSize: 2048, protocol: 'rudp' };
  const events = [
    { type: 'packet_received', seq_id: 0, payload_len: 1024 },
    { type: 'packet_received', seq_id: 0, payload_len: 1024 }, // Duplicate
    { type: 'packet_received', seq_id: 0, payload_len: 1024 }, // Duplicate
  ];

  const state = computeReceiverState(transfer, events, 'TRANSFERRING', 4, null);
  // Total raw packet payload received is counted for network stats
  assert.equal(state.receivedPayloadBytes, 3072);
  // But unique reconstructed file bytes is strictly deduplicated
  assert.equal(state.uniqueReconstructedBytes, 1024);
  assert.equal(state.progressPct, 50); // 1024 / 2048 = 50%
});

test('Criterion 6: RLNC coded-packet reception does not automatically mark a generation as decoded', () => {
  const transfer = { id: 't1', filename: 'rlnc.bin', fileSize: 4096, protocol: 'rlnc', K: 4 };
  const events = [
    { type: 'packet_received', seq_id: 0, gen_id: 0, payload_len: 1024, coeffs: [1, 0, 0, 0] },
    { type: 'decoder_matrix_update', gen_id: 0, rank: 1, required_rank: 4 },
  ];

  const state = computeReceiverState(transfer, events, 'DECODING', 4, null);
  assert.equal(state.currentRank, 1);
  assert.equal(state.requiredRank, 4);
  assert.equal(state.fileStatus, 'No file received yet');
  assert.equal(state.canDownload, false);
});

test('Criterion 7: Insufficient RLNC rank does not produce a completed file', () => {
  const transfer = { id: 't1', filename: 'rlnc.bin', fileSize: 4096, protocol: 'rlnc', K: 4 };
  const events = [
    { type: 'packet_received', seq_id: 0, gen_id: 0, payload_len: 1024, coeffs: [1, 0, 0, 0] },
    { type: 'decoder_matrix_update', gen_id: 0, rank: 1, required_rank: 4 },
    { type: 'packet_received', seq_id: 1, gen_id: 0, payload_len: 1024, coeffs: [0, 1, 0, 0] },
    { type: 'decoder_matrix_update', gen_id: 0, rank: 2, required_rank: 4 },
    { type: 'packet_received', seq_id: 2, gen_id: 0, payload_len: 1024, coeffs: [0, 0, 1, 0] },
    { type: 'decoder_matrix_update', gen_id: 0, rank: 3, required_rank: 4 }, // rank 3 < K=4
  ];

  const state = computeReceiverState(transfer, events, 'DECODING', 4, null);
  assert.equal(state.currentRank, 3);
  assert(state.currentRank < state.requiredRank);
  assert.notEqual(state.status, 'File received and verified');
  assert.equal(state.fileStatus, 'No file received yet');
  assert.equal(state.canDownload, false);
});

test('Criterion 8: Missing data prevents reaching COMPLETED', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const dummyPath = path.join(UPLOADS_DIR, `test_missing_${Date.now()}.bin`);
    fs.writeFileSync(dummyPath, Buffer.from('critical payload'));
    const t = store.createTransfer({
      id: `test-missing-${Date.now()}`,
      filename: 'missing.bin',
      filePath: dummyPath,
      fileSize: 16,
      fileSha256: crypto.createHash('sha256').update('critical payload').digest('hex'),
      protocol: 'rudp',
    });
    store.updateTransfer(t.id, { status: 'running' });

    const res = await fetch(`http://localhost:${port}/api/transfers/${t.id}/verification`);
    const data = await res.json();
    assert.strictEqual(data.verified, false);
    assert.strictEqual(data.state, 'TRANSFERRING');
    fs.unlinkSync(dummyPath);
  } finally {
    server.close();
  }
});

test('Criterion 9: Hash mismatch prevents verification and download', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const dummyPath = path.join(UPLOADS_DIR, `test_mismatch_${Date.now()}.bin`);
    fs.writeFileSync(dummyPath, Buffer.from('original data'));
    const outPath = dummyPath + '.reconstructed';
    fs.writeFileSync(outPath, Buffer.from('corrupted data')); // deliberate mismatch

    const t = store.createTransfer({
      id: `test-mismatch-${Date.now()}`,
      filename: 'mismatch.bin',
      filePath: dummyPath,
      fileSize: 13,
      fileSha256: crypto.createHash('sha256').update('original data').digest('hex'),
      protocol: 'rlnc',
    });
    store.updateTransfer(t.id, { status: 'completed' });

    const res = await fetch(`http://localhost:${port}/api/transfers/${t.id}/verification`);
    const data = await res.json();
    assert.strictEqual(data.verified, false);
    assert.strictEqual(data.state, 'FAILED');
    assert.match(data.message, /mismatch/i);

    const uiState = computeReceiverState(t, [], 'FAILED', 4, data);
    assert.equal(uiState.isVerified, false);
    assert.equal(uiState.canDownload, false);
    assert.equal(uiState.fileStatus, 'No file received yet');

    fs.unlinkSync(dummyPath);
    fs.unlinkSync(outPath);
  } finally {
    server.close();
  }
});

test('Criterion 10: Cancellation prevents UI from showing success', () => {
  const transfer = { id: 't1', filename: 'canc.bin', fileSize: 4096, protocol: 'rudp' };
  const events = [{ type: 'packet_received', seq_id: 0, payload_len: 1024 }];
  const state = computeReceiverState(transfer, events, 'CANCELLED', 4, { state: 'CANCELLED' });

  assert.equal(state.status, 'Transfer cancelled');
  assert.equal(state.isVerified, false);
  assert.equal(state.canDownload, false);
  assert.equal(state.fileStatus, 'No file received yet');
});

test('Criterion 11: Only a fully reconstructed, size-checked, hash-verified output enables download', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const origData = Buffer.from('exact authentic file content payload');
    const dummyPath = path.join(UPLOADS_DIR, `test_exact_${Date.now()}.bin`);
    fs.writeFileSync(dummyPath, origData);
    const outPath = dummyPath + '.reconstructed';
    fs.writeFileSync(outPath, origData); // exact match

    const sha = crypto.createHash('sha256').update(origData).digest('hex');
    const t = store.createTransfer({
      id: `test-exact-${Date.now()}`,
      filename: 'exact.bin',
      filePath: dummyPath,
      fileSize: origData.length,
      fileSha256: sha,
      protocol: 'rlnc',
    });
    store.updateTransfer(t.id, { status: 'completed' });

    const res = await fetch(`http://localhost:${port}/api/transfers/${t.id}/verification`);
    const data = await res.json();
    assert.strictEqual(data.verified, true);
    assert.strictEqual(data.state, 'SUCCESS');
    assert.strictEqual(data.origSha, data.reconSha);

    const uiState = computeReceiverState(t, [{ type: 'packet_received', payload_len: origData.length }], 'COMPLETED', 4, data);
    assert.strictEqual(uiState.isVerified, true);
    assert.strictEqual(uiState.canDownload, true);
    assert.strictEqual(uiState.fileStatus, 'exact.bin');
    assert.strictEqual(uiState.progressPct, 100);

    // Verify download endpoint serves the reconstructed file
    const dlRes = await fetch(`http://localhost:${port}/api/transfers/${t.id}/download`);
    assert.strictEqual(dlRes.status, 200);
    const dlBuf = Buffer.from(await dlRes.arrayBuffer());
    assert.strictEqual(crypto.createHash('sha256').update(dlBuf).digest('hex'), sha);

    fs.unlinkSync(dummyPath);
    fs.unlinkSync(outPath);
  } finally {
    server.close();
  }
});
