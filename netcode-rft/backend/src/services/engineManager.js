const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { ENGINE_BIN, ROOT_DIR } = require('../config');
const store = require('./store');

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
      delayMs = 0,
      reorder = false,
      blockSize = 1024,
      K = 4,
      redundancy = 2,
      port = 9000 + (Math.floor(Math.random() * 1000)),
    } = transfer;

    const outPath = filePath + '.reconstructed';
    const isWin = process.platform === 'win32';

    let cmd = ENGINE_BIN;
    let args = [
      '--transfer-id', transferId,
      '--protocol', protocol,
      '--file', filePath,
      '--out', outPath,
      '--port', String(port),
      '--loss', String(lossRate),
      '--delay', String(delayMs),
      '--reorder', reorder ? '1' : '0',
      '--block-size', String(blockSize),
      '--k', String(K),
      '--redundancy', String(redundancy),
      '--role', 'all',
    ];

    if (isWin) {
      const wslEngineBin = toWslPath(ENGINE_BIN);
      const wslFilePath = toWslPath(filePath);
      const wslOutPath = toWslPath(outPath);

      cmd = 'wsl';
      args = [
        wslEngineBin,
        '--transfer-id', transferId,
        '--protocol', protocol,
        '--file', wslFilePath,
        '--out', wslOutPath,
        '--port', String(port),
        '--loss', String(lossRate),
        '--delay', String(delayMs),
        '--reorder', reorder ? '1' : '0',
        '--block-size', String(blockSize),
        '--k', String(K),
        '--redundancy', String(redundancy),
        '--role', 'all',
      ];
    }

    store.updateTransfer(transferId, {
      status: 'running',
      outPath,
      port,
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
            store.addEvent(transferId, event);
            if (this.io) {
              this.io.to(transferId).emit('transfer_event', event);
            }
          } catch (e) {
            console.error('Failed to parse EVENT_JSON:', e, trimmed);
          }
        } else if (trimmed.startsWith('METRICS_JSON:')) {
          try {
            const jsonStr = trimmed.slice(13);
            const metrics = JSON.parse(jsonStr);
            store.updateTransfer(transferId, { metrics });
            store.saveExperiment(metrics);
            if (this.io) {
              this.io.to(transferId).emit('metrics', metrics);
            }
          } catch (e) {
            console.error('Failed to parse METRICS_JSON:', e, trimmed);
          }
        }
      }
    });

    proc.stderr.on('data', (data) => {
      console.error(`[Engine ${transferId} STDERR]:`, data.toString());
    });

    proc.on('close', (code) => {
      this.processes.delete(transferId);
      const passed = (code === 0);
      const finalStatus = passed ? 'completed' : 'failed';

      store.updateTransfer(transferId, {
        status: finalStatus,
        exitCode: code,
        completedAt: new Date().toISOString(),
      });

      if (this.io) {
        this.io.to(transferId).emit('status', {
          status: finalStatus,
          transferId,
          exitCode: code,
          passed,
        });
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
        this.io.to(transferId).emit('status', {
          status: 'failed',
          transferId,
          error: err.message,
        });
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
}

module.exports = new EngineManager();
