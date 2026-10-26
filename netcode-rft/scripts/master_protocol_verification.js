const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const BASE_URL = 'http://localhost:5000';
const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function computeIndependentHash(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Independent hash failed: file not found: ${filePath}`);
  }
  const buf = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  return { hash, bytesRead: buf.length };
}

function computeCliHash(filePath) {
  try {
    // Run PowerShell Get-FileHash
    const cmd = `powershell -NoProfile -Command "(Get-FileHash -Algorithm SHA256 '${filePath}').Hash.ToLower()"`;
    const out = execSync(cmd, { encoding: 'utf8' }).trim();
    return out;
  } catch (e) {
    return 'CLI_HASH_ERR';
  }
}

async function runTestCase({ testName, content, blockSize, lossRate, expectedBlocks }) {
  console.log(`\n================================================================================`);
  console.log(` TEST: ${testName}`);
  console.log(` Content Size: ${content.length} B | Block Size: ${blockSize} B | Loss Rate: ${lossRate}%`);
  console.log(`================================================================================`);

  const expectedSha = crypto.createHash('sha256').update(content).digest('hex');
  console.log(`[*] Pre-transmission In-Memory Hash: ${expectedSha}`);

  if (content.length > 0 && expectedSha === EMPTY_SHA) {
    throw new Error(`CRITICAL INTEGRITY FAILURE: Non-empty test payload evaluated to empty SHA!`);
  }

  const filename = `verify_${Date.now()}_sz${content.length}.bin`;

  // 1. Upload file
  const formData = new FormData();
  const blob = new Blob([content], { type: 'application/octet-stream' });
  formData.append('file', blob, filename);
  formData.append('protocol', 'rudp');
  formData.append('blockSize', String(blockSize));
  formData.append('lossRate', String(lossRate));
  formData.append('delayMs', '0');

  const uploadRes = await fetch(`${BASE_URL}/api/transfers`, { method: 'POST', body: formData });
  if (!uploadRes.ok) {
    throw new Error(`Upload failed (${uploadRes.status}): ${await uploadRes.text()}`);
  }
  const transfer = await uploadRes.json();
  const transferId = transfer.id;
  const sourcePath = transfer.filePath;
  const outPath = sourcePath + '.reconstructed';

  console.log(`[1] Transfer Created: ID = ${transferId}`);
  console.log(`    Source File Path: ${sourcePath}`);
  console.log(`    Target Dest Path: ${outPath}`);

  // Independent source check on disk
  const srcDiskStat = fs.statSync(sourcePath);
  const srcDiskHash = computeIndependentHash(sourcePath);
  const srcCliHash = computeCliHash(sourcePath);

  console.log(`[2] Independent Source File Verification (On Disk):`);
  console.log(`    - fs.stat size:             ${srcDiskStat.size} bytes`);
  console.log(`    - fs.readFileSync bytes:    ${srcDiskHash.bytesRead} bytes`);
  console.log(`    - Node crypto SHA-256:      ${srcDiskHash.hash}`);
  console.log(`    - PowerShell CLI SHA-256:   ${srcCliHash}`);

  if (srcDiskStat.size !== content.length || srcDiskHash.bytesRead !== content.length) {
    throw new Error(`Source file size mismatch on disk! Expected ${content.length}, got ${srcDiskStat.size}`);
  }
  if (srcDiskHash.hash !== expectedSha || srcCliHash !== expectedSha) {
    throw new Error(`Source hash mismatch on disk!`);
  }

  // 2. Start transfer via C engine
  const startRes = await fetch(`${BASE_URL}/api/transfers/${transferId}/start`, { method: 'POST' });
  if (!startRes.ok) {
    throw new Error(`Start failed (${startRes.status}): ${await startRes.text()}`);
  }
  console.log(`[3] Real UDP Transfer Initiated (C engine process)`);

  // 3. Poll verification
  let verification = null;
  for (let i = 0; i < 200; i++) {
    await sleep(200);
    const vRes = await fetch(`${BASE_URL}/api/transfers/${transferId}/verification`);
    verification = await vRes.json();
    if (verification.state === 'SUCCESS' || verification.state === 'FAILED') break;
  }

  console.log(`[4] Verification Endpoint Result:`);
  console.log(`    - State:        ${verification.state}`);
  console.log(`    - Verified:     ${verification.verified}`);
  console.log(`    - Message:      ${verification.message}`);
  console.log(`    - Orig Size:    ${verification.origSize} B (Read: ${verification.origBytesRead} B)`);
  console.log(`    - Recon Size:   ${verification.reconSize} B (Read: ${verification.reconBytesRead} B)`);
  console.log(`    - Orig SHA:     ${verification.origSha}`);
  console.log(`    - Recon SHA:    ${verification.reconSha}`);

  if (verification.state !== 'SUCCESS') {
    throw new Error(`Verification endpoint failed: ${verification.message}`);
  }

  // 4. Independent Destination File Verification on Disk
  if (!fs.existsSync(outPath)) {
    throw new Error(`Destination file does not exist on disk: ${outPath}`);
  }
  const dstDiskStat = fs.statSync(outPath);
  const dstDiskHash = computeIndependentHash(outPath);
  const dstCliHash = computeCliHash(outPath);

  console.log(`[5] Independent Destination File Verification (On Disk):`);
  console.log(`    - fs.stat size:             ${dstDiskStat.size} bytes`);
  console.log(`    - fs.readFileSync bytes:    ${dstDiskHash.bytesRead} bytes`);
  console.log(`    - Node crypto SHA-256:      ${dstDiskHash.hash}`);
  console.log(`    - PowerShell CLI SHA-256:   ${dstCliHash}`);

  if (dstDiskStat.size !== content.length || dstDiskHash.bytesRead !== content.length) {
    throw new Error(`Destination file size mismatch on disk!`);
  }
  if (dstDiskHash.hash !== expectedSha || dstCliHash !== expectedSha) {
    throw new Error(`Destination hash mismatch on disk!`);
  }

  // 5. Download test and independent download verification
  const dlRes = await fetch(`${BASE_URL}/api/transfers/${transferId}/download`);
  if (!dlRes.ok) {
    throw new Error(`Download route failed (${dlRes.status})`);
  }
  const dlBuf = Buffer.from(await dlRes.arrayBuffer());
  const dlHash = crypto.createHash('sha256').update(dlBuf).digest('hex');
  console.log(`[6] Download Route Verification:`);
  console.log(`    - Downloaded bytes:         ${dlBuf.length} bytes`);
  console.log(`    - Downloaded SHA-256:       ${dlHash}`);

  if (dlBuf.length !== content.length || dlHash !== expectedSha) {
    throw new Error(`Downloaded content does not match source!`);
  }

  // 6. Fetch calculations / protocol metrics
  const calcRes = await fetch(`${BASE_URL}/api/calculations/transfer/${transferId}`);
  const calcData = await calcRes.json();
  const rudp = calcData.rudpData;
  const metrics = rudp.protocolMetrics;

  console.log(`[7] Protocol Lab Metrics:`);
  console.log(`    - Original Blocks:          ${metrics.originalBlocks}`);
  console.log(`    - Transmission Attempts:    ${metrics.transmissionAttempts}`);
  console.log(`    - Unique Rx Packets:        ${metrics.uniquePacketsReceived}`);
  console.log(`    - Dropped Packets:          ${metrics.droppedPackets}`);
  console.log(`    - Retransmissions:          ${metrics.retransmissions}`);
  console.log(`    - ACKs Sent:                ${metrics.acksSent}`);
  console.log(`    - ACKs Received:            ${metrics.acksReceived}`);
  console.log(`    - Verified Output Bytes:    ${metrics.verifiedOutputBytes} B`);

  if (expectedBlocks !== undefined && metrics.originalBlocks !== expectedBlocks) {
    throw new Error(`Expected ${expectedBlocks} originalBlocks, got ${metrics.originalBlocks}`);
  }

  return {
    testName,
    transferId,
    sourcePath,
    outPath,
    sourceSize: content.length,
    reconSize: dstDiskStat.size,
    bytesRead: dstDiskHash.bytesRead,
    sourceSha: expectedSha,
    destinationSha: dstDiskHash.hash,
    cliSourceSha: srcCliHash,
    cliDestSha: dstCliHash,
    downloadSha: dlHash,
    metrics,
    rudp,
    verificationResult: verification.state,
  };
}

async function main() {
  console.log(`================================================================================`);
  console.log(`NETCODE-RFT: MASTER PROTOCOL & CRYPTOGRAPHIC VERIFICATION SUITE`);
  console.log(`================================================================================`);

  const results = {};

  // 1. Empty file: 0 bytes
  results.emptyFile = await runTestCase({
    testName: '1. Empty File (0 Bytes)',
    content: Buffer.alloc(0),
    blockSize: 1024,
    lossRate: 0,
    expectedBlocks: 0,
  });

  // 2. One-byte file
  results.oneByteFile = await runTestCase({
    testName: '2. One-Byte File (1 Byte)',
    content: Buffer.from([0x5A]),
    blockSize: 1024,
    lossRate: 0,
    expectedBlocks: 1,
  });

  // 3. 4096-byte deterministic non-empty file
  const deterministic4096 = Buffer.from(
    'NetCode-RFT Deterministic 4096-byte Protocol Verification Payload\n'.repeat(65)
  ).subarray(0, 4096);
  results.deterministic4096 = await runTestCase({
    testName: '3. 4096-byte Deterministic Non-Empty File (1024 B blocks, 0% loss)',
    content: deterministic4096,
    blockSize: 1024,
    lossRate: 0,
    expectedBlocks: 4,
  });

  // 4. Partial final block (1500 bytes with 512-byte blocks -> 3 blocks: 512, 512, 476)
  const partialBuf = Buffer.from(
    'PARTIAL_BLOCK_TEST_HEADER_'.repeat(60)
  ).subarray(0, 1500);
  results.partialFinalBlock = await runTestCase({
    testName: '4. Partial Final Block (1500 Bytes, 512 B block size)',
    content: partialBuf,
    blockSize: 512,
    lossRate: 0,
    expectedBlocks: 3,
  });

  // 5. Multiple blocks (3072 bytes with 1024-byte blocks -> 3 blocks)
  const multiBuf = Buffer.alloc(3072);
  for (let i = 0; i < 3072; i++) multiBuf[i] = ((i * 17) ^ 0xaa) & 0xff;
  results.multipleBlocks = await runTestCase({
    testName: '5. Multiple Blocks (3072 Bytes, 1024 B block size)',
    content: multiBuf,
    blockSize: 1024,
    lossRate: 0,
    expectedBlocks: 3,
  });

  // 6. Packet loss triggering real retransmissions
  let lossPassed = false;
  let lossAttempts = 0;
  while (!lossPassed && lossAttempts < 5) {
    lossAttempts++;
    const res = await runTestCase({
      testName: `6. Packet Loss Transfer Triggering Retransmissions (Attempt ${lossAttempts}, 25% loss)`,
      content: deterministic4096,
      blockSize: 1024,
      lossRate: 25,
      expectedBlocks: 4,
    });
    if (res.metrics.retransmissions > 0 && res.metrics.droppedPackets > 0) {
      results.lossRetransmissions = res;
      lossPassed = true;
    } else {
      console.log(`[Notice] Attempt ${lossAttempts} had 0 dropped packets due to random seed. Retrying...`);
    }
  }

  if (!lossPassed) {
    throw new Error('Loss test failed to trigger retransmissions after 5 attempts');
  }

  console.log(`\n================================================================================`);
  console.log(`ALL 6 MASTER TESTS PASSED WITH 100% BIT-EXACT INDEPENDENT VERIFICATION!`);
  console.log(`================================================================================`);
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error('\n[FATAL TEST FAILURE]', err);
  process.exit(1);
});
