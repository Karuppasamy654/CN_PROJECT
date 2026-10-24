import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Terminal, Trash2, Filter } from 'lucide-react';

export default function EventLog({ events, playbackIndex }) {
  const [filter, setFilter] = useState('all');
  const [clearedBeforeIndex, setClearedBeforeIndex] = useState(0);
  const logEndRef = useRef(null);

  const visibleEvents = useMemo(() => {
    return events.slice(clearedBeforeIndex, playbackIndex + 1);
  }, [events, playbackIndex, clearedBeforeIndex]);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [visibleEvents.length]);

  const filteredEvents = useMemo(() => {
    if (filter === 'packet') {
      return visibleEvents.filter(e => e.type.startsWith('packet_'));
    }
    if (filter === 'matrix') {
      return visibleEvents.filter(e => e.type.startsWith('decoder_'));
    }
    return visibleEvents;
  }, [visibleEvents, filter]);

  const formatTime = (t) => {
    if (typeof t !== 'number') return '00:00:00';
    const totalSec = Math.floor(t / 1000);
    const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
    const s = (totalSec % 60).toString().padStart(2, '0');
    const ms = Math.floor((t % 1000) / 10).toString().padStart(2, '0');
    return `${m}:${s}:${ms}`;
  };

  const getEventText = (e) => {
    if (e.type === 'packet_transmitted') {
      return { text: `C${e.seq_id + 1} sent (${e.payload_len} bytes)`, color: '#38bdf8' };
    }
    if (e.type === 'packet_dropped') {
      return { text: `C${e.seq_id + 1} lost (simulated)`, color: 'var(--red-loss)' };
    }
    if (e.type === 'packet_received') {
      return { text: `C${e.seq_id + 1} delivered`, color: 'var(--green-success)' };
    }
    if (e.type === 'decoder_matrix_update') {
      return { text: `Decoder Matrix: Rank ${e.rank}/${e.required_rank} (${e.innovative ? 'innovative' : 'linear dependent'})`, color: '#a855f7' };
    }
    if (e.type === 'decoder_step') {
      return { text: `Gauss-Jordan: ${e.op} (row ${e.pivot_row}, col ${e.pivot_col})`, color: '#c084fc' };
    }
    if (e.type === 'rudp_ack') {
      return { text: `ACK received for seq #${e.ack_seq}`, color: 'var(--green-success)' };
    }
    if (e.type === 'rudp_retransmit') {
      return { text: `Timeout! Retransmitting seq #${e.seq_id} (attempt #${e.retry_count})`, color: '#fbbf24' };
    }
    if (e.type === 'reconstruction_progress') {
      return { text: `Reconstruction: ${e.recovered_blocks}/${e.total_blocks} blocks (${e.pct}%)`, color: '#38bdf8' };
    }
    if (e.type === 'source_block_created') {
      return { text: `Source block B${e.block_id + 1} created (${e.len} bytes)`, color: 'var(--text-muted)' };
    }
    if (e.type === 'verification_result') {
      return { text: `Verification: ${e.passed ? 'PASSED (SHA-256 Match)' : 'FAILED'}`, color: e.passed ? 'var(--green-success)' : 'var(--red-loss)' };
    }
    return { text: JSON.stringify(e), color: 'var(--text-main)' };
  };

  return (
    <div className="glass-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '8px 12px', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Terminal size={15} color="var(--green-success)" />
          <span style={{ fontSize: '0.8rem', fontWeight: 700, fontFamily: 'var(--font-heading)' }}>
            Event Log ({visibleEvents.length})
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={() => setClearedBeforeIndex(playbackIndex + 1)}
            title="Clear visible log"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Log Body */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, fontSize: '0.7rem', fontFamily: 'var(--font-mono)' }}>
        {filteredEvents.map((e, idx) => {
          const { text, color } = getEventText(e);
          return (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '8px',
                padding: '2px 0',
                lineHeight: '1.4',
                borderBottom: '1px solid rgba(255, 255, 255, 0.02)',
              }}
            >
              <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>
                {formatTime(e.time || idx * 100)}
              </span>
              <span style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: color,
                boxShadow: `0 0 6px ${color}`,
                display: 'inline-block',
                flexShrink: 0,
              }} />
              <span style={{ color, wordBreak: 'break-word' }}>{text}</span>
            </div>
          );
        })}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}
