const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../../');
const STORAGE_DIR = path.join(ROOT_DIR, 'storage');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const DOWNLOADS_DIR = path.join(ROOT_DIR, 'downloads');
const RESULTS_DIR = path.join(ROOT_DIR, 'results');
const ENGINE_BIN = path.join(ROOT_DIR, 'engine/bin/netcode_engine');
const NS3_BIN = process.env.NS3_BIN || '/home/muthu/ns-allinone-3.41/ns-3.41/build/scratch/netcode-rft/ns3.41-netcode-rft-default';
const NETANIM_BIN = process.env.NETANIM_BIN || '/usr/local/bin/netanim';

module.exports = {
  PORT: process.env.PORT || 5000,
  ROOT_DIR,
  STORAGE_DIR,
  UPLOADS_DIR,
  DOWNLOADS_DIR,
  RESULTS_DIR,
  ENGINE_BIN,
  NS3_BIN,
  NETANIM_BIN,
  SIMULATOR_TYPE: process.env.SIMULATOR || 'ns3',
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
};

