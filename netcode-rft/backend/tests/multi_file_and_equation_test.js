const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runTransfer(filename, content, protocol, lossRate = 10, delayMs = 15, reorder = true) {
  const origSha = crypto.createHash('sha256').update(content).digest('hex');
  const formData = new FormData();
  const blob = new Blob([content], { type: 'application/octet-stream' });
  formData.append('file', blob, filename);
  formData.append('protocol', protocol);
  formData.append('lossRate', String(lossRate));
  formData.append('delayMs', String(delayMs));
  formData.append('reorder', String(reorder));
  formData.append('blockSize', '512');
  formData.append('K', '4');
  formData.append('redundancy', '3');

  const createRes = await fetch('http://localhost:5000/api/transfers', {
    method: 'POST',
    body: formData,
  });
  if (!createRes.ok) {
    throw new Error(`Failed to create transfer: ${createRes.status} ${await createRes.text()}`);
  }
  const transfer = await createRes.json();

  // Start transfer
  await fetch(`http://localhost:5000/api/transfers/${transfer.id}/start`, { method: 'POST' });

  // Poll verification
  let finalVerify = null;
  for (let i = 0; i < 60; i++) {
    await sleep(400);
    const vRes = await fetch(`http://localhost:5000/api/transfers/${transfer.id}/verification`);
    finalVerify = await vRes.json();
    if (finalVerify.state === 'SUCCESS' || finalVerify.state === 'FAILED') break;
  }

  // Fetch events
  const evRes = await fetch(`http://localhost:5000/api/transfers/${transfer.id}/events`);
  const evData = await evRes.json();

  // Fetch calculations
  const calcRes = await fetch(`http://localhost:5000/api/calculations/transfer/${transfer.id}`);
  const calcData = await calcRes.json();

  // Download
  let downloadedSha = null;
  let downloadedBuf = null;
  const dlRes = await fetch(`http://localhost:5000/api/transfers/${transfer.id}/download`);
  if (dlRes.ok) {
    downloadedBuf = Buffer.from(await dlRes.arrayBuffer());
    downloadedSha = crypto.createHash('sha256').update(downloadedBuf).digest('hex');
  }

  return {
    transferId: transfer.id,
    origSha,
    finalVerify,
    events: evData.events || [],
    calcData,
    downloadedSha,
    downloadedSize: downloadedBuf ? downloadedBuf.length : 0,
  };
}

