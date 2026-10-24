import React, { useState } from 'react';
import { FileText, Copy, Check, Info } from 'lucide-react';

export default function FileInfo({ transfer }) {
  const [copied, setCopied] = useState(false);

  if (!transfer) {
    return (
      <div className="glass-panel" style={{ height: '100%', padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
        No file loaded
      </div>
    );
  }

  const {
    filename = 'unknown.bin',
    fileSize = 0,
    fileSha256 = '',
    blockSize = 1024,
    K = 4,
    redundancy = 2,
    protocol = 'rlnc',
  } = transfer;

  const totalBlocks = Math.ceil(fileSize / blockSize) || 1;
  const totalPackets = protocol === 'rlnc' ? totalBlocks + redundancy : totalBlocks;

  const copyHash = () => {
    if (!fileSha256) return;
    navigator.clipboard.writeText(fileSha256);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const truncatedHash = fileSha256
    ? `${fileSha256.slice(0, 8)}...${fileSha256.slice(-8)}`
    : 'Calculating...';

  const formatSize = (bytes) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB (${bytes.toLocaleString()} bytes)`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB (${bytes.toLocaleString()} bytes)`;
    return `${bytes} bytes`;
  };

  return (
    <div className="glass-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '10px 14px', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <FileText size={16} color="var(--cyan-primary)" />
        <span style={{ fontSize: '0.82rem', fontWeight: 700, fontFamily: 'var(--font-heading)' }}>
          File Information
        </span>
      </div>

      {/* File Card Banner */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        background: 'rgba(15, 23, 42, 0.7)',
        padding: '8px',
        borderRadius: '6px',
        border: '1px solid rgba(0, 240, 255, 0.15)',
        marginBottom: '10px',
      }}>
        <div style={{
          width: '36px',
          height: '42px',
          borderRadius: '4px',
          background: 'linear-gradient(135deg, #ef4444, #b91c1c)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontWeight: 800,
          fontSize: '0.7rem',
          boxShadow: '0 0 10px rgba(239, 68, 68, 0.4)',
        }}>
          FILE
        </div>
        <div style={{ overflow: 'hidden' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {filename}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
            Size: {formatSize(fileSize)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
            <span style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)', color: 'var(--text-cyan)' }}>
              SHA-256: {truncatedHash}
            </span>
            <button
              onClick={copyHash}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
              title="Copy SHA-256 hash"
            >
              {copied ? <Check size={11} color="var(--green-success)" /> : <Copy size={11} />}
            </button>
          </div>
        </div>
      </div>

      {/* Block Plan */}
      <div style={{ marginBottom: '10px' }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#fff', marginBottom: '6px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '2px' }}>
          Block Plan
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '0.7rem', fontFamily: 'var(--font-mono)' }}>
          <span style={{ color: 'var(--text-muted)' }}>Blocks (N):</span>
          <span style={{ color: '#fff', textAlign: 'right' }}>{totalBlocks}</span>

          <span style={{ color: 'var(--text-muted)' }}>Block Size:</span>
          <span style={{ color: '#fff', textAlign: 'right' }}>{(blockSize / 1024).toFixed(0)} KB</span>

          {protocol === 'rlnc' ? (
            <>
              <span style={{ color: 'var(--text-muted)' }}>Redundancy:</span>
              <span style={{ color: 'var(--cyan-primary)', textAlign: 'right' }}>{redundancy}</span>

              <span style={{ color: 'var(--text-muted)' }}>Total Packets:</span>
              <span style={{ color: 'var(--green-success)', textAlign: 'right' }}>{totalPackets}</span>
            </>
          ) : (
            <>
              <span style={{ color: 'var(--text-muted)' }}>ARQ Mode:</span>
              <span style={{ color: '#fbbf24', textAlign: 'right' }}>Stop & Wait</span>

              <span style={{ color: 'var(--text-muted)' }}>Timeout:</span>
              <span style={{ color: '#fff', textAlign: 'right' }}>150 ms</span>
            </>
          )}
        </div>
      </div>

      {/* Coding Example */}
      {protocol === 'rlnc' && (
        <div style={{ marginTop: 'auto', background: 'rgba(15, 23, 42, 0.8)', padding: '8px', borderRadius: '6px', border: '1px solid rgba(0, 240, 255, 0.15)' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--cyan-primary)', marginBottom: '3px' }}>
            Coding Example
          </div>
          <div style={{ fontSize: '0.66rem', fontFamily: 'var(--font-mono)', color: 'var(--text-main)', wordBreak: 'break-all' }}>
            C3 = 1·B1 ⊕ 5·B2 ⊕ 2·B3 ⊕ 7·B4
          </div>
        </div>
      )}
    </div>
  );
}
