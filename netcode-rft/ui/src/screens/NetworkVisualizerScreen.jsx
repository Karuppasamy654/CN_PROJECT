import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Play, Pause, RotateCcw, SkipForward, SkipBack,
  Activity, CheckCircle2, AlertTriangle, Wifi, WifiOff,
  Layers, Cpu, ArrowRight, ArrowLeft, Hash, ShieldCheck,
  Terminal, RefreshCw, FileText, Check, Database
} from 'lucide-react';

export default function NetworkVisualizerScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialTransferId = searchParams.get('transferId') || '';

  const [history, setHistory] = useState([]);
  const [selectedId, setSelectedId] = useState(initialTransferId);
  const [transfer, setTransfer] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Timeline playback state
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(1); // 0.5x, 1x, 2x, 4x
  const timerRef = useRef(null);

  // Fetch experiment history
  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/history');
      if (!res.ok) throw new Error('Failed to fetch transfer history');
      const data = await res.json();
      const list = data.experiments || [];
      setHistory(list);
      if (!selectedId && list.length > 0) {
        setSelectedId(list[0].transfer_id || list[0].id);
      }
    } catch (err) {
      console.warn('Could not fetch history:', err.message);
    }
  };

  // Fetch transfer details and events
  const loadTransferData = async (tId) => {
    if (!tId) return;
    try {
      setLoading(true);
      setError('');
      setIsPlaying(false);

      const [tRes, evRes] = await Promise.all([
        fetch(`/api/transfers/${tId}`),
        fetch(`/api/transfers/${tId}/events`)
      ]);

      if (tRes.ok) {
        const tData = await tRes.json();
        setTransfer(tData);
      } else {
        setTransfer(null);
      }

      if (evRes.ok) {
        const evData = await evRes.json();
        const evList = evData.events || [];
        setEvents(evList);
        setCurrentIndex(evList.length > 0 ? evList.length - 1 : 0);
      } else {
        setEvents([]);
        setCurrentIndex(0);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  useEffect(() => {
    if (selectedId) {
      loadTransferData(selectedId);
    }
  }, [selectedId]);

  // Animation player tick
  useEffect(() => {
    if (isPlaying) {
      const intervalMs = Math.max(80, Math.floor(400 / playSpeed));
      timerRef.current = setInterval(() => {
        setCurrentIndex(prev => {
          if (prev >= events.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, intervalMs);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, events.length, playSpeed]);

  // Derived state up to current timeline index
  const visibleEvents = events.slice(0, currentIndex + 1);
  const currentEvent = events[currentIndex] || null;

  // Compute live statistics up to current timeline step
  let sentCount = 0;
  let recvCount = 0;
  let dropCount = 0;
  let innoCount = 0;
  let depCount = 0;
  let currentRank = 0;
  let verifiedPassed = false;
  let origSha = '';
  let reconSha = '';

  for (const ev of visibleEvents) {
    if (ev.type === 'packet_transmitted' || ev.type === 'packet_sent') sentCount++;
    if (ev.type === 'packet_received') recvCount++;
    if (ev.type === 'packet_dropped' || ev.type === 'phy_drop') dropCount++;
    if (ev.type === 'decoder_matrix_update') {
      currentRank = ev.rank || currentRank;
      if (ev.innovative) innoCount++;
      else depCount++;
    }
    if (ev.type === 'verification_result') {
      verifiedPassed = !!ev.passed;
      origSha = ev.original_sha256 || '';
      reconSha = ev.reconstructed_sha256 || '';
    }
  }

  // Active packet in flight for channel visualization
  const activePacket = currentEvent && (
    currentEvent.type === 'packet_transmitted' ||
    currentEvent.type === 'packet_sent' ||
    currentEvent.type === 'packet_received' ||
    currentEvent.type === 'packet_dropped' ||
    currentEvent.type === 'phy_drop' ||
    currentEvent.type === 'handshake'
  ) ? currentEvent : null;

  return (
    <div style={{
      width: '100vw',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: '#070f1e',
      color: '#f8fafc',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      overflowX: 'hidden',
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
          <h1 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff', letterSpacing: '0.3px', margin: 0 }}>
            NetCode-RFT
          </h1>
          <span style={{
            fontSize: '0.78rem',
            padding: '3px 8px',
            background: 'rgba(56, 189, 248, 0.15)',
            color: '#38bdf8',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            borderRadius: '4px',
            fontWeight: 600,
          }}>
            C11 Networking Engine Telemetry
          </span>
        </div>

        {/* Navigation Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => navigate('/')}
            style={{
              background: '#1e293b',
              color: '#cbd5e1',
              border: '1px solid #334155',
              padding: '7px 16px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: '0.85rem',
            }}
          >
            Live Simulation
          </button>
          <button
            onClick={() => navigate('/comparison')}
            style={{
              background: '#1e293b',
              color: '#cbd5e1',
              border: '1px solid #334155',
              padding: '7px 16px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: '0.85rem',
            }}
          >
            RLNC vs RUDP
          </button>
          <button
            style={{
              background: '#2563eb',
              color: '#fff',
              border: '1px solid #3b82f6',
              padding: '7px 16px',
              borderRadius: '6px',
              fontWeight: 600,
              fontSize: '0.85rem',
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
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: '0.85rem',
            }}
          >
            History
          </button>
          <button
            onClick={() => navigate(selectedId ? `/equations?transferId=${selectedId}` : '/equations')}
            style={{
              background: '#1e293b',
              color: '#cbd5e1',
              border: '1px solid #334155',
              padding: '7px 16px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: '0.85rem',
            }}
          >
            Equation Lab
          </button>
        </div>
      </header>

      {/* 2. SUBHEADER: TRANSFER SELECTOR & METADATA BAR */}
      <div style={{
        padding: '14px 24px',
        background: '#0d1d36',
        borderBottom: '1px solid #1e3a5f',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label style={{ fontSize: '0.84rem', color: '#94a3b8', fontWeight: 600 }}>
            Select Run:
          </label>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            style={{
              background: '#09152a',
              color: '#f8fafc',
              border: '1px solid #2a4365',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '0.85rem',
              fontWeight: 500,
              minWidth: '220px',
            }}
          >
            {history.length === 0 ? (
              <option value="">No past runs recorded</option>
            ) : (
              history.map((h, i) => (
                <option key={i} value={h.transfer_id || h.id}>
                  {h.transfer_id || h.id} — {(h.mode || h.protocol || 'RLNC').toUpperCase()} (Loss: {h.loss_rate != null ? (h.loss_rate * 100).toFixed(0) : 0}%)
                </option>
              ))
            )}
          </select>

          <button
            onClick={() => selectedId && loadTransferData(selectedId)}
            title="Refresh run telemetry"
            style={{
              background: '#1e293b',
              color: '#94a3b8',
              border: '1px solid #334155',
              padding: '6px 10px',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {transfer && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '0.82rem', color: '#cbd5e1' }}>
            <span><strong>Protocol:</strong> <span style={{ color: transfer.protocol === 'rlnc' ? '#38bdf8' : '#34d399' }}>{transfer.protocol.toUpperCase()}</span></span>
            <span><strong>File:</strong> {transfer.filename || 'input.bin'} ({transfer.fileSize ? `${transfer.fileSize} B` : '0 B'})</span>
            <span><strong>Channel:</strong> Loss {transfer.lossRate}% | Delay {transfer.delayMs}ms</span>
            <span><strong>Seed:</strong> {transfer.seed != null ? transfer.seed : 1}</span>
            <span>
              <strong>Status:</strong>{' '}
              <span style={{
                color: transfer.status === 'completed' ? '#34d399' : (transfer.status === 'failed' ? '#f87171' : '#fbbf24'),
                fontWeight: 600,
              }}>
                {transfer.status.toUpperCase()}
              </span>
            </span>
          </div>
        )}
      </div>

      {/* 3. MAIN INTERACTIVE VISUALIZATION AREA */}
      <div style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Animated Point-to-Point UDP Channel Canvas */}
        <div style={{
          background: 'linear-gradient(180deg, #0a1932 0%, #061124 100%)',
          border: '1px solid #1e3a5f',
          borderRadius: '12px',
          padding: '24px',
          boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
          position: 'relative',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Activity size={18} color="#38bdf8" />
              Real-Time C11 Engine Packet & Impairment Channel Simulation
            </h2>
            <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
              BSD UDP Sockets over 127.0.0.1:{transfer?.port || 9000} | Step {events.length > 0 ? currentIndex + 1 : 0} of {events.length}
            </div>
          </div>

          {/* Node 0 (Sender) <---> Link <---> Node 1 (Receiver) */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'relative',
            padding: '30px 10px',
          }}>
            {/* SENDER NODE */}
            <div style={{
              width: '210px',
              background: '#0e2244',
              border: '2px solid #2563eb',
              borderRadius: '10px',
              padding: '16px',
              textAlign: 'center',
              boxShadow: '0 0 20px rgba(37, 99, 235, 0.25)',
              zIndex: 2,
            }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
                <Cpu size={28} color="#60a5fa" />
              </div>
              <div style={{ fontWeight: 800, fontSize: '0.98rem', color: '#fff' }}>Node 0: Sender</div>
              <div style={{ fontSize: '0.74rem', color: '#93c5fd', marginTop: '2px' }}>C11 UDP socket (tx_sock)</div>
              <div style={{ marginTop: '12px', textAlign: 'left', fontSize: '0.76rem', color: '#cbd5e1', lineHeight: '1.4' }}>
                <div><strong>Packets Sent:</strong> <span style={{ color: '#60a5fa' }}>{sentCount}</span></div>
                <div><strong>Target:</strong> 127.0.0.1:{transfer?.port || 9000}</div>
                <div><strong>K / Redundancy:</strong> {transfer?.K || 4} / {transfer?.redundancy || 2}</div>
              </div>
            </div>

            {/* CHANNEL LINK (WITH IMPAIRMENT SIMULATION) */}
            <div style={{
              flex: 1,
              margin: '0 24px',
              position: 'relative',
              height: '80px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              {/* Channel Line */}
              <div style={{
                position: 'absolute',
                top: '50%',
                left: 0,
                right: 0,
                height: '4px',
                background: 'linear-gradient(90deg, #2563eb 0%, #a855f7 50%, #059669 100%)',
                transform: 'translateY(-50%)',
                borderRadius: '2px',
              }} />

              {/* Impairment Box in Middle of Channel */}
              <div style={{
                position: 'relative',
                background: '#111e38',
                border: '1px solid #334e7a',
                borderRadius: '8px',
                padding: '8px 16px',
                zIndex: 1,
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '0.72rem', color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Impairment Simulation Layer
                </div>
                <div style={{ fontSize: '0.75rem', color: '#cbd5e1', marginTop: '2px' }}>
                  Drop Rate: <strong>{transfer?.lossRate || 0}%</strong> | Delay: <strong>{transfer?.delayMs || 0}ms</strong>
                </div>
              </div>

              {/* Animated Floating Packet */}
              {activePacket && (
                <div style={{
                  position: 'absolute',
                  top: activePacket.type === 'packet_dropped' ? '10px' : (activePacket.type === 'handshake' ? '60px' : '22px'),
                  left: activePacket.type === 'packet_dropped' ? '50%' : (activePacket.type === 'packet_received' ? '75%' : '25%'),
                  transform: 'translate(-50%, -50%)',
                  background: activePacket.type === 'packet_dropped'
                    ? '#991b1b'
                    : (activePacket.type === 'packet_transmitted' ? '#1e40af' : '#065f46'),
                  border: `2px solid ${activePacket.type === 'packet_dropped' ? '#ef4444' : '#60a5fa'}`,
                  borderRadius: '6px',
                  padding: '4px 10px',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  color: '#fff',
                  boxShadow: '0 4px 15px rgba(0,0,0,0.5)',
                  zIndex: 3,
                  transition: 'all 0.25s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}>
                  {activePacket.type === 'packet_dropped' ? (
                    <>
                      <AlertTriangle size={14} color="#fca5a5" />
                      <span>DROPPED (Seq {activePacket.seq_id || 0})</span>
                    </>
                  ) : (
                    <>
                      <ArrowRight size={14} color="#93c5fd" />
                      <span>
                        {activePacket.type === 'handshake' ? 'HANDSHAKE' : `PKT (Seq ${activePacket.seq_id || 0})`}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* RECEIVER NODE */}
            <div style={{
              width: '210px',
              background: '#0e2244',
              border: `2px solid ${verifiedPassed ? '#10b981' : '#059669'}`,
              borderRadius: '10px',
              padding: '16px',
              textAlign: 'center',
              boxShadow: verifiedPassed ? '0 0 25px rgba(16, 185, 129, 0.35)' : '0 0 20px rgba(5, 150, 105, 0.25)',
              zIndex: 2,
            }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
                <Database size={28} color="#34d399" />
              </div>
              <div style={{ fontWeight: 800, fontSize: '0.98rem', color: '#fff' }}>Node 1: Receiver</div>
              <div style={{ fontSize: '0.74rem', color: '#6ee7b7', marginTop: '2px' }}>C11 UDP socket (rx_sock)</div>
              <div style={{ marginTop: '12px', textAlign: 'left', fontSize: '0.76rem', color: '#cbd5e1', lineHeight: '1.4' }}>
                <div><strong>Packets Received:</strong> <span style={{ color: '#34d399' }}>{recvCount}</span></div>
                <div><strong>Packets Dropped:</strong> <span style={{ color: '#f87171' }}>{dropCount}</span></div>
                {transfer?.protocol === 'rlnc' && (
                  <div><strong>Decoder Rank:</strong> <span style={{ color: '#38bdf8' }}>{currentRank} / {transfer?.K || 4}</span></div>
                )}
                {verifiedPassed && (
                  <div style={{ color: '#34d399', fontWeight: 700, marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <ShieldCheck size={14} /> SHA-256 Bit-Exact!
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 4. TIMELINE PLAYBACK CONTROLLER */}
          <div style={{
            marginTop: '18px',
            paddingTop: '16px',
            borderTop: '1px solid #1e3a5f',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            flexWrap: 'wrap',
          }}>
            {/* Play / Step Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={() => setCurrentIndex(0)}
                title="Restart timeline from start"
                style={{
                  background: '#1e293b',
                  color: '#cbd5e1',
                  border: '1px solid #334155',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                <RotateCcw size={15} />
              </button>

              <button
                onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
                disabled={currentIndex <= 0}
                title="Step backward one event"
                style={{
                  background: '#1e293b',
                  color: currentIndex <= 0 ? '#475569' : '#cbd5e1',
                  border: '1px solid #334155',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  cursor: currentIndex <= 0 ? 'not-allowed' : 'pointer',
                }}
              >
                <SkipBack size={15} />
              </button>

              <button
                onClick={() => setIsPlaying(!isPlaying)}
                style={{
                  background: isPlaying ? '#ef4444' : '#2563eb',
                  color: '#fff',
                  border: 'none',
                  padding: '6px 16px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {isPlaying ? <Pause size={15} /> : <Play size={15} />}
                <span>{isPlaying ? 'Pause' : 'Play'}</span>
              </button>

              <button
                onClick={() => setCurrentIndex(prev => Math.min(events.length - 1, prev + 1))}
                disabled={currentIndex >= events.length - 1}
                title="Step forward one event"
                style={{
                  background: '#1e293b',
                  color: currentIndex >= events.length - 1 ? '#475569' : '#cbd5e1',
                  border: '1px solid #334155',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  cursor: currentIndex >= events.length - 1 ? 'not-allowed' : 'pointer',
                }}
              >
                <SkipForward size={15} />
              </button>
            </div>

            {/* Timeline Slider */}
            <div style={{ flex: 1, minWidth: '200px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <input
                type="range"
                min={0}
                max={Math.max(0, events.length - 1)}
                value={currentIndex}
                onChange={(e) => {
                  setIsPlaying(false);
                  setCurrentIndex(parseInt(e.target.value, 10));
                }}
                style={{ flex: 1, accentColor: '#38bdf8', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '0.78rem', color: '#94a3b8', minWidth: '70px', textAlign: 'right' }}>
                {events.length > 0 ? `${currentIndex + 1} / ${events.length}` : '0 / 0'}
              </span>
            </div>

            {/* Speed Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Speed:</span>
              {[0.5, 1, 2, 4].map(speed => (
                <button
                  key={speed}
                  onClick={() => setPlaySpeed(speed)}
                  style={{
                    background: playSpeed === speed ? '#38bdf8' : '#1e293b',
                    color: playSpeed === speed ? '#070f1e' : '#cbd5e1',
                    border: '1px solid #334155',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    fontSize: '0.76rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {speed}x
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 5. SPLIT TELEMETRY LOG & DECODER MATRIX INSPECTOR */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '20px' }}>
          {/* C ENGINE EVENT STREAM */}
          <div style={{
            background: '#0a1932',
            border: '1px solid #1e3a5f',
            borderRadius: '10px',
            padding: '18px',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '380px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ fontSize: '0.92rem', fontWeight: 700, margin: 0, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Terminal size={16} color="#38bdf8" />
                Live Telemetry Log (EVENT_JSON)
              </h3>
              <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
                {visibleEvents.length} events logged
              </span>
            </div>

            <div style={{
              flex: 1,
              overflowY: 'auto',
              background: '#050c18',
              border: '1px solid #152744',
              borderRadius: '6px',
              padding: '10px',
              fontFamily: 'monospace',
              fontSize: '0.74rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}>
              {visibleEvents.length === 0 ? (
                <div style={{ color: '#475569', textAlign: 'center', padding: '20px' }}>
                  No telemetry recorded yet.
                </div>
              ) : (
                visibleEvents.slice(-40).map((ev, idx) => (
                  <div key={idx} style={{
                    padding: '4px 6px',
                    borderRadius: '4px',
                    background: ev.type === 'packet_dropped' ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
                    borderLeft: `3px solid ${
                      ev.type === 'packet_dropped' ? '#ef4444' :
                      (ev.type === 'packet_received' ? '#10b981' :
                      (ev.type === 'decoder_step' ? '#a855f7' : '#38bdf8'))
                    }`,
                  }}>
                    <span style={{ color: '#64748b' }}>[{ev.time != null ? Number(ev.time).toFixed(2) : '0.00'}ms]</span>{' '}
                    <strong style={{
                      color: ev.type === 'packet_dropped' ? '#f87171' :
                             (ev.type === 'packet_received' ? '#34d399' :
                             (ev.type === 'decoder_step' ? '#c084fc' : '#60a5fa'))
                    }}>
                      {ev.type}
                    </strong>:{' '}
                    {ev.type === 'decoder_step' && `Op: ${ev.op} | Row: ${ev.pivot_row} | PivotVal: ${ev.pivot_val}`}
                    {ev.type === 'decoder_matrix_update' && `Rank: ${ev.rank}/${ev.required_rank} (${ev.innovative ? 'INNOVATIVE' : 'DEPENDENT'})`}
                    {ev.type === 'packet_transmitted' && `Seq ${ev.seq_id} | Gen ${ev.gen_id} | Coeffs ${ev.coeffs || '[]'}`}
                    {ev.type === 'packet_received' && `Seq ${ev.seq_id} | Gen ${ev.gen_id} | Coeffs ${ev.coeffs || '[]'}`}
                    {ev.type === 'packet_dropped' && `Seq ${ev.seq_id} | Reason: Channel Loss Impairment`}
                    {ev.type === 'handshake' && `${ev.step_name}: ${ev.desc || ''}`}
                    {ev.type === 'verification_result' && `Passed: ${ev.passed ? 'YES' : 'NO'}`}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* RLNC GAUSSIAN ELIMINATION MATRIX STATUS */}
          <div style={{
            background: '#0a1932',
            border: '1px solid #1e3a5f',
            borderRadius: '10px',
            padding: '18px',
            display: 'flex',
            flexDirection: 'column',
          }}>
            <h3 style={{ fontSize: '0.92rem', fontWeight: 700, margin: '0 0 12px 0', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Layers size={16} color="#a855f7" />
              Decoder Matrix & Integrity Verification
            </h3>

            <div style={{
              background: '#050c18',
              border: '1px solid #152744',
              borderRadius: '6px',
              padding: '14px',
              fontSize: '0.8rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}>
              <div>
                <div style={{ color: '#94a3b8', fontSize: '0.74rem', marginBottom: '4px' }}>
                  Augmented Gaussian Elimination Matrix State:
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: currentRank >= (transfer?.K || 4) ? '#34d399' : '#38bdf8' }}>
                    Rank {currentRank} / {transfer?.K || 4}
                  </div>
                  <span style={{
                    fontSize: '0.72rem',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: currentRank >= (transfer?.K || 4) ? 'rgba(16, 185, 129, 0.2)' : 'rgba(56, 189, 248, 0.2)',
                    color: currentRank >= (transfer?.K || 4) ? '#34d399' : '#38bdf8',
                    fontWeight: 700,
                  }}>
                    {currentRank >= (transfer?.K || 4) ? 'SOLVABLE (Full Rank)' : 'UNDERDETERMINED'}
                  </span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.76rem' }}>
                <div style={{ background: '#0e2244', padding: '8px', borderRadius: '4px' }}>
                  <div style={{ color: '#94a3b8' }}>Innovative Packets:</div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: '#38bdf8' }}>{innoCount}</div>
                </div>
                <div style={{ background: '#0e2244', padding: '8px', borderRadius: '4px' }}>
                  <div style={{ color: '#94a3b8' }}>Dependent / Redundant:</div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: '#fbbf24' }}>{depCount}</div>
                </div>
              </div>

              {/* SHA-256 Hashes */}
              <div style={{ borderTop: '1px solid #1e3a5f', paddingTop: '10px', fontSize: '0.74rem' }}>
                <div style={{ color: '#94a3b8', marginBottom: '4px', fontWeight: 600 }}>
                  Cryptographic File Integrity:
                </div>
                {origSha ? (
                  <div style={{ fontFamily: 'monospace', lineHeight: '1.5' }}>
                    <div><strong>Original:</strong> <span style={{ color: '#93c5fd' }}>{origSha.substring(0, 28)}...</span></div>
                    <div><strong>Reconstructed:</strong> <span style={{ color: verifiedPassed ? '#34d399' : '#f87171' }}>{reconSha.substring(0, 28)}...</span></div>
                  </div>
                ) : (
                  <div style={{ color: '#64748b' }}>Transfer in progress or pending verification...</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
