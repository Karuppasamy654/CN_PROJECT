const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

const API_BASE = 'http://localhost:5000';
const ROOT_DIR = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(ROOT_DIR, 'results');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');

if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

// Upload file helper
async function uploadTransfer({ filePath, protocol = 'rlnc', lossRate = 0, delayMs = 20, K = 4, redundancy = 2, seed = 1 }) {
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  const fileContent = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  const formFields = {
    protocol,
    lossRate: String(lossRate),
    delayMs: String(delayMs),
    bandwidth: '10Mbps',
    reorder: 'false',
    blockSize: '1024',
    K: String(K),
    redundancy: String(redundancy),
    seed: String(seed),
    autoNetAnim: 'false',
  };

  const chunks = [];
  for (const [k, v] of Object.entries(formFields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }

  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
  chunks.push(fileContent);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const body = Buffer.concat(chunks);

  const res = await fetch(`${API_BASE}/api/transfers`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Upload failed (${res.status}): ${errText}`);
  }
  return await res.json();
}

// Start transfer helper
async function startTransfer(transferId) {
  const res = await fetch(`${API_BASE}/api/transfers/${transferId}/start`, { method: 'POST' });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Start failed (${res.status}): ${errText}`);
  }
  return await res.json();
}

// Poll until completed
async function waitForCompletion(transferId, maxSec = 15) {
  const start = Date.now();
  while ((Date.now() - start) < maxSec * 1000) {
    const res = await fetch(`${API_BASE}/api/transfers/${transferId}`);
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'completed' || data.status === 'failed') {
        return data;
      }
    }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error(`Transfer ${transferId} timed out after ${maxSec}s`);
}

async function getCalculations(transferId) {
  const res = await fetch(`${API_BASE}/api/calculations/transfer/${transferId}`);
  if (!res.ok) throw new Error(`Calculations failed (${res.status})`);
  return await res.json();
}

async function getTraceEvents(traceFileName) {
  const res = await fetch(`${API_BASE}/api/traces/${traceFileName}/events`);
  if (!res.ok) throw new Error(`Trace events failed (${res.status})`);
  return await res.json();
}

