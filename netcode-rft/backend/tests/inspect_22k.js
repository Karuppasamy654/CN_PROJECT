/**
 * inspect_22k.js
 * Measure exact packetization and transmission breakdown for a 22 KB file
 * under both RLNC and Reliable UDP (RUDP).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ENGINE_BIN, UPLOADS_DIR } = require('../src/config');

function toWslPath(winPath) {
  if (!winPath) return '';
  const resolved = path.resolve(winPath).replace(/\\/g, '/');
  const match = resolved.match(/^([a-zA-Z]):\/(.*)$/);
  if (match) {
    const drive = match[1].toLowerCase();
    return `/mnt/${drive}/${match[2]}`;
  }
  return resolved;
}

async function runEngineTest(protocol, fileSize, blockSize, K, redundancy, lossRate) {
  const filePath = path.join(UPLOADS_DIR, `test_22k_${protocol}.bin`);
  const outPath = filePath + '.reconstructed';

  // Generate deterministic 22 KB payload
  const buf = Buffer.alloc(fileSize);
  for (let i = 0; i < fileSize; i++) {
    buf[i] = (i * 31 + 17) % 256;
  }
  fs.writeFileSync(filePath, buf);
  const origSha = crypto.createHash('sha256').update(buf).digest('hex');

  const isWin = process.platform === 'win32';
  let cmd = ENGINE_BIN;
  let args = [
    '--transfer-id', `test-22k-${protocol}`,
    '--protocol', protocol,
    '--file', filePath,
    '--out', outPath,
    '--port', String(9500 + Math.floor(Math.random() * 400)),
    '--loss', String(lossRate),
    '--delay', '0',
    '--reorder', '0',
    '--block-size', String(blockSize),
    '--k', String(K),
    '--redundancy', String(redundancy),
    '--role', 'all',
  ];

  if (isWin) {
    cmd = 'wsl';
    args = [
      toWslPath(ENGINE_BIN),
      '--transfer-id', `test-22k-${protocol}`,
      '--protocol', protocol,
      '--file', toWslPath(filePath),
      '--out', toWslPath(outPath),
      '--port', String(9500 + Math.floor(Math.random() * 400)),
      '--loss', String(lossRate),
      '--delay', '0',
      '--reorder', '0',
      '--block-size', String(blockSize),
      '--k', String(K),
      '--redundancy', String(redundancy),
      '--role', 'all',
    ];
  }

  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { shell: false });
    const events = [];
    let metrics = null;
    let stdoutBuffer = '';

    proc.stdout.on('data', (d) => {
      stdoutBuffer += d.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('EVENT_JSON:')) {
          try {
            events.push(JSON.parse(trimmed.slice(11)));
          } catch {}
        } else if (trimmed.startsWith('METRICS_JSON:')) {
          try {
            metrics = JSON.parse(trimmed.slice(13));
          } catch {}
        }
      }
    });

    proc.on('close', (code) => {
      let reconSha = '';
      let match = false;
      if (fs.existsSync(outPath)) {
        reconSha = crypto.createHash('sha256').update(fs.readFileSync(outPath)).digest('hex');
        match = (origSha === reconSha);
      }

      resolve({
        code,
        origSha,
        reconSha,
        match,
        events,
        metrics,
      });
    });
  });
}

async function main() {
  const FILE_SIZE = 22 * 1024; // 22,528 bytes = 22 KB
  const BLOCK_SIZE = 1024;
  const K = 4;
  const REDUNDANCY = 2;

  console.log('======================================================');
  console.log(`Analyzing 22 KB file (${FILE_SIZE} bytes)`);
  console.log(`Configured Block Size: ${BLOCK_SIZE} bytes`);
  console.log(`Configured Generation Size (K): ${K}`);
  console.log(`Configured Initial Redundancy per Gen: ${REDUNDANCY}`);
  console.log('======================================================\n');

  // Mathematical Calculation
  const sourceBlocks = Math.ceil(FILE_SIZE / BLOCK_SIZE);
  const totalGenerations = Math.ceil(sourceBlocks / K);
  console.log(`Calculated Source Blocks: ${sourceBlocks}`);
  console.log(`Calculated RLNC Generations: ${totalGenerations}`);
  console.log(`Breakdown per Generation:`);
  for (let g = 0; g < totalGenerations; g++) {
    const blks = (g === totalGenerations - 1 && sourceBlocks % K !== 0) ? (sourceBlocks % K) : K;
    console.log(`  Gen ${g}: ${blks} source blocks + ${REDUNDANCY} redundancy = ${blks + REDUNDANCY} initial packets`);
  }
  const minInitialRlncPackets = (totalGenerations - 1) * (K + REDUNDANCY) + ((sourceBlocks % K || K) + REDUNDANCY);
  console.log(`Expected Base RLNC Packets without retransmissions: ${minInitialRlncPackets}\n`);

  // Run 1: RLNC 0% Loss
  console.log('--- TEST 1: RLNC (0% Loss) ---');
  const rlncRes = await runEngineTest('rlnc', FILE_SIZE, BLOCK_SIZE, K, REDUNDANCY, 0);
  const rlncSourceBlocks = rlncRes.events.filter(e => e.type === 'source_block_created');
  const rlncTx = rlncRes.events.filter(e => e.type === 'packet_transmitted');
  const rlncRx = rlncRes.events.filter(e => e.type === 'packet_received');
  const rlncDrop = rlncRes.events.filter(e => e.type === 'packet_dropped');
  const rlncDecStep = rlncRes.events.filter(e => e.type === 'decoder_step');
  const rlncHandshake = rlncRes.events.filter(e => e.type === 'handshake_step');

  const systematicTx = rlncTx.filter(e => e.pkt_type === 'Systematic');
  const mixedInitialTx = rlncTx.filter(e => e.pkt_type === 'Mixed');
  const mixedRetransmitTx = rlncTx.filter(e => e.pkt_type === 'Mixed (Retransmit)');

  console.log(`Exit Code: ${rlncRes.code}`);
  console.log(`SHA-256 Match: ${rlncRes.match}`);
  console.log(`Handshake Events: ${rlncHandshake.length}`);
  console.log(`Source Blocks Created: ${rlncSourceBlocks.length}`);
  console.log(`Total Physical Packets Transmitted: ${rlncTx.length}`);
  console.log(`  ├─ Systematic Packets: ${systematicTx.length}`);
  console.log(`  ├─ Initial Mixed (Redundancy) Packets: ${mixedInitialTx.length}`);
  console.log(`  └─ Mixed (Retransmissions / Extra Coded): ${mixedRetransmitTx.length}`);
  console.log(`Packets Received: ${rlncRx.length}`);
  console.log(`Packets Dropped: ${rlncDrop.length}\n`);

  // Run 2: RLNC with 10% Loss
  console.log('--- TEST 2: RLNC (10% Loss) ---');
  const rlncLossRes = await runEngineTest('rlnc', FILE_SIZE, BLOCK_SIZE, K, REDUNDANCY, 10);
  const rlncLossTx = rlncLossRes.events.filter(e => e.type === 'packet_transmitted');
  const rlncLossRx = rlncLossRes.events.filter(e => e.type === 'packet_received');
  const rlncLossDrop = rlncLossRes.events.filter(e => e.type === 'packet_dropped');
  console.log(`Exit Code: ${rlncLossRes.code}, SHA-256 Match: ${rlncLossRes.match}`);
  console.log(`Transmitted: ${rlncLossTx.length}, Received: ${rlncLossRx.length}, Dropped: ${rlncLossDrop.length}`);
  console.log(`  ├─ Systematic: ${rlncLossTx.filter(e => e.pkt_type === 'Systematic').length}`);
  console.log(`  ├─ Initial Mixed: ${rlncLossTx.filter(e => e.pkt_type === 'Mixed').length}`);
  console.log(`  └─ Extra Coded Retransmits: ${rlncLossTx.filter(e => e.pkt_type === 'Mixed (Retransmit)').length}\n`);

  // Run 3: Reliable UDP (0% Loss)
  console.log('--- TEST 3: Reliable UDP (0% Loss) ---');
  const rudpRes = await runEngineTest('rudp', FILE_SIZE, BLOCK_SIZE, K, REDUNDANCY, 0);
  const rudpTx = rudpRes.events.filter(e => e.type === 'packet_transmitted');
  const rudpRx = rudpRes.events.filter(e => e.type === 'packet_received');
  const rudpAcks = rudpRes.events.filter(e => e.type === 'rudp_ack');
  console.log(`Exit Code: ${rudpRes.code}, SHA-256 Match: ${rudpRes.match}`);
  console.log(`Transmitted: ${rudpTx.length}, Received: ${rudpRx.length}, ACKs: ${rudpAcks.length}\n`);

  // Run 4: Reliable UDP (10% Loss)
  console.log('--- TEST 4: Reliable UDP (10% Loss) ---');
  const rudpLossRes = await runEngineTest('rudp', FILE_SIZE, BLOCK_SIZE, K, REDUNDANCY, 10);
  const rudpLossTx = rudpLossRes.events.filter(e => e.type === 'packet_transmitted');
  const rudpLossRx = rudpLossRes.events.filter(e => e.type === 'packet_received');
  const rudpLossDrop = rudpLossRes.events.filter(e => e.type === 'packet_dropped');
  const rudpRetransmits = rudpLossRes.events.filter(e => e.type === 'rudp_retransmit');
  console.log(`Exit Code: ${rudpLossRes.code}, SHA-256 Match: ${rudpLossRes.match}`);
  console.log(`Transmitted: ${rudpLossTx.length}, Received: ${rudpLossRx.length}, Dropped: ${rudpLossDrop.length}`);
  console.log(`Retransmissions recorded: ${rudpRetransmits.length}\n`);
}

main().catch(console.error);
