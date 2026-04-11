const { app } = require('electron');
const fs = require('fs');
const path = require('path');

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString();
}
function fmtDate(ts) {
  return new Date(ts).toLocaleString();
}
function durationStr(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function scoreClass(n) {
  if (n == null) return 'unk';
  if (n >= 70) return 'high';
  if (n >= 40) return 'med';
  return 'low';
}
function riskLabel(avg) {
  if (avg >= 70) return 'HIGH RISK';
  if (avg >= 40) return 'MEDIUM RISK';
  if (avg > 0) return 'LOW RISK';
  return 'INCONCLUSIVE';
}

async function generate(data) {
  const { session, startedAt, endedAt, transcripts, flags, scores } = data;
  const dir = path.join(app.getPath('userData'), 'reports');
  fs.mkdirSync(dir, { recursive: true });

  const startMs = startedAt || session.createdAt;
  const endMs = endedAt || Date.now();
  const duration = durationStr(endMs - startMs);

  const validScores = scores.filter(n => typeof n === 'number');
  const avg = validScores.length ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length) : 0;
  const max = validScores.length ? Math.max(...validScores) : 0;
  const highFlags = flags.filter(f => f.severity === 'high' || f.severity === 'critical').length;

  const html = buildHtml({
    session, startMs, endMs, duration, avg, max, highFlags,
    transcripts, flags, totalResponses: transcripts.length
  });

  const filename = `${session.sessionId}-${new Date(startMs).toISOString().replace(/[:.]/g, '-').slice(0, 19)}.html`;
  const fullPath = path.join(dir, filename);
  fs.writeFileSync(fullPath, html, 'utf8');
  return fullPath;
}

