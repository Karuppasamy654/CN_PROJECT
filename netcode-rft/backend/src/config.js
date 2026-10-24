const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../../');
const STORAGE_DIR = path.join(ROOT_DIR, 'storage');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const DOWNLOADS_DIR = path.join(ROOT_DIR, 'downloads');
const ENGINE_BIN = path.join(ROOT_DIR, 'engine/bin/netcode_engine');

module.exports = {
  PORT: process.env.PORT || 5000,
  ROOT_DIR,
  STORAGE_DIR,
  UPLOADS_DIR,
  DOWNLOADS_DIR,
  ENGINE_BIN,
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
};
