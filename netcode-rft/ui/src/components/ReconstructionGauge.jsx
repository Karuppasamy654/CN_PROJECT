import React, { useMemo } from 'react';
import { PieChart, CheckCircle2, Clock } from 'lucide-react';

export default function ReconstructionGauge({ events, playbackIndex, transfer }) {
  const { recovered, total, pct } = useMemo(() => {
    let rec = 0;
    let tot = Math.ceil((transfer?.fileSize || 1024) / (transfer?.blockSize || 1024)) || 1;
    let percent = 0;

    const visibleEvents = events.slice(0, playbackIndex + 1);
    for (const e of visibleEvents) {
      if (e.type === 'reconstruction_progress') {
        rec = e.recovered_blocks;
        tot = e.total_blocks;
        percent = e.pct;
      }
    }
    return { recovered: rec, total: tot, pct: percent };
  }, [events, playbackIndex, transfer]);

  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (pct / 100) * circumference;

  return (
    <div className="glass-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '8px 12px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
        <PieChart size={15} color="var(--cyan-primary)" />
        <span style={{ fontSize: '0.8rem', fontWeight: 700, fontFamily: 'var(--font-heading)' }}>
          Reconstruction Progress
        </span>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-around' }}>
        {/* Circular Gauge */}
        <div style={{ position: 'relative', width: '64px', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="64" height="64" style={{ transform: 'rotate(-90deg)' }}>
            <circle
              cx="32"
              cy="32"
              r={radius}
              stroke="rgba(30, 58, 138, 0.4)"
              strokeWidth="5"
              fill="transparent"
            />
            <circle
              cx="32"
              cy="32"
              r={radius}
              stroke="var(--cyan-primary)"
              strokeWidth="5"
              fill="transparent"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 0.3s ease' }}
            />
          </svg>
          <span style={{
            position: 'absolute',
            fontSize: '0.82rem',
            fontWeight: 800,
            fontFamily: 'var(--font-mono)',
            color: '#fff',
          }}>
            {pct}%
          </span>
        </div>

        {/* Legend / Status */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.72rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--green-success)', fontWeight: 600 }}>
            <CheckCircle2 size={14} />
            <span>Blocks Solved ({recovered}/{total})</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: pct === 100 ? 'var(--green-success)' : 'var(--cyan-primary)' }}>
            <Clock size={14} className={pct < 100 ? 'animate-pulse-glow' : ''} />
            <span>{pct === 100 ? 'Reconstruction Complete' : 'Waiting for more...'}</span>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div style={{ width: '100%', height: '4px', background: 'rgba(15, 23, 42, 0.8)', borderRadius: '2px', overflow: 'hidden', marginTop: 'auto' }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          background: pct === 100 ? 'var(--green-success)' : 'linear-gradient(90deg, var(--blue-primary), var(--cyan-primary))',
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  );
}
