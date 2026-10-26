const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const recruiter = path.resolve(__dirname, '..');
const repo = path.resolve(recruiter, '..');
const candidate = path.resolve(process.env.TRUVEIL_CLIENT_DIR || path.join(repo, '../Truveil-Client'));
const sourceOnly = process.argv.includes('--source-only');
const results = [];

function run(label, cwd, args) {
  process.stdout.write(`Checking ${label}...\n`);
  const result = spawnSync(process.execPath, args, {
    cwd, encoding: 'utf8', windowsHide: true, timeout: 120000,
    env: { ...process.env, TRUVEIL_CLIENT_DIR: candidate }, maxBuffer: 8 * 1024 * 1024
  });
  const output = (result.stdout || '') + (result.stderr || '');
  const skipped = /# skipped (\d+)|\u2139 skipped (\d+)/.exec(output);
  const passed = result.status === 0 && !result.error && !(skipped && Number(skipped[1] || skipped[2]) > 0);
  results.push({ label, passed, exitCode: result.status, error: result.error?.message, output });
  if (!passed) process.stderr.write(output + '\n');
}

function tests(directory, extension) {
  return fs.readdirSync(directory).filter(file => file.endsWith(extension)).sort().map(file => path.join(directory, file));
}

try {
  if (!fs.existsSync(path.join(candidate, 'package.json'))) throw new Error('The sibling Truveil-Client checkout is required. Set TRUVEIL_CLIENT_DIR if needed.');
  run('recruiter tests', recruiter, ['--test', ...tests(path.join(recruiter, 'test'), '.test.js')]);
  run('candidate tests', candidate, ['--test', ...tests(path.join(candidate, 'test'), '.test.js')]);
  run('isolated demo relay', path.join(repo, 'backend'), ['--test', ...tests(path.join(repo, 'backend/demo'), '.test.js')]);
  run('database and endpoint contracts', path.join(repo, 'supabase'), ['--experimental-vm-modules', '--test', ...tests(path.join(repo, 'supabase/tests'), '.test.cjs')]);
  run('recruiter website API', repo, ['--test', 'landing/website-api.test.cjs']);
  run('candidate website API', candidate, ['--test', 'website-api.test.cjs']);
  for (const [label, cwd] of [['recruiter', recruiter], ['candidate', candidate]]) {
    for (const file of ['main.js', 'preload.js', `src/renderer/${label === 'recruiter' ? 'dashboard' : 'session'}.js`]) {
      run(`${label} ${file} syntax`, cwd, ['--check', file]);
    }
    if (!sourceOnly) run(`${label} source-bound Windows release`, cwd, ['scripts/check-release.js']);
  }
  for (const file of ['auth.js', 'waitlist.js']) {
    const matches = fs.readFileSync(path.join(repo, 'landing/api', file)).equals(fs.readFileSync(path.join(candidate, 'api', file)));
    results.push({ label: `mirrored ${file}`, passed: matches });
  }
} catch (error) {
  results.push({ label: 'readiness prerequisites', passed: false, error: error.message });
}

const passed = results.every(result => result.passed);
const report = {
  checkedAt: new Date().toISOString(), mode: sourceOnly ? 'source-only' : 'source-and-installers',
  passed, checks: results,
  notVerifiedByThisCommand: ['Live cloud session round trip', 'Real Windows microphone and foreground-app behavior', 'Human acceptance', 'Competition submission and video']
};
const output = path.join(repo, '.readiness');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'latest.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`${passed ? 'PASS' : 'FAIL'}: ${results.filter(result => result.passed).length}/${results.length} checks. Report: ${path.join(output, 'latest.json')}`);
process.exitCode = passed ? 0 : 1;
