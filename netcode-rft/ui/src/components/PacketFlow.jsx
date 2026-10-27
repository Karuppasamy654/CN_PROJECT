import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Laptop, Monitor, Server, X, Check, Mail, ArrowRight, ArrowLeft, ShieldAlert } from 'lucide-react';

export default function PacketFlow({ transfer, events, playbackIndex }) {
  const visibleEvents = useMemo(() => {
    return (events || []).slice(0, (playbackIndex ?? 0) + 1);
  }, [events, playbackIndex]);

  // Derive recent packet lifecycle states from actual engine events
  const { activeOutgoing, activeAtRouter, activeIncoming, activeAcks, lastStats } = useMemo(() => {
    const txMap = new Map();
    let sentCount = 0;
    let droppedCount = 0;
    let receivedCount = 0;

    for (const e of visibleEvents) {
      if (e.type === 'packet_transmitted') {
        sentCount++;
        txMap.set(e.seq_id, {
          seq: e.seq_id,
          genId: e.gen_id,
          type: e.pkt_type,
          id: `Pkt #${e.seq_id + 1}`,
          lifecycle: 'IN_TRANSIT_TO_ROUTER',
          timestamp: e.time,
        });
      } else if (e.type === 'packet_dropped') {
        droppedCount++;
        const p = txMap.get(e.seq_id);
        if (p) {
          p.lifecycle = 'DROPPED_AT_ROUTER';
          p.dropReason = e.reason || 'Loss simulated';
        }
      } else if (e.type === 'packet_received') {
        receivedCount++;
        const p = txMap.get(e.seq_id);
        if (p) {
          p.lifecycle = 'RECEIVED_AT_RECEIVER';
        }
      }
    }

    // Collect recent transmissions for visible animation window
    const recentTx = Array.from(txMap.values()).slice(-7);

    const outgoing = recentTx.filter(p => p.lifecycle === 'IN_TRANSIT_TO_ROUTER');
    const atRouter = recentTx.filter(p => p.lifecycle === 'DROPPED_AT_ROUTER');
    const incoming = recentTx.filter(p => p.lifecycle === 'RECEIVED_AT_RECEIVER');

    // Recent RUDP acknowledgments (traveling backwards from receiver to sender)
    const recentAcks = visibleEvents
      .filter(e => e.type === 'rudp_ack')
      .slice(-3)
      .map((e, idx) => ({
        key: `ack-${e.ack_seq}-${e.time || idx}`,
        id: `ACK #${e.ack_seq + 1}`,
        ackSeq: e.ack_seq,
      }));

    return {
      activeOutgoing: outgoing.slice(-3),
      activeAtRouter: atRouter.slice(-2),
      activeIncoming: incoming.slice(-3),
      activeAcks: recentAcks,
      lastStats: { sentCount, droppedCount, receivedCount },
    };
  }, [visibleEvents]);

  const lossPct = transfer?.lossRate !== undefined ? Math.round(transfer.lossRate * 100) : 0;
  const delayMs = transfer?.delayMs || 0;
  const reorder = transfer?.reorder ? 'ON' : 'OFF';
  const port = transfer?.port || 9000;

  return (
    <div className="glass-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '10px 14px', position: 'relative', overflow: 'hidden' }}>
      {/* Top Header: Channel Parameters and Telemetry */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: '#fff', letterSpacing: '0.5px' }}>
            Live UDP Network Path Simulation
          </span>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            [SENDER → NETWORK → RECEIVER]
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="badge-param badge-loss">Loss Rate: {lossPct}%</span>
          <span className="badge-param badge-delay">Delay: {delayMs} ms</span>
          <span className="badge-param badge-reorder">Reorder: {reorder}</span>
        </div>
      </div>

      {/* Main Conduit Canvas */}
      <div style={{
        flex: 1,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        background: 'radial-gradient(ellipse at center, rgba(14, 165, 233, 0.08) 0%, rgba(5, 10, 24, 0.75) 85%)',
        borderRadius: '8px',
        border: '1px solid rgba(0, 240, 255, 0.15)',
        overflow: 'hidden',
      }}>
        {/* Continuous Flow Guidance Tracks */}
        <div style={{
          position: 'absolute',
          left: '70px',
          right: '70px',
          top: '46%',
          height: '2px',
          background: 'linear-gradient(90deg, rgba(14, 165, 233, 0.5) 0%, rgba(0, 240, 255, 0.8) 50%, rgba(16, 185, 129, 0.6) 100%)',
          boxShadow: '0 0 10px rgba(0, 240, 255, 0.4)',
          zIndex: 1,
        }} />

        {/* 1. SENDER COMPUTER (Left) */}
        <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '84px' }}>
          <div style={{
            width: '52px',
            height: '44px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.35), rgba(15, 23, 42, 0.95))',
            border: '1.5px solid var(--cyan-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 14px rgba(14, 165, 233, 0.5)',
          }}>
            <Laptop size={26} color="var(--cyan-primary)" />
          </div>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, marginTop: '3px', color: '#fff' }}>Sender (Client)</span>
          <span style={{ fontSize: '0.62rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            127.0.0.1:TX
          </span>
          <span style={{ fontSize: '0.62rem', background: 'rgba(14, 165, 233, 0.2)', color: '#38bdf8', padding: '1px 5px', borderRadius: '3px', marginTop: '2px' }}>
            Sent: {lastStats.sentCount}
          </span>
        </div>

        {/* 2. OUTGOING PACKETS CONDUIT (Sender → Router) */}
        <div style={{
          position: 'relative',
          zIndex: 3,
          flex: 1,
          height: '64px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 8px',
          borderLeft: '1px dashed rgba(0, 240, 255, 0.2)',
          borderRight: '1px dashed rgba(0, 240, 255, 0.2)',
          background: 'rgba(14, 165, 233, 0.03)',
        }}>
          <div style={{ position: 'absolute', top: '4px', fontSize: '0.6rem', color: 'rgba(56, 189, 248, 0.7)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '3px' }}>
            <span>Outgoing Datagrams</span>
            <ArrowRight size={10} />
          </div>

          <AnimatePresence>
            {activeOutgoing.map((pkt) => (
              <motion.div
                key={`out-${pkt.seq}`}
                initial={{ x: -40, opacity: 0, scale: 0.8 }}
                animate={{ x: 0, opacity: 1, scale: 1 }}
                exit={{ x: 40, opacity: 0 }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
                style={{
                  margin: '0 4px',
                  padding: '3px 7px',
                  borderRadius: '5px',
                  background: 'rgba(14, 165, 233, 0.25)',
                  border: '1.5px solid var(--cyan-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  boxShadow: '0 0 10px rgba(0, 240, 255, 0.5)',
                  whiteSpace: 'nowrap',
                }}
              >
                <Mail size={12} color="var(--cyan-primary)" />
                <span style={{ fontSize: '0.68rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#38bdf8' }}>
                  {pkt.id}
                </span>
                <span style={{ fontSize: '0.58rem', color: 'var(--text-muted)' }}>({pkt.type})</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* 3. NETWORK ROUTER & IMPAIRMENT LAYER (Center) */}
        <div style={{ position: 'relative', zIndex: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '94px' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(245, 158, 11, 0.3) 0%, rgba(15, 23, 42, 0.95) 75%)',
            border: '2px solid rgba(245, 158, 11, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 16px rgba(245, 158, 11, 0.5)',
            position: 'relative',
          }}>
            <Server size={22} color="#fbbf24" />
          </div>

          <span style={{ fontSize: '0.74rem', fontWeight: 700, marginTop: '3px', color: '#fbbf24' }}>P2P Channel</span>
          <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>RateErrorModel Drop Sink</span>

          {/* Visible Impairment Drop Indicator at Router */}
          <AnimatePresence>
            {activeAtRouter.map((droppedPkt) => (
              <motion.div
                key={`drop-${droppedPkt.seq}`}
                initial={{ scale: 0.5, y: -5, opacity: 0 }}
                animate={{ scale: 1, y: 0, opacity: 1 }}
                exit={{ scale: 0.7, opacity: 0 }}
                transition={{ duration: 0.4 }}
                style={{
                  position: 'absolute',
                  top: '-26px',
                  background: 'rgba(239, 68, 68, 0.95)',
                  border: '1px solid #f87171',
                  color: '#fff',
                  fontSize: '0.62rem',
                  fontWeight: 800,
                  padding: '2px 6px',
                  borderRadius: '4px',
                  boxShadow: '0 0 12px rgba(239, 68, 68, 0.9)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  whiteSpace: 'nowrap',
                  zIndex: 10,
                }}
              >
                <X size={12} strokeWidth={3} />
                <span>{droppedPkt.id} DROPPED ({lossPct}% loss)</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* 4. INCOMING PACKETS CONDUIT (Router → Receiver) */}
        <div style={{
          position: 'relative',
          zIndex: 3,
          flex: 1,
          height: '64px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 8px',
          borderLeft: '1px dashed rgba(16, 185, 129, 0.2)',
          borderRight: '1px dashed rgba(16, 185, 129, 0.2)',
          background: 'rgba(16, 185, 129, 0.03)',
        }}>
          <div style={{ position: 'absolute', top: '4px', fontSize: '0.6rem', color: 'rgba(52, 211, 153, 0.8)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '3px' }}>
            <ArrowRight size={10} />
            <span>Incoming Datagrams</span>
          </div>

          <AnimatePresence>
            {activeIncoming.map((pkt) => (
              <motion.div
                key={`in-${pkt.seq}`}
                initial={{ x: -30, opacity: 0, scale: 0.8 }}
                animate={{ x: 0, opacity: 1, scale: 1 }}
                exit={{ x: 30, opacity: 0 }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
                style={{
                  margin: '0 4px',
                  padding: '3px 7px',
                  borderRadius: '5px',
                  background: 'rgba(16, 185, 129, 0.25)',
                  border: '1.5px solid var(--green-success)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  boxShadow: '0 0 10px rgba(16, 185, 129, 0.5)',
                  whiteSpace: 'nowrap',
                }}
              >
                <Check size={12} color="var(--green-success)" strokeWidth={3} />
                <span style={{ fontSize: '0.68rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#34d399' }}>
                  {pkt.id}
                </span>
                <span style={{ fontSize: '0.58rem', color: '#a7f3d0' }}>Delivered</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* 5. RECEIVER COMPUTER (Right) */}
        <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '84px' }}>
          <div style={{
            width: '52px',
            height: '44px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.35), rgba(15, 23, 42, 0.95))',
            border: '1.5px solid var(--green-success)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 14px rgba(16, 185, 129, 0.5)',
          }}>
            <Monitor size={26} color="var(--green-success)" />
          </div>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, marginTop: '3px', color: '#fff' }}>Receiver</span>
          <span style={{ fontSize: '0.62rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            127.0.0.1:{port}
          </span>
          <span style={{ fontSize: '0.62rem', background: 'rgba(16, 185, 129, 0.2)', color: '#34d399', padding: '1px 5px', borderRadius: '3px', marginTop: '2px' }}>
            Recv: {lastStats.receivedCount}
          </span>
        </div>

        {/* 6. REVERSE ACK CHANNEL (For Reliable UDP: Receiver → Sender) */}
        {activeAcks.length > 0 && (
          <div style={{
            position: 'absolute',
            bottom: '4px',
            left: '80px',
            right: '80px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            zIndex: 5,
          }}>
            <div style={{ fontSize: '0.58rem', color: 'rgba(56, 189, 248, 0.8)', display: 'flex', alignItems: 'center', gap: '3px' }}>
              <ArrowLeft size={10} />
              <span>Reverse ACK Channel:</span>
            </div>
            {activeAcks.map(ack => (
              <span
                key={ack.key}
                style={{
                  fontSize: '0.6rem',
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  background: 'rgba(14, 165, 233, 0.3)',
                  border: '1px solid rgba(0, 240, 255, 0.5)',
                  color: '#38bdf8',
                  padding: '1px 5px',
                  borderRadius: '3px',
                }}
              >
                {ack.id}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
