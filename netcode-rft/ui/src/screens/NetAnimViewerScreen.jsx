import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Play, ExternalLink, FileText, Monitor, CheckCircle2, RefreshCw, Activity, ArrowRight, Info, Eye, Copy, Check, AlertTriangle, Radio } from 'lucide-react';

export default function NetAnimViewerScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlTransferId = searchParams.get('transferId');

  const [traces, setTraces] = useState([]);
  const [selectedTrace, setSelectedTrace] = useState('');
  const [launching, setLaunching] = useState(false);
  const [launchStatus, setLaunchStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [traceEvents, setTraceEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  const fetchTraces = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/traces');
      if (res.ok) {
        const data = await res.json();
        const list = data.traces || [];
        setTraces(list);
        if (list.length > 0) {
          if (urlTransferId) {
            const matched = list.find(t => t.filename.includes(urlTransferId));
            if (matched) {
              setSelectedTrace(matched.wslPath || matched.path);
            } else if (!selectedTrace) {
              setSelectedTrace(list[0].wslPath || list[0].path);
            }
          } else if (!selectedTrace) {
            setSelectedTrace(list[0].wslPath || list[0].path);
          }
        }
      }
    } catch (err) {
      console.warn('Failed to fetch NetAnim traces:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTraces();
  }, [urlTransferId]);

  // Fetch parsed discrete packet events for the selected trace
  useEffect(() => {
    if (!selectedTrace) {
      setTraceEvents([]);
      return;
    }
    const filename = selectedTrace.split(/[\/\\]/).pop();
    if (!filename) return;

    setLoadingEvents(true);
    fetch(`/api/traces/${filename}/events`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && data.events) {
          setTraceEvents(data.events);
        } else {
          setTraceEvents([]);
        }
      })
      .catch(() => setTraceEvents([]))
      .finally(() => setLoadingEvents(false));
  }, [selectedTrace]);

  const copyWslPath = (path) => {
    if (!path) return;
    navigator.clipboard.writeText(path);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLaunch = async (tracePath) => {
    const target = tracePath || selectedTrace;
    if (!target) return;
    try {
      setLaunching(true);
      setLaunchStatus(null);
      const res = await fetch('/api/netanim/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracePath: target }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setLaunchStatus({
          type: 'success',
          message: `NetAnim desktop application launched successfully with trace: ${data.tracePath || target}`,
        });
      } else {
        setLaunchStatus({
          type: 'error',
          message: data.error || 'Failed to launch NetAnim desktop. Ensure the trace file exists.',
        });
      }
    } catch (err) {
      setLaunchStatus({
        type: 'error',
        message: `Failed to launch NetAnim: ${err.message}`,
      });
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0a0f1d', color: '#f8fafc', padding: '24px 32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '1px solid #1e293b', paddingBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Monitor size={28} color="#38bdf8" /> Official NetAnim Animation & Trace Management
          </h1>
          <p style={{ margin: '6px 0 0 0', color: '#94a3b8', fontSize: '0.9rem' }}>
            NS-3.41 Native Discrete-Event Simulation & NetAnim 3.109 Integration
          </p>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => navigate('/visualizer')}
            style={{
              background: '#1e293b',
              color: '#38bdf8',
              border: '1px solid #0284c7',
              padding: '8px 16px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Eye size={16} /> Open Web Telemetry Visualizer
          </button>
          <button
            onClick={() => navigate('/simulate')}
            style={{
              background: '#0284c7',
              color: '#ffffff',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            Run New Simulation <ArrowRight size={16} />
          </button>
        </div>
      </div>

      {/* Main Launch Hero Card */}
      <div style={{ background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: '12px', padding: '24px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ maxWidth: '650px' }}>
            <span style={{ background: '#0369a1', color: '#e0f2fe', padding: '4px 10px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Faculty Demonstration Tool
            </span>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 700, margin: '12px 0 8px 0', color: '#ffffff' }}>
              Launch Official NetAnim Desktop Application
            </h2>
            <p style={{ color: '#cbd5e1', fontSize: '0.92rem', lineHeight: 1.5, margin: '0 0 14px 0' }}>
              NetAnim is the official offline animator for NS-3 simulations. It parses the generated XML trace file, visualizes node positions (Sender Node 0, Receiver Node 1), animates packet transmissions across the point-to-point link, and provides packet statistics and timeline scrubbing.
            </p>

            {/* Selected Trace WSL Path Display */}
            {selectedTrace && (
              <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: '0.75rem', color: '#38bdf8', fontWeight: 600, textTransform: 'uppercase' }}>Selected Trace (WSL Path)</div>
                  <div style={{ fontSize: '0.82rem', fontFamily: 'monospace', color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedTrace}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => copyWslPath(selectedTrace)}
                  style={{
                    background: copied ? '#059669' : '#0284c7',
                    color: '#ffffff',
                    border: 'none',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    flexShrink: 0,
                    transition: 'all 0.2s',
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copied ? 'Copied WSL Path' : 'Copy WSL Path'}</span>
                </button>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '260px' }}>
            <button
              onClick={() => handleLaunch(selectedTrace)}
              disabled={launching || !selectedTrace}
              style={{
                background: launching ? '#475569' : '#22c55e',
                color: '#ffffff',
                border: 'none',
                padding: '14px 24px',
                borderRadius: '8px',
                cursor: (launching || !selectedTrace) ? 'not-allowed' : 'pointer',
                fontWeight: 700,
                fontSize: '1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                boxShadow: '0 4px 14px rgba(34, 197, 94, 0.3)',
              }}
            >
              <Play size={20} fill="#ffffff" /> {launching ? 'Launching...' : 'Launch NetAnim (Desktop)'}
            </button>
            <span style={{ fontSize: '0.78rem', color: '#94a3b8', textAlign: 'center' }}>
              Requires WSLg or X11 Display (:0)
            </span>
          </div>
        </div>

        {/* Tip for Avoiding "Trace file is invalid" */}
        <div style={{ marginTop: '16px', padding: '10px 14px', background: 'rgba(56, 189, 248, 0.08)', border: '1px solid rgba(56, 189, 248, 0.25)', borderRadius: '6px', color: '#93c5fd', fontSize: '0.8rem', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
          <Info size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong>Notice on NetAnim Path Resolution:</strong> NetAnim runs inside Ubuntu via WSL. The launch button automatically feeds the genuine WSL POSIX path to NetAnim. If you ever use NetAnim's <em>File → Open</em> dialog manually, paste the copied <strong>WSL Path</strong> (starting with <code>/mnt/f/...</code>). Windows paths like <code>F:\...</code> cannot be resolved by Linux and will cause NetAnim to show <em>"Trace file is invalid"</em>.
          </div>
        </div>

        {launchStatus && (
          <div style={{
            marginTop: '12px',
            padding: '12px 16px',
            borderRadius: '6px',
            background: launchStatus.type === 'success' ? '#064e3b' : (launchStatus.type === 'error' ? '#7f1d1d' : '#1e3a5f'),
            border: `1px solid ${launchStatus.type === 'success' ? '#10b981' : (launchStatus.type === 'error' ? '#ef4444' : '#38bdf8')}`,
            color: '#f8fafc',
            fontSize: '0.88rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            {launchStatus.type === 'error' ? <AlertTriangle size={18} /> : <Info size={18} />} {launchStatus.message}
          </div>
        )}
      </div>

      {/* Grid: Traces List & Architecture Info */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* Left Column: Trace Selector & Files */}
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '10px', padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileText size={18} color="#38bdf8" /> Generated NS-3 NetAnim Traces
            </h3>
            <button
              onClick={fetchTraces}
              style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem' }}
            >
              <RefreshCw size={14} /> Refresh
            </button>
          </div>

          {loading ? (
            <div style={{ color: '#94a3b8', padding: '20px', textAlign: 'center' }}>Loading available trace files...</div>
          ) : traces.length === 0 ? (
            <div style={{ color: '#94a3b8', padding: '20px', textAlign: 'center', border: '1px dashed #334155', borderRadius: '8px' }}>
              No NetAnim trace XML files found in <code>results/</code>.<br />
              Run a simulation to generate genuine animation traces.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '420px', overflowY: 'auto' }}>
              {traces.map((t, i) => {
                const isSelected = selectedTrace === (t.wslPath || t.path);
                return (
                  <div
                    key={i}
                    onClick={() => setSelectedTrace(t.wslPath || t.path)}
                    style={{
                      padding: '12px 14px',
                      borderRadius: '8px',
                      background: isSelected ? '#1e3a5f' : '#1e293b',
                      border: `1px solid ${isSelected ? '#38bdf8' : '#334155'}`,
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: isSelected ? '#ffffff' : '#e2e8f0' }}>
                        {t.filename}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '3px' }}>
                        {(t.sizeBytes / 1024).toFixed(1)} KB • {new Date(t.modified).toLocaleTimeString()}
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleLaunch(t.wslPath || t.path);
                      }}
                      style={{
                        background: '#0284c7',
                        color: '#ffffff',
                        border: 'none',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <Play size={12} fill="#ffffff" /> Open
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: NetAnim Topology & Verification */}
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '10px', padding: '20px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity size={18} color="#22c55e" /> Simulation & Topology Specifications
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '0.88rem' }}>
            <div style={{ padding: '12px', background: '#1e293b', borderRadius: '6px', borderLeft: '4px solid #38bdf8' }}>
              <div style={{ fontWeight: 600, color: '#ffffff' }}>1. Simulated Topology</div>
              <div style={{ color: '#cbd5e1', marginTop: '4px' }}>
                • <strong>Node 0 (Sender):</strong> Positioned at (10.0, 50.0), IP 10.1.1.1, Color Blue<br />
                • <strong>Node 1 (Receiver):</strong> Positioned at (90.0, 50.0), IP 10.1.1.2, Color Green<br />
                • <strong>Point-to-Point Channel:</strong> 10 Mbps DataRate, 20 ms Propagation Delay
              </div>
            </div>

            <div style={{ padding: '12px', background: '#1e293b', borderRadius: '6px', borderLeft: '4px solid #f59e0b' }}>
              <div style={{ fontWeight: 600, color: '#ffffff' }}>2. Physical Packet Drop Models</div>
              <div style={{ color: '#cbd5e1', marginTop: '4px' }}>
                • Genuine NS-3 <code>RateErrorModel</code> installed on both forward and reverse NetDevices.<br />
                • Physical packet drops traced via <code>PhyRxDrop</code> callback trace sinks.
              </div>
            </div>

            <div style={{ padding: '12px', background: '#1e293b', borderRadius: '6px', borderLeft: '4px solid #a855f7' }}>
              <div style={{ fontWeight: 600, color: '#ffffff' }}>3. How to Demonstrate to Faculty</div>
              <div style={{ color: '#cbd5e1', marginTop: '4px' }}>
                1. Select the desired trace XML file from the left panel.<br />
                2. Click <strong>Launch NetAnim (Desktop)</strong>.<br />
                3. The official NetAnim 3.109 Qt window will open on your desktop.<br />
                4. Press the green <strong>Play</strong> button in NetAnim to watch packet packets flow between Node 0 and Node 1.<br />
                5. Use the speed slider to accelerate or inspect individual packet drops.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Discrete Packet Events Table Correlating to NetAnim */}
      <div style={{ background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: '10px', padding: '20px', marginTop: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Radio size={20} color="#38bdf8" /> NetAnim Discrete-Event Packet Correlation Table
            </h3>
            <p style={{ margin: '4px 0 0 0', color: '#94a3b8', fontSize: '0.8rem' }}>
              Correlates NS-3 NetAnim XML <code>&lt;p&gt;</code> packets with backend telemetry events. Notice that NetAnim visualizes physical transit and drops across the 10 Mbps / 20 ms link; RLNC matrix decoding is performed at Node 1 (Receiver).
            </p>
          </div>
          <span style={{ fontSize: '0.8rem', color: '#cbd5e1', background: '#1e293b', padding: '4px 10px', borderRadius: '5px', border: '1px solid #334155' }}>
            {traceEvents.length} Total Packets in Trace
          </span>
        </div>

        {loadingEvents ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
            Loading trace packet events...
          </div>
        ) : traceEvents.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
            Select a NetAnim XML trace above to inspect its discrete packet transmission and reception events.
          </div>
        ) : (
          <div style={{ overflowX: 'auto', maxHeight: '360px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', fontFamily: 'var(--font-mono)' }}>
              <thead>
                <tr style={{ background: '#14253d', color: '#94a3b8', textAlign: 'left', borderBottom: '1px solid #1e3a5f' }}>
                  <th style={{ padding: '8px 12px' }}>Event Time (Tx)</th>
                  <th style={{ padding: '8px 12px' }}>Receive Time (Rx)</th>
                  <th style={{ padding: '8px 12px' }}>Path</th>
                  <th style={{ padding: '8px 12px' }}>Packet Type</th>
                  <th style={{ padding: '8px 12px' }}>Seq / Gen</th>
                  <th style={{ padding: '8px 12px' }}>NetAnim Channel Correlation</th>
                </tr>
              </thead>
              <tbody>
                {traceEvents.map((ev, idx) => {
                  const isForward = ev.direction === 'forward';
                  return (
                    <tr key={idx} style={{ borderBottom: '1px solid rgba(30, 58, 95, 0.4)', background: idx % 2 === 0 ? 'rgba(15, 23, 42, 0.4)' : 'transparent' }}>
                      <td style={{ padding: '6px 12px', color: '#38bdf8' }}>+{ev.txTimeMs.toFixed(2)} ms</td>
                      <td style={{ padding: '6px 12px', color: '#10b981' }}>+{ev.rxTimeMs.toFixed(2)} ms</td>
                      <td style={{ padding: '6px 12px' }}>
                        <span style={{
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.7rem',
                          background: isForward ? 'rgba(56, 189, 248, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                          color: isForward ? '#38bdf8' : '#34d399',
                        }}>
                          {isForward ? 'Node 0 → Node 1 (Forward)' : 'Node 1 → Node 0 (Reverse ACK)'}
                        </span>
                      </td>
                      <td style={{ padding: '6px 12px', fontWeight: 600, color: '#fff' }}>
                        {ev.typeName}
                      </td>
                      <td style={{ padding: '6px 12px', color: '#cbd5e1' }}>
                        {ev.seqId !== null ? `Seq #${ev.seqId + 1} (Gen ${ev.genId ?? 0})` : 'Control'}
                      </td>
                      <td style={{ padding: '6px 12px', color: '#64748b', fontSize: '0.72rem', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ev.meta.slice(0, 90)}...
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
