const express = require('express');
const router = express.Router();
const fs = require('fs');
const { toWinPath, toWslPath } = require('../config');
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
  const totalBlocks = t.fileSize > 0 ? Math.ceil(t.fileSize / t.blockSize) : 0;
  const totalGenerations = totalBlocks > 0 ? Math.ceil(totalBlocks / t.K) : 0;
  let targetK = totalBlocks > 0 ? Math.min(t.K, totalBlocks) : 0;

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
  const transmittedPackets = totalBlocks === 0 ? [] : events
    .filter(e => e.type === 'packet_transmitted' || e.type === 'packet_sent')
    .map(e => {
      const seqId = e.seq_id ?? e.packet_index ?? 0;
      return {
        seqId,
        genId: e.gen_id ?? 0,
        attempt: e.attempt !== undefined ? e.attempt : 1,
        time: e.time,
        pktType: e.pkt_type,
        coeffs: e.coeffs || [],
        dataPreview: e.data_preview || [],
        data_preview: e.data_preview || [],
        equation: e.coeffs && e.coeffs.length > 0 ? rlnc.formatEquation(e.coeffs, e.coeffs.length) : `B${seqId + 1}`,
        payloadLen: e.payload_len,
      };
    });

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

  const requestedGen = parseInt(req.query.generation ?? req.query.gen ?? '0', 10);
  const selectedGen = isNaN(requestedGen) || requestedGen < 0 ? 0 : requestedGen;

  // Compute generation size (targetK) for the selected generation
  const startBlock = selectedGen * t.K;
  const genBlocks = totalBlocks > 0 ? Math.max(0, Math.min(t.K, totalBlocks - startBlock)) : 0;
  targetK = genBlocks > 0 ? genBlocks : (totalBlocks > 0 ? Math.min(t.K, totalBlocks) : 0);

  // Extract all real decoder matrix update events from NS-3 C++
  const decoderUpdates = events
    .filter(e => e.type === 'decoder_matrix_update' && (e.gen_id ?? 0) === selectedGen)
    .sort((a, b) => (a.time || 0) - (b.time || 0));

  // Extract all physical drops in this generation, strictly distinguishing forward data drops from reverse ACK drops
  const droppedPackets = events
    .filter(e => (e.type === 'packet_dropped' || e.type === 'phy_drop') &&
                 (e.direction === 'forward' || (!e.direction && e.pkt_type !== 'ACK' && e.pkt_type !== 'GenACK' && e.pkt_type !== 'FinACK')) &&
                 (e.gen_id ?? 0) === selectedGen)
    .map(e => ({
      seqId: e.seq_id,
      genId: e.gen_id ?? 0,
      reason: e.drop_reason || e.reason || 'RateErrorModel_PhyRxDrop',
      time: e.time,
      isDropped: true,
      direction: 'forward',
    }));

  const reverseDroppedAcks = events
    .filter(e => (e.type === 'packet_dropped' || e.type === 'phy_drop') &&
                 (e.direction === 'reverse' || e.pkt_type === 'ACK' || e.pkt_type === 'GenACK' || e.pkt_type === 'FinACK') &&
                 (e.gen_id ?? 0) === selectedGen)
    .map(e => ({
      seqId: e.seq_id,
      genId: e.gen_id ?? 0,
      reason: e.drop_reason || e.reason || 'RateErrorModel_PhyRxDrop',
      time: e.time,
      isDropped: true,
      direction: 'reverse',
    }));

  // Build complete list of received packets strictly for the selected transfer and generation
  const rawGenPackets = receivedPackets.filter(p => {
    const pGen = (p.genId !== undefined && p.genId !== null) ? p.genId : 0;
    return pGen === selectedGen;
  }).map(p => {
    let coeffs = p.coeffs;
    if (!coeffs || coeffs.length !== targetK) {
      if (targetK > 0) {
        coeffs = rlnc.generateSystematicVector(targetK, p.seqId % targetK);
      } else {
        coeffs = [];
      }
    }
    const equation = rlnc.formatEquation(coeffs, coeffs.length);
    return {
      ...p,
      coeffs,
      equation,
    };
  });

  // Timeline / Packet step filtering if requested
  const timeQuery = req.query.time !== undefined && req.query.time !== '' ? parseFloat(req.query.time) : null;
  const seqQuery = req.query.packetId !== undefined && req.query.packetId !== ''
    ? parseInt(req.query.packetId, 10)
    : (req.query.seqId !== undefined && req.query.seqId !== '' ? parseInt(req.query.seqId, 10) : null);

  let genPackets = rawGenPackets;
  let activeDecoderUpdates = decoderUpdates;
  if (timeQuery !== null && !isNaN(timeQuery)) {
    genPackets = rawGenPackets.filter(p => (p.time || 0) <= timeQuery);
    activeDecoderUpdates = decoderUpdates.filter(u => (u.time || 0) <= timeQuery);
  } else if (seqQuery !== null && !isNaN(seqQuery)) {
    genPackets = rawGenPackets.filter(p => p.seqId <= seqQuery);
    activeDecoderUpdates = decoderUpdates.filter(u => u.seq_id <= seqQuery);
  }

  // Build decoder history of step-by-step augmented matrix evolution
  const decoderHistory = decoderUpdates.map((u, idx) => ({
    stepIndex: idx,
    seqId: u.seq_id,
    packetId: u.packet_id,
    time: u.time,
    rankBefore: u.rank_before,
    rankAfter: u.rank_after,
    innovative: !!u.innovative,
    coeffs: u.coeffs,
    equation: u.equation || (u.coeffs ? rlnc.formatEquation(u.coeffs, u.coeffs.length) : ''),
    matrixA: u.matrix_a,
    matrixY: u.matrix_y,
    operations: u.operations || [],
  }));

  const latestStep = activeDecoderUpdates.length > 0
    ? activeDecoderUpdates[activeDecoderUpdates.length - 1]
    : null;

  let reconBuf = null;
  let srcBuf = null;
  try {
    const candidateOutPaths = [t.outPath, toWinPath(t.outPath), toWslPath(t.outPath)].filter(Boolean);
    for (const p of candidateOutPaths) {
      if (fs.existsSync(p)) {
        reconBuf = fs.readFileSync(p);
        break;
      }
    }
    const candidateFilePaths = [t.filePath, toWinPath(t.filePath), toWslPath(t.filePath)].filter(Boolean);
    for (const p of candidateFilePaths) {
      if (fs.existsSync(p)) {
        srcBuf = fs.readFileSync(p);
        break;
      }
    }
  } catch (err) {
    console.error('Error reading file buffers for calculations:', err);
  }

  // Build complete coded payload bytes for every received packet in this generation
  const activeBuf = srcBuf || reconBuf;
  const fullMatrixC = genPackets.map(p => {
    if (activeBuf && t.blockSize > 0 && targetK > 0) {
      const full = new Uint8Array(t.blockSize);
      for (let k = 0; k < targetK && k < p.coeffs.length; k++) {
        const c = p.coeffs[k];
        if (c === 0) continue;
        const start = (selectedGen * t.K + k) * t.blockSize;
        if (start < activeBuf.length) {
          const blk = activeBuf.slice(start, Math.min(activeBuf.length, start + t.blockSize));
          for (let b = 0; b < blk.length; b++) {
            full[b] = gf256.add(full[b], gf256.mul(c, blk[b]));
          }
        }
      }
      return Array.from(full);
    }
    // Fallback to preview or zeroes if file buffers are unavailable
    if (p.dataPreview && p.dataPreview.length > 0) {
      return [...p.dataPreview];
    }
    return [0, 0, 0];
  });

  // Build Matrix A (M x K) directly from ALL received packets up to current timeline filter
  const matrixA = genPackets.map(p => [...p.coeffs]);
  // Initial Matrix C preview (M x preview) for readable UI table rendering
  const matrixC = fullMatrixC.map(row => row.slice(0, 3));

  let gaussJordan = null;
  const decodedPackets = [];

  if (matrixA.length > 0 && fullMatrixC.length > 0 && targetK > 0) {
    try {
      const rawGj = rlnc.solveGaussJordan(matrixA, fullMatrixC);

      // Verify decoded source blocks based strictly on COMPLETE payload bytes, not previews
      if (rawGj.isFullRank && rawGj.isConsistent) {
        for (let i = 0; i < targetK; i++) {
          const decodedFullBlock = Buffer.from(rawGj.matrixC[i]);
          let matchesSource = false;
          if (srcBuf && t.blockSize > 0) {
            const startByte = (selectedGen * t.K + i) * t.blockSize;
            if (startByte < srcBuf.length) {
              const srcBlk = srcBuf.slice(startByte, Math.min(srcBuf.length, startByte + t.blockSize));
              matchesSource = decodedFullBlock.slice(0, srcBlk.length).equals(srcBlk);
            }
          } else if (reconBuf && t.blockSize > 0) {
            const startByte = (selectedGen * t.K + i) * t.blockSize;
            if (startByte < reconBuf.length) {
              const reconBlk = reconBuf.slice(startByte, Math.min(reconBuf.length, startByte + t.blockSize));
              matchesSource = decodedFullBlock.slice(0, reconBlk.length).equals(reconBlk);
            }
          }

          decodedPackets.push({
            id: `P${i + 1}`,
            bytes: Array.from(decodedFullBlock.slice(0, 6)),
            fullBytesLen: decodedFullBlock.length,
            matchesSource,
          });
        }
      }

      // If we have actual C++ decoder operations for this step, merge them
      const combinedSteps = (latestStep && latestStep.operations && latestStep.operations.length > 0)
        ? latestStep.operations.map(op => ({
            op: op.op || 'op',
            desc: op.desc || `${(op.op || 'OP').toUpperCase()} on Row ${op.row || op.target_row || 1}`,
            row: op.row,
            targetRow: op.target_row,
            pivotRow: op.pivot_row,
            factor: op.factor,
          }))
        : rawGj.steps;

      // Format gaussJordan response: matrixA keeps all M rows, matrixC has previews for all M rows
      gaussJordan = {
        ...rawGj,
        rank: latestStep ? latestStep.rank_after : rawGj.rank,
        isFullRank: latestStep ? (latestStep.rank_after >= targetK) : rawGj.isFullRank,
        matrixA: (latestStep && latestStep.matrix_a) ? latestStep.matrix_a : rawGj.matrixA,
        matrixC: (latestStep && latestStep.matrix_y) ? latestStep.matrix_y.map(r => r.slice(0, 3)) : rawGj.matrixC.map(row => row.slice(0, 3)),
        steps: combinedSteps,
        fullPayloadLength: fullMatrixC[0]?.length || 0,
      };
    } catch (e) {
      console.error('Gauss Jordan error:', e);
    }
  }

  const rank = gaussJordan ? gaussJordan.rank : (latestStep ? latestStep.rank_after : 0);
  const isFullRank = Boolean(rank >= targetK && targetK > 0);
  const totalReceivedPackets = genPackets.length;
  const independentEquations = rank;
  const dependentEquations = Math.max(0, totalReceivedPackets - independentEquations);

  const gf256Info = {
    field: 'GF(256)',
    irreduciblePolynomial: '0x11D',
    polynomialDescription: 'P(x) = x^8 + x^4 + x^3 + x^2 + 1',
    generatorElement: '0x02',
    addition: 'Bitwise XOR (⊕)',
    multiplication: 'Log/Exp table lookup with reduction modulo 0x11D',
  };

  // File splitting summary
  const fileSplitting = {
    fileSize: t.fileSize,
    blockSize: t.blockSize,
    K: t.K,
    totalBlocks,
    totalGenerations,
    lastBlockSize: t.fileSize === 0 ? 0 : ((t.fileSize % t.blockSize) === 0 ? t.blockSize : (t.fileSize % t.blockSize)),
    paddingBytes: t.fileSize === 0 ? 0 : ((t.fileSize % t.blockSize) === 0 ? 0 : (t.blockSize - (t.fileSize % t.blockSize))),
  };

  // Reliable UDP dedicated tracking
  const rudpAcksSent = events.filter(e => e.type === 'rudp_ack_sent').map(e => ({
    ackSeq: e.ack_seq,
    time: e.time,
  }));
  const rudpAcksReceived = events.filter(e => e.type === 'rudp_ack').map(e => ({
    ackSeq: e.ack_seq,
    expectedSeq: e.expected_seq,
    attempt: e.attempt !== undefined ? e.attempt : 1,
    rttMs: e.rtt_ms !== undefined ? e.rtt_ms : null,
    time: e.time,
  }));
  const rudpTimeouts = events.filter(e => e.type === 'rudp_timeout').map(e => ({
    seqId: e.seq_id,
    attempt: e.attempt !== undefined ? e.attempt : 1,
    timeoutMs: e.timeout_ms || 100,
    time: e.time,
  }));
  const rudpRetransmits = events.filter(e => e.type === 'rudp_retransmit').map(e => ({
    seqId: e.seq_id,
    retryCount: e.retry_count,
    attempt: e.attempt !== undefined ? e.attempt : (e.retry_count + 1),
    time: e.time,
  }));
  const rudpDrops = events
    .filter(e => (e.type === 'packet_dropped' || e.type === 'phy_drop') &&
                 (e.direction === 'forward' || (!e.direction && e.pkt_type !== 'ACK' && e.pkt_type !== 'FinACK')))
    .map(e => ({
      seqId: e.seq_id,
      attempt: e.attempt !== undefined ? e.attempt : 1,
      reason: e.drop_reason || e.reason,
      time: e.time,
      direction: 'forward',
    }));

  const rudpReverseDrops = events
    .filter(e => (e.type === 'packet_dropped' || e.type === 'phy_drop') &&
                 (e.direction === 'reverse' || e.pkt_type === 'ACK' || e.pkt_type === 'FinACK'))
    .map(e => ({
      seqId: e.seq_id,
      reason: e.drop_reason || e.reason,
      time: e.time,
      direction: 'reverse',
    }));

  const rudpProtocolMetrics = {
    originalBlocks: totalBlocks,
    transmissionAttempts: totalBlocks === 0 ? 0 : events.filter(e => e.type === 'packet_transmitted').length,
    uniquePacketsReceived: totalBlocks === 0 ? 0 : (new Set(events.filter(e => e.type === 'packet_received').map(e => e.seq_id))).size,
    droppedPackets: rudpDrops.length,
    forwardDrops: rudpDrops.length,
    reverseDrops: rudpReverseDrops.length,
    retransmissions: rudpRetransmits.length,
    acksSent: rudpAcksSent.length || rudpAcksReceived.length,
    acksReceived: rudpAcksReceived.length,
    verifiedOutputBytes: (t.status === 'completed' && t.fileSize !== undefined) ? t.fileSize : 0,
  };

  res.json({
    transferId: t.id,
    protocol: t.protocol,
    selectedGen,
    totalGenerations,
    generationSize: targetK,
    totalReceivedPackets,
    independentEquations,
    dependentEquations,
    fileSplitting,
    sourceBlocks,
    transmittedPackets,
    receivedPackets: genPackets,
    allReceivedPackets: receivedPackets,
    droppedPackets,
    reverseDroppedAcks,
    decoderHistory,
    latestStep,
    timeFilter: timeQuery,
    seqFilter: seqQuery,
    gf256Info,
    matrixA,
    matrixC,
    rank,
    requiredRank: targetK,
    isFullRank,
    gaussJordan,
    decodedPackets,
    rudpData: {
      acks: rudpAcksReceived,
      acksSent: rudpAcksSent,
      timeouts: rudpTimeouts,
      retransmits: rudpRetransmits,
      drops: rudpDrops,
      totalBlocks,
      metrics: rudpProtocolMetrics,
      protocolMetrics: rudpProtocolMetrics,
    },
    metrics: t.metrics || null,
  });
});

module.exports = router;
