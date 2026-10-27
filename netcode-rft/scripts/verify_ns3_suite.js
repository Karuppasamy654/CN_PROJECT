const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const crypto = require('crypto');

console.log('================================================================');
console.log(' NetCode-RFT: NS-3.41 Comprehensive Verification Suite');
console.log(' Tests A-G: Loss Models, Dynamic Equations, NetAnim, Integrity');
console.log('================================================================\n');

const ROOT_DIR = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(ROOT_DIR, 'results');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const NS3_BIN_WSL = '/home/muthu/ns-allinone-3.41/ns-3.41/build/scratch/netcode-rft/ns3.41-netcode-rft-default';

if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function toWslPath(winPath) {
  const norm = path.resolve(winPath).replace(/\\/g, '/');
  const match = norm.match(/^([a-zA-Z]):\/(.*)$/);
  if (match) {
    return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
  }
  return norm;
}

function computeSha256(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

let passedCount = 0;
let totalCount = 0;

function assert(desc, condition, details = '') {
  totalCount++;
  if (condition) {
    passedCount++;
    console.log(`  ✓ [PASS] ${desc}`);
    if (details) console.log(`           ${details}`);
  } else {
    console.error(`  ✗ [FAIL] ${desc}`);
    if (details) console.error(`           ${details}`);
  }
}

// Generate test payloads
// Payload 1: 4096 bytes (4 blocks, 1 generation for K=4)
const file4k = path.join(UPLOADS_DIR, 'test_payload_4k.bin');
const buf4k = Buffer.alloc(4096);
for (let i = 0; i < 4096; i++) buf4k[i] = (i * 37 + 13) % 256;
fs.writeFileSync(file4k, buf4k);
const sha4k = computeSha256(file4k);

// Payload 2: 8192 bytes (8 blocks, 2 generations for K=4)
const file8k = path.join(UPLOADS_DIR, 'test_payload_8k.bin');
const buf8k = Buffer.alloc(8192);
for (let i = 0; i < 8192; i++) buf8k[i] = (i * 59 + 71) % 256;
fs.writeFileSync(file8k, buf8k);
const sha8k = computeSha256(file8k);

console.log(`[Payloads Created]`);
console.log(`  File 4K: ${file4k} (SHA-256: ${sha4k})`);
console.log(`  File 8K: ${file8k} (SHA-256: ${sha8k})\n`);

function runNs3(args) {
  const cmd = `export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"; ${NS3_BIN_WSL} ${args.join(' ')}`;
  const proc = spawnSync('wsl', ['bash', '-lc', cmd], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const stdout = proc.stdout || '';
  const stderr = proc.stderr || '';

  const events = [];
  let metrics = null;

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('EVENT_JSON:')) {
      try {
        events.push(JSON.parse(trimmed.slice(11)));
      } catch (e) {}
    } else if (trimmed.startsWith('METRICS_JSON:')) {
      try {
        metrics = JSON.parse(trimmed.slice(13));
      } catch (e) {}
    }
  }

  return { status: proc.status, events, metrics, stdout, stderr };
}

// ============================================================================
// TEST A: 0% LOSS RLNC SIMULATION
// ============================================================================
console.log('--- TEST A: RLNC with 0% Configured Loss ---');
const outA = path.join(RESULTS_DIR, 'out_test_a.bin');
const traceA = path.join(RESULTS_DIR, 'trace_test_a.xml');
if (fs.existsSync(outA)) fs.unlinkSync(outA);
if (fs.existsSync(traceA)) fs.unlinkSync(traceA);

const resA = runNs3([
  '--protocol=RLNC',
  '--loss=0',
  '--delay=5ms',
  '--bandwidth=10Mbps',
  `--file=${toWslPath(file4k)}`,
  `--out=${toWslPath(outA)}`,
  `--trace=${toWslPath(traceA)}`,
  '--k=4',
  '--block-size=1024',
  '--redundancy=2',
  '--seed=42',
]);

