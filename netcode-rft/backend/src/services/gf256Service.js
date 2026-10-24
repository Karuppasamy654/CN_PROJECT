/**
 * Finite Field GF(256) Arithmetic Service
 * Matching C engine: poly 0x11D, generator 0x02
 */

const POLY = 0x11d;
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

function initGF256() {
  let val = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = val;
    EXP[i + 255] = val;
    LOG[val] = i;
    val = (val << 1);
    if (val & 0x100) {
      val ^= POLY;
    }
  }
  LOG[0] = 0; // conventionally
}

initGF256();

function add(a, b) {
  return (a ^ b) & 0xff;
}

function sub(a, b) {
  return (a ^ b) & 0xff;
}

function mul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function inv(a) {
  if (a === 0) throw new Error('Cannot invert zero in GF(256)');
  return EXP[255 - LOG[a]];
}

function div(a, b) {
  if (b === 0) throw new Error('Division by zero in GF(256)');
  if (a === 0) return 0;
  return EXP[(LOG[a] + 255 - LOG[b]) % 255];
}

function calculateStepByStep(a, b, op) {
  const hexA = '0x' + a.toString(16).padStart(2, '0').toUpperCase();
  const hexB = '0x' + b.toString(16).padStart(2, '0').toUpperCase();
  const steps = [];

  let result = 0;
  if (op === 'add' || op === 'sub') {
    result = add(a, b);
    steps.push(`Operation: Bitwise XOR (${hexA} ^ ${hexB})`);
    steps.push(`Binary A: ${a.toString(2).padStart(8, '0')}`);
    steps.push(`Binary B: ${b.toString(2).padStart(8, '0')}`);
    steps.push(`Result:   ${result.toString(2).padStart(8, '0')} (${result} dec, 0x${result.toString(16).padStart(2, '0').toUpperCase()})`);
  } else if (op === 'mul') {
    result = mul(a, b);
    if (a === 0 || b === 0) {
      steps.push(`Multiplying by zero yields 0.`);
    } else {
      steps.push(`Log lookup: log(${hexA}) = ${LOG[a]}, log(${hexB}) = ${LOG[b]}`);
      steps.push(`Sum of logs: ${LOG[a]} + ${LOG[b]} = ${LOG[a] + LOG[b]}`);
      steps.push(`Exp lookup: exp(${LOG[a] + LOG[b]}) = 0x${result.toString(16).padStart(2, '0').toUpperCase()} (${result})`);
      steps.push(`Irreducible polynomial used for reduction: P(x) = x^8 + x^4 + x^3 + x^2 + 1 (0x11D)`);
    }
  } else if (op === 'inv') {
    if (a === 0) {
      throw new Error('Zero has no multiplicative inverse');
    }
    result = inv(a);
    steps.push(`Log lookup: log(${hexA}) = ${LOG[a]}`);
    steps.push(`Inverse log: 255 - ${LOG[a]} = ${255 - LOG[a]}`);
    steps.push(`Exp lookup: exp(${255 - LOG[a]}) = 0x${result.toString(16).padStart(2, '0').toUpperCase()} (${result})`);
    steps.push(`Verification: ${hexA} * 0x${result.toString(16).padStart(2, '0').toUpperCase()} = ${mul(a, result)} (Identity element 1)`);
  } else if (op === 'div') {
    if (b === 0) throw new Error('Division by zero');
    result = div(a, b);
    steps.push(`Division is multiplication by inverse: ${hexA} * inv(${hexB})`);
    steps.push(`inv(${hexB}) = 0x${inv(b).toString(16).padStart(2, '0').toUpperCase()}`);
    steps.push(`Log subtraction: (log(${hexA}) - log(${hexB}) + 255) mod 255`);
    steps.push(`Result: 0x${result.toString(16).padStart(2, '0').toUpperCase()} (${result})`);
  } else {
    throw new Error(`Unsupported operation: ${op}`);
  }

  return {
    a,
    b,
    hexA,
    hexB,
    op,
    result,
    hexResult: '0x' + result.toString(16).padStart(2, '0').toUpperCase(),
    steps,
  };
}

module.exports = {
  POLY,
  EXP,
  LOG,
  add,
  sub,
  mul,
  inv,
  div,
  calculateStepByStep,
};
