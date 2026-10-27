const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(ROOT_DIR, 'results');
const NS3_BIN = '/home/muthu/ns-allinone-3.41/ns-3.41/build/scratch/netcode-rft/ns3.41-netcode-rft-default';

if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return '';
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256Buf(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function runSim({ protocol, loss, file, out, trace, seed = 1, K = 4, redundancy = 2, stopTime = 20.0 }) {
  const wslFile = `/mnt/f/CN_project/netcode-rft/${path.relative(ROOT_DIR, file).replace(/\\/g, '/')}`;
  const wslOut = `/mnt/f/CN_project/netcode-rft/${path.relative(ROOT_DIR, out).replace(/\\/g, '/')}`;
  const wslTrace = `/mnt/f/CN_project/netcode-rft/${path.relative(ROOT_DIR, trace).replace(/\\/g, '/')}`;

  const args = [
    NS3_BIN,
    `--protocol=${protocol.toUpperCase()}`,
    `--loss=${loss}`,
    `--delay=20ms`,
    `--bandwidth=10Mbps`,
    `--file=${wslFile}`,
    `--out=${wslOut}`,
    `--trace=${wslTrace}`,
    `--k=${K}`,
    `--block-size=1024`,
    `--redundancy=${redundancy}`,
    `--seed=${seed}`,
    `--stop-time=${stopTime}`,
  ];

  const res = spawnSync('wsl', args, { encoding: 'utf8' });
  const stdout = res.stdout || '';

  // Parse events and metrics
  const events = [];
  let metrics = null;
  const lines = stdout.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('EVENT_JSON:')) {
      try {
        events.push(JSON.parse(trimmed.slice(11)));
      } catch (_) {}
    } else if (trimmed.startsWith('METRICS_JSON:')) {
      try {
        metrics = JSON.parse(trimmed.slice(13));
      } catch (_) {}
    }
  }

  return { code: res.status, events, metrics, stdout };
}

console.log('================================================================');
console.log(' NETCODE-RFT PHASE 7 COMPREHENSIVE MULTI-SCENARIO VERIFICATION');
console.log('================================================================\n');

const results = [];

// SCENARIO 1: Empty file (0 bytes)
{
  const emptyFile = path.join(RESULTS_DIR, 'test_scenario_1_empty.bin');
  const emptyOut = path.join(RESULTS_DIR, 'test_scenario_1_empty.out');
  const emptyTrace = path.join(RESULTS_DIR, 'test_scenario_1_empty_trace.xml');
  fs.writeFileSync(emptyFile, Buffer.alloc(0));
  try { fs.unlinkSync(emptyOut); } catch (_) {}

  const origHash = sha256Buf(Buffer.alloc(0));
  const sim = runSim({ protocol: 'rlnc', loss: 0, file: emptyFile, out: emptyOut, trace: emptyTrace });
  const reconHash = sha256File(emptyOut);
  const pass = sim.code === 0 && reconHash === origHash && (!sim.metrics || sim.metrics.file_size_bytes === 0);

  results.push({
    scenario: '1. Empty File (0 Bytes)',
    protocol: 'RLNC',
    loss: '0%',
    origHash,
    reconHash,
    status: pass ? 'PASS' : 'FAIL',
    details: `Bytes: 0, SHA: ${origHash.slice(0, 16)}..., Recon Match: ${reconHash === origHash}`,
  });
  console.log(`[Scenario 1] Empty File: ${pass ? 'PASS' : 'FAIL'}`);
}

// SCENARIO 2: Small text file (128 bytes)
{
  const textFile = path.join(RESULTS_DIR, 'test_scenario_2_small.txt');
  const textOut = path.join(RESULTS_DIR, 'test_scenario_2_small.out');
  const textTrace = path.join(RESULTS_DIR, 'test_scenario_2_small_trace.xml');
  const content = 'NetCode-RFT Small Text Verification: Testing RLNC systematic transmission with sub-block payload.';
  fs.writeFileSync(textFile, content);
  try { fs.unlinkSync(textOut); } catch (_) {}

  const origHash = sha256File(textFile);
  const sim = runSim({ protocol: 'rlnc', loss: 0, file: textFile, out: textOut, trace: textTrace });
  const reconHash = sha256File(textOut);
  const pass = sim.code === 0 && reconHash === origHash;

  results.push({
    scenario: '2. Small Text File (128B)',
    protocol: 'RLNC',
    loss: '0%',
    origHash,
    reconHash,
    status: pass ? 'PASS' : 'FAIL',
    details: `Bytes: ${Buffer.byteLength(content)}, SHA Match: ${reconHash === origHash}`,
  });
  console.log(`[Scenario 2] Small Text File: ${pass ? 'PASS' : 'FAIL'}`);
}

