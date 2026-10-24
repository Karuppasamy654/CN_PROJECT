const gf256 = require('./gf256Service');

function generateSystematicVector(K, blockIndex) {
  const v = new Array(K).fill(0);
  if (blockIndex >= 0 && blockIndex < K) {
    v[blockIndex] = 1;
  }
  return v;
}

function formatEquation(coeffs, K) {
  const terms = [];
  for (let i = 0; i < K; i++) {
    const c = coeffs[i];
    if (c === 0) continue;
    if (c === 1) {
      terms.push(`B${i + 1}`);
    } else {
      terms.push(`${c}·B${i + 1}`);
    }
  }
  return terms.length > 0 ? terms.join(' ⊕ ') : '0';
}

function computeLinearCombination(blocks, coeffs) {
  const K = coeffs.length;
  const blockSize = blocks[0]?.length || 0;
  const coded = new Uint8Array(blockSize);

  const byteTraces = [];

  for (let i = 0; i < blockSize; i++) {
    let byteVal = 0;
    const components = [];
    for (let b = 0; b < K; b++) {
      const srcByte = blocks[b][i];
      const c = coeffs[b];
      const prod = gf256.mul(srcByte, c);
      components.push({
        blockIndex: b,
        srcByte,
        coeff: c,
        product: prod,
      });
      byteVal = gf256.add(byteVal, prod);
    }
    coded[i] = byteVal;
    if (i < 8) {
      byteTraces.push({
        byteIndex: i,
        components,
        finalByte: byteVal,
        hex: '0x' + byteVal.toString(16).padStart(2, '0').toUpperCase(),
      });
    }
  }

  return {
    codedPayload: Array.from(coded),
    byteTraces,
  };
}

function solveGaussJordan(matrixA, matrixC) {
  const M = matrixA.length;
  const K = matrixA[0].length;
  const B = matrixC[0]?.length || 0;

  const A = matrixA.map(row => [...row]);
  const C = matrixC.map(row => [...row]);
  const Inv = [];
  for (let i = 0; i < M; i++) {
    const row = new Array(M).fill(0);
    row[i] = 1;
    Inv.push(row);
  }

  const steps = [];
  let rank = 0;

  for (let col = 0; col < K && rank < M; col++) {
    let pivotRow = -1;
    for (let r = rank; r < M; r++) {
      if (A[r][col] !== 0) {
        pivotRow = r;
        break;
      }
    }
    if (pivotRow === -1) continue;

    if (pivotRow !== rank) {
      [A[rank], A[pivotRow]] = [A[pivotRow], A[rank]];
      [C[rank], C[pivotRow]] = [C[pivotRow], C[rank]];
      [Inv[rank], Inv[pivotRow]] = [Inv[pivotRow], Inv[rank]];
      steps.push({
        desc: `Swap Row ${rank + 1} and Row ${pivotRow + 1}`,
        op: 'swap',
        row1: rank + 1,
        row2: pivotRow + 1,
      });
    }

    const pivotVal = A[rank][col];
    if (pivotVal !== 1) {
      const invPivot = gf256.inv(pivotVal);
      for (let c = 0; c < K; c++) A[rank][c] = gf256.mul(A[rank][c], invPivot);
      for (let c = 0; c < B; c++) C[rank][c] = gf256.mul(C[rank][c], invPivot);
      for (let c = 0; c < M; c++) Inv[rank][c] = gf256.mul(Inv[rank][c], invPivot);
      steps.push({
        desc: `Normalize Row ${rank + 1}: R${rank + 1} ← R${rank + 1} ⊗ ${pivotVal}⁻¹ (inv = ${invPivot})`,
        op: 'normalize',
        row: rank + 1,
        pivotVal,
        invPivot,
      });
    }

    for (let r = 0; r < M; r++) {
      if (r !== rank && A[r][col] !== 0) {
        const factor = A[r][col];
        for (let c = 0; c < K; c++) A[r][c] = gf256.add(A[r][c], gf256.mul(factor, A[rank][c]));
        for (let c = 0; c < B; c++) C[r][c] = gf256.add(C[r][c], gf256.mul(factor, C[rank][c]));
        for (let c = 0; c < M; c++) Inv[r][c] = gf256.add(Inv[r][c], gf256.mul(factor, Inv[rank][c]));
        steps.push({
          desc: `Eliminate Row ${r + 1}: R${r + 1} ← R${r + 1} ⊕ (${factor} ⊗ R${rank + 1})`,
          op: 'eliminate',
          targetRow: r + 1,
          pivotRow: rank + 1,
          factor,
        });
      }
    }

    rank++;
  }

  return {
    rank,
    isFullRank: rank >= K,
    matrixA: A.slice(0, K),
    matrixC: C.slice(0, K),
    inverseA: Inv.slice(0, K).map(row => row.slice(0, K)),
    steps,
  };
}

module.exports = {
  generateSystematicVector,
  formatEquation,
  computeLinearCombination,
  solveGaussJordan,
};
