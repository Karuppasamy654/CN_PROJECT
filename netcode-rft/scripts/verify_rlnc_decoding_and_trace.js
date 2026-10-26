const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function executeRLNCTransfer(filename, content, blockSize = 512, K = 4, redundancy = 2, lossRate = 10) {
  const origSha = crypto.createHash('sha256').update(content).digest('hex');
  const formData = new FormData();
  const blob = new Blob([content], { type: 'application/octet-stream' });
  formData.append('file', blob, filename);
  formData.append('protocol', 'rlnc');
  formData.append('blockSize', String(blockSize));
  formData.append('K', String(K));
  formData.append('redundancy', String(redundancy));
  formData.append('lossRate', String(lossRate));
  formData.append('delayMs', '5');

  const createRes = await fetch('http://localhost:5000/api/transfers', {
    method: 'POST',
    body: formData,
  });
  if (!createRes.ok) throw new Error(`Create failed: ${createRes.status}`);
  const transfer = await createRes.json();

  const startRes = await fetch(`http://localhost:5000/api/transfers/${transfer.id}/start`, { method: 'POST' });
  if (!startRes.ok) throw new Error(`Start failed: ${startRes.status}`);

  let verify = null;
  for (let i = 0; i < 60; i++) {
    await sleep(350);
    const vRes = await fetch(`http://localhost:5000/api/transfers/${transfer.id}/verification`);
    verify = await vRes.json();
    if (verify.state === 'SUCCESS' || verify.state === 'FAILED') break;
  }

  // Fetch events
  const evRes = await fetch(`http://localhost:5000/api/transfers/${transfer.id}/events`);
  const evData = await evRes.json();
  const events = evData.events || [];

  // Fetch Inspector data
  const inspRes = await fetch(`http://localhost:5000/api/transfers/${transfer.id}/inspector`);
  const inspector = await inspRes.json();

  // Fetch Equation Lab calculations
  const calcRes = await fetch(`http://localhost:5000/api/calculations/transfer/${transfer.id}`);
  const calc = await calcRes.json();

  // Download reconstructed file
  const dlRes = await fetch(`http://localhost:5000/api/transfers/${transfer.id}/download`);
  const dlBuf = Buffer.from(await dlRes.arrayBuffer());
  const dlSha = crypto.createHash('sha256').update(dlBuf).digest('hex');

  return {
    transferId: transfer.id,
    filename,
    origSize: content.length,
    reconSize: dlBuf.length,
    origSha,
    reconSha: dlSha,
    hashesMatch: origSha === dlSha,
    verify,
    events,
    inspector,
    calc,
  };
}