// SCENARIO 3: Binary file (4096 bytes)
{
  const binFile = path.join(RESULTS_DIR, 'test_scenario_3_binary.bin');
  const binOut = path.join(RESULTS_DIR, 'test_scenario_3_binary.out');
  const binTrace = path.join(RESULTS_DIR, 'test_scenario_3_binary_trace.xml');
  const buf = Buffer.alloc(4096);
  for (let i = 0; i < 4096; i++) buf[i] = (i * 37 + 19) % 256;
  fs.writeFileSync(binFile, buf);
  try { fs.unlinkSync(binOut); } catch (_) {}

  const origHash = sha256Buf(buf);
  const sim = runSim({ protocol: 'rlnc', loss: 10, file: binFile, out: binOut, trace: binTrace, seed: 101 });
  const reconHash = sha256File(binOut);
  const pass = sim.code === 0 && reconHash === origHash;

  results.push({
    scenario: '3. Binary File (4KB)',
    protocol: 'RLNC',
    loss: '10%',
    origHash,
    reconHash,
    status: pass ? 'PASS' : 'FAIL',
    details: `Bytes: 4096, Loss: 10%, SHA Match: ${reconHash === origHash}`,
  });
  console.log(`[Scenario 3] Binary File (10% Loss): ${pass ? 'PASS' : 'FAIL'}`);
}

// SCENARIO 4: Two different files with identical size (4096 bytes)
{
  const fileA = path.join(RESULTS_DIR, 'test_scenario_4_fileA.bin');
  const fileB = path.join(RESULTS_DIR, 'test_scenario_4_fileB.bin');
  const outA = path.join(RESULTS_DIR, 'test_scenario_4_fileA.out');
  const outB = path.join(RESULTS_DIR, 'test_scenario_4_fileB.out');
  const traceA = path.join(RESULTS_DIR, 'test_scenario_4_traceA.xml');
  const traceB = path.join(RESULTS_DIR, 'test_scenario_4_traceB.xml');

  const bufA = Buffer.alloc(4096, 0x33);
  const bufB = Buffer.alloc(4096, 0xCC);
  fs.writeFileSync(fileA, bufA);
  fs.writeFileSync(fileB, bufB);

  const hashA = sha256Buf(bufA);
  const hashB = sha256Buf(bufB);

  const simA = runSim({ protocol: 'rlnc', loss: 0, file: fileA, out: outA, trace: traceA });
  const simB = runSim({ protocol: 'rlnc', loss: 0, file: fileB, out: outB, trace: traceB });

  const reconA = sha256File(outA);
  const reconB = sha256File(outB);

  const pass = (hashA !== hashB) && (reconA === hashA) && (reconB === hashB);

  // Check data previews in events
  const rxEventA = simA.events.find(e => e.type === 'packet_received' && e.seq_id === 0);
  const rxEventB = simB.events.find(e => e.type === 'packet_received' && e.seq_id === 0);
  const distinctPayloads = rxEventA && rxEventB && JSON.stringify(rxEventA.data_preview) !== JSON.stringify(rxEventB.data_preview);

  results.push({
    scenario: '4. Two Same-Size Different Files (4KB each)',
    protocol: 'RLNC',
    loss: '0%',
    origHash: `A: ${hashA.slice(0, 12)}... | B: ${hashB.slice(0, 12)}...`,
    reconHash: `A: ${reconA.slice(0, 12)}... | B: ${reconB.slice(0, 12)}...`,
    status: (pass && distinctPayloads) ? 'PASS' : 'FAIL',
    details: `Distinct Source Hashes: ${hashA !== hashB}, Distinct Packet Payloads: ${distinctPayloads}`,
  });
  console.log(`[Scenario 4] Two Same-Size Different Files: ${(pass && distinctPayloads) ? 'PASS' : 'FAIL'}`);
}

// SCENARIO 5: Larger file (8192 bytes, 2 full generations)
{
  const largeFile = path.join(RESULTS_DIR, 'test_scenario_5_large.bin');
  const largeOut = path.join(RESULTS_DIR, 'test_scenario_5_large.out');
  const largeTrace = path.join(RESULTS_DIR, 'test_scenario_5_large_trace.xml');
  const buf = Buffer.alloc(8192);
  for (let i = 0; i < 8192; i++) buf[i] = (i * 7 + 103) % 256;
  fs.writeFileSync(largeFile, buf);

  const origHash = sha256Buf(buf);
  const sim = runSim({ protocol: 'rlnc', loss: 5, file: largeFile, out: largeOut, trace: largeTrace, seed: 777 });
  const reconHash = sha256File(largeOut);
  const pass = sim.code === 0 && reconHash === origHash;

  results.push({
    scenario: '5. Larger File (8KB, 2 Generations)',
    protocol: 'RLNC',
    loss: '5%',
    origHash,
    reconHash,
    status: pass ? 'PASS' : 'FAIL',
    details: `Generations Decoded: ${sim.metrics?.decoded_generations ?? 2}, SHA Match: ${reconHash === origHash}`,
  });
  console.log(`[Scenario 5] Larger File (8KB): ${pass ? 'PASS' : 'FAIL'}`);
}

