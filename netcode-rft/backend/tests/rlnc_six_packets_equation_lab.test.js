const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const http = require('http');
const gf256 = require('../src/services/gf256Service');
const rlnc = require('../src/services/rlncService');
const store = require('../src/services/store');
const app = require('../src/app');

function withServer(callback) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', async () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      try {
        await callback(baseUrl);
        server.close(resolve);
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

test('RLNC 6 Packets with K=4: Dimensions, GF(256) Rank, Dependent Count, Augmented Elimination, and Decoded Output', () => {
  // 1. Create 4 authentic source blocks of 32 bytes each
  const K = 4;
  const blockSize = 32;
  const B1 = Array.from({ length: blockSize }, (_, i) => (i * 7 + 3) & 0xff);
  const B2 = Array.from({ length: blockSize }, (_, i) => (i * 13 + 17) & 0xff);
  const B3 = Array.from({ length: blockSize }, (_, i) => (i * 19 + 41) & 0xff);
  const B4 = Array.from({ length: blockSize }, (_, i) => (i * 23 + 97) & 0xff);
  const sourceBlocks = [B1, B2, B3, B4];

  // Helper to linearly combine source blocks over GF(256)
  const combine = (coeffs) => {
    const out = new Array(blockSize).fill(0);
    for (let b = 0; b < K; b++) {
      for (let j = 0; j < blockSize; j++) {
        out[j] = gf256.add(out[j], gf256.mul(sourceBlocks[b][j], coeffs[b]));
      }
    }
    return out;
  };

  // 2. Define 6 received packets:
  // C2: Systematic B2 [0, 1, 0, 0]
  // C3: Systematic B3 [0, 0, 1, 0]
  // C4: Systematic B4 [0, 0, 0, 1]
  // C5: Coded mixed packet with innovative coefficient vector
  // C6: Coded mixed packet with innovative coefficient vector
  // C7: Dependent packet (identical coefficients and payload to C5)
  const c2Coeffs = [0, 1, 0, 0];
  const c3Coeffs = [0, 0, 1, 0];
  const c4Coeffs = [0, 0, 0, 1];
  const c5Coeffs = [100, 134, 237, 156];
  const c6Coeffs = [194, 7, 37, 72];
  const c7Coeffs = [100, 134, 237, 156]; // Deliberately dependent duplicate

  const matrixA = [c2Coeffs, c3Coeffs, c4Coeffs, c5Coeffs, c6Coeffs, c7Coeffs];
  const matrixC = [
    combine(c2Coeffs),
    combine(c3Coeffs),
    combine(c4Coeffs),
    combine(c5Coeffs),
    combine(c6Coeffs),
    combine(c7Coeffs),
  ];

  // 3. Test matrix dimensions: Exactly 6 rows
  assert.strictEqual(matrixA.length, 6, 'Matrix A must have 6 rows');
  assert.strictEqual(matrixA[0].length, 4, 'Matrix A must have 4 columns (K=4)');
  assert.strictEqual(matrixC.length, 6, 'Matrix C must have 6 rows');
  assert.strictEqual(matrixC[0].length, blockSize, 'Matrix C rows must match payload block size');

  // 4. Solve Gauss-Jordan over GF(256)
  const result = rlnc.solveGaussJordan(matrixA, matrixC);

  // 5. Test rank, full rank flag, and equation counts
  assert.strictEqual(result.rank, 4, 'Rank over GF(256) must equal 4');
  assert.strictEqual(result.isFullRank, true, 'isFullRank must be true');

  const totalReceivedPackets = matrixA.length;
  const independentEquations = result.rank;
  const dependentEquations = totalReceivedPackets - independentEquations;

  assert.strictEqual(totalReceivedPackets, 6, 'Total received packets must be 6');
  assert.strictEqual(independentEquations, 4, 'Independent equations must be 4');
  assert.strictEqual(dependentEquations, 2, 'Dependent equations count must be 2 (6 - 4)');

  // 6. Test eliminated matrix dimensions: Must preserve all 6 rows
  assert.strictEqual(result.matrixA.length, 6, 'Eliminated matrix A must retain all 6 rows');
  assert.strictEqual(result.matrixC.length, 6, 'Eliminated matrix C must retain all 6 rows');

  // Rows 0..3 of eliminated A must be standard identity matrix I_4
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      assert.strictEqual(result.matrixA[r][c], (r === c ? 1 : 0), `matrixA[${r}][${c}] must match identity`);
    }
  }

  // Rows 4 and 5 of eliminated A must be all zeros (dependent equations zeroed out)
  for (let r = 4; r < 6; r++) {
    for (let c = 0; c < 4; c++) {
      assert.strictEqual(result.matrixA[r][c], 0, `Dependent row ${r} col ${c} must be 0`);
    }
  }

  // Rows 4 and 5 of eliminated C must be all zeros
  for (let r = 4; r < 6; r++) {
    for (let b = 0; b < blockSize; b++) {
      assert.strictEqual(result.matrixC[r][b], 0, `Dependent payload row ${r} byte ${b} must be 0`);
    }
  }

  // 7. Test byte-for-byte decoded source blocks
  assert.deepStrictEqual(result.matrixC[0], B1, 'Decoded block 1 must match B1 byte-for-byte');
  assert.deepStrictEqual(result.matrixC[1], B2, 'Decoded block 2 must match B2 byte-for-byte');
  assert.deepStrictEqual(result.matrixC[2], B3, 'Decoded block 3 must match B3 byte-for-byte');
  assert.deepStrictEqual(result.matrixC[3], B4, 'Decoded block 4 must match B4 byte-for-byte');

  // 8. Test row operations trace
  assert.ok(result.steps.length > 0, 'Steps must be recorded');
  const opTypes = new Set(result.steps.map(s => s.op));
  assert.ok(opTypes.has('swap'), 'Trace must record row swap operations');
  assert.ok(opTypes.has('pivot_normalize'), 'Trace must record pivot normalization operations');
  assert.ok(opTypes.has('forward_eliminate'), 'Trace must record forward elimination operations');
  assert.ok(opTypes.has('back_substitute'), 'Trace must record back substitution operations');

  // 9. Test submatrix inverse calculation and verification
  assert.strictEqual(result.inverseVerified, true, 'Submatrix inverse must be verified');
  assert.ok(result.inverseA !== null, 'Inverse matrix must be present');
  assert.strictEqual(result.inverseA.length, 4, 'Inverse matrix must be 4x4');
});

