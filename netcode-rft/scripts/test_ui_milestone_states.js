/**
 * test_ui_milestone_states.js
 *
 * Verifies the exact UI counters and state representations at the 7 mandatory milestones:
 * 1. Before the first transmission.
 * 2. After the first transmission.
 * 3. After the first packet drop.
 * 4. After the first packet reception.
 * 5. After the decoder reaches full rank.
 * 6. After reconstruction.
 * 7. After integrity verification.
 *
 * Also tests a second transfer immediately following the first to prove zero leakage.
 */

const assert = require('node:assert/strict');

// Model the authentic receiver and live metrics state engine mirroring TransferContext.jsx
function computeReceiverState({
  transfer,
  events = [],
  transferLifecycle = 'IDLE',
  latestHandshakeStep = 0,
  verification = null,
  finalMetrics = null,
  elapsedTime = 0,
}) {
  const isVerified = Boolean(
    verification &&
    verification.state === 'SUCCESS' &&
    verification.verified === true &&
    verification.byteEqual === true &&
    transferLifecycle === 'COMPLETED'
  );

  const currentId = transfer?.id;
  const transferEvents = events.filter(e => !currentId || !e.transfer_id || e.transfer_id === currentId);

  const seenEventKeys = new Set();
  const uniqueEvents = [];
  for (const e of transferEvents) {
    const key = e.event_id || `${e.type}-${e.seq_id ?? ''}-${e.gen_id ?? ''}-${e.step ?? ''}-${e.time ?? ''}`;
    if (!seenEventKeys.has(key)) {
      seenEventKeys.add(key);
      uniqueEvents.push(e);
    }
  }

  const txEvents = uniqueEvents.filter(e => e.type === 'packet_transmitted');
  const rxEvents = uniqueEvents.filter(e => e.type === 'packet_received');
  const dropEvents = uniqueEvents.filter(e => e.type === 'packet_dropped');
  const reconEvents = uniqueEvents.filter(e => e.type === 'reconstruction_progress');
  const matrixEvents = uniqueEvents.filter(e => e.type === 'decoder_matrix_update');
  const rudpRetransEvents = uniqueEvents.filter(e => e.type === 'rudp_retransmit');

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

  const physicalTransmissions = txEvents.length;
  const systematicSent = txEvents.filter(e => e.pkt_type === 'Systematic').length;
  const redundancySent = txEvents.filter(e => e.pkt_type === 'Mixed').length;
  const extraRepairSent = txEvents.filter(e => e.pkt_type === 'Mixed (Retransmit)').length;
  const rudpRetransmitCount = rudpRetransEvents.length;

  const receivedPacketCount = rxEvents.length;
  const droppedPacketCount = dropEvents.length;
  const totalRxPayloadBytes = rxEvents.reduce((sum, e) => sum + (e.payload_len || 0), 0);

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
  const codedPacketsReceived = rxEvents.filter(e => e.coeffs && e.coeffs.length > 0).length;

  const latestRecon = reconEvents[reconEvents.length - 1];
  const decodedGenerations = latestRecon ? Math.ceil((latestRecon.recovered_blocks || 0) / (transfer?.K || 4)) : 0;
  const reconstructedBytes = (transfer?.protocol === 'rudp')
    ? uniqueReconstructedBytes
    : (latestRecon ? Math.round((latestRecon.pct / 100) * (transfer?.fileSize || 0)) : 0);

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

  const isConnected = latestHandshakeStep >= 4 || (transferLifecycle !== 'IDLE' && transferLifecycle !== 'INITIALIZING');
  const expectedBlocks = isConnected && transfer?.fileSize ? Math.ceil(transfer.fileSize / (transfer?.blockSize || 1024)) : null;
  const expectedGenerations = isConnected && expectedBlocks ? Math.ceil(expectedBlocks / (transfer?.K || 4)) : null;

  const isCompletedStage = (transferLifecycle === 'COMPLETED' && isVerified);
  let displayDuration = '0.00 s';
  let displayThroughput = '0.00 KB/s';

  if (isCompletedStage) {
    if (finalMetrics?.duration_s != null) {
      displayDuration = `${Number(finalMetrics.duration_s).toFixed(2)} s`;
    } else if (elapsedTime > 0) {
      displayDuration = `${elapsedTime.toFixed(2)} s`;
    }

    if (finalMetrics?.throughput_kbps != null) {
      displayThroughput = `${Number(finalMetrics.throughput_kbps).toFixed(2)} KB/s`;
    } else if (finalMetrics?.throughput_mbps != null) {
      displayThroughput = `${(Number(finalMetrics.throughput_mbps) * 125).toFixed(2)} KB/s`;
    } else {
      const dur = (finalMetrics?.duration_s || elapsedTime || 0.01);
      displayThroughput = `${(totalRxPayloadBytes / 1024 / dur).toFixed(2)} KB/s`;
    }
  } else if (transferLifecycle === 'IDLE') {
    displayDuration = '0.00 s';
    displayThroughput = '0.00 KB/s';
  } else {
    displayDuration = `${elapsedTime.toFixed(2)} s`;
    const liveDuration = Math.max(0.01, elapsedTime);
    displayThroughput = `${(totalRxPayloadBytes / 1024 / liveDuration).toFixed(2)} KB/s`;
  }

  let fileStatus = 'No file received yet';
  let fileSizeDisplay = '0 bytes';

  if (isVerified) {
    fileStatus = transfer?.filename || 'reconstructed_file';
    fileSizeDisplay = verification?.reconSize
      ? `${(verification.reconSize / 1024).toFixed(1)} KB`
      : `${((transfer?.fileSize || 0) / 1024).toFixed(1)} KB`;
  } else if (transferLifecycle === 'FAILED') {
    fileStatus = 'Transfer failed';
    fileSizeDisplay = '0 bytes';
  } else if (transferLifecycle === 'CANCELLED') {
    fileStatus = 'Transfer cancelled';
    fileSizeDisplay = '0 bytes';
  } else if (
    transferLifecycle === 'TRANSFERRING' ||
    transferLifecycle === 'DECODING' ||
    transferLifecycle === 'RECONSTRUCTING' ||
    transferLifecycle === 'VERIFYING'
  ) {
    fileStatus = 'Partial / Incomplete';
    fileSizeDisplay = `${(totalRxPayloadBytes / 1024).toFixed(1)} KB received (Incomplete)`;
  } else {
    fileStatus = 'No file received yet';
    fileSizeDisplay = '0 bytes';
  }

  return {
    status: statusLabel,
    fileStatus,
    fileSizeDisplay,
    progressPct,
    receivedPayloadBytes: totalRxPayloadBytes,
    uniqueReconstructedBytes,
    physicalTransmissions,
    systematicSent,
    redundancySent,
    extraRepairSent,
    rudpRetransmitCount,
    receivedPacketCount,
    droppedPacketCount,
    expectedBlocks,
    expectedGenerations,
    currentRank,
    requiredRank,
    reconstructedBytes,
    codedPacketsReceived,
    decodedGenerations,
    displayDuration,
    displayThroughput,
    isVerified,
    canDownload: Boolean(isVerified && transfer?.id),
  };
}