// SCENARIO 6: RLNC vs RUDP at 15% loss
{
  const compFile = path.join(RESULTS_DIR, 'test_scenario_6_comp.bin');
  const rlncOut = path.join(RESULTS_DIR, 'test_scenario_6_rlnc.out');
  const rudpOut = path.join(RESULTS_DIR, 'test_scenario_6_rudp.out');
  const rlncTrace = path.join(RESULTS_DIR, 'test_scenario_6_rlnc_trace.xml');
  const rudpTrace = path.join(RESULTS_DIR, 'test_scenario_6_rudp_trace.xml');

  const buf = Buffer.alloc(4096);
  for (let i = 0; i < 4096; i++) buf[i] = (i * 41 + 17) % 256;
  fs.writeFileSync(compFile, buf);

  const origHash = sha256Buf(buf);
  const rlncSim = runSim({ protocol: 'rlnc', loss: 15, file: compFile, out: rlncOut, trace: rlncTrace, seed: 42 });
  const rudpSim = runSim({ protocol: 'rudp', loss: 15, file: compFile, out: rudpOut, trace: rudpTrace, seed: 42 });

  const rlncRecon = sha256File(rlncOut);
  const rudpRecon = sha256File(rudpOut);

  const pass = (rlncRecon === origHash) && (rudpRecon === origHash);

  results.push({
    scenario: '6. RLNC vs RUDP at 15% Loss',
    protocol: 'RLNC & RUDP',
    loss: '15%',
    origHash,
    reconHash: `RLNC: ${rlncRecon.slice(0, 10)}... | RUDP: ${rudpRecon.slice(0, 10)}...`,
    status: pass ? 'PASS' : 'FAIL',
    details: `RLNC Duration: ${rlncSim.metrics?.sim_time_sec}s, RUDP Duration: ${rudpSim.metrics?.sim_time_sec}s, Both Verified: ${pass}`,
  });
  console.log(`[Scenario 6] RLNC vs RUDP (15% Loss): ${pass ? 'PASS' : 'FAIL'}`);
}

// SCENARIO 7: Multi-Loss Matrix (0%, 5%, 10%, 20%, 30%) for RLNC
const lossRates = [0, 5, 10, 20, 30];
for (const loss of lossRates) {
  const file = path.join(RESULTS_DIR, `test_scenario_7_loss${loss}.bin`);
  const out = path.join(RESULTS_DIR, `test_scenario_7_loss${loss}.out`);
  const trace = path.join(RESULTS_DIR, `test_scenario_7_loss${loss}_trace.xml`);

  const buf = Buffer.alloc(4096);
  for (let i = 0; i < 4096; i++) buf[i] = (i * 19 + loss) % 256;
  fs.writeFileSync(file, buf);

  const origHash = sha256Buf(buf);
  const sim = runSim({ protocol: 'rlnc', loss, file, out, trace, seed: 1000 + loss });
  const reconHash = sha256File(out);

  // Precision check at 0% loss: forward drops must be exactly 0
  const dropsValid = loss === 0 ? (sim.metrics?.forward_phy_drops === 0) : true;
  const pass = sim.code === 0 && reconHash === origHash && dropsValid;

  results.push({
    scenario: `7. Configured Loss ${loss}% (RLNC)`,
    protocol: 'RLNC',
    loss: `${loss}%`,
    origHash,
    reconHash,
    status: pass ? 'PASS' : 'FAIL',
    details: `Forward Drops: ${sim.metrics?.forward_phy_drops}, Reverse Drops: ${sim.metrics?.reverse_phy_drops}, Verified: ${reconHash === origHash}`,
  });
  console.log(`[Scenario 7] Loss ${loss}%: ${pass ? 'PASS' : 'FAIL'} (Forward Drops: ${sim.metrics?.forward_phy_drops})`);
}

