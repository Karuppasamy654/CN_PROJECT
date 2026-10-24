import React, { useState } from 'react';
import { UploadCloud, File, Play, Cpu, Network, ShieldCheck, Check } from 'lucide-react';

export default function UploadSection({ onStartTransfer, isSubmitting }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileSha, setFileSha] = useState('');
  const [isHashing, setIsHashing] = useState(false);

  // Configuration parameters
  const [protocol, setProtocol] = useState('rlnc');
  const [lossRate, setLossRate] = useState('10');
  const [delayMs, setDelayMs] = useState('50');
  const [reorder, setReorder] = useState(false);
  const [blockSize, setBlockSize] = useState('1024');
  const [K, setK] = useState('4');
  const [redundancy, setRedundancy] = useState('2');

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setIsHashing(true);

    // Compute SHA-256 in browser using SubtleCrypto
    try {
      const buffer = await file.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      setFileSha(hashHex);
    } catch (err) {
      console.error('Failed to hash file in browser:', err);
    } finally {
      setIsHashing(false);
    }
  };

  const handleLoadDemoFile = async (e) => {
    e.stopPropagation();
    // Generate an exact 4-block file (4096 bytes: 4 blocks x 1024 bytes)
    const data = new Uint8Array(4096);
    for (let i = 0; i < 4096; i++) {
      data[i] = ((i * 37 + 13) % 256);
    }
    const demoBlob = new Blob([data], { type: 'application/octet-stream' });
    const demoFile = new window.File([demoBlob], 'netcode_demo_4blocks.bin', { type: 'application/octet-stream' });

    setSelectedFile(demoFile);
    setBlockSize('1024');
    setK('4');
    setRedundancy('2');
    setIsHashing(true);

    try {
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      setFileSha(hashHex);
    } catch (err) {
      console.error('Failed to hash demo file:', err);
    } finally {
      setIsHashing(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!selectedFile) return;

    const fd = new FormData();
    fd.append('file', selectedFile);
    fd.append('protocol', protocol);
    fd.append('lossRate', lossRate);
    fd.append('delayMs', delayMs);
    fd.append('reorder', reorder ? 'true' : 'false');
    fd.append('blockSize', blockSize);
    fd.append('K', K);
    fd.append('redundancy', redundancy);

    onStartTransfer(fd);
  };

  return (
    <div style={{
      width: '100%',
      maxWidth: '820px',
      margin: '0 auto',
      display: 'flex',
      flexDirection: 'column',
      gap: '20px',
    }}>
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: '1.6rem', fontFamily: 'var(--font-heading)', color: '#fff', fontWeight: 800 }}>
          Initialize Network Simulation
        </h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '4px' }}>
          Select or drag-and-drop a file to simulate reliable transfer over UDP using RLNC or Stop-and-Wait ARQ.
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Dropzone */}
        <div
          className="glass-panel"
          style={{
            padding: '24px',
            border: '2px dashed rgba(0, 240, 255, 0.4)',
            borderRadius: '12px',
            textAlign: 'center',
            cursor: 'pointer',
            background: 'rgba(13, 27, 46, 0.6)',
            position: 'relative',
          }}
          onClick={() => document.getElementById('file-upload-input').click()}
        >
          <input
            id="file-upload-input"
            type="file"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <UploadCloud size={40} color="var(--cyan-primary)" style={{ margin: '0 auto 10px' }} />
          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff' }}>
            {selectedFile ? selectedFile.name : 'Click to select or drop a file'}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Supports arbitrary binary or text files (up to 50 MB)
          </div>

          <div style={{ marginTop: '10px' }}>
            <button
              type="button"
              onClick={handleLoadDemoFile}
              style={{
                background: 'rgba(0, 240, 255, 0.12)',
                border: '1px solid var(--cyan-primary)',
                color: 'var(--cyan-primary)',
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '0.75rem',
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              ⚡ Load 4-Block Demo Payload (4 KB, K=4, MTU 1024)
            </button>
          </div>

          {selectedFile && (
            <div style={{
              marginTop: '12px',
              padding: '8px 12px',
              background: 'rgba(15, 23, 42, 0.9)',
              borderRadius: '6px',
              border: '1px solid rgba(0, 240, 255, 0.2)',
              fontSize: '0.75rem',
              display: 'flex',
              justifyContent: 'space-between',
              fontFamily: 'var(--font-mono)',
            }}>
              <span>Size: {selectedFile.size.toLocaleString()} bytes</span>
              <span style={{ color: 'var(--cyan-primary)' }}>
                SHA-256: {isHashing ? 'Computing...' : `${fileSha.slice(0, 10)}...${fileSha.slice(-8)}`}
              </span>
            </div>
          )}
        </div>

        {/* Configuration Controls Grid */}
        <div className="glass-panel" style={{ padding: '16px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          {/* Protocol */}
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
              Transfer Protocol
            </label>
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                background: 'rgba(15, 23, 42, 0.9)',
                border: '1px solid rgba(0, 240, 255, 0.3)',
                color: '#fff',
                borderRadius: '6px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8rem',
              }}
            >
              <option value="rlnc">Random Linear Network Coding (RLNC)</option>
              <option value="rudp">Reliable UDP (Stop-and-Wait ARQ)</option>
            </select>
          </div>

          {/* Packet Loss */}
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
              Packet Loss Rate
            </label>
            <select
              value={lossRate}
              onChange={(e) => setLossRate(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                background: 'rgba(15, 23, 42, 0.9)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#f87171',
                borderRadius: '6px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8rem',
              }}
            >
              <option value="0">0% Loss (Clean Channel)</option>
              <option value="5">5% Loss</option>
              <option value="10">10% Loss</option>
              <option value="20">20% Loss</option>
              <option value="30">30% Loss</option>
            </select>
          </div>

          {/* Delay */}
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
              Artificial Delay (ms)
            </label>
            <input
              type="number"
              min="0"
              max="500"
              value={delayMs}
              onChange={(e) => setDelayMs(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                background: 'rgba(15, 23, 42, 0.9)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                color: '#fbbf24',
                borderRadius: '6px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8rem',
              }}
            />
          </div>

          {/* Block Size */}
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
              Block Size (Bytes)
            </label>
            <select
              value={blockSize}
              onChange={(e) => setBlockSize(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                background: 'rgba(15, 23, 42, 0.9)',
                border: '1px solid rgba(0, 240, 255, 0.3)',
                color: '#fff',
                borderRadius: '6px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8rem',
              }}
            >
              <option value="256">256 Bytes</option>
              <option value="512">512 Bytes</option>
              <option value="1024">1024 Bytes (MTU Safe)</option>
            </select>
          </div>

          {/* Generation Size K */}
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
              Generation Size (K)
            </label>
            <select
              value={K}
              onChange={(e) => setK(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                background: 'rgba(15, 23, 42, 0.9)',
                border: '1px solid rgba(0, 240, 255, 0.3)',
                color: '#fff',
                borderRadius: '6px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8rem',
              }}
            >
              <option value="4">K = 4 blocks</option>
              <option value="8">K = 8 blocks</option>
              <option value="16">K = 16 blocks</option>
            </select>
          </div>

          {/* Redundancy */}
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
              Initial Redundancy Packets (R)
            </label>
            <input
              type="number"
              min="0"
              max="16"
              value={redundancy}
              onChange={(e) => setRedundancy(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                background: 'rgba(15, 23, 42, 0.9)',
                border: '1px solid rgba(0, 240, 255, 0.3)',
                color: '#fff',
                borderRadius: '6px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8rem',
              }}
            />
          </div>
        </div>

        {/* Start Button */}
        <button
          type="submit"
          disabled={!selectedFile || isSubmitting}
          className="cyber-btn"
          style={{
            width: '100%',
            padding: '12px',
            fontSize: '1rem',
            justifyContent: 'center',
            opacity: (!selectedFile || isSubmitting) ? 0.5 : 1,
            cursor: (!selectedFile || isSubmitting) ? 'not-allowed' : 'pointer',
          }}
        >
          <Play size={18} />
          <span>{isSubmitting ? 'Starting C Networking Engine...' : 'Start Simulation'}</span>
        </button>
      </form>
    </div>
  );
}