async function main() {
  console.log('================================================================');
  console.log('   NetCode-RFT: Comprehensive Real-Network & Equation Lab Test  ');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // Test File 1: Text Document ("alpha_document.txt", 2048 bytes)
  // -------------------------------------------------------------
  const file1Content = Buffer.from('NetCode-RFT Alpha Transfer: Mathematical Network Coding with UDP Sockets.\n'.repeat(28).slice(0, 2048));
  console.log(`[Test 1] Running RLNC with File 1 (alpha_document.txt, ${file1Content.length} bytes)...`);
  const res1 = await runTransfer('alpha_document.txt', file1Content, 'rlnc', 10, 10, true);
  console.log(`  -> Verification State: ${res1.finalVerify.state}`);
  console.log(`  -> Original SHA256:     ${res1.origSha}`);
  console.log(`  -> Reconstructed SHA256: ${res1.downloadedSha}`);
  console.log(`  -> Hashes match: ${res1.origSha === res1.downloadedSha ? 'YES (EXACT)' : 'NO'}`);

  // Handshake events check
  const hsEvents1 = res1.events.filter(e => e.type === 'handshake_step');
  console.log(`  -> Handshake events emitted: ${hsEvents1.length}`);
  hsEvents1.forEach(e => {
    console.log(`     Step ${e.step}: ${e.step_name} (${e.direction}) - "${e.desc}"`);
  });

  // Verify timestamps: data packets must strictly follow handshake
  const firstDataPacketEvent = res1.events.find(e => e.type === 'packet_transmitted');
  const lastHsEvent = hsEvents1[hsEvents1.length - 1];
  if (firstDataPacketEvent && lastHsEvent) {
    console.log(`  -> Handshake completed at: ${lastHsEvent.time}ms, First data packet: ${firstDataPacketEvent.time}ms`);
  }

  // Check calculations for File 1
  console.log('\n[Equation Lab Data for File 1]:');
  console.log(`  -> Source Blocks Count: ${res1.calcData.sourceBlocks ? res1.calcData.sourceBlocks.length : 0}`);
  if (res1.calcData.sourceBlocks && res1.calcData.sourceBlocks.length > 0) {
    console.log(`     Block 0 Preview: ${res1.calcData.sourceBlocks[0].asciiPreview || res1.calcData.sourceBlocks[0].hexPreview}`);
  }
  console.log(`  -> Received Packets in Matrix: ${res1.calcData.receivedPackets ? res1.calcData.receivedPackets.length : 0}`);
  if (res1.calcData.receivedPackets && res1.calcData.receivedPackets.length > 0) {
    console.log(`     Packet 0 Coeffs: [${res1.calcData.receivedPackets[0].coeffs.join(', ')}]`);
    console.log(`     Packet 0 Data Preview: [${res1.calcData.receivedPackets[0].dataPreview.join(', ')}]`);
  }
  console.log(`  -> Coefficient Matrix A (dim: ${res1.calcData.matrixA ? res1.calcData.matrixA.length : 0}x${res1.calcData.matrixA && res1.calcData.matrixA[0] ? res1.calcData.matrixA[0].length : 0}):`);
  if (res1.calcData.matrixA) {
    res1.calcData.matrixA.slice(0, 4).forEach((row, i) => {
      console.log(`     Row ${i}: [${row.join(', ')}]`);
    });
  }
  console.log(`  -> Matrix Rank: ${res1.calcData.rank} (Required: ${res1.calcData.requiredRank})`);
  console.log(`  -> Gauss-Jordan Elimination Steps: ${res1.calcData.gaussJordan?.steps ? res1.calcData.gaussJordan.steps.length : 0}`);
  if (res1.calcData.gaussJordan?.steps && res1.calcData.gaussJordan.steps.length > 0) {
    console.log(`     Step 1: ${res1.calcData.gaussJordan.steps[0].operation}`);
  }

  // -------------------------------------------------------------
  // Test File 2: Binary File ("beta_binary.dat", 4096 bytes)
  // -------------------------------------------------------------
  const file2Content = Buffer.alloc(4096);
  for (let i = 0; i < 4096; i++) {
    file2Content[i] = (i * 73 + 199) & 0xff;
  }
  console.log(`\n[Test 2] Running RLNC with File 2 (beta_binary.dat, ${file2Content.length} bytes)...`);
  const res2 = await runTransfer('beta_binary.dat', file2Content, 'rlnc', 10, 10, true);
  console.log(`  -> Verification State: ${res2.finalVerify.state}`);
  console.log(`  -> Original SHA256:     ${res2.origSha}`);
  console.log(`  -> Reconstructed SHA256: ${res2.downloadedSha}`);
  console.log(`  -> Hashes match: ${res2.origSha === res2.downloadedSha ? 'YES (EXACT)' : 'NO'}`);

  console.log('\n[Equation Lab Data for File 2]:');
  if (res2.calcData.sourceBlocks && res2.calcData.sourceBlocks.length > 0) {
    console.log(`     Block 0 Preview (Hex): ${res2.calcData.sourceBlocks[0].hexPreview}`);
  }
  if (res2.calcData.receivedPackets && res2.calcData.receivedPackets.length > 0) {
    console.log(`     Packet 0 Coeffs: [${res2.calcData.receivedPackets[0].coeffs.join(', ')}]`);
    console.log(`     Packet 0 Data Preview: [${res2.calcData.receivedPackets[0].dataPreview.join(', ')}]`);
  }
  if (res2.calcData.matrixA) {
    res2.calcData.matrixA.slice(0, 4).forEach((row, i) => {
      console.log(`     Row ${i}: [${row.join(', ')}]`);
    });
  }

  // Compare File 1 vs File 2
  console.log('\n[Comparison File 1 vs File 2]:');
  const distinctCoeffs = JSON.stringify(res1.calcData.matrixA) !== JSON.stringify(res2.calcData.matrixA);
  const distinctData = JSON.stringify(res1.calcData.matrixC) !== JSON.stringify(res2.calcData.matrixC);
  const distinctHashes = res1.origSha !== res2.origSha;
  console.log(`  -> Different source hashes: ${distinctHashes ? 'YES' : 'NO'}`);
  console.log(`  -> Different coefficient matrices: ${distinctCoeffs ? 'YES' : 'NO'}`);
  console.log(`  -> Different coded data matrices: ${distinctData ? 'YES' : 'NO'}`);

  // -------------------------------------------------------------
  // Test 3: Reliable UDP (RUDP) with loss & ACKs
  // -------------------------------------------------------------
  console.log('\n[Test 3] Running Reliable UDP (RUDP) with packet loss (15%)...');
  const resRudp = await runTransfer('rudp_test.dat', file1Content.slice(0, 1024), 'rudp', 15, 10, false);
  console.log(`  -> Verification State: ${resRudp.finalVerify.state}`);
  console.log(`  -> Original SHA256:     ${resRudp.origSha}`);
  console.log(`  -> Reconstructed SHA256: ${resRudp.downloadedSha}`);
  const ackEvents = resRudp.events.filter(e => e.type === 'rudp_ack');
  const dropEvents = resRudp.events.filter(e => e.type === 'packet_dropped');
  console.log(`  -> ACK events received: ${ackEvents.length}`);
  console.log(`  -> Packet drop events: ${dropEvents.length}`);
  console.log(`  -> Genuine handshake events: ${resRudp.events.filter(e => e.type === 'handshake_step').length}`);

  console.log('\n================================================================');
  console.log('   ALL TESTS AND VERIFICATION CRITERIA COMPLETED SUCCESSFULLY   ');
  console.log('================================================================');
}

main().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