// SCENARIO 8: Repeated runs with different random seeds
{
  const file = path.join(RESULTS_DIR, 'test_scenario_8_seed.bin');
  const out1 = path.join(RESULTS_DIR, 'test_scenario_8_seed1.out');
  const out2 = path.join(RESULTS_DIR, 'test_scenario_8_seed2.out');
  const trace1 = path.join(RESULTS_DIR, 'test_scenario_8_seed1_trace.xml');
  const trace2 = path.join(RESULTS_DIR, 'test_scenario_8_seed2_trace.xml');

  const buf = Buffer.alloc(4096);
  for (let i = 0; i < 4096; i++) buf[i] = (i * 23 + 47) % 256;
  fs.writeFileSync(file, buf);

  const origHash = sha256Buf(buf);
  const sim1 = runSim({ protocol: 'rlnc', loss: 20, file, out: out1, trace: trace1, seed: 1111 });
  const sim2 = runSim({ protocol: 'rlnc', loss: 20, file, out: out2, trace: trace2, seed: 9999 });

  const recon1 = sha256File(out1);
  const recon2 = sha256File(out2);

  const pass = (recon1 === origHash) && (recon2 === origHash);

  // Check that coded packet coefficients differ between seed 1111 and seed 9999
  const codedPkt1 = sim1.events.find(e => e.type === 'packet_transmitted' && e.coded);
  const codedPkt2 = sim2.events.find(e => e.type === 'packet_transmitted' && e.coded);
  const differentCoeffs = codedPkt1 && codedPkt2 && JSON.stringify(codedPkt1.coeffs) !== JSON.stringify(codedPkt2.coeffs);

  results.push({
    scenario: '8. Repeated Runs with Different Seeds (Seed 1111 vs 9999)',
    protocol: 'RLNC',
    loss: '20%',
    origHash,
    reconHash: `Run 1: ${recon1.slice(0, 10)}... | Run 2: ${recon2.slice(0, 10)}...`,
    status: pass ? 'PASS' : 'FAIL',
    details: `Both Reconstructed: ${pass}, Distinct Generated Coefficients: ${differentCoeffs}`,
  });
  console.log(`[Scenario 8] Seeds 1111 vs 9999: ${pass ? 'PASS' : 'FAIL'} (Distinct Coeffs: ${differentCoeffs})`);
}

// SCENARIO 9: Fresh run immediately after another run (State isolation)
{
  const file1 = path.join(RESULTS_DIR, 'test_scenario_9_run1.bin');
  const file2 = path.join(RESULTS_DIR, 'test_scenario_9_run2.bin');
  const out1 = path.join(RESULTS_DIR, 'test_scenario_9_run1.out');
  const out2 = path.join(RESULTS_DIR, 'test_scenario_9_run2.out');
  const trace1 = path.join(RESULTS_DIR, 'test_scenario_9_run1_trace.xml');
  const trace2 = path.join(RESULTS_DIR, 'test_scenario_9_run2_trace.xml');

  fs.writeFileSync(file1, Buffer.alloc(2048, 0x11));
  fs.writeFileSync(file2, Buffer.alloc(3072, 0x22));

  const sim1 = runSim({ protocol: 'rlnc', loss: 20, file: file1, out: out1, trace: trace1, seed: 10 });
  const sim2 = runSim({ protocol: 'rlnc', loss: 0, file: file2, out: out2, trace: trace2, seed: 20 });

  const recon1 = sha256File(out1);
  const recon2 = sha256File(out2);

  const pass1 = recon1 === sha256Buf(Buffer.alloc(2048, 0x11));
  const pass2 = recon2 === sha256Buf(Buffer.alloc(3072, 0x22));
  const pass = pass1 && pass2 && sim2.metrics.forward_phy_drops === 0;

  results.push({
    scenario: '9. Fresh Run Immediately After Prior Run (State Isolation)',
    protocol: 'RLNC',
    loss: '20% then 0%',
    origHash: 'Run 1 (2KB) -> Run 2 (3KB)',
    reconHash: `Run 1: ${recon1.slice(0, 10)}... | Run 2: ${recon2.slice(0, 10)}...`,
    status: pass ? 'PASS' : 'FAIL',
    details: `Prior run had drops, subsequent 0% run strictly isolated with 0 forward drops: ${sim2.metrics?.forward_phy_drops === 0}`,
  });
  console.log(`[Scenario 9] Fresh Run Isolation: ${pass ? 'PASS' : 'FAIL'}`);
}

// Print final summary table
console.log('\n================================================================');
console.log(' PHASE 7 COMPREHENSIVE VERIFICATION RESULTS');
console.log('================================================================\n');

let allPassed = true;
for (const r of results) {
  const mark = r.status === 'PASS' ? '✔' : '✖';
  if (r.status !== 'PASS') allPassed = false;
  console.log(`${mark} ${r.scenario.padEnd(45)} | ${r.protocol.padEnd(12)} | ${r.loss.padEnd(5)} | ${r.status}`);
  console.log(`   Details: ${r.details}`);
}

console.log('\n================================================================');
console.log(`TOTAL SCENARIOS TESTED: ${results.length}`);
console.log(`FINAL RESULT: ${allPassed ? 'ALL TESTS PASSED WITH CRYPTOGRAPHIC VERIFICATION' : 'FAILURES DETECTED'}`);
console.log('================================================================\n');

process.exit(allPassed ? 0 : 1);
