/**
 * animation_queue_state_machine.test.js
 * Automated unit test for the sequential animation queue state machine
 * and real-engine event correlation.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

// Pure implementation of the Sequential Animation State Machine
class AnimationQueueStateMachine {
  constructor() {
    this.phase = 'IDLE'; // IDLE, HANDSHAKE_INIT, HANDSHAKE_READY, HANDSHAKE_START, DATA_TRANSMISSION, COMPLETED
    this.handshakeStep = 0; // 0=None, 1=TRANSFER_INIT, 2=TRANSFER_READY, 3=TRANSFER_START
    this.handshakeCompleted = [];
    this.activePacket = null;
    this.completedHistory = [];
    this.pendingQueue = [];
    this.isAnimating = false;
  }

  enqueueEvent(event) {
    if (event.type === 'handshake') {
      if (this.phase === 'IDLE' && event.step === 1) {
        this.phase = 'HANDSHAKE_INIT';
        this.handshakeStep = 1;
        this.isAnimating = true;
      }
    } else if (event.type === 'packet_transmitted') {
      this.pendingQueue.push({
        id: event.packetId,
        attemptId: event.attemptId || `${event.packetId}-0`,
        status: 'animating',
        dir: event.direction || 'sender_to_receiver',
        outcome: null,
      });
      this.checkNext();
    } else if (event.type === 'packet_received' || event.type === 'packet_dropped') {
      const outcome = event.type === 'packet_received' ? 'received' : 'dropped';
      // Correlate with active or pending
      if (this.activePacket && this.activePacket.id === event.packetId) {
        this.activePacket.outcome = outcome;
      } else {
        const item = this.pendingQueue.find(p => p.id === event.packetId);
        if (item) item.outcome = outcome;
      }
    }
  }

  completeHandshakeStep(step) {
    assert.equal(this.handshakeStep, step, `Step mismatch: expected ${this.handshakeStep}, got ${step}`);
    this.handshakeCompleted.push(step);
    
    if (step === 1) {
      this.phase = 'HANDSHAKE_READY';
      this.handshakeStep = 2;
    } else if (step === 2) {
      this.phase = 'HANDSHAKE_START';
      this.handshakeStep = 3;
    } else if (step === 3) {
      this.phase = 'DATA_TRANSMISSION';
      this.handshakeStep = 4; // Done
      this.isAnimating = false;
      this.checkNext();
    }
  }

  checkNext() {
    if (this.phase !== 'DATA_TRANSMISSION') return;
    if (this.isAnimating || this.activePacket) return;
    if (this.pendingQueue.length === 0) return;

    // Pop exactly one packet
    this.activePacket = this.pendingQueue.shift();
    this.isAnimating = true;
  }

  arriveActivePacket() {
    assert(this.activePacket, 'No active packet moving');
    assert(this.isAnimating, 'Animation not running');

    // Packet arrives at receiver or router drop point
    const completed = {
      ...this.activePacket,
      status: this.activePacket.outcome || 'received',
      completedAt: Date.now()
    };
    
    // Only now add to completed history
    this.completedHistory.push(completed);
    this.activePacket = null;
    this.isAnimating = false;

    // Release next packet
    this.checkNext();
  }
}

test('Handshake enforces strictly sequential one-by-one progression', () => {
  const sm = new AnimationQueueStateMachine();
  assert.equal(sm.phase, 'IDLE');

  sm.enqueueEvent({ type: 'handshake', step: 1, name: 'TRANSFER_INIT' });
  assert.equal(sm.phase, 'HANDSHAKE_INIT');
  assert.equal(sm.handshakeStep, 1);
  assert.equal(sm.isAnimating, true);

  // Step 1 finishes: Sender -> Receiver
  sm.completeHandshakeStep(1);
  assert.equal(sm.phase, 'HANDSHAKE_READY');
  assert.equal(sm.handshakeStep, 2);

  // Step 2 finishes: Receiver -> Sender
  sm.completeHandshakeStep(2);
  assert.equal(sm.phase, 'HANDSHAKE_START');
  assert.equal(sm.handshakeStep, 3);

  // Step 3 finishes: Sender -> Receiver
  sm.completeHandshakeStep(3);
  assert.equal(sm.phase, 'DATA_TRANSMISSION');
  assert.equal(sm.handshakeCompleted.length, 3);
});

test('Data packets move one at a time and appear in history strictly after arrival', () => {
  const sm = new AnimationQueueStateMachine();
  // Complete handshake
  sm.enqueueEvent({ type: 'handshake', step: 1 });
  sm.completeHandshakeStep(1);
  sm.completeHandshakeStep(2);
  sm.completeHandshakeStep(3);
  assert.equal(sm.phase, 'DATA_TRANSMISSION');

  // Enqueue 3 packets from engine
  sm.enqueueEvent({ type: 'packet_transmitted', packetId: 1 });
  sm.enqueueEvent({ type: 'packet_transmitted', packetId: 2 });
  sm.enqueueEvent({ type: 'packet_transmitted', packetId: 3 });

  // Only packet 1 is active; packets 2 and 3 remain in pendingQueue
  assert.equal(sm.activePacket.id, 1);
  assert.equal(sm.isAnimating, true);
  assert.equal(sm.pendingQueue.length, 2);
  assert.equal(sm.completedHistory.length, 0, 'Packet must NOT appear in history before arrival');

  // Packet 1 receives outcome and arrives
  sm.enqueueEvent({ type: 'packet_received', packetId: 1 });
  sm.arriveActivePacket();

  // Packet 1 in history, Packet 2 now active
  assert.equal(sm.completedHistory.length, 1);
  assert.equal(sm.completedHistory[0].id, 1);
  assert.equal(sm.completedHistory[0].status, 'received');
  assert.equal(sm.activePacket.id, 2);

  // Packet 2 dropped
  sm.enqueueEvent({ type: 'packet_dropped', packetId: 2 });
  sm.arriveActivePacket();

  assert.equal(sm.completedHistory.length, 2);
  assert.equal(sm.completedHistory[1].id, 2);
  assert.equal(sm.completedHistory[1].status, 'dropped');
  assert.equal(sm.activePacket.id, 3);

  // Packet 3 arrives
  sm.arriveActivePacket();
  assert.equal(sm.completedHistory.length, 3);
  assert.equal(sm.activePacket, null);
  assert.equal(sm.isAnimating, false);
});
