const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(ROOT_DIR, 'results');
const NS3_BIN = '/home/muthu/ns-allinone-3.41/ns-3.41/build/scratch/netcode-rft/ns3.41-netcode-rft-default';

const file = path.join(RESULTS_DIR, 'proof_20loss_input.bin');
const out = path.join(RESULTS_DIR, 'proof_20loss_recon.bin');
const trace = path.join(RESULTS_DIR, 'proof_20loss_trace.xml');

// 4KB file, 4 distinct 1024-byte blocks:
// Block 0: filled with 0x11
// Block 1: filled with 0x22
// Block 2: filled with 0x33
// Block 3: filled with 0x44
const buf = Buffer.alloc(4096);
buf.fill(0x11, 0, 1024);
buf.fill(0x22, 1024, 2048);
buf.fill(0x33, 2048, 3072);
buf.fill(0x44, 3072, 4096);
fs.writeFileSync(file, buf);
try { fs.unlinkSync(out); } catch (_) {}

const origHash = crypto.createHash('sha256').update(buf).digest('hex');

const wslFile = `/mnt/f/CN_project/netcode-rft/${path.relative(ROOT_DIR, file).replace(/\\/g, '/')}`;
const wslOut = `/mnt/f/CN_project/netcode-rft/${path.relative(ROOT_DIR, out).replace(/\\/g, '/')}`;
const wslTrace = `/mnt/f/CN_project/netcode-rft/${path.relative(ROOT_DIR, trace).replace(/\\/g, '/')}`;

// Run NS-3 with seed=333, loss=20, k=4, redundancy=2
const args = [
  NS3_BIN,
  '--protocol=RLNC',
  '--loss=20',
  '--delay=20ms',
  '--bandwidth=10Mbps',
  `--file=${wslFile}`,
  `--out=${wslOut}`,
  `--trace=${wslTrace}`,
  '--k=4',
  '--block-size=1024',
  '--redundancy=2',
  '--seed=333',
  '--stop-time=20.0',
];

const res = spawnSync('wsl', args, { encoding: 'utf8' });
const stdout = res.stdout || '';

const events = [];
let metrics = null;
for (const line of stdout.split('\n')) {
  const trimmed = line.trim();
  if (trimmed.startsWith('EVENT_JSON:')) {
    try { events.push(JSON.parse(trimmed.slice(11))); } catch (_) {}
  } else if (trimmed.startsWith('METRICS_JSON:')) {
    try { metrics = JSON.parse(trimmed.slice(13)); } catch (_) {}
  }
}

const reconBuf = fs.readFileSync(out);
const reconHash = crypto.createHash('sha256').update(reconBuf).digest('hex');

// Read NetAnim XML
const xmlContent = fs.readFileSync(trace, 'utf8');
const pElements = [];
const pRegex = /<p\s+([^>]+)>/g;
let m;
while ((m = pRegex.exec(xmlContent)) !== null) {
  pElements.push(m[0]);
}

console.log(JSON.stringify({
  exitCode: res.status,
  origHash,
  reconHash,
  hashMatch: origHash === reconHash,
  metrics,
  events,
  netanimPackets: pElements,
}, null, 2));
