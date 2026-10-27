const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(ROOT_DIR, 'results');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const ENGINE_BIN = path.join(ROOT_DIR, 'engine/bin/netcode_engine');

if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function toWslPath(winPath) {
  if (!winPath) return '';
  const resolved = path.resolve(winPath).replace(/\\/g, '/');
  const match = resolved.match(/^([a-zA-Z]):\/(.*)$/);
  if (match) {
    return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
  }
  return resolved;
}

function sha256File(p) {
  if (!fs.existsSync(p)) return '';
  const buf = fs.readFileSync(p);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const NS3_BIN = '/home/muthu/ns-allinone-3.41/ns-3.41/build/scratch/netcode-rft/ns3.41-netcode-rft-default';

async function runSimulation(options) {
  const { protocol, loss, file, out, trace, delay = '20ms', bandwidth = '10Mbps', K = 4, blockSize = 1024, redundancy = 2, seed = 1 } = options;

  const wslFile = toWslPath(file);
  const wslOut = toWslPath(out);
  const wslTrace = toWslPath(trace);

  const cmd = 'wsl';
  const args = [
    NS3_BIN,
    `--protocol=${protocol.toUpperCase()}`,
    `--loss=${loss}`,
    `--delay=${delay}`,
    `--bandwidth=${bandwidth}`,
    `--file=${wslFile}`,
    `--out=${wslOut}`,
    `--trace=${wslTrace}`,
    `--k=${K}`,
    `--block-size=${blockSize}`,
    `--redundancy=${redundancy}`,
    `--transfer-id=${seed}`,
    `--seed=${seed}`
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { shell: false });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      let metrics = null;
      const lines = stdout.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('METRICS_JSON:')) {
          try {
            metrics = JSON.parse(trimmed.slice(13));
          } catch (e) {}
        }
      }

      resolve({
        code,
        metrics,
        stdout,
        stderr
      });
    });

    proc.on('error', reject);
  });
}

