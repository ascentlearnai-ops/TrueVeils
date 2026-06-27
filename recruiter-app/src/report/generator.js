const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { evaluateReview } = require('../review/evidence');

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

function evidenceDetail(event = {}) {
  const target = event.detectedHost || event.detectedUrl || event.windowTitle || event.processName || '';
  const source = event.detectionSource ? `Detected by ${event.detectionSource}` : '';
  const rule = event.matchedRule ? `Matched ${event.matchedRule}` : '';
  return [event.text, target, source, rule].filter(Boolean).join(' | ');
}

function scoreClass(n) {
  if (n == null) return 'unk';
  if (n >= 70) return 'high';
  if (n >= 40) return 'med';
  return 'low';
}
function reviewLabel(avg) {
  if (avg >= 80) return 'URGENT HUMAN REVIEW';
  if (avg >= 60) return 'HIGH REVIEW PRIORITY';
  if (avg >= 35) return 'ELEVATED REVIEW PRIORITY';
  if (avg > 0) return 'ROUTINE REVIEW';
  return 'INCONCLUSIVE';
}

function normalizeScore(item) {
  if (typeof item === 'number') return { score: item, weight: item > 0 ? 1 : 0 };
  if (item && typeof item.score === 'number') {
    return {
      score: item.score,
      weight: typeof item.weight === 'number' ? item.weight : 1
    };
  }
  return null;
}

function weightedAverage(items) {
  const valid = items.map(normalizeScore).filter(item => item && item.weight > 0);
  const totalWeight = valid.reduce((sum, item) => sum + item.weight, 0);
  if (!valid.length || totalWeight <= 0) return 0;
  return valid.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight;
}

function aiSiteFlagCount(flags = []) {
  const pattern = /\b(chatgpt\.com|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|perplexity\.ai|poe\.com|you\.com|phind\.com|interviewcoder|interview coder|cluely|finalround|lockedin|parakeet|leetcode wizard|ultracode|interview copilot)\b/i;
  return flags.filter(flag => {
    const severity = String(flag.severity || '').toLowerCase();
    return (severity === 'high' || severity === 'critical') && pattern.test(String(flag.text || ''));
  }).length;
}

function behavioralEvidence(flags = []) {
  const evidence = {
    aiToolHits: 0,
    overlayHits: 0,
    focusSwitches: 0,
    unlistedAppHits: 0,
    criticalHits: 0,
    highHits: 0,
    destinations: []
  };
  const destinations = new Set();
  const assistantPattern = /\b(chatgpt\.com|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|perplexity\.ai|poe\.com|you\.com|phind\.com|interviewcoder|interview coder|cluely|finalround|lockedin|parakeet|leetcode wizard|ultracode|interview copilot)\b/;

  for (const flag of flags) {
    const text = [
      flag.text,
      flag.detectedHost,
      flag.detectedUrl,
      flag.matchedRule,
      flag.processName,
      flag.windowTitle
    ].filter(Boolean).join(' ').toLowerCase();
    const severity = String(flag.severity || '').toLowerCase();
    if (severity === 'critical') evidence.criticalHits++;
    if (severity === 'high' || severity === 'critical') evidence.highHits++;
    const assistantMatch = text.match(assistantPattern);
    if (assistantMatch) {
      evidence.aiToolHits++;
      destinations.add(assistantMatch[1]);
    }
    if (/\b(hidden overlay|overlay detected|exclude.?from.?capture|interview coder|interviewcoder|cluely|lockedin|finalround|parakeet)\b/.test(text)) evidence.overlayHits++;
    if (/\bswitched away\b/.test(text)) evidence.focusSwitches++;
    if (/\bunlisted app\/site\b/.test(text)) evidence.unlistedAppHits++;
  }

  const repeatedAiToolHits = Math.max(0, evidence.aiToolHits - destinations.size);
  const reviewScore = Math.min(100, Math.round(
    (evidence.aiToolHits ? 78 + Math.min(18, (evidence.aiToolHits - 1) * 9) : 0)
      + Math.min(30, evidence.overlayHits * 24)
      + Math.min(12, evidence.criticalHits * 4)
      + Math.min(8, evidence.focusSwitches)
      + Math.min(8, evidence.unlistedAppHits * 2)
  ));

  return {
    ...evidence,
    destinations: [...destinations],
    repeatedAiToolHits,
    boost: reviewScore,
    reviewScore
  };
}