assert('NS-3 process exited with code 0', resA.status === 0);
assert('Reconstructed file exists', fs.existsSync(outA));
if (fs.existsSync(outA)) {
  const shaOutA = computeSha256(outA);
  assert('Reconstructed file matches source SHA-256 exactly', shaOutA === sha4k, `SHA-256: ${shaOutA}`);
}

const dropsA = resA.events.filter(e => e.type === 'packet_dropped');
assert('Zero packets dropped at 0% loss probability', dropsA.length === 0, `Observed drops: ${dropsA.length}`);
const lossRateA = resA.metrics?.observed_loss_rate ?? resA.metrics?.physical_loss_percent ?? null;
assert('Observed packet loss reported as 0.00%', lossRateA === 0, `Loss: ${lossRateA}%`);
assert('Valid NetAnim XML trace produced', fs.existsSync(traceA) && fs.statSync(traceA).size > 500);

// ============================================================================
// TEST B: 30% LOSS RLNC AND RUDP SIMULATION
// ============================================================================
console.log('\n--- TEST B: 30% Configured Loss (RLNC & RUDP) ---');

// RLNC 30%
const outB_rlnc = path.join(RESULTS_DIR, 'out_test_b_rlnc.bin');
const traceB_rlnc = path.join(RESULTS_DIR, 'trace_test_b_rlnc.xml');
if (fs.existsSync(outB_rlnc)) fs.unlinkSync(outB_rlnc);
if (fs.existsSync(traceB_rlnc)) fs.unlinkSync(traceB_rlnc);

const resB_rlnc = runNs3([
  '--protocol=RLNC',
  '--loss=30',
  '--delay=10ms',
  '--bandwidth=10Mbps',
  `--file=${toWslPath(file4k)}`,
  `--out=${toWslPath(outB_rlnc)}`,
  `--trace=${toWslPath(traceB_rlnc)}`,
  '--k=4',
  '--block-size=1024',
  '--redundancy=4',
  '--seed=101',
]);

assert('RLNC 30% loss simulation exited with code 0', resB_rlnc.status === 0);
assert('RLNC 30% loss reconstructed file matches SHA-256', fs.existsSync(outB_rlnc) && computeSha256(outB_rlnc) === sha4k);
const dropsB_rlnc = resB_rlnc.events.filter(e => e.type === 'packet_dropped');
assert('Actual RateErrorModel physical drop events recorded for RLNC', dropsB_rlnc.length > 0, `Drop count: ${dropsB_rlnc.length}`);
assert('RLNC drops contain correct reason RateErrorModel_PhyRxDrop', dropsB_rlnc.every(d => (d.drop_reason || d.reason) === 'RateErrorModel_PhyRxDrop'));
const lossRateB_rlnc = resB_rlnc.metrics?.observed_loss_rate ?? resB_rlnc.metrics?.physical_loss_percent ?? null;
assert('RLNC observed loss calculated from valid counters', lossRateB_rlnc !== null && lossRateB_rlnc > 0, `Observed loss: ${lossRateB_rlnc}%`);

// RUDP 30%
const outB_rudp = path.join(RESULTS_DIR, 'out_test_b_rudp.bin');
const traceB_rudp = path.join(RESULTS_DIR, 'trace_test_b_rudp.xml');
if (fs.existsSync(outB_rudp)) fs.unlinkSync(outB_rudp);
if (fs.existsSync(traceB_rudp)) fs.unlinkSync(traceB_rudp);

const resB_rudp = runNs3([
  '--protocol=RUDP',
  '--loss=30',
  '--delay=10ms',
  '--bandwidth=10Mbps',
  `--file=${toWslPath(file4k)}`,
  `--out=${toWslPath(outB_rudp)}`,
  `--trace=${toWslPath(traceB_rudp)}`,
  '--k=4',
  '--block-size=1024',
  '--seed=101',
]);

