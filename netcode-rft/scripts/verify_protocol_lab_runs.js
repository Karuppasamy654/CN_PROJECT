const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE_URL = 'http://localhost:5000';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runRudpTest({ name, content, blockSize, lossRate }) {
  console.log(`\n======================================================================`);
  console.log(` RUNNING: ${name}`);
  console.log(` File Size: ${content.length} B | Block Size: ${blockSize} B | Loss Rate: ${lossRate}%`);
  console.log(`======================================================================`);

  const origSha = crypto.createHash('sha256').update(content).digest('hex');
  const filename = `test_rudp_${Date.now()}_${content.length}b.bin`;

  // 1. Upload transfer
  const formData = new FormData();
  const blob = new Blob([content], { type: 'application/octet-stream' });
  formData.append('file', blob, filename);
  formData.append('protocol', 'rudp');
  formData.append('blockSize', String(blockSize));
  formData.append('lossRate', String(lossRate));
  formData.append('delayMs', '0');

  const createRes = await fetch(`${BASE_URL}/api/transfers`, {
    method: 'POST',
    body: formData,
  });
  if (!createRes.ok) {
    throw new Error(`Upload failed (${createRes.status}): ${await createRes.text()}`);
  }
  const transfer = await createRes.json();
  const transferId = transfer.id;
  console.log(`[1] Created Transfer ID: ${transferId}`);
  console.log(`    Original SHA-256: ${origSha}`);

  // 2. Start transfer
  const startRes = await fetch(`${BASE_URL}/api/transfers/${transferId}/start`, { method: 'POST' });
  if (!startRes.ok) {
    throw new Error(`Start failed (${startRes.status}): ${await startRes.text()}`);
  }
  console.log(`[2] Real UDP transfer initiated via C engine`);

  // 3. Poll verification
  let verify = null;
  for (let i = 0; i < 150; i++) {
    await sleep(250);
    const vRes = await fetch(`${BASE_URL}/api/transfers/${transferId}/verification`);
    verify = await vRes.json();
    if (verify.state === 'SUCCESS' || verify.state === 'FAILED') break;
  }
  console.log(`[3] Verification Result: State = ${verify.state}`);
  console.log(`    - Verified Flag: ${verify.verified}`);
  console.log(`    - Message: ${verify.message}`);
  console.log(`    - Original Size: ${verify.origSize} B, Reconstructed Size: ${verify.reconSize} B`);
  console.log(`    - Original Hash:      ${verify.origSha}`);
  console.log(`    - Reconstructed Hash: ${verify.reconSha}`);

  if (verify.state !== 'SUCCESS') {
    throw new Error(`Transfer failed verification! Reason: ${verify.message}`);
  }
  if (verify.origSha !== origSha || verify.reconSha !== origSha) {
    throw new Error(`SHA-256 mismatch! Orig: ${verify.origSha}, Recon: ${verify.reconSha}`);
  }
  if (verify.reconSize !== content.length) {
    throw new Error(`Size mismatch! Expected ${content.length}, got ${verify.reconSize}`);
  }

  // 4. Fetch raw events
  const evRes = await fetch(`${BASE_URL}/api/transfers/${transferId}/events`);
  const evData = await evRes.json();
  const rawEvents = evData.events || [];

  // 5. Fetch calculation / protocol lab data
  const calcRes = await fetch(`${BASE_URL}/api/calculations/transfer/${transferId}`);
  if (!calcRes.ok) {
    throw new Error(`Calculations endpoint failed: ${calcRes.status}`);
  }
  const calcData = await calcRes.json();
  const rudp = calcData.rudpData;
  const metrics = rudp.protocolMetrics;

  console.log(`[4] Protocol Lab Metrics (Calculations Endpoint):`);
  console.log(`    - Original Source Blocks:      ${metrics.originalBlocks}`);
  console.log(`    - Data Transmission Attempts:  ${metrics.transmissionAttempts}`);
  console.log(`    - Unique Data Packets Rx:      ${metrics.uniquePacketsReceived}`);
  console.log(`    - Dropped Data Packets:        ${metrics.droppedPackets}`);
  console.log(`    - Retransmissions:             ${metrics.retransmissions}`);
  console.log(`    - ACKs Sent by Receiver:       ${metrics.acksSent}`);
  console.log(`    - ACKs Received by Sender:     ${metrics.acksReceived}`);
  console.log(`    - Verified Output Bytes:       ${metrics.verifiedOutputBytes} B`);

  console.log(`[5] Event Pipeline Summary:`);
  console.log(`    - Raw events captured:         ${rawEvents.length}`);
  console.log(`    - Transmitted packets parsed:  ${calcData.transmittedPackets.length}`);
  console.log(`    - ACKs parsed:                 ${rudp.acks.length}`);
  console.log(`    - ACKs Sent parsed:            ${rudp.acksSent.length}`);
  console.log(`    - Timeouts parsed:             ${rudp.timeouts.length}`);
  console.log(`    - Retransmits parsed:          ${rudp.retransmits.length}`);
  console.log(`    - Drops parsed:                ${rudp.drops.length}`);

  // Sample packet transmission attempt display
  if (calcData.transmittedPackets.length > 0) {
    console.log(`    - Sample Transmissions:`);
    calcData.transmittedPackets.slice(0, 5).forEach((pkt, i) => {
      console.log(`      [Tx ${i+1}] PKT #${pkt.seqId + 1} | Attempt ${pkt.attempt} | ${pkt.payloadLen} B | t=${pkt.time.toFixed(1)}ms | Dropped: ${pkt.isDropped}`);
    });
  }

  // Sample ACKs display
  if (rudp.acks.length > 0) {
    console.log(`    - Sample ACKs:`);
    rudp.acks.slice(0, 5).forEach((ack, i) => {
      console.log(`      [ACK ${i+1}] ACK #${ack.ackSeq + 1} | for Attempt ${ack.attempt} | RTT: ${ack.rttMs !== null ? ack.rttMs.toFixed(2) + 'ms' : 'N/A'} | t=${ack.time.toFixed(1)}ms`);
    });
  }

  // Sample Timeouts
  if (rudp.timeouts.length > 0) {
    console.log(`    - Sample Timeouts:`);
    rudp.timeouts.slice(0, 5).forEach((to, i) => {
      console.log(`      [Timeout ${i+1}] PKT #${to.seqId + 1} | Attempt ${to.attempt} | Timeout > ${to.timeoutMs}ms | t=${to.time.toFixed(1)}ms`);
    });
  }

  return {
    transferId,
    origSize: content.length,
    reconSize: verify.reconSize,
    origSha,
    reconSha: verify.reconSha,
    metrics,
    rudp,
    rawEventsCount: rawEvents.length
  };
}