test('RLNC 6 Packets with Incomplete Rank (Rank 3 < K=4): Dependent Count and No Decoded Blocks', () => {
  // 6 received packets, but only spanning 3 dimensions (B1 is never present)
  const matrixA = [
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
    [0, 15, 23, 77],
    [0, 100, 4, 19],
    [0, 15, 23, 77],
  ];
  const matrixC = [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
    [10, 11, 12],
    [13, 14, 15],
    [10, 11, 12],
  ];

  const result = rlnc.solveGaussJordan(matrixA, matrixC);

  assert.strictEqual(result.rank, 3, 'Rank must be 3');
  assert.strictEqual(result.isFullRank, false, 'isFullRank must be false because rank (3) < K (4)');

  const totalReceivedPackets = matrixA.length;
  const independentEquations = result.rank;
  const dependentEquations = totalReceivedPackets - independentEquations;

  assert.strictEqual(totalReceivedPackets, 6);
  assert.strictEqual(independentEquations, 3);
  assert.strictEqual(dependentEquations, 3);
  assert.strictEqual(result.matrixA.length, 6, 'Eliminated matrix A must preserve all 6 rows');
  assert.strictEqual(result.matrixC.length, 6, 'Eliminated matrix C must preserve all 6 rows');
  assert.strictEqual(result.inverseVerified, false, 'Inverse cannot be verified when rank < K');
});

