const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifyInstallerArchive } = require('../scripts/release-artifact');

test('installer validation rejects unrelated embedded bytes even when timestamps match', () => {
  const expected = crypto.createHash('sha256').update('verified app archive').digest('hex');
  assert.throws(() => verifyInstallerArchive('synthetic.exe', expected, () => Buffer.from('stale or unrelated app')), /does not match/);
  assert.throws(() => verifyInstallerArchive('synthetic.exe', expected, () => Buffer.alloc(0)), /does not match/);
  assert.doesNotThrow(() => verifyInstallerArchive('synthetic.exe', expected, () => Buffer.from('verified app archive')));
});
