const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function testZeroByteTransfer(protocol) {
  console.log(`\n============================================================`);
  console.log(` TESTING ZERO-BYTE TRANSFER WITH PROTOCOL: ${protocol.toUpperCase()}`);
  console.log(`============================================================`);

  const emptyContent = Buffer.alloc(0);
  const formData = new FormData();
  const blob = new Blob([emptyContent], { type: 'application/octet-stream' });
  const filename = `zero_${protocol}_${Date.now()}.bin`;
  formData.append('file', blob, filename);
  formData.append('protocol', protocol);
  formData.append('blockSize', '512');
  formData.append('K', '4');
  formData.append('redundancy', '2');
  formData.append('lossRate', '0');
  formData.append('delayMs', '0');

  // 1. Upload
  const createRes = await fetch('http://localhost:5000/api/transfers', {
    method: 'POST',
    body: formData,
  });
  if (!createRes.ok) {
    throw new Error(`Upload failed: ${createRes.status} ${await createRes.text()}`);
  }
  const transfer = await createRes.json();
  console.log(`1. Uploaded zero-byte file "${filename}" -> Transfer ID: ${transfer.id}`);
  console.log(`   - Stored file size: ${transfer.fileSize} bytes`);
  console.log(`   - Stored SHA-256:  ${transfer.fileSha256}`);
  if (transfer.fileSize !== 0) throw new Error('Expected file size 0');
  if (transfer.fileSha256 !== EMPTY_HASH) throw new Error('Expected empty SHA-256');

  // 2. Start transfer
  const startRes = await fetch(`http://localhost:5000/api/transfers/${transfer.id}/start`, { method: 'POST' });
  if (!startRes.ok) {
    throw new Error(`Start failed: ${startRes.status} ${await startRes.text()}`);
  }
  console.log(`2. Started transfer process on real UDP socket`);

  // 3. Poll verification
  let verify = null;
  for (let i = 0; i < 100; i++) {
    await sleep(400);
    const vRes = await fetch(`http://localhost:5000/api/transfers/${transfer.id}/verification`);
    verify = await vRes.json();
    if (verify.state === 'SUCCESS' || verify.state === 'FAILED') break;
  }
  console.log(`3. Verification status: ${verify.state}`);
  console.log(`   - Passed: ${verify.verified}`);
  console.log(`   - Message: ${verify.message}`);
  console.log(`   - Original size: ${verify.origSize} B, Reconstructed size: ${verify.reconSize} B`);
  console.log(`   - Original SHA:  ${verify.origSha}`);
  console.log(`   - Recon SHA:     ${verify.reconSha}`);

  if (verify.state !== 'SUCCESS') {
    throw new Error(`Zero-byte transfer verification did not succeed! State: ${verify.state}`);
  }
  if (verify.reconSize !== 0) {
    throw new Error(`Reconstructed file size is ${verify.reconSize}, expected 0!`);
  }
  if (verify.reconSha !== EMPTY_HASH) {
    throw new Error(`Reconstructed SHA ${verify.reconSha} does not match empty hash!`);
  }

  // 4. Download file and verify on disk
  const dlRes = await fetch(`http://localhost:5000/api/transfers/${transfer.id}/download`);
  const dlBuf = Buffer.from(await dlRes.arrayBuffer());
  const dlSha = crypto.createHash('sha256').update(dlBuf).digest('hex');
  console.log(`4. Downloaded file check:`);
  console.log(`   - Downloaded byte length: ${dlBuf.length} bytes`);
  console.log(`   - Downloaded SHA-256:     ${dlSha}`);
  if (dlBuf.length !== 0) throw new Error('Downloaded file is not 0 bytes!');
  if (dlSha !== EMPTY_HASH) throw new Error('Downloaded hash mismatch!');

  // 5. Inspect events
  const evRes = await fetch(`http://localhost:5000/api/transfers/${transfer.id}/events`);
  const evData = await evRes.json();
  const events = evData.events || [];

  const sourceBlocksCreated = events.filter(e => e.type === 'source_block_created');
  const packetsTx = events.filter(e => e.type === 'packet_transmitted');
  const packetsRx = events.filter(e => e.type === 'packet_received');
  const decoderSteps = events.filter(e => e.type === 'decoder_step');
  const decoderUpdates = events.filter(e => e.type === 'decoder_matrix_update');
  const rudpAcks = events.filter(e => e.type === 'rudp_ack');
  const rudpRetransmits = events.filter(e => e.type === 'rudp_retransmit');
  const hsEvents = events.filter(e => e.type === 'handshake_step');

  console.log(`5. Event Inspection:`);
  console.log(`   - Handshake control steps emitted: ${hsEvents.length}`);
  console.log(`   - Source blocks created:           ${sourceBlocksCreated.length} (MUST BE 0)`);
  console.log(`   - Data packets transmitted:        ${packetsTx.length} (MUST BE 0)`);
  console.log(`   - Data packets received:           ${packetsRx.length} (MUST BE 0)`);
  console.log(`   - Decoder elimination steps:       ${decoderSteps.length} (MUST BE 0)`);
  console.log(`   - Decoder matrix updates:          ${decoderUpdates.length} (MUST BE 0)`);
  console.log(`   - RUDP ACKs emitted:               ${rudpAcks.length} (MUST BE 0)`);
  console.log(`   - RUDP Retransmissions:            ${rudpRetransmits.length} (MUST BE 0)`);

  if (sourceBlocksCreated.length !== 0) throw new Error('Artificial source blocks were created!');
  if (packetsTx.length !== 0) throw new Error('Artificial data packets were transmitted!');
  if (packetsRx.length !== 0) throw new Error('Artificial data packets were received!');
  if (decoderSteps.length !== 0) throw new Error('Artificial decoder steps occurred!');
  if (decoderUpdates.length !== 0) throw new Error('Artificial decoder updates occurred!');
  if (rudpAcks.length !== 0) throw new Error('Artificial RUDP ACKs occurred!');
  if (rudpRetransmits.length !== 0) throw new Error('Artificial RUDP retransmissions occurred!');

  // 6. Query Equation Lab calculations endpoint
  const calcRes = await fetch(`http://localhost:5000/api/calculations/transfer/${transfer.id}`);
  const calc = await calcRes.json();

  console.log(`6. Equation Lab / Calculations State:`);
  console.log(`   - Total Blocks:     ${calc.fileSplitting.totalBlocks} (MUST BE 0)`);
  console.log(`   - Total Gens:       ${calc.fileSplitting.totalGenerations} (MUST BE 0)`);
  console.log(`   - Source Blocks:    ${calc.sourceBlocks.length} (MUST BE 0)`);
  console.log(`   - Matrix A rows:    ${calc.matrixA.length} (MUST BE 0)`);
  console.log(`   - Matrix C rows:    ${calc.matrixC.length} (MUST BE 0)`);
  console.log(`   - Decoder Rank:     ${calc.rank} (MUST BE 0)`);
  console.log(`   - Required Rank:    ${calc.requiredRank} (MUST BE 0)`);

  if (calc.fileSplitting.totalBlocks !== 0) throw new Error('totalBlocks is not 0');
  if (calc.fileSplitting.totalGenerations !== 0) throw new Error('totalGenerations is not 0');
  if (calc.sourceBlocks.length !== 0) throw new Error('sourceBlocks is not empty');
  if (calc.matrixA.length !== 0) throw new Error('matrixA is not empty');
  if (calc.matrixC.length !== 0) throw new Error('matrixC is not empty');
  if (calc.rank !== 0) throw new Error('rank is not 0');
  if (calc.requiredRank !== 0) throw new Error('requiredRank is not 0');

  console.log(`\n>>> ZERO-BYTE ${protocol.toUpperCase()} TEST: STRICTLY VERIFIED (ALL 10 CHECKS PASSED) <<<`);
}

async function main() {
  await testZeroByteTransfer('rlnc');
  await testZeroByteTransfer('rudp');
  console.log('\n============================================================');
  console.log(' ALL ZERO-BYTE TRANSFERS COMPLETED AND PROVEN WITHOUT FAKES ');
  console.log('============================================================\n');
}

main().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
