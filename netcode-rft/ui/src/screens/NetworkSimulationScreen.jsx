import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTransfer } from '../context/TransferContext';
import NetworkConduitPanel from '../components/NetworkConduitPanel';
import PerformanceComparisonTable from '../components/PerformanceComparisonTable';
import { FileText, CheckCircle2, ShieldCheck, Download, Play, RefreshCw, Cpu, Monitor } from 'lucide-react';

export default function NetworkSimulationScreen() {
  const navigate = useNavigate();
  const {
    transfer,
    transferLifecycle,
    receiverState,
    events,
    metrics,
    verification,
    backendReady,
    startTransfer,
    cancelTransfer,
    pollVerification,
  } = useTransfer();

  // Local state for file upload and settings
  const [selectedFile, setSelectedFile] = useState(null);
  const [lossRate, setLossRate] = useState('10');
  const [protocol, setProtocol] = useState('rlnc');
  const [bandwidth, setBandwidth] = useState('5Mbps');
  const [delayMs, setDelayMs] = useState('20');
  const [blockSize, setBlockSize] = useState('1024');
  const [K, setK] = useState('4');
  const [redundancy, setRedundancy] = useState('2');
  const [autoNetAnim, setAutoNetAnim] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  // Default sample file name & size for initial visual presentation
  const fileName = selectedFile ? selectedFile.name : (transfer?.filename || 'sample_file.bin');
  const fileSizeBytes = selectedFile
    ? selectedFile.size
    : (transfer?.fileSize ? transfer.fileSize : 4096);
  const fileSize = fileSizeBytes < 1024 * 1024
    ? `${(fileSizeBytes / 1024).toFixed(1)} KB`
    : `${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB`;

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleLoadDemo = () => {
    const data = new Uint8Array(4096);
    for (let i = 0; i < 4096; i++) {
      data[i] = ((i * 37 + 13) % 256);
    }
    const demoBlob = new Blob([data], { type: 'application/octet-stream' });
    const demoFile = new window.File([demoBlob], 'sample_file.bin', { type: 'application/octet-stream' });
    setSelectedFile(demoFile);
  };

  const handleStart = async () => {
    try {
      setIsSubmitting(true);
      setErrorMsg('');

      let fileToUpload = selectedFile;
      if (!fileToUpload) {
        // If no file selected, create default demo file
        const data = new Uint8Array(4096);
        for (let i = 0; i < 4096; i++) {
          data[i] = ((i * 37 + 13) % 256);
        }
        const demoBlob = new Blob([data], { type: 'application/octet-stream' });
        fileToUpload = new window.File([demoBlob], 'sample_file.bin', { type: 'application/octet-stream' });
        setSelectedFile(fileToUpload);
      }

      const fd = new FormData();
      fd.append('file', fileToUpload);
      fd.append('protocol', protocol);
      fd.append('lossRate', lossRate);
      fd.append('delayMs', delayMs);
      fd.append('bandwidth', bandwidth);
      fd.append('reorder', 'false');
      fd.append('blockSize', blockSize);
      fd.append('K', K);
      fd.append('redundancy', redundancy);
      fd.append('autoNetAnim', autoNetAnim ? 'true' : 'false');

      await startTransfer(fd);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleManualVerify = async () => {
    setIsVerifying(true);
    await pollVerification();
    setIsVerifying(false);
  };

  const isRunning = transferLifecycle === 'INITIALIZING' || transferLifecycle === 'TRANSFERRING' || transferLifecycle === 'DECODING' || transferLifecycle === 'RECONSTRUCTING' || transferLifecycle === 'VERIFYING';
  const isCompleted = receiverState.isVerified;
  const isFailed = transferLifecycle === 'FAILED';
  const isCancelled = transferLifecycle === 'CANCELLED';

  // Metrics extraction strictly correlated to authentic live receiver state
  const totalExpectedBlocks = receiverState.expectedBlocks;
  const currentK = transfer?.K || 4;
  const totalGenerations = receiverState.expectedGenerations;
  const sentCount = receiverState.physicalTransmissions || metrics?.data_packets_sent || metrics?.total_sent_packets || 0;
  const lostCount = receiverState.droppedPacketCount || metrics?.total_phy_drops || (metrics?.data_packets_sent > metrics?.data_packets_received ? metrics.data_packets_sent - metrics.data_packets_received : 0);
  const recvCount = receiverState.receivedPacketCount || metrics?.data_packets_received || 0;

  const systematicSent = receiverState.systematicSent || (protocol === 'rlnc' ? (metrics?.data_packets_sent ? Math.min(metrics.data_packets_sent, totalExpectedBlocks || 4) : 0) : 0);
  const redundancySent = receiverState.redundancySent || (protocol === 'rlnc' ? (metrics?.total_coded_packets || 0) : 0);
  const extraRepairSent = receiverState.extraRepairSent || 0;
  const rudpRetransmitCount = receiverState.rudpRetransmitCount || (protocol === 'rudp' ? (metrics?.total_retransmissions || 0) : 0);

  const transferTime = receiverState.displayDuration !== '0.00s' ? receiverState.displayDuration : (metrics?.sim_time_sec ? `${metrics.sim_time_sec.toFixed(3)}s` : '0.00s');
  const throughput = receiverState.displayThroughput !== '0.00 Kbps' ? receiverState.displayThroughput : (metrics?.goodput_kbps ? `${metrics.goodput_kbps.toFixed(2)} Kbps` : '0.00 Kbps');
  const progressPct = receiverState.progressPct > 0 ? receiverState.progressPct : (metrics?.integrity_verified ? 100 : 0);

  return (
    <div style={{
      width: '100vw',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: '#070f1e',
      color: '#f8fafc',
      fontFamily: 'var(--font-sans)',
      overflowY: 'auto',
    }}>
      {/* 1. TOP NAVBAR */}
      <header style={{
        height: '62px',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid #1e3a5f',
        background: '#0a1426',
        flexShrink: 0,
      }}>
        {/* Title & Subtitle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <h1 style={{ fontSize: '1.22rem', fontWeight: 800, color: '#fff', letterSpacing: '0.3px', margin: 0 }}>
            NetCode-RFT
          </h1>
          <span style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: 400 }}>
            Network Coding Based Loss-Resilient File Transfer over UDP
          </span>
        </div>

        {/* Right Toggle Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            style={{
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              padding: '7px 16px',
              borderRadius: '6px',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: 'default',
              boxShadow: '0 2px 10px rgba(37, 99, 235, 0.4)',
            }}
          >
            Transfer & Simulation
          </button>
          <button
            onClick={() => navigate('/comparison')}
            style={{
              background: '#1e293b',
              color: '#cbd5e1',
              border: '1px solid #334155',
              padding: '7px 16px',
              borderRadius: '6px',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            RLNC vs RUDP Comparison
          </button>
          <button
            onClick={() => navigate('/visualizer')}
            style={{
              background: '#1e293b',
              color: '#cbd5e1',
              border: '1px solid #334155',
              padding: '7px 16px',
              borderRadius: '6px',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Packet Visualizer
          </button>
          <button
            onClick={() => navigate('/history')}
            style={{
              background: '#1e293b',
              color: '#cbd5e1',
              border: '1px solid #334155',
              padding: '7px 16px',
              borderRadius: '6px',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Experiment History
          </button>
          <button
            onClick={() => navigate('/equations')}
            style={{
              background: '#1e293b',
              color: '#cbd5e1',
              border: '1px solid #334155',
              padding: '7px 16px',
              borderRadius: '6px',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Equation Lab
          </button>
        </div>
      </header>

      {/* 2. MAIN WORKSPACE CONTAINER */}
      <main style={{
        flex: 1,
        padding: '16px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}>
        {errorMsg && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid #ef4444',
            color: '#f87171',
            padding: '10px 16px',
            borderRadius: '6px',
            fontSize: '0.82rem',
          }}>
            {errorMsg}
          </div>
        )}

        {/* TOP ROW: 3-COLUMN GRID */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '280px 1fr 300px',
          gap: '16px',
          alignItems: 'stretch',
        }}>
          {/* COLUMN 1: File Upload & Simulation Settings */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* File Upload Card */}
            <div className="glass-panel" style={{ padding: '16px', background: '#0d1b2e', borderRadius: '10px', border: '1px solid #1e3a5f' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fff', marginBottom: '12px' }}>
                File Upload
              </h3>

              {/* File Pill / Container */}
              <div style={{
                background: '#14253d',
                borderRadius: '8px',
                padding: '12px',
                border: '1px solid #1e3a5f',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '6px',
                    background: '#2563eb',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                  }}>
                    <FileText size={18} />
                  </div>
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#fff' }}>
                      {fileName}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                      ({fileSize})
                    </div>
                  </div>
                </div>

                <CheckCircle2 size={18} color="#10b981" />
              </div>

              {/* Choose File Button */}
              <input
                id="file-upload-input"
                type="file"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <button
                type="button"
                onClick={() => document.getElementById('file-upload-input').click()}
                style={{
                  width: '100%',
                  padding: '7px',
                  background: '#1e293b',
                  border: '1px solid #334155',
                  color: '#e2e8f0',
                  borderRadius: '6px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginBottom: '8px',
                }}
              >
                Choose File
              </button>

              <button
                type="button"
                onClick={handleLoadDemo}
                style={{
                  width: '100%',
                  padding: '5px',
                  background: 'rgba(56, 189, 248, 0.1)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  color: '#38bdf8',
                  borderRadius: '6px',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ⚡ Load Sample File (256 KB / 4 KB Demo)
              </button>
            </div>

            {/* Simulation Settings Card */}
            <div className="glass-panel" style={{ padding: '16px', background: '#0d1b2e', borderRadius: '10px', border: '1px solid #1e3a5f' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fff', marginBottom: '12px' }}>
                Simulation Settings (NS-3 Engine)
              </h3>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>
                  Packet Loss Rate
                </label>
                <select
                  value={lossRate}
                  onChange={(e) => setLossRate(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '7px 10px',
                    background: '#14253d',
                    border: '1px solid #1e3a5f',
                    color: '#fff',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                  }}
                >
                  <option value="0">0% Loss (Clean Channel)</option>
                  <option value="5">5% Loss (Light Impairment)</option>
                  <option value="10">10% Loss (Moderate Impairment)</option>
                  <option value="20">20% Loss (Severe Impairment)</option>
                  <option value="30">30% Loss (Extreme Impairment)</option>
                </select>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '8px' }}>
                  Transfer Protocol
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: '#fff', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="protocol"
                      value="rlnc"
                      checked={protocol === 'rlnc'}
                      onChange={() => setProtocol('rlnc')}
                    />
                    <span style={{ color: protocol === 'rlnc' ? '#38bdf8' : '#cbd5e1', fontWeight: 600 }}>
                      Network Coding (RLNC / GF(256))
                    </span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: '#fff', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="protocol"
                      value="rudp"
                      checked={protocol === 'rudp'}
                      onChange={() => setProtocol('rudp')}
                    />
                    <span style={{ color: protocol === 'rudp' ? '#f59e0b' : '#cbd5e1', fontWeight: 600 }}>
                      Reliable UDP (Stop-and-Wait ARQ)
                    </span>
                  </label>
                </div>
              </div>

              {/* NetAnim Auto-Launch Checkbox */}
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.74rem', color: '#e2e8f0', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={autoNetAnim}
                    onChange={(e) => setAutoNetAnim(e.target.checked)}
                  />
                  <span style={{ color: autoNetAnim ? '#38bdf8' : '#94a3b8', fontWeight: 600 }}>
                    ⚡ Auto-launch NetAnim desktop viewer on completion
                  </span>
                </label>
              </div>

              {/* Advanced NS-3 Topology & Coding Settings Toggle */}
              <div style={{ marginBottom: '14px' }}>
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#38bdf8',
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <span>{showAdvanced ? '▾ Hide Advanced NS-3 Settings' : '▸ Show Advanced NS-3 Settings'}</span>
                </button>

                {showAdvanced && (
                  <div style={{
                    marginTop: '10px',
                    background: '#14253d',
                    padding: '10px',
                    borderRadius: '6px',
                    border: '1px solid #1e3a5f',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    fontSize: '0.72rem',
                  }}>
                    <div>
                      <span style={{ color: '#94a3b8', display: 'block', marginBottom: '2px' }}>Point-to-Point Bandwidth:</span>
                      <select
                        value={bandwidth}
                        onChange={(e) => setBandwidth(e.target.value)}
                        style={{ width: '100%', padding: '4px 6px', background: '#0a1426', color: '#fff', border: '1px solid #334155', borderRadius: '4px' }}
                      >
                        <option value="1Mbps">1 Mbps</option>
                        <option value="5Mbps">5 Mbps (Default)</option>
                        <option value="10Mbps">10 Mbps</option>
                        <option value="50Mbps">50 Mbps</option>
                      </select>
                    </div>

                    <div>
                      <span style={{ color: '#94a3b8', display: 'block', marginBottom: '2px' }}>Propagation Delay:</span>
                      <select
                        value={delayMs}
                        onChange={(e) => setDelayMs(e.target.value)}
                        style={{ width: '100%', padding: '4px 6px', background: '#0a1426', color: '#fff', border: '1px solid #334155', borderRadius: '4px' }}
                      >
                        <option value="5">5 ms (LAN / Data Center)</option>
                        <option value="20">20 ms (Default Terrestrial)</option>
                        <option value="50">50 ms (Long Distance)</option>
                        <option value="100">100 ms (Satellite Link)</option>
                      </select>
                    </div>

                    {protocol === 'rlnc' ? (
                      <>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                          <div>
                            <span style={{ color: '#94a3b8', display: 'block', marginBottom: '2px' }}>Gen Size (K):</span>
                            <input
                              type="number"
                              min="1"
                              max="16"
                              value={K}
                              onChange={(e) => setK(e.target.value)}
                              style={{ width: '100%', padding: '4px 6px', background: '#0a1426', color: '#fff', border: '1px solid #334155', borderRadius: '4px' }}
                            />
                          </div>
                          <div>
                            <span style={{ color: '#94a3b8', display: 'block', marginBottom: '2px' }}>Redundancy:</span>
                            <input
                              type="number"
                              min="0"
                              max="16"
                              value={redundancy}
                              onChange={(e) => setRedundancy(e.target.value)}
                              style={{ width: '100%', padding: '4px 6px', background: '#0a1426', color: '#fff', border: '1px solid #334155', borderRadius: '4px' }}
                            />
                          </div>
                        </div>
                      </>
                    ) : (
                      <div>
                        <span style={{ color: '#94a3b8', display: 'block', marginBottom: '2px' }}>ARQ Timeout:</span>
                        <input
                          type="text"
                          disabled
                          value="200 ms (Stop-and-Wait)"
                          style={{ width: '100%', padding: '4px 6px', background: '#0a1426', color: '#64748b', border: '1px solid #334155', borderRadius: '4px' }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Exact NS-3 CLI Preview */}
              <div style={{
                background: '#0a1426',
                border: '1px solid #14253d',
                borderRadius: '6px',
                padding: '6px 8px',
                marginBottom: '12px',
                fontSize: '0.68rem',
                fontFamily: 'var(--font-mono)',
                color: '#64748b',
                overflowX: 'auto',
                whiteSpace: 'nowrap',
              }}>
                <span style={{ color: '#38bdf8' }}>./ns3 run</span> "netcode-rft --protocol={protocol.toUpperCase()} --loss={lossRate} --delay={delayMs}ms --bandwidth={bandwidth}"
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={isSubmitting || isRunning}
                  style={{
                    flex: 1,
                    padding: '9px',
                    background: (isSubmitting || isRunning) ? '#1e3a5f' : '#2563eb',
                    border: 'none',
                    color: '#fff',
                    borderRadius: '6px',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    cursor: (isSubmitting || isRunning) ? 'not-allowed' : 'pointer',
                    boxShadow: '0 2px 10px rgba(37, 99, 235, 0.4)',
                  }}
                >
                  {isSubmitting ? 'Starting NS-3...' : (isRunning ? 'Simulating in NS-3...' : 'Start NS-3 Simulation')}
                </button>

                {isRunning && (
                  <button
                    type="button"
                    onClick={cancelTransfer}
                    style={{
                      padding: '9px 12px',
                      background: 'rgba(239, 68, 68, 0.2)',
                      border: '1px solid #ef4444',
                      color: '#f87171',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>

              {/* Interactive Telemetry & Channel Visualizer link */}
              {transfer?.id && (
                <div style={{
                  marginTop: '12px',
                  padding: '8px 10px',
                  background: 'rgba(56, 189, 248, 0.1)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}>
                  <div style={{ fontSize: '0.72rem', color: '#38bdf8', fontWeight: 600 }}>
                    Real C11 Telemetry Available
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigate(`/visualizer?transferId=${transfer.id}`);
                    }}
                    style={{
                      background: '#2563eb',
                      border: 'none',
                      color: '#fff',
                      padding: '4px 10px',
                      borderRadius: '4px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Open Visualizer
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* COLUMN 2: Central Conduit & Packet Transmission (Sections 1, 2, 3) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <NetworkConduitPanel
              events={events}
              protocol={protocol}
              isRunning={isRunning}
              isCompleted={isCompleted}
              transfer={transfer}
            />
          </div>

          {/* COLUMN 3: Transfer Progress & Receiver Status */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Transfer Progress Card */}
            <div className="glass-panel" style={{ padding: '16px', background: '#0d1b2e', borderRadius: '10px', border: '1px solid #1e3a5f' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fff', marginBottom: '12px' }}>
                Transfer Progress
              </h3>

              {/* Green Progress Bar */}
              <div style={{ height: '8px', background: '#1e293b', borderRadius: '4px', overflow: 'hidden', marginBottom: '12px' }}>
                <div style={{
                  width: `${progressPct}%`,
                  height: '100%',
                  background: isFailed ? '#ef4444' : '#10b981',
                  transition: 'width 0.3s ease',
                }} />
              </div>

              {/* Status Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px' }}>
                <CheckCircle2 size={16} color={isCompleted ? '#10b981' : (isFailed ? '#ef4444' : '#38bdf8')} />
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: isCompleted ? '#10b981' : (isFailed ? '#f87171' : '#fff') }}>
                  {receiverState.status}
                </span>
              </div>

              {/* Metric Rows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.78rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                  <span>Transfer Progress</span>
                  <span style={{ color: '#10b981', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{progressPct}%</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                  <span>Logical Source Blocks</span>
                  <span style={{ color: '#fff', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                    {totalExpectedBlocks ? `${totalExpectedBlocks} (Configured, 1,024 B/blk)` : '—'}
                  </span>
                </div>
                {protocol === 'rlnc' && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                    <span>RLNC Generations</span>
                    <span style={{ color: '#38bdf8', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                      {totalGenerations ? `${totalGenerations} (Configured, K=${currentK})` : '—'}
                    </span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                  <span>Physical Transmissions</span>
                  <span style={{ color: '#fff', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{sentCount} pkts</span>
                </div>
                {protocol === 'rlnc' ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: '0.74rem', paddingLeft: '8px' }}>
                      <span>├─ Systematic Packets</span>
                      <span style={{ color: '#cbd5e1', fontFamily: 'var(--font-mono)' }}>{systematicSent}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: '0.74rem', paddingLeft: '8px' }}>
                      <span>├─ Redundancy (Mixed)</span>
                      <span style={{ color: '#cbd5e1', fontFamily: 'var(--font-mono)' }}>{redundancySent}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: '0.74rem', paddingLeft: '8px' }}>
                      <span>└─ Dynamic Repair Coded</span>
                      <span style={{ color: extraRepairSent > 0 ? '#f59e0b' : '#cbd5e1', fontFamily: 'var(--font-mono)' }}>{extraRepairSent}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                      <span>Coded Packets Received</span>
                      <span style={{ color: '#38bdf8', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                        {receiverState.codedPacketsReceived} pkts
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                      <span>Decoder Rank (GF(256))</span>
                      <span style={{ color: '#a855f7', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                        {totalExpectedBlocks ? `${receiverState.currentRank} / ${receiverState.requiredRank}` : '—'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                      <span>Decoded Generations</span>
                      <span style={{ color: '#10b981', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                        {totalGenerations ? `${receiverState.decodedGenerations} / ${totalGenerations}` : '—'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                      <span>Reconstructed File Data</span>
                      <span style={{ color: '#10b981', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                        {receiverState.reconstructedBytes} B
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                      <span>Unique File Bytes Assembled</span>
                      <span style={{ color: '#38bdf8', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                        {receiverState.uniqueReconstructedBytes} B
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                      <span>ARQ Retransmissions</span>
                      <span style={{ color: rudpRetransmitCount > 0 ? '#f59e0b' : '#94a3b8', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                        {rudpRetransmitCount}
                      </span>
                    </div>
                  </>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                  <span>Packets Received</span>
                  <span style={{ color: '#10b981', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{recvCount}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                  <span>Packets Lost (Dropped)</span>
                  <span style={{ color: lostCount > 0 ? '#f87171' : '#94a3b8', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{lostCount}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                  <span>Received Payload Bytes</span>
                  <span style={{ color: '#38bdf8', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{receiverState.receivedPayloadBytes} B</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                  <span>Transfer Time</span>
                  <span style={{ color: '#fff', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{transferTime}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                  <span>Throughput</span>
                  <span style={{ color: '#38bdf8', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{throughput}</span>
                </div>
              </div>
            </div>

            {/* File at Receiver Card */}
            <div className="glass-panel" style={{ padding: '16px', background: '#0d1b2e', borderRadius: '10px', border: '1px solid #1e3a5f' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fff', marginBottom: '12px' }}>
                File at Receiver
              </h3>

              {/* Receiver File Box - Reveals file details ONLY when verified */}
              <div style={{
                background: '#14253d',
                borderRadius: '8px',
                padding: '12px',
                border: isCompleted ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid #1e3a5f',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '6px',
                    background: isCompleted ? '#059669' : '#1e3a5f',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                  }}>
                    <FileText size={18} />
                  </div>
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: isCompleted ? '#10b981' : (isFailed ? '#f87171' : '#cbd5e1') }}>
                      {receiverState.fileStatus}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                      ({receiverState.fileSizeDisplay})
                    </div>
                  </div>
                </div>

                <CheckCircle2 size={18} color={isCompleted ? '#10b981' : (isFailed ? '#ef4444' : '#64748b')} />
              </div>

              {/* Manual Verification Button */}
              <button
                type="button"
                onClick={handleManualVerify}
                disabled={isVerifying || !transfer || (!isCompleted && transferLifecycle !== 'VERIFYING')}
                style={{
                  width: '100%',
                  padding: '9px',
                  background: isCompleted ? '#059669' : '#1e3a5f',
                  border: 'none',
                  color: '#fff',
                  borderRadius: '6px',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: (!transfer || isVerifying || (!isCompleted && transferLifecycle !== 'VERIFYING')) ? 'not-allowed' : 'pointer',
                  marginBottom: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  boxShadow: isCompleted ? '0 2px 10px rgba(5, 150, 105, 0.4)' : 'none',
                }}
              >
                <ShieldCheck size={16} />
                <span>{isVerifying ? 'Verifying SHA-256...' : (isCompleted ? 'Verified (SHA-256 Match)' : 'Verify File (SHA-256)')}</span>
              </button>

              {/* Status Message */}
              {isCompleted ? (
                <div style={{
                  fontSize: '0.75rem',
                  color: '#10b981',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  justifyContent: 'center',
                }}>
                  <CheckCircle2 size={14} color="#10b981" />
                  <span>File reconstructed and verified successfully!</span>
                </div>
              ) : (
                <div style={{ fontSize: '0.72rem', color: isFailed ? '#f87171' : '#94a3b8', textAlign: 'center' }}>
                  {receiverState.status}
                </div>
              )}

              {/* Download Reconstructed File - STRICTLY ONLY AFTER VERIFICATION */}
              {receiverState.canDownload && (
                <div style={{ marginTop: '10px' }}>
                  <a
                    href={`/api/transfers/${transfer.id}/download`}
                    download
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      padding: '7px',
                      background: 'rgba(56, 189, 248, 0.1)',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      color: '#38bdf8',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      textDecoration: 'none',
                    }}
                  >
                    <Download size={14} />
                    <span>Download Reconstructed File</span>
                  </a>
                </div>
              )}

              {/* Launch NetAnim Button */}
              {transfer?.id && (
                <div style={{ marginTop: '8px' }}>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await fetch(`/api/transfers/${transfer.id}/netanim`, { method: 'POST' });
                      } catch (e) {
                        console.error('Failed to launch NetAnim:', e);
                      }
                    }}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      padding: '7px',
                      background: 'rgba(168, 85, 247, 0.12)',
                      border: '1px solid rgba(168, 85, 247, 0.35)',
                      color: '#c084fc',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    <Monitor size={14} />
                    <span>Open in NetAnim Desktop (3.109)</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* BOTTOM FULL-WIDTH: Performance Comparison */}
        <PerformanceComparisonTable
          currentMetrics={metrics}
          protocol={protocol}
          verification={verification}
          selectedFile={selectedFile}
          fileName={fileName}
          fileSizeBytes={fileSizeBytes}
          lossRate={lossRate}
          isRunning={isRunning}
          receiverState={receiverState}
        />
      </main>
    </div>
  );
}
