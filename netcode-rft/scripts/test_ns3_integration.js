const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const crypto = require('crypto');

console.log('================================================================');
console.log(' NetCode-RFT: C11 Networking Engine & Socket Integration Tests');
console.log('================================================================\n');

const ROOT_DIR = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(ROOT_DIR, 'results');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const ENGINE_BIN = path.join(ROOT_DIR, 'engine/bin/netcode_engine');

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

// 1. Create a 4096-byte test binary
const testInputPath = path.join(UPLOADS_DIR, 'test_c_engine_integration.bin');
const testData = Buffer.alloc(4096);
for (let i = 0; i < 4096; i++) {
  testData[i] = (i * 47 + 29) % 256;
}
fs.writeFileSync(testInputPath, testData);
const inputHash = computeSha256(testInputPath);
console.log(`[Setup] Created test input: ${testInputPath} (4096 bytes, SHA-256: ${inputHash})\n`);

let passedTests = 0;
let totalTests = 0;

function assertTest(name, condition, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`✓ [PASS] ${name}`);
    if (details) console.log(`         ${details}`);
  } else {
    console.error(`✗ [FAIL] ${name}`);
    if (details) console.error(`         ${details}`);
  }
}

const ENGINE_BIN_WSL = toWslPath(ENGINE_BIN);

// TEST 1: C11 Engine Executable Check
const checkBin = spawnSync('wsl', ['test', '-x', ENGINE_BIN_WSL]);
assertTest('C11 Engine binary exists and is executable in WSL', checkBin.status === 0, ENGINE_BIN_WSL);

// TEST 2: Zero-Loss RLNC Transfer over UDP
console.log('\n--- Running Zero-Loss RLNC Test over UDP ---');
const rlnc0Out = path.join(RESULTS_DIR, 'test_rlnc0.out');
if (fs.existsSync(rlnc0Out)) fs.unlinkSync(rlnc0Out);

const rlnc0Proc = spawnSync('wsl', [
  ENGINE_BIN_WSL,
  `--transfer-id=test-rlnc-0`,
  `--protocol=rlnc`,
  `--file=${toWslPath(testInputPath)}`,
  `--out=${toWslPath(rlnc0Out)}`,
  `--loss=0`,
  `--delay=5`,
  `--k=4`,
  `--block-size=1024`,
  `--redundancy=2`,
  `--port=9601`,
  `--seed=42`,
  `--role=all`
], { encoding: 'utf8' });

assertTest('RLNC (0% loss) executes with exit code 0', rlnc0Proc.status === 0);
assertTest('RLNC (0% loss) reconstructed file exists', fs.existsSync(rlnc0Out));
if (fs.existsSync(rlnc0Out)) {
  const rlnc0Hash = computeSha256(rlnc0Out);
  assertTest('RLNC (0% loss) SHA-256 byte-exact match', rlnc0Hash === inputHash, `Hash: ${rlnc0Hash}`);
}

// TEST 3: Zero-Loss RUDP Transfer over UDP
console.log('\n--- Running Zero-Loss RUDP Test over UDP ---');
const rudp0Out = path.join(RESULTS_DIR, 'test_rudp0.out');
if (fs.existsSync(rudp0Out)) fs.unlinkSync(rudp0Out);

const rudp0Proc = spawnSync('wsl', [
  ENGINE_BIN_WSL,
  `--transfer-id=test-rudp-0`,
  `--protocol=rudp`,
  `--file=${toWslPath(testInputPath)}`,
  `--out=${toWslPath(rudp0Out)}`,
  `--loss=0`,
  `--delay=5`,
  `--block-size=1024`,
  `--port=9602`,
  `--seed=42`,
  `--role=all`
], { encoding: 'utf8' });

assertTest('RUDP (0% loss) executes with exit code 0', rudp0Proc.status === 0);
assertTest('RUDP (0% loss) reconstructed file exists', fs.existsSync(rudp0Out));
if (fs.existsSync(rudp0Out)) {
  const rudp0Hash = computeSha256(rudp0Out);
  assertTest('RUDP (0% loss) SHA-256 byte-exact match', rudp0Hash === inputHash, `Hash: ${rudp0Hash}`);
}

// TEST 4: Nonzero-Loss RLNC (10% loss)
console.log('\n--- Running Nonzero-Loss RLNC Test (10% Loss) ---');
const rlnc10Out = path.join(RESULTS_DIR, 'test_rlnc10.out');
if (fs.existsSync(rlnc10Out)) fs.unlinkSync(rlnc10Out);

const rlnc10Proc = spawnSync('wsl', [
  ENGINE_BIN_WSL,
  `--transfer-id=test-rlnc-10`,
  `--protocol=rlnc`,
  `--file=${toWslPath(testInputPath)}`,
  `--out=${toWslPath(rlnc10Out)}`,
  `--loss=10`,
  `--delay=5`,
  `--k=4`,
  `--block-size=1024`,
  `--redundancy=2`,
  `--port=9603`,
  `--seed=100`,
  `--role=all`
], { encoding: 'utf8' });

assertTest('RLNC (10% loss) executes with exit code 0', rlnc10Proc.status === 0);
if (fs.existsSync(rlnc10Out)) {
  const rlnc10Hash = computeSha256(rlnc10Out);
  assertTest('RLNC (10% loss) recovers packets via coding & matches SHA-256', rlnc10Hash === inputHash, `Hash: ${rlnc10Hash}`);
}

// TEST 5: Nonzero-Loss RUDP (10% loss)
console.log('\n--- Running Nonzero-Loss RUDP Test (10% Loss) ---');
const rudp10Out = path.join(RESULTS_DIR, 'test_rudp10.out');
if (fs.existsSync(rudp10Out)) fs.unlinkSync(rudp10Out);

const rudp10Proc = spawnSync('wsl', [
  ENGINE_BIN_WSL,
  `--transfer-id=test-rudp-10`,
  `--protocol=rudp`,
  `--file=${toWslPath(testInputPath)}`,
  `--out=${toWslPath(rudp10Out)}`,
  `--loss=10`,
  `--delay=5`,
  `--block-size=1024`,
  `--port=9604`,
  `--seed=100`,
  `--role=all`
], { encoding: 'utf8' });

assertTest('RUDP (10% loss) executes with exit code 0', rudp10Proc.status === 0);
if (fs.existsSync(rudp10Out)) {
  const rudp10Hash = computeSha256(rudp10Out);
  assertTest('RUDP (10% loss) recovers packets via ARQ retransmission & matches SHA-256', rudp10Hash === inputHash, `Hash: ${rudp10Hash}`);
}

// TEST 6: Real-time Telemetry Emission (EVENT_JSON and METRICS_JSON)
console.log('\n--- Real-Time C Engine Telemetry Validation ---');
const outputStr = rlnc10Proc.stdout || '';
assertTest('C engine emits EVENT_JSON lines for telemetry', outputStr.includes('EVENT_JSON:'));
assertTest('C engine emits METRICS_JSON line with goodput and packet accounting', outputStr.includes('METRICS_JSON:'));
assertTest('C engine emits SHA-256 cryptographic verification result', outputStr.includes('[VERIFICATION] Status:        PASSED'));

console.log('\n================================================================');
console.log(` INTEGRATION TEST RESULTS: ${passedTests} / ${totalTests} PASSED`);
console.log('================================================================\n');

process.exit(passedTests === totalTests ? 0 : 1);