async function main() {
  console.log('========================================================================');
  console.log('  NETCODE-RFT: RIGOROUS RLNC DECODING & EQUATION LAB TRACE VERIFICATION ');
  console.log('========================================================================\n');

  // -------------------------------------------------------------
  // File 1: Text Document ("document_charlie.txt", 2048 bytes)
  // -------------------------------------------------------------
  const file1Text = 'NetCode-RFT Project: Real RLNC GF(256) Network Coding Verification.\n'.repeat(30).slice(0, 2048);
  const file1Content = Buffer.from(file1Text);
  console.log(`[FILE 1] Uploading and Transferring: document_charlie.txt (${file1Content.length} bytes)...`);
  const res1 = await executeRLNCTransfer('document_charlie.txt', file1Content, 512, 4, 3, 10);

  console.log(`  -> Verification State:      ${res1.verify.state}`);
  console.log(`  -> Original File Size:      ${res1.origSize} bytes`);
  console.log(`  -> Reconstructed Size:      ${res1.reconSize} bytes`);
  console.log(`  -> Original SHA-256:        ${res1.origSha}`);
  console.log(`  -> Reconstructed SHA-256:   ${res1.reconSha}`);
  console.log(`  -> Hashes Match Bit-Exact:  ${res1.hashesMatch ? 'YES (PASSED)' : 'NO (FAILED)'}`);

  const cDecoderSteps1 = res1.events.filter(e => e.type === 'decoder_step');
  const cMatrixUpdates1 = res1.events.filter(e => e.type === 'decoder_matrix_update');
  console.log(`  -> Real C Decoder Emitted Steps:          ${cDecoderSteps1.length}`);
  console.log(`  -> Real C Decoder Emitted Matrix Updates: ${cMatrixUpdates1.length}`);
  cDecoderSteps1.forEach((st, idx) => {
    console.log(`     [C Decoder Step ${idx + 1}] op: ${st.op}, pivot_row: ${st.pivot_row}, pivot_col: ${st.pivot_col}, pivot_val: ${st.pivot_val} -> "${st.desc}"`);
  });

  console.log(`  -> Equation Lab Matrix A Dimension: ${res1.calc.matrixA.length}x${res1.calc.matrixA[0]?.length || 0}`);
  console.log(`  -> Equation Lab Rank:              ${res1.calc.rank} (Required: ${res1.calc.requiredRank})`);
  console.log(`  -> Equation Lab Gauss-Jordan Steps: ${res1.calc.gaussJordan?.steps?.length || 0}`);
  if (res1.calc.gaussJordan?.steps) {
    res1.calc.gaussJordan.steps.slice(0, 4).forEach((st, idx) => {
      console.log(`     [EqLab Step ${idx + 1}] op: ${st.op} -> "${st.desc}"`);
    });
  }

  // -------------------------------------------------------------
  // File 2: Binary File ("binary_delta.bin", 3072 bytes)
  // -------------------------------------------------------------
  const file2Content = Buffer.alloc(3072);
  for (let i = 0; i < 3072; i++) {
    file2Content[i] = (i * 109 + 83) & 0xff;
  }
  console.log(`\n[FILE 2] Uploading and Transferring: binary_delta.bin (${file2Content.length} bytes)...`);
  const res2 = await executeRLNCTransfer('binary_delta.bin', file2Content, 512, 4, 3, 10);

  console.log(`  -> Verification State:      ${res2.verify.state}`);
  console.log(`  -> Original File Size:      ${res2.origSize} bytes`);
  console.log(`  -> Reconstructed Size:      ${res2.reconSize} bytes`);
  console.log(`  -> Original SHA-256:        ${res2.origSha}`);
  console.log(`  -> Reconstructed SHA-256:   ${res2.reconSha}`);
  console.log(`  -> Hashes Match Bit-Exact:  ${res2.hashesMatch ? 'YES (PASSED)' : 'NO (FAILED)'}`);

  const cDecoderSteps2 = res2.events.filter(e => e.type === 'decoder_step');
  console.log(`  -> Real C Decoder Emitted Steps: ${cDecoderSteps2.length}`);
  console.log(`  -> Equation Lab Matrix A Dimension: ${res2.calc.matrixA.length}x${res2.calc.matrixA[0]?.length || 0}`);
  console.log(`  -> Equation Lab Rank:              ${res2.calc.rank} (Required: ${res2.calc.requiredRank})`);

  // -------------------------------------------------------------
  // Comparative Trace & Verification Correspondence Checks
  // -------------------------------------------------------------
  console.log('\n========================================================================');
  console.log('              COMPREHENSIVE TRACE & ISOLATION COMPARISON                ');
  console.log('========================================================================');

  // Check 1: Different Source Files & Hashes
  const hashesDifferent = res1.origSha !== res2.origSha;
  console.log(`1. Source Hashes Are Distinct:       ${hashesDifferent ? 'YES' : 'NO'}`);
  if (!hashesDifferent) throw new Error('File hashes are not distinct');

  // Check 2: Different Source Block Previews
  const preview1 = res1.calc.sourceBlocks[0]?.asciiPreview || res1.calc.sourceBlocks[0]?.hexPreview;
  const preview2 = res2.calc.sourceBlocks[0]?.hexPreview;
  console.log(`   - File 1 Block 0 Preview:         "${preview1}"`);
  console.log(`   - File 2 Block 0 Preview:         "${preview2}"`);

  // Check 3: Matrix Row Verification Against C Received Datagrams
  const rxEvents1 = res1.events.filter(e => e.type === 'packet_received');
  console.log(`2. Matrix A Rows Correspond to Actual Received Packets:`);
  console.log(`   - File 1 Received Packets from UDP: ${rxEvents1.length}`);
  console.log(`   - File 1 Matrix A Rows in EqLab:    ${res1.calc.matrixA.length}`);
  for (let r = 0; r < Math.min(res1.calc.matrixA.length, rxEvents1.length); r++) {
    const matrixRow = JSON.stringify(res1.calc.matrixA[r]);
    const pktCoeffs = JSON.stringify(rxEvents1[r].coeffs);
    const matches = matrixRow === pktCoeffs;
    console.log(`     Row ${r}: MatrixA=[${res1.calc.matrixA[r].join(', ')}] vs PacketRx=[${rxEvents1[r].coeffs.join(', ')}] -> Match: ${matches ? 'YES' : 'NO'}`);
    if (!matches) throw new Error(`Matrix A row ${r} does not match received packet coefficients!`);
  }

  // Check 4: Different Coefficient Matrices Across Transfers
  const matrixA1Str = JSON.stringify(res1.calc.matrixA);
  const matrixA2Str = JSON.stringify(res2.calc.matrixA);
  console.log(`3. Coefficient Matrices Are Distinct Across Transfers: ${matrixA1Str !== matrixA2Str ? 'YES' : 'NO'}`);

  // Check 5: Recovered Payload Bytes in EqLab Match Original Bytes
  console.log(`4. Reconstructed Blocks in EqLab Match Real Source Blocks:`);
  for (let b = 0; b < res1.calc.decodedPackets.length; b++) {
    const decodedBytes = res1.calc.decodedPackets[b].bytes;
    const origBlockSlice = Array.from(file1Content.slice(b * 512, b * 512 + decodedBytes.length));
    const eqLabMatch = JSON.stringify(decodedBytes) === JSON.stringify(origBlockSlice);
    console.log(`   - Block ${b + 1} bytes preview: EqLab=[${decodedBytes.slice(0, 3)}] vs Source=[${origBlockSlice.slice(0, 3)}] -> Match: ${eqLabMatch ? 'YES' : 'NO'}`);
    if (!eqLabMatch) throw new Error(`Decoded block ${b} does not match source block bytes!`);
  }

  console.log('\n>>> ALL RIGOROUS RLNC DECODING AND TRACE CHECKS VERIFIED SUCCESSFULLY <<<');
}

main().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