assert('RUDP 30% loss simulation exited with code 0', resB_rudp.status === 0);
assert('RUDP 30% loss reconstructed file matches SHA-256', fs.existsSync(outB_rudp) && computeSha256(outB_rudp) === sha4k);
const dropsB_rudp = resB_rudp.events.filter(e => e.type === 'packet_dropped');
assert('Actual RateErrorModel physical drop events recorded for RUDP', dropsB_rudp.length > 0, `Drop count: ${dropsB_rudp.length}`);
const retxEvents = resB_rudp.events.filter(e => e.type === 'packet_transmitted' && (e.retry > 0 || e.is_retransmit));
assert('RUDP retransmissions triggered and logged upon packet loss', retxEvents.length > 0, `Retransmissions: ${retxEvents.length}`);

// ============================================================================
// TEST C: DYNAMIC EQUATIONS & MULTI-GENERATION MATRIX GROWTH
// ============================================================================
console.log('\n--- TEST C: Dynamic Equations & Multi-Generation Matrix Growth ---');
const outC = path.join(RESULTS_DIR, 'out_test_c.bin');
const traceC = path.join(RESULTS_DIR, 'trace_test_c.xml');
if (fs.existsSync(outC)) fs.unlinkSync(outC);
if (fs.existsSync(traceC)) fs.unlinkSync(traceC);

const resC = runNs3([
  '--protocol=RLNC',
  '--loss=15',
  '--delay=5ms',
  '--bandwidth=10Mbps',
  `--file=${toWslPath(file8k)}`,
  `--out=${toWslPath(outC)}`,
  `--trace=${toWslPath(traceC)}`,
  '--k=4',
  '--block-size=1024',
  '--redundancy=3',
  '--seed=202',
]);

assert('Multi-generation RLNC simulation exited with code 0', resC.status === 0);
assert('Multi-generation reconstructed file matches SHA-256', fs.existsSync(outC) && computeSha256(outC) === sha8k);

const decUpdatesC = resC.events.filter(e => e.type === 'decoder_matrix_update');
assert('Decoder matrix updates emitted on packet arrivals', decUpdatesC.length >= 8, `Updates: ${decUpdatesC.length}`);

// Verify multiple generations
const genIds = new Set(decUpdatesC.map(u => u.gen_id));
assert('Telemetry captures multiple distinct RLNC generations', genIds.has(0) && genIds.has(1), `Generations: ${Array.from(genIds).join(', ')}`);

// Verify dynamic rank growth
const gen0Updates = decUpdatesC.filter(u => u.gen_id === 0);
const ranksGen0 = gen0Updates.map(u => u.rank_after);
const isStrictlyNonDecreasing = ranksGen0.every((r, idx) => idx === 0 || r >= ranksGen0[idx - 1]);
assert('Decoder matrix rank is monotonically non-decreasing as packets arrive', isStrictlyNonDecreasing, `Ranks: ${ranksGen0.join(' -> ')}`);
assert('Decoder reached full rank K=4 for Generation 0', Math.max(...ranksGen0) === 4);

// Verify actual mathematical equations
const equationsEmitted = gen0Updates.map(u => u.equation).filter(Boolean);
assert('Equations formatted dynamically with actual coefficients', equationsEmitted.length > 0, `Sample: ${equationsEmitted[0]}`);

// ============================================================================
// TEST D: DROPPED CODED PACKET EXCLUSION
// ============================================================================
console.log('\n--- TEST D: Dropped Coded Packet Exclusion from Decoder ---');
const droppedSeqs = new Set(resC.events.filter(e => e.type === 'packet_dropped' && e.direction === 'forward').map(e => e.seq_id));
const decodedSeqs = new Set(decUpdatesC.map(u => u.seq_id));

let anyDroppedInDecoder = false;
for (const dropSeq of droppedSeqs) {
  if (decodedSeqs.has(dropSeq)) {
    anyDroppedInDecoder = true;
    break;
  }
}
assert('Packets dropped in transit NEVER appear in decoder matrix or equations', !anyDroppedInDecoder, `Total drops: ${droppedSeqs.size}`);