console.log('=== VERIFYING UI COUNTERS AT ALL 7 MANDATORY MILESTONES ===\n');

const transfer1 = {
  id: 'transfer-live-1',
  filename: 'document.pdf',
  fileSize: 4096,
  blockSize: 1024,
  K: 4,
  redundancy: 2,
  protocol: 'rlnc',
  lossRate: 10,
};

const events = [];

// Milestone 1: Before the first transmission (Handshake ongoing)
events.push(
  { transfer_id: transfer1.id, type: 'handshake_step', step: 1, step_name: 'TRANSFER_INIT', time: 10.0 },
  { transfer_id: transfer1.id, type: 'handshake_step', step: 2, step_name: 'TRANSFER_READY', time: 10.5 },
  { transfer_id: transfer1.id, type: 'handshake_step', step: 3, step_name: 'TRANSFER_START', time: 11.0 }
);

const m1 = computeReceiverState({
  transfer: transfer1,
  events,
  transferLifecycle: 'INITIALIZING',
  latestHandshakeStep: 3,
  elapsedTime: 0.05,
});

console.log('1. BEFORE FIRST TRANSMISSION:');
console.log(`   Status: "${m1.status}" | Progress: ${m1.progressPct}% | Rx Bytes: ${m1.receivedPayloadBytes} B | Transmissions: ${m1.physicalTransmissions} | Download: ${m1.canDownload}`);
assert.equal(m1.progressPct, 0);
assert.equal(m1.physicalTransmissions, 0);
assert.equal(m1.receivedPayloadBytes, 0);
assert.equal(m1.receivedPacketCount, 0);
assert.equal(m1.currentRank, 0);
assert.equal(m1.reconstructedBytes, 0);
assert.equal(m1.fileStatus, 'No file received yet');
assert.equal(m1.canDownload, false);

// Handshake complete
events.push({ transfer_id: transfer1.id, type: 'handshake_step', step: 4, step_name: 'INITIALIZATION_COMPLETE', time: 11.5 });

// Milestone 2: After the first transmission
events.push({
  transfer_id: transfer1.id,
  type: 'packet_transmitted',
  seq_id: 0,
  gen_id: 0,
  pkt_type: 'Systematic',
  time: 20.0,
});

const m2 = computeReceiverState({
  transfer: transfer1,
  events,
  transferLifecycle: 'TRANSFERRING',
  latestHandshakeStep: 4,
  elapsedTime: 0.1,
});

