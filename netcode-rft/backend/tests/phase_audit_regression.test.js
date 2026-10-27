const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const store = require('../src/services/store');
const { toWinPath, toWslPath, RESULTS_DIR } = require('../src/config');
const request = require('supertest');
const app = require('../src/app');

test('Phase Audit Regression 1: Reverse ACK drops NEVER appear as forward data packet drops in Equation Lab', async () => {
  const tId = 'transfer-audit-test-1';
  store.createTransfer({
    id: tId,
    protocol: 'rlnc',
    fileSize: 4096,
    blockSize: 1024,
    K: 4,
    redundancy: 2,
    status: 'completed',
  });

  // Add 4 systematic packets transmitted & received
  for (let i = 0; i < 4; i++) {
    store.addEvent(tId, {
      type: 'packet_transmitted',
      seq_id: i,
      gen_id: 0,
      packet_index: i,
      pkt_type: 'Systematic',
      coeffs: [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0, i === 3 ? 1 : 0],
      data_preview: [65 + i, 66 + i, 67 + i],
      payload_len: 1024,
      time: 0.01 * (i + 1),
    });
    store.addEvent(tId, {
      type: 'packet_received',
      seq_id: i,
      gen_id: 0,
      pkt_type: 'Systematic',
      coeffs: [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0, i === 3 ? 1 : 0],
      data_preview: [65 + i, 66 + i, 67 + i],
      payload_len: 1024,
      time: 0.01 * (i + 1) + 0.02,
    });
  }

  // Add a REVERSE ACK drop (e.g. GenACK dropped on return link with seq_id 0)
  store.addEvent(tId, {
    type: 'packet_dropped',
    protocol: 'phy',
    seq_id: 0,
    packet_id: 0,
    gen_id: 0,
    pkt_type: 'GenACK',
    direction: 'reverse',
    drop_count: 1,
    drop_reason: 'RateErrorModel_PhyRxDrop',
    time: 0.065,
  });

  const res = await request(app).get(`/api/calculations/transfer/${tId}`);
  assert.equal(res.status, 200);

  // CRITICAL CHECK: droppedPackets must NOT contain the reverse ACK drop!
  assert.equal(res.body.droppedPackets.length, 0, 'Reverse ACK drop must NOT be in forward droppedPackets');
  assert.equal(res.body.reverseDroppedAcks.length, 1, 'Reverse ACK drop must be reported in reverseDroppedAcks');
  assert.equal(res.body.reverseDroppedAcks[0].direction, 'reverse');
});

test('Phase Audit Regression 2: Forward data packet drops DO appear in droppedPackets and are excluded from decoder matrix', async () => {
  const tId = 'transfer-audit-test-2';
  store.createTransfer({
    id: tId,
    protocol: 'rlnc',
    fileSize: 4096,
    blockSize: 1024,
    K: 4,
    redundancy: 2,
    status: 'running',
  });

  // Packet 0 transmitted and dropped forward
  store.addEvent(tId, {
    type: 'packet_transmitted',
    seq_id: 0,
    gen_id: 0,
    pkt_type: 'Systematic',
    coeffs: [1, 0, 0, 0],
    data_preview: [10, 20, 30],
    time: 0.01,
  });
  store.addEvent(tId, {
    type: 'packet_dropped',
    protocol: 'phy',
    seq_id: 0,
    gen_id: 0,
    pkt_type: 'Systematic',
    direction: 'forward',
    drop_reason: 'RateErrorModel_PhyRxDrop',
    time: 0.03,
  });

  // Packet 1 transmitted and received
  store.addEvent(tId, {
    type: 'packet_transmitted',
    seq_id: 1,
    gen_id: 0,
    pkt_type: 'Systematic',
    coeffs: [0, 1, 0, 0],
    data_preview: [40, 50, 60],
    time: 0.02,
  });
  store.addEvent(tId, {
    type: 'packet_received',
    seq_id: 1,
    gen_id: 0,
    pkt_type: 'Systematic',
    coeffs: [0, 1, 0, 0],
    data_preview: [40, 50, 60],
    time: 0.04,
  });

  const res = await request(app).get(`/api/calculations/transfer/${tId}`);
  assert.equal(res.status, 200);

  assert.equal(res.body.droppedPackets.length, 1, 'Forward drop must appear in droppedPackets');
  assert.equal(res.body.droppedPackets[0].seqId, 0);
  assert.equal(res.body.droppedPackets[0].direction, 'forward');

  // Dropped packet 0 must NOT be in receivedPackets
  assert.equal(res.body.receivedPackets.length, 1);
  assert.equal(res.body.receivedPackets[0].seqId, 1);
});