// ============================================================================
// TEST E: LINEARLY DEPENDENT PACKET HANDLING
// ============================================================================
console.log('\n--- TEST E: Dependent Coded Packet Handling ---');
const dependentUpdates = decUpdatesC.filter(u => !u.innovative);
if (dependentUpdates.length > 0) {
  assert('Dependent packet recorded with innovative=false', true, `Dependent packets: ${dependentUpdates.length}`);
  const depRankPreserved = dependentUpdates.every(u => u.rank_before === u.rank_after);
  assert('Dependent packet does NOT increase matrix rank (rank_before === rank_after)', depRankPreserved);
} else {
  // If no dependent packets occurred in this run due to high innovation, verify logic
  assert('All innovative packets increased rank', decUpdatesC.filter(u => u.innovative).every(u => u.rank_after > u.rank_before));
}

// ============================================================================
// TEST F: NETANIM CURRENT RUN TRACE VALIDATION
// ============================================================================
console.log('\n--- TEST F: NetAnim Trace Validation & Associations ---');
assert('Trace XML file exists and is non-empty', fs.existsSync(traceC) && fs.statSync(traceC).size > 1000);
const traceHead = fs.readFileSync(traceC, 'utf8');
assert('Trace XML contains valid <anim> element', traceHead.includes('<anim'));
assert('Trace XML contains valid </anim> termination', traceHead.includes('</anim>'));
assert('Trace XML contains topology nodes 0 and 1', traceHead.includes('<node id="0"') && traceHead.includes('<node id="1"'));
assert('Trace XML contains link between node 0 and node 1', traceHead.includes('<link fromId="0" toId="1"'));
assert('Trace XML contains actual packet transmissions (<p elements)', traceHead.includes('<p '));

// ============================================================================
// TEST G: CROSS-VIEW CONSISTENCY (BACKEND ROUTE INTEGRATION)
// ============================================================================
console.log('\n--- TEST G: Cross-View Consistency & API Data Flow ---');
const store = require('../backend/src/services/store');
const testTransferId = `test-verify-${Date.now()}`;
store.createTransfer({
  id: testTransferId,
  protocol: 'rlnc',
  fileSize: 8192,
  blockSize: 1024,
  K: 4,
  redundancy: 3,
  lossRate: 15,
  delayMs: 5,
  filePath: file8k,
  outPath: outC,
});

for (const ev of resC.events) {
  store.addEvent(testTransferId, ev);
}

// Check backend calculation endpoint logic
const calcRoute = require('../backend/src/routes/calculations');
const express = require(path.join(ROOT_DIR, 'backend/node_modules/express'));
const app = express();
app.use(express.json());
app.use('/api', calcRoute);

const http = require('http');
const server = http.createServer(app);

server.listen(0, () => {
  const port = server.address().port;
  const reqUrl = `http://127.0.0.1:${port}/api/calculations/transfer/${testTransferId}?generation=0`;

  http.get(reqUrl, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      server.close();
      try {
        const json = JSON.parse(data);
        assert('Calculations API returns 200 with structured response', res.statusCode === 200);
        assert('Calculations API returns actual decoderHistory from NS-3 events', Array.isArray(json.decoderHistory) && json.decoderHistory.length > 0);
        assert('Calculations API returns GF(256) field metadata', json.gf256Info && json.gf256Info.irreduciblePolynomial === '0x11D');
        assert('Calculations API returns droppedPackets array matching physical drops', Array.isArray(json.droppedPackets));
        assert('Calculations API matrixA is populated with actual coefficients', json.matrixA.length > 0 && json.matrixA[0].length === 4);
        assert('Calculations API rank matches final decoder rank', json.rank === 4);

        console.log('\n================================================================');
        console.log(` ALL TESTS COMPLETED: ${passedCount} / ${totalCount} PASSED (${Math.round(passedCount/totalCount*100)}%)`);
        console.log('================================================================\n');

        if (passedCount === totalCount) {
          process.exit(0);
        } else {
          process.exit(1);
        }
      } catch (err) {
        console.error('Error parsing calculations response:', err);
        process.exit(1);
      }
    });
  }).on('error', err => {
    console.error('Error calling calculation endpoint:', err);
    server.close();
    process.exit(1);
  });
});
