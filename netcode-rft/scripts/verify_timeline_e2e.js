/**
 * verify_timeline_e2e.js
 *
 * Runs a real end-to-end 4096-byte RLNC transfer with the running C engine & backend,
 * capturing exact timestamps, sequence numbers, event types, decoder ranks,
 * reconstructed bytes, and lifecycle states for every single event.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { io } = require('../ui/node_modules/socket.io-client');

async function main() {
  const payload = Buffer.alloc(4096);
  for (let i = 0; i < 4096; i++) {
    payload[i] = (i * 41 + 19) & 0xff;
  }
  const expectedSha256 = crypto.createHash('sha256').update(payload).digest('hex');

  const testFile = path.join(__dirname, 'timeline_test_4096.bin');
  fs.writeFileSync(testFile, payload);

  console.log('=== STARTING END-TO-END RLNC TIMELINE VERIFICATION ===');
  console.log(`Payload size: 4096 bytes | Expected SHA-256: ${expectedSha256}`);

  // 1. Upload transfer
  const blob = new Blob([payload]);
  const form = new FormData();
  form.append('file', blob, 'timeline_test_4096.bin');
  form.append('protocol', 'rlnc');
  form.append('lossRate', '10');
  form.append('blockSize', '1024');
  form.append('K', '4');
  form.append('redundancy', '2');

  const uploadRes = await fetch('http://localhost:5000/api/transfers', {
    method: 'POST',
    body: form,
  });
  if (!uploadRes.ok) {
    throw new Error(`Upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  }
  const transfer = await uploadRes.json();
  const transferId = transfer.id;
  console.log(`[MILESTONE 1] Transfer Initialized: id=${transferId}`);

  // 2. Connect socket and register listeners BEFORE connect/join
  const socket = io('http://localhost:5000', { transports: ['websocket'] });
  const eventLog = [];
  let currentLifecycle = 'INITIALIZING';
  let finalVerification = null;
  let finalStatus = null;
  let finalMetrics = null;
  const milestones = {};

  milestones['1. Transfer initialization'] = {
    time: Date.now(),
    transferId,
    state: currentLifecycle,
  };

  socket.on('transfer_event', (event) => {
    if (event.type === 'handshake_step') {
      if (event.step === 4 || event.step_name === 'INITIALIZATION_COMPLETE') {
        currentLifecycle = 'TRANSFERRING';
        if (!milestones['2. Handshake completion']) {
          milestones['2. Handshake completion'] = { time: event.time, event };
        }
      }
    } else if (event.type === 'packet_transmitted') {
      if (!milestones['3. First physical transmission']) {
        milestones['3. First physical transmission'] = { time: event.time, event };
      }
      milestones['8. Last physical transmission'] = { time: event.time, event };
    } else if (event.type === 'packet_dropped' || event.type === 'packet_received') {
      if (!milestones['4. First actual packet drop or reception']) {
        milestones['4. First actual packet drop or reception'] = { time: event.time, event };
      }
    } else if (event.type === 'decoder_matrix_update') {
      if (event.rank > 0 && currentLifecycle === 'TRANSFERRING') {
        currentLifecycle = 'DECODING';
      }
      const rankKey = `5. Decoder rank ${event.rank}/${event.required_rank}`;
      if (!milestones[rankKey]) {
        milestones[rankKey] = { time: event.time, event };
      }
    } else if (event.type === 'reconstruction_progress') {
      if (event.pct >= 100) {
        currentLifecycle = 'VERIFYING';
        if (!milestones['6. Successful generation decode']) {
          milestones['6. Successful generation decode'] = { time: event.time, event };
        }
        if (!milestones['7. Complete file reconstruction']) {
          milestones['7. Complete file reconstruction'] = { time: event.time, event };
        }
      }
    } else if (event.type === 'verification_result') {
      milestones['10. SHA-256 verification'] = { time: event.time, event };
    }

    eventLog.push({
      ...event,
      lifecycle: currentLifecycle,
    });
  });

  socket.on('metrics', (m) => {
    finalMetrics = m;
    milestones['9. Sender completion'] = { time: m.duration_s, metrics: m };
  });

  socket.on('status', (s) => {
    if (s.status === 'completed' || s.status === 'failed') {
      finalStatus = s.status;
      currentLifecycle = s.status === 'completed' ? 'COMPLETED' : 'FAILED';
      milestones['11. Final transfer completion'] = { status: s.status, exitCode: s.exitCode };
    }
  });

  await new Promise((resolve) => {
    socket.on('connect', () => {
      socket.emit('join_transfer', transferId);
      resolve();
    });
  });

  // Start engine
  const startRes = await fetch(`http://localhost:5000/api/transfers/${transferId}/start`, { method: 'POST' });
  console.log('Engine process launched:', await startRes.json());

  // Wait for completion (via socket or polling)
  const startTime = Date.now();
  while (!finalStatus && (Date.now() - startTime < 15000)) {
    await new Promise((r) => setTimeout(r, 200));
    const chk = await fetch(`http://localhost:5000/api/transfers/${transferId}`);
    if (chk.ok) {
      const data = await chk.json();
      if (data.status === 'completed' || data.status === 'failed') {
        finalStatus = data.status;
        currentLifecycle = data.status === 'completed' ? 'COMPLETED' : 'FAILED';
        if (!milestones['11. Final transfer completion']) {
          milestones['11. Final transfer completion'] = { status: data.status, exitCode: data.exitCode };
        }
        break;
      }
    }
  }

  // Grace window to drain remaining socket packets
  await new Promise((r) => setTimeout(r, 300));
  socket.disconnect();

  // Query verification endpoint
  const verifyRes = await fetch(`http://localhost:5000/api/transfers/${transferId}/verification`);
  finalVerification = await verifyRes.json();

  console.log('\n========================================================================================');
  console.log('                         CHRONOLOGICAL EVENT LOG TABLE');
  console.log('========================================================================================');
  console.log(
    '#'.padEnd(4) +
    'Timestamp (ms)'.padEnd(16) +
    'Type'.padEnd(26) +
    'Seq'.padEnd(6) +
    'Gen'.padEnd(6) +
    'Rank'.padEnd(8) +
    'Recon B'.padEnd(10) +
    'Lifecycle'
  );
  console.log('-'.repeat(90));

  let reconstructedBytesTracker = 0;
  let currentRankTracker = 0;

  eventLog.forEach((e, idx) => {
    if (e.type === 'decoder_matrix_update') currentRankTracker = e.rank;
    if (e.type === 'reconstruction_progress') reconstructedBytesTracker = Math.round((e.pct / 100) * 4096);

    const rankStr = e.rank !== undefined ? `${e.rank}/${e.required_rank}` : (currentRankTracker ? `${currentRankTracker}/4` : '—');
    const reconStr = reconstructedBytesTracker ? `${reconstructedBytesTracker} B` : '0 B';

    console.log(
      String(idx + 1).padEnd(4) +
      String(e.time !== undefined ? Number(e.time).toFixed(2) : '—').padEnd(16) +
      String(e.type).padEnd(26) +
      String(e.seq_id !== undefined ? e.seq_id : '—').padEnd(6) +
      String(e.gen_id !== undefined ? e.gen_id : '—').padEnd(6) +
      rankStr.padEnd(8) +
      reconStr.padEnd(10) +
      String(e.lifecycle)
    );
  });

  console.log('\n========================================================================================');
  console.log('                         TRANSFER MILESTONES SUMMARY');
  console.log('========================================================================================');
  for (const [key, val] of Object.entries(milestones)) {
    console.log(`* ${key}: ${JSON.stringify(val)}`);
  }

  console.log('\n========================================================================================');
  console.log('                         INTEGRITY VERIFICATION RESULT');
  console.log('========================================================================================');
  console.log(`Expected SHA-256 : ${expectedSha256}`);
  console.log(`Original SHA-256 : ${finalVerification.origSha}`);
  console.log(`Reconstruct SHA  : ${finalVerification.reconSha}`);
  console.log(`Original Size    : ${finalVerification.origSize} B`);
  console.log(`Reconstruct Size : ${finalVerification.reconSize} B`);
  console.log(`Byte-for-byte Eq : ${finalVerification.byteEqual}`);
  console.log(`Verification Pass: ${finalVerification.verified}`);

  try { fs.unlinkSync(testFile); } catch (_) {}
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
