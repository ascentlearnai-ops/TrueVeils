'use strict';

function check(condition, message = 'Invalid demo metadata.') {
  if (!condition) throw new Error(message);
}
function object(value) { check(value !== null && typeof value === 'object' && !Array.isArray(value)); return value; }
function text(value, max, empty = false) {
  check(typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
  return value.trim();
}
function bool(value) { check(typeof value === 'boolean'); return value; }
function number(value, max = Number.MAX_SAFE_INTEGER) { check(Number.isFinite(value) && value >= 0 && value <= max); return value; }
function integer(value) { check(Number.isSafeInteger(value) && value >= 0); return value; }
function tabId(value) {
  if (typeof value === 'number') return integer(value);
  check(typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value), 'Invalid tab id.');
  return value;
}
function revision(value) { return typeof value === 'string' ? text(value, 80) : integer(value); }
function list(value, max, fn) { check(Array.isArray(value) && value.length <= max); return value.map(fn); }
function hostname(value) {
  if (value === '') return '';
  check(typeof value === 'string' && value.length <= 253 && /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(value), 'Invalid hostname; URLs and paths are not allowed.');
  return value.toLowerCase();
}
function fields(value, schema) {
  object(value);
  const result = {};
  for (const [key, fn] of Object.entries(schema)) if (value[key] !== undefined && value[key] !== null) result[key] = fn(value[key]);
  return result;
}

function sanitizeDetails(value = {}, previous = {}) {
  const result = { ...previous, ...fields(value, {
    candidateName: v => text(v, 100), role: v => text(v, 120), policyPreset: v => text(v, 64),
    technicalVocabulary: v => list(v, 100, item => text(item, 80)),
    policy: v => fields(v, {
      allowed_apps: a => list(a, 64, s => text(s, 80)),
      allowed_sites: a => list(a, 64, s => text(s, 253)),
      blocked_sites: a => list(a, 64, s => text(s, 253)),
      blocking_mode: mode => { check(['warn_refocus', 'warn', 'observe', 'none'].includes(mode), 'Unsupported demo policy mode.'); return mode; }
    })
  }) };
  result.policy ||= {};
  result.technicalVocabulary ||= [];
  return result;
}

function reviewConsent(value) {
  if (typeof value === 'boolean') return value;
  object(value);
  check(value.version === 'external-review-v1', 'Invalid review consent version.');
  return bool(value.enabled);
}
function sanitizeJoin(value) {
  object(value);
  check(typeof value.code === 'string' && /^DEMO-[A-Z2-7]{16}$/.test(value.code), 'Demo room unavailable.');
  check(value.consentConfirmed === true && value.microphoneReady === true, 'Candidate consent and microphone readiness are required.');
  return {
    code: value.code, name: text(value.name, 100), consentConfirmed: true, microphoneReady: true,
    externalReviewConsent: value.externalReviewConsent === undefined ? false : reviewConsent(value.externalReviewConsent),
    tabObserveConsent: value.tabObserveConsent === undefined ? false : bool(value.tabObserveConsent),
    tabCloseConsent: value.tabCloseConsent === undefined ? false : bool(value.tabCloseConsent)
  };
}

function sanitizeTabs(value) {
  object(value);
  const state = {
    connected: bool(value.connected), observeConsent: bool(value.observeConsent), closeConsent: bool(value.closeConsent),
    tabs: list(value.tabs || [], 128, tab => {
      object(tab);
      const host = hostname(tab.hostname);
      const protectedByDefault = !host || ['meet.google.com', 'zoom.us', 'teams.microsoft.com', 'teams.live.com', 'webex.com'].some(domain => host === domain || host.endsWith(`.${domain}`));
      return { id: tabId(tab.id), hostname: host, active: bool(tab.active), protected: bool(tab.protected) || protectedByDefault, revision: revision(tab.revision) };
    }),
    events: list(value.events || [], 64, item => {
      object(item);
      check(typeof item.kind === 'string' && /^[a-z_]{1,48}$/.test(item.kind), 'Invalid browser event kind.');
      return { kind: item.kind, ...fields(item, { hostname, id: tabId, revision, timestamp: number, sequence: integer }) };
    })
  };
  check(new Set(state.tabs.map(tab => tab.id)).size === state.tabs.length, 'Duplicate tab id.');
  if (!state.connected || !state.observeConsent) { state.tabs = []; state.events = []; }
  return state;
}

function transcript(value) {
  object(value);
  const result = fields(value, {
    text: v => text(v, 16000, true), interim: bool, captionClear: bool, confidenceKnown: bool,
    sequence: integer, revision: integer, streamEpoch: integer, utteranceId: integer, wordCount: integer,
    durationMs: v => number(v, 1800000), startedAt: number, endedAt: number,
    segmentId: v => text(v, 240), captionStreamId: v => text(v, 120),
    finalReason: v => text(v, 80), source: v => text(v, 80), qualityReason: v => text(v, 80),
    transcriptConfidence: v => number(v, 1), lowConfidenceWordRatio: v => number(v, 1), rms: v => number(v, 1), peak: v => number(v, 1)
  });
  check(typeof result.text === 'string', 'Transcript text required.');
  return { ...result, type: 'candidate_transcript' };
}

const CANDIDATE_EVENTS = new Set([
  'candidate_ready', 'candidate_review_consent', 'provider_review_consent_withdrawn', 'candidate_interrupted', 'session_ended_remote',
  'candidate_connected', 'candidate_completed', 'candidate_cancelled', 'focus_lost', 'focus_gained',
  'shortcut_blocked', 'foreground_changed', 'overlay_detected', 'blocking_warning',
  'browser_tabs', 'browser_tab_close_result'
]);
function candidateEvent(value) {
  object(value);
  check(CANDIDATE_EVENTS.has(value.type), 'Unsupported candidate event.');
  const result = { type: value.type, ...fields(value, {
    severity: v => { check(['low', 'medium', 'high'].includes(v)); return v; },
    consentConfirmed: bool, microphoneReady: bool, privacyVersion: v => text(v, 64),
    externalReviewConsent: v => ({ version: 'external-review-v1', enabled: reviewConsent(v) }),
    hostname, app: v => text(v, 100), processName: v => text(v, 100),
    reason: v => text(v, 120)
  }) };
  if (value.type === 'provider_review_consent_withdrawn') result.externalReviewConsent = { version: 'external-review-v1', enabled: false };
  if (value.type === 'browser_tabs') result.state = sanitizeTabs(value.state);
  if (value.type === 'browser_tab_close_result') {
    result.commandId = text(value.commandId, 80);
    object(value.result);
    check(typeof value.result.status === 'string' && /^[a-z_-]{1,40}$/.test(value.result.status), 'Invalid command result.');
    result.result = { status: value.result.status, ...fields(value.result, { hostname, id: tabId, revision }) };
  }
  return result;
}

function closeCommand(value) {
  object(value);
  check(value.action === 'close_tab', 'Unsupported demo action; only close_tab is supported.');
  check(typeof value.commandId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.commandId), 'A UUID commandId is required.');
  object(value.target);
  return { action: 'close_tab', commandId: value.commandId.toLowerCase(), target: { id: tabId(value.target.id), revision: revision(value.target.revision) } };
}

module.exports = { check, object, sanitizeDetails, sanitizeJoin, transcript, candidateEvent, closeCommand, number };