test('Phase Audit Regression 3: NetAnim XML trace parser endpoint (/api/traces/:filename/events) parses discrete events', async () => {
  // Create a sample NetAnim XML file in RESULTS_DIR
  const sampleTraceName = 'audit_netanim_test.xml';
  const sampleTracePath = path.join(RESULTS_DIR, sampleTraceName);
  const sampleXml = `<anim ver="netanim-3.109" filetype="animation" >
<node id="0" sysId="0" locX="10" locY="50" />
<node id="1" sysId="0" locX="90" locY="50" />
<link fromId="0" toId="1" fd="10.1.1.1" td="10.1.1.2" />
<p fId="0" fbTx="0.100" lbTx="0.101" meta-info="ns3::PppHeader ns3::Ipv4Header ns3::UdpHeader netcode::NetcodePacketHeader [type=5 xfer=1 seq=0 gen=0 K=4 payloadSz=1024 coeffs=4]" tId="1" fbRx="0.120" lbRx="0.121" />
<p fId="1" fbTx="0.125" lbTx="0.126" meta-info="ns3::PppHeader ns3::Ipv4Header ns3::UdpHeader netcode::NetcodePacketHeader [type=7 xfer=1 seq=0 gen=0 K=0 payloadSz=0 coeffs=0]" tId="0" fbRx="0.145" lbRx="0.146" />
</anim>`;

  fs.writeFileSync(sampleTracePath, sampleXml);

  const res = await request(app).get(`/api/traces/${sampleTraceName}/events`);
  assert.equal(res.status, 200);
  assert.equal(res.body.totalPackets, 2);
  assert.equal(res.body.events[0].fromId, '0');
  assert.equal(res.body.events[0].toId, '1');
  assert.equal(res.body.events[0].direction, 'forward');
  assert.equal(res.body.events[0].typeName, 'Systematic');
  assert.equal(res.body.events[0].seqId, 0);

  assert.equal(res.body.events[1].fromId, '1');
  assert.equal(res.body.events[1].toId, '0');
  assert.equal(res.body.events[1].direction, 'reverse');
  assert.equal(res.body.events[1].typeName, 'GenACK');

  // Clean up
  try { fs.unlinkSync(sampleTracePath); } catch (_) {}
});

test('Phase Audit Regression 4: Different file payloads produce different rows in Coded Data Matrix C', async () => {
  const tIdA = 'transfer-file-a';
  const tIdB = 'transfer-file-b';

  const fileAPath = path.join(RESULTS_DIR, 'test_payload_a.bin');
  const fileBPath = path.join(RESULTS_DIR, 'test_payload_b.bin');

  // File A contains all 0xAA (170 decimal)
  const bufA = Buffer.alloc(4096, 0xAA);
  // File B contains all 0x55 (85 decimal)
  const bufB = Buffer.alloc(4096, 0x55);

  fs.writeFileSync(fileAPath, bufA);
  fs.writeFileSync(fileBPath, bufB);

  store.createTransfer({
    id: tIdA,
    protocol: 'rlnc',
    filePath: fileAPath,
    fileSize: 4096,
    blockSize: 1024,
    K: 4,
    redundancy: 2,
    status: 'completed',
  });

  store.createTransfer({
    id: tIdB,
    protocol: 'rlnc',
    filePath: fileBPath,
    fileSize: 4096,
    blockSize: 1024,
    K: 4,
    redundancy: 2,
    status: 'completed',
  });

  // Add 1 systematic packet to each
  store.addEvent(tIdA, {
    type: 'packet_received',
    seq_id: 0,
    gen_id: 0,
    pkt_type: 'Systematic',
    coeffs: [1, 0, 0, 0],
    data_preview: [170, 170, 170],
    time: 0.01,
  });

  store.addEvent(tIdB, {
    type: 'packet_received',
    seq_id: 0,
    gen_id: 0,
    pkt_type: 'Systematic',
    coeffs: [1, 0, 0, 0],
    data_preview: [85, 85, 85],
    time: 0.01,
  });

  const resA = await request(app).get(`/api/calculations/transfer/${tIdA}`);
  const resB = await request(app).get(`/api/calculations/transfer/${tIdB}`);

  assert.equal(resA.status, 200);
  assert.equal(resB.status, 200);

  // Matrix C row for File A should be 170 (0xAA)
  assert.equal(resA.body.matrixC[0][0], 170);
  // Matrix C row for File B should be 85 (0x55)
  assert.equal(resB.body.matrixC[0][0], 85);

  // The matrices are guaranteed to be different!
  assert.notDeepEqual(resA.body.matrixC[0], resB.body.matrixC[0]);

  // Clean up
  try { fs.unlinkSync(fileAPath); } catch (_) {}
  try { fs.unlinkSync(fileBPath); } catch (_) {}
});
