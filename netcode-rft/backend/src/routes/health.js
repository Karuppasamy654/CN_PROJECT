const express = require('express');
const router = express.Router();
const fs = require('fs');
const { ENGINE_BIN, NS3_BIN, NETANIM_BIN } = require('../config');

router.get('/health', (req, res) => {
  const isWin = process.platform === 'win32';
  const engineExists = fs.existsSync(ENGINE_BIN);
  const ns3Exists = isWin ? true : fs.existsSync(NS3_BIN);
  const netanimExists = isWin ? true : fs.existsSync(NETANIM_BIN);

  res.json({
    status: 'ok',
    platform: isWin ? 'win32' : 'linux/wsl',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    simulator: 'ns-3.41',
    ns3: {
      version: '3.41',
      netanimVersion: '3.109',
      binary: NS3_BIN,
      netanim: NETANIM_BIN,
      ready: ns3Exists,
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
    netanim: {
      binary: NETANIM_BIN,
      ready: netanimExists,
    },
    version: '3.41.0-ns3',
  });
});

module.exports = router;