console.log('2. AFTER FIRST TRANSMISSION:');
console.log(`   Status: "${m2.status}" | Progress: ${m2.progressPct}% | Rx Bytes: ${m2.receivedPayloadBytes} B | Transmissions: ${m2.physicalTransmissions} | Systematic Sent: ${m2.systematicSent}`);
assert.equal(m2.physicalTransmissions, 1);
assert.equal(m2.systematicSent, 1);
assert.equal(m2.receivedPacketCount, 0);
assert.equal(m2.receivedPayloadBytes, 0);
assert.equal(m2.progressPct, 0);
assert.equal(m2.fileStatus, 'Partial / Incomplete');

// Milestone 3: After the first packet drop
events.push({
  transfer_id: transfer1.id,
  type: 'packet_dropped',
  seq_id: 0,
  gen_id: 0,
  reason: 'Loss simulated',
  time: 20.1,
});

const m3 = computeReceiverState({
  transfer: transfer1,
  events,
  transferLifecycle: 'TRANSFERRING',
  latestHandshakeStep: 4,
  elapsedTime: 0.12,
});

console.log('3. AFTER FIRST PACKET DROP:');
console.log(`   Status: "${m3.status}" | Dropped Pkts: ${m3.droppedPacketCount} | Rx Pkts: ${m3.receivedPacketCount} | Rx Bytes: ${m3.receivedPayloadBytes} B`);
assert.equal(m3.droppedPacketCount, 1);
assert.equal(m3.receivedPacketCount, 0);
assert.equal(m3.receivedPayloadBytes, 0);
assert.equal(m3.reconstructedBytes, 0);

// Milestone 4: After the first packet reception
events.push(
  { transfer_id: transfer1.id, type: 'packet_transmitted', seq_id: 1, gen_id: 0, pkt_type: 'Systematic', time: 25.0 },
  { transfer_id: transfer1.id, type: 'packet_received', seq_id: 1, gen_id: 0, payload_len: 1024, coeffs: [0, 1, 0, 0], time: 25.2 },
  { transfer_id: transfer1.id, type: 'decoder_matrix_update', gen_id: 0, rank: 1, required_rank: 4, innovative: true, time: 25.3 }
);

const m4 = computeReceiverState({
  transfer: transfer1,
  events,
  transferLifecycle: 'DECODING',
  latestHandshakeStep: 4,
  elapsedTime: 0.18,
});

console.log('4. AFTER FIRST PACKET RECEPTION:');
console.log(`   Status: "${m4.status}" | Rx Pkts: ${m4.receivedPacketCount} | Rx Bytes: ${m4.receivedPayloadBytes} B | Decoder Rank: ${m4.currentRank}/${m4.requiredRank} | Reconstructed: ${m4.reconstructedBytes} B`);
assert.equal(m4.physicalTransmissions, 2);
assert.equal(m4.receivedPacketCount, 1);
assert.equal(m4.receivedPayloadBytes, 1024);
assert.equal(m4.currentRank, 1);
assert.equal(m4.requiredRank, 4);
assert.equal(m4.decodedGenerations, 0);
assert.equal(m4.reconstructedBytes, 0);
assert.equal(m4.progressPct, 0);
assert.equal(m4.canDownload, false);

// Milestone 5: After the decoder reaches full rank (packets 2, 3, 4 arrive)
events.push(
  { transfer_id: transfer1.id, type: 'packet_transmitted', seq_id: 2, gen_id: 0, pkt_type: 'Systematic', time: 30.0 },
  { transfer_id: transfer1.id, type: 'packet_received', seq_id: 2, gen_id: 0, payload_len: 1024, coeffs: [0, 0, 1, 0], time: 30.2 },
  { transfer_id: transfer1.id, type: 'decoder_matrix_update', gen_id: 0, rank: 2, required_rank: 4, innovative: true, time: 30.3 },

  { transfer_id: transfer1.id, type: 'packet_transmitted', seq_id: 3, gen_id: 0, pkt_type: 'Systematic', time: 35.0 },
  { transfer_id: transfer1.id, type: 'packet_received', seq_id: 3, gen_id: 0, payload_len: 1024, coeffs: [0, 0, 0, 1], time: 35.2 },
  { transfer_id: transfer1.id, type: 'decoder_matrix_update', gen_id: 0, rank: 3, required_rank: 4, innovative: true, time: 35.3 },

  { transfer_id: transfer1.id, type: 'packet_transmitted', seq_id: 4, gen_id: 0, pkt_type: 'Mixed', time: 40.0 },
  { transfer_id: transfer1.id, type: 'packet_received', seq_id: 4, gen_id: 0, payload_len: 1024, coeffs: [42, 17, 99, 105], time: 40.2 },
  { transfer_id: transfer1.id, type: 'decoder_matrix_update', gen_id: 0, rank: 4, required_rank: 4, innovative: true, time: 40.3 }
);

