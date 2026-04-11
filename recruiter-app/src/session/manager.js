const crypto = require('crypto');

function generateCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return `TRV-${code}`;
}

function create({ candidateName, role } = {}) {
  const sessionId = generateCode();
  return {
    sessionId,
    candidateName: (candidateName || '').trim() || 'Candidate',
    role: (role || '').trim() || 'Interview',
    createdAt: Date.now()
  };
}

module.exports = { create, generateCode };