function buildHtml(ctx) {
  const { session, startMs, endMs, duration, avg, max, highFlags, transcripts, flags, totalResponses } = ctx;
  const riskCls = avg >= 70 ? 'high' : avg >= 40 ? 'med' : 'low';

  const transcriptRows = transcripts.length
    ? transcripts.map(t => `
      <div class="entry">
        <div class="entry-head">
          <span class="time">${fmtTime(t.timestamp)}</span>
          <span class="score ${scoreClass(t.aiScore)}">${t.aiScore != null ? t.aiScore + '%' : '—'}</span>
        </div>
        <div class="entry-text">${esc(t.text)}</div>
        ${t.reasoning ? `<div class="reasoning">${esc(t.reasoning)}</div>` : ''}
        ${t.flags && t.flags.length ? `<div class="sub-flags">${t.flags.map(f => `<span class="chip">${esc(f)}</span>`).join('')}</div>` : ''}
      </div>`).join('')
    : '<div class="empty">No transcripts were captured during this session.</div>';

  const flagRows = flags.length
    ? flags.map(f => `
      <tr>
        <td class="mono">${fmtTime(f.timestamp)}</td>
        <td><span class="sev ${esc(f.severity || 'medium')}">${esc((f.severity || 'medium').toUpperCase())}</span></td>
        <td>${esc(f.text)}</td>
      </tr>`).join('')
    : '<tr><td colspan="3" class="empty">No anomalies recorded.</td></tr>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Truveil Report — ${esc(session.candidateName)} — ${esc(session.sessionId)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #050507; color: #fafafa; font-family: 'Inter', sans-serif; line-height: 1.55; padding: 48px 32px; -webkit-font-smoothing: antialiased; }
  .container { max-width: 900px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 28px; border-bottom: 1px solid rgba(255,255,255,.08); margin-bottom: 40px; }
  .logo { font-size: 20px; font-weight: 800; background: linear-gradient(135deg, #fff 40%, #60a5fa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .tag { display: inline-block; margin-top: 6px; font-size: 10px; color: rgba(255,255,255,.3); letter-spacing: 1.5px; text-transform: uppercase; font-weight: 600; }
  .sid { text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: rgba(255,255,255,.5); }
  h1 { font-size: 42px; font-weight: 900; letter-spacing: -2px; line-height: 1.05; margin-bottom: 12px; }
  .sub-title { font-size: 15px; color: rgba(255,255,255,.5); margin-bottom: 40px; }
  .risk-banner { display: flex; align-items: center; gap: 20px; padding: 28px 32px; border-radius: 16px; margin-bottom: 40px; border: 1px solid; }
  .risk-banner.high { background: rgba(239,68,68,.06); border-color: rgba(239,68,68,.3); }
  .risk-banner.med { background: rgba(245,158,11,.05); border-color: rgba(245,158,11,.3); }
  .risk-banner.low { background: rgba(34,197,94,.05); border-color: rgba(34,197,94,.25); }
  .risk-dial { width: 96px; height: 96px; position: relative; flex-shrink: 0; }
  .risk-dial svg { transform: rotate(-90deg); width: 100%; height: 100%; }
  .risk-dial .bg { fill: none; stroke: rgba(255,255,255,.05); stroke-width: 6; }
  .risk-dial .fill { fill: none; stroke-width: 6; stroke-linecap: round; filter: drop-shadow(0 0 6px currentColor); }
  .risk-banner.high .fill { stroke: #ef4444; color: #ef4444; }
  .risk-banner.med .fill { stroke: #f59e0b; color: #f59e0b; }
  .risk-banner.low .fill { stroke: #22c55e; color: #22c55e; }
  .risk-dial .pct { position: absolute; inset: 0; display: grid; place-items: center; font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -.5px; }
  .risk-info h2 { font-size: 20px; font-weight: 700; margin-bottom: 4px; letter-spacing: -.3px; }
  .risk-info p { font-size: 13px; color: rgba(255,255,255,.5); }
  .grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 40px; }
  .stat { padding: 20px 22px; background: rgba(255,255,255,.02); border: 1px solid rgba(255,255,255,.06); border-radius: 12px; }
  .stat-label { font-size: 10px; font-weight: 700; color: rgba(255,255,255,.35); letter-spacing: 1.3px; text-transform: uppercase; margin-bottom: 8px; }
  .stat-val { font-size: 24px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -.5px; }
  h3 { font-size: 13px; font-weight: 700; letter-spacing: 1.5px; color: rgba(255,255,255,.4); text-transform: uppercase; margin: 48px 0 18px; }
  .panel { background: rgba(255,255,255,.015); border: 1px solid rgba(255,255,255,.06); border-radius: 12px; padding: 24px; }
  .entry { padding: 16px 0; border-bottom: 1px solid rgba(255,255,255,.04); }
  .entry:last-child { border-bottom: none; }
  .entry-head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
  .time { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: rgba(255,255,255,.3); }
  .score { font-size: 10px; font-weight: 700; padding: 3px 9px; border-radius: 4px; }
  .score.high { background: rgba(239,68,68,.12); color: #f87171; }
  .score.med { background: rgba(245,158,11,.12); color: #fbbf24; }
  .score.low { background: rgba(34,197,94,.12); color: #4ade80; }
  .score.unk { background: rgba(255,255,255,.05); color: rgba(255,255,255,.4); }
  .entry-text { font-size: 14px; color: rgba(255,255,255,.8); line-height: 1.6; }
  .reasoning { font-size: 12px; color: #93c5fd; margin-top: 10px; padding: 10px 14px; background: rgba(59,130,246,.05); border: 1px solid rgba(59,130,246,.1); border-radius: 6px; line-height: 1.55; }
  .sub-flags { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { font-size: 10px; padding: 3px 9px; background: rgba(239,68,68,.08); border: 1px solid rgba(239,68,68,.15); border-radius: 4px; color: #fca5a5; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 14px 16px; text-align: left; border-bottom: 1px solid rgba(255,255,255,.04); font-size: 13px; }
  th { font-size: 10px; font-weight: 700; color: rgba(255,255,255,.3); text-transform: uppercase; letter-spacing: 1.2px; }
  td.mono { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: rgba(255,255,255,.4); }
  .sev { font-size: 9px; padding: 3px 8px; border-radius: 3px; font-weight: 700; letter-spacing: .5px; }
  .sev.high, .sev.critical { background: rgba(239,68,68,.12); color: #f87171; }
  .sev.medium { background: rgba(245,158,11,.12); color: #fbbf24; }
  .sev.low { background: rgba(255,255,255,.04); color: rgba(255,255,255,.4); }
  .empty { padding: 20px; text-align: center; color: rgba(255,255,255,.3); font-size: 13px; }
  footer { margin-top: 64px; padding-top: 24px; border-top: 1px solid rgba(255,255,255,.06); font-size: 11px; color: rgba(255,255,255,.25); text-align: center; }
  @media print {
    body { background: #fff; color: #111; padding: 24px; }
    .logo { -webkit-text-fill-color: #0052cc; }
    .panel, .stat, .risk-banner { background: #fafafa; border-color: #e5e7eb; }
  }
</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <div class="logo">Truveil</div>
        <div class="tag">INTERVIEW INTEGRITY REPORT</div>
      </div>
      <div class="sid">
        ${esc(session.sessionId)}<br>
        <span style="color:rgba(255,255,255,.3);font-size:11px">${fmtDate(startMs)}</span>
      </div>
    </div>

    <h1>${esc(session.candidateName)}</h1>
    <div class="sub-title">${esc(session.role)} · Session duration ${duration}</div>

    <div class="risk-banner ${riskCls}">
      <div class="risk-dial">
        <svg viewBox="0 0 64 64">
          <circle class="bg" cx="32" cy="32" r="28"/>
          <circle class="fill" cx="32" cy="32" r="28" stroke-dasharray="175.9" stroke-dashoffset="${175.9 - (avg / 100) * 175.9}"/>
        </svg>
        <div class="pct">${avg}%</div>
      </div>
      <div class="risk-info">
        <h2>${riskLabel(avg)}</h2>
        <p>Overall AI-assistance confidence across ${totalResponses} analyzed response${totalResponses === 1 ? '' : 's'}.</p>
      </div>
    </div>

    <div class="grid4">
      <div class="stat"><div class="stat-label">Average Score</div><div class="stat-val">${avg}%</div></div>
      <div class="stat"><div class="stat-label">Peak Score</div><div class="stat-val">${max}%</div></div>
      <div class="stat"><div class="stat-label">Responses</div><div class="stat-val">${totalResponses}</div></div>
      <div class="stat"><div class="stat-label">Flags</div><div class="stat-val">${flags.length}</div></div>
    </div>

    <h3>Response Analysis</h3>
    <div class="panel">${transcriptRows}</div>

    <h3>Detected Anomalies</h3>
    <div class="panel" style="padding:0">
      <table>
        <thead><tr><th style="width:110px">TIME</th><th style="width:110px">SEVERITY</th><th>DETAIL</th></tr></thead>
        <tbody>${flagRows}</tbody>
      </table>
    </div>

    <footer>
      Generated by Truveil Command Center · ${fmtDate(Date.now())}<br>
      This report is advisory. Scores reflect probabilistic signal detection, not definitive determinations.
    </footer>
  </div>
</body>
</html>`;
}

module.exports = { generate };
