import React, { createContext, useContext, useState, useEffect, useRef, useMemo } from 'react';
import { io } from 'socket.io-client';

const TransferContext = createContext(null);

export const TRANSFER_LIFECYCLE = {
  IDLE: 'IDLE',
  INITIALIZING: 'INITIALIZING',
  TRANSFERRING: 'TRANSFERRING',
  DECODING: 'DECODING',
  RECONSTRUCTING: 'RECONSTRUCTING',
  VERIFYING: 'VERIFYING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
};

export const STAGES = [
  { id: 1, name: 'Upload', label: 'Upload' },
  { id: 2, name: 'Analyze', label: 'Analyze' },
  { id: 3, name: 'Split', label: 'Split' },
  { id: 4, name: 'Encode', label: 'Encode' },
  { id: 5, name: 'Network', label: 'Network' },
  { id: 6, name: 'Transmit', label: 'Transmit' },
  { id: 7, name: 'Recover', label: 'Recover' },
  { id: 8, name: 'Reconstruct', label: 'Reconstruct' },
  { id: 9, name: 'Verify', label: 'Verify' },
  { id: 10, name: 'Results', label: 'Results' },
];

export function TransferProvider({ children }) {
  // Transfer configuration set when transfer is launched
  const [transfer, setTransfer] = useState(null);

  // Transfer lifecycle state machine
  const [transferLifecycle, setTransferLifecycle] = useState(TRANSFER_LIFECYCLE.IDLE);

  // Backend real event stream
  const [events, setEvents] = useState([]);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [pauseAtStage, setPauseAtStage] = useState(false);
  const [currentStage, setCurrentStage] = useState(1);

  // Performance metrics and verification results from engine
  const [metrics, setMetrics] = useState(null);
  const [verification, setVerification] = useState(null);
  const [backendReady, setBackendReady] = useState(false);

  // Handshake sub-step tracking
  const [latestHandshakeStep, setLatestHandshakeStep] = useState(0);

  // Live stopwatch timer while transfer is active
  const [elapsedTime, setElapsedTime] = useState(0);
  const transferStartTimeRef = useRef(null);

  const socketRef = useRef(null);
  const playbackTimerRef = useRef(null);
  const activeTransferIdRef = useRef(null);
  const seenEventKeysRef = useRef(new Set());

  // Active transfer timer loop
  useEffect(() => {
    let timer = null;
    const isRunning = (
      transferLifecycle === TRANSFER_LIFECYCLE.INITIALIZING ||
      transferLifecycle === TRANSFER_LIFECYCLE.TRANSFERRING ||
      transferLifecycle === TRANSFER_LIFECYCLE.DECODING ||
      transferLifecycle === TRANSFER_LIFECYCLE.RECONSTRUCTING ||
      transferLifecycle === TRANSFER_LIFECYCLE.VERIFYING
    );

    if (isRunning) {
      if (!transferStartTimeRef.current) {
        transferStartTimeRef.current = Date.now();
      }
      timer = setInterval(() => {
        if (transferStartTimeRef.current) {
          setElapsedTime((Date.now() - transferStartTimeRef.current) / 1000);
        }
      }, 50);
    } else {
      if (transferLifecycle === TRANSFER_LIFECYCLE.IDLE) {
        transferStartTimeRef.current = null;
        setElapsedTime(0);
      }
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [transferLifecycle]);

  // Check health and setup persistent socket
  useEffect(() => {
    fetch('/api/health')
      .then(res => res.json())
      .then(data => {
        if (data.status === 'ok') setBackendReady(true);
      })
      .catch(() => setBackendReady(false));

    const socketUrl = (typeof window !== 'undefined' && window.location.port === '3000')
      ? 'http://localhost:5000'
      : '/';

    const socket = io(socketUrl, {
      transports: ['polling', 'websocket'],
      reconnectionAttempts: 10,
    });
    socketRef.current = socket;

    const isMatchingTransfer = (id1, id2) => {
      if (!id1 || !id2) return true;
      const s1 = String(id1);
      const s2 = String(id2);
      if (s1 === s2) return true;
      if (s1.includes(s2) || s2.includes(s1)) return true;
      const d1 = s1.replace(/\D/g, '');
      const d2 = s2.replace(/\D/g, '');
      return d1.length > 0 && d2.length > 0 && (d1 === d2 || d1.includes(d2) || d2.includes(d1));
    };

    socket.on('initial_events', (evList) => {
      if (Array.isArray(evList) && evList.length > 0) {
        setEvents((prev) => {
          if (prev.length >= evList.length) return prev;
          for (const ev of evList) {
            const key = ev.event_id || `${ev.type}-${ev.seq_id ?? ''}-${ev.gen_id ?? ''}-${ev.step ?? ''}-${ev.time ?? ''}`;
            seenEventKeysRef.current.add(key);
          }
          return evList;
        });
      }
    });

    socket.on('transfer_event', (event) => {
      // Ignore events for stale or different transfers
      const currentActiveId = activeTransferIdRef.current;
      if (currentActiveId && event.transfer_id && !isMatchingTransfer(event.transfer_id, currentActiveId)) {
        return;
      }

      // Deduplicate events to prevent double counting
      const key = event.event_id || `${event.type}-${event.seq_id ?? ''}-${event.gen_id ?? ''}-${event.step ?? ''}-${event.time ?? ''}`;
      if (seenEventKeysRef.current.has(key)) {
        return;
      }
      seenEventKeysRef.current.add(key);

      setEvents((prev) => [...prev, event]);

      // State machine lifecycle transitions driven strictly by authentic engine events
      if (event.type === 'handshake_step') {
        setLatestHandshakeStep(event.step);
        if (event.step === 4 || event.step_name === 'INITIALIZATION_COMPLETE') {
          setTransferLifecycle((current) =>
            (current === TRANSFER_LIFECYCLE.IDLE || current === TRANSFER_LIFECYCLE.INITIALIZING)
              ? TRANSFER_LIFECYCLE.TRANSFERRING
              : current
          );
        } else {
          setTransferLifecycle((current) =>
            (current === TRANSFER_LIFECYCLE.IDLE || current === TRANSFER_LIFECYCLE.INITIALIZING)
              ? TRANSFER_LIFECYCLE.INITIALIZING
              : current
          );
        }
      } else if (event.type === 'packet_received' || event.type === 'packet_transmitted' || event.type === 'packet_sent') {
        setTransferLifecycle((current) => {
          if (current === TRANSFER_LIFECYCLE.IDLE || current === TRANSFER_LIFECYCLE.INITIALIZING) {
            return TRANSFER_LIFECYCLE.TRANSFERRING;
          }
          return current;
        });
      } else if (event.type === 'decoder_step' || (event.type === 'decoder_matrix_update' && event.rank > 0)) {
        setTransferLifecycle((current) => {
          if (current === TRANSFER_LIFECYCLE.TRANSFERRING) {
            return TRANSFER_LIFECYCLE.DECODING;
          }
          return current;
        });
      } else if (event.type === 'reconstruction_progress') {
        if (event.pct >= 100) {
          setTransferLifecycle(TRANSFER_LIFECYCLE.VERIFYING);
        } else if (event.pct > 0) {
          setTransferLifecycle((current) => {
            if (current === TRANSFER_LIFECYCLE.TRANSFERRING || current === TRANSFER_LIFECYCLE.DECODING) {
              return TRANSFER_LIFECYCLE.RECONSTRUCTING;
            }
            return current;
          });
        }
      } else if (event.type === 'verification_result') {
        if (!event.passed) {
          setTransferLifecycle(TRANSFER_LIFECYCLE.FAILED);
        } else {
          setTransferLifecycle(TRANSFER_LIFECYCLE.VERIFYING);
        }
      }
    });

    socket.on('metrics', (m) => {
      const currentActiveId = activeTransferIdRef.current;
      if (currentActiveId && m.transfer_id && !isMatchingTransfer(m.transfer_id, currentActiveId)) {
        return;
      }
      setMetrics(m);
    });

    socket.on('status', (s) => {
      const currentActiveId = activeTransferIdRef.current;
      if (currentActiveId && s.transferId && !isMatchingTransfer(s.transferId, currentActiveId)) {
        return;
      }
      setTransfer((prev) => prev ? { ...prev, status: s.status } : null);

      if (s.status === 'failed') {
        setTransferLifecycle(TRANSFER_LIFECYCLE.FAILED);
      } else if (s.status === 'cancelled') {
        setTransferLifecycle(TRANSFER_LIFECYCLE.CANCELLED);
      } else if (s.status === 'completed') {
        setTransferLifecycle(TRANSFER_LIFECYCLE.VERIFYING);
        const currentTransferId = s.transferId || activeTransferIdRef.current;
        if (currentTransferId) {
          // Sync all events and metrics directly from API in case WebSocket missed any
          fetch(`/api/transfers/${currentTransferId}/events`)
            .then(res => res.json())
            .then(evData => {
              const evList = Array.isArray(evData) ? evData : (evData.events || []);
              if (evList.length > 0) {
                setEvents(prev => prev.length >= evList.length ? prev : evList);
              }
            })
            .catch(() => {});

          fetch(`/api/transfers/${currentTransferId}/metrics`)
            .then(res => res.json())
            .then(mData => {
              if (mData && mData.protocol) {
                setMetrics(mData);
              }
            })
            .catch(() => {});

          fetch(`/api/transfers/${currentTransferId}/verification`)
            .then(res => res.json())
            .then(data => {
              setVerification(data);
              if (data.state === 'SUCCESS' && data.verified === true && data.byteEqual === true) {
                setTransferLifecycle(TRANSFER_LIFECYCLE.COMPLETED);
              } else {
                setTransferLifecycle(TRANSFER_LIFECYCLE.FAILED);
              }
            })
            .catch(err => {
              console.error('Verification error:', err);
              setTransferLifecycle(TRANSFER_LIFECYCLE.FAILED);
            });
        }
      }
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Join transfer room whenever transfer.id updates
  useEffect(() => {
    const sock = socketRef.current;
    if (sock && transfer?.id) {
      if (sock.connected) {
        sock.emit('join_transfer', transfer.id);
      } else {
        const handleConnect = () => {
          sock.emit('join_transfer', transfer.id);
        };
        sock.once('connect', handleConnect);
        return () => {
          sock.off('connect', handleConnect);
        };
      }
    }
  }, [transfer?.id]);

  // Map events to stage
  useEffect(() => {
    if (!events.length) {
      setCurrentStage(transfer ? 2 : 1);
      return;
    }

    const visibleEvents = events.slice(0, playbackIndex + 1);
    const lastEvent = visibleEvents[visibleEvents.length - 1];

    if (!lastEvent) return;

    if (lastEvent.type === 'verification_result') {
      setCurrentStage(10);
    } else if (lastEvent.type === 'reconstruction_progress' && lastEvent.pct >= 100) {
      setCurrentStage(9);
    } else if (lastEvent.type === 'reconstruction_progress') {
      setCurrentStage(8);
    } else if (lastEvent.type === 'decoder_step' || lastEvent.type === 'decoder_matrix_update') {
      setCurrentStage(7);
    } else if (lastEvent.type === 'packet_transmitted' || lastEvent.type === 'packet_received' || lastEvent.type === 'packet_dropped') {
      setCurrentStage(6);
    } else if (lastEvent.type === 'source_block_created') {
      setCurrentStage(3);
    }
  }, [events, playbackIndex, transfer]);

  // Playback timer loop
  useEffect(() => {
    if (!isPlaying) {
      if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
      return;
    }

    const interval = Math.max(20, Math.floor(400 / speed));
    playbackTimerRef.current = setInterval(() => {
      setPlaybackIndex((curr) => {
        if (curr >= events.length - 1) {
          setIsPlaying(false);
          return curr;
        }
        return curr + 1;
      });
    }, interval);

    return () => {
      if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
    };
  }, [isPlaying, events.length, speed]);

  // Poll verification endpoint
  const pollVerification = async (transferId = transfer?.id) => {
    if (!transferId) return null;
    try {
      const res = await fetch(`/api/transfers/${transferId}/verification`);
      if (res.ok) {
        const data = await res.json();
        setVerification(data);
        if (data.state === 'SUCCESS') {
          setTransferLifecycle(TRANSFER_LIFECYCLE.COMPLETED);
        } else if (data.state === 'FAILED') {
          setTransferLifecycle(TRANSFER_LIFECYCLE.FAILED);
        }
        return data;
      }
    } catch (err) {
      console.error('Error polling verification:', err);
    }
    return null;
  };

  const startTransfer = async (formData) => {
    // Reset all previous transfer, timer, and receiver state
    activeTransferIdRef.current = null;
    seenEventKeysRef.current.clear();
    transferStartTimeRef.current = null;
    setElapsedTime(0);
    setTransfer(null);
    setEvents([]);
    setPlaybackIndex(0);
    setMetrics(null);
    setVerification(null);
    setLatestHandshakeStep(0);
    setTransferLifecycle(TRANSFER_LIFECYCLE.INITIALIZING);
    setCurrentStage(2);

    const res = await fetch('/api/transfers', {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      setTransferLifecycle(TRANSFER_LIFECYCLE.FAILED);
      const err = await res.json();
      throw new Error(err.error || 'Failed to initialize transfer');
    }
    const data = await res.json();
    activeTransferIdRef.current = data.id;
    setTransfer(data);

    if (socketRef.current) {
      socketRef.current.emit('join_transfer', data.id);
    }

    // Launch engine
    const startRes = await fetch(`/api/transfers/${data.id}/start`, { method: 'POST' });
    if (!startRes.ok) {
      setTransferLifecycle(TRANSFER_LIFECYCLE.FAILED);
      const err = await startRes.json();
      throw new Error(err.error || 'Failed to start engine');
    }
    setIsPlaying(true);
  };

  const cancelTransfer = async () => {
    if (!transfer?.id) return;
    try {
      await fetch(`/api/transfers/${transfer.id}/cancel`, { method: 'POST' });
      setTransferLifecycle(TRANSFER_LIFECYCLE.CANCELLED);
    } catch (err) {
      console.error('Error cancelling transfer:', err);
    }
  };

  // Derive precise Receiver State strictly from authentic events
  const receiverState = useMemo(() => {
    const isVerified = Boolean(
      verification &&
      verification.state === 'SUCCESS' &&
      verification.verified === true &&
      verification.byteEqual === true &&
      transferLifecycle === TRANSFER_LIFECYCLE.COMPLETED
    );

    // Filter relevant events for the active transfer
    const currentId = transfer?.id || activeTransferIdRef.current;
    const transferEvents = events.filter(e => {
      if (!currentId || !e.transfer_id) return true;
      const s1 = String(currentId);
      const s2 = String(e.transfer_id);
      if (s1 === s2 || s1.includes(s2) || s2.includes(s1)) return true;
      const d1 = s1.replace(/\D/g, '');
      const d2 = s2.replace(/\D/g, '');
      return d1.length > 0 && d2.length > 0 && (d1 === d2 || d1.includes(d2) || d2.includes(d1));
    });

    // Deduplicate events locally in case state was initialized with repeated items
    const seenLocalKeys = new Set();
    const uniqueEvents = [];
    for (const e of transferEvents) {
      const key = e.event_id || `${e.type}-${e.seq_id ?? ''}-${e.gen_id ?? ''}-${e.step ?? ''}-${e.time ?? ''}`;
      if (!seenLocalKeys.has(key)) {
        seenLocalKeys.add(key);
        uniqueEvents.push(e);
      }
    }

    const txEvents = uniqueEvents.filter(e => e.type === 'packet_transmitted' || e.type === 'packet_sent');
    const rxEvents = uniqueEvents.filter(e => e.type === 'packet_received');
    const dropEvents = uniqueEvents.filter(e => e.type === 'packet_dropped' || e.type === 'phy_drop');
    const reconEvents = uniqueEvents.filter(e => e.type === 'reconstruction_progress');
    const matrixEvents = uniqueEvents.filter(e => e.type === 'decoder_matrix_update');
    const rudpRetransEvents = uniqueEvents.filter(e => e.type === 'rudp_retransmit');

    // 1. Receiver Status Label
    let statusLabel = 'Waiting for connection';
    if (transferLifecycle === TRANSFER_LIFECYCLE.IDLE) {
      statusLabel = 'Waiting for connection';
    } else if (transferLifecycle === TRANSFER_LIFECYCLE.INITIALIZING) {
      if (latestHandshakeStep === 1) statusLabel = 'Initializing transfer';
      else if (latestHandshakeStep === 2) statusLabel = 'Connection parameters accepted';
      else if (latestHandshakeStep === 3) statusLabel = 'Preparing to receive data';
      else statusLabel = 'Initializing transfer';
    } else if (transferLifecycle === TRANSFER_LIFECYCLE.TRANSFERRING) {
      statusLabel = 'Receiving data';
    } else if (transferLifecycle === TRANSFER_LIFECYCLE.DECODING) {
      statusLabel = 'Decoding coded blocks (GF(256))';
    } else if (transferLifecycle === TRANSFER_LIFECYCLE.RECONSTRUCTING) {
      statusLabel = 'Reconstructing file from blocks';
    } else if (transferLifecycle === TRANSFER_LIFECYCLE.VERIFYING) {
      statusLabel = 'Verifying file integrity (SHA-256)...';
    } else if (transferLifecycle === TRANSFER_LIFECYCLE.COMPLETED) {
      statusLabel = 'File received and verified';
    } else if (transferLifecycle === TRANSFER_LIFECYCLE.FAILED) {
      statusLabel = 'Transfer failed';
    } else if (transferLifecycle === TRANSFER_LIFECYCLE.CANCELLED) {
      statusLabel = 'Transfer cancelled';
    }

    // 2. Physical Transmission Counters
    const physicalTransmissions = txEvents.length;
    const systematicSent = txEvents.filter(e => e.pkt_type === 'Systematic').length;
    const redundancySent = txEvents.filter(e => e.pkt_type === 'Mixed').length;
    const extraRepairSent = txEvents.filter(e => e.pkt_type === 'Mixed (Retransmit)').length;
    const rudpRetransmitCount = rudpRetransEvents.length;

    // 3. Received Bytes Accounting
    // Only real packet_received events contribute payload bytes. Dropped packets and handshakes contribute 0.
    const totalRxPayloadBytes = rxEvents.reduce((sum, e) => sum + (e.payload_len || 0), 0);

    // Unique bytes assembled (for RUDP)
    const uniqueSeqReceived = new Set();
    let uniqueReconstructedBytes = 0;
    for (const e of rxEvents) {
      if (!uniqueSeqReceived.has(e.seq_id)) {
        uniqueSeqReceived.add(e.seq_id);
        uniqueReconstructedBytes += (e.payload_len || 0);
      }
    }

    // 4. RLNC Metrics from real decoder events
    const latestMatrix = matrixEvents[matrixEvents.length - 1];
    const currentRank = latestMatrix ? latestMatrix.rank : 0;
    const requiredRank = latestMatrix ? latestMatrix.required_rank : (transfer?.K || 4);
    const codedPacketsReceived = rxEvents.filter(e => e.coeffs && e.coeffs.length > 0).length;

    // 5. Reconstruction progress percentage
    const latestRecon = reconEvents[reconEvents.length - 1];
    let progressPct = 0;

    if (transferLifecycle === TRANSFER_LIFECYCLE.COMPLETED && isVerified) {
      progressPct = 100;
    } else if (transferLifecycle === TRANSFER_LIFECYCLE.IDLE || transferLifecycle === TRANSFER_LIFECYCLE.INITIALIZING) {
      progressPct = 0;
    } else {
      if (transfer?.protocol === 'rudp') {
        const totalExpected = transfer?.fileSize || 1;
        progressPct = Math.min(99, Math.floor((uniqueReconstructedBytes / totalExpected) * 100));
      } else {
        const reconPct = latestRecon ? latestRecon.pct : 0;
        progressPct = Math.min(99, reconPct);
      }
    }

    // 6. Planned configuration vs actual
    const isConnected = latestHandshakeStep >= 4 || (transferLifecycle !== TRANSFER_LIFECYCLE.IDLE && transferLifecycle !== TRANSFER_LIFECYCLE.INITIALIZING);
    const expectedBlocks = isConnected && transfer?.fileSize !== undefined && transfer?.fileSize !== null
      ? (transfer.fileSize === 0 ? 0 : Math.ceil(transfer.fileSize / (transfer?.blockSize || 1024)))
      : null;
    const expectedGenerations = isConnected && expectedBlocks !== null
      ? (expectedBlocks === 0 ? 0 : Math.ceil(expectedBlocks / (transfer?.K || 4)))
      : null;

    // 7. Time and Throughput (Live measurement while active, frozen upon verified completion)
    const isCompletedStage = (transferLifecycle === TRANSFER_LIFECYCLE.COMPLETED && isVerified);
    let displayDuration = '0.00 s';
    let displayThroughput = '0.00 KB/s';

    if (isCompletedStage) {
      if (metrics?.duration_s != null) {
        displayDuration = `${Number(metrics.duration_s).toFixed(2)} s`;
      } else if (elapsedTime > 0) {
        displayDuration = `${elapsedTime.toFixed(2)} s`;
      }

      if (metrics?.throughput_kbps != null) {
        displayThroughput = `${Number(metrics.throughput_kbps).toFixed(2)} KB/s`;
      } else if (metrics?.throughput_mbps != null) {
        displayThroughput = `${(Number(metrics.throughput_mbps) * 125).toFixed(2)} KB/s`;
      } else {
        const dur = (metrics?.duration_s || elapsedTime || 0.01);
        displayThroughput = `${(totalRxPayloadBytes / 1024 / dur).toFixed(2)} KB/s`;
      }
    } else if (transferLifecycle === TRANSFER_LIFECYCLE.IDLE) {
      displayDuration = '0.00 s';
      displayThroughput = '0.00 KB/s';
    } else {
      displayDuration = `${elapsedTime.toFixed(2)} s`;
      const liveDuration = Math.max(0.01, elapsedTime);
      displayThroughput = `${(totalRxPayloadBytes / 1024 / liveDuration).toFixed(2)} KB/s`;
    }

    // 8. File presentation at receiver: NEVER show file details before verified completion!
    let fileStatus = 'No file received yet';
    let fileSizeDisplay = '0 bytes';

    if (isVerified) {
      fileStatus = transfer?.filename || 'reconstructed_file';
      fileSizeDisplay = verification?.reconSize
        ? `${(verification.reconSize / 1024).toFixed(1)} KB`
        : `${((transfer?.fileSize || 0) / 1024).toFixed(1)} KB`;
    } else if (transferLifecycle === TRANSFER_LIFECYCLE.FAILED) {
      fileStatus = 'Transfer failed';
      fileSizeDisplay = '0 bytes';
    } else if (transferLifecycle === TRANSFER_LIFECYCLE.CANCELLED) {
      fileStatus = 'Transfer cancelled';
      fileSizeDisplay = '0 bytes';
    } else if (
      transferLifecycle === TRANSFER_LIFECYCLE.TRANSFERRING ||
      transferLifecycle === TRANSFER_LIFECYCLE.DECODING ||
      transferLifecycle === TRANSFER_LIFECYCLE.RECONSTRUCTING ||
      transferLifecycle === TRANSFER_LIFECYCLE.VERIFYING
    ) {
      fileStatus = 'Partial / Incomplete';
      fileSizeDisplay = `${(totalRxPayloadBytes / 1024).toFixed(1)} KB received (Incomplete)`;
    } else {
      fileStatus = 'No file received yet';
      fileSizeDisplay = '0 bytes';
    }

    // RLNC specific accounting
    const reconstructedBytes = (transfer?.protocol === 'rudp')
      ? uniqueReconstructedBytes
      : (latestRecon ? Math.round((latestRecon.pct / 100) * (transfer?.fileSize || 0)) : 0);
    const decodedGenerations = latestRecon ? Math.ceil((latestRecon.recovered_blocks || 0) / (transfer?.K || 4)) : 0;

    return {
      status: statusLabel,
      fileStatus,
      fileSizeDisplay,
      progressPct,
      receivedPayloadBytes: totalRxPayloadBytes,
      uniqueReconstructedBytes,
      physicalTransmissions,
      systematicSent,
      redundancySent,
      extraRepairSent,
      rudpRetransmitCount,
      receivedPacketCount: rxEvents.length,
      droppedPacketCount: dropEvents.length,
      expectedBlocks,
      expectedGenerations,
      currentRank,
      requiredRank,
      reconstructedBytes,
      codedPacketsReceived,
      decodedGenerations,
      displayDuration,
      displayThroughput,
      isVerified,
      canDownload: Boolean(isVerified && transfer?.id),
    };
  }, [events, transfer, transferLifecycle, latestHandshakeStep, verification, elapsedTime, metrics]);

  return (
    <TransferContext.Provider
      value={{
        transfer,
        setTransfer,
        transferLifecycle,
        receiverState,
        events,
        setEvents,
        playbackIndex,
        setPlaybackIndex,
        isPlaying,
        play: () => setIsPlaying(true),
        pause: () => setIsPlaying(false),
        stepForward: () => {
          setIsPlaying(false);
          setPlaybackIndex((c) => Math.min(events.length - 1, c + 1));
        },
        stepBackward: () => {
          setIsPlaying(false);
          setPlaybackIndex((c) => Math.max(0, c - 1));
        },
        restartPlayback: () => {
          setIsPlaying(false);
          setPlaybackIndex(0);
        },
        speed,
        setSpeed,
        pauseAtStage,
        setPauseAtStage,
        currentStage,
        metrics,
        verification,
        backendReady,
        startTransfer,
        cancelTransfer,
        pollVerification,
      }}
    >
      {children}
    </TransferContext.Provider>
  );
}

export function useTransfer() {
  return useContext(TransferContext);
}
