import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTransfer } from '../context/TransferContext';
import { CheckCircle2, ShieldCheck, AlertCircle } from 'lucide-react';

export default function EquationLabScreen() {
  const navigate = useNavigate();
  const { transfer, verification } = useTransfer();

  const [calcData, setCalcData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (transfer?.id) {
      setLoading(true);
      fetch(`/api/calculations/transfer/${transfer.id}`)
        .then((res) => res.json())
        .then((data) => setCalcData(data))
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [transfer?.id]);

  // Derived values strictly from the real engine / transfer data
  const hasTransfer = Boolean(transfer);
  const K = calcData?.requiredRank || transfer?.K || 4;
  const receivedPackets = calcData?.receivedPackets || [];
  const matrixA = calcData?.matrixA || [];
  const matrixC = calcData?.matrixC || [];
  const rank = calcData?.rank !== undefined ? calcData.rank : 0;
  const isFullRank = Boolean(calcData?.isFullRank);
  const gaussJordan = calcData?.gaussJordan || null;
  const decodedPackets = calcData?.decodedPackets || [];

  const origHash = verification?.origSha || transfer?.fileSha256 || '';
  const reconHash = verification?.reconSha || '';
  const hashesMatch = Boolean(verification?.verified && origHash && reconHash && origHash === reconHash);

  // Helper to format mathematical bracket matrix
  const renderBracketMatrix = (mat, borderCol = '#38bdf8') => {
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
      }}>
        <table style={{ borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', textAlign: 'center' }}>
          <tbody>
            {mat.map((row, rIdx) => (
              <tr key={rIdx}>
                {row.map((val, cIdx) => (
                  <td key={cIdx} style={{ padding: '3px 8px', color: '#e2e8f0' }}>
                    {val}
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
        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff', letterSpacing: '0.3px', margin: 0 }}>
            Matrix Decoding Method
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

        {/* Right Toggle Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => navigate('/')}
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
            Equation Lab
          </button>
        </div>
      </header>

      {/* 2. MAIN 6-STEP HORIZONTAL/GRID WORKSPACE */}
      <main style={{
        flex: 1,
        padding: '20px 24px',
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
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '12px' }}>
            Generation 1 (k = {K})
          </div>

          {receivedPackets.length === 0 ? (
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
                  {receivedPackets.slice(0, 6).map((p, idx) => (
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
                <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Received Packets</div>
                <div style={{ fontSize: '1rem', fontWeight: 800, color: '#fff', fontFamily: 'var(--font-mono)', margin: '2px 0 6px' }}>
                  {receivedPackets.length} / {K}
                </div>
                {receivedPackets.length >= K ? (
                  <div style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <CheckCircle2 size={14} color="#10b981" />
                    <span>Sufficient for decoding</span>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.75rem', color: '#fbbf24', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <AlertCircle size={14} color="#fbbf24" />
                    <span>Waiting for more independent packets ({receivedPackets.length} &lt; {K})</span>
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
            Built from received coding coefficients
          </div>

          {matrixA.length === 0 ? (
            <div style={{ padding: '24px 12px', textAlign: 'center', color: '#64748b', fontSize: '0.78rem', background: 'rgba(15, 23, 42, 0.4)', borderRadius: '6px' }}>
              Coefficient matrix A will assemble as packets are received over UDP.
            </div>
          ) : (
            <>
              <div style={{ textAlign: 'center', marginBottom: '10px' }}>
                {renderBracketMatrix(matrixA, '#38bdf8')}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', fontSize: '0.78rem' }}>
                <span style={{ color: '#fff', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                  Rank = {rank} <span style={{ color: '#94a3b8', fontWeight: 400 }}>(k = {K})</span>
                </span>
                {isFullRank ? (
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
                    Coded Data Matrix (C)
                  </div>
                </div>
                <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginBottom: '6px' }}>
                  (Each row is a packet payload preview)
                </div>
                <div style={{ textAlign: 'center' }}>
                  {renderBracketMatrix(matrixC, '#a855f7')}
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
            Transform A to identity matrix and apply to C
          </div>

          {!gaussJordan || matrixA.length === 0 ? (
            <div style={{ padding: '24px 12px', textAlign: 'center', color: '#64748b', fontSize: '0.78rem', background: 'rgba(15, 23, 42, 0.4)', borderRadius: '6px' }}>
              Gauss-Jordan elimination operations will trace row-by-row once packets arrive.
            </div>
          ) : (
            <>
              {/* Initial Augmented Matrix [A | C] */}
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
                    {matrixA.map((row, rIdx) => (
                      <tr key={rIdx}>
                        {row.map((val, cIdx) => (
                          <td key={cIdx} style={{ padding: '2px 5px', color: '#38bdf8' }}>{val}</td>
                        ))}
                        <td style={{ padding: '2px 4px', color: '#64748b' }}>|</td>
                        {(matrixC[rIdx] || [0, 0, 0]).map((val, cIdx) => (
                          <td key={cIdx} style={{ padding: '2px 5px', color: '#e2e8f0' }}>{val}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Recorded Elimination Steps */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
                {gaussJordan.steps.slice(0, 3).map((st, idx) => (
                  <div key={idx} style={{
                    fontSize: '0.7rem',
                    color: '#38bdf8',
                    fontWeight: 600,
                    fontFamily: 'var(--font-mono)',
                    background: 'rgba(15, 23, 42, 0.6)',
                    padding: '4px 8px',
                    borderRadius: '4px',
                  }}>
                    {st.desc}
                  </div>
                ))}
              </div>

              {/* Inverse Matrix A^-1 */}
              <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '6px' }}>Inverse Matrix A⁻¹</div>
              <div style={{ textAlign: 'center' }}>
                {renderBracketMatrix(gaussJordan.inverseA, '#10b981')}
              </div>
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
            X = A⁻¹ × C (in GF(256))
          </div>

          {decodedPackets.length === 0 ? (
            <div style={{ padding: '24px 12px', textAlign: 'center', color: '#64748b', fontSize: '0.78rem', background: 'rgba(15, 23, 42, 0.4)', borderRadius: '6px' }}>
              Source packets will decode once the receiver achieves full rank.
            </div>
          ) : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', marginBottom: '16px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #1e3a5f', color: '#94a3b8', textAlign: 'left' }}>
                    <th style={{ padding: '6px 4px' }}>Packet</th>
                    {decodedPackets.map((p, idx) => (
                      <th key={idx} style={{ padding: '6px 4px', textAlign: 'center', color: '#38bdf8' }}>{p.id}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: '8px 4px', color: '#94a3b8' }}>Data (bytes)</td>
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
                <span>Decoding Successful</span>
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

          {/* Green Progress Bar */}
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
      </main>
    </div>
  );
}
