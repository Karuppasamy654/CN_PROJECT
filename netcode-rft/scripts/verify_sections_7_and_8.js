const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { io } = require('../ui/node_modules/socket.io-client');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testTransfer({ protocol, lossRate, seed, blockSize = 1024, K = 4, redundancy = 2, testFileBuffer, filename }) {
  console.log(`\n================================================================`);
  console.log(`  STARTING COMPLETE END-TO-END TRANSFER: ${protocol.toUpperCase()}`);
  console.log(`  Loss: ${lossRate * 100}% | Seed: ${seed} | FileSize: ${testFileBuffer.length} bytes`);
  console.log(`================================================================`);

  const originalSha256 = crypto.createHash('sha256').update(testFileBuffer).digest('hex');
  console.log(`[ORIGINAL] Size: ${testFileBuffer.length} bytes | SHA-256: ${originalSha256}`);

  // 1. Upload file
  const formData = new FormData();
  const blob = new Blob([testFileBuffer], { type: 'application/octet-stream' });
  formData.append('file', blob, filename);
  formData.append('protocol', protocol);
  formData.append('lossRate', String(lossRate * 100));
  formData.append('seed', String(seed));
  formData.append('blockSize', String(blockSize));
  formData.append('K', String(K));
  formData.append('redundancy', String(redundancy));

  const uploadRes = await fetch('http://localhost:5000/api/transfers', {
    method: 'POST',
    body: formData,
  });

  if (!uploadRes.ok) {
    throw new Error(`Upload failed with status ${uploadRes.status}: ${await uploadRes.text()}`);
  }

  const transfer = await uploadRes.json();
  const transferId = transfer.id;
  console.log(`[UPLOAD] Created transfer ID: ${transferId}`);

  // 2. Connect Socket.IO
  const socket = io('http://localhost:5000', {
    transports: ['websocket', 'polling'],
  });

  const capturedEvents = [];
  const rankProgression = [];
  let verificationEvent = null;
  let metricsEvent = null;
  let completedEvent = null;

  await new Promise((resolve, reject) => {
    socket.on('connect', () => {
      console.log(`[SOCKET.IO] Connected to telemetry server (id: ${socket.id})`);
      socket.emit('join_transfer', transferId);
      resolve();
    });
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('Socket.IO connection timeout')), 5000);
  });

  socket.on('transfer_event', (ev) => {
    capturedEvents.push(ev);
    if (ev.type === 'decoder_matrix_update') {
      rankProgression.push({ time: ev.time, rank: ev.rank, required: ev.required_rank, innovative: ev.innovative });
    }
  });

  socket.on('metrics', (m) => {
    metricsEvent = m;
  });

  socket.on('status', (s) => {
    if (s.status === 'completed' || s.status === 'failed') {
      completedEvent = s;
    }
  });

  // 3. Start transfer
  console.log(`[START] Triggering transfer execution...`);
  const startRes = await fetch(`http://localhost:5000/api/transfers/${transferId}/start`, {
    method: 'POST',
  });
  if (!startRes.ok) {
    throw new Error(`Start failed with status ${startRes.status}: ${await startRes.text()}`);
  }

  // 4. Wait for completion
  const startTime = Date.now();
  let finished = false;
  while (Date.now() - startTime < 30000) {
    await sleep(250);
    const statusRes = await fetch(`http://localhost:5000/api/transfers/${transferId}/verification`);
    if (statusRes.ok) {
      const v = await statusRes.json();
      if (v.state === 'SUCCESS' || v.state === 'FAILED') {
        finished = true;
        break;
      }
    }
  }

  socket.disconnect();

  if (!finished) {
    throw new Error(`Transfer ${transferId} timed out after 30 seconds!`);
  }

  // 5. Download reconstructed file
  const downloadRes = await fetch(`http://localhost:5000/api/transfers/${transferId}/download`);
  if (!downloadRes.ok) {
    throw new Error(`Download failed with status ${downloadRes.status}`);
  }
  const downloadedBuffer = Buffer.from(await downloadRes.arrayBuffer());
  const reconstructedSha256 = crypto.createHash('sha256').update(downloadedBuffer).digest('hex');

  // 6. Verification
  const byteEqual = testFileBuffer.equals(downloadedBuffer);
  const hashMatch = originalSha256 === reconstructedSha256;

  console.log(`\n--- TELEMETRY & PROTOCOL ANALYSIS ---`);
  console.log(`Total Socket.IO events captured: ${capturedEvents.length}`);
  const sentPkts = capturedEvents.filter(e => e.type === 'packet_transmitted');
  const recvPkts = capturedEvents.filter(e => e.type === 'packet_received');
  const dropPkts = capturedEvents.filter(e => e.type === 'packet_dropped');
  console.log(`  Packets Transmitted: ${sentPkts.length}`);
  console.log(`  Packets Received:    ${recvPkts.length}`);
  console.log(`  Packets Dropped:     ${dropPkts.length}`);

  if (protocol === 'rlnc') {
    const systematic = sentPkts.filter(e => e.pkt_type === 'Systematic');
    const coded = sentPkts.filter(e => e.pkt_type === 'Mixed');
    console.log(`  Systematic Packets:  ${systematic.length}`);
    console.log(`  Coded Repair Packets: ${coded.length}`);
    console.log(`  Rank Progression entries: ${rankProgression.length}`);
    if (rankProgression.length > 0) {
      const maxRank = Math.max(...rankProgression.map(r => r.rank));
      console.log(`  Max Decoder Rank achieved: ${maxRank} / ${rankProgression[0].required}`);
    }
  } else if (protocol === 'rudp') {
    const acks = capturedEvents.filter(e => e.type === 'rudp_ack');
    const retrans = capturedEvents.filter(e => e.type === 'rudp_retransmit');
    const timeouts = capturedEvents.filter(e => e.type === 'rudp_timeout');
    console.log(`  Validated ACKs:     ${acks.length}`);
    console.log(`  Retransmissions:    ${retrans.length}`);
    console.log(`  Timeouts detected:  ${timeouts.length}`);
  }

  console.log(`\n--- FILE INTEGRITY VERIFICATION ---`);
  console.log(`Source File:       ${testFileBuffer.length} bytes | SHA-256: ${originalSha256}`);
  console.log(`Reconstructed:     ${downloadedBuffer.length} bytes | SHA-256: ${reconstructedSha256}`);
  console.log(`Byte-for-byte cmp: ${byteEqual ? 'BIT-EXACT EQUAL' : 'MISMATCH'}`);
  console.log(`Cryptographic SHA: ${hashMatch ? 'IDENTICAL' : 'MISMATCH'}`);

  if (!byteEqual || !hashMatch) {
    throw new Error(`Integrity verification FAILED for ${protocol}!`);
  }

  console.log(`[RESULT] ${protocol.toUpperCase()} TRANSFER VERIFICATION: PASSED (100% Integrity)\n`);
  return {
    transferId,
    byteEqual,
    hashMatch,
    capturedEventsCount: capturedEvents.length,
    sentCount: sentPkts.length,
    dropCount: dropPkts.length,
    metrics: metricsEvent,
  };
}