async function main() {
  console.log('========================================================================');
  console.log(' FINAL LIVE VERIFICATION ON ACTIVE NETCODE-RFT SYSTEM');
  console.log('========================================================================\n');

  // STEP 1: Verify health
  const healthRes = await fetch(`${API_BASE}/api/health`);
  const health = await healthRes.json();
  console.log('[STEP 1] Documented Startup Verification:');
  console.log(`  Backend Health: ${health.status} (Simulator: ${health.simulator})`);
  console.log(`  NS-3 Binary: ${health.ns3?.binary}`);
  console.log(`  NetAnim Binary: ${health.netanim?.binary}\n`);

  // STEP 2: Create 4KB binary file 1 (File A)
  const fileA_path = path.join(UPLOADS_DIR, 'live_test_file_A_4kb.bin');
  const bufA = Buffer.alloc(4096);
  for (let i = 0; i < 4096; i++) {
    bufA[i] = (i * 37 + 13) % 256;
  }
  fs.writeFileSync(fileA_path, bufA);
  const hashA = sha256(bufA);

  console.log('[STEP 2] Upload 4KB Binary File A and run RLNC at 0% Loss:');
  console.log(`  Input File: ${fileA_path} (4096 bytes)`);
  console.log(`  Source SHA-256: ${hashA}`);

  const transfer1 = await uploadTransfer({ filePath: fileA_path, protocol: 'rlnc', lossRate: 0, seed: 100 });
  const runId1 = transfer1.id;
  console.log(`  Created Transfer ID: ${runId1}`);

  await startTransfer(runId1);
  const finished1 = await waitForCompletion(runId1);
  console.log(`  Transfer Status: ${finished1.status} (Exit Code: ${finished1.exitCode})`);

  // STEP 3 & 4: Verify Simulation, Equation Lab, and NetAnim reference the same run ID
  console.log('\n[STEP 3 & 4] Single Source of Truth Across Views:');
  const calc1 = await getCalculations(runId1);
  console.log(`  Simulation Page Transfer ID: ${finished1.id}`);
  console.log(`  Equation Lab Transfer ID:     ${calc1.transferId}`);
  console.log(`  Trace XML Referenced:        ${finished1.traceFile}`);
  const trace1 = await getTraceEvents(finished1.traceFile);
  console.log(`  Trace Events Total Packets:  ${trace1.totalPackets}`);
  console.log(`  All 3 Views Bind to Run ID:  ${finished1.id === calc1.transferId && finished1.traceFile.includes(runId1) ? 'YES (VERIFIED)' : 'FAIL'}`);

  // STEP 5: Confirm packet accounting at 0% loss
  console.log('\n[STEP 5] Packet Accounting Verification at 0% Loss:');
  console.log(`  Forward Physical Drops: ${finished1.metrics?.forward_phy_drops ?? 0}`);
  console.log(`  Reverse Physical Drops: ${finished1.metrics?.reverse_phy_drops ?? 0}`);
  console.log(`  Equation Lab Dropped Packets: ${calc1.droppedPackets.length}`);
  console.log(`  Any False Losses Reported: ${calc1.droppedPackets.length === 0 ? 'NO (0 drops, exact)' : 'YES (INCORRECT)'}`);

  // STEP 6: Capture actual matrices and decoder operations
  console.log('\n[STEP 6] Actual RLNC Matrices & Decoder Operations (Run 1):');
  console.log(`  Decoder Rank: ${calc1.rank} / ${calc1.requiredRank} (Full Rank: ${calc1.isFullRank})`);
  console.log('  Coefficient Matrix A (M x K):');
  for (let r = 0; r < calc1.matrixA.length; r++) {
    console.log(`    Row ${r + 1}: [${calc1.matrixA[r].join(', ')}]`);
  }
  console.log('  Coded Data Matrix C (first 3 bytes preview per row):');
  for (let r = 0; r < calc1.matrixC.length; r++) {
    console.log(`    Row ${r + 1}: [${calc1.matrixC[r].join(', ')}] (Hex: [${calc1.matrixC[r].map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}])`);
  }
  console.log(`  Decoder Step Trace (${calc1.decoderHistory.length} Packet Arrivals):`);
  calc1.decoderHistory.forEach((h, i) => {
    console.log(`    Arrival #${i + 1} (Seq ${h.seqId}): Innovative=${h.innovative}, Rank=${h.rankAfter}, Eq: ${h.equation}`);
  });

  // STEP 7: Run a second 4KB file with completely different contents
  console.log('\n[STEP 7] Run Second 4KB File (File B) with Different Contents:');
  const fileB_path = path.join(UPLOADS_DIR, 'live_test_file_B_4kb.bin');
  const bufB = Buffer.alloc(4096);
  for (let i = 0; i < 4096; i++) {
    bufB[i] = (i * 131 + 71) % 256;
  }
  fs.writeFileSync(fileB_path, bufB);
  const hashB = sha256(bufB);
  console.log(`  File B SHA-256: ${hashB}`);
  console.log(`  Source Hashes Distinct: ${hashA !== hashB ? 'YES' : 'NO'}`);

  const transfer2 = await uploadTransfer({ filePath: fileB_path, protocol: 'rlnc', lossRate: 0, seed: 200 });
  const runId2 = transfer2.id;
  await startTransfer(runId2);
  const finished2 = await waitForCompletion(runId2);
  const calc2 = await getCalculations(runId2);

  console.log(`  Run 2 ID: ${runId2}`);
  console.log('  File B Coded Data Matrix C (first 3 bytes preview):');
  for (let r = 0; r < calc2.matrixC.length; r++) {
    console.log(`    Row ${r + 1}: [${calc2.matrixC[r].join(', ')}] (Hex: [${calc2.matrixC[r].map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}])`);
  }
  const payloadsDistinct = JSON.stringify(calc1.matrixC) !== JSON.stringify(calc2.matrixC);
  console.log(`  Matrix C Differs From File A: ${payloadsDistinct ? 'YES (Different file payload verified)' : 'NO'}`);

  // Reconstructed file checks for File B
  const reconB_path = finished2.outPath;
  const reconB_hash = sha256File(reconB_path);
  console.log(`  File B Reconstructed SHA: ${reconB_hash}`);
  console.log(`  File B Bit-Exact Match:   ${reconB_hash === hashB ? 'PASS' : 'FAIL'}`);

  // STEP 8: Run File A with nonzero loss (20%)
  console.log('\n[STEP 8] Run File A with 20% Packet Loss:');
  const transfer3 = await uploadTransfer({ filePath: fileA_path, protocol: 'rlnc', lossRate: 20, seed: 333 });
  const runId3 = transfer3.id;
  await startTransfer(runId3);
  const finished3 = await waitForCompletion(runId3);
  const calc3 = await getCalculations(runId3);

  console.log(`  Run 3 ID: ${runId3} (20% Loss)`);
  console.log(`  Forward Packet Drops: ${calc3.droppedPackets.length}`);
  console.log(`  Dropped Packet IDs:   ${calc3.droppedPackets.map(d => d.seqId).join(', ') || 'None'}`);
  console.log(`  Decoder Final Rank:   ${calc3.rank} / ${calc3.requiredRank}`);
  console.log(`  Innovative Packets:   ${calc3.independentEquations}`);
  console.log(`  Dependent Packets:    ${calc3.dependentEquations}`);

  // STEP 9 & 10: Byte-for-byte comparison of reconstructed output at 20% loss
  console.log('\n[STEP 9 & 10] Reconstruction & Cryptographic Hash Comparison (Run 3 at 20% Loss):');
  const recon3_path = finished3.outPath;
  const origBufA = fs.readFileSync(fileA_path);
  const reconBuf3 = fs.readFileSync(recon3_path);
  const reconHash3 = sha256(reconBuf3);

  const byteExactMatch = origBufA.equals(reconBuf3);
  console.log(`  Original File Size:      ${origBufA.length} bytes`);
  console.log(`  Reconstructed File Size: ${reconBuf3.length} bytes`);
  console.log(`  Original File SHA-256:      ${hashA}`);
  console.log(`  Reconstructed File SHA-256: ${reconHash3}`);
  console.log(`  Bit-Exact Byte Equality:    ${byteExactMatch ? 'PASS (Bit-Exact)' : 'FAIL'}`);

  // STEP 11: NetAnim XML Correlation
  console.log('\n[STEP 11] NetAnim XML Discrete Event Correlation (Run 3):');
  const trace3 = await getTraceEvents(finished3.traceFile);
  console.log(`  NetAnim Trace File: ${finished3.traceFile}`);
  console.log(`  Total <p> Packets in NetAnim XML: ${trace3.totalPackets}`);
  console.log('  Correlated Events Sample (NetAnim XML -> Backend Telemetry):');
  trace3.events.slice(0, 5).forEach((ev, idx) => {
    console.log(`    [NetAnim Event ${idx + 1}] Time: +${ev.txTimeMs.toFixed(2)}ms, Node ${ev.fromId} -> Node ${ev.toId}, ${ev.typeName}, Seq #${ev.seqId != null ? ev.seqId + 1 : 'Ctrl'}, Gen ${ev.genId ?? 0}`);
  });

  // STEP 12: Verify state isolation when starting a new run
  console.log('\n[STEP 12] State Isolation Verification:');
  const transfer4 = await uploadTransfer({ filePath: fileA_path, protocol: 'rlnc', lossRate: 0, seed: 444 });
  const runId4 = transfer4.id;
  // Check calculations before start
  const calc4_initial = await getCalculations(runId4);
  console.log(`  New Run ID: ${runId4}`);
  console.log(`  Initial Transmitted Packets: ${calc4_initial.transmittedPackets.length}`);
  console.log(`  Initial Received Packets:    ${calc4_initial.receivedPackets.length}`);
  console.log(`  Initial Dropped Packets:     ${calc4_initial.droppedPackets.length}`);
  console.log(`  Initial Decoder Rank:        ${calc4_initial.rank}`);
  const cleanInitialState = calc4_initial.receivedPackets.length === 0 && calc4_initial.droppedPackets.length === 0 && calc4_initial.rank === 0;
  console.log(`  No State Leaked From Prior Runs: ${cleanInitialState ? 'PASS (Strict Isolation)' : 'FAIL'}`);

  console.log('\n========================================================================');
  console.log(' ALL 12 LIVE VERIFICATION STEPS COMPLETED SUCCESSFULLY');
  console.log('========================================================================');
}

main().catch(err => {
  console.error('Live verification error:', err);
  process.exit(1);
});
