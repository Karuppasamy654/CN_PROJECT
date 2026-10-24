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
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
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

    const filePath = req.file.path;
    const stats = fs.statSync(filePath);
    const fileSha256 = await computeFileSHA256(filePath);

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

  const origSha = t.fileSha256;
  const reconSha = await computeFileSHA256(outPath);

  if (origSha !== reconSha) {
    return res.json({
      verified: false,
      state: 'FAILED',
      message: 'Transfer failed — SHA-256 cryptographic hash mismatch (corrupted bytes)',
      origSha,
      reconSha,
      origSize: origStats.size,
      reconSize: reconStats.size,
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

module.exports = router;
