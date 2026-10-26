const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { ENGINE_BIN, NS3_BIN, NETANIM_BIN, SIMULATOR_TYPE, ROOT_DIR, RESULTS_DIR } = require('../config');
const store = require('./store');

if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

function toWslPath(winPath) {
  if (!winPath) return '';
  const resolved = path.resolve(winPath).replace(/\\/g, '/');
  // Match drive letter e.g. F:/... -> /mnt/f/...
  const match = resolved.match(/^([a-zA-Z]):\/(.*)$/);
  if (match) {
    const drive = match[1].toLowerCase();
    return `/mnt/${drive}/${match[2]}`;
  }
  return resolved;
}

class EngineManager {
  constructor() {
    this.processes = new Map();
    this.io = null;
  }

  setIO(io) {
    this.io = io;
  }

  startTransfer(transferId) {
    const transfer = store.getTransfer(transferId);
    if (!transfer) {
      throw new Error(`Transfer ${transferId} not found`);
    }

    if (this.processes.has(transferId)) {
      throw new Error(`Transfer ${transferId} is already running`);
    }

    const {
      protocol = 'rlnc',
      filePath,
      lossRate = 0,
      delayMs = 20,
      bandwidth = '10Mbps',
      reorder = false,
      blockSize = 1024,
      K = 4,
      redundancy = 2,
      seed = 1,
      port = 9000 + (Math.floor(Math.random() * 1000)),
    } = transfer;

    const outPath = filePath + '.reconstructed';
    const isWin = process.platform === 'win32';
    const simType = transfer.simulatorType || SIMULATOR_TYPE || 'ns3';
    const traceFileName = `trace_${transferId}_${protocol.toLowerCase()}_loss${lossRate}.xml`;
    const traceFilePathWsl = `/mnt/f/CN_project/netcode-rft/results/${traceFileName}`;
    const traceFilePathWin = path.join(RESULTS_DIR, traceFileName);

    let cmd = 'wsl';
    let args = [];

    if (simType === 'ns3') {
      const numericTransferId = (String(transferId).replace(/\D/g, '') || '1').slice(-9);
      args = [
        NS3_BIN,
        `--protocol=${protocol.toUpperCase()}`,
        `--loss=${lossRate}`,
        `--delay=${delayMs}ms`,
        `--bandwidth=${bandwidth || '10Mbps'}`,
        `--file=${toWslPath(filePath)}`,
        `--out=${toWslPath(outPath)}`,
        `--trace=${traceFilePathWsl}`,
        `--k=${K}`,
        `--block-size=${blockSize}`,
        `--redundancy=${redundancy}`,
        `--transfer-id=${numericTransferId}`,
        `--seed=${seed}`,
      ];
    } else {
      args = [
        toWslPath(ENGINE_BIN),
        '--transfer-id', transferId,
        '--protocol', protocol.toLowerCase(),
        '--file', toWslPath(filePath),
        '--out', toWslPath(outPath),
        '--port', String(port),
        '--loss', String(lossRate),
        '--delay', String(delayMs),
        '--reorder', reorder ? '1' : '0',
        '--block-size', String(blockSize),
        '--k', String(K),
        '--redundancy', String(redundancy),
        '--seed', String(seed),
        '--role', 'all',
      ];
    }

    store.updateTransfer(transferId, {
      status: 'running',
      outPath,
      tracePath: traceFilePathWsl,
      traceFile: traceFileName,
      simulatorType: simType,
      port,
      seed,
      startedAt: new Date().toISOString(),
    });


    if (this.io) {
      this.io.to(transferId).emit('status', { status: 'running', transferId });
    }

    const proc = spawn(cmd, args, { shell: false });
    this.processes.set(transferId, proc);

    let stdoutBuffer = '';

    proc.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop(); // keep partial line

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('EVENT_JSON:')) {
          try {
            const jsonStr = trimmed.slice(11);
            const event = JSON.parse(jsonStr);
            event.transfer_id = transferId;

            // Normalize NS-3 event types for frontend UI compatibility
            if (event.type === 'packet_sent') {
              event.type = 'packet_transmitted';
              if (event.seq_id === undefined && event.packet_index !== undefined) {
                event.seq_id = event.packet_index;
              }
              if (event.pkt_type === undefined) {
                event.pkt_type = event.coded ? 'Mixed' : 'Systematic';
              }
            } else if (event.type === 'ack_sent' || event.type === 'ack_received') {
              event.ack_seq = event.ack_seq ?? event.seq_id ?? 0;
            } else if (event.type === 'gen_ack_sent' || event.type === 'gen_ack_received') {
              event.ack_seq = event.gen_id ?? 0;
            }

            store.addEvent(transferId, event);
            if (this.io) {
              this.io.to(transferId).emit('transfer_event', event);
              this.io.emit('transfer_event', event);
            }
          } catch (e) {
            console.error('Failed to parse EVENT_JSON:', e, trimmed);
          }
        } else if (trimmed.startsWith('METRICS_JSON:')) {
          try {
            const jsonStr = trimmed.slice(13);
            const metrics = JSON.parse(jsonStr);
            metrics.transfer_id = transferId;
            store.updateTransfer(transferId, { metrics });
            store.saveExperiment(metrics);
            if (this.io) {
              this.io.to(transferId).emit('metrics', metrics);
              this.io.emit('metrics', metrics);
            }
          } catch (e) {
            console.error('Failed to parse METRICS_JSON:', e, trimmed);
          }
        } else if (trimmed.length > 0) {
          console.log(trimmed);
        }
      }
    });

    proc.stderr.on('data', (data) => {
      console.error(`[Engine ${transferId} STDERR]:`, data.toString());
    });

    proc.on('close', (code) => {
      if (stdoutBuffer && stdoutBuffer.trim().length > 0) {
        const remaining = stdoutBuffer.trim();
        if (!remaining.startsWith('EVENT_JSON:') && !remaining.startsWith('METRICS_JSON:')) {
          console.log(remaining);
        }
        stdoutBuffer = '';
      }
      this.processes.delete(transferId);
      const passed = (code === 0);
      const finalStatus = passed ? 'completed' : 'failed';

      store.updateTransfer(transferId, {
        status: finalStatus,
        exitCode: code,
        completedAt: new Date().toISOString(),
      });

      // Automatically launch NetAnim desktop with the generated trace when completed
      if (passed && transfer.autoNetAnim !== false) {
        try {
          if (fs.existsSync(traceFilePathWin)) {
            console.log(`[Engine] Auto-launching NetAnim desktop viewer for trace: ${traceFilePathWsl}`);
            const launched = this.launchNetAnim(traceFilePathWsl);
            if (this.io) {
              const netanimPayload = {
                status: 'launched',
                transferId,
                tracePath: traceFilePathWsl,
                traceFileName,
                success: launched,
              };
              this.io.to(transferId).emit('netanim_launched', netanimPayload);
              this.io.emit('netanim_launched', netanimPayload);
            }
          } else {
            console.warn(`[Engine] Trace file not found at: ${traceFilePathWin}`);
          }
        } catch (netanimErr) {
          console.error('[Engine] Failed to auto-launch NetAnim:', netanimErr);
        }
      }

      if (this.io) {
        const payload = {
          status: finalStatus,
          transferId,
          exitCode: code,
          passed,
        };
        this.io.to(transferId).emit('status', payload);
        this.io.emit('status', payload);
      }
    });

    proc.on('error', (err) => {
      console.error(`Process error for transfer ${transferId}:`, err);
      this.processes.delete(transferId);
      store.updateTransfer(transferId, {
        status: 'failed',
        error: err.message,
      });
      if (this.io) {
        const payload = {
          status: 'failed',
          transferId,
          error: err.message,
        };
        this.io.to(transferId).emit('status', payload);
        this.io.emit('status', payload);
      }
    });

    return proc;
  }

  cancelTransfer(transferId) {
    const proc = this.processes.get(transferId);
    if (proc) {
      proc.kill('SIGINT');
      this.processes.delete(transferId);
      store.updateTransfer(transferId, { status: 'cancelled' });
      if (this.io) {
        this.io.to(transferId).emit('status', { status: 'cancelled', transferId });
      }
      return true;
    }
    return false;
  }

  launchNetAnim(tracePath) {
    const isWin = process.platform === 'win32';
    const traceWsl = tracePath ? toWslPath(tracePath) : '';
    const bin = NETANIM_BIN || '/usr/local/bin/netanim';
    const cmd = isWin ? 'wsl' : bin;
    const bashScript = `DISPLAY="\${DISPLAY:-:0}" WAYLAND_DISPLAY="\${WAYLAND_DISPLAY:-wayland-0}" XDG_RUNTIME_DIR="\${XDG_RUNTIME_DIR:-/mnt/wslg/runtime-dir}" ${bin} "${traceWsl}"`;
    const args = isWin
      ? ['bash', '-lc', bashScript]
      : [tracePath || ''];

    try {
      console.log(`[NETANIM] Spawning desktop NetAnim viewer for: ${traceWsl || 'default'}`);
      const p = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      p.unref();
      return true;
    } catch (err) {
      console.error('Failed to launch NetAnim:', err);
      return false;
    }
  }
}

module.exports = new EngineManager();

