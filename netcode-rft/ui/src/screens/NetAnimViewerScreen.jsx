import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, ExternalLink, FileText, Monitor, CheckCircle2, RefreshCw, Activity, ArrowRight, Info, Eye } from 'lucide-react';

export default function NetAnimViewerScreen() {
  const navigate = useNavigate();
  const [traces, setTraces] = useState([]);
  const [selectedTrace, setSelectedTrace] = useState('');
  const [launching, setLaunching] = useState(false);
  const [launchStatus, setLaunchStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchTraces = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/traces');
      if (res.ok) {
        const data = await res.json();
        const list = data.traces || [];
        setTraces(list);
        if (list.length > 0 && !selectedTrace) {
          setSelectedTrace(list[0].wslPath || list[0].path);
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
  }, []);

  const handleLaunch = async (tracePath) => {
    try {
      setLaunching(true);
      setLaunchStatus(null);
      const res = await fetch('/api/netanim/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracePath: tracePath || selectedTrace }),
      });
      const data = await res.json();
      if (data.success) {
        setLaunchStatus({
          type: 'success',
          message: 'NetAnim desktop application launched successfully via WSLg!',
        });
      } else {
        setLaunchStatus({
          type: 'info',
          message: 'NetAnim launch requested. If the desktop window does not appear, ensure WSLg or an X11 server is active.',
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
            <p style={{ color: '#cbd5e1', fontSize: '0.92rem', lineHeight: 1.5, margin: 0 }}>
              NetAnim is the official offline animator for NS-3 simulations. It parses the generated XML trace file, visualizes node positions (Sender Node 0, Receiver Node 1), animates packet transmissions across the point-to-point link, and provides packet statistics and timeline scrubbing.
            </p>
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

        {launchStatus && (
          <div style={{
            marginTop: '16px',
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
            <Info size={18} /> {launchStatus.message}
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
    </div>
  );
}
