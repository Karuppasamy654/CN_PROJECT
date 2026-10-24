import React from 'react';
import { ArrowRight, XCircle, CheckCircle2 } from 'lucide-react';

export default function PacketTransmissionPanel({ events = [], protocol = 'rlnc', isRunning }) {
  // Check if initialization has completed
  const hasFinishedInit = events.some(e => (e.type === 'handshake_step' && e.step >= 4) || e.type === 'packet_transmitted' || e.type === 'packet_received');

  // Extract real packet events
  const txEvents = events.filter(e => e.type === 'packet_transmitted');
  const dropMap = new Map();
  events.filter(e => e.type === 'packet_dropped').forEach(e => dropMap.set(e.seq_id, e));
  const rxMap = new Map();
  events.filter(e => e.type === 'packet_received').forEach(e => rxMap.set(e.seq_id, e));
  const ackMap = new Map();
  events.filter(e => e.type === 'rudp_ack').forEach(e => ackMap.set(e.ack_seq, e));

  // Build real packet cards strictly from engine events, keyed by (gen_id, seq_id)
  const packetMap = new Map();
  const txCountMap = new Map();

  if (hasFinishedInit && txEvents.length > 0) {
    for (const tx of txEvents) {
      const genId = tx.gen_id ?? 0;
      const key = `gen-${genId}-seq-${tx.seq_id}`;
      const attempts = (txCountMap.get(key) || 0) + 1;
      txCountMap.set(key, attempts);

      const isDropped = dropMap.has(tx.seq_id);
      const rx = rxMap.get(tx.seq_id);
      const isAcked = ackMap.has(tx.seq_id);

      let status = 'Send';
      let timestamp = tx.time;

      if (isAcked) {
        status = 'ACKed';
        timestamp = ackMap.get(tx.seq_id).time;
      } else if (rx) {
        status = 'Received';
        timestamp = rx.time;
      } else if (isDropped) {
        status = 'Lost';
        timestamp = dropMap.get(tx.seq_id).time;
      }

      const label = genId > 0 ? `G${genId}:P${tx.seq_id + 1}` : `P${tx.seq_id + 1}`;

      packetMap.set(key, {
        key,
        id: label,
        seqId: tx.seq_id,
        genId,
        status,
        timestamp,
        attempts,
        pktType: tx.pkt_type || 'Data',
      });
    }
  }
  const packets = Array.from(packetMap.values());

  const titleProtocol = protocol === 'rudp' ? 'Reliable UDP' : 'Network Coding';

  return (
    <div className="glass-panel" style={{ padding: '16px', background: '#0d1b2e', borderRadius: '10px', border: '1px solid #1e3a5f' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#fff', fontFamily: 'var(--font-heading)', margin: 0 }}>
          Packet Transmission ({titleProtocol})
        </h3>
        {packets.length > 0 && (
          <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>
            Active Packets: {packets.length}
          </span>
        )}
      </div>

      {packets.length === 0 ? (
        <div style={{
          padding: '28px 16px',
          textAlign: 'center',
          color: '#64748b',
          fontSize: '0.78rem',
          background: 'rgba(15, 23, 42, 0.5)',
          borderRadius: '8px',
          border: '1px dashed #1e3a5f',
        }}>
          {isRunning
            ? 'Waiting for UDP initialization (TRANSFER_INIT / READY / START) to complete...'
            : 'Click "Start Transfer" to initiate UDP connection and transmit packets.'}
        </div>
      ) : (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          overflowX: 'auto',
          padding: '8px 4px',
        }}>
          {packets.map((pkt, idx) => {
            let bg = '#eff6ff';
            let border = '#bfdbfe';
            let textColor = '#1d4ed8';
            let subText = 'Send';
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
              subText = protocol === 'rudp' ? 'Rx (Wait ACK)' : 'Received ✓';
              subColor = '#059669';
            }

            return (
              <React.Fragment key={pkt.key}>
                <div style={{
                  minWidth: '76px',
                  height: '84px',
                  background: bg,
                  border: `1.5px solid ${border}`,
                  borderRadius: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '6px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                  flexShrink: 0,
                  transition: 'all 0.2s ease',
                }}>
                  <div style={{ fontSize: '0.94rem', fontWeight: 800, color: textColor, fontFamily: 'var(--font-mono)' }}>
                    {pkt.id}
                  </div>
                  {pkt.attempts > 1 && (
                    <div style={{ fontSize: '0.58rem', fontWeight: 800, color: '#f97316', lineHeight: 1 }}>
                      Retry #{pkt.attempts}
                    </div>
                  )}
                  <div style={{
                    fontSize: '0.66rem',
                    fontWeight: 700,
                    color: subColor,
                    marginTop: '2px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                  }}>
                    {subText}
                  </div>
                  {pkt.timestamp !== undefined && (
                    <div style={{ fontSize: '0.55rem', color: '#64748b', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                      {pkt.timestamp.toFixed(1)}ms
                    </div>
                  )}
                </div>

                {idx < packets.length - 1 && (
                  <div style={{ color: '#64748b', fontSize: '0.9rem', fontWeight: 700, userSelect: 'none' }}>
                    →
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