async function main() {
  console.log(`======================================================================`);
  console.log(`NETCODE-RFT: RELIABLE UDP PROTOCOL LAB E2E VERIFICATION`);
  console.log(`======================================================================`);

  const results = {};

  // Test 1: Zero-byte file (0 B, 1024 B block)
  console.log('\n>>> TEST 1: ZERO-BYTE FILE <<<');
  results.test1 = await runRudpTest({
    name: '1. Zero-byte File Transfer',
    content: Buffer.alloc(0),
    blockSize: 1024,
    lossRate: 0
  });

  // Verify constraints for Test 1
  if (results.test1.metrics.originalBlocks !== 0) throw new Error('Test 1 failed: originalBlocks must be 0');
  if (results.test1.metrics.transmissionAttempts !== 0) throw new Error('Test 1 failed: transmissionAttempts must be 0');
  if (results.test1.metrics.verifiedOutputBytes !== 0) throw new Error('Test 1 failed: verifiedOutputBytes must be 0');

  // Test 2: One-byte file (1 B, 1024 B block)
  console.log('\n>>> TEST 2: ONE-BYTE FILE <<<');
  results.test2 = await runRudpTest({
    name: '2. One-byte File Transfer',
    content: Buffer.from([0x42]),
    blockSize: 1024,
    lossRate: 0
  });

  // Verify constraints for Test 2
  if (results.test2.metrics.originalBlocks !== 1) throw new Error('Test 2 failed: originalBlocks must be 1');
  if (results.test2.metrics.transmissionAttempts !== 1) throw new Error('Test 2 failed: transmissionAttempts must be 1');
  if (results.test2.metrics.uniquePacketsReceived !== 1) throw new Error('Test 2 failed: uniquePacketsReceived must be 1');
  if (results.test2.metrics.verifiedOutputBytes !== 1) throw new Error('Test 2 failed: verifiedOutputBytes must be 1');

  // Test 3: 4096-byte file with 1024-byte blocks (loss = 0)
  console.log('\n>>> TEST 3: 4096-BYTE FILE (1024-BYTE BLOCKS) <<<');
  const buf4096 = Buffer.alloc(4096);
  for (let i = 0; i < 4096; i++) buf4096[i] = (i * 31 + 7) & 0xff;
  results.test3 = await runRudpTest({
    name: '3. 4096-byte File (1024 B blocks, 0% loss)',
    content: buf4096,
    blockSize: 1024,
    lossRate: 0
  });

  // Verify constraints for Test 3: exactly 4 unique source blocks, 4 attempts, 4 unique packets received, 4 ACKs
  if (results.test3.metrics.originalBlocks !== 4) throw new Error(`Test 3 failed: expected 4 originalBlocks, got ${results.test3.metrics.originalBlocks}`);
  if (results.test3.metrics.uniquePacketsReceived !== 4) throw new Error(`Test 3 failed: expected 4 uniquePacketsReceived, got ${results.test3.metrics.uniquePacketsReceived}`);
  if (results.test3.metrics.transmissionAttempts !== 4) throw new Error(`Test 3 failed: expected 4 transmissionAttempts, got ${results.test3.metrics.transmissionAttempts}`);
  if (results.test3.metrics.retransmissions !== 0) throw new Error(`Test 3 failed: expected 0 retransmissions at 0% loss`);
  if (results.test3.metrics.verifiedOutputBytes !== 4096) throw new Error(`Test 3 failed: verifiedOutputBytes must be 4096`);

  // Test 4: Transfer with packet loss that actually triggers a retransmission
  console.log('\n>>> TEST 4: TRANSFER WITH PACKET LOSS TRIGGERING RETRANSMISSIONS <<<');
  // We will run with 20% loss on a 4096 B file (or retry with 25% if by chance no packets were dropped)
  let test4Passed = false;
  let attempts = 0;
  while (!test4Passed && attempts < 5) {
    attempts++;
    const test4Run = await runRudpTest({
      name: `4. Packet Loss Transfer (Attempt ${attempts}, 25% loss)`,
      content: buf4096,
      blockSize: 1024,
      lossRate: 25
    });
    if (test4Run.metrics.retransmissions > 0 && test4Run.metrics.droppedPackets > 0) {
      results.test4 = test4Run;
      test4Passed = true;
    } else {
      console.log(`[Notice] Attempt ${attempts} didn't trigger drops (loss was 0 due to random seed). Retrying...`);
    }
  }

  if (!test4Passed) {
    throw new Error('Test 4 failed to trigger retransmissions after 5 attempts');
  }

  // Verify constraints for Test 4:
  if (results.test4.metrics.originalBlocks !== 4) throw new Error(`Test 4 failed: originalBlocks must be 4`);
  if (results.test4.metrics.retransmissions < 1) throw new Error(`Test 4 failed: retransmissions must be >= 1`);
  if (results.test4.metrics.droppedPackets < 1) throw new Error(`Test 4 failed: droppedPackets must be >= 1`);
  if (results.test4.metrics.transmissionAttempts <= 4) throw new Error(`Test 4 failed: transmissionAttempts must be > 4 due to retries`);
  if (results.test4.metrics.uniquePacketsReceived !== 4) throw new Error(`Test 4 failed: uniquePacketsReceived must be 4`);
  if (results.test4.metrics.verifiedOutputBytes !== 4096) throw new Error(`Test 4 failed: verifiedOutputBytes must be 4096`);

  console.log(`\n======================================================================`);
  console.log(`ALL 4 REQUIRED VERIFICATION TESTS COMPLETED AND VALIDATED!`);
  console.log(`======================================================================`);
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error('\n[FATAL ERROR]', err);
  process.exit(1);
});
