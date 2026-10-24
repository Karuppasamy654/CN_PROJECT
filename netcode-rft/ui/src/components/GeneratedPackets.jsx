import React, { useState, useMemo } from 'react';
import { Code2, ChevronDown, ChevronUp, Layers } from 'lucide-react';

export default function GeneratedPackets({ events, playbackIndex, K }) {
  const [selectedPkt, setSelectedPkt] = useState(null);

  const packets = useMemo(() => {
    const list = [];
    const visibleEvents = events.slice(0, playbackIndex + 1);

    for (const e of visibleEvents) {
      if (e.type === 'packet_transmitted') {
        const isSystematic = e.pkt_type === 'Systematic';
        let eq = `C${e.seq_id + 1} = `;
        if (isSystematic) {
          eq += `B${(e.seq_id % (K || 4)) + 1}`;
        } else if (e.coeffs && e.coeffs.length > 0) {
          const terms = [];
          e.coeffs.forEach((c, idx) => {
            if (c > 0) {
              terms.push(c === 1 ? `B${idx + 1}` : `${c}·B${idx + 1}`);
            }
          });
          eq += terms.length > 0 ? terms.join(' ⊕ ') : '0';
        } else {
          eq += `B${e.seq_id + 1}`;
        }

        list.push({
          id: `C${e.seq_id + 1}`,
          seq: e.seq_id,
          genId: e.gen_id,
          type: e.pkt_type,
          equation: eq,
          coeffs: e.coeffs || [],
          payloadLen: e.payload_len,
          status: 'Sent',
        });
      } else if (e.type === 'packet_dropped') {
        const found = list.find(p => p.seq === e.seq_id);
        if (found) found.status = 'Lost';
      } else if (e.type === 'packet_received') {
        const found = list.find(p => p.seq === e.seq_id);
        if (found) found.status = 'Delivered';
      }
    }
    return list;
  }, [events, playbackIndex, K]);

  return (
    <div className="glass-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '8px 12px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Code2 size={15} color="var(--cyan-primary)" />
          <span style={{ fontSize: '0.8rem', fontWeight: 700, fontFamily: 'var(--font-heading)' }}>
            Generated Packets ({packets.length})
          </span>
        </div>
      </div>

      {/* Table Container */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem', fontFamily: 'var(--font-mono)' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(0, 240, 255, 0.2)', color: 'var(--text-cyan)', textAlign: 'left' }}>
              <th style={{ padding: '4px 6px' }}>ID</th>
              <th style={{ padding: '4px 6px' }}>Type</th>
              <th style={{ padding: '4px 6px' }}>Equation</th>
              <th style={{ padding: '4px 6px', textAlign: 'right' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {packets.slice(-15).reverse().map((p) => {
              const isSelected = selectedPkt?.id === p.id;
              const isSys = p.type === 'Systematic';
              const isLost = p.status === 'Lost';
              const isDelivered = p.status === 'Delivered';

              return (
                <React.Fragment key={p.id}>
                  <tr
                    onClick={() => setSelectedPkt(isSelected ? null : p)}
                    style={{
                      borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(0, 240, 255, 0.1)' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '4px 6px', fontWeight: 700, color: 'var(--cyan-primary)' }}>{p.id}</td>
                    <td style={{ padding: '4px 6px' }}>
                      <span style={{
                        padding: '1px 5px',
                        borderRadius: '3px',
                        fontSize: '0.65rem',
                        background: isSys ? 'rgba(14, 165, 233, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                        color: isSys ? '#38bdf8' : '#fbbf24',
                        border: `1px solid ${isSys ? 'rgba(14, 165, 233, 0.4)' : 'rgba(245, 158, 11, 0.4)'}`,
                      }}>
                        {p.type}
                      </span>
                    </td>
                    <td style={{ padding: '4px 6px', color: 'var(--text-main)', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.equation}
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                      <span style={{
                        color: isLost ? 'var(--red-loss)' : isDelivered ? 'var(--green-success)' : 'var(--blue-primary)',
                        fontWeight: 600,
                      }}>
                        {p.status}
                      </span>
                    </td>
                  </tr>

                  {/* Inline Packet Inspector */}
                  {isSelected && (
                    <tr style={{ background: 'rgba(15, 23, 42, 0.95)' }}>
                      <td colSpan={4} style={{ padding: '8px', borderLeft: '2px solid var(--cyan-primary)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.7rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Packet ID: <strong>{p.id}</strong> (Gen #{p.genId})</span>
                            <span style={{ color: 'var(--text-muted)' }}>Payload: {p.payloadLen} bytes</span>
                          </div>
                          <div>
                            <span style={{ color: 'var(--text-muted)' }}>Full Equation: </span>
                            <span style={{ color: 'var(--cyan-primary)', fontWeight: 600 }}>{p.equation}</span>
                          </div>
                          {p.coeffs.length > 0 && (
                            <div>
                              <span style={{ color: 'var(--text-muted)' }}>Coefficients [GF(256)]: </span>
                              <span style={{ color: '#fbbf24' }}>[{p.coeffs.join(', ')}]</span>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
