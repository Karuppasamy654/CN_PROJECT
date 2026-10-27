import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { History, CheckCircle2, XCircle, Search, RefreshCw, Filter, FileText, Download, Play, Copy, Check } from 'lucide-react';

export default function ExperimentHistoryScreen() {
  const navigate = useNavigate();
  const [experiments, setExperiments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterProtocol, setFilterProtocol] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [copiedId, setCopiedId] = useState('');

  const fetchHistory = async () => {
    try {
      setLoading(true);
      setError('');
      // Fetch both transfer history and batch experiment runs
      const [expRes, batchRes] = await Promise.all([
        fetch('/api/experiments'),
        fetch('/api/batch-results'),
      ]);

      let combined = [];
      if (expRes.ok) {
        const expData = await expRes.json();
        if (Array.isArray(expData)) {
          combined.push(...expData);
        }
      }

      if (batchRes.ok) {
        const batchData = await batchRes.json();
        if (batchData.available && Array.isArray(batchData.results)) {
          const formattedBatch = batchData.results.map((b, i) => ({
            id: `batch-${b.protocol.toLowerCase()}-loss${b.lossRate}-${i}`,
            timestamp: new Date().toISOString(),
            protocol: b.protocol.toLowerCase(),
            lossRate: b.lossRate,
            delayMs: 20,
            bandwidth: '5Mbps',
            fileSize: b.fileSize || 4096,
            goodputKbps: b.goodputKbps,
            simTimeSec: b.simTimeSec,
            status: b.status === 'VERIFIED' ? 'completed' : 'failed',
            verified: b.verified,
            tracePath: b.traceFile ? `/mnt/f/CN_project/netcode-rft/results/${b.traceFile}` : null,
            totalSent: b.totalSent,
            retransmissions: b.retransmissions || 0,
            codedPackets: b.codedPackets || 0,
          }));
          combined.push(...formattedBatch);
        }
      }

      // De-duplicate by ID
      const unique = [];
      const seen = new Set();
      for (const item of combined) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          unique.push(item);
        }
      }

      setExperiments(unique.reverse());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(''), 2000);
  };

  const filtered = experiments.filter((exp) => {
    if (filterProtocol !== 'all' && (exp.protocol || '').toLowerCase() !== filterProtocol.toLowerCase()) {
      return false;
    }
    if (filterStatus === 'completed' && exp.status !== 'completed') return false;
    if (filterStatus === 'failed' && exp.status !== 'failed') return false;
    return true;
  });

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <h1 style={{ fontSize: '1.22rem', fontWeight: 800, color: '#fff', letterSpacing: '0.3px', margin: 0 }}>
            NetCode-RFT
          </h1>
          <span style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: 400 }}>
            NS-3 Experiment Execution History & Integrity Audit
          </span>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => navigate('/')}
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
            Simulation Control
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

      {/* 2. MAIN CONTENT */}
      <main style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Header Controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#fff', margin: '0 0 4px 0' }}>
              Experiment Logs & Recorded Results
            </h2>
            <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: 0 }}>
              Persistent repository of all interactive and automated simulation trials.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Filter by Protocol */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Protocol:</span>
              <select
                value={filterProtocol}
                onChange={(e) => setFilterProtocol(e.target.value)}
                style={{
                  background: '#14253d',
                  border: '1px solid #1e3a5f',
                  color: '#fff',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  fontSize: '0.78rem',
                }}
              >
                <option value="all">All Protocols</option>
                <option value="rlnc">RLNC Only</option>
                <option value="rudp">RUDP Only</option>
              </select>
            </div>

            {/* Filter by Status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Status:</span>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                style={{
                  background: '#14253d',
                  border: '1px solid #1e3a5f',
                  color: '#fff',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  fontSize: '0.78rem',
                }}
              >
                <option value="all">All Statuses</option>
                <option value="completed">Completed / Verified</option>
                <option value="failed">Failed Runs</option>
              </select>
            </div>

            <button
              onClick={fetchHistory}
              disabled={loading}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: '#1e293b',
                color: '#38bdf8',
                border: '1px solid #334155',
                padding: '7px 14px',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {error && (
          <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', color: '#f87171', padding: '12px', borderRadius: '8px', fontSize: '0.85rem' }}>
            {error}
          </div>
        )}

        {/* HISTORY TABLE */}
        <div style={{
          background: '#0d1b2e',
          borderRadius: '10px',
          border: '1px solid #1e3a5f',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff' }}>
              Experiment Trail ({filtered.length} Entries)
            </span>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
              Includes simulated timestamps, goodput, and integrity verification
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ background: '#14253d', color: '#94a3b8', textAlign: 'left', borderBottom: '1px solid #1e3a5f' }}>
                  <th style={{ padding: '10px 12px' }}>Experiment ID</th>
                  <th style={{ padding: '10px 12px' }}>Timestamp</th>
                  <th style={{ padding: '10px 12px' }}>Protocol</th>
                  <th style={{ padding: '10px 12px' }}>Loss %</th>
                  <th style={{ padding: '10px 12px' }}>File Payload</th>
                  <th style={{ padding: '10px 12px' }}>Sim Duration</th>
                  <th style={{ padding: '10px 12px' }}>Goodput</th>
                  <th style={{ padding: '10px 12px' }}>Status</th>
                  <th style={{ padding: '10px 12px' }}>SHA-256 Hash</th>
                  <th style={{ padding: '10px 12px' }}>Trace Path</th>
                  <th style={{ padding: '10px 12px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
                      No matching experiment records found.
                    </td>
                  </tr>
                ) : (
                  filtered.map((exp, idx) => {
                    const isSuccess = exp.status === 'completed' || exp.verified;
                    const isRlnc = (exp.protocol || '').toLowerCase() === 'rlnc';
                    return (
                      <tr
                        key={idx}
                        style={{
                          borderBottom: '1px solid #14253d',
                          background: idx % 2 === 0 ? 'rgba(15, 23, 42, 0.4)' : 'transparent',
                        }}
                      >
                        <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', color: '#fff' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>{exp.id}</span>
                            <button
                              onClick={() => handleCopy(exp.id)}
                              style={{ background: 'none', border: 'none', color: copiedId === exp.id ? '#10b981' : '#64748b', cursor: 'pointer', padding: 0 }}
                            >
                              {copiedId === exp.id ? <Check size={12} /> : <Copy size={12} />}
                            </button>
                          </div>
                        </td>
                        <td style={{ padding: '10px 12px', color: '#94a3b8' }}>
                          {new Date(exp.timestamp || Date.now()).toLocaleTimeString()}
                        </td>
                        <td style={{ padding: '10px 12px', fontWeight: 700, color: isRlnc ? '#38bdf8' : '#f59e0b' }}>
                          {(exp.protocol || 'RLNC').toUpperCase()}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#cbd5e1' }}>{exp.lossRate ?? 0}%</td>
                        <td style={{ padding: '10px 12px', color: '#cbd5e1' }}>
                          {exp.fileSize ? `${(exp.fileSize / 1024).toFixed(1)} KB` : '4.0 KB'}
                        </td>
                        <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', color: '#fff' }}>
                          {exp.simTimeSec != null ? `${Number(exp.simTimeSec).toFixed(3)} s` : (exp.metrics?.duration_s != null ? `${Number(exp.metrics.duration_s).toFixed(3)} s` : '—')}
                        </td>
                        <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', color: isSuccess ? '#10b981' : '#f87171', fontWeight: 700 }}>
                          {exp.goodputKbps != null ? `${Number(exp.goodputKbps).toFixed(2)} Kbps` : (exp.metrics?.throughput_kbps != null ? `${Number(exp.metrics.throughput_kbps).toFixed(2)} Kbps` : '—')}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            background: isSuccess ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                            color: isSuccess ? '#10b981' : '#f87171',
                            border: `1px solid ${isSuccess ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                          }}>
                            {isSuccess ? 'COMPLETED' : 'FAILED'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {isSuccess ? (
                            <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <CheckCircle2 size={13} /> VERIFIED
                            </span>
                          ) : (
                            <span style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <XCircle size={13} /> MISMATCH
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', color: '#64748b', fontSize: '0.72rem' }}>
                          {exp.tracePath ? exp.tracePath.split('/').pop() : 'trace.xml'}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              onClick={() => navigate(`/equations?transferId=${exp.id}`)}
                              style={{
                                background: '#1e3a5f',
                                color: '#38bdf8',
                                border: '1px solid #0284c7',
                                padding: '3px 8px',
                                borderRadius: '4px',
                                fontSize: '0.7rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              Equations
                            </button>
                            <button
                              onClick={() => navigate(`/netanim?transferId=${exp.id}`)}
                              style={{
                                background: '#1e293b',
                                color: '#cbd5e1',
                                border: '1px solid #334155',
                                padding: '3px 8px',
                                borderRadius: '4px',
                                fontSize: '0.7rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              NetAnim
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
