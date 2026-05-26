const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const production = process.argv.includes('--production');
const outputPath = path.join(__dirname, '..', 'src', 'config', 'runtime-config.json');

const config = {
  supabaseUrl: process.env.SUPABASE_URL || process.env.TRUVEIL_SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.TRUVEIL_SUPABASE_ANON_KEY || '',
  candidateAppUrl: process.env.CANDIDATE_APP_URL || process.env.TRUVEIL_CANDIDATE_APP_URL || 'https://truveil-client.vercel.app'
};

const missing = production && (!config.supabaseUrl || !config.supabaseAnonKey);
const placeholder = production && (
  config.supabaseUrl.includes('dummy.supabase.co') ||
  config.supabaseAnonKey === 'dummy'
);

if (missing || placeholder) {
  if (missing) console.error('Missing required Supabase runtime config for recruiter packaging.');
  if (placeholder) console.error('Supabase runtime config is still using placeholder dummy values.');
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY in recruiter-app/.env before packaging.');
  process.exit(1);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
