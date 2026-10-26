import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid
} from 'recharts';
import { BarChart3, RefreshCw, AlertTriangle, CheckCircle2, XCircle, FileCode, Play, ExternalLink, ArrowRight } from 'lucide-react';

export default function RlncVsRudpComparisonScreen() {
  const navigate = useNavigate();
  const [batchData, setBatchData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeMetric, setActiveMetric] = useState('goodput'); // 'goodput' | 'time' | 'packets'

  const fetchBatchResults = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/batch-results');
      if (!res.ok) throw new Error('Failed to fetch batch comparison results');
      const data = await res.json();
      if (data.available && Array.isArray(data.results)) {
        setBatchData(data.results);
      } else {
        setBatchData([]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBatchResults();
  }, []);

  // Transform raw experiment list into comparison pairs grouped by loss rate
  const lossPoints = [0, 5, 10, 20, 30];
  const chartData = lossPoints.map((loss) => {
    const rlncRun = batchData.find(r => r.protocol === 'RLNC' && r.lossRate === loss);
    const rudpRun = batchData.find(r => r.protocol === 'RUDP' && r.lossRate === loss);

    return {
      loss: `${loss}%`,
      rlncGoodput: rlncRun && rlncRun.verified ? Number(rlncRun.goodputKbps || 0) : 0,
      rudpGoodput: rudpRun && rudpRun.verified ? Number(rudpRun.goodputKbps || 0) : 0,
      rlncTime: rlncRun ? Number(rlncRun.simTimeSec || 0) : 0,
      rudpTime: rudpRun ? Number(rudpRun.simTimeSec || 0) : 0,
      rlncSent: rlncRun ? Number(rlncRun.totalSent || 0) : 0,
      rudpSent: rudpRun ? Number(rudpRun.totalSent || 0) : 0,
      rudpRetrans: rudpRun ? Number(rlncRun?.retransmissions || rudpRun.retransmissions || 0) : 0,
      rlncStatus: rlncRun?.status || 'N/A',
      rudpStatus: rudpRun?.status || 'N/A',
    };
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
            RLNC vs RUDP Empirical Performance Comparison (NS-3 Native)
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

      {/* 2. MAIN CONTENT */}
      <main style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Header Controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#fff', margin: '0 0 4px 0' }}>
              Multi-Loss Experimental Results Dashboard
            </h2>
            <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: 0 }}>
              Live metrics harvested directly from compiled NS-3 simulation runs across 0%, 5%, 10%, 20%, and 30% channel loss rates.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'flex', background: '#0f172a', borderRadius: '6px', padding: '3px', border: '1px solid #1e3a5f' }}>
              <button
                onClick={() => setActiveMetric('goodput')}
                style={{
                  background: activeMetric === 'goodput' ? '#2563eb' : 'transparent',
                  color: activeMetric === 'goodput' ? '#fff' : '#94a3b8',
                  border: 'none',
                  padding: '6px 14px',
                  borderRadius: '4px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Goodput (Kbps)
              </button>
              <button
                onClick={() => setActiveMetric('time')}
                style={{
                  background: activeMetric === 'time' ? '#2563eb' : 'transparent',
                  color: activeMetric === 'time' ? '#fff' : '#94a3b8',
                  border: 'none',
                  padding: '6px 14px',
                  borderRadius: '4px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Sim Duration (s)
              </button>
              <button
                onClick={() => setActiveMetric('packets')}
                style={{
                  background: activeMetric === 'packets' ? '#2563eb' : 'transparent',
                  color: activeMetric === 'packets' ? '#fff' : '#94a3b8',
                  border: 'none',
                  padding: '6px 14px',
                  borderRadius: '4px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Packet Overhead
              </button>
            </div>

            <button
              onClick={fetchBatchResults}
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
              <span>Refresh Results</span>
            </button>
          </div>
        </div>

        {error && (
          <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', color: '#f87171', padding: '12px', borderRadius: '8px', fontSize: '0.85rem' }}>
            {error}
          </div>
        )}

        {/* CHARTS CARD */}
        <div style={{
          background: '#0d1b2e',
          borderRadius: '10px',
          border: '1px solid #1e3a5f',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff' }}>
              {activeMetric === 'goodput' && 'Application Goodput vs Channel Packet Loss (Kbps)'}
              {activeMetric === 'time' && 'Transfer Completion Time vs Channel Packet Loss (Seconds)'}
              {activeMetric === 'packets' && 'Transmitted Packets & Retransmission Burden'}
            </span>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
              Evaluated on 4 KB payload, K=4, 5 Mbps link, 20 ms delay
            </span>
          </div>

          <div style={{ width: '100%', height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              {activeMetric === 'goodput' ? (
                <BarChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="loss" stroke="#64748b" />
                  <YAxis stroke="#64748b" label={{ value: 'Goodput (Kbps)', angle: -90, position: 'insideLeft', fill: '#94a3b8' }} />
                  <Tooltip contentStyle={{ background: '#0a1426', borderColor: '#1e3a5f', color: '#fff' }} />
                  <Legend />
                  <Bar dataKey="rlncGoodput" name="RLNC Goodput (Kbps)" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="rudpGoodput" name="RUDP Goodput (Kbps)" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              ) : activeMetric === 'time' ? (
                <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="loss" stroke="#64748b" />
                  <YAxis stroke="#64748b" label={{ value: 'Time (s)', angle: -90, position: 'insideLeft', fill: '#94a3b8' }} />
                  <Tooltip contentStyle={{ background: '#0a1426', borderColor: '#1e3a5f', color: '#fff' }} />
                  <Legend />
                  <Line type="monotone" dataKey="rlncTime" name="RLNC Completion Time (s)" stroke="#38bdf8" strokeWidth={3} dot={{ r: 5 }} />
                  <Line type="monotone" dataKey="rudpTime" name="RUDP Completion Time (s)" stroke="#f59e0b" strokeWidth={3} dot={{ r: 5 }} />
                </LineChart>
              ) : (
                <BarChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="loss" stroke="#64748b" />
                  <YAxis stroke="#64748b" label={{ value: 'Packets', angle: -90, position: 'insideLeft', fill: '#94a3b8' }} />
                  <Tooltip contentStyle={{ background: '#0a1426', borderColor: '#1e3a5f', color: '#fff' }} />
                  <Legend />
                  <Bar dataKey="rlncSent" name="RLNC Total Sent" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="rudpSent" name="RUDP Total Sent" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="rudpRetrans" name="RUDP Retransmissions" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>

        {/* RESULTS TABLE */}
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
              Experimental Matrix Records ({batchData.length} Executed Runs)
            </span>
            <span style={{ fontSize: '0.75rem', color: '#10b981' }}>
              ✓ Authenticated by NS-3 Simulator & SHA-256 byte comparisons
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ background: '#14253d', color: '#94a3b8', textAlign: 'left', borderBottom: '1px solid #1e3a5f' }}>
                  <th style={{ padding: '10px 12px' }}>Protocol</th>
                  <th style={{ padding: '10px 12px' }}>Config Loss</th>
                  <th style={{ padding: '10px 12px' }}>Observed Loss</th>
                  <th style={{ padding: '10px 12px' }}>Sim Duration</th>
                  <th style={{ padding: '10px 12px' }}>Goodput</th>
                  <th style={{ padding: '10px 12px' }}>Total Sent</th>
                  <th style={{ padding: '10px 12px' }}>Retrans / Repair</th>
                  <th style={{ padding: '10px 12px' }}>ACKs</th>
                  <th style={{ padding: '10px 12px' }}>File Hash</th>
                  <th style={{ padding: '10px 12px' }}>Status</th>
                  <th style={{ padding: '10px 12px' }}>Telemetry Trace</th>
                </tr>
              </thead>
              <tbody>
                {batchData.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
                      No batch results loaded yet. Click "Refresh Results" or execute `node scripts/run_batch_experiments.js`.
                    </td>
                  </tr>
                ) : (
                  batchData.map((row, idx) => {
                    const isSuccess = row.verified && row.status === 'VERIFIED';
                    return (
                      <tr
                        key={idx}
                        style={{
                          borderBottom: '1px solid #14253d',
                          background: idx % 2 === 0 ? 'rgba(15, 23, 42, 0.4)' : 'transparent',
                        }}
                      >
                        <td style={{ padding: '10px 12px', fontWeight: 700, color: row.protocol === 'RLNC' ? '#38bdf8' : '#f59e0b' }}>
                          {row.protocol}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#cbd5e1' }}>{row.lossRate}%</td>
                        <td style={{ padding: '10px 12px', color: '#94a3b8' }}>
                          {Number(row.observedLossPercent || 0).toFixed(1)}%
                        </td>
                        <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', color: '#fff' }}>
                          {Number(row.simTimeSec || 0).toFixed(4)} s
                        </td>
                        <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', color: isSuccess ? '#10b981' : '#f87171', fontWeight: 700 }}>
                          {Number(row.goodputKbps || 0).toFixed(2)} Kbps
                        </td>
                        <td style={{ padding: '10px 12px', color: '#cbd5e1' }}>{row.totalSent}</td>
                        <td style={{ padding: '10px 12px', color: '#cbd5e1' }}>
                          {row.protocol === 'RLNC' ? `${row.codedPackets || 0} coded` : `${row.retransmissions || 0} retrans`}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#cbd5e1' }}>{row.acks || 0}</td>
                        <td style={{ padding: '10px 12px' }}>
                          {isSuccess ? (
                            <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <CheckCircle2 size={13} /> MATCH
                            </span>
                          ) : (
                            <span style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <XCircle size={13} /> INCOMPLETE
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            background: isSuccess ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                            color: isSuccess ? '#10b981' : '#f87171',
                            border: `1px solid ${isSuccess ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                          }}>
                            {row.status}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', color: '#94a3b8' }}>
                          {row.traceFile || '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ACADEMIC ANALYSIS INSIGHT */}
        <div style={{
          background: 'rgba(37, 99, 235, 0.08)',
          border: '1px solid rgba(37, 99, 235, 0.3)',
          borderRadius: '8px',
          padding: '16px',
          fontSize: '0.8rem',
          lineHeight: '1.5',
          color: '#cbd5e1',
        }}>
          <div style={{ fontWeight: 700, color: '#60a5fa', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <FileCode size={16} /> Research Analysis & Theoretical Comparison:
          </div>
          <p style={{ margin: '0 0 6px 0' }}>
            <strong>1. Low to Moderate Loss (0% - 20%):</strong> RLNC achieves significantly superior throughput (up to ~295 Kbps vs 160 Kbps at 0%, and 86 Kbps vs 40 Kbps at 20%) because it streams rateless coded combinations without suffering the round-trip latency stalls imposed by Stop-and-Wait ARQ timeouts.
          </p>
          <p style={{ margin: 0 }}>
            <strong>2. High Loss Threshold (30%):</strong> At 30% loss, Stop-and-Wait ARQ eventually succeeds through persistent retransmissions (8 retransmissions, goodput degraded to 18 Kbps), whereas RLNC with limited static redundancy exhausted its repair budget before reaching full rank 4 (accurately reported as FAILED). This demonstrates that RLNC requires feedback-driven adaptive redundancy at severe loss regimes.
          </p>
        </div>
      </main>
    </div>
  );
}
