'use strict';

const { parseArgs } = require('node:util');
const { createDemoRelay } = require('./relay-server');

async function main() {
  const { values } = parseArgs({ options: { host: { type: 'string', default: '127.0.0.1' }, port: { type: 'string', default: '43180' } } });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid relay port.');
  const relay = createDemoRelay();
  try { await relay.listen(port, values.host); }
  catch (error) { await relay.close(); throw error; }
  console.log(`Demo relay listening on ${values.host}:${port}/demo. TLS proxy required for Internet use.`);
  if (!process.env.DEEPGRAM_API_KEY) console.log('Transcription token provider not configured.');
  const stop = () => { relay.close().catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}

if (require.main === module) main().catch(() => { console.error('Demo relay could not start. Check TRUVEIL_DEMO_HOST_KEY (32-256 random base64url or hex characters), port and CLI options.'); process.exitCode = 1; });

module.exports = { main };
