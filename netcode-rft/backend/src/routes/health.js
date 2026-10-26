const express = require('express');
const router = express.Router();
const fs = require('fs');
const { ENGINE_BIN, NS3_BIN, NETANIM_BIN } = require('../config');

router.get('/health', (req, res) => {
  const engineExists = fs.existsSync(ENGINE_BIN);
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    simulator: 'ns-3.41',
    ns3: {
      version: '3.41',
      netanimVersion: '3.109',
      binary: NS3_BIN,
      netanim: NETANIM_BIN,
      ready: true,
    },
    engine: {
      path: ENGINE_BIN,
      ready: engineExists,
      standard: 'C11',
      compiler: 'GCC',
    },
    posixEngine: {
      path: ENGINE_BIN,
      ready: engineExists,
    },
    version: '3.41.0-ns3',
  });
});

module.exports = router;
