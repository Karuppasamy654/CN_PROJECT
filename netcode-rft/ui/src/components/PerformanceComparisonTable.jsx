import React from 'react';
import { CheckCircle2 } from 'lucide-react';

export default function PerformanceComparisonTable({ currentMetrics, protocol, verification }) {
  // If we have live metrics from the current transfer, display them for the active protocol,
  // while keeping standard reference/measured baseline for fair comparison!
  const isRlnc = protocol === 'rlnc';
  const isCompleted = verification?.state === 'SUCCESS' && verification?.verified === true;
  const isFailed = verification?.state === 'FAILED';
  const isCancelled = verification?.state === 'CANCELLED';

  const rlncTime = isRlnc && currentMetrics?.duration_s ? Number(currentMetrics.duration_s).toFixed(2) : (isRlnc && isCompleted ? '—' : '4.32 (ref)');
  const rlncThroughput = isRlnc && currentMetrics?.throughput_kbps ? Number(currentMetrics.throughput_kbps).toFixed(2) : (isRlnc && currentMetrics?.throughput_mbps ? (Number(currentMetrics.throughput_mbps) * 125).toFixed(2) : (isRlnc && isCompleted ? '—' : '59.26 (ref)'));
  const rlncRetrans = isRlnc ? (currentMetrics?.retransmissions ?? 0) : 0;
  const rlncExtra = isRlnc && currentMetrics?.coded_packets ? ((currentMetrics.coded_packets * (currentMetrics.block_size || 1024)) / 1024).toFixed(1) : (isRlnc && isCompleted ? '0.0' : '12.5 (ref)');
  const rlncDecodeTime = isRlnc && currentMetrics?.decoding_time_s ? Number(currentMetrics.decoding_time_s).toFixed(2) : (isRlnc && isCompleted ? '< 0.01' : '0.58 (ref)');

  const rudpTime = !isRlnc && currentMetrics?.duration_s ? Number(currentMetrics.duration_s).toFixed(2) : (!isRlnc && isCompleted ? '—' : '7.84 (ref)');
  const rudpThroughput = !isRlnc && currentMetrics?.throughput_kbps ? Number(currentMetrics.throughput_kbps).toFixed(2) : (!isRlnc && currentMetrics?.throughput_mbps ? (Number(currentMetrics.throughput_mbps) * 125).toFixed(2) : (!isRlnc && isCompleted ? '—' : '32.68 (ref)'));
  const rudpRetrans = !isRlnc && currentMetrics?.retransmissions !== undefined ? currentMetrics.retransmissions : (!isRlnc && isCompleted ? 0 : 5);
  const rudpExtra = !isRlnc && currentMetrics?.retransmissions !== undefined ? ((currentMetrics.retransmissions * (currentMetrics.block_size || 1024)) / 1024).toFixed(1) : (!isRlnc && isCompleted ? '0.0' : '45.2 (ref)');

  const renderStatus = (methodMatches) => {
    if (!methodMatches) {
      return <span style={{ color: '#64748b', fontSize: '0.75rem' }}>Benchmark Ref</span>;
    }
    if (isCompleted) {
      return (
        <span style={{ color: '#10b981', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <CheckCircle2 size={15} color="#10b981" /> Verified
        </span>
      );
    }
    if (isFailed) {
      return <span style={{ color: '#ef4444', fontWeight: 700 }}>✕ Failed</span>;
    }
    if (isCancelled) {
      return <span style={{ color: '#f59e0b', fontWeight: 700 }}>Cancelled</span>;
    }
    return <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Pending</span>;
  };

  return (
    <div className="glass-panel" style={{ padding: '16px', background: '#0d1b2e', borderRadius: '10px', border: '1px solid #1e3a5f' }}>
      <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff', marginBottom: '12px', fontFamily: 'var(--font-heading)' }}>
        Performance Comparison
      </h3>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e3a5f', color: '#94a3b8' }}>
              <th style={{ padding: '8px 12px', fontWeight: 600 }}>Method</th>
              <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'center' }}>File Recovery</th>
              <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'center' }}>Transfer Time (s)</th>
              <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'center' }}>Throughput (KB/s)</th>
              <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'center' }}>Retransmissions</th>
              <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'center' }}>Additional Data (KB)</th>
              <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'center' }}>Decoding Time (s)</th>
            </tr>
          </thead>
          <tbody>
            {/* Row 1: Network Coding (RLNC) */}
            <tr style={{
              borderBottom: '1px solid rgba(30, 58, 95, 0.5)',
              background: isRlnc ? 'rgba(37, 99, 235, 0.08)' : 'transparent',
            }}>
              <td style={{ padding: '10px 12px', color: '#fff', fontWeight: 700 }}>
                Network Coding (RLNC)
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                {renderStatus(isRlnc)}
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'center', color: '#e2e8f0', fontFamily: 'var(--font-mono)' }}>
                {rlncTime}
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'center', color: '#38bdf8', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                {rlncThroughput}
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'center', color: '#e2e8f0', fontFamily: 'var(--font-mono)' }}>
                {rlncRetrans}
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'center', color: '#e2e8f0', fontFamily: 'var(--font-mono)' }}>
                {rlncExtra}
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'center', color: '#a855f7', fontFamily: 'var(--font-mono)' }}>
                {rlncDecodeTime}
              </td>
            </tr>

            {/* Row 2: Reliable UDP (ACK + Retransmission) */}
            <tr style={{
              background: !isRlnc ? 'rgba(37, 99, 235, 0.08)' : 'transparent',
            }}>
              <td style={{ padding: '10px 12px', color: '#fff', fontWeight: 700 }}>
                Reliable UDP (ACK + Retransmission)
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                {renderStatus(!isRlnc)}
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'center', color: '#e2e8f0', fontFamily: 'var(--font-mono)' }}>
                {rudpTime}
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'center', color: '#38bdf8', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                {rudpThroughput}
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'center', color: '#f87171', fontFamily: 'var(--font-mono)' }}>
                {rudpRetrans}
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'center', color: '#e2e8f0', fontFamily: 'var(--font-mono)' }}>
                {rudpExtra}
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'center', color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>
                -
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
