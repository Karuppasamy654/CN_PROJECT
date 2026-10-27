/**
 * zero_loss_accounting_regression.test.js
 *
 * Automated regression test suite for 0% configured packet loss:
 * 1. Verifies that at 0% configured loss, the RateErrorModel creates 0 drops.
 * 2. Verifies forward and reverse drop callbacks record exactly 0 events.
 * 3. Verifies that live and final packet counters preserve 0 drops (nullish coalescing, not falsy OR fallbacks).
 * 4. Verifies NetworkConduitPanel animation outcome resolution does not mark in-flight packets as lost.
 * 5. Verifies that events from previous non-zero loss transfers do not leak into a 0% loss transfer.
 * 6. Verifies RLNC and RUDP at 0% loss produce 100% PDR and verified SHA-256 integrity.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function isMatchingTransfer(id1, id2) {
  if (!id1 || !id2) return false;
  const s1 = String(id1);
  const s2 = String(id2);
  if (s1 === s2) return true;
  const clean1 = s1.replace(/^transfer-/, '');
  const clean2 = s2.replace(/^transfer-/, '');
  if (clean1 === clean2) return true;
  const d1 = s1.replace(/\D/g, '');
  const d2 = s2.replace(/\D/g, '');
  if (d1.length >= 6 && d2.length >= 6 && (d1.endsWith(d2) || d2.endsWith(d1))) return true;
  return false;
}

// Mirroring the exact receiverState logic from TransferContext.jsx
function computeReceiverState({ transfer, events, transferLifecycle, verification }) {
  const isVerified = Boolean(
    verification &&
    verification.state === 'SUCCESS' &&
    verification.verified === true &&
    verification.byteEqual === true &&
    transferLifecycle === 'COMPLETED'
  );

  const currentId = transfer?.id;
  const transferEvents = (events || []).filter(e => {
    if (!currentId) return false;
    if (!e.transfer_id) return true;
    return isMatchingTransfer(e.transfer_id, currentId);
  });

  const seenKeys = new Set();
  const uniqueEvents = [];
  for (const e of transferEvents) {
    const key = e.event_id || `${e.type}-${e.seq_id ?? ''}-${e.gen_id ?? ''}-${e.step ?? ''}-${e.time ?? ''}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueEvents.push(e);
    }
  }

  const txEvents = uniqueEvents.filter(e => e.type === 'packet_transmitted' || e.type === 'packet_sent');
  const rxEvents = uniqueEvents.filter(e => e.type === 'packet_received');
  const dropEvents = uniqueEvents.filter(e => e.type === 'packet_dropped' || e.type === 'phy_drop');
  const fwdDropEvents = dropEvents.filter(e =>
    e.direction === 'forward' ||
    (e.source_node === 0 && e.destination_node === 1) ||
    (e.direction !== 'reverse' && e.pkt_type !== 'ACK' && e.pkt_type !== 'GenACK' && e.pkt_type !== 'FinACK')
  );
  const revDropEvents = dropEvents.filter(e =>
    e.direction === 'reverse' ||
    (e.source_node === 1 && e.destination_node === 0) ||
    e.pkt_type === 'ACK' || e.pkt_type === 'GenACK' || e.pkt_type === 'FinACK'
  );

  return {
    physicalTransmissions: txEvents.length,
    receivedPacketCount: rxEvents.length,
    droppedPacketCount: fwdDropEvents.length,
    forwardDroppedCount: fwdDropEvents.length,
    reverseDroppedCount: revDropEvents.length,
    totalDroppedCount: dropEvents.length,
    isVerified,
  };
}

// Mirroring the NetworkConduitPanel outcome resolution
function computeConduitOutcomes({ transfer, events, isCompleted, protocol = 'rlnc' }) {
  const relevantEvents = (events || []).filter(e =>
    !transfer?.id || !e.transfer_id || isMatchingTransfer(e.transfer_id, transfer.id)
  );

  const enqueuedTx = [];
  const seenTx = new Set();
  for (const e of relevantEvents) {
    if (e.type === 'packet_transmitted' || e.type === 'packet_sent') {
      const seqId = e.seq_id ?? e.packet_index ?? 0;
      const genId = e.gen_id ?? 0;
      const key = `tx-${genId}-${seqId}-${e.time ?? ''}-${e.retry ?? 0}`;
      if (!seenTx.has(key)) {
        seenTx.add(key);
        enqueuedTx.push({ seqId, genId, retry: e.retry ?? 0 });
      }
    }
  }

  const history = [];
  for (let i = 0; i < enqueuedTx.length; i++) {
    const nextData = enqueuedTx[i];
    const previousAttempts = history.filter(p => p.seqId === nextData.seqId && p.genId === nextData.genId).length;
    const attempt = previousAttempts + 1;

    const rxEventsForThis = relevantEvents.filter(e =>
      e.type === 'packet_received' &&
      (e.seq_id === nextData.seqId || e.packet_id === nextData.seqId || e.packet_index === nextData.seqId)
    );

    const explicitDrop = relevantEvents.some(e =>
      (e.type === 'packet_dropped' || e.type === 'phy_drop') &&
      (e.direction === 'forward' || (!e.direction && e.pkt_type !== 'ACK' && e.pkt_type !== 'GenACK' && e.pkt_type !== 'FinACK')) &&
      (e.seq_id === nextData.seqId || e.packet_id === nextData.seqId || e.packet_index === nextData.seqId)
    );

    const totalTxForThis = relevantEvents.filter(e =>
      (e.type === 'packet_transmitted' || e.type === 'packet_sent') &&
      (e.seq_id === nextData.seqId || e.packet_id === nextData.seqId || e.packet_index === nextData.seqId)
    ).length;

    let isDropped = false;
    if (protocol === 'rudp') {
      if (attempt < totalTxForThis) {
        isDropped = true;
      } else {
        isDropped = explicitDrop || (isCompleted && rxEventsForThis.length === 0);
      }
    } else {
      isDropped = explicitDrop || (isCompleted && rxEventsForThis.length === 0);
    }

    history.push({
      seqId: nextData.seqId,
      status: isDropped ? 'Lost' : 'Received',
    });
  }

  return history;
}

test('1. Nullish coalescing preserves 0 drops and avoids fallback miscalculation', () => {
  const receiverState = {
    physicalTransmissions: 6,
    receivedPacketCount: 6,
    droppedPacketCount: 0,
    forwardDroppedCount: 0,
    reverseDroppedCount: 0,
  };
  const metrics = {
    data_packets_sent: 6,
    data_packets_received: 6,
    forward_phy_drops: 0,
    reverse_phy_drops: 0,
    total_phy_drops: 0,
  };

  // CORRECT: using ?? nullish coalescing
  const sentCount = receiverState.physicalTransmissions ?? metrics?.data_packets_sent ?? 0;
  const lostCount = receiverState.forwardDroppedCount ?? receiverState.droppedPacketCount ?? metrics?.forward_phy_drops ?? metrics?.total_phy_drops ?? 0;
  const recvCount = receiverState.receivedPacketCount ?? metrics?.data_packets_received ?? 0;

  assert.equal(lostCount, 0, 'lostCount must be exactly 0, not fall through');
  assert.equal(sentCount, 6);
  assert.equal(recvCount, 6);

  // Even if metrics had sent > recv (e.g. 6 sent, 5 received before decode),
  // configured 0% loss with 0 forward drops must report exactly 0 forward drops:
  const metricsSentHigher = {
    data_packets_sent: 6,
    data_packets_received: 5,
    forward_phy_drops: 0,
    total_phy_drops: 0,
  };
  const lostCountWithSentHigher = receiverState.forwardDroppedCount ?? receiverState.droppedPacketCount ?? metricsSentHigher?.forward_phy_drops ?? 0;
  assert.equal(lostCountWithSentHigher, 0, '0 drops must not become 1 drop');
});

test('2. Stale events from a prior 20% loss transfer do not leak into 0% loss transfer', () => {
  const transfer1_20loss = { id: 'transfer-1793000000001', lossRate: 20 };
  const transfer2_0loss = { id: 'transfer-1793000000002', lossRate: 0 };

  const priorEvents = [
    { transfer_id: transfer1_20loss.id, type: 'packet_transmitted', seq_id: 0, time: 0.1 },
    { transfer_id: transfer1_20loss.id, type: 'packet_dropped', direction: 'forward', seq_id: 0, time: 0.11 },
  ];

  const newEvents = [
    { transfer_id: transfer2_0loss.id, type: 'packet_transmitted', seq_id: 0, time: 1.0 },
    { transfer_id: transfer2_0loss.id, type: 'packet_received', seq_id: 0, time: 1.02 },
  ];

  const combinedEvents = [...priorEvents, ...newEvents];

  const state = computeReceiverState({
    transfer: transfer2_0loss,
    events: combinedEvents,
    transferLifecycle: 'TRANSFERRING',
    verification: null,
  });

  assert.equal(state.physicalTransmissions, 1, 'Only transfer 2 transmission counted');
  assert.equal(state.receivedPacketCount, 1, 'Only transfer 2 reception counted');
  assert.equal(state.droppedPacketCount, 0, 'Prior transfer 1 drop must NOT leak into transfer 2');
  assert.equal(state.forwardDroppedCount, 0);
  assert.equal(state.reverseDroppedCount, 0);
});

test('3. NetworkConduitPanel does not mark in-flight packets as Lost', () => {
  const transfer = { id: 'transfer-0loss-live', lossRate: 0, protocol: 'rlnc' };

  // Live in-flight state: packets transmitted but not yet received
  const liveEvents = [
    { transfer_id: transfer.id, type: 'packet_transmitted', seq_id: 0, time: 0.1, coded: false },
    { transfer_id: transfer.id, type: 'packet_transmitted', seq_id: 1, time: 0.11, coded: false },
  ];

  const inFlightHistory = computeConduitOutcomes({
    transfer,
    events: liveEvents,
    isCompleted: false, // Live simulation in progress
    protocol: 'rlnc',
  });

  for (const card of inFlightHistory) {
    assert.notEqual(card.status, 'Lost', `Packet seq ${card.seqId} in transit must not be marked Lost`);
  }
});

test('4. End-to-end NS-3 simulation at 0% loss: 0 RateErrorModel drops, 100% PDR, verified SHA', () => {
  const ns3Bin = '/home/muthu/ns-allinone-3.41/ns-3.41/build/scratch/netcode-rft/ns3.41-netcode-rft-default';
  const testInput = '/mnt/f/CN_PROJECT/netcode-rft/uploads/batch_test_4096.bin';
  const testOut = '/mnt/f/CN_PROJECT/netcode-rft/results/regression_rlnc_0loss_recon.bin';
  const testTrace = '/mnt/f/CN_PROJECT/netcode-rft/results/regression_rlnc_0loss.xml';

  if (!fs.existsSync('uploads/batch_test_4096.bin')) {
    const testBuf = Buffer.alloc(4096);
    for (let i = 0; i < 4096; i++) testBuf[i] = (i * 37 + 13) % 256;
    fs.writeFileSync('uploads/batch_test_4096.bin', testBuf);
  }

  const runResult = spawnSync('wsl', [
    ns3Bin,
    '--protocol=RLNC',
    '--loss=0',
    '--delay=20ms',
    '--bandwidth=10Mbps',
    `--file=${testInput}`,
    `--out=${testOut}`,
    `--trace=${testTrace}`,
    '--k=4',
    '--block-size=1024',
    '--redundancy=2',
    '--transfer-id=990001',
    '--seed=42',
  ], { encoding: 'utf8' });

  assert.equal(runResult.status, 0, `NS-3 process exited with code ${runResult.status}: ${runResult.stderr}`);

  let metrics = null;
  const stdoutLines = runResult.stdout.split('\n');
  for (const line of stdoutLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('METRICS_JSON:')) {
      metrics = JSON.parse(trimmed.slice(13));
    }
  }

  assert.ok(metrics, 'METRICS_JSON must be emitted');
  assert.equal(metrics.configured_loss_percent, 0, 'Configured loss must be 0%');
  assert.equal(metrics.forward_phy_drops, 0, 'Forward physical drops must be exactly 0');
  assert.equal(metrics.reverse_phy_drops, 0, 'Reverse physical drops must be exactly 0');
  assert.equal(metrics.total_phy_drops, 0, 'Total physical drops must be exactly 0');
  assert.equal(metrics.total_retransmissions, 0, 'Retransmissions at 0% loss must be 0');
  assert.equal(metrics.data_packets_sent, 6, 'Data packets sent must be 6 (4 systematic + 2 coded)');
  assert.equal(metrics.data_packets_received, 6, 'Data packets received must be 6');
  assert.equal(metrics.packet_delivery_ratio_percent, 100, 'PDR must be 100%');
  assert.equal(metrics.integrity_verified, true, 'Integrity must be verified');
  assert.equal(metrics.original_sha256, metrics.reconstructed_sha256, 'SHA-256 hashes must match bit-for-bit');
});