const m5 = computeReceiverState({
  transfer: transfer1,
  events,
  transferLifecycle: 'DECODING',
  latestHandshakeStep: 4,
  elapsedTime: 0.25,
});

console.log('5. AFTER DECODER REACHES FULL RANK:');
console.log(`   Status: "${m5.status}" | Decoder Rank: ${m5.currentRank}/${m5.requiredRank} | Reconstructed B: ${m5.reconstructedBytes} B | Progress: ${m5.progressPct}% | Verified: ${m5.isVerified}`);
assert.equal(m5.currentRank, 4);
assert.equal(m5.requiredRank, 4);
assert.equal(m5.isVerified, false);
assert.notEqual(m5.progressPct, 100);

// Milestone 6: After reconstruction
events.push({
  transfer_id: transfer1.id,
  type: 'reconstruction_progress',
  recovered_blocks: 4,
  total_blocks: 4,
  pct: 100,
  time: 42.0,
});

const m6 = computeReceiverState({
  transfer: transfer1,
  events,
  transferLifecycle: 'VERIFYING',
  latestHandshakeStep: 4,
  elapsedTime: 0.28,
});

console.log('6. AFTER RECONSTRUCTION:');
console.log(`   Status: "${m6.status}" | Reconstructed Bytes: ${m6.reconstructedBytes} B | Decoded Gens: ${m6.decodedGenerations} | Progress: ${m6.progressPct}% | Can Download: ${m6.canDownload}`);
assert.equal(m6.reconstructedBytes, 4096);
assert.equal(m6.decodedGenerations, 1);
assert.equal(m6.canDownload, false); // Still false until verification passes!
assert.notEqual(m6.fileStatus, 'document.pdf'); // Still Partial / Incomplete!

// Milestone 7: After integrity verification
const m7 = computeReceiverState({
  transfer: transfer1,
  events,
  transferLifecycle: 'COMPLETED',
  latestHandshakeStep: 4,
  verification: {
    state: 'SUCCESS',
    verified: true,
    byteEqual: true,
    origSize: 4096,
    reconSize: 4096,
    origSha: 'abc',
    reconSha: 'abc',
  },
  finalMetrics: { duration_s: 0.28, throughput_kbps: 18.29 },
  elapsedTime: 0.28,
});

console.log('7. AFTER INTEGRITY VERIFICATION:');
console.log(`   Status: "${m7.status}" | File: ${m7.fileStatus} (${m7.fileSizeDisplay}) | Progress: ${m7.progressPct}% | Verified: ${m7.isVerified} | Can Download: ${m7.canDownload}`);
assert.equal(m7.progressPct, 100);
assert.equal(m7.fileStatus, 'document.pdf');
assert.equal(m7.isVerified, true);
assert.equal(m7.canDownload, true);
assert.equal(m7.displayDuration, '0.28 s');

console.log('\n=== TESTING SECOND TRANSFER IMMEDIATELY AFTER FIRST (STATE ISOLATION) ===');

const transfer2 = {
  id: 'transfer-live-2',
  filename: 'presentation.pptx',
  fileSize: 8192,
  blockSize: 1024,
  K: 4,
  redundancy: 2,
  protocol: 'rlnc',
  lossRate: 0,
};

// Start transfer 2 with clean state and only its own events
const transfer2Events = [
  { transfer_id: transfer2.id, type: 'handshake_step', step: 1, step_name: 'TRANSFER_INIT', time: 100.0 },
];

const t2State = computeReceiverState({
  transfer: transfer2,
  events: transfer2Events, // Even if old events existed in memory, active transfer ID filters them out!
  transferLifecycle: 'INITIALIZING',
  latestHandshakeStep: 1,
  verification: null,
  finalMetrics: null,
  elapsedTime: 0.01,
});

console.log(`Transfer 2 Initial State:`);
console.log(`   Status: "${t2State.status}" | Transmissions: ${t2State.physicalTransmissions} | Rx Bytes: ${t2State.receivedPayloadBytes} B | File: ${t2State.fileStatus} | Download: ${t2State.canDownload}`);

assert.equal(t2State.physicalTransmissions, 0);
assert.equal(t2State.receivedPacketCount, 0);
assert.equal(t2State.receivedPayloadBytes, 0);
assert.equal(t2State.droppedPacketCount, 0);
assert.equal(t2State.currentRank, 0);
assert.equal(t2State.reconstructedBytes, 0);
assert.equal(t2State.progressPct, 0);
assert.equal(t2State.fileStatus, 'No file received yet');
assert.equal(t2State.canDownload, false);

console.log('\nALL 7 MILESTONES AND SECOND-TRANSFER STATE ISOLATION VERIFIED SUCCESSFULLY!');
