const express = require('express');
const router = express.Router();
const fs = require('fs');
const { ENGINE_BIN } = require('../config');

router.get('/health', (req, res) => {
  const engineExists = fs.existsSync(ENGINE_BIN);
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    engine: {
      path: ENGINE_BIN,
      ready: engineExists,
    },
    version: '1.0.0',
  });
});

module.exports = router;
