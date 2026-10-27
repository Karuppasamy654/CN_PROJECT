import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTransfer } from '../context/TransferContext';
import {
  CheckCircle2,
  ShieldCheck,
  AlertCircle,
  FileText,
  Clock,
  Layers,
  Zap,
  ArrowRight,
  RefreshCw,
  Cpu,
  Info,
  Copy,
  Sliders,
  Check,
  XCircle,
} from 'lucide-react';

export default function EquationLabScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { transfer: contextTransfer, verification, events = [] } = useTransfer();

  const urlTransferId = searchParams.get('transferId');
  const urlPacketId = searchParams.get('packetId');
  const urlGen = searchParams.get('generation') ?? searchParams.get('gen');

  const [activeTransfer, setActiveTransfer] = useState(null);
  const effectiveTransferId = urlTransferId || contextTransfer?.id;

  const [calcData, setCalcData] = useState(null);
  const [selectedGen, setSelectedGen] = useState(urlGen ? parseInt(urlGen, 10) : 0);
  const [selectedStepIndex, setSelectedStepIndex] = useState(null);
  const [selectedDroppedPacket, setSelectedDroppedPacket] = useState(null);
  const [loading, setLoading] = useState(false);
  const [displayFormat, setDisplayFormat] = useState('dec'); // 'dec' | 'hex'

  // Sync external transfer record if opened via URL transferId
  useEffect(() => {
    if (urlTransferId && (!contextTransfer || contextTransfer.id !== urlTransferId)) {
      fetch(`/api/transfers/${urlTransferId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) setActiveTransfer(data);
        })
        .catch(console.error);
    }
  }, [urlTransferId, contextTransfer?.id]);

  const transfer = activeTransfer || contextTransfer;

  useEffect(() => {
    if (urlGen !== null && urlGen !== undefined) {
      const g = parseInt(urlGen, 10);
      if (!isNaN(g)) setSelectedGen(g);
    } else {
      setSelectedGen(0);
    }
  }, [effectiveTransferId, urlGen]);

  // Live dynamic polling and Socket sync: updates whenever new events arrive from NS-3 engine
  useEffect(() => {
    if (effectiveTransferId) {
      setLoading(true);
      fetch(`/api/calculations/transfer/${effectiveTransferId}?generation=${selectedGen}`)
        .then((res) => res.json())
        .then((data) => {
          setCalcData(data);
          // If a packetId was requested via URL, correlate to its exact step or drop event
          if (urlPacketId !== null && urlPacketId !== undefined) {
            const pIdNum = parseInt(urlPacketId, 10);
            const drop = (data.droppedPackets || []).find((d) => d.seqId === pIdNum);
            if (drop) {
              setSelectedDroppedPacket(drop);
              setSelectedStepIndex(null);
            } else {
              const stepIdx = (data.decoderHistory || []).findIndex((s) => s.seqId === pIdNum);
              if (stepIdx !== -1) {
                setSelectedStepIndex(stepIdx);
                setSelectedDroppedPacket(null);
              }
            }
          }
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    } else {
      setCalcData(null);
    }
  }, [effectiveTransferId, selectedGen, events?.length, urlPacketId]);

  const isRudp = transfer?.protocol === 'rudp';
  const isEmptyFile = transfer?.fileSize === 0;

  // RLNC-specific derived values
  const K = calcData?.generationSize || calcData?.requiredRank || transfer?.K || 4;
  const totalGenerations = calcData?.totalGenerations || 1;
  const receivedPackets = calcData?.receivedPackets || [];
  const matrixA = calcData?.matrixA || [];
  const matrixC = calcData?.matrixC || [];
  const rank = calcData?.rank !== undefined ? calcData.rank : 0;
  const totalReceivedPackets = calcData?.totalReceivedPackets !== undefined ? calcData.totalReceivedPackets : receivedPackets.length;
  const independentEquations = calcData?.independentEquations !== undefined ? calcData.independentEquations : rank;
  const dependentEquations = calcData?.dependentEquations !== undefined ? calcData.dependentEquations : Math.max(0, totalReceivedPackets - independentEquations);
  const isFullRank = Boolean(calcData?.isFullRank);
  const gaussJordan = calcData?.gaussJordan || null;
  const decodedPackets = calcData?.decodedPackets || [];

  const decoderHistory = calcData?.decoderHistory || [];
  const droppedPackets = calcData?.droppedPackets || [];
  const reverseDroppedAcks = calcData?.reverseDroppedAcks || [];
  const gf256Info = calcData?.gf256Info || {
    field: 'GF(256)',
    irreduciblePolynomial: '0x11D',
    polynomialDescription: 'P(x) = x^8 + x^4 + x^3 + x^2 + 1',
    generatorElement: '0x02',
    addition: 'Bitwise XOR (⊕)',
    multiplication: 'Log/Exp table lookup with reduction modulo 0x11D',
  };

  const isStepSelected = selectedStepIndex !== null && decoderHistory[selectedStepIndex];
  const activeStep = isStepSelected
    ? decoderHistory[selectedStepIndex]
    : (decoderHistory.length > 0 ? decoderHistory[decoderHistory.length - 1] : null);

  const activeReceivedPackets = isStepSelected
    ? receivedPackets.filter(p => (activeStep.time != null && p.time != null) ? p.time <= activeStep.time : p.seqId <= activeStep.seqId)
    : receivedPackets;

  const activeMatrixA = isStepSelected && activeStep.matrixA
    ? activeStep.matrixA
    : matrixA;

  const activeMatrixC = isStepSelected && activeStep.matrixY
    ? activeStep.matrixY.map(r => r.slice(0, 3))
    : matrixC;

  const activeRank = isStepSelected && activeStep.rankAfter !== undefined
    ? activeStep.rankAfter
    : rank;

  const activeGaussSteps = isStepSelected && activeStep.operations && activeStep.operations.length > 0
    ? activeStep.operations.map(op => ({
        op: op.op,
        desc: op.desc || `${op.op.toUpperCase()} on Row ${op.row || op.target_row || 1}`,
        row: op.row,
        targetRow: op.target_row,
        pivotRow: op.pivot_row,
        factor: op.factor,
      }))
    : (gaussJordan?.steps || []);

  // Reliable UDP-specific derived values
  const rudpData = calcData?.rudpData || null;
  const sourceBlocks = calcData?.sourceBlocks || [];
  const transmittedPackets = calcData?.transmittedPackets || [];

  const origHash = verification?.origSha || transfer?.fileSha256 || '';
  const reconHash = verification?.reconSha || '';
  const hashesMatch = Boolean(verification?.verified && origHash && reconHash && origHash === reconHash);

  // Helper to format mathematical bracket matrix with Decimal/Hex display support
  const renderBracketMatrix = (mat, borderCol = '#38bdf8', isHex = displayFormat === 'hex') => {
    if (!mat || mat.length === 0) return null;
    return (
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        borderLeft: `2.5px solid ${borderCol}`,
        borderRight: `2.5px solid ${borderCol}`,
        borderRadius: '4px',
        padding: '4px 10px',
        margin: '6px 0',
        background: 'rgba(15, 23, 42, 0.6)',
        maxWidth: '100%',
        overflowX: 'auto',
        overflowY: 'visible',
      }}>
        <table style={{ borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: '0.78rem', textAlign: 'center', width: '100%', tableLayout: 'auto' }}>
          <tbody>
            {mat.map((row, rIdx) => (
              <tr key={rIdx} style={{ height: '24px' }}>
                {row.map((val, cIdx) => (
                  <td key={cIdx} style={{ padding: '2px 8px', color: '#e2e8f0', whiteSpace: 'nowrap' }}>
                    {isHex ? `0x${Number(val).toString(16).padStart(2, '0').toUpperCase()}` : val}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

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
          <h1 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff', letterSpacing: '0.3px', margin: 0 }}>
            {isRudp ? 'Reliable UDP Protocol Lab' : 'Matrix Decoding Method (RLNC)'}
          </h1>
          {transfer ? (
            <span style={{ fontSize: '0.75rem', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.1)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
              Transfer: {transfer.id} ({transfer.protocol.toUpperCase()})
            </span>
          ) : (
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              No transfer active
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => navigate(transfer?.id ? `/?transferId=${transfer.id}` : '/')}
            style={{
              background: '#1e293b',
              color: '#cbd5e1',
              border: '1px solid #334155',
              padding: '7px 18px',
              borderRadius: '6px',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#334155';
              e.currentTarget.style.color = '#fff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#1e293b';
              e.currentTarget.style.color = '#cbd5e1';
            }}
          >
            Transfer & Simulation
          </button>
          <button
            onClick={() => navigate(transfer?.id ? `/visualizer?transferId=${transfer.id}` : '/visualizer')}
            style={{
              background: '#1e293b',
              color: '#cbd5e1',
              border: '1px solid #334155',
              padding: '7px 18px',
              borderRadius: '6px',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            Packet Visualizer
          </button>
          <button
            onClick={() => navigate(transfer?.id ? `/netanim?transferId=${transfer.id}` : '/netanim')}
            style={{
              background: '#1e293b',
              color: '#cbd5e1',
              border: '1px solid #334155',
              padding: '7px 18px',
              borderRadius: '6px',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            NetAnim
          </button>
          <button
            style={{
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              padding: '7px 18px',
              borderRadius: '6px',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: 'default',
              boxShadow: '0 2px 10px rgba(37, 99, 235, 0.4)',
            }}
          >
            {isRudp ? 'Protocol Lab' : 'Equation Lab'}
          </button>
        </div>
      </header>

      {/* 2. BODY WORKSPACE */}
      <main style={{
        flex: 1,
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}>
        {/* CASE A: NO TRANSFER ACTIVE */}
        {!transfer && (
          <div className="glass-panel" style={{
            padding: '48px 24px',
            background: '#0d1b2e',
            borderRadius: '10px',
            border: '1px solid #1e3a5f',
            textAlign: 'center',
          }}>
            <Info size={32} color="#38bdf8" style={{ margin: '0 auto 12px' }} />
            <h3 style={{ fontSize: '1.1rem', color: '#fff', marginBottom: '8px' }}>No Active Transfer</h3>
            <p style={{ color: '#94a3b8', fontSize: '0.85rem', maxWidth: '480px', margin: '0 auto 16px' }}>
              No RLNC equations are available because this transfer session has not generated any coded packets. Select a file and launch a transfer on the Transfer & Simulation screen to inspect real packet operations.
            </p>
            <button
              onClick={() => navigate('/')}
              style={{
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                padding: '8px 20px',
                borderRadius: '6px',
                fontSize: '0.82rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Go to Transfer & Simulation
            </button>
          </div>
        )}

        {/* CASE B: EMPTY 0-BYTE FILE */}
        {transfer && isEmptyFile && (
          <div className="glass-panel" style={{
            padding: '36px 24px',
            background: '#0d1b2e',
            borderRadius: '10px',
            border: '1px solid #1e3a5f',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: 'rgba(56, 189, 248, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#38bdf8',
              }}>
                <FileText size={20} />
              </div>
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fff', margin: 0 }}>
                  Empty File Transfer (0 Bytes)
                </h3>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                  Source: {transfer.filename} (0 bytes) | Protocol: {transfer.protocol.toUpperCase()}
                </span>
              </div>
            </div>

            <div style={{
              background: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid #1e3a5f',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '20px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '16px',
            }}>
              <div>
                <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Source Data Blocks</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fff', fontFamily: 'var(--font-mono)' }}>0 Blocks</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>RLNC Generations</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fff', fontFamily: 'var(--font-mono)' }}>0 Generations</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>File-Data Packets</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fff', fontFamily: 'var(--font-mono)' }}>0 Packets</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Control Handshake</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#10b981', fontFamily: 'var(--font-mono)' }}>Completed (3-Way)</div>
              </div>
            </div>

            <div style={{
              padding: '14px 18px',
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              borderRadius: '8px',
              color: '#cbd5e1',
              fontSize: '0.8rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', fontWeight: 700 }}>
                <CheckCircle2 size={16} color="#10b981" />
                <span>Zero-Payload Transmission Validated</span>
              </div>
              <p style={{ margin: 0, color: '#94a3b8' }}>
                This transfer has 0 source blocks and contains no file payload. No artificial data packets or matrix equations were fabricated. The original empty file and reconstructed 0-byte output match cryptographically (SHA-256: <code style={{ color: '#38bdf8' }}>e3b0c442...</code>).
              </p>
            </div>
          </div>
        )}

        {/* CASE C: RELIABLE UDP DEDICATED PROTOCOL INSPECTOR */}
        {transfer && !isEmptyFile && isRudp && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* HONEST PROTOCOL METRICS BAR */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '10px',
            }}>
              <div className="glass-panel" style={{ padding: '10px 12px', background: '#0b1626', borderRadius: '8px', border: '1px solid #1e3a5f' }}>
                <div style={{ fontSize: '0.66rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>Source Blocks</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>
                  {rudpData?.metrics?.originalBlocks ?? (calcData?.fileSplitting?.totalBlocks || 0)}
                </div>
              </div>
              <div className="glass-panel" style={{ padding: '10px 12px', background: '#0b1626', borderRadius: '8px', border: '1px solid #1e3a5f' }}>
                <div style={{ fontSize: '0.66rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>Tx Attempts</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#fff', fontFamily: 'var(--font-mono)' }}>
                  {rudpData?.metrics?.transmissionAttempts ?? transmittedPackets.length}
                </div>
              </div>
              <div className="glass-panel" style={{ padding: '10px 12px', background: '#0b1626', borderRadius: '8px', border: '1px solid #1e3a5f' }}>
                <div style={{ fontSize: '0.66rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>Unique Rx Packets</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#10b981', fontFamily: 'var(--font-mono)' }}>
                  {rudpData?.metrics?.uniquePacketsReceived ?? (new Set(receivedPackets.map(p => p.seqId))).size}
                </div>
              </div>
              <div className="glass-panel" style={{ padding: '10px 12px', background: '#0b1626', borderRadius: '8px', border: '1px solid #1e3a5f' }}>
                <div style={{ fontSize: '0.66rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>Dropped Packets</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: (rudpData?.metrics?.droppedPackets || 0) > 0 ? '#f87171' : '#94a3b8', fontFamily: 'var(--font-mono)' }}>
                  {rudpData?.metrics?.droppedPackets ?? (rudpData?.drops?.length || 0)}
                </div>
              </div>
              <div className="glass-panel" style={{ padding: '10px 12px', background: '#0b1626', borderRadius: '8px', border: '1px solid #1e3a5f' }}>
                <div style={{ fontSize: '0.66rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>Retransmissions</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: (rudpData?.metrics?.retransmissions || 0) > 0 ? '#f59e0b' : '#94a3b8', fontFamily: 'var(--font-mono)' }}>
                  {rudpData?.metrics?.retransmissions ?? (rudpData?.retransmits?.length || 0)}
                </div>
              </div>
              <div className="glass-panel" style={{ padding: '10px 12px', background: '#0b1626', borderRadius: '8px', border: '1px solid #1e3a5f' }}>
                <div style={{ fontSize: '0.66rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>Receiver ACKs Sent</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#60a5fa', fontFamily: 'var(--font-mono)' }}>
                  {rudpData?.metrics?.acksSent ?? (rudpData?.acksSent?.length || (rudpData?.acks?.length || 0))}
                </div>
              </div>
              <div className="glass-panel" style={{ padding: '10px 12px', background: '#0b1626', borderRadius: '8px', border: '1px solid #1e3a5f' }}>
                <div style={{ fontSize: '0.66rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>Sender ACKs Recv</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#10b981', fontFamily: 'var(--font-mono)' }}>
                  {rudpData?.metrics?.acksReceived ?? (rudpData?.acks?.length || 0)}
                </div>
              </div>
              <div className="glass-panel" style={{ padding: '10px 12px', background: '#0b1626', borderRadius: '8px', border: '1px solid #1e3a5f' }}>
                <div style={{ fontSize: '0.66rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>Verified Output</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: verification?.verified ? '#10b981' : '#94a3b8', fontFamily: 'var(--font-mono)' }}>
                  {verification?.verified ? `${transfer.fileSize} B` : '0 B'}
                </div>
              </div>
            </div>

            {/* 6 LAB CARDS */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
              {/* CARD 1: Source Block Segmentation */}
              <div className="glass-panel" style={{ padding: '16px', background: '#0d1b2e', borderRadius: '10px', border: '1px solid #1e3a5f' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#2563eb', color: '#fff', fontSize: '0.72rem', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>1</span>
                  <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#fff', margin: 0 }}>Source Block Segmentation</h3>
                </div>
                <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginBottom: '12px' }}>
                  File partitioned into {calcData?.fileSplitting?.totalBlocks || 0} unique blocks ({transfer.blockSize} B/block)
                </div>
                <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
                  {sourceBlocks.length === 0 ? (
                    <div style={{ padding: '16px', textAlign: 'center', color: '#64748b', fontSize: '0.75rem' }}>No source blocks created</div>
                  ) : (
                    sourceBlocks.map((blk) => (
                      <div key={blk.blockId} style={{ padding: '6px 8px', borderBottom: '1px solid rgba(30, 58, 95, 0.4)', fontSize: '0.74rem', display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)' }}>
                        <span style={{ color: '#38bdf8', fontWeight: 700 }}>Block #{blk.blockId + 1}</span>
                        <span style={{ color: '#94a3b8' }}>offset {blk.blockId * transfer.blockSize}</span>
                        <span style={{ color: '#e2e8f0' }}>{blk.len} B</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* CARD 2: Datagram Transmissions & Attempts */}
              <div className="glass-panel" style={{ padding: '16px', background: '#0d1b2e', borderRadius: '10px', border: '1px solid #1e3a5f' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#2563eb', color: '#fff', fontSize: '0.72rem', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>2</span>
                  <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#fff', margin: 0 }}>Stop-and-Wait Transmission Attempts</h3>
                </div>
                <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginBottom: '12px' }}>
                  Physical send attempts distinguishing initial vs. retries
                </div>
                <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
                  {transmittedPackets.length === 0 ? (
                    <div style={{ padding: '16px', textAlign: 'center', color: '#64748b', fontSize: '0.75rem' }}>No transmissions recorded</div>
                  ) : (
                    transmittedPackets.map((pkt, idx) => {
                      const isRetry = (pkt.attempt || 1) > 1;
                      const wasDropped = (rudpData?.drops || []).some(d => d.seqId === pkt.seqId && (d.attempt || 1) === (pkt.attempt || 1));
                      return (
                        <div key={idx} style={{
                          padding: '6px 8px',
                          borderBottom: '1px solid rgba(30, 58, 95, 0.4)',
                          fontSize: '0.74rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontFamily: 'var(--font-mono)',
                          background: isRetry ? 'rgba(245, 158, 11, 0.05)' : 'transparent',
                        }}>
                          <div>
                            <span style={{ color: '#fff', fontWeight: 700 }}>PKT #{pkt.seqId + 1}</span>
                            <span style={{
                              fontSize: '0.65rem',
                              marginLeft: '8px',
                              padding: '1px 5px',
                              borderRadius: '3px',
                              background: isRetry ? 'rgba(245, 158, 11, 0.2)' : 'rgba(56, 189, 248, 0.15)',
                              color: isRetry ? '#f59e0b' : '#38bdf8',
                              fontWeight: 600,
                            }}>
                              Attempt {pkt.attempt || 1}{isRetry ? ` (Retry #${(pkt.attempt || 1) - 1})` : ' (Initial)'}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ color: '#94a3b8' }}>{pkt.payloadLen} B</span>
                            {wasDropped ? (
                              <span style={{ color: '#f87171', fontWeight: 700, fontSize: '0.68rem' }}>DROPPED</span>
                            ) : (
                              <span style={{ color: '#10b981', fontWeight: 600, fontSize: '0.68rem' }}>SENT</span>
                            )}
                            <span style={{ color: '#64748b', fontSize: '0.68rem' }}>+{Number(pkt.time || 0).toFixed(1)}ms</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* CARD 3: Receiver ACKs & RTT */}
              <div className="glass-panel" style={{ padding: '16px', background: '#0d1b2e', borderRadius: '10px', border: '1px solid #1e3a5f' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#2563eb', color: '#fff', fontSize: '0.72rem', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>3</span>
                  <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#fff', margin: 0 }}>Receiver ACKs & Measured RTT</h3>
                </div>
                <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginBottom: '12px' }}>
                  Correlated receiver confirmations with socket RTT
                </div>
                <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
                  {(rudpData?.acks || []).length === 0 ? (
                    <div style={{ padding: '16px', textAlign: 'center', color: '#64748b', fontSize: '0.75rem' }}>Waiting for ACKs...</div>
                  ) : (
                    (rudpData?.acks || []).map((ack, idx) => (
                      <div key={idx} style={{ padding: '6px 8px', borderBottom: '1px solid rgba(30, 58, 95, 0.4)', fontSize: '0.74rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'var(--font-mono)' }}>
                        <div>
                          <span style={{ color: '#10b981', fontWeight: 700 }}>ACK #{ack.ackSeq + 1}</span>
                          <span style={{ color: '#94a3b8', fontSize: '0.68rem', marginLeft: '6px' }}>
                            (for Attempt {ack.attempt || 1})
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ color: '#38bdf8', fontSize: '0.7rem' }}>
                            {ack.rttMs !== null ? `RTT ${ack.rttMs.toFixed(1)}ms` : 'Confirmed'}
                          </span>
                          <span style={{ color: '#cbd5e1', fontSize: '0.68rem' }}>+{Number(ack.time || 0).toFixed(1)}ms</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* CARD 4: Timeouts & Retransmissions */}
              <div className="glass-panel" style={{ padding: '16px', background: '#0d1b2e', borderRadius: '10px', border: '1px solid #1e3a5f' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#2563eb', color: '#fff', fontSize: '0.72rem', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>4</span>
                  <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#fff', margin: 0 }}>ARQ Timeouts & Retransmissions</h3>
                </div>
                <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginBottom: '12px' }}>
                  Real retransmission triggers when socket timeout expires
                </div>
                <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
                  {(rudpData?.retransmits || []).length === 0 ? (
                    <div style={{ padding: '16px', textAlign: 'center', color: '#10b981', fontSize: '0.75rem' }}>
                      0 retransmissions required (Clean channel)
                    </div>
                  ) : (
                    (rudpData?.retransmits || []).map((ret, idx) => (
                      <div key={idx} style={{ padding: '6px 8px', borderBottom: '1px solid rgba(30, 58, 95, 0.4)', fontSize: '0.74rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'var(--font-mono)' }}>
                        <div>
                          <span style={{ color: '#f87171', fontWeight: 700 }}>PKT #{ret.seqId + 1}</span>
                          <span style={{ color: '#f59e0b', marginLeft: '6px' }}>Retry #{ret.retryCount} (Attempt {ret.attempt})</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ color: '#94a3b8', fontSize: '0.68rem' }}>Timeout &gt; 100ms</span>
                          <span style={{ color: '#64748b', fontSize: '0.68rem' }}>+{Number(ret.time || 0).toFixed(1)}ms</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* CARD 5: In-Order Reassembly */}
              <div className="glass-panel" style={{ padding: '16px', background: '#0d1b2e', borderRadius: '10px', border: '1px solid #1e3a5f' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#2563eb', color: '#fff', fontSize: '0.72rem', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>5</span>
                  <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#fff', margin: 0 }}>Receiver File Reassembly</h3>
                </div>
                <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginBottom: '12px' }}>
                  In-order byte reconstruction without duplicate inflation
                </div>
                <div style={{
                  height: '8px',
                  background: '#1e293b',
                  borderRadius: '4px',
                  overflow: 'hidden',
                  marginBottom: '12px',
                }}>
                  <div style={{
                    width: verification?.verified ? '100%' : `${Math.min(100, Math.round(((rudpData?.metrics?.uniquePacketsReceived || 0) / (calcData?.fileSplitting?.totalBlocks || 1)) * 100))}%`,
                    height: '100%',
                    background: '#10b981',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
                <div style={{ fontSize: '0.8rem', color: verification?.verified ? '#10b981' : '#38bdf8', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <CheckCircle2 size={16} color={verification?.verified ? '#10b981' : '#38bdf8'} aria-hidden="true" />
                  <span>
                    {verification?.verified
                      ? `Reassembled ${transfer.fileSize} bytes in order`
                      : `Reassembled ${(rudpData?.metrics?.uniquePacketsReceived || 0) * (transfer.blockSize || 1024)} of ${transfer.fileSize} bytes`}
                  </span>
                </div>
              </div>

              {/* CARD 6: Full 64-char SHA-256 Verification with Copy Buttons */}
              <div className="glass-panel" style={{ padding: '16px', background: '#0d1b2e', borderRadius: '10px', border: '1px solid #1e3a5f' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#2563eb', color: '#fff', fontSize: '0.72rem', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>6</span>
                  <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#fff', margin: 0 }}>SHA-256 Integrity Verification</h3>
                </div>
                <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginBottom: '10px' }}>
                  Full 64-character cryptographic hash comparison
                </div>
                <div style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div>
                    <div style={{ color: '#94a3b8', marginBottom: '3px', fontSize: '0.68rem' }}>Original Source Hash (SHA-256):</div>
                    <div style={{ background: '#091322', padding: '6px 8px', borderRadius: '4px', border: '1px solid #1e3a5f', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: '#38bdf8', fontSize: '0.67rem', wordBreak: 'break-all' }}>{origHash || '—'}</span>
                      {origHash && (
                        <button
                          onClick={() => navigator.clipboard.writeText(origHash)}
                          title="Copy full SHA-256"
                          style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '2px 4px', display: 'flex', alignItems: 'center' }}
                        >
                          <Copy size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#94a3b8', marginBottom: '3px', fontSize: '0.68rem' }}>Reconstructed Output Hash (SHA-256):</div>
                    <div style={{ background: '#091322', padding: '6px 8px', borderRadius: '4px', border: '1px solid #1e3a5f', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: hashesMatch ? '#10b981' : (reconHash ? '#f87171' : '#94a3b8'), fontSize: '0.67rem', wordBreak: 'break-all' }}>
                        {reconHash || 'Pending reconstruction...'}
                      </span>
                      {reconHash && (
                        <button
                          onClick={() => navigator.clipboard.writeText(reconHash)}
                          title="Copy full SHA-256"
                          style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '2px 4px', display: 'flex', alignItems: 'center' }}
                        >
                          <Copy size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: '12px', fontSize: '0.8rem', color: hashesMatch ? '#10b981' : (verification?.state === 'FAILED' ? '#ef4444' : '#94a3b8'), fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <CheckCircle2 size={16} color={hashesMatch ? '#10b981' : (verification?.state === 'FAILED' ? '#ef4444' : '#94a3b8')} aria-hidden="true" />
                  <span>
                    {hashesMatch
                      ? 'Hashes Match (Bit-Exact Integrity Verified)'
                      : (verification?.state === 'FAILED'
                          ? `Verification Failed: ${verification?.message || 'Hash mismatch'}`
                          : 'Pending verification')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* CASE D: RLNC GALOIS FIELD GF(256) EQUATION LAB */}
        {transfer && !isEmptyFile && !isRudp && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* INTERACTIVE TIMELINE SCRUBBER & DYNAMIC EQUATION INSPECTOR */}
            <div className="glass-panel" style={{
              padding: '16px 20px',
              background: '#0a1932',
              borderRadius: '10px',
              border: '1px solid #1e3a5f',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Sliders size={20} color="#38bdf8" />
                  <div>
                    <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0, color: '#fff' }}>
                      Simulation Timeline & Mathematical Equation Stepper
                    </h3>
                    <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                      GF(256) Primitive Polynomial: <code style={{ color: '#38bdf8' }}>{gf256Info.irreduciblePolynomial}</code> ({gf256Info.polynomialDescription}) | Generator: <code style={{ color: '#38bdf8' }}>{gf256Info.generatorElement}</code>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ display: 'flex', background: '#1e293b', borderRadius: '5px', border: '1px solid #334155', padding: '2px' }}>
                    <button
                      onClick={() => setDisplayFormat('dec')}
                      style={{
                        background: displayFormat === 'dec' ? '#2563eb' : 'transparent',
                        color: displayFormat === 'dec' ? '#fff' : '#94a3b8',
                        border: 'none',
                        padding: '3px 8px',
                        borderRadius: '4px',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      DEC (0–255)
                    </button>
                    <button
                      onClick={() => setDisplayFormat('hex')}
                      style={{
                        background: displayFormat === 'hex' ? '#2563eb' : 'transparent',
                        color: displayFormat === 'hex' ? '#fff' : '#94a3b8',
                        border: 'none',
                        padding: '3px 8px',
                        borderRadius: '4px',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      HEX (0x00–0xFF)
                    </button>
                  </div>

                  <button
                    onClick={() => { setSelectedStepIndex(null); setSelectedDroppedPacket(null); }}
                    style={{
                      background: selectedStepIndex === null && !selectedDroppedPacket ? '#2563eb' : '#1e293b',
                      color: '#fff',
                      border: '1px solid #334155',
                      padding: '5px 12px',
                      borderRadius: '5px',
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    All Packets (Final State)
                  </button>
                </div>
              </div>

              {/* TIMELINE SLIDER */}
              {decoderHistory.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '14px', background: 'rgba(15, 23, 42, 0.6)', padding: '8px 14px', borderRadius: '6px' }}>
                  <span style={{ fontSize: '0.74rem', color: '#94a3b8', minWidth: '90px' }}>
                    {isStepSelected ? `Step ${selectedStepIndex + 1} of ${decoderHistory.length}` : `All ${decoderHistory.length} Steps`}
                  </span>
                  <input
                    type="range"
                    min="0"
                    max={decoderHistory.length - 1}
                    value={selectedStepIndex !== null ? selectedStepIndex : decoderHistory.length - 1}
                    onChange={(e) => {
                      setSelectedStepIndex(parseInt(e.target.value, 10));
                      setSelectedDroppedPacket(null);
                    }}
                    style={{ flex: 1, accentColor: '#38bdf8', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '0.74rem', color: '#38bdf8', fontFamily: 'var(--font-mono)', minWidth: '90px', textAlign: 'right' }}>
                    {activeStep?.time != null ? `+${(activeStep.time * 1000).toFixed(1)}ms` : 'Final'}
                  </span>
                </div>
              )}

              {/* PACKET STEP PILLS (Innovative, Dependent, Dropped) */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginBottom: '14px' }}>
                <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>Packet Timeline:</span>
                {decoderHistory.map((step, idx) => {
                  const isSelected = selectedStepIndex === idx;
                  const isInnovative = step.innovative;
                  return (
                    <button
                      key={`step-${idx}`}
                      onClick={() => { setSelectedStepIndex(idx); setSelectedDroppedPacket(null); }}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '5px',
                        fontSize: '0.72rem',
                        fontFamily: 'var(--font-mono)',
                        cursor: 'pointer',
                        border: isSelected
                          ? '2px solid #38bdf8'
                          : `1px solid ${isInnovative ? 'rgba(16, 185, 129, 0.4)' : 'rgba(245, 158, 11, 0.4)'}`,
                        background: isSelected
                          ? 'rgba(56, 189, 248, 0.25)'
                          : (isInnovative ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)'),
                        color: isInnovative ? '#34d399' : '#fbbf24',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <span>PKT #{step.seqId + 1}</span>
                      <span style={{
                        fontSize: '0.62rem',
                        padding: '1px 4px',
                        borderRadius: '3px',
                        background: isInnovative ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)',
                        color: isInnovative ? '#10b981' : '#f59e0b',
                      }}>
                        {isInnovative ? `Rank ${step.rankAfter}` : 'Dep'}
                      </span>
                    </button>
                  );
                })}

                {/* DROPPED PACKETS PILLS */}
                {droppedPackets.map((dp, dIdx) => {
                  const isSelected = selectedDroppedPacket?.seqId === dp.seqId;
                  return (
                    <button
                      key={`drop-${dIdx}`}
                      onClick={() => { setSelectedDroppedPacket(dp); setSelectedStepIndex(null); }}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '5px',
                        fontSize: '0.72rem',
                        fontFamily: 'var(--font-mono)',
                        cursor: 'pointer',
                        border: isSelected ? '2px solid #ef4444' : '1px solid rgba(239, 68, 68, 0.4)',
                        background: isSelected ? 'rgba(239, 68, 68, 0.3)' : 'rgba(239, 68, 68, 0.12)',
                        color: '#f87171',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <XCircle size={12} color="#ef4444" />
                      <span>PKT #{dp.seqId + 1} (DROPPED)</span>
                    </button>
                  );
                })}
              </div>

              {/* DYNAMIC EQUATION INSPECTION BOX */}
              {selectedDroppedPacket ? (
                <div style={{
                  padding: '12px 16px',
                  borderRadius: '6px',
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  fontSize: '0.8rem',
                  color: '#fca5a5',
                  lineHeight: '1.5',
                }}>
                  <div style={{ fontWeight: 800, color: '#ef4444', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <XCircle size={16} color="#ef4444" />
                    <span>Packet #{selectedDroppedPacket.seqId + 1} Dropped by Physical Impairment Channel</span>
                  </div>
                  <div>
                    This packet encountered the NS-3 Point-to-Point <code>RateErrorModel</code> error sink and was dropped at <strong>+{Number(selectedDroppedPacket.time || 0).toFixed(2)}ms</strong> (Reason: <em>{selectedDroppedPacket.reason}</em>).
                  </div>
                  <div style={{ marginTop: '4px', fontSize: '0.74rem', color: '#f87171' }}>
                    Because it was dropped in transit, it never reached Node 1's UDP receive socket. In accordance with physical network modeling, dropped packets are <strong>strictly excluded</strong> from the receiver's RLNC equation set and matrix.
                  </div>
                </div>
              ) : activeStep ? (
                <div style={{
                  padding: '12px 16px',
                  borderRadius: '6px',
                  background: 'rgba(56, 189, 248, 0.08)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  fontSize: '0.82rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 800, color: '#38bdf8' }}>
                      Active RLNC Linear Equation (PKT #{activeStep.seqId + 1}):
                    </span>
                    <span style={{
                      fontSize: '0.7rem',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontWeight: 700,
                      background: activeStep.innovative ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                      color: activeStep.innovative ? '#34d399' : '#fbbf24',
                    }}>
                      {activeStep.innovative
                        ? `INNOVATIVE: Matrix Rank Increased ${activeStep.rankBefore} → ${activeStep.rankAfter}`
                        : `DEPENDENT: Linearly Dependent (Rank unchanged at ${activeStep.rankAfter})`}
                    </span>
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.92rem',
                    fontWeight: 700,
                    color: '#fff',
                    background: 'rgba(15, 23, 42, 0.6)',
                    padding: '8px 12px',
                    borderRadius: '4px',
                    marginBottom: '6px',
                  }}>
                    y_{activeStep.seqId + 1} = {activeStep.equation || activeStep.coeffs.map((c, i) => `${c}·x_${i + 1}`).join(' ⊕ ')}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                    Coding Vector: <code style={{ color: '#e2e8f0' }}>[{activeStep.coeffs.join(', ')}]</code> | Addition is XOR (⊕) in GF(256) | Payload Preview: <code style={{ color: '#a855f7' }}>[{(activeStep.data_preview || activeStep.dataPreview || []).slice(0, 3).join(', ')}]</code>
                  </div>
                </div>
              ) : null}

              {/* REVERSE LINK ACK DROPS NOTICE */}
              {reverseDroppedAcks.length > 0 && (
                <div style={{
                  marginTop: '10px',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  background: 'rgba(245, 158, 11, 0.08)',
                  border: '1px solid rgba(245, 158, 11, 0.25)',
                  fontSize: '0.76rem',
                  color: '#fbbf24',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}>
                  <Info size={15} color="#fbbf24" style={{ flexShrink: 0 }} />
                  <div>
                    <strong>Reverse Link Notice:</strong> {reverseDroppedAcks.length} reverse ACK/feedback packet(s) were dropped on the return link (Node 1 → Node 0). Forward data equations arrived intact and were decoded at the receiver.
                  </div>
                </div>
              )}
            </div>

            {/* 4 CORE CARDS GRID */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))',
              gap: '16px',
              alignItems: 'start',
            }}>
              {/* CARD 1: 1. Received Coded Packets */}
              <div className="glass-panel" style={{ padding: '16px', background: '#0d1b2e', borderRadius: '10px', border: '1px solid #1e3a5f' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    background: '#2563eb',
                    color: '#fff',
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    1
                  </span>
                  <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#fff', margin: 0 }}>
                    Received Coded Packets
                  </h3>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                    Generation {selectedGen + 1} of {totalGenerations} (k = {K})
                  </div>
                  {totalGenerations > 1 && (
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {Array.from({ length: totalGenerations }).map((_, gIdx) => (
                        <button
                          key={gIdx}
                          onClick={() => setSelectedGen(gIdx)}
                          style={{
                            padding: '2px 8px',
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            borderRadius: '4px',
                            border: selectedGen === gIdx ? '1px solid #38bdf8' : '1px solid #334155',
                            background: selectedGen === gIdx ? 'rgba(56, 189, 248, 0.2)' : '#1e293b',
                            color: selectedGen === gIdx ? '#38bdf8' : '#94a3b8',
                            cursor: 'pointer',
                          }}
                        >
                          Gen {gIdx + 1}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {activeReceivedPackets.length === 0 ? (
                  <div style={{ padding: '24px 12px', textAlign: 'center', color: '#64748b', fontSize: '0.78rem', background: 'rgba(15, 23, 42, 0.4)', borderRadius: '6px' }}>
                    Waiting for coded packets to arrive over UDP socket...
                  </div>
                ) : (
                  <>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', marginBottom: '16px' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #1e3a5f', color: '#94a3b8', textAlign: 'left' }}>
                          <th style={{ padding: '6px 4px' }}>Packet ID</th>
                          <th style={{ padding: '6px 4px' }}>Coding Coefficients</th>
                          <th style={{ padding: '6px 4px' }}>Data (bytes)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeReceivedPackets.map((p, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid rgba(30, 58, 95, 0.4)' }}>
                            <td style={{ padding: '6px 4px', color: '#38bdf8', fontWeight: 700 }}>{p.id}</td>
                            <td style={{ padding: '6px 4px', color: '#fff', fontFamily: 'var(--font-mono)' }}>[{p.coeffs.join(', ')}]</td>
                            <td style={{ padding: '6px 4px', color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>
                              [{p.dataPreview.slice(0, 3).join(', ')}, ...]
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div style={{ borderTop: '1px solid #1e3a5f', paddingTop: '10px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', textAlign: 'center', marginBottom: '8px' }}>
                        <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '6px 4px', borderRadius: '4px', border: '1px solid #1e3a5f' }}>
                          <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Active Received</div>
                          <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>{activeReceivedPackets.length}</div>
                        </div>
                        <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '6px 4px', borderRadius: '4px', border: '1px solid #1e3a5f' }}>
                          <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Independent</div>
                          <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#10b981', fontFamily: 'var(--font-mono)' }}>{activeRank}</div>
                        </div>
                        <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '6px 4px', borderRadius: '4px', border: '1px solid #1e3a5f' }}>
                          <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Dependent</div>
                          <div style={{ fontSize: '0.95rem', fontWeight: 800, color: (activeReceivedPackets.length - activeRank) > 0 ? '#fbbf24' : '#64748b', fontFamily: 'var(--font-mono)' }}>
                            {Math.max(0, activeReceivedPackets.length - activeRank)}
                          </div>
                        </div>
                        <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '6px 4px', borderRadius: '4px', border: '1px solid #1e3a5f' }}>
                          <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Gen Size (K)</div>
                          <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#fff', fontFamily: 'var(--font-mono)' }}>{K}</div>
                        </div>
                      </div>
                      {activeRank >= K ? (
                        <div style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <CheckCircle2 size={14} color="#10b981" />
                          <span>Sufficient for decoding (Rank {activeRank} = K)</span>
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.75rem', color: '#fbbf24', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <AlertCircle size={14} color="#fbbf24" />
                          <span>Waiting for more independent packets (Rank {activeRank} &lt; {K})</span>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* CARD 2: 2. Coefficient Matrix (A) & Coded Data Matrix (C) */}
              <div className="glass-panel" style={{ padding: '16px', background: '#0d1b2e', borderRadius: '10px', border: '1px solid #1e3a5f' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    background: '#2563eb',
                    color: '#fff',
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    2
                  </span>
                  <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#fff', margin: 0 }}>
                    Coefficient Matrix (A)
                  </h3>
                </div>
                <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginBottom: '8px' }}>
                  Assembled dynamically from {activeMatrixA.length} received packets ({activeMatrixA.length} × {K})
                </div>

                {activeMatrixA.length === 0 ? (
                  <div style={{ padding: '24px 12px', textAlign: 'center', color: '#64748b', fontSize: '0.78rem', background: 'rgba(15, 23, 42, 0.4)', borderRadius: '6px' }}>
                    Coefficient matrix A will assemble as packets are received over UDP.
                  </div>
                ) : (
                  <>
                    <div style={{ textAlign: 'center', marginBottom: '10px' }}>
                      {renderBracketMatrix(activeMatrixA, '#38bdf8')}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', fontSize: '0.78rem' }}>
                      <span style={{ color: '#fff', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                        Rank = {activeRank} <span style={{ color: '#94a3b8', fontWeight: 400 }}>({activeRank} indep, {Math.max(0, activeReceivedPackets.length - activeRank)} dep, k = {K})</span>
                      </span>
                      {activeRank >= K ? (
                        <span style={{ color: '#10b981', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <CheckCircle2 size={14} color="#10b981" /> Full Rank
                        </span>
                      ) : (
                        <span style={{ color: '#fbbf24', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <AlertCircle size={14} color="#fbbf24" /> Incomplete Rank
                        </span>
                      )}
                    </div>

                    <div style={{ borderTop: '1px solid #1e3a5f', paddingTop: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                        <span style={{
                          width: '18px',
                          height: '18px',
                          borderRadius: '50%',
                          background: '#2563eb',
                          color: '#fff',
                          fontSize: '0.68rem',
                          fontWeight: 800,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                          2
                        </span>
                        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#fff' }}>
                          Coded Data Matrix (C) ({activeMatrixC.length} × {activeMatrixC[0]?.length || 3})
                        </div>
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginBottom: '6px' }}>
                        (Each row is a received packet payload preview)
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        {renderBracketMatrix(activeMatrixC, '#a855f7')}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* CARD 3: 3. Gaussian Elimination (GF(256)) */}
              <div className="glass-panel" style={{ padding: '16px', background: '#0d1b2e', borderRadius: '10px', border: '1px solid #1e3a5f' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    background: '#2563eb',
                    color: '#fff',
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    3
                  </span>
                  <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#fff', margin: 0 }}>
                    Gaussian Elimination (GF(256))
                  </h3>
                </div>
                <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginBottom: '8px' }}>
                  Row operations applied simultaneously to augmented matrix [A | C]
                </div>

                {activeMatrixA.length === 0 ? (
                  <div style={{ padding: '24px 12px', textAlign: 'center', color: '#64748b', fontSize: '0.78rem', background: 'rgba(15, 23, 42, 0.4)', borderRadius: '6px' }}>
                    Gauss-Jordan elimination operations will trace row-by-row once packets arrive.
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 600 }}>
                      Augmented Matrix [A | C] ({activeMatrixA.length} × {K + (activeMatrixC[0]?.length || 3)})
                    </div>
                    <div style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      borderLeft: '2.5px solid #38bdf8',
                      borderRight: '2.5px solid #38bdf8',
                      borderRadius: '4px',
                      padding: '3px 8px',
                      background: 'rgba(15, 23, 42, 0.6)',
                      marginBottom: '8px',
                      width: '100%',
                      justifyContent: 'center',
                    }}>
                      <table style={{ borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', textAlign: 'center' }}>
                        <tbody>
                          {activeMatrixA.map((row, rIdx) => (
                            <tr key={rIdx}>
                              {row.map((val, cIdx) => (
                                <td key={cIdx} style={{ padding: '2px 5px', color: '#38bdf8' }}>
                                  {displayFormat === 'hex' ? `0x${Number(val).toString(16).padStart(2, '0').toUpperCase()}` : val}
                                </td>
                              ))}
                              <td style={{ padding: '2px 4px', color: '#64748b' }}>|</td>
                              {(activeMatrixC[rIdx] || [0, 0, 0]).map((val, cIdx) => (
                                <td key={cIdx} style={{ padding: '2px 5px', color: '#e2e8f0' }}>
                                  {displayFormat === 'hex' ? `0x${Number(val).toString(16).padStart(2, '0').toUpperCase()}` : val}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 600 }}>
                      Decoder Operations Trace ({activeGaussSteps.length} operations)
                    </div>
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      marginBottom: '10px',
                      maxHeight: '180px',
                      overflowY: 'auto',
                      paddingRight: '4px',
                    }}>
                      {activeGaussSteps.map((st, idx) => (
                        <div key={idx} style={{
                          fontSize: '0.68rem',
                          color: '#e2e8f0',
                          fontFamily: 'var(--font-mono)',
                          background: 'rgba(15, 23, 42, 0.6)',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          borderLeft: st.op === 'swap' ? '2.5px solid #0284c7' :
                                      st.op === 'pivot_normalize' ? '2.5px solid #7c3aed' :
                                      st.op === 'forward_eliminate' ? '2.5px solid #d97706' :
                                      '2.5px solid #059669',
                        }}>
                          <span style={{
                            fontSize: '0.6rem',
                            fontWeight: 700,
                            padding: '1px 4px',
                            borderRadius: '3px',
                            background: st.op === 'swap' ? 'rgba(2, 132, 199, 0.3)' :
                                        st.op === 'pivot_normalize' ? 'rgba(124, 58, 237, 0.3)' :
                                        st.op === 'forward_eliminate' ? 'rgba(217, 119, 6, 0.3)' :
                                        'rgba(5, 150, 105, 0.3)',
                            color: st.op === 'swap' ? '#38bdf8' :
                                   st.op === 'pivot_normalize' ? '#c084fc' :
                                   st.op === 'forward_eliminate' ? '#fbbf24' :
                                   '#34d399',
                            textTransform: 'uppercase',
                            flexShrink: 0,
                          }}>
                            {st.op === 'pivot_normalize' ? 'NORM' :
                             st.op === 'forward_eliminate' ? 'FWD ELIM' :
                             st.op === 'back_substitute' ? 'BACK SUB' :
                             st.op.toUpperCase()}
                          </span>
                          <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {st.desc}
                          </span>
                        </div>
                      ))}
                    </div>


                  {/* Final Reduced Augmented Matrix [A_reduced | C_reduced] */}
                  <div style={{ borderTop: '1px solid #1e3a5f', paddingTop: '10px', marginBottom: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <div style={{ fontSize: '0.74rem', color: '#fff', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span>Final Reduced Augmented Matrix [A_reduced | C_reduced]</span>
                      </div>
                      {gaussJordan.isConsistent ? (
                        <span style={{ fontSize: '0.62rem', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', padding: '1px 6px', borderRadius: '3px', border: '1px solid rgba(16, 185, 129, 0.3)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '3px' }}>
                          <CheckCircle2 size={11} color="#10b981" /> Consistent System
                        </span>
                      ) : (
                        <span style={{ fontSize: '0.62rem', background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', padding: '1px 6px', borderRadius: '3px', border: '1px solid rgba(239, 68, 68, 0.3)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '3px' }}>
                          <AlertCircle size={11} color="#ef4444" /> Inconsistent Equation
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginBottom: '6px' }}>
                      Row operations applied to coefficient matrix A and full coded payload data
                    </div>

                    {!gaussJordan.isConsistent && (
                      <div style={{ padding: '6px 8px', marginBottom: '6px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '4px', fontSize: '0.68rem', color: '#ef4444' }}>
                        {gaussJordan.inconsistentMessage || 'Inconsistent equation detected: dependent row coefficients reduced to 0 but payload combination is non-zero.'}
                      </div>
                    )}

                    <div style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      borderLeft: '2.5px solid #10b981',
                      borderRight: '2.5px solid #10b981',
                      borderRadius: '4px',
                      padding: '3px 8px',
                      background: 'rgba(15, 23, 42, 0.6)',
                      width: '100%',
                      justifyContent: 'center',
                    }}>
                      <table style={{ borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', textAlign: 'center' }}>
                        <tbody>
                          {(gaussJordan.matrixA || []).map((row, rIdx) => {
                            const isZeroRow = row.every(v => v === 0);
                            return (
                              <tr key={rIdx} style={{ background: isZeroRow ? 'rgba(251, 191, 36, 0.05)' : 'transparent' }}>
                                {row.map((val, cIdx) => (
                                  <td key={cIdx} style={{ padding: '2px 5px', color: isZeroRow ? '#94a3b8' : (val === 1 && rIdx === cIdx ? '#10b981' : '#38bdf8'), fontWeight: val === 1 && rIdx === cIdx ? 700 : 400 }}>
                                    {val}
                                  </td>
                                ))}
                                <td style={{ padding: '2px 6px', color: '#64748b' }}>|</td>
                                {((gaussJordan.matrixC && gaussJordan.matrixC[rIdx]) || [0, 0, 0]).map((val, cIdx) => (
                                  <td key={cIdx} style={{ padding: '2px 5px', color: isZeroRow ? '#64748b' : '#34d399', fontWeight: isZeroRow ? 400 : 600 }}>
                                    {val}
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Verified Submatrix Inverse A_indep⁻¹ */}
                  {gaussJordan.inverseA && (() => {
                    const invRows = gaussJordan.inverseA.length;
                    const invCols = gaussJordan.inverseA[0]?.length || invRows;
                    const isCompleteInverse = Boolean(
                      gaussJordan.inverseVerified &&
                      gaussJordan.isConsistent &&
                      invRows === K &&
                      invCols === K
                    );
                    return (
                      <div style={{ borderTop: '1px solid #1e3a5f', paddingTop: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                          <div style={{ fontSize: '0.72rem', color: isCompleteInverse ? '#10b981' : '#fbbf24', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                            {isCompleteInverse ? <CheckCircle2 size={13} color="#10b981" /> : <AlertCircle size={13} color="#fbbf24" />}
                            <span>{isCompleteInverse ? 'Verified Submatrix Inverse' : 'Submatrix Inverse'} A_indep⁻¹ ({invRows} × {invCols})</span>
                          </div>
                          {isCompleteInverse && (
                            <span style={{ fontSize: '0.62rem', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', padding: '1px 6px', borderRadius: '3px', border: '1px solid rgba(16, 185, 129, 0.3)', fontWeight: 700 }}>
                              A_indep · A_indep⁻¹ = I
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginBottom: '6px' }}>
                          {isCompleteInverse ? 'Complete verified inverse over GF(256) passing A_indep ⊗ A_indep⁻¹ = I' : 'Pending full independent rank verification in GF(256)'}
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          {renderBracketMatrix(gaussJordan.inverseA, isCompleteInverse ? '#10b981' : '#fbbf24')}
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>

            {/* CARD 4: 4. Decode Source Packets */}
            <div className="glass-panel" style={{ padding: '16px', background: '#0d1b2e', borderRadius: '10px', border: '1px solid #1e3a5f' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  background: '#2563eb',
                  color: '#fff',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  4
                </span>
                <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#fff', margin: 0 }}>
                  Decode Source Packets
                </h3>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontFamily: 'var(--font-mono)', marginBottom: '12px' }}>
                Recovered via Gauss-Jordan elimination [I_{K} | P] over GF(256)
              </div>

              {decodedPackets.length === 0 || !isFullRank ? (
                <div style={{ padding: '24px 12px', textAlign: 'center', color: '#fbbf24', fontSize: '0.78rem', background: 'rgba(251, 191, 36, 0.08)', borderRadius: '6px', border: '1px solid rgba(251, 191, 36, 0.2)' }}>
                  <AlertCircle size={20} color="#fbbf24" style={{ margin: '0 auto 8px', display: 'block' }} />
                  {gaussJordan && !gaussJordan.isConsistent
                    ? 'Inconsistent Equation System: Dependent equations did not reduce to zero. Cannot decode.'
                    : `Incomplete Rank (${rank} < ${K}): Cannot decode source blocks until ${K - rank} more independent equations are received.`}
                </div>
              ) : (
                <>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', marginBottom: '16px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #1e3a5f', color: '#94a3b8', textAlign: 'left' }}>
                        <th style={{ padding: '6px 4px' }}>Source Block</th>
                        {decodedPackets.map((p, idx) => (
                          <th key={idx} style={{ padding: '6px 4px', textAlign: 'center', color: '#38bdf8' }}>{p.id}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{ padding: '8px 4px', color: '#94a3b8' }}>Decoded Bytes</td>
                        {decodedPackets.map((p, idx) => (
                          <td key={idx} style={{ padding: '8px 4px', textAlign: 'center', fontFamily: 'var(--font-mono)', color: '#fff', fontSize: '0.72rem' }}>
                            [{p.bytes.slice(0, 3).join(', ')}, ...]
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>

                  <div style={{ marginTop: '20px', display: 'flex', alignItems: 'center', gap: '6px', color: '#10b981', fontWeight: 700, fontSize: '0.82rem' }}>
                    <CheckCircle2 size={16} color="#10b981" />
                    <span>Decoding Successful: Full rank achieved ({rank} / {K})</span>
                  </div>
                </>
              )}
            </div>

            {/* CARD 5: 5. Reconstruct File */}
            <div className="glass-panel" style={{ padding: '16px', background: '#0d1b2e', borderRadius: '10px', border: '1px solid #1e3a5f' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  background: '#2563eb',
                  color: '#fff',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  5
                </span>
                <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#fff', margin: 0 }}>
                  Reconstruct File
                </h3>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '16px' }}>
                Combine all decoded packets in order
              </div>

              <div style={{ height: '8px', background: '#1e293b', borderRadius: '4px', overflow: 'hidden', marginBottom: '14px' }}>
                <div style={{
                  width: verification?.verified ? '100%' : (transfer?.status === 'running' ? '60%' : '0%'),
                  height: '100%',
                  background: '#10b981',
                  transition: 'width 0.3s ease',
                }} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: '0.8rem', fontWeight: 700, color: '#10b981', fontFamily: 'var(--font-mono)', marginBottom: '16px' }}>
                {verification?.verified ? '100%' : (transfer?.status === 'running' ? 'In Progress' : '0%')}
              </div>

              {verification?.verified ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#10b981', fontWeight: 700, fontSize: '0.82rem' }}>
                  <CheckCircle2 size={16} color="#10b981" />
                  <span>File reconstructed successfully</span>
                </div>
              ) : (
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  Reconstruction waiting for decoding completion.
                </div>
              )}
            </div>

            {/* CARD 6: 6. SHA-256 Verification */}
            <div className="glass-panel" style={{ padding: '16px', background: '#0d1b2e', borderRadius: '10px', border: '1px solid #1e3a5f' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  background: '#2563eb',
                  color: '#fff',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  6
                </span>
                <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#fff', margin: 0 }}>
                  SHA-256 Verification
                </h3>
              </div>

              <div style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div>
                  <span style={{ color: '#94a3b8' }}>Original File Hash : </span>
                  <span style={{ color: '#fff' }}>
                    {origHash ? (origHash.length > 20 ? `${origHash.slice(0, 10)}...${origHash.slice(-6)}` : origHash) : 'Waiting for upload'}
                  </span>
                </div>
                <div>
                  <span style={{ color: '#94a3b8' }}>Received File Hash : </span>
                  <span style={{ color: '#fff' }}>
                    {reconHash ? (reconHash.length > 20 ? `${reconHash.slice(0, 10)}...${reconHash.slice(-6)}` : reconHash) : 'Pending reconstruction'}
                  </span>
                </div>
              </div>

              <div style={{ marginTop: '24px' }}>
                {hashesMatch ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#10b981', fontWeight: 700, fontSize: '0.82rem' }}>
                    <CheckCircle2 size={16} color="#10b981" />
                    <span>Hashes match! File is identical.</span>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    Cryptographic integrity will be verified upon reconstruction.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        )}
      </main>
    </div>
  );
}
