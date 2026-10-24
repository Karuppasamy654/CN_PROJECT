import React from 'react';
import { STAGES } from '../context/TransferContext';
import { Check, Radio, AlertCircle } from 'lucide-react';

export default function Timeline({ currentStage }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '4px 16px',
      position: 'relative',
      height: '100%',
      minHeight: '44px',
    }}>
      {/* Background connecting track */}
      <div style={{
        position: 'absolute',
        left: '32px',
        right: '32px',
        top: '18px',
        height: '2px',
        background: 'rgba(30, 58, 138, 0.4)',
        zIndex: 0,
      }} />

      {STAGES.map((s, idx) => {
        const isCompleted = s.id < currentStage;
        const isActive = s.id === currentStage;
        const isPending = s.id > currentStage;

        return (
          <div
            key={s.id}
            style={{
              position: 'relative',
              zIndex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              minWidth: '60px',
            }}
          >
            {/* Step Node */}
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.75rem',
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                transition: 'all 0.3s ease',
                background: isCompleted
                  ? 'var(--green-success)'
                  : isActive
                  ? 'rgba(0, 240, 255, 0.15)'
                  : 'rgba(15, 23, 42, 0.9)',
                border: isCompleted
                  ? '2px solid var(--green-success)'
                  : isActive
                  ? '2px solid var(--cyan-primary)'
                  : '1px solid rgba(56, 189, 248, 0.2)',
                color: isCompleted
                  ? '#ffffff'
                  : isActive
                  ? 'var(--cyan-primary)'
                  : 'var(--text-muted)',
                boxShadow: isCompleted
                  ? '0 0 10px rgba(16, 185, 129, 0.5)'
                  : isActive
                  ? '0 0 14px rgba(0, 240, 255, 0.7)'
                  : 'none',
              }}
            >
              {isCompleted ? (
                <Check size={16} strokeWidth={3} />
              ) : isActive ? (
                <Radio size={16} className="animate-pulse-glow" />
              ) : (
                s.id
              )}
            </div>

            {/* Label */}
            <span
              style={{
                marginTop: '4px',
                fontSize: '0.68rem',
                fontWeight: isActive ? 700 : 500,
                color: isCompleted
                  ? '#ffffff'
                  : isActive
                  ? 'var(--cyan-primary)'
                  : 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
