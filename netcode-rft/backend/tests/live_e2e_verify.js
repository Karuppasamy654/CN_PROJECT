const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function main() {
  console.log('=== Running Live End-to-End Test via Backend API ===');
  
  // 1. Create a 4096-byte 4-block test payload
  const testPayload = Buffer.alloc(4096);
  for (let i = 0; i < 4096; i++) {
    testPayload[i] = ((i * 37 + 13) % 256);
  }
  const origSha = crypto.createHash('sha256').update(testPayload).digest('hex');
  const tempFilePath = path.join(__dirname, 'temp_test_payload.bin');
  fs.writeFileSync(tempFilePath, testPayload);

  try {
    // 2. Upload and configure transfer
    const formData = new FormData();
    const blob = new Blob([testPayload], { type: 'application/octet-stream' });
    formData.append('file', blob, 'demo_payload_4blocks.bin');
    formData.append('protocol', 'rlnc');
    formData.append('lossRate', '10');
    formData.append('delayMs', '20');
    formData.append('reorder', 'false');
    formData.append('blockSize', '1024');
    formData.append('K', '4');
    formData.append('redundancy', '2');

    const createRes = await fetch('http://localhost:5000/api/transfers', {
      method: 'POST',
      body: formData,
    });

    if (!createRes.ok) {
      throw new Error(`Failed to create transfer: ${createRes.status} ${await createRes.text()}`);
    }

    const transfer = await createRes.json();
    console.log(`[Created] Transfer ID: ${transfer.id}, Original SHA: ${origSha}`);

    // Verify initial state is NOT_STARTED
    const preVerifyRes = await fetch(`http://localhost:5000/api/transfers/${transfer.id}/verification`);
    const preVerify = await preVerifyRes.json();
    console.log(`[Pre-start Verification] State: ${preVerify.state}, Verified: ${preVerify.verified}`);
    if (preVerify.state !== 'NOT_STARTED') {
      throw new Error(`Expected pre-start state NOT_STARTED, got ${preVerify.state}`);
    }

    // 3. Start transfer
    const startRes = await fetch(`http://localhost:5000/api/transfers/${transfer.id}/start`, {
      method: 'POST',
    });
    console.log(`[Started] Status: ${startRes.status}`);

    // 4. Poll verification until completed or timeout (15s max)
    let finalVerify = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 500));
      const vRes = await fetch(`http://localhost:5000/api/transfers/${transfer.id}/verification`);
      finalVerify = await vRes.json();
      console.log(`  [Poll ${i+1}] State: ${finalVerify.state}, Verified: ${finalVerify.verified}`);
      if (finalVerify.state === 'SUCCESS' || finalVerify.state === 'FAILED') {
        break;
      }
    }

    console.log('[Final Verification Result]:', JSON.stringify(finalVerify, null, 2));

    if (finalVerify.state !== 'SUCCESS') {
      throw new Error(`Transfer did not reach SUCCESS. Final state: ${finalVerify.state}, message: ${finalVerify.message}`);
    }

    // 5. Check events
    const evRes = await fetch(`http://localhost:5000/api/transfers/${transfer.id}/events`);
    const evData = await evRes.json();
    console.log(`[Events Total]: ${evData.count}`);
    const types = {};
    for (const ev of evData.events) {
      types[ev.type] = (types[ev.type] || 0) + 1;
    }
    console.log('[Event Types Breakdown]:', types);

    // 6. Download reconstructed file and verify SHA-256
    const dlRes = await fetch(`http://localhost:5000/api/transfers/${transfer.id}/download`);
    if (!dlRes.ok) {
      throw new Error(`Download failed: ${dlRes.status}`);
    }
    const downloadedBuf = Buffer.from(await dlRes.arrayBuffer());
    const downloadedSha = crypto.createHash('sha256').update(downloadedBuf).digest('hex');
    console.log(`[Downloaded File Size]: ${downloadedBuf.length} bytes`);
    console.log(`[Downloaded SHA]: ${downloadedSha}`);
    console.log(`[Original   SHA]: ${origSha}`);
    if (downloadedSha !== origSha) {
      throw new Error('Downloaded file SHA-256 does NOT match original!');
    }

    console.log('=== LIVE END-TO-END TRANSFER TEST PASSED PERFECTLY ===');
  } finally {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
  }
}

main().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
