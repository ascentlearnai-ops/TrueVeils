const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const FILE = () => path.join(app.getPath('userData'), 'settings.json');

const DEFAULTS = {
  openrouterKey: '',
  model: 'google/gemini-2.0-flash-001',
  audioSource: 'microphone', // 'microphone' | 'system'
  showConfidence: true
};

function getAll() {
  try {
    if (!fs.existsSync(FILE())) return { ...DEFAULTS };
    const raw = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(patch) {
  const current = getAll();
  const next = { ...current, ...patch };
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify(next, null, 2));
  return next;
}

module.exports = { getAll, save };
