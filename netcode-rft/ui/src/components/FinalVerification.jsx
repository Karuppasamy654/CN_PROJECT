import React, { useMemo } from 'react';
import { ShieldCheck, Download, AlertTriangle, Clock, RefreshCw, Loader2, XCircle } from 'lucide-react';

export default function FinalVerification({ verification, transfer, events, playbackIndex }) {
  // Derive verification state from current playback timeline position and backend confirmation
  const { currentState, statusMessage, details } = useMemo(() => {
    if (!transfer) {
      return {
        currentState: 'NOT_STARTED',
        statusMessage: 'Waiting to start transfer',
        details: 'Select a file and click "Start Simulation"',
      };
    }

    if (transfer.status === 'cancelled') {
      return {
        currentState: 'CANCELLED',
        statusMessage: 'Transfer Cancelled',
        details: 'The transfer was cancelled by user request',
      };
    }

    const visibleEvents = (events || []).slice(0, (playbackIndex ?? 0) + 1);

    if (visibleEvents.length === 0) {
      return {
        currentState: 'NOT_STARTED',
        statusMessage: 'Waiting to start transfer',
        details: 'Initializing networking sockets and buffers...',
      };
    }

    // Check for verification result event in the visible timeline
    const verifEvent = visibleEvents.find(e => e.type === 'verification_result');
    const hasReconProgress = visibleEvents.some(e => e.type === 'reconstruction_progress');
    const lastRecon = [...visibleEvents].reverse().find(e => e.type === 'reconstruction_progress');
    const isReconComplete = lastRecon && lastRecon.pct >= 100;

    // Has transfer reached verification stage?
    if (verifEvent) {
      const isBackendSuccess = verification?.state === 'SUCCESS' || (verification?.verified && verifEvent.passed);
      if (verifEvent.passed && isBackendSuccess) {
        return {
          currentState: 'SUCCESS',
          statusMessage: 'File reconstructed and verified successfully',
          details: `SHA-256 Match: ${verifEvent.orig_sha.slice(0, 8)}... (${verifEvent.orig_sz} bytes)`,
        };
      } else {
        const failureReason = verification?.message || (verifEvent.orig_sha !== verifEvent.recon_sha
          ? 'SHA-256 hash mismatch between original and reconstructed files'
          : 'Reconstructed file size mismatch or missing packets');
        return {
          currentState: 'FAILED',
          statusMessage: 'Transfer failed — reconstructed file does not match the original',
          details: failureReason,
        };
      }
    }

    // If reconstruction has reached 100% but verification event not yet processed in timeline
    if (isReconComplete) {
      return {
        currentState: 'VERIFYING',
        statusMessage: 'Verifying reconstructed file...',
        details: 'Computing SHA-256 cryptographic hash of reconstructed output...',
      };
    }

    // If decoding or recovery operations are occurring
    const hasDecoderActivity = visibleEvents.some(e => e.type === 'decoder_step' || e.type === 'decoder_matrix_update');
    if (hasDecoderActivity || hasReconProgress) {
      const rankEvent = [...visibleEvents].reverse().find(e => e.type === 'decoder_matrix_update');
      const rankInfo = rankEvent ? `Matrix Rank: ${rankEvent.rank}/${rankEvent.required_rank}` : '';
      const blockInfo = lastRecon ? `Blocks: ${lastRecon.recovered_blocks}/${lastRecon.total_blocks}` : '';
      return {
        currentState: 'RECONSTRUCTING',
        statusMessage: 'Recovering missing information & reconstructing file',
        details: [rankInfo, blockInfo].filter(Boolean).join(' | ') || 'Performing Gauss-Jordan elimination over GF(256)',
      };
    }

    // Otherwise, packet transmission is underway
    return {
      currentState: 'TRANSFERRING',
      statusMessage: 'Transfer in progress',
      details: `Streaming datagrams over UDP socket (${transfer.protocol.toUpperCase()})`,
    };
  }, [verification, transfer, events, playbackIndex]);

  const isVerified = currentState === 'SUCCESS';
  const isFailed = currentState === 'FAILED';
  const isReconstructing = currentState === 'RECONSTRUCTING';
  const isVerifying = currentState === 'VERIFYING';
  const isTransferring = currentState === 'TRANSFERRING';

  const handleDownload = () => {
    if (!isVerified || !transfer?.id) return;
    window.location.href = `/api/transfers/${transfer.id}/download`;
  };

  return (
    <div className="glass-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '8px 12px', alignItems: 'center', justifyContent: 'space-between', textAlign: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', justifyContent: 'flex-start' }}>
        <ShieldCheck size={15} color={isVerified ? 'var(--green-success)' : isFailed ? 'var(--red-loss)' : 'var(--cyan-primary)'} />
        <span style={{ fontSize: '0.8rem', fontWeight: 700, fontFamily: 'var(--font-heading)' }}>
          Final Verification
        </span>
      </div>

      {/* Dynamic State Icon and Badge */}
      {isVerified ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '50%',
            background: 'rgba(16, 185, 129, 0.2)',
            border: '2px solid var(--green-success)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 16px rgba(16, 185, 129, 0.6)',
          }}>
            <ShieldCheck size={26} color="var(--green-success)" />
          </div>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#34d399', letterSpacing: '0.3px' }}>
            {statusMessage}
          </span>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {details}
          </span>
        </div>
      ) : isFailed ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', maxWidth: '100%' }}>
          <div style={{
            width: '38px',
            height: '38px',
            borderRadius: '50%',
            background: 'rgba(239, 68, 68, 0.2)',
            border: '2px solid var(--red-loss)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 14px rgba(239, 68, 68, 0.6)',
          }}>
            <XCircle size={22} color="var(--red-loss)" />
          </div>
          <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#f87171' }}>
            {statusMessage}
          </span>
          <span style={{ fontSize: '0.65rem', color: 'rgba(248, 113, 113, 0.85)', fontFamily: 'var(--font-mono)', wordBreak: 'break-word', maxHeight: '32px', overflow: 'hidden' }}>
            {details}
          </span>
        </div>
      ) : isVerifying ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
          <Loader2 size={30} color="var(--cyan-primary)" className="animate-spin" />
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--cyan-primary)' }}>
            {statusMessage}
          </span>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {details}
          </span>
        </div>
      ) : isReconstructing ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
          <RefreshCw size={28} color="var(--blue-primary)" className="animate-spin" style={{ animationDuration: '3s' }} />
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#38bdf8' }}>
            {statusMessage}
          </span>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {details}
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
          <Clock size={28} color="var(--text-muted)" />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {statusMessage}
          </span>
          <span style={{ fontSize: '0.65rem', color: 'rgba(148, 163, 184, 0.6)', fontFamily: 'var(--font-mono)' }}>
            {details}
          </span>
        </div>
      )}

      {/* Reconstructed File Download Button */}
      <button
        onClick={handleDownload}
        disabled={!isVerified}
        className={isVerified ? 'cyber-btn' : 'cyber-btn cyber-btn-secondary'}
        style={{
          width: '100%',
          justifyContent: 'center',
          padding: '6px 10px',
          fontSize: '0.75rem',
          opacity: isVerified ? 1 : 0.45,
          cursor: isVerified ? 'pointer' : 'not-allowed',
        }}
      >
        <Download size={14} />
        <span>{isVerified ? 'Download Verified File' : 'Download File (Verification Required)'}</span>
      </button>
    </div>
  );
}