async function main() {
  console.log('================================================================');
  console.log(' NetCode-RFT: Automated Native NS-3 Batch Experiment Runner');
  console.log('================================================================\n');

  // Create deterministic 4096-byte test file
  const testFilePath = path.join(UPLOADS_DIR, 'batch_test_4096.bin');
  const testBytes = Buffer.alloc(4096);
  for (let i = 0; i < 4096; i++) {
    testBytes[i] = ((i * 37 + 13) % 256);
  }
  fs.writeFileSync(testFilePath, testBytes);
  const originalHash = sha256File(testFilePath);
  console.log(`Test Payload: ${testFilePath} (4096 bytes, SHA-256: ${originalHash})\n`);

  const lossRates = [0, 5, 10, 20, 30];
  const protocols = ['RLNC', 'RUDP'];
  const allResults = [];

  for (const proto of protocols) {
    for (const loss of lossRates) {
      const outPath = path.join(RESULTS_DIR, `${proto.toLowerCase()}_loss${loss}_reconstructed.bin`);
      const tracePath = path.join(RESULTS_DIR, `${proto.toLowerCase()}_loss${loss}.xml`);

      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
      if (fs.existsSync(tracePath)) fs.unlinkSync(tracePath);

      process.stdout.write(`[Running] Protocol=${proto} Loss=${loss}% ... `);
      const startTime = Date.now();

      try {
        const result = await runSimulation({
          protocol: proto,
          loss,
          file: testFilePath,
          out: outPath,
          trace: tracePath,
          delay: '20ms',
          bandwidth: '10Mbps',
          K: 4,
          blockSize: 1024,
          redundancy: 2,
          seed: 42
        });

        const elapsedWall = ((Date.now() - startTime) / 1000).toFixed(2);
        const m = result.metrics || {};
        const reconHash = sha256File(outPath);
        const hashMatch = (reconHash === originalHash);
        const traceExists = fs.existsSync(tracePath) && fs.statSync(tracePath).size > 0;

        const record = {
          protocol: proto,
          lossRate: loss,
          verified: hashMatch,
          goodputKbps: parseFloat(m.goodput_kbps) || 0,
          simTimeSec: parseFloat(m.sim_time_sec) || 0,
          totalSent: m.total_sent_packets || 0,
          retransmissions: m.total_retransmissions || 0,
          codedPackets: m.total_coded_packets || 0,
          status: hashMatch ? 'completed' : 'failed',
          Protocol: proto,
          ConfiguredLossPercent: loss,
          ObservedLossPercent: m.observed_loss_rate !== undefined ? m.observed_loss_rate : (m.configured_loss_percent || loss),
          SimTimeSec: m.sim_time_sec !== undefined ? m.sim_time_sec : 'N/A',
          GoodputKbps: m.goodput_kbps !== undefined ? m.goodput_kbps : '0.0',
          DataPacketsSent: m.data_packets_sent !== undefined ? m.data_packets_sent : (m.total_sent_packets || 0),
          DataPacketsReceived: m.data_packets_received !== undefined ? m.data_packets_received : 0,
          ForwardPhyDrops: m.forward_phy_drops !== undefined ? m.forward_phy_drops : 0,
          ReversePhyDrops: m.reverse_phy_drops !== undefined ? m.reverse_phy_drops : 0,
          TotalPhyDrops: m.total_phy_drops !== undefined ? m.total_phy_drops : 0,
          PhyDrops: m.forward_phy_drops !== undefined ? m.forward_phy_drops : 0,
          PacketDeliveryRatio: m.packet_delivery_ratio_percent !== undefined ? m.packet_delivery_ratio_percent : 100.0,
          TransmissionOverhead: m.transmission_overhead_percent !== undefined ? m.transmission_overhead_percent : 0.0,
          WireOverhead: m.wire_overhead_percent !== undefined ? m.wire_overhead_percent : 0.0,
          TotalSent: m.total_sent_packets || 0,
          Retransmissions: m.total_retransmissions || 0,
          CodedPackets: m.total_coded_packets || 0,
          Acks: m.total_acks || 0,
          IntegrityVerified: hashMatch ? 'PASS' : 'FAIL',
          TraceGenerated: traceExists ? 'YES' : 'NO',
          TraceFile: path.basename(tracePath)
        };

        allResults.push(record);
        console.log(`Done (${elapsedWall}s) -> Status: ${hashMatch ? 'VERIFIED' : 'FAILED'}, Goodput: ${record.GoodputKbps} Kbps, PDR: ${record.PacketDeliveryRatio}%, Loss: ${record.ObservedLossPercent}%, Trace: ${record.TraceFile}`);
      } catch (err) {
        console.log(`FAILED with error: ${err.message}`);
        allResults.push({
          Protocol: proto,
          ConfiguredLossPercent: loss,
          ObservedLossPercent: 'ERR',
          SimTimeSec: 'ERR',
          GoodputKbps: 0,
          DataPacketsSent: 0,
          DataPacketsReceived: 0,
          ForwardPhyDrops: 0,
          ReversePhyDrops: 0,
          TotalPhyDrops: 0,
          PhyDrops: 0,
          PacketDeliveryRatio: 0,
          TransmissionOverhead: 0,
          WireOverhead: 0,
          TotalSent: 0,
          Retransmissions: 0,
          CodedPackets: 0,
          Acks: 0,
          IntegrityVerified: 'ERROR',
          TraceGenerated: 'NO',
          TraceFile: ''
        });
      }
    }
  }

  // Generate CSV
  const csvHeaders = [
    'Protocol',
    'ConfiguredLossPercent',
    'ObservedLossPercent',
    'SimTimeSec',
    'GoodputKbps',
    'DataPacketsSent',
    'DataPacketsReceived',
    'ForwardPhyDrops',
    'ReversePhyDrops',
    'TotalPhyDrops',
    'PhyDrops',
    'PacketDeliveryRatio',
    'TransmissionOverhead',
    'WireOverhead',
    'TotalSent',
    'Retransmissions',
    'CodedPackets',
    'Acks',
    'IntegrityVerified',
    'TraceGenerated',
    'TraceFile'
  ];
  const csvLines = [csvHeaders.join(',')];
  for (const r of allResults) {
    csvLines.push(csvHeaders.map(h => r[h]).join(','));
  }
  const csvPath = path.join(RESULTS_DIR, 'batch_comparison_results.csv');
  fs.writeFileSync(csvPath, csvLines.join('\n'));
  console.log(`\nSaved CSV to: ${csvPath}`);

  // Save JSON
  const jsonPath = path.join(RESULTS_DIR, 'batch_comparison_results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(allResults, null, 2));
  console.log(`Saved JSON to: ${jsonPath}`);

  // Print comparison table
  console.log('\n========================================================================================');
  console.log(' FINAL BATCH EXPERIMENT SUMMARY');
  console.log('========================================================================================');
  console.table(allResults);
  console.log('========================================================================================\n');
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal batch runner error:', err);
    process.exit(1);
  });
}

module.exports = { runSimulation };