function sessionRiskSummary({ scores = [], flags = [] }) {
  const valid = scores.map(normalizeScore).filter(item => item && item.weight > 0);
  const scoreValues = valid.map(item => item.score);
  const avg = weightedAverage(scores);
  const max = scoreValues.length ? Math.max(...scoreValues) : 0;
  const top = [...scoreValues].sort((a, b) => b - a).slice(0, 3);
  const topAvg = top.length ? top.reduce((sum, value) => sum + value, 0) / top.length : 0;
  const behavior = behavioralEvidence(flags);
  const transcriptAvg = Math.round(avg);
  const reviewScore = Math.max(transcriptAvg, behavior.reviewScore);
  const destinationText = behavior.destinations.length ? ` (${behavior.destinations.join(', ')})` : '';
  let reviewSummary = 'Insufficient transcript and behavioral evidence for a meaningful review priority.';
  if (behavior.aiToolHits >= 1) {
    const accessLabel = behavior.aiToolHits > 1 ? 'Repeated AI-tool access' : 'Known AI-tool access';
    reviewSummary = `High-priority review: ${behavior.aiToolHits} restricted AI-assistance destination event${behavior.aiToolHits === 1 ? ' was' : 's were'} recorded${destinationText}. ${accessLabel} is significant behavioral evidence even if transcript-only pattern risk is low or unscorable.`;
  } else if (behavior.overlayHits) {
    reviewSummary = `High-priority review: ${behavior.overlayHits} possible hidden-assistant or overlay event${behavior.overlayHits === 1 ? '' : 's'} were recorded.`;
  } else if (valid.length) {
    reviewSummary = 'Review priority is based on transcript evidence. No restricted AI-assistance destination was recorded.';
  }
  return {
    avg: reviewScore,
    reviewScore,
    reviewLabel: reviewLabel(reviewScore),
    reviewSummary,
    transcriptAvg,
    max: Math.round(max),
    behaviorBoost: behavior.reviewScore,
    behavior,
    scorableCount: valid.length
  };
}

async function generate(data) {
  const { session, startedAt, endedAt, transcripts, flags, scores, audioChunks = [], notes = [] } = data;
  const dir = path.join(app.getPath('userData'), 'reports');
  fs.mkdirSync(dir, { recursive: true });

  const startMs = startedAt || session.createdAt;
  const endMs = endedAt || Date.now();
  const duration = durationStr(endMs - startMs);

  const risk = sessionRiskSummary({ scores, flags });
  const review = data.review || evaluateReview({
    events: flags,
    transcripts,
    transcriptAnalyses: transcripts,
    telemetry: data.telemetry || {}
  });
  const avg = risk.avg;
  const max = risk.max;
  const highFlags = flags.filter(f => f.severity === 'high' || f.severity === 'critical').length;

  const html = buildHtml({
    session, startMs, endMs, duration, avg, max, highFlags, risk, review, notes,
    transcripts, flags, audioChunks, totalResponses: transcripts.length
  });

  const filename = `${session.sessionId}-${new Date(startMs).toISOString().replace(/[:.]/g, '-').slice(0, 19)}.html`;
  const fullPath = path.join(dir, filename);
  fs.writeFileSync(fullPath, html, 'utf8');
  return fullPath;
}

