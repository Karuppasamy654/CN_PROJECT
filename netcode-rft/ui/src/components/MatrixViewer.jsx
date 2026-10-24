import React, { useMemo } from 'react';
import { Settings, ShieldCheck, Clock } from 'lucide-react';

export default function MatrixViewer({ events, playbackIndex, K }) {
  const K_val = K || 4;

  const { receivedPackets, currentRank } = useMemo(() => {
    const list = [];
    let rank = 0;
    const visibleEvents = events.slice(0, playbackIndex + 1);

    for (const e of visibleEvents) {
      if (e.type === 'packet_received') {
        // find transmitted event to get coefficients
        const tx = visibleEvents.find(ev => ev.type === 'packet_transmitted' && ev.seq_id === e.seq_id);
        const coeffs = tx?.coeffs || [];
        list.push({
          pktId: `C${e.seq_id + 1}`,
          coeffs,
        });
      } else if (e.type === 'decoder_matrix_update') {
        rank = e.rank;
      }
    }
    return { receivedPackets: list.slice(-6), currentRank: rank };
  }, [events, playbackIndex]);

  const needed = Math.max(0, K_val - currentRank);
  const isFullRank = currentRank >= K_val;

  return (
    <div className="glass-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '8px 12px', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Settings size={15} color="var(--cyan-primary)" />
          <span style={{ fontSize: '0.8rem', fontWeight: 700, fontFamily: 'var(--font-heading)' }}>
            Receiver Decoding
          </span>
        </div>
      </div>

      <div style={{ fontSize: '0.68rem', color: 'var(--text-cyan)', marginBottom: '4px', fontWeight: 600 }}>
        Decoding Matrix (Real-time)
      </div>

      {/* Real Matrix Grid */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, marginBottom: '6px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.68rem', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(0, 240, 255, 0.2)', color: 'var(--text-muted)' }}>
              <th style={{ padding: '2px 4px', textAlign: 'left' }}>Pkt</th>
              {Array.from({ length: K_val }).map((_, i) => (
                <th key={i} style={{ padding: '2px 4px' }}>B{i + 1}</th>
              ))}
              <th style={{ padding: '2px 4px' }}>Rank</th>
            </tr>
          </thead>
          <tbody>
            {receivedPackets.map((p, idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.03)' }}>
                <td style={{ padding: '2px 4px', textAlign: 'left', fontWeight: 700, color: 'var(--cyan-primary)' }}>
                  {p.pktId}
                </td>
                {Array.from({ length: K_val }).map((_, i) => {
                  const val = p.coeffs[i] ?? 0;
                  const isNonZero = val !== 0;
                  return (
                    <td key={i} style={{ padding: '2px 4px', color: isNonZero ? '#fff' : 'rgba(148, 163, 184, 0.4)', fontWeight: isNonZero ? 700 : 400 }}>
                      {val}
                    </td>
                  );
                })}
                <td style={{ padding: '2px 4px', color: 'var(--green-success)', fontWeight: 700 }}>
                  {Math.min(K_val, idx + 1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Rank Progress Bar */}
      <div style={{ marginTop: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', fontWeight: 700, marginBottom: '4px' }}>
          <span style={{ color: 'var(--text-muted)' }}>Matrix Rank</span>
          <span style={{ color: isFullRank ? 'var(--green-success)' : 'var(--cyan-primary)', fontFamily: 'var(--font-mono)' }}>
            Rank {currentRank} / {K_val}
          </span>
        </div>

        <div style={{ width: '100%', height: '6px', background: 'rgba(15, 23, 42, 0.8)', borderRadius: '3px', overflow: 'hidden', border: '1px solid rgba(0, 240, 255, 0.2)' }}>
          <div style={{
            width: `${Math.min(100, (currentRank / K_val) * 100)}%`,
            height: '100%',
            background: isFullRank ? 'var(--green-success)' : 'linear-gradient(90deg, var(--blue-primary), var(--cyan-primary))',
            transition: 'width 0.3s ease',
            boxShadow: isFullRank ? '0 0 8px rgba(16, 185, 129, 0.6)' : '0 0 8px rgba(0, 240, 255, 0.6)',
          }} />
        </div>

        {/* Status Callout */}
        <div style={{
          marginTop: '6px',
          padding: '4px 8px',
          borderRadius: '5px',
          background: isFullRank ? 'rgba(16, 185, 129, 0.15)' : 'rgba(14, 165, 233, 0.12)',
          border: `1px solid ${isFullRank ? 'rgba(16, 185, 129, 0.4)' : 'rgba(0, 240, 255, 0.3)'}`,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '0.68rem',
          fontWeight: 600,
          color: isFullRank ? '#34d399' : 'var(--cyan-primary)',
        }}>
          {isFullRank ? <ShieldCheck size={14} /> : <Clock size={14} className="animate-pulse-glow" />}
          <span>
            {isFullRank ? 'Decoded! Full rank reached.' : `Need ${needed} more independent packet${needed === 1 ? '' : 's'}...`}
          </span>
        </div>
      </div>
    </div>
  );
}
