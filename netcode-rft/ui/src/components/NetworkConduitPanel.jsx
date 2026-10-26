import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Laptop,
  Monitor,
  Server,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Mail,
  Zap,
  Layers,
  Clock,
  Check,
} from 'lucide-react';

export default function NetworkConduitPanel({
  events = [],
  protocol = 'rlnc',
  isRunning = false,
  isCompleted = false,
  transfer = null,
}) {
  // Accessibility check for reduced motion
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);
    const handler = (e) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Animation duration (responsive, visible ~0.85 seconds)
  const animDuration = prefersReducedMotion ? 0.1 : 0.85;

  // -------------------------------------------------------------
  // ANIMATION QUEUE & STATE MACHINE
  // -------------------------------------------------------------
  // Phases: 'IDLE' | 'HANDSHAKE_INIT' | 'HANDSHAKE_READY' | 'HANDSHAKE_START' | 'HANDSHAKE_COMPLETE' | 'DATA_TRANSMISSION' | 'COMPLETED'
  const [animationPhase, setAnimationPhase] = useState('IDLE');

  // Section 1: Handshake Step Status
  const [handshakeStatus, setHandshakeStatus] = useState({
    init: 'pending',   // 'pending' | 'in_transit' | 'completed'
    ready: 'pending',  // 'pending' | 'in_transit' | 'completed'
    start: 'pending',  // 'pending' | 'in_transit' | 'completed'
  });

  // Section 2: Currently Active Live Animating Item (AT MOST ONE!)
  const [activeAnimation, setActiveAnimation] = useState(null);

  // Section 3: Completed Packet Transmission History (wrapping grid)
  const [completedHistory, setCompletedHistory] = useState([]);

  // Node pulses
  const [nodePulse, setNodePulse] = useState({ sender: false, router: false, receiver: false });

  // RLNC Rank
  const [rlncRank, setRlncRank] = useState({ rank: 0, required: transfer?.K || 4 });

  // Queue references for deterministic, non-competing event processing
  const queueStateRef = useRef({
    transferId: null,
    pendingData: [],
    outcomes: new Map(), // seq_id -> { status: 'received' | 'dropped', time }
    acks: new Map(),     // ack_seq -> { time }
    enqueuedTxKeys: new Set(),
    isBusy: false,
    timerId: null,
  });

  // Reset queue when transfer changes
  useEffect(() => {
    if (transfer?.id !== queueStateRef.current.transferId) {
      if (queueStateRef.current.timerId) {
        clearTimeout(queueStateRef.current.timerId);
      }
      queueStateRef.current = {
        transferId: transfer?.id || null,
        pendingData: [],
        outcomes: new Map(),
        acks: new Map(),
        enqueuedTxKeys: new Set(),
        isBusy: false,
        timerId: null,
      };
      setAnimationPhase('IDLE');
      setHandshakeStatus({ init: 'pending', ready: 'pending', start: 'pending' });
      setActiveAnimation(null);
      setCompletedHistory([]);
      setNodePulse({ sender: false, router: false, receiver: false });
      setRlncRank({ rank: 0, required: transfer?.K || 4 });
    }
  }, [transfer?.id]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (queueStateRef.current.timerId) {
        clearTimeout(queueStateRef.current.timerId);
      }
    };
  }, []);

  // -------------------------------------------------------------
  // INGESTION: Read authoritative engine events into the queue
  // -------------------------------------------------------------
  useEffect(() => {
    if (!events || events.length === 0) return;

    for (const e of events) {
      const seqId = e.seq_id ?? e.packet_index ?? 0;
      const genId = e.gen_id ?? 0;

      if (e.type === 'packet_dropped' || e.type === 'phy_drop') {
        queueStateRef.current.outcomes.set(seqId, { status: 'dropped', time: e.time });
      } else if (e.type === 'packet_received') {
        queueStateRef.current.outcomes.set(seqId, { status: 'received', time: e.time });
      } else if (e.type === 'rudp_ack' || e.type === 'ack_sent' || e.type === 'ack_received') {
        const ackId = e.ack_seq ?? seqId;
        queueStateRef.current.acks.set(ackId, { time: e.time });
      } else if (e.type === 'gen_ack_sent' || e.type === 'gen_ack_received') {
        queueStateRef.current.acks.set(genId, { time: e.time });
      } else if (e.type === 'decoder_matrix_update' || e.type === 'decoder_step') {
        setRlncRank({ rank: e.rank, required: e.required_rank || transfer?.K || 4 });
      } else if (e.type === 'packet_transmitted' || e.type === 'packet_sent') {
        const uniqueKey = `tx-${genId}-${seqId}-${e.time ?? ''}-${e.retry ?? 0}`;
        if (!queueStateRef.current.enqueuedTxKeys.has(uniqueKey)) {
          queueStateRef.current.enqueuedTxKeys.add(uniqueKey);
          queueStateRef.current.pendingData.push({
            seqId,
            genId,
            retry: e.retry ?? 0,
            payloadLen: e.payload_len || 1024,
            time: e.time,
            uniqueKey,
            coded: e.coded,
            pkt_type: e.pkt_type,
          });
        }
      }
    }
  }, [events]);

  // -------------------------------------------------------------
  // CONTROLLER LOOP: Strict Sequential State Machine
  // Exactly ONE moving packet at any time.
  // Sequence: Handshake Step 1 -> Step 2 -> Step 3 -> Handshake Complete ->
  // Data Packet: Move -> Arrive/Drop -> (ACK if RUDP) -> History -> Next Packet!
  // -------------------------------------------------------------
  useEffect(() => {
    // If the controller is currently executing an animation step, do not re-trigger
    if (queueStateRef.current.isBusy || activeAnimation !== null) {
      return;
    }

    const hasInitEvent = events.some(e => e.type === 'handshake_step' && e.step >= 1);
    const hasReadyEvent = events.some(e => e.type === 'handshake_step' && e.step >= 2);
    const hasStartEvent = events.some(e => e.type === 'handshake_step' && e.step >= 3);
    const hasAnyHandshake = hasInitEvent || hasReadyEvent || hasStartEvent;

    // Direct transition for NS-3 / protocols without synthetic application handshake
    if (!hasAnyHandshake && (animationPhase === 'IDLE' || animationPhase === 'HANDSHAKE_INIT')) {
      if (queueStateRef.current.pendingData.length > 0 || isRunning) {
        setAnimationPhase('DATA_TRANSMISSION');
        setHandshakeStatus({ init: 'completed', ready: 'completed', start: 'completed' });
        return;
      }
    }

    // =========================================================
    // PHASE A: THREE-WAY APPLICATION HANDSHAKE
    // =========================================================

    // STEP 1: TRANSFER_INIT (Sender -> Receiver)
    if (
      hasInitEvent &&
      handshakeStatus.init === 'pending' &&
      (animationPhase === 'IDLE' || animationPhase === 'HANDSHAKE_INIT')
    ) {
      queueStateRef.current.isBusy = true;
      setAnimationPhase('HANDSHAKE_INIT');
      setHandshakeStatus(prev => ({ ...prev, init: 'in_transit' }));
      setNodePulse({ sender: true, router: false, receiver: false });

      setActiveAnimation({
        id: 'hs-init',
        kind: 'handshake',
        step: 1,
        label: 'TRANSFER_INIT',
        direction: 'forward', // L -> R
        target: 'receiver',
        color: '#f59e0b',
        time: events.find(e => e.type === 'handshake_step' && e.step === 1)?.time || 0,
      });

      queueStateRef.current.timerId = setTimeout(() => {
        // Reached receiver
        setNodePulse({ sender: false, router: false, receiver: true });
        setHandshakeStatus(prev => ({ ...prev, init: 'completed' }));
        setActiveAnimation(null);
        queueStateRef.current.isBusy = false;
        setAnimationPhase('HANDSHAKE_READY');
      }, animDuration * 1000);

      return;
    }

    // STEP 2: TRANSFER_READY (Receiver -> Sender)
    if (
      handshakeStatus.init === 'completed' &&
      handshakeStatus.ready === 'pending' &&
      (hasReadyEvent || isRunning) &&
      animationPhase === 'HANDSHAKE_READY'
    ) {
      queueStateRef.current.isBusy = true;
      setHandshakeStatus(prev => ({ ...prev, ready: 'in_transit' }));
      setNodePulse({ sender: false, router: false, receiver: true });

      setActiveAnimation({
        id: 'hs-ready',
        kind: 'handshake',
        step: 2,
        label: 'TRANSFER_READY',
        direction: 'reverse', // R -> L
        target: 'sender',
        color: '#10b981',
        time: events.find(e => e.type === 'handshake_step' && e.step === 2)?.time || 0,
      });

      queueStateRef.current.timerId = setTimeout(() => {
        // Reached sender
        setNodePulse({ sender: true, router: false, receiver: false });
        setHandshakeStatus(prev => ({ ...prev, ready: 'completed' }));
        setActiveAnimation(null);
        queueStateRef.current.isBusy = false;
        setAnimationPhase('HANDSHAKE_START');
      }, animDuration * 1000);

      return;
    }

    // STEP 3: TRANSFER_START (Sender -> Receiver)
    if (
      handshakeStatus.ready === 'completed' &&
      handshakeStatus.start === 'pending' &&
      (hasStartEvent || isRunning) &&
      animationPhase === 'HANDSHAKE_START'
    ) {
      queueStateRef.current.isBusy = true;
      setHandshakeStatus(prev => ({ ...prev, start: 'in_transit' }));
      setNodePulse({ sender: true, router: false, receiver: false });

      setActiveAnimation({
        id: 'hs-start',
        kind: 'handshake',
        step: 3,
        label: 'TRANSFER_START',
        direction: 'forward', // L -> R
        target: 'receiver',
        color: '#38bdf8',
        time: events.find(e => e.type === 'handshake_step' && e.step === 3)?.time || 0,
      });

      queueStateRef.current.timerId = setTimeout(() => {
        // Reached receiver and handshake is completely established
        setNodePulse({ sender: false, router: false, receiver: true });
        setHandshakeStatus(prev => ({ ...prev, start: 'completed' }));
        setActiveAnimation(null);
        queueStateRef.current.isBusy = false;
        setAnimationPhase('DATA_TRANSMISSION');
      }, animDuration * 1000);

      return;
    }

    // =========================================================
    // PHASE B: DATA PACKET TRANSMISSION
    // Only starts after Handshake is completely finished!
    // =========================================================
    if (
      (!hasAnyHandshake || handshakeStatus.start === 'completed') &&
      (animationPhase === 'DATA_TRANSMISSION' || animationPhase === 'HANDSHAKE_COMPLETE')
    ) {
      // If there are pending data packets in the queue, process the next packet
      if (queueStateRef.current.pendingData.length > 0) {
        queueStateRef.current.isBusy = true;
        const nextData = queueStateRef.current.pendingData.shift();

        // Count previous transmission attempts for this packet ID
        const previousAttempts = completedHistory.filter(
          p => p.seqId === nextData.seqId && p.genId === nextData.genId
        ).length;
        const attempt = previousAttempts + 1;
        const isRetransmission = attempt > 1;

        // Resolve authentic outcome from engine events
        const rxEventsForThis = events.filter(e =>
          e.type === 'packet_received' &&
          (e.seq_id === nextData.seqId || e.packet_index === nextData.seqId)
        );

        const explicitDrop = events.some(e =>
          (e.type === 'packet_dropped' || e.type === 'phy_drop') &&
          (e.seq_id === nextData.seqId || e.packet_index === nextData.seqId)
        );

        const totalTxForThis = events.filter(e =>
          (e.type === 'packet_transmitted' || e.type === 'packet_sent') &&
          (e.seq_id === nextData.seqId || e.packet_index === nextData.seqId)
        ).length;

        let isDropped = false;
        if (protocol === 'rudp') {
          // In RUDP: if there are subsequent attempts for this seqId, this attempt was lost/timed out
          if (attempt < totalTxForThis) {
            isDropped = true;
          } else {
            isDropped = rxEventsForThis.length === 0 || explicitDrop;
          }
        } else {
          // In RLNC: packet is dropped if receiver never received it, or an explicit drop was recorded
          if (rxEventsForThis.length === 0) {
            isDropped = true;
          } else {
            isDropped = explicitDrop;
          }
        }

        const target = isDropped ? 'router' : 'receiver';

        const label = nextData.genId > 0
          ? `G${nextData.genId}:P${nextData.seqId + 1}`
          : `P${nextData.seqId + 1}`;

        // 1. START & MOVE: Show packet moving
        setNodePulse({ sender: true, router: false, receiver: false });
        setActiveAnimation({
          id: `live-${nextData.uniqueKey}`,
          kind: 'data',
          seqId: nextData.seqId,
          genId: nextData.genId,
          attempt,
          isRetransmission,
          label: isRetransmission ? `${label} (Retry #${attempt})` : label,
          direction: 'forward', // L -> R
          target,
          status: isDropped ? 'dropped' : 'received',
          color: isDropped ? '#ef4444' : isRetransmission ? '#f97316' : '#00f0ff',
          time: nextData.time,
        });

        // 2. ARRIVE & UPDATE: When animation reaches destination
        queueStateRef.current.timerId = setTimeout(() => {
          if (isDropped) {
            // Stops at Router, pulses Router
            setNodePulse({ sender: false, router: true, receiver: false });
          } else {
            // Reaches Receiver, pulses Receiver
            setNodePulse({ sender: false, router: false, receiver: true });
          }

          // Check if Reliable UDP ACK should follow
          const hasAck = protocol === 'rudp' && !isDropped && queueStateRef.current.acks.has(nextData.seqId);

          const finalizePacket = () => {
            // 3. ADD TO HISTORY: Completed card is added to history ONLY AFTER movement finishes
            const finalStatus = isDropped ? 'Lost' : (hasAck || protocol === 'rudp') ? 'ACKed' : 'Received';
            setCompletedHistory(prev => [
              ...prev,
              {
                key: `hist-${nextData.genId}-${nextData.seqId}-${attempt}`,
                id: label,
                seqId: nextData.seqId,
                genId: nextData.genId,
                attempt,
                status: finalStatus,
                timestamp: nextData.time,
              },
            ]);

            // 4. NEXT: Clear active packet and release controller for next packet
            setActiveAnimation(null);
            queueStateRef.current.isBusy = false;
          };

          if (hasAck) {
            // Animate ACK datagram moving Receiver -> Sender
            setActiveAnimation({
              id: `ack-${nextData.seqId}`,
              kind: 'ack',
              label: `ACK #${nextData.seqId + 1}`,
              direction: 'reverse', // R -> L
              target: 'sender',
              status: 'acked',
              color: '#10b981',
              time: queueStateRef.current.acks.get(nextData.seqId)?.time || nextData.time,
            });

            setNodePulse({ sender: false, router: false, receiver: true });

            queueStateRef.current.timerId = setTimeout(() => {
              setNodePulse({ sender: true, router: false, receiver: false });
              finalizePacket();
            }, animDuration * 0.75 * 1000);
          } else {
            finalizePacket();
          }
        }, animDuration * 1000);

        return;
      }

      // If pending queue is empty and transfer has completed
      if (isCompleted && queueStateRef.current.pendingData.length === 0) {
        setAnimationPhase('COMPLETED');
        setNodePulse({ sender: false, router: false, receiver: false });
      }
    }
  }, [
    events,
    animationPhase,
    activeAnimation,
    handshakeStatus,
    completedHistory,
    isRunning,
    isCompleted,
    protocol,
    animDuration,
  ]);

  const lossPct = transfer?.lossRate !== undefined ? Math.round(Number(transfer.lossRate)) : 10;
  const hasInitEvent = events.some(e => e.type === 'handshake_step' && e.step >= 1);
  const hasReadyEvent = events.some(e => e.type === 'handshake_step' && e.step >= 2);
  const hasStartEvent = events.some(e => e.type === 'handshake_step' && e.step >= 3);
  const hasAnyHandshake = hasInitEvent || hasReadyEvent || hasStartEvent;
  const isHandshakeDone = hasAnyHandshake ? handshakeStatus.start === 'completed' : true;

  return (
    <div
      className="glass-panel"
      style={{
        padding: '16px',
        background: '#0d1b2e',
        borderRadius: '10px',
        border: '1px solid #1e3a5f',
        position: 'relative',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
      }}
    >
      {/* ------------------------------------------------------- */}
      {/* HEADER: TITLE, BADGE, & SPEED CONTROL                   */}
      {/* ------------------------------------------------------- */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Zap size={16} color="var(--cyan-primary)" />
          <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#fff', fontFamily: 'var(--font-heading)', margin: 0 }}>
            UDP Network Simulation (SENDER → NETWORK → RECEIVER)
          </h3>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '12px',
              background: isCompleted
                ? 'rgba(16, 185, 129, 0.2)'
                : isRunning
                ? 'rgba(56, 189, 248, 0.2)'
                : 'rgba(100, 116, 139, 0.2)',
              color: isCompleted ? '#10b981' : isRunning ? '#38bdf8' : '#94a3b8',
              border: `1px solid ${isCompleted ? '#10b981' : isRunning ? '#38bdf8' : '#64748b'}`,
            }}
          >
            {isCompleted
              ? 'Transfer Complete ✓'
              : isRunning
              ? isHandshakeDone
                ? `Transmitting Packets (${queueStateRef.current.pendingData.length} pending)`
                : 'Handshake In Progress...'
              : 'Idle (Ready)'}
          </span>
        </div>
      </div>

      {/* ======================================================= */}
      {/* SECTION 1: HANDSHAKE PROTOCOL STATUS                    */}
      {/* Shows the three handshake steps and their exact status: */}
      {/* Pending / In transit / Completed                        */}
      {/* ======================================================= */}
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.6)',
          border: '1px solid rgba(30, 58, 95, 0.6)',
          borderRadius: '8px',
          padding: '10px 14px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {hasAnyHandshake ? 'Section 1: Application-Level UDP 3-Way Handshake' : 'Section 1: UDP Socket & Network Channel'}
          </span>
          {isHandshakeDone && (
            <span style={{ fontSize: '0.7rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 700 }}>
              <CheckCircle2 size={13} color="#10b981" />
              {hasAnyHandshake ? 'Handshake Completed' : 'Channel Initialized'}
            </span>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
          {/* Step 1 */}
          <div
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              background:
                handshakeStatus.init === 'completed'
                  ? 'rgba(56, 189, 248, 0.15)'
                  : handshakeStatus.init === 'in_transit'
                  ? 'rgba(245, 158, 11, 0.25)'
                  : 'rgba(30, 41, 59, 0.4)',
              border: `1.5px solid ${
                handshakeStatus.init === 'completed'
                  ? '#38bdf8'
                  : handshakeStatus.init === 'in_transit'
                  ? '#f59e0b'
                  : '#334155'
              }`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              transition: 'all 0.3s ease',
            }}
          >
            <div>
              <div style={{ fontSize: '0.62rem', color: '#94a3b8' }}>
                {hasAnyHandshake ? 'Step 1 (Sender → Recv)' : 'Step 1 (Socket Init)'}
              </div>
              <div style={{ fontSize: '0.72rem', fontWeight: 800, color: handshakeStatus.init === 'completed' ? '#38bdf8' : '#e2e8f0', fontFamily: 'var(--font-mono)' }}>
                {hasAnyHandshake ? 'TRANSFER_INIT' : 'SOCKET_BOUND'}
              </div>
            </div>
            <div>
              {handshakeStatus.init === 'completed' ? (
                <span style={{ fontSize: '0.65rem', color: '#38bdf8', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '2px' }}>
                  <Check size={12} strokeWidth={3} /> Done
                </span>
              ) : handshakeStatus.init === 'in_transit' ? (
                <span style={{ fontSize: '0.65rem', color: '#f59e0b', fontWeight: 800 }}>In Transit...</span>
              ) : (
                <span style={{ fontSize: '0.65rem', color: '#64748b' }}>Pending</span>
              )}
            </div>
          </div>

          {/* Step 2 */}
          <div
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              background:
                handshakeStatus.ready === 'completed'
                  ? 'rgba(16, 185, 129, 0.15)'
                  : handshakeStatus.ready === 'in_transit'
                  ? 'rgba(245, 158, 11, 0.25)'
                  : 'rgba(30, 41, 59, 0.4)',
              border: `1.5px solid ${
                handshakeStatus.ready === 'completed'
                  ? '#10b981'
                  : handshakeStatus.ready === 'in_transit'
                  ? '#f59e0b'
                  : '#334155'
              }`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              transition: 'all 0.3s ease',
            }}
          >
            <div>
              <div style={{ fontSize: '0.62rem', color: '#94a3b8' }}>
                {hasAnyHandshake ? 'Step 2 (Recv → Sender)' : 'Step 2 (P2P Channel)'}
              </div>
              <div style={{ fontSize: '0.72rem', fontWeight: 800, color: handshakeStatus.ready === 'completed' ? '#10b981' : '#e2e8f0', fontFamily: 'var(--font-mono)' }}>
                {hasAnyHandshake ? 'TRANSFER_READY' : 'P2P_LINK_ACTIVE'}
              </div>
            </div>
            <div>
              {handshakeStatus.ready === 'completed' ? (
                <span style={{ fontSize: '0.65rem', color: '#10b981', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '2px' }}>
                  <Check size={12} strokeWidth={3} /> Done
                </span>
              ) : handshakeStatus.ready === 'in_transit' ? (
                <span style={{ fontSize: '0.65rem', color: '#f59e0b', fontWeight: 800 }}>In Transit...</span>
              ) : (
                <span style={{ fontSize: '0.65rem', color: '#64748b' }}>Pending</span>
              )}
            </div>
          </div>

          {/* Step 3 */}
          <div
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              background:
                handshakeStatus.start === 'completed'
                  ? 'rgba(56, 189, 248, 0.15)'
                  : handshakeStatus.start === 'in_transit'
                  ? 'rgba(245, 158, 11, 0.25)'
                  : 'rgba(30, 41, 59, 0.4)',
              border: `1.5px solid ${
                handshakeStatus.start === 'completed'
                  ? '#38bdf8'
                  : handshakeStatus.start === 'in_transit'
                  ? '#f59e0b'
                  : '#334155'
              }`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              transition: 'all 0.3s ease',
            }}
          >
            <div>
              <div style={{ fontSize: '0.62rem', color: '#94a3b8' }}>
                {hasAnyHandshake ? 'Step 3 (Sender → Recv)' : 'Step 3 (Recv Listener)'}
              </div>
              <div style={{ fontSize: '0.72rem', fontWeight: 800, color: handshakeStatus.start === 'completed' ? '#38bdf8' : '#e2e8f0', fontFamily: 'var(--font-mono)' }}>
                {hasAnyHandshake ? 'TRANSFER_START' : 'PORT_LISTENING'}
              </div>
            </div>
            <div>
              {handshakeStatus.start === 'completed' ? (
                <span style={{ fontSize: '0.65rem', color: '#38bdf8', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '2px' }}>
                  <Check size={12} strokeWidth={3} /> Done
                </span>
              ) : handshakeStatus.start === 'in_transit' ? (
                <span style={{ fontSize: '0.65rem', color: '#f59e0b', fontWeight: 800 }}>In Transit...</span>
              ) : (
                <span style={{ fontSize: '0.65rem', color: '#64748b' }}>Pending</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ======================================================= */}
      {/* SECTION 2: LIVE PACKET TRANSMISSION                     */}
      {/* Shows AT MOST ONE moving packet at any time!           */}
      {/* SENDER on left, NETWORK ROUTER in middle, RECEIVER right*/}
      {/* ======================================================= */}
      <div
        style={{
          position: 'relative',
          height: '160px',
          background: 'radial-gradient(ellipse at center, rgba(14, 165, 233, 0.08) 0%, rgba(5, 10, 24, 0.85) 90%)',
          borderRadius: '8px',
          border: '1.5px solid rgba(0, 240, 255, 0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          overflow: 'hidden',
        }}
      >
        {/* Forward Continuous Track */}
        <div
          style={{
            position: 'absolute',
            left: '85px',
            right: '85px',
            top: '46px',
            height: '3px',
            background: 'linear-gradient(90deg, #0284c7 0%, #00f0ff 50%, #10b981 100%)',
            boxShadow: '0 0 10px rgba(0, 240, 255, 0.5)',
            zIndex: 1,
          }}
        />

        {/* Reverse ACK Continuous Track */}
        {protocol === 'rudp' && (
          <div
            style={{
              position: 'absolute',
              left: '85px',
              right: '85px',
              bottom: '36px',
              height: '2px',
              background: 'linear-gradient(270deg, #10b981 0%, #0ea5e9 100%)',
              borderStyle: 'dashed',
              zIndex: 1,
              opacity: 0.6,
            }}
          />
        )}

        {/* NODE 1: SENDER (LEFT) */}
        <div style={{ position: 'relative', zIndex: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '85px' }}>
          <motion.div
            animate={
              nodePulse.sender && !prefersReducedMotion
                ? { scale: [1, 1.08, 1], boxShadow: ['0 0 10px #0284c7', '0 0 25px #00f0ff', '0 0 10px #0284c7'] }
                : { scale: 1, boxShadow: '0 0 12px rgba(14, 165, 233, 0.4)' }
            }
            transition={{ duration: 0.6 }}
            style={{
              width: '60px',
              height: '52px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #1d4ed8, #0f172a)',
              border: '2px solid #38bdf8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#38bdf8',
            }}
          >
            <Laptop size={28} />
          </motion.div>
          <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#fff', marginTop: '4px' }}>Sender</span>
          <span style={{ fontSize: '0.62rem', fontFamily: 'var(--font-mono)', color: '#94a3b8' }}>127.0.0.1:TX</span>
        </div>

        {/* NODE 2: NETWORK ROUTER / CHANNEL (CENTER) */}
        <div style={{ position: 'relative', zIndex: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '100px' }}>
          <motion.div
            animate={
              nodePulse.router && !prefersReducedMotion
                ? { scale: [1, 1.15, 1], borderColor: ['#f59e0b', '#ef4444', '#f59e0b'], boxShadow: ['0 0 10px #f59e0b', '0 0 25px #ef4444', '0 0 10px #f59e0b'] }
                : { scale: 1, borderColor: '#f59e0b' }
            }
            transition={{ duration: 0.5 }}
            style={{
              width: '54px',
              height: '54px',
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(245, 158, 11, 0.25) 0%, rgba(15, 23, 42, 0.95) 75%)',
              border: '2px solid #f59e0b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 16px rgba(245, 158, 11, 0.4)',
              color: '#fbbf24',
            }}
          >
            <Server size={24} />
          </motion.div>
          <span style={{ fontSize: '0.76rem', fontWeight: 800, color: '#fbbf24', marginTop: '4px' }}>Network Router</span>
          <span style={{ fontSize: '0.62rem', color: '#94a3b8' }}>Channel Impairment</span>
          <span
            style={{
              fontSize: '0.62rem',
              fontWeight: 700,
              color: '#ef4444',
              background: 'rgba(239, 68, 68, 0.15)',
              padding: '1px 6px',
              borderRadius: '4px',
              marginTop: '2px',
            }}
          >
            Loss: {lossPct}%
          </span>
        </div>

        {/* NODE 3: RECEIVER (RIGHT) */}
        <div style={{ position: 'relative', zIndex: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '85px' }}>
          <motion.div
            animate={
              nodePulse.receiver && !prefersReducedMotion
                ? { scale: [1, 1.08, 1], boxShadow: ['0 0 10px #059669', '0 0 25px #10b981', '0 0 10px #059669'] }
                : { scale: 1, boxShadow: '0 0 12px rgba(16, 185, 129, 0.4)' }
            }
            transition={{ duration: 0.6 }}
            style={{
              width: '60px',
              height: '52px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #059669, #0f172a)',
              border: '2px solid #10b981',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#10b981',
            }}
          >
            <Monitor size={28} />
          </motion.div>
          <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#fff', marginTop: '4px' }}>Receiver</span>
          <span style={{ fontSize: '0.62rem', fontFamily: 'var(--font-mono)', color: '#94a3b8' }}>
            127.0.0.1:{transfer?.port || 9000}
          </span>
        </div>

        {/* IN-FLIGHT MOVING PACKET (AT MOST ONE MOVING ELEMENT!) */}
        <div
          style={{
            position: 'absolute',
            left: '85px',
            right: '85px',
            top: '0px',
            bottom: '0px',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          <AnimatePresence mode="wait">
            {activeAnimation && (() => {
              const isReverse = activeAnimation.direction === 'reverse';
              const isDropped = activeAnimation.target === 'router';

              // Percentage bounds:
              // Forward delivered: 0% -> 96%
              // Forward dropped: 0% -> 48% (Stops and dissolves at Router, never passes!)
              // Reverse ACK: 96% -> 0%
              const startLeft = isReverse ? '96%' : '0%';
              const endLeft = isReverse ? '0%' : isDropped ? '48%' : '96%';
              const topPos = isReverse ? '106px' : '36px';

              return (
                <motion.div
                  key={activeAnimation.id}
                  initial={{
                    left: startLeft,
                    top: topPos,
                    opacity: 0,
                    scale: 0.8,
                    x: '-50%',
                  }}
                  animate={{
                    left: endLeft,
                    top: topPos,
                    opacity: isDropped ? [0, 1, 1, 0] : [0, 1, 1, 1],
                    scale: isDropped ? [0.8, 1.1, 1.25, 0.3] : 1,
                    x: '-50%',
                  }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  transition={
                    prefersReducedMotion
                      ? { duration: 0.1 }
                      : { duration: isDropped ? animDuration * 0.75 : animDuration, ease: 'easeInOut' }
                  }
                  style={{
                    position: 'absolute',
                    padding: '4px 10px',
                    borderRadius: '14px',
                    background: isDropped
                      ? 'rgba(239, 68, 68, 0.95)'
                      : isReverse
                      ? 'rgba(16, 185, 129, 0.95)'
                      : activeAnimation.kind === 'handshake'
                      ? 'rgba(245, 158, 11, 0.95)'
                      : 'rgba(14, 165, 233, 0.95)',
                    border: `1.5px solid ${activeAnimation.color}`,
                    color: '#fff',
                    boxShadow: `0 0 14px ${activeAnimation.color}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontSize: '0.68rem',
                    fontWeight: 800,
                    fontFamily: 'var(--font-mono)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isDropped ? (
                    <>
                      <XCircle size={12} color="#fff" />
                      <span>{activeAnimation.label} [DROPPED ✕]</span>
                    </>
                  ) : isReverse ? (
                    <>
                      <ArrowLeft size={11} color="#fff" />
                      <span>{activeAnimation.label}</span>
                    </>
                  ) : (
                    <>
                      <Mail size={11} color="#fff" />
                      <span>{activeAnimation.label}</span>
                      <ArrowRight size={11} color="#fff" />
                    </>
                  )}
                </motion.div>
              );
            })()}
          </AnimatePresence>
        </div>

        {/* Decoder Progress & Rank Overlay for RLNC */}
        {protocol === 'rlnc' && rlncRank.required > 0 && (
          <div
            style={{
              position: 'absolute',
              bottom: '6px',
              right: '24px',
              background: 'rgba(15, 23, 42, 0.85)',
              border: '1px solid #1e3a5f',
              padding: '2px 8px',
              borderRadius: '6px',
              fontSize: '0.62rem',
              color: '#c084fc',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <Layers size={11} color="#c084fc" />
            <span>
              Decoder Rank: {rlncRank.rank} / {rlncRank.required}
              {rlncRank.rank >= rlncRank.required ? ' (Full Rank ✓)' : ''}
            </span>
          </div>
        )}
      </div>

      {/* COMPACT VISUAL STYLE LEGEND */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          padding: '6px 12px',
          background: 'rgba(15, 23, 42, 0.5)',
          borderRadius: '6px',
          border: '1px solid rgba(30, 58, 95, 0.4)',
          fontSize: '0.66rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b', boxShadow: '0 0 6px #f59e0b' }} />
          <span style={{ color: '#e2e8f0', fontWeight: 600 }}>Handshake</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#00f0ff', boxShadow: '0 0 6px #00f0ff' }} />
          <span style={{ color: '#e2e8f0', fontWeight: 600 }}>Data Packet</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f97316', boxShadow: '0 0 6px #f97316' }} />
          <span style={{ color: '#e2e8f0', fontWeight: 600 }}>Retransmission (Retry #N)</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 6px #ef4444' }} />
          <span style={{ color: '#e2e8f0', fontWeight: 600 }}>Dropped (Stopped at Router)</span>
        </div>

        {protocol === 'rudp' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 6px #10b981' }} />
            <span style={{ color: '#e2e8f0', fontWeight: 600 }}>ACK Datagram (R → L)</span>
          </div>
        )}

        {protocol === 'rlnc' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#a855f7', boxShadow: '0 0 6px #a855f7' }} />
            <span style={{ color: '#e2e8f0', fontWeight: 600 }}>Innovative Rank Recovery</span>
          </div>
        )}
      </div>

      {/* ======================================================= */}
      {/* SECTION 3: PACKET TRANSMISSION HISTORY                  */}
      {/* Displays completed packet animations in a responsive,   */}
      {/* wrapping grid of compact cards. NEVER 64 in a row!      */}
      {/* Packets appear ONLY AFTER their live animation finishes!*/}
      {/* ======================================================= */}
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.6)',
          border: '1px solid rgba(30, 58, 95, 0.6)',
          borderRadius: '8px',
          padding: '12px 14px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Section 3: Packet Transmission History ({completedHistory.length} Completed)
          </span>
          {activeAnimation && activeAnimation.kind === 'data' && (
            <span style={{ fontSize: '0.68rem', color: '#f59e0b', fontWeight: 700 }}>
              Currently in-transit: {activeAnimation.label}...
            </span>
          )}
        </div>

        {completedHistory.length === 0 ? (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              color: '#64748b',
              fontSize: '0.78rem',
              background: 'rgba(15, 23, 42, 0.4)',
              borderRadius: '6px',
              border: '1px dashed #334155',
            }}
          >
            {isHandshakeDone
              ? 'Packets will appear here one-by-one as each live movement animation completes...'
              : 'Waiting for UDP initialization handshake to complete before data packet transmissions begin...'}
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))',
              gap: '8px',
              maxHeight: '220px',
              overflowY: 'auto',
              overflowX: 'hidden',
              padding: '4px',
            }}
          >
            {completedHistory.map((pkt) => {
              let bg = '#eff6ff';
              let border = '#bfdbfe';
              let textColor = '#1d4ed8';
              let subText = 'Delivered';
              let subColor = '#3b82f6';

              if (pkt.status === 'Lost') {
                bg = '#fef2f2';
                border = '#fecaca';
                textColor = '#b91c1c';
                subText = 'Lost ✕';
                subColor = '#ef4444';
              } else if (pkt.status === 'ACKed') {
                bg = '#f0fdf4';
                border = '#86efac';
                textColor = '#15803d';
                subText = 'ACKed ✓';
                subColor = '#16a34a';
              } else if (pkt.status === 'Received') {
                bg = '#ecfdf5';
                border = '#a7f3d0';
                textColor = '#047857';
                subText = 'Received ✓';
                subColor = '#059669';
              }

              return (
                <div
                  key={pkt.key}
                  style={{
                    background: bg,
                    border: `1.5px solid ${border}`,
                    borderRadius: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '6px 4px',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div style={{ fontSize: '0.88rem', fontWeight: 800, color: textColor, fontFamily: 'var(--font-mono)' }}>
                    {pkt.id}
                  </div>
                  {pkt.attempt > 1 && (
                    <div style={{ fontSize: '0.56rem', fontWeight: 800, color: '#f97316', lineHeight: 1 }}>
                      Retry #{pkt.attempt}
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: '0.64rem',
                      fontWeight: 700,
                      color: subColor,
                      marginTop: '2px',
                    }}
                  >
                    {subText}
                  </div>
                  {pkt.timestamp !== undefined && (
                    <div style={{ fontSize: '0.52rem', color: '#64748b', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                      {pkt.timestamp.toFixed(1)}ms
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
