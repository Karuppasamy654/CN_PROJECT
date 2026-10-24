const fs = require('fs');
const path = require('path');
const { STORAGE_DIR } = require('../config');

if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

const TRANSFERS_FILE = path.join(STORAGE_DIR, 'transfers.json');
const EXPERIMENTS_FILE = path.join(STORAGE_DIR, 'experiments.json');

function loadJSON(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
  }
  return fallback;
}

function saveJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`Error saving ${filePath}:`, err);
  }
}

class Store {
  constructor() {
    this.transfers = new Map();
    this.events = new Map();
    this.init();
  }

  init() {
    const saved = loadJSON(TRANSFERS_FILE, []);
    for (const t of saved) {
      this.transfers.set(t.id, t);
      this.events.set(t.id, t.events || []);
    }
  }

  persist() {
    const list = Array.from(this.transfers.values()).map(t => ({
      ...t,
      events: this.events.get(t.id) || []
    }));
    saveJSON(TRANSFERS_FILE, list);
  }

  createTransfer(transfer) {
    this.transfers.set(transfer.id, {
      ...transfer,
      status: 'configured',
      createdAt: new Date().toISOString(),
      eventsCount: 0,
    });
    this.events.set(transfer.id, []);
    this.persist();
    return this.getTransfer(transfer.id);
  }

  getTransfer(id) {
    return this.transfers.get(id) || null;
  }

  getAllTransfers() {
    return Array.from(this.transfers.values());
  }

  updateTransfer(id, updates) {
    const t = this.getTransfer(id);
    if (!t) return null;
    const updated = { ...t, ...updates, updatedAt: new Date().toISOString() };
    this.transfers.set(id, updated);
    this.persist();
    return updated;
  }

  addEvent(transferId, event) {
    if (!this.events.has(transferId)) {
      this.events.set(transferId, []);
    }
    const list = this.events.get(transferId);
    list.push(event);

    const t = this.getTransfer(transferId);
    if (t) {
      t.eventsCount = list.length;
    }
  }

  getEvents(transferId) {
    return this.events.get(transferId) || [];
  }

  saveExperiment(exp) {
    const list = loadJSON(EXPERIMENTS_FILE, []);
    list.push({ ...exp, timestamp: new Date().toISOString() });
    saveJSON(EXPERIMENTS_FILE, list);
  }

  getExperiments() {
    return loadJSON(EXPERIMENTS_FILE, []);
  }
}

module.exports = new Store();
