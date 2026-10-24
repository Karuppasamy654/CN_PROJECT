const express = require('express');
const router = express.Router();
const gf256 = require('../services/gf256Service');
const rlnc = require('../services/rlncService');
const store = require('../services/store');

// 1. POST /api/calculations/gf256
router.post('/calculations/gf256', (req, res) => {
  try {
    const { a, b, op } = req.body;
    let valA = typeof a === 'string' && a.startsWith('0x') ? parseInt(a, 16) : parseInt(a, 10);
    let valB = typeof b === 'string' && b.startsWith('0x') ? parseInt(b, 16) : parseInt(b, 10);

    if (isNaN(valA) || valA < 0 || valA > 255) {
      return res.status(400).json({ error: 'Input A must be between 0 and 255 (0x00 to 0xFF)' });
    }
    if (op !== 'inv' && (isNaN(valB) || valB < 0 || valB > 255)) {
      return res.status(400).json({ error: 'Input B must be between 0 and 255 (0x00 to 0xFF)' });
    }

    const calc = gf256.calculateStepByStep(valA, valB || 0, op);
    res.json(calc);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 2. POST /api/calculations/rlnc
router.post('/calculations/rlnc', (req, res) => {
  try {
    const { blocks, coeffs } = req.body;
    if (!blocks || !coeffs || blocks.length !== coeffs.length) {
      return res.status(400).json({ error: 'Blocks array and coeffs array must have matching lengths' });
    }
    const result = rlnc.computeLinearCombination(blocks, coeffs);
    const eq = rlnc.formatEquation(coeffs, coeffs.length);
    res.json({ equation: eq, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 3. GET /api/calculations/transfer/:id
router.get('/calculations/transfer/:id', (req, res) => {
  const t = store.getTransfer(req.params.id);
  if (!t) return res.status(404).json({ error: 'Transfer not found' });

  const events = store.getEvents(req.params.id);
  const totalBlocks = Math.ceil(t.fileSize / t.blockSize);
  const totalGenerations = Math.ceil(totalBlocks / t.K);

  // Extract source blocks preview
  const sourceBlocks = events
    .filter(e => e.type === 'source_block_created')
    .map(e => ({
      blockId: e.block_id,
      len: e.len,
      hexPreview: e.hex_preview,
      asciiPreview: e.ascii_preview,
    }));

  // Extract transmitted packets
  const transmittedPackets = events
    .filter(e => e.type === 'packet_transmitted')
    .map(e => ({
      seqId: e.seq_id,
      genId: e.gen_id,
      pktType: e.pkt_type,
      coeffs: e.coeffs || [],
      dataPreview: e.data_preview || [],
      data_preview: e.data_preview || [],
      equation: e.coeffs && e.coeffs.length > 0 ? rlnc.formatEquation(e.coeffs, t.K) : `B${e.seq_id + 1}`,
      payloadLen: e.payload_len,
    }));

  // Extract received packets directly from packet_received events
  const receivedEvents = events.filter(e => e.type === 'packet_received');
  const txMap = new Map();
  for (const tx of transmittedPackets) {
    txMap.set(tx.seqId, tx);
  }

  const receivedPackets = receivedEvents.map((rx) => {
    const tx = txMap.get(rx.seq_id);
    const coeffs = (rx.coeffs && rx.coeffs.length > 0) ? rx.coeffs : (tx?.coeffs || []);
    const dataPreview = (rx.data_preview && rx.data_preview.length > 0) ? rx.data_preview : (tx?.dataPreview || tx?.data_preview || []);
    return {
      id: `C${rx.seq_id + 1}`,
      seqId: rx.seq_id,
      genId: rx.gen_id,
      coeffs,
      dataPreview,
      payloadLen: rx.payload_len,
      time: rx.time,
    };
  });

  // Build Matrix A and Matrix C strictly from received packets of Generation 0
  const gen0Packets = receivedPackets.filter(p => p.genId === 0 && p.coeffs && p.coeffs.length === t.K);
  const matrixA = gen0Packets.map(p => p.coeffs);
  const matrixC = gen0Packets.map(p => p.dataPreview.length > 0 ? p.dataPreview.slice(0, 3) : [0, 0, 0]);

  let gaussJordan = null;
  const decodedPackets = [];

  if (matrixA.length > 0 && matrixC.length > 0) {
    gaussJordan = rlnc.solveGaussJordan(matrixA, matrixC);
    for (let i = 0; i < t.K; i++) {
      decodedPackets.push({
        id: `P${i + 1}`,
        bytes: gaussJordan.matrixC[i] || [0, 0, 0],
      });
    }
  }

  // File splitting summary
  const fileSplitting = {
    fileSize: t.fileSize,
    blockSize: t.blockSize,
    K: t.K,
    totalBlocks,
    totalGenerations,
    lastBlockSize: (t.fileSize % t.blockSize) === 0 ? t.blockSize : (t.fileSize % t.blockSize),
    paddingBytes: (t.fileSize % t.blockSize) === 0 ? 0 : (t.blockSize - (t.fileSize % t.blockSize)),
  };

  res.json({
    transferId: t.id,
    protocol: t.protocol,
    fileSplitting,
    sourceBlocks,
    transmittedPackets,
    receivedPackets,
    matrixA,
    matrixC,
    rank: gaussJordan.rank,
    requiredRank: t.K,
    isFullRank: gaussJordan.isFullRank,
    gaussJordan,
    decodedPackets,
    metrics: t.metrics || null,
  });
});

module.exports = router;
