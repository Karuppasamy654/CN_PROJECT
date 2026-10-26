const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { z } = require('zod');

const { UPLOADS_DIR, DOWNLOADS_DIR, MAX_FILE_SIZE } = require('../config');
const store = require('../services/store');
const engineManager = require('../services/engineManager');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${uniqueSuffix}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
});

function computeFileSHA256(filePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`File not found at path: ${filePath}`));
    }
    const hash = crypto.createHash('sha256');
    let bytesRead = 0;
    const stream = fs.createReadStream(filePath);
    stream.on('data', data => {
      bytesRead += data.length;
      hash.update(data);
    });
    stream.on('end', () => resolve({ hash: hash.digest('hex'), bytesRead }));
    stream.on('error', err => reject(err));
  });
}

// 1. POST /api/transfers (Upload file and initialize transfer)
router.post('/transfers', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const {
      protocol = 'rlnc',
      lossRate = '0',
      delayMs = '0',
      reorder = 'false',
      blockSize = '1024',
      K = '4',
      redundancy = '2',
      seed = '1',
      autoNetAnim = 'true',
    } = req.body;

    const normalizedProtocol = protocol.toLowerCase();
    if (normalizedProtocol !== 'rlnc' && normalizedProtocol !== 'rudp') {
      return res.status(400).json({ error: 'Protocol must be either "rlnc" or "rudp"' });
    }

    const parsedLoss = parseFloat(lossRate);
    if (isNaN(parsedLoss) || parsedLoss < 0 || parsedLoss > 90) {
      return res.status(400).json({ error: 'Loss rate must be between 0 and 90%' });
    }

    const parsedDelay = parseInt(delayMs, 10);
    if (isNaN(parsedDelay) || parsedDelay < 0 || parsedDelay > 5000) {
      return res.status(400).json({ error: 'Delay must be between 0 and 5000 ms' });
    }

    const parsedBlockSize = parseInt(blockSize, 10);
    if (isNaN(parsedBlockSize) || parsedBlockSize < 64 || parsedBlockSize > 1024) {
      return res.status(400).json({ error: 'Block size must be between 64 and 1024 bytes (max unfragmented payload)' });
    }

    const parsedK = parseInt(K, 10);
    if (isNaN(parsedK) || parsedK < 1 || parsedK > 32) {
      return res.status(400).json({ error: 'Generation size K must be between 1 and 32' });
    }

    const parsedRedundancy = parseInt(redundancy, 10);
    if (isNaN(parsedRedundancy) || parsedRedundancy < 0 || parsedRedundancy > 32) {
      return res.status(400).json({ error: 'Redundancy must be between 0 and 32' });
    }

    const parsedSeed = parseInt(seed, 10);
    const validSeed = (!isNaN(parsedSeed) && parsedSeed > 1) ? parsedSeed : (Math.floor(Math.random() * 65535) + 2);

    const filePath = req.file.path;
    const stats = fs.statSync(filePath);
    const { hash: fileSha256, bytesRead: uploadBytesRead } = await computeFileSHA256(filePath);
    if (stats.size !== uploadBytesRead) {
      return res.status(400).json({ error: `File stat size (${stats.size}) does not match bytes read during hashing (${uploadBytesRead})` });
    }

    const transferId = 'transfer-' + Date.now();
    const transfer = {
      id: transferId,
      filename: path.basename(req.file.originalname),
      filePath,
      fileSize: stats.size,
      fileSha256,
      protocol: normalizedProtocol,
      lossRate: parsedLoss,
      delayMs: parsedDelay,
      reorder: reorder === 'true' || reorder === true,
      blockSize: parsedBlockSize,
      K: parsedK,
      redundancy: parsedRedundancy,
      seed: validSeed,
      autoNetAnim: autoNetAnim === 'true' || autoNetAnim === true,
    };

    const saved = store.createTransfer(transfer);
    res.status(201).json(saved);
  } catch (err) {
    console.error('Error creating transfer:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/transfers/:id
router.get('/transfers/:id', (req, res) => {
  const t = store.getTransfer(req.params.id);
  if (!t) return res.status(404).json({ error: 'Transfer not found' });
  res.json(t);
});

// 3. POST /api/transfers/:id/start
router.post('/transfers/:id/start', (req, res) => {
  const t = store.getTransfer(req.params.id);
  if (!t) return res.status(404).json({ error: 'Transfer not found' });

  try {
    engineManager.startTransfer(req.params.id);
    res.json({ message: 'Transfer started successfully', transferId: req.params.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 4. POST /api/transfers/:id/cancel
router.post('/transfers/:id/cancel', (req, res) => {
  const success = engineManager.cancelTransfer(req.params.id);
  res.json({ success });
});

// 4b. POST /api/transfers/:id/netanim (Launch NetAnim desktop viewer for this transfer's trace)
router.post('/transfers/:id/netanim', (req, res) => {
  const t = store.getTransfer(req.params.id);
  if (!t) return res.status(404).json({ error: 'Transfer not found' });
  const tracePath = t.tracePath || `/mnt/f/CN_project/netcode-rft/results/trace_${t.id}_${(t.protocol || 'rlnc').toLowerCase()}_loss${t.lossRate}.xml`;
  const success = engineManager.launchNetAnim(tracePath);
  res.json({
    success,
    message: success ? 'NetAnim desktop viewer opened with transfer trace' : 'Failed to launch NetAnim desktop',
    tracePath,
  });
});


// 5. GET /api/transfers/:id/events
router.get('/transfers/:id/events', (req, res) => {
  const events = store.getEvents(req.params.id);
  res.json({ transferId: req.params.id, count: events.length, events });
});

// 6. GET /api/transfers/:id/metrics
router.get('/transfers/:id/metrics', (req, res) => {
  const t = store.getTransfer(req.params.id);
  if (!t) return res.status(404).json({ error: 'Transfer not found' });
  res.json(t.metrics || { status: 'pending' });
});

// 7. GET /api/transfers/:id/inspector
router.get('/transfers/:id/inspector', (req, res) => {
  const t = store.getTransfer(req.params.id);
  if (!t) return res.status(404).json({ error: 'Transfer not found' });

  const events = store.getEvents(req.params.id);
  const sourceBlocks = events.filter(e => e.type === 'source_block_created');
  const matrixUpdates = events.filter(e => e.type === 'decoder_matrix_update');
  const decoderSteps = events.filter(e => e.type === 'decoder_step');
  const packetEvents = events.filter(e => e.type === 'packet_transmitted' || e.type === 'packet_received' || e.type === 'packet_dropped');

  res.json({
    transferId: t.id,
    sourceBlocks,
    matrixUpdates,
    decoderSteps,
    packetEvents,
  });
});

// 8. GET /api/transfers/:id/verification
router.get('/transfers/:id/verification', async (req, res) => {
  const t = store.getTransfer(req.params.id);
  if (!t) return res.status(404).json({ error: 'Transfer not found' });

  if (t.status === 'configured') {
    return res.json({
      verified: false,
      state: 'NOT_STARTED',
      message: 'Waiting to start transfer',
    });
  }

  if (t.status === 'running') {
    return res.json({
      verified: false,
      state: 'TRANSFERRING',
      message: 'Transfer in progress',
    });
  }

  if (t.status === 'cancelled') {
    return res.json({
      verified: false,
      state: 'CANCELLED',
      message: 'Transfer cancelled by user',
    });
  }

  if (t.status === 'failed') {
    return res.json({
      verified: false,
      state: 'FAILED',
      message: t.error ? `Transfer failed — ${t.error}` : 'Transfer failed — C networking engine reported error or incomplete reconstruction',
      exitCode: t.exitCode,
    });
  }

  const outPath = path.resolve(t.filePath + '.reconstructed');
  if (!fs.existsSync(outPath)) {
    return res.json({
      verified: false,
      state: 'FAILED',
      message: 'Transfer failed — Reconstructed output file does not exist',
    });
  }

  const origStats = fs.statSync(t.filePath);
  const reconStats = fs.statSync(outPath);

  if (origStats.size !== reconStats.size) {
    return res.json({
      verified: false,
      state: 'FAILED',
      message: `Transfer failed — File size mismatch (Original: ${origStats.size} bytes, Reconstructed: ${reconStats.size} bytes)`,
      origSize: origStats.size,
      reconSize: reconStats.size,
      byteEqual: false,
    });
  }

  const { hash: origSha, bytesRead: origBytesRead } = await computeFileSHA256(t.filePath);
  const { hash: reconSha, bytesRead: reconBytesRead } = await computeFileSHA256(outPath);

  if (origBytesRead !== origStats.size || reconBytesRead !== reconStats.size) {
    return res.json({
      verified: false,
      state: 'FAILED',
      message: `Transfer failed — Byte read count mismatch during hashing (orig read ${origBytesRead} of ${origStats.size}, recon read ${reconBytesRead} of ${reconStats.size})`,
      origSize: origStats.size,
      reconSize: reconStats.size,
      origBytesRead,
      reconBytesRead,
      byteEqual: false,
    });
  }

  const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  if (origStats.size > 0 && (origSha === EMPTY_SHA || reconSha === EMPTY_SHA || t.fileSha256 === EMPTY_SHA)) {
    return res.json({
      verified: false,
      state: 'FAILED',
      message: 'Transfer failed — Non-empty file evaluated to empty-file SHA-256 hash',
      origSha,
      reconSha,
      origSize: origStats.size,
      reconSize: reconStats.size,
      origBytesRead,
      reconBytesRead,
      byteEqual: false,
    });
  }

  if (t.fileSha256 && t.fileSha256 !== origSha) {
    return res.json({
      verified: false,
      state: 'FAILED',
      message: 'Transfer failed — Upload SHA-256 metadata does not match source file on disk',
      origSha,
      reconSha,
      origSize: origStats.size,
      reconSize: reconStats.size,
      origBytesRead,
      reconBytesRead,
      byteEqual: false,
    });
  }

  if (origSha !== reconSha) {
    return res.json({
      verified: false,
      state: 'FAILED',
      message: 'Transfer failed — SHA-256 cryptographic hash mismatch (corrupted bytes)',
      origSha,
      reconSha,
      origSize: origStats.size,
      reconSize: reconStats.size,
      origBytesRead,
      reconBytesRead,
      byteEqual: false,
    });
  }

  // Success ONLY when transfer completed, file exists, byte count matches, and SHA-256 matches
  res.json({
    verified: true,
    state: 'SUCCESS',
    message: 'File reconstructed and verified successfully',
    origSha,
    reconSha,
    origSize: origStats.size,
    reconSize: reconStats.size,
    origBytesRead,
    reconBytesRead,
    byteEqual: true,
  });
});

// 9. GET /api/transfers/:id/download
router.get('/transfers/:id/download', (req, res) => {
  const t = store.getTransfer(req.params.id);
  if (!t) return res.status(404).json({ error: 'Transfer not found' });

  if (t.status !== 'completed') {
    return res.status(400).json({ error: 'Transfer not completed or verified yet' });
  }

  const outPath = path.resolve(t.filePath + '.reconstructed');
  const allowedDir = path.resolve(UPLOADS_DIR);
  if (!outPath.startsWith(allowedDir)) {
    return res.status(403).json({ error: 'Unauthorized file download path' });
  }

  if (!fs.existsSync(outPath)) {
    return res.status(404).json({ error: 'Reconstructed file not available yet' });
  }

  const protocolSuffix = (t.protocol || 'RLNC').toUpperCase();
  const ext = path.extname(t.filename);
  const base = path.basename(t.filename, ext);
  const downloadName = `${base}_received_${protocolSuffix}${ext}`;
  res.download(outPath, downloadName);
});

// 10. GET /api/experiments
router.get('/experiments', (req, res) => {
  res.json(store.getExperiments());
});

// 10b. GET /api/history (Transfer and experiment history for visualizer and dashboard)
router.get('/history', (req, res) => {
  const transfers = store.getAllTransfers().map(t => ({
    id: t.id,
    transfer_id: t.id,
    filename: t.filename,
    mode: t.protocol,
    protocol: t.protocol,
    loss_rate: t.lossRate ? (t.lossRate > 1 ? t.lossRate / 100 : t.lossRate) : 0,
    lossRate: t.lossRate,
    seed: t.seed,
    fileSize: t.fileSize,
    status: t.status,
    eventsCount: t.eventsCount || 0,
    createdAt: t.createdAt,
    timestamp: t.createdAt,
  })).reverse();

  const experiments = store.getExperiments();

  res.json({
    experiments: transfers.length > 0 ? transfers : experiments,
    transfers,
  });
});

// 11. GET /api/batch-results (Fetch recorded multi-loss NS-3 comparison matrix)
router.get('/batch-results', (req, res) => {
  const { RESULTS_DIR } = require('../config');
  const jsonPath = path.join(RESULTS_DIR, 'batch_comparison_results.json');
  if (fs.existsSync(jsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      return res.json({ available: true, results: data });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to parse batch results: ' + e.message });
    }
  }
  return res.json({ available: false, results: [] });
});

// 12. GET /api/traces (List all generated NetAnim XML traces)
router.get('/traces', (req, res) => {
  const { RESULTS_DIR } = require('../config');
  if (!fs.existsSync(RESULTS_DIR)) {
    return res.json({ traces: [] });
  }
  const files = fs.readdirSync(RESULTS_DIR)
    .filter(f => f.endsWith('.xml'))
    .map(f => {
      const full = path.join(RESULTS_DIR, f);
      const st = fs.statSync(full);
      return {
        filename: f,
        path: full,
        wslPath: `/mnt/f/CN_project/netcode-rft/results/${f}`,
        sizeBytes: st.size,
        modified: st.mtime,
      };
    })
    .sort((a, b) => b.modified - a.modified);

  res.json({ traces: files });
});

// 13. POST /api/netanim/launch (Launch desktop NetAnim viewer for any trace)
router.post('/netanim/launch', (req, res) => {
  const { tracePath } = req.body || {};
  const launched = engineManager.launchNetAnim(tracePath);
  res.json({ success: launched, tracePath });
});

module.exports = router;