function buildHtml(ctx) {
  const { session, startMs, endMs, duration, risk, review, notes = [], transcripts, flags, audioChunks, totalResponses } = ctx;
  const riskCls = review.reviewBand === 'high_priority_review' ? 'high' : review.reviewBand === 'review' ? 'med' : 'low';
  const scorableTranscripts = transcripts.filter(item => item.scorable !== false);
  const abstainedTranscripts = transcripts.length - scorableTranscripts.length;
  const patternRows = `
    <div class="entry">
      <div class="entry-head"><span class="score ${review.transcriptEligible ? 'low' : 'unk'}">${review.transcriptEligible ? 'ELIGIBLE' : 'ABSTAINED'}</span></div>
      <div class="entry-text">${esc(review.transcriptEligible ? 'Transcript-pattern analysis had enough context to contribute advisory evidence.' : 'Transcript-pattern analysis abstained until enough reliable words and responses are available.')}</div>
      <div class="reasoning">Scorable windows: ${esc(scorableTranscripts.length)} | Short or low-confidence fragments: ${esc(abstainedTranscripts)} | Transcript-only score cannot override behavioral evidence.</div>
    </div>
    <div class="entry">
      <div class="entry-head"><span class="score low">MODEL BOUNDARY</span></div>
      <div class="entry-text">Transcript signals are advisory. Generic phrasing by itself does not create a high-priority review without direct AI artifacts or behavioral correlation.</div>
    </div>`;

  const transcriptRows = transcripts.length
    ? transcripts.map(t => `
      <div class="entry">
        <div class="entry-head">
          <span class="time">${fmtTime(t.timestamp)}</span>
          <span class="score ${t.scorable === false ? 'unk' : 'low'}">${t.scorable === false ? 'Pattern analysis abstained' : 'Pattern evidence recorded'}</span>
        </div>
        <div class="entry-text">${esc(t.text)}</div>
        ${t.reasoning ? `<div class="reasoning">${esc(t.reasoning)}${t.responseWindowWordCount ? ` | Window words: ${esc(t.responseWindowWordCount)}` : ''}</div>` : ''}
        ${t.flags && t.flags.length ? `<div class="sub-flags">${t.flags.map(f => `<span class="chip">${esc(f)}</span>`).join('')}</div>` : ''}
      </div>`).join('')
    : '<div class="empty">No transcripts were captured during this session.</div>';

  const flagRows = flags.length
    ? flags.map(f => `
      <tr>
        <td class="mono">${fmtTime(f.timestamp)}</td>
        <td><span class="sev ${esc(f.severity || 'medium')}">${esc((f.severity || 'medium').toUpperCase())}</span></td>
        <td>${esc(evidenceDetail(f))}</td>
      </tr>`).join('')
    : '<tr><td colspan="3" class="empty">No anomalies recorded.</td></tr>';

  const audioRows = audioChunks && audioChunks.length
    ? audioChunks.map(chunk => `
      <tr>
        <td class="mono">${fmtTime(chunk.timestamp)}</td>
        <td>${esc(String((chunk.sequence || 0) + 1))}</td>
        <td><span class="sev ${esc(chunk.status === 'failed' ? 'high' : chunk.status === 'transcribed' ? 'low' : 'medium')}">${esc(String(chunk.status || 'received').toUpperCase())}</span></td>
        <td>${chunk.durationMs ? esc(Math.round(chunk.durationMs / 1000) + 's') : '—'}</td>
        <td>${chunk.transcript ? esc(chunk.transcript) : '<span style="color:rgba(255,255,255,.3)">No clear transcript</span>'}</td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="empty">No audio chunks were captured.</td></tr>';
  const noteRows = notes.length
    ? notes.map(note => `<div class="entry"><div class="entry-head"><span class="time">${fmtTime(note.createdAt)}</span>${note.bookmarkedAt ? '<span class="score low">BOOKMARK</span>' : ''}</div><div class="entry-text">${esc(note.note)}</div></div>`).join('')
    : '<div class="empty">No interviewer notes were added.</div>';
  const correlationRows = review.correlations?.length
    ? review.correlations.map(item => `
      <div class="entry">
        <div class="entry-head"><span class="time">${fmtTime(item.occurredAt)}</span><span class="score med">${esc(item.target)}</span></div>
        <div class="entry-text">The next recorded response began ${esc(item.secondsUntilResponse)} seconds later.</div>
        ${item.transcriptPreview ? `<div class="reasoning">${esc(item.transcriptPreview)}</div>` : ''}
      </div>`).join('')
    : '<div class="empty">No restricted-destination event could be correlated with a later response.</div>';
  const counterRows = review.counterEvidence?.length
    ? review.counterEvidence.map(item => `<div class="entry"><div class="entry-text">${esc(item)}</div></div>`).join('')
    : '<div class="empty">No counter-evidence was strong enough to add to the report.</div>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Truveil Report — ${esc(session.candidateName)} — ${esc(session.sessionId)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #080808; color: #f7f7f5; font-family: 'Inter', sans-serif; line-height: 1.55; padding: 56px 32px; -webkit-font-smoothing: antialiased; }
  .container { max-width: 1040px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 28px; border-bottom: 1px solid rgba(255,255,255,.08); margin-bottom: 40px; }
  .logo { font-size: 20px; font-weight: 800; color: #fff; }
  .tag { display: inline-block; margin-top: 6px; font-size: 10px; color: rgba(255,255,255,.3); letter-spacing: 1.5px; text-transform: uppercase; font-weight: 600; }
  .sid { text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: rgba(255,255,255,.5); }
  h1 { font-size: 52px; font-weight: 760; letter-spacing: -2px; line-height: 1.02; margin-bottom: 12px; }
  .sub-title { font-size: 15px; color: rgba(255,255,255,.5); margin-bottom: 40px; }
  .risk-banner { display: flex; align-items: center; gap: 24px; padding: 30px 32px; border-radius: 10px; margin-bottom: 40px; border: 1px solid rgba(255,255,255,.1); background: #101010; }
  .risk-banner.high { border-color: rgba(255,81,71,.45); }
  .risk-banner.med { border-color: rgba(255,154,92,.3); }
  .risk-banner.low { border-color: rgba(255,255,255,.1); }
  .risk-dial { width: 96px; height: 96px; position: relative; flex-shrink: 0; }
  .risk-dial svg { transform: rotate(-90deg); width: 100%; height: 100%; }
  .risk-dial .bg { fill: none; stroke: rgba(255,255,255,.05); stroke-width: 6; }
  .risk-dial .fill { fill: none; stroke-width: 6; stroke-linecap: round; filter: drop-shadow(0 0 6px currentColor); }
  .risk-banner.high .fill { stroke: #ff5147; color: #ff5147; }
  .risk-banner.med .fill { stroke: #ff9a5c; color: #ff9a5c; }
  .risk-banner.low .fill { stroke: #a3a3a3; color: #a3a3a3; }
  .risk-dial .pct { position: absolute; inset: 0; display: grid; place-items: center; font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -.5px; }
  .risk-info h2 { font-size: 20px; font-weight: 700; margin-bottom: 4px; letter-spacing: -.3px; }
  .risk-info p { font-size: 13px; color: rgba(255,255,255,.5); }
  .grid4 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; margin-bottom: 40px; }
  .stat { padding: 20px 22px; background: #101010; border: 1px solid rgba(255,255,255,.09); border-radius: 8px; }
  .stat-label { font-size: 10px; font-weight: 700; color: rgba(255,255,255,.35); letter-spacing: 1.3px; text-transform: uppercase; margin-bottom: 8px; }
  .stat-val { font-size: 24px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -.5px; }
  h3 { font-size: 13px; font-weight: 700; letter-spacing: 1.5px; color: rgba(255,255,255,.4); text-transform: uppercase; margin: 48px 0 18px; }
  .panel { background: #0e0e0e; border: 1px solid rgba(255,255,255,.09); border-radius: 8px; padding: 24px; }
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
  .reasoning { font-size: 12px; color: rgba(255,255,255,.62); margin-top: 10px; padding: 10px 14px; background: rgba(255,255,255,.025); border: 1px solid rgba(255,255,255,.08); border-radius: 5px; line-height: 1.55; }
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
    .logo { color: #111; }
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
      <div class="risk-info">
        <h2>${esc(review.displayBand)}</h2>
        <p>${esc(review.summary)}</p>
        <p>${esc(review.evidence.join(' | ') || 'No meaningful behavioral evidence was recorded.')}</p>
      </div>
    </div>

    <div class="grid4">
      <div class="stat"><div class="stat-label">Review Band</div><div class="stat-val">${esc(review.displayBand)}</div></div>
      <div class="stat"><div class="stat-label">Transcript Context</div><div class="stat-val">${review.transcriptEligible ? 'Eligible' : 'Abstained'}</div></div>
      <div class="stat"><div class="stat-label">AI Tool Events</div><div class="stat-val">${risk.behavior.aiToolHits}</div></div>
      <div class="stat"><div class="stat-label">Responses</div><div class="stat-val">${totalResponses}</div></div>
      <div class="stat"><div class="stat-label">Flags</div><div class="stat-val">${flags.length}</div></div>
    </div>

    <h3>Transcript Pattern Context</h3>
    <div class="panel">${patternRows}</div>

    <h3>Response Analysis</h3>
    <div class="panel">${transcriptRows}</div>

    <h3>Behavioral Evidence</h3>
    <div class="panel" style="padding:0">
      <table>
        <thead><tr><th style="width:110px">TIME</th><th style="width:110px">SEVERITY</th><th>DETAIL</th></tr></thead>
        <tbody>${flagRows}</tbody>
      </table>
    </div>

    <h3>Interviewer notes and bookmarks</h3>
    <div class="panel">${noteRows}</div>

    <h3>Correlated Moments</h3>
    <div class="panel">${correlationRows}</div>

    <h3>Counter-Evidence</h3>
    <div class="panel">${counterRows}</div>

    <h3>Transcription health timeline</h3>
    <div class="panel" style="padding:0">
      <table>
        <thead><tr><th style="width:110px">TIME</th><th style="width:80px">SIGNAL</th><th style="width:130px">STATUS</th><th style="width:90px">LENGTH</th><th>TRANSCRIPT</th></tr></thead>
        <tbody>${audioRows}</tbody>
      </table>
    </div>

    <footer>
      Generated by Truveil Command Center · ${fmtDate(Date.now())}<br>
      This report is advisory evidence for human review. It is not an automated hiring decision.
    </footer>
  </div>
</body>
</html>`;
}

module.exports = { generate, sessionRiskSummary, behavioralEvidence, buildHtml };
