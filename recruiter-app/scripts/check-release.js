const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const appRoot = path.join(__dirname, '..');
const installerName = 'TruveilRecruiter-Setup-1.0.0.exe';
const installerPath = path.join(repoRoot, 'landing', 'downloads', installerName);
const checksumPath = `${installerPath}.sha256`;
const landingPath = path.join(repoRoot, 'landing', 'index.html');
const runtimeConfigPath = path.join(appRoot, 'src', 'config', 'runtime-config.json');

function fail(message) {
  throw new Error(message);
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function assertExists(file, label) {
  if (!fs.existsSync(file)) fail(`${label} is missing: ${file}`);
}

function assertNoPlaceholders(value, label) {
  const text = String(value || '').trim();
  if (!text) fail(`${label} is missing.`);
  if (/dummy|placeholder|example|your[_-]?supabase|localhost/i.test(text)) {
    fail(`${label} still looks like a placeholder.`);
  }
}

assertExists(installerPath, 'Recruiter installer');
assertExists(checksumPath, 'Recruiter installer checksum');
assertExists(landingPath, 'Admin website');
assertExists(runtimeConfigPath, 'Runtime config');

const actualHash = sha256(installerPath);
const recordedHash = read(checksumPath).split(/\s+/)[0]?.toLowerCase();
if (actualHash !== recordedHash) fail('Recruiter installer checksum does not match the current download.');

const landing = read(landingPath);
if (!landing.includes(`/downloads/${installerName}`)) fail('Admin website does not point at the site-local recruiter installer.');
if (/github\.com\/.*releases/i.test(landing)) fail('Admin website still links primary downloads to GitHub releases.');

const runtimeConfig = JSON.parse(read(runtimeConfigPath));
assertNoPlaceholders(runtimeConfig.supabaseUrl, 'SUPABASE_URL');
assertNoPlaceholders(runtimeConfig.supabaseAnonKey, 'SUPABASE_ANON_KEY');
for (const key of Object.keys(runtimeConfig)) {
  if (/deepgram|groq|openai|api[_-]?key|secret/i.test(key)) {
    fail(`Runtime config contains a provider secret-like key: ${key}`);
  }
}

console.log('Release check passed: recruiter installer, checksum, website download, and runtime config are ready.');
