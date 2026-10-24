/**
 * record_e2e_rlnc_transfer.js
 *
 * Runs a real end-to-end RLNC transfer against the running backend server:
 * 1. Uploads a 4 KB sample file (4 blocks, K=4, redundancy=2, 10% loss).
 * 2. Connects to Socket.IO and joins the transfer room.
 * 3. Starts the C engine via POST /api/transfers/:id/start.
 * 4. Records the exact event sequence with timestamps and types.
 * 5. Calls GET /api/transfers/:id/verification upon completion.
 * 6. Logs the complete sequence and verifies integrity.
 */

const fs = require('fs');
const path = require('path');
const { io } = require('../ui/node_modules/socket.io-client');

async function run() {
  const sampleFilePath = path.join(__dirname, 'test_sample_4k.bin');
  // Generate deterministic 4096-byte payload
  const buffer = Buffer.alloc(4096);
  for (let i = 0; i < 4096; i++) {
    buffer[i] = (i * 37 + 13) & 0xff;
  }
  fs.writeFileSync(sampleFilePath, buffer);

  console.log('1. Uploading file to http://localhost:5000/api/transfers ...');
  const blob = new Blob([buffer]);
  const form = new FormData();
  form.append('file', blob, 'test_sample_4k.bin');
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
  console.log(`Transfer created: id=${transfer.id}, size=${transfer.fileSize}, sha256=${transfer.fileSha256}`);

  // Connect socket
  const socket = io('http://localhost:5000', { transports: ['websocket'] });
  const recordedEvents = [];
  let finalMetrics = null;
  let finalStatus = null;

  await new Promise((resolve) => {
    socket.on('connect', () => {
      console.log('2. Connected to Socket.IO, joining room', transfer.id);
      socket.emit('join_transfer', transfer.id);
      resolve();
    });
  });

  socket.on('transfer_event', (event) => {
    recordedEvents.push(event);
    console.log(`  [EVENT #${recordedEvents.length}] type=${event.type} time=${event.time ?? '-'} seq=${event.seq_id ?? '-'} rank=${event.rank ?? '-'}`);
  });

  socket.on('metrics', (m) => {
    finalMetrics = m;
    console.log(`  [METRICS] duration=${m.duration_s}s throughput=${m.throughput_mbps}Mbps sent=${m.packets_sent} rx=${m.packets_received} drop=${m.packets_dropped}`);
  });

  socket.on('status', (s) => {
    console.log(`  [STATUS] status=${s.status}`);
    if (s.status === 'completed' || s.status === 'failed') {
      finalStatus = s.status;
    }
  });

  console.log('3. Starting transfer via POST /api/transfers/' + transfer.id + '/start ...');
  const startRes = await fetch(`http://localhost:5000/api/transfers/${transfer.id}/start`, { method: 'POST' });
  const startJson = await startRes.json();
  console.log('Engine start response:', startJson);

  // Wait for completion
  console.log('4. Streaming events from engine...');
  const startTime = Date.now();
  while (!finalStatus && (Date.now() - startTime < 15000)) {
    await new Promise(r => setTimeout(r, 200));
  }

  socket.disconnect();

  console.log('\n5. Querying verification endpoint: /api/transfers/' + transfer.id + '/verification');
  const verifyRes = await fetch(`http://localhost:5000/api/transfers/${transfer.id}/verification`);
  const verifyJson = await verifyRes.json();
  console.log('Verification result:', JSON.stringify(verifyJson, null, 2));

  console.log('\n=== COMPLETE EVENT SEQUENCE SUMMARY ===');
  console.log(`Total events recorded: ${recordedEvents.length}`);
  recordedEvents.forEach((e, idx) => {
    const detail = e.type === 'handshake_step' ? `step ${e.step}: ${e.step_name}` :
                   e.type === 'packet_transmitted' ? `seq=${e.seq_id} gen=${e.gen_id} type=${e.pkt_type}` :
                   e.type === 'packet_received' ? `seq=${e.seq_id} gen=${e.gen_id} len=${e.payload_len}` :
                   e.type === 'packet_dropped' ? `seq=${e.seq_id} gen=${e.gen_id} (${e.reason})` :
                   e.type === 'decoder_matrix_update' ? `gen=${e.gen_id} rank=${e.rank}/${e.required_rank} innovative=${e.innovative}` :
                   e.type === 'reconstruction_progress' ? `${e.recovered_blocks}/${e.total_blocks} blks (${e.pct}%)` :
                   e.type === 'verification_result' ? `passed=${e.passed}` : JSON.stringify(e);
    console.log(`  ${String(idx + 1).padStart(2, ' ')}. [${e.type}] ${detail}`);
  });

  if (verifyJson.state === 'SUCCESS' && verifyJson.verified === true) {
    console.log('\nSUCCESS: End-to-end RLNC transfer completed and verified bit-for-bit!');
  } else {
    console.error('\nFAILURE: Verification did not pass', verifyJson);
    process.exit(1);
  }

  // Clean up test file
  try { fs.unlinkSync(sampleFilePath); } catch (_) {}
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