test('Equation Lab Calculations API: Live Route returns all 6 rows, correct rank, and verified trace', async () => {
  await withServer(async (baseUrl) => {
    const transferId = `test-eqlab-6pkt-${Date.now()}`;
    const t = store.createTransfer({
      id: transferId,
      filename: 'test_6packets.bin',
      filePath: path.join(__dirname, 'test_out.bin'),
      fileSize: 4096,
      protocol: 'rlnc',
      blockSize: 1024,
      K: 4,
      redundancy: 2,
      status: 'completed',
    });

    // Add source block creation events (4 blocks)
    for (let b = 0; b < 4; b++) {
      store.addEvent(transferId, {
        type: 'source_block_created',
        block_id: b,
        offset: b * 1024,
        len: 1024,
        hex_preview: `0${b}0${b}0${b}`,
        ascii_preview: `B${b}`,
        time: 10 + b,
      });
    }

    // Packet 0 was dropped
    store.addEvent(transferId, {
      type: 'packet_transmitted',
      seq_id: 0,
      gen_id: 0,
      pkt_type: 'Systematic',
      coeffs: [1, 0, 0, 0],
      payload_len: 1024,
      time: 15,
    });
    store.addEvent(transferId, {
      type: 'packet_dropped',
      seq_id: 0,
      gen_id: 0,
      reason: 'Loss simulated',
      time: 16,
    });

    // 6 Packets received: C2, C3, C4, C5, C6, C7
    const rxCoeffsList = [
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
      [100, 134, 237, 156],
      [194, 7, 37, 72],
      [100, 134, 237, 156], // Dependent copy of C5
    ];

    for (let i = 0; i < 6; i++) {
      const seqId = i + 1; // seq_id 1 to 6 corresponds to C2 to C7
      store.addEvent(transferId, {
        type: 'packet_transmitted',
        seq_id: seqId,
        gen_id: 0,
        pkt_type: i < 3 ? 'Systematic' : 'Mixed',
        coeffs: rxCoeffsList[i],
        data_preview: [10 + i, 20 + i, 30 + i],
        payload_len: 1024,
        time: 20 + i * 2,
      });

      store.addEvent(transferId, {
        type: 'packet_received',
        seq_id: seqId,
        gen_id: 0,
        coeffs: rxCoeffsList[i],
        data_preview: [10 + i, 20 + i, 30 + i],
        payload_len: 1024,
        time: 21 + i * 2,
      });
    }

    // Query API
    const res = await fetch(`${baseUrl}/api/calculations/transfer/${transferId}?generation=0`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();

    // 1. Check transfer isolation
    assert.strictEqual(data.transferId, transferId);
    assert.strictEqual(data.selectedGen, 0);

    // 2. Check 4 separate counts
    assert.strictEqual(data.totalReceivedPackets, 6, 'Total received packets must be 6');
    assert.strictEqual(data.generationSize, 4, 'Generation size must be 4');
    assert.strictEqual(data.independentEquations, 4, 'Independent equations must be 4');
    assert.strictEqual(data.dependentEquations, 2, 'Dependent equations must be 2');

    // 3. Check matrix dimensions
    assert.strictEqual(data.matrixA.length, 6, 'Matrix A must have 6 rows');
    assert.strictEqual(data.matrixA[0].length, 4, 'Matrix A must have 4 columns');
    assert.strictEqual(data.matrixC.length, 6, 'Matrix C must have 6 rows');

    // 4. Check rank and full rank flag
    assert.strictEqual(data.rank, 4, 'Rank must be 4');
    assert.strictEqual(data.isFullRank, true, 'isFullRank must be true');

    // 5. Check decoded source blocks (only present because rank == 4)
    assert.strictEqual(data.decodedPackets.length, 4, 'Must have 4 decoded source blocks');
    assert.strictEqual(data.decodedPackets[0].id, 'P1');
    assert.strictEqual(data.decodedPackets[3].id, 'P4');

    // 6. Check elimination operations trace
    assert.ok(data.gaussJordan, 'gaussJordan object must be present');
    assert.strictEqual(data.gaussJordan.matrixA.length, 6, 'Eliminated matrix A must have 6 rows');
    assert.strictEqual(data.gaussJordan.matrixC.length, 6, 'Eliminated matrix C must have 6 rows');
    assert.ok(data.gaussJordan.steps.length > 0, 'Steps must be recorded');

    // 7. Check verified inverse matrix
    assert.strictEqual(data.gaussJordan.inverseVerified, true);
    assert.ok(data.gaussJordan.inverseA);
    assert.strictEqual(data.gaussJordan.inverseA.length, 4);
  });
});
