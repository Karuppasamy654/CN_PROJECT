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

function invertSquareMatrix(squareA) {
  const K = squareA.length;
  const A = squareA.map(row => [...row]);
  const Inv = [];
  for (let i = 0; i < K; i++) {
    const row = new Array(K).fill(0);
    row[i] = 1;
    Inv.push(row);
  }

  for (let col = 0; col < K; col++) {
    let pivotRow = -1;
    for (let r = col; r < K; r++) {
      if (A[r][col] !== 0) {
        pivotRow = r;
        break;
      }
    }
    if (pivotRow === -1) return null;

    if (pivotRow !== col) {
      [A[col], A[pivotRow]] = [A[pivotRow], A[col]];
      [Inv[col], Inv[pivotRow]] = [Inv[pivotRow], Inv[col]];
    }

    const pivotVal = A[col][col];
    if (pivotVal !== 1) {
      const invPivot = gf256.inv(pivotVal);
      for (let c = 0; c < K; c++) {
        A[col][c] = gf256.mul(A[col][c], invPivot);
        Inv[col][c] = gf256.mul(Inv[col][c], invPivot);
      }
    }

    for (let r = 0; r < K; r++) {
      if (r !== col && A[r][col] !== 0) {
        const factor = A[r][col];
        for (let c = 0; c < K; c++) {
          A[r][c] = gf256.add(A[r][c], gf256.mul(factor, A[col][c]));
          Inv[r][c] = gf256.add(Inv[r][c], gf256.mul(factor, Inv[col][c]));
        }
      }
    }
  }

  // Verify: squareA * Inv === I_K
  for (let i = 0; i < K; i++) {
    for (let j = 0; j < K; j++) {
      let sum = 0;
      for (let k = 0; k < K; k++) {
        sum = gf256.add(sum, gf256.mul(squareA[i][k], Inv[k][j]));
      }
      if (sum !== (i === j ? 1 : 0)) return null;
    }
  }

  return Inv;
}

function solveGaussJordan(matrixA, matrixC) {
  if (!matrixA || matrixA.length === 0) {
    return {
      rank: 0,
      isFullRank: false,
      matrixA: [],
      matrixC: [],
      inverseA: null,
      inverseVerified: false,
      steps: [],
    };
  }

  const M = matrixA.length;
  const K = matrixA[0].length;
  const B = matrixC[0]?.length || 0;

  const A = matrixA.map(row => [...row]);
  const C = matrixC.map(row => [...row]);

  const steps = [];
  const pivotInfo = []; // { rankIndex, col, originalRowIndex }
  let rank = 0;

  // Track original row indices to extract the independent submatrix
  const rowIndices = Array.from({ length: M }, (_, i) => i);

  // 1. Forward Elimination to Row Echelon Form
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
      [rowIndices[rank], rowIndices[pivotRow]] = [rowIndices[pivotRow], rowIndices[rank]];
      steps.push({
        op: 'swap',
        desc: `Swap Row ${rank + 1} and Row ${pivotRow + 1}`,
        row1: rank + 1,
        row2: pivotRow + 1,
      });
    }

    const pivotVal = A[rank][col];
    if (pivotVal !== 1) {
      const invPivot = gf256.inv(pivotVal);
      for (let c = 0; c < K; c++) A[rank][c] = gf256.mul(A[rank][c], invPivot);
      for (let c = 0; c < B; c++) C[rank][c] = gf256.mul(C[rank][c], invPivot);
      steps.push({
        op: 'pivot_normalize',
        desc: `Normalize Row ${rank + 1}: R${rank + 1} ← R${rank + 1} ⊗ ${pivotVal}⁻¹ (inv = ${invPivot})`,
        row: rank + 1,
        pivotVal,
        invPivot,
      });
    }

    for (let r = rank + 1; r < M; r++) {
      if (A[r][col] !== 0) {
        const factor = A[r][col];
        for (let c = 0; c < K; c++) A[r][c] = gf256.add(A[r][c], gf256.mul(factor, A[rank][c]));
        for (let c = 0; c < B; c++) C[r][c] = gf256.add(C[r][c], gf256.mul(factor, C[rank][c]));
        steps.push({
          op: 'forward_eliminate',
          desc: `Forward Eliminate Row ${r + 1}: R${r + 1} ← R${r + 1} ⊕ (${factor} ⊗ R${rank + 1})`,
          targetRow: r + 1,
          pivotRow: rank + 1,
          factor,
        });
      }
    }

    pivotInfo.push({ rankIndex: rank, col, originalRowIndex: rowIndices[rank] });
    rank++;
  }

  // 2. Back Substitution to Reduced Row Echelon Form (RREF)
  for (let i = rank - 1; i >= 0; i--) {
    const col = pivotInfo[i].col;
    for (let r = 0; r < i; r++) {
      if (A[r][col] !== 0) {
        const factor = A[r][col];
        for (let c = 0; c < K; c++) A[r][c] = gf256.add(A[r][c], gf256.mul(factor, A[i][c]));
        for (let c = 0; c < B; c++) C[r][c] = gf256.add(C[r][c], gf256.mul(factor, C[i][c]));
        steps.push({
          op: 'back_substitute',
          desc: `Back-Substitute Row ${r + 1}: R${r + 1} ← R${r + 1} ⊕ (${factor} ⊗ R${i + 1})`,
          targetRow: r + 1,
          pivotRow: i + 1,
          factor,
        });
      }
    }
  }

  // 3. Consistency check on dependent / all-zero coefficient rows
  let isConsistent = true;
  let inconsistentRow = null;
  let inconsistentMessage = null;
  for (let r = 0; r < M; r++) {
    const isAZero = A[r].every(v => v === 0);
    if (isAZero) {
      const isCZero = C[r].every(v => v === 0);
      if (!isCZero) {
        isConsistent = false;
        inconsistentRow = r + 1;
        inconsistentMessage = `Inconsistent equation detected at Row ${r + 1}: linear combination of coefficients reduced to 0, but coded payload combination is non-zero (0 ≠ payload).`;
        break;
      }
    }
  }

  // 4. Compute and verify inverse of the independent submatrix if full rank
  let inverseA = null;
  let inverseVerified = false;
  if (rank === K && isConsistent) {
    // Select the K independent pivot rows from the original matrixA
    const submatrixA = pivotInfo.map(p => [...matrixA[p.originalRowIndex]]);
    const inv = invertSquareMatrix(submatrixA);
    if (inv && inv.length === K && inv.every(row => row.length === K)) {
      inverseA = inv;
      inverseVerified = true;
    }
  }

  return {
    rank,
    isFullRank: rank >= K && isConsistent,
    isConsistent,
    inconsistentRow,
    inconsistentMessage,
    matrixA: A, // Keep all M rows (reduced)
    matrixC: C, // Keep all M rows (reduced)
    inverseA,
    inverseVerified,
    steps,
  };
}

module.exports = {
  generateSystematicVector,
  formatEquation,
  computeLinearCombination,
  solveGaussJordan,
};
