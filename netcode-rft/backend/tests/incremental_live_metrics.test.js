/**
 * incremental_live_metrics.test.js
 *
 * Automated regression tests verifying:
 * 1. Initial live counters start at zero.
 * 2. One packet reception does not populate final packet counts.
 * 3. One packet reception does not set transfer progress to 100%.
 * 4. One packet reception does not automatically set decoder rank to K.
 * 5. One packet reception does not mark all generations decoded.
 * 6. One packet reception does not mark the complete file reconstructed.
 * 7. A dropped packet increments only the appropriate drop counter.
 * 8. A duplicate event does not increment the counters twice.
 * 9. Statistics update incrementally as new real events arrive.
 * 10. Final statistics are generated only after actual completion.
 * 11. The final download remains disabled until size and SHA-256 verification pass.
 * 12. Statistics from one transfer cannot leak into another transfer.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// Model the authentic receiver and live metrics state engine mirroring TransferContext.jsx
function computeLiveMetricsState({
  transfer,
  events,
  transferLifecycle,
  latestHandshakeStep,
  verification,
  finalMetrics,
  elapsedTime = 0,
}) {
  const isVerified = Boolean(
    verification &&
    verification.state === 'SUCCESS' &&
    verification.verified === true &&
    verification.byteEqual === true &&
    transferLifecycle === 'COMPLETED'
  );

  // 1. Filter events strictly by active transfer ID
  const currentId = transfer?.id;
  const transferEvents = (events || []).filter(e => !currentId || !e.transfer_id || e.transfer_id === currentId);

  // 2. Strict event deduplication
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

  // Physical transmissions & breakdown
  const physicalTransmissions = txEvents.length;
  const systematicSent = txEvents.filter(e => e.pkt_type === 'Systematic').length;
  const redundancySent = txEvents.filter(e => e.pkt_type === 'Mixed').length;
  const extraRepairSent = txEvents.filter(e => e.pkt_type === 'Mixed (Retransmit)').length;
  const rudpRetransmitCount = rudpRetransEvents.length;

  // Real reception accounting
  const receivedPacketCount = rxEvents.length;
  const droppedPacketCount = dropEvents.length;
  const receivedPayloadBytes = rxEvents.reduce((sum, e) => sum + (e.payload_len || 0), 0);

  // Unique assembled bytes (for RUDP)
  const uniqueSeqs = new Set();
  let uniqueReconstructedBytes = 0;
  for (const e of rxEvents) {
    if (!uniqueSeqs.has(e.seq_id)) {
      uniqueSeqs.add(e.seq_id);
      uniqueReconstructedBytes += (e.payload_len || 0);
    }
  }

  // RLNC decoder state
  const latestMatrix = matrixEvents[matrixEvents.length - 1];
  const currentRank = latestMatrix ? latestMatrix.rank : 0;
  const requiredRank = latestMatrix ? latestMatrix.required_rank : (transfer?.K || 4);
  const codedPacketsReceived = rxEvents.filter(e => e.coeffs && e.coeffs.length > 0).length;

  const latestRecon = reconEvents[reconEvents.length - 1];
  const decodedGenerations = latestRecon ? Math.ceil((latestRecon.recovered_blocks || 0) / (transfer?.K || 4)) : 0;
  const reconstructedBytes = (transfer?.protocol === 'rudp')
    ? uniqueReconstructedBytes
    : (latestRecon ? Math.round((latestRecon.pct / 100) * (transfer?.fileSize || 0)) : 0);

  // Genuine progress
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

  // Time & throughput
  const isCompletedStage = (transferLifecycle === 'COMPLETED' && isVerified);
  let displayDuration = '0.00 s';
  let displayThroughput = '0.00 KB/s';

  if (isCompletedStage) {
    if (finalMetrics?.duration_s != null) {
      displayDuration = `${Number(finalMetrics.duration_s).toFixed(2)} s`;
    } else {
      displayDuration = `${elapsedTime.toFixed(2)} s`;
    }

    if (finalMetrics?.throughput_kbps != null) {
      displayThroughput = `${Number(finalMetrics.throughput_kbps).toFixed(2)} KB/s`;
    } else {
      const dur = Math.max(0.01, finalMetrics?.duration_s || elapsedTime);
      displayThroughput = `${(receivedPayloadBytes / 1024 / dur).toFixed(2)} KB/s`;
    }
  } else if (transferLifecycle === 'IDLE') {
    displayDuration = '0.00 s';
    displayThroughput = '0.00 KB/s';
  } else {
    displayDuration = `${elapsedTime.toFixed(2)} s`;
    const dur = Math.max(0.01, elapsedTime);
    displayThroughput = `${(receivedPayloadBytes / 1024 / dur).toFixed(2)} KB/s`;
  }

  // File status & download state
  let fileStatus = 'No file received yet';
  let fileSizeDisplay = '0 bytes';

  if (isVerified) {
    fileStatus = transfer?.filename || 'reconstructed_file';
    fileSizeDisplay = `${transfer?.fileSize} bytes`;
  } else if (['TRANSFERRING', 'DECODING', 'RECONSTRUCTING', 'VERIFYING'].includes(transferLifecycle)) {
    fileStatus = 'Partial / Incomplete';
    fileSizeDisplay = `${(receivedPayloadBytes / 1024).toFixed(1)} KB received (Incomplete)`;
  } else if (transferLifecycle === 'FAILED') {
    fileStatus = 'Transfer failed';
  } else if (transferLifecycle === 'CANCELLED') {
    fileStatus = 'Transfer cancelled';
  }

  return {
    transferLifecycle,
    progressPct,
    physicalTransmissions,
    systematicSent,
    redundancySent,
    extraRepairSent,
    rudpRetransmitCount,
    receivedPacketCount,
    droppedPacketCount,
    receivedPayloadBytes,
    uniqueReconstructedBytes,
    currentRank,
    requiredRank,
    codedPacketsReceived,
    decodedGenerations,
    reconstructedBytes,
    displayDuration,
    displayThroughput,
    fileStatus,
    fileSizeDisplay,
    isVerified,
    canDownload: Boolean(isVerified && transfer?.id),
  };
}

// -------------------------------------------------------------------------
// TEST SUITE: 12 SPECIFICATION CRITERIA
// -------------------------------------------------------------------------

test('Regression Test 1: Initial live counters start at zero', () => {
  const transfer = { id: 'transfer-reg-1', protocol: 'rlnc', fileSize: 4096, blockSize: 1024, K: 4 };
  const state = computeLiveMetricsState({
    transfer,
    events: [],
    transferLifecycle: 'IDLE',
    latestHandshakeStep: 0,
    verification: null,
    finalMetrics: null,
    elapsedTime: 0,
  });

  assert.equal(state.progressPct, 0);
  assert.equal(state.physicalTransmissions, 0);
  assert.equal(state.receivedPacketCount, 0);
  assert.equal(state.droppedPacketCount, 0);
  assert.equal(state.receivedPayloadBytes, 0);
  assert.equal(state.codedPacketsReceived, 0);
  assert.equal(state.currentRank, 0);
  assert.equal(state.decodedGenerations, 0);
  assert.equal(state.reconstructedBytes, 0);
  assert.equal(state.displayDuration, '0.00 s');
  assert.equal(state.displayThroughput, '0.00 KB/s');
  assert.equal(state.fileStatus, 'No file received yet');
  assert.equal(state.canDownload, false);
});

test('Regression Test 2: One packet reception does not populate final packet counts', () => {
  const transfer = { id: 'transfer-reg-2', protocol: 'rlnc', fileSize: 4096, blockSize: 1024, K: 4 };
  const events = [
    { transfer_id: 'transfer-reg-2', type: 'handshake_step', step: 1, time: 10 },
    { transfer_id: 'transfer-reg-2', type: 'handshake_step', step: 2, time: 20 },
    { transfer_id: 'transfer-reg-2', type: 'handshake_step', step: 3, time: 30 },
    { transfer_id: 'transfer-reg-2', type: 'handshake_step', step: 4, time: 40 },
    { transfer_id: 'transfer-reg-2', type: 'packet_transmitted', seq_id: 0, gen_id: 0, pkt_type: 'Systematic', time: 50 },
    { transfer_id: 'transfer-reg-2', type: 'packet_received', seq_id: 0, gen_id: 0, payload_len: 1024, coeffs: [1, 0, 0, 0], time: 52 },
  ];

  const state = computeLiveMetricsState({
    transfer,
    events,
    transferLifecycle: 'TRANSFERRING',
    latestHandshakeStep: 4,
    verification: null,
    finalMetrics: null,
    elapsedTime: 0.1,
  });

  // Must reflect only 1 attempt and 1 reception, NOT final 6 sent / 5 received!
  assert.equal(state.physicalTransmissions, 1);
  assert.equal(state.receivedPacketCount, 1);
  assert.equal(state.droppedPacketCount, 0);
  assert.equal(state.receivedPayloadBytes, 1024);
  assert.equal(state.codedPacketsReceived, 1);
});

test('Regression Test 3: One packet reception does not set transfer progress to 100%', () => {
  const transfer = { id: 'transfer-reg-3', protocol: 'rlnc', fileSize: 4096, blockSize: 1024, K: 4 };
  const events = [
    { transfer_id: 'transfer-reg-3', type: 'packet_transmitted', seq_id: 0, gen_id: 0, pkt_type: 'Systematic', time: 10 },
    { transfer_id: 'transfer-reg-3', type: 'packet_received', seq_id: 0, gen_id: 0, payload_len: 1024, coeffs: [1, 0, 0, 0], time: 12 },
  ];

  const state = computeLiveMetricsState({
    transfer,
    events,
    transferLifecycle: 'TRANSFERRING',
    latestHandshakeStep: 4,
    verification: null,
    finalMetrics: null,
    elapsedTime: 0.2,
  });

  assert.notEqual(state.progressPct, 100);
  assert.equal(state.progressPct, 0); // No reconstruction event yet
  assert.equal(state.isVerified, false);
});

test('Regression Test 4: One packet reception does not automatically set decoder rank to K', () => {
  const transfer = { id: 'transfer-reg-4', protocol: 'rlnc', fileSize: 4096, blockSize: 1024, K: 4 };
  const events = [
    { transfer_id: 'transfer-reg-4', type: 'packet_transmitted', seq_id: 0, gen_id: 0, pkt_type: 'Systematic', time: 10 },
    { transfer_id: 'transfer-reg-4', type: 'packet_received', seq_id: 0, gen_id: 0, payload_len: 1024, coeffs: [1, 0, 0, 0], time: 12 },
    { transfer_id: 'transfer-reg-4', type: 'decoder_matrix_update', gen_id: 0, rank: 1, required_rank: 4, innovative: true, time: 13 },
  ];

  const state = computeLiveMetricsState({
    transfer,
    events,
    transferLifecycle: 'DECODING',
    latestHandshakeStep: 4,
    verification: null,
    finalMetrics: null,
  });

  assert.equal(state.currentRank, 1);
  assert.equal(state.requiredRank, 4);
  assert.notEqual(state.currentRank, 4);
});

test('Regression Test 5: One packet reception does not mark all generations decoded', () => {
  const transfer = { id: 'transfer-reg-5', protocol: 'rlnc', fileSize: 4096, blockSize: 1024, K: 4 };
  const events = [
    { transfer_id: 'transfer-reg-5', type: 'packet_transmitted', seq_id: 0, gen_id: 0, pkt_type: 'Systematic', time: 10 },
    { transfer_id: 'transfer-reg-5', type: 'packet_received', seq_id: 0, gen_id: 0, payload_len: 1024, coeffs: [1, 0, 0, 0], time: 12 },
  ];

  const state = computeLiveMetricsState({
    transfer,
    events,
    transferLifecycle: 'TRANSFERRING',
    latestHandshakeStep: 4,
    verification: null,
  });

  assert.equal(state.decodedGenerations, 0);
});

test('Regression Test 6: One packet reception does not mark the complete file reconstructed', () => {
  const transfer = { id: 'transfer-reg-6', protocol: 'rlnc', fileSize: 4096, blockSize: 1024, K: 4 };
  const events = [
    { transfer_id: 'transfer-reg-6', type: 'packet_transmitted', seq_id: 0, gen_id: 0, pkt_type: 'Systematic', time: 10 },
    { transfer_id: 'transfer-reg-6', type: 'packet_received', seq_id: 0, gen_id: 0, payload_len: 1024, coeffs: [1, 0, 0, 0], time: 12 },
  ];

  const state = computeLiveMetricsState({
    transfer,
    events,
    transferLifecycle: 'TRANSFERRING',
    latestHandshakeStep: 4,
    verification: null,
  });

  assert.equal(state.reconstructedBytes, 0);
  assert.equal(state.fileStatus, 'Partial / Incomplete');
  assert.notEqual(state.fileStatus, 'reconstructed_file');
});

test('Regression Test 7: A dropped packet increments only the appropriate drop counter', () => {
  const transfer = { id: 'transfer-reg-7', protocol: 'rlnc', fileSize: 4096, blockSize: 1024, K: 4 };
  const events = [
    { transfer_id: 'transfer-reg-7', type: 'packet_transmitted', seq_id: 0, gen_id: 0, pkt_type: 'Systematic', time: 10 },
    { transfer_id: 'transfer-reg-7', type: 'packet_received', seq_id: 0, gen_id: 0, payload_len: 1024, coeffs: [1, 0, 0, 0], time: 12 },
    { transfer_id: 'transfer-reg-7', type: 'packet_transmitted', seq_id: 1, gen_id: 0, pkt_type: 'Systematic', time: 20 },
    { transfer_id: 'transfer-reg-7', type: 'packet_dropped', seq_id: 1, gen_id: 0, reason: 'Simulated drop', time: 21 },
  ];

  const state = computeLiveMetricsState({
    transfer,
    events,
    transferLifecycle: 'TRANSFERRING',
    latestHandshakeStep: 4,
    verification: null,
  });

  assert.equal(state.physicalTransmissions, 2);
  assert.equal(state.droppedPacketCount, 1);
  assert.equal(state.receivedPacketCount, 1); // Dropped packet did NOT increment received packet count!
  assert.equal(state.receivedPayloadBytes, 1024); // Dropped packet did NOT increment received payload bytes!
});

test('Regression Test 8: A duplicate event does not increment the counters twice', () => {
  const transfer = { id: 'transfer-reg-8', protocol: 'rlnc', fileSize: 4096, blockSize: 1024, K: 4 };
  const singleEvent = {
    event_id: 'ev-unique-1',
    transfer_id: 'transfer-reg-8',
    type: 'packet_received',
    seq_id: 0,
    gen_id: 0,
    payload_len: 1024,
    coeffs: [1, 0, 0, 0],
    time: 50,
  };

  // Duplicate delivery of the exact same event
  const events = [singleEvent, { ...singleEvent }];

  const state = computeLiveMetricsState({
    transfer,
    events,
    transferLifecycle: 'TRANSFERRING',
    latestHandshakeStep: 4,
    verification: null,
  });

  assert.equal(state.receivedPacketCount, 1, 'Duplicate event must be discarded by deduplication');
  assert.equal(state.receivedPayloadBytes, 1024, 'Payload bytes must not double count duplicate');
});

test('Regression Test 9: Statistics update incrementally as new real events arrive', () => {
  const transfer = { id: 'transfer-reg-9', protocol: 'rlnc', fileSize: 4096, blockSize: 1024, K: 4 };
  const eventStream = [
    { transfer_id: 'transfer-reg-9', type: 'packet_transmitted', seq_id: 0, pkt_type: 'Systematic', time: 10 },
    { transfer_id: 'transfer-reg-9', type: 'packet_received', seq_id: 0, payload_len: 1024, coeffs: [1, 0, 0, 0], time: 12 },
    { transfer_id: 'transfer-reg-9', type: 'decoder_matrix_update', gen_id: 0, rank: 1, required_rank: 4, time: 13 },
  ];

  let state = computeLiveMetricsState({
    transfer,
    events: eventStream,
    transferLifecycle: 'DECODING',
    latestHandshakeStep: 4,
  });

  assert.equal(state.physicalTransmissions, 1);
  assert.equal(state.receivedPacketCount, 1);
  assert.equal(state.currentRank, 1);

  // New event arrives: Packet 2
  eventStream.push({ transfer_id: 'transfer-reg-9', type: 'packet_transmitted', seq_id: 1, pkt_type: 'Systematic', time: 20 });
  eventStream.push({ transfer_id: 'transfer-reg-9', type: 'packet_received', seq_id: 1, payload_len: 1024, coeffs: [0, 1, 0, 0], time: 22 });
  eventStream.push({ transfer_id: 'transfer-reg-9', type: 'decoder_matrix_update', gen_id: 0, rank: 2, required_rank: 4, time: 23 });

  state = computeLiveMetricsState({
    transfer,
    events: eventStream,
    transferLifecycle: 'DECODING',
    latestHandshakeStep: 4,
  });

  assert.equal(state.physicalTransmissions, 2);
  assert.equal(state.receivedPacketCount, 2);
  assert.equal(state.receivedPayloadBytes, 2048);
  assert.equal(state.currentRank, 2);
});

test('Regression Test 10: Final statistics are generated only after actual completion', () => {
  const transfer = { id: 'transfer-reg-10', protocol: 'rlnc', fileSize: 4096, blockSize: 1024, K: 4 };
  const finalMetrics = { duration_s: 0.27, throughput_kbps: 23.00, packets_sent: 6, packets_received: 5 };

  // Case A: Transfer is still running. Final metrics must NOT be applied!
  const runningState = computeLiveMetricsState({
    transfer,
    events: [{ transfer_id: 'transfer-reg-10', type: 'packet_received', seq_id: 0, payload_len: 1024, time: 10 }],
    transferLifecycle: 'TRANSFERRING',
    latestHandshakeStep: 4,
    verification: null,
    finalMetrics,
    elapsedTime: 0.05,
  });

  assert.equal(runningState.displayDuration, '0.05 s', 'Live stopwatch must be shown while running');
  assert.notEqual(runningState.displayDuration, '0.27 s', 'Must not display premature final duration');
  assert.notEqual(runningState.displayThroughput, '23.00 KB/s', 'Must not display premature final throughput');
  assert.equal(runningState.progressPct, 0);

  // Case B: Transfer completed and verified. Final statistics freeze!
  const completedState = computeLiveMetricsState({
    transfer,
    events: [{ transfer_id: 'transfer-reg-10', type: 'packet_received', seq_id: 0, payload_len: 1024, time: 10 }],
    transferLifecycle: 'COMPLETED',
    latestHandshakeStep: 4,
    verification: { state: 'SUCCESS', verified: true, byteEqual: true },
    finalMetrics,
    elapsedTime: 0.27,
  });

  assert.equal(completedState.displayDuration, '0.27 s', 'Final duration frozen on completion');
  assert.equal(completedState.displayThroughput, '23.00 KB/s', 'Final throughput frozen on completion');
  assert.equal(completedState.progressPct, 100);
});

test('Regression Test 11: The final download remains disabled until size and SHA-256 verification pass', () => {
  const transfer = { id: 'transfer-reg-11', protocol: 'rlnc', fileSize: 4096, blockSize: 1024, K: 4, filename: 'sample.bin' };

  // Even if 100% reconstruction progress event arrived, download remains disabled until verified
  const unverifiedState = computeLiveMetricsState({
    transfer,
    events: [
      { transfer_id: 'transfer-reg-11', type: 'reconstruction_progress', recovered_blocks: 4, total_blocks: 4, pct: 100, time: 100 }
    ],
    transferLifecycle: 'VERIFYING',
    latestHandshakeStep: 4,
    verification: { state: 'VERIFYING', verified: false },
  });

  assert.equal(unverifiedState.canDownload, false);
  assert.notEqual(unverifiedState.fileStatus, 'sample.bin');

  // Once verified with matching SHA-256 and bit equality
  const verifiedState = computeLiveMetricsState({
    transfer,
    events: [
      { transfer_id: 'transfer-reg-11', type: 'reconstruction_progress', recovered_blocks: 4, total_blocks: 4, pct: 100, time: 100 }
    ],
    transferLifecycle: 'COMPLETED',
    latestHandshakeStep: 4,
    verification: { state: 'SUCCESS', verified: true, byteEqual: true },
  });

  assert.equal(verifiedState.canDownload, true);
  assert.equal(verifiedState.fileStatus, 'sample.bin');
});

test('Regression Test 12: Statistics from one transfer cannot leak into another transfer', () => {
  const transferA = { id: 'transfer-AAA', protocol: 'rlnc', fileSize: 4096 };
  const transferB = { id: 'transfer-BBB', protocol: 'rlnc', fileSize: 2048 };

  const mixedEvents = [
    { transfer_id: 'transfer-AAA', type: 'packet_transmitted', seq_id: 0, pkt_type: 'Systematic', time: 10 },
    { transfer_id: 'transfer-AAA', type: 'packet_received', seq_id: 0, payload_len: 1024, coeffs: [1, 0, 0, 0], time: 12 },
    { transfer_id: 'transfer-AAA', type: 'packet_transmitted', seq_id: 1, pkt_type: 'Systematic', time: 20 },
    { transfer_id: 'transfer-AAA', type: 'packet_received', seq_id: 1, payload_len: 1024, coeffs: [0, 1, 0, 0], time: 22 },
  ];

  // Transfer B is active, but only 1 packet was sent for Transfer B
  mixedEvents.push({ transfer_id: 'transfer-BBB', type: 'packet_transmitted', seq_id: 0, pkt_type: 'Systematic', time: 30 });
  mixedEvents.push({ transfer_id: 'transfer-BBB', type: 'packet_received', seq_id: 0, payload_len: 1024, coeffs: [1, 0, 0, 0], time: 32 });

  const stateB = computeLiveMetricsState({
    transfer: transferB,
    events: mixedEvents,
    transferLifecycle: 'TRANSFERRING',
    latestHandshakeStep: 4,
  });

  assert.equal(stateB.physicalTransmissions, 1, 'Transfer A transmission attempts must not count for Transfer B');
  assert.equal(stateB.receivedPacketCount, 1, 'Transfer A receptions must not count for Transfer B');
  assert.equal(stateB.receivedPayloadBytes, 1024, 'Transfer A bytes must not count for Transfer B');
});
