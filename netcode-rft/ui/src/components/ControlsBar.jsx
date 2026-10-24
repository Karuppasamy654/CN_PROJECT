import React from 'react';
import { Play, Pause, SkipForward, SkipBack, RotateCcw, Info } from 'lucide-react';

export default function ControlsBar({
  isPlaying,
  play,
  pause,
  stepForward,
  stepBackward,
  restartPlayback,
  speed,
  setSpeed,
  pauseAtStage,
  setPauseAtStage,
  events,
  playbackIndex,
  transfer,
}) {
  const currentEvent = events[playbackIndex];

  let statusMsg = 'Simulation idle. Ready to transmit.';
  if (currentEvent) {
    if (currentEvent.type === 'packet_dropped') {
      statusMsg = `Transmission in progress... C${currentEvent.seq_id + 1} was lost, recovery in progress.`;
    } else if (currentEvent.type === 'verification_result') {
      statusMsg = currentEvent.passed
        ? 'Transfer completed! SHA-256 integrity verified successfully.'
        : 'Integrity check failed! Byte mismatch detected.';
    } else if (currentEvent.type === 'reconstruction_progress') {
      statusMsg = `Reconstructing file: ${currentEvent.recovered_blocks} of ${currentEvent.total_blocks} blocks decoded.`;
    } else if (currentEvent.type === 'packet_transmitted') {
      statusMsg = `Transmitting packet C${currentEvent.seq_id + 1} (${currentEvent.pkt_type}).`;
    } else if (currentEvent.type === 'decoder_step') {
      statusMsg = `Gauss-Jordan Elimination: ${currentEvent.desc} on row ${currentEvent.pivot_row}.`;
    }
  }

  const speeds = [0.25, 0.5, 1, 2, 4];

  return (
    <div className="glass-panel" style={{
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      gap: '16px',
    }}>
      {/* Playback Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          onClick={isPlaying ? pause : play}
          className="cyber-btn"
          style={{ width: '38px', height: '38px', padding: 0, justifyContent: 'center', borderRadius: '50%' }}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} style={{ marginLeft: '2px' }} />}
        </button>

        <button
          onClick={stepBackward}
          className="cyber-btn cyber-btn-secondary"
          style={{ width: '34px', height: '34px', padding: 0, justifyContent: 'center' }}
          title="Previous Event"
        >
          <SkipBack size={16} />
        </button>

        <button
          onClick={stepForward}
          className="cyber-btn cyber-btn-secondary"
          style={{ width: '34px', height: '34px', padding: 0, justifyContent: 'center' }}
          title="Next Event"
        >
          <SkipForward size={16} />
        </button>

        <button
          onClick={restartPlayback}
          className="cyber-btn cyber-btn-secondary"
          style={{ width: '34px', height: '34px', padding: 0, justifyContent: 'center' }}
          title="Restart Playback"
        >
          <RotateCcw size={16} />
        </button>
      </div>

      {/* Speed Selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>Speed:</span>
        <div style={{ display: 'flex', gap: '4px', background: 'rgba(15, 23, 42, 0.8)', padding: '2px 4px', borderRadius: '5px', border: '1px solid rgba(0, 240, 255, 0.2)' }}>
          {speeds.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              style={{
                background: speed === s ? 'var(--cyan-primary)' : 'transparent',
                color: speed === s ? '#050a18' : 'var(--text-muted)',
                border: 'none',
                borderRadius: '3px',
                padding: '2px 6px',
                fontSize: '0.68rem',
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      {/* Pause at stage checkbox */}
      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.72rem', color: 'var(--text-main)', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={pauseAtStage}
          onChange={(e) => setPauseAtStage(e.target.checked)}
          style={{ accentColor: 'var(--cyan-primary)' }}
        />
        <span>Pause at each stage</span>
      </label>

      {/* Current event info pill */}
      <div style={{
        flex: 1,
        maxWidth: '480px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        background: 'rgba(14, 165, 233, 0.12)',
        border: '1px solid rgba(0, 240, 255, 0.25)',
        padding: '6px 12px',
        borderRadius: '6px',
        fontSize: '0.72rem',
        color: '#e2e8f0',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        <Info size={16} color="var(--cyan-primary)" style={{ flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {statusMsg}
        </span>
      </div>
    </div>
  );
}
