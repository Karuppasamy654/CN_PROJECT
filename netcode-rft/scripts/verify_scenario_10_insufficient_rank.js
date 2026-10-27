const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(ROOT_DIR, 'results');
const NS3_BIN = '/home/muthu/ns-allinone-3.41/ns-3.41/build/scratch/netcode-rft/ns3.41-netcode-rft-default';

const file = path.join(RESULTS_DIR, 'test_scenario_10_incomplete.bin');
const out = path.join(RESULTS_DIR, 'test_scenario_10_incomplete.out');
const trace = path.join(RESULTS_DIR, 'test_scenario_10_incomplete_trace.xml');

// 4KB file, K=4, 0 redundancy, stop time 0.035s (stops before sender can send enough packets or recover from drops)
const buf = Buffer.alloc(4096, 0x77);
fs.writeFileSync(file, buf);
try { fs.unlinkSync(out); } catch (_) {}

const wslFile = `/mnt/f/CN_project/netcode-rft/${path.relative(ROOT_DIR, file).replace(/\\/g, '/')}`;
const wslOut = `/mnt/f/CN_project/netcode-rft/${path.relative(ROOT_DIR, out).replace(/\\/g, '/')}`;
const wslTrace = `/mnt/f/CN_project/netcode-rft/${path.relative(ROOT_DIR, trace).replace(/\\/g, '/')}`;

const args = [
  NS3_BIN,
  '--protocol=RLNC',
  '--loss=30',
  '--delay=20ms',
  '--bandwidth=10Mbps',
  `--file=${wslFile}`,
  `--out=${wslOut}`,
  `--trace=${wslTrace}`,
  '--k=4',
  '--block-size=1024',
  '--redundancy=0',
  '--stop-time=0.035',
  '--seed=42',
];

const res = spawnSync('wsl', args, { encoding: 'utf8' });
let metrics = null;
for (const line of (res.stdout || '').split('\n')) {
  if (line.trim().startsWith('METRICS_JSON:')) {
    try { metrics = JSON.parse(line.trim().slice(13)); } catch (_) {}
  }
}

const outExists = fs.existsSync(out);
console.log('NS-3 Exit Code:', res.status);
console.log('Metrics Success:', metrics?.success);
console.log('Integrity Verified:', metrics?.integrity_verified);
console.log('Data Packets Received:', metrics?.data_packets_received);
console.log('Total Innovative (Rank):', metrics?.total_innovative);
console.log('Output file exists on failure:', outExists);

const pass = metrics && metrics.success === false && metrics.integrity_verified === false && (!outExists || fs.statSync(out).size === 0);
console.log('Scenario 10 (Insufficient Rank Fails Correctly):', pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