async function run() {
  console.log(`================================================================`);
  console.log(`   NETCODE-RFT: SECTIONS 7 & 8 END-TO-END VERIFICATION SCRIPT   `);
  console.log(`================================================================`);

  // Generate real deterministic binary test file (4096 bytes)
  const testFileSize = 4096;
  const testBuffer = Buffer.alloc(testFileSize);
  for (let i = 0; i < testFileSize; i++) {
    testBuffer[i] = (i * 31 + 17) & 0xff;
  }

  // Section 7: RLNC Transfer (20% loss, seed 42)
  const rlncResult = await testTransfer({
    protocol: 'rlnc',
    lossRate: 0.20,
    seed: 42,
    blockSize: 1024,
    K: 4,
    redundancy: 3,
    testFileBuffer: testBuffer,
    filename: 'test_sec7_rlnc.bin',
  });

  // Section 8: RUDP Transfer (20% loss, seed 42)
  const rudpResult = await testTransfer({
    protocol: 'rudp',
    lossRate: 0.20,
    seed: 42,
    blockSize: 1024,
    K: 4,
    redundancy: 2,
    testFileBuffer: testBuffer,
    filename: 'test_sec8_rudp.bin',
  });

  console.log(`================================================================`);
  console.log(` ALL SECTIONS 7 & 8 REQUIREMENTS VERIFIED WITH REAL TELEMETRY!  `);
  console.log(` RLNC: Byte-exact (${rlncResult.sentCount} sent, ${rlncResult.dropCount} dropped) -> PASSED`);
  console.log(` RUDP: Byte-exact (${rudpResult.sentCount} sent, ${rudpResult.dropCount} dropped) -> PASSED`);
  console.log(`================================================================`);
}

run().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
