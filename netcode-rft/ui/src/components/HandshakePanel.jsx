import React from 'react';
import { Monitor, CheckCircle2 } from 'lucide-react';

export default function HandshakePanel({ events = [], isRunning, isCompleted }) {
  // Check exact handshake steps from real C engine events
  const hasInit = events.some(e => e.type === 'handshake_step' && e.step >= 1);
  const hasReady = events.some(e => e.type === 'handshake_step' && e.step >= 2);
  const hasStart = events.some(e => e.type === 'handshake_step' && e.step >= 3);
  const hasFinished = events.some(e => (e.type === 'handshake_step' && e.step >= 4) || e.type === 'packet_transmitted' || e.type === 'packet_received') || isCompleted;

  // Active step for highlighting in-flight animation
  let activeStep = 0;
  if (isRunning && !hasFinished) {
    if (!hasInit) activeStep = 1;
    else if (!hasReady) activeStep = 2;
    else if (!hasStart) activeStep = 3;
    else activeStep = 4;
  }

  return (
    <div className="glass-panel" style={{ padding: '16px', background: '#0d1b2e', borderRadius: '10px', border: '1px solid #1e3a5f' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#fff', fontFamily: 'var(--font-heading)', margin: 0 }}>
          UDP Initialization (Application 3-Way Handshake)
        </h3>
        {hasFinished && (
          <span style={{ fontSize: '0.72rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
            <CheckCircle2 size={13} color="#10b981" />
            Initialized
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '0 8px' }}>
        {/* Sender Box */}
        <div style={{
          width: '90px',
          height: '80px',
          background: 'linear-gradient(135deg, #1d4ed8, #2563eb)',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          boxShadow: '0 4px 14px rgba(37, 99, 235, 0.4)',
          flexShrink: 0,
        }}>
          <Monitor size={28} />
          <span style={{ fontSize: '0.78rem', fontWeight: 700, marginTop: '6px' }}>Sender</span>
        </div>

        {/* Handshake 3 Directional Lines */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', padding: '0 12px' }}>
          {/* 1. Sender -> Receiver: TRANSFER_INIT */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              fontSize: '0.74rem',
              color: hasInit ? '#38bdf8' : (activeStep === 1 ? '#38bdf8' : '#64748b'),
              fontWeight: (hasInit || activeStep === 1) ? 700 : 500,
              minWidth: '170px',
            }}>
              1. Sender → Receiver: TRANSFER_INIT
            </span>
            <div style={{ flex: 1, height: '2.5px', background: hasInit ? '#38bdf8' : (activeStep === 1 ? 'rgba(56, 189, 248, 0.6)' : '#334155'), position: 'relative' }}>
              <div style={{
                position: 'absolute',
                right: 0,
                top: '-5px',
                borderTop: '6px solid transparent',
                borderBottom: '6px solid transparent',
                borderLeft: `8px solid ${hasInit ? '#38bdf8' : (activeStep === 1 ? '#38bdf8' : '#334155')}`,
              }} />
            </div>
          </div>

          {/* 2. Receiver -> Sender: TRANSFER_READY */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ flex: 1, height: '2.5px', background: hasReady ? '#10b981' : (activeStep === 2 ? 'rgba(16, 185, 129, 0.6)' : '#334155'), position: 'relative' }}>
              <div style={{
                position: 'absolute',
                left: 0,
                top: '-5px',
                borderTop: '6px solid transparent',
                borderBottom: '6px solid transparent',
                borderRight: `8px solid ${hasReady ? '#10b981' : (activeStep === 2 ? '#10b981' : '#334155')}`,
              }} />
            </div>
            <span style={{
              fontSize: '0.74rem',
              color: hasReady ? '#10b981' : (activeStep === 2 ? '#10b981' : '#64748b'),
              fontWeight: (hasReady || activeStep === 2) ? 700 : 500,
              minWidth: '190px',
              textAlign: 'right',
            }}>
              2. Receiver → Sender: TRANSFER_READY
            </span>
          </div>

          {/* 3. Sender -> Receiver: TRANSFER_START */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              fontSize: '0.74rem',
              color: hasStart ? '#38bdf8' : (activeStep === 3 ? '#38bdf8' : '#64748b'),
              fontWeight: (hasStart || activeStep === 3) ? 700 : 500,
              minWidth: '170px',
            }}>
              3. Sender → Receiver: TRANSFER_START
            </span>
            <div style={{ flex: 1, height: '2.5px', background: hasStart ? '#38bdf8' : (activeStep === 3 ? 'rgba(56, 189, 248, 0.6)' : '#334155'), position: 'relative' }}>
              <div style={{
                position: 'absolute',
                right: 0,
                top: '-5px',
                borderTop: '6px solid transparent',
                borderBottom: '6px solid transparent',
                borderLeft: `8px solid ${hasStart ? '#38bdf8' : (activeStep === 3 ? '#38bdf8' : '#334155')}`,
              }} />
            </div>
          </div>
        </div>

        {/* Receiver Box */}
        <div style={{
          width: '90px',
          height: '80px',
          background: 'linear-gradient(135deg, #059669, #10b981)',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          boxShadow: '0 4px 14px rgba(16, 185, 129, 0.4)',
          flexShrink: 0,
        }}>
          <Monitor size={28} />
          <span style={{ fontSize: '0.78rem', fontWeight: 700, marginTop: '6px' }}>Receiver</span>
        </div>
      </div>
    </div>
  );
}
