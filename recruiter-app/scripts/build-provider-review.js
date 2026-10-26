const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const source = path.resolve(root, '../../ai-review-system/src/desktop-entry.mjs');
const outfile = path.join(root, 'src/ai/provider-review-engine.cjs');
if (!fs.existsSync(source)) {
  if (fs.existsSync(outfile)) process.exit(0);
  throw new Error('The provider review source or its prebuilt bundle is required.');
}
esbuild.buildSync({ entryPoints: [source], outfile, bundle: true, platform: 'node', format: 'cjs',
  target: 'node20', banner: { js: '// Generated from the sibling ai-review-system. Never include environment files or ledger state.' } });
