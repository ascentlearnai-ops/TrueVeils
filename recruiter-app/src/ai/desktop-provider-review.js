const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const dotenv = require('dotenv');

const CONSENT_VERSION = 'external-review-v1';
function reviewError(code) { const error = new Error(code); error.code = code; return error; }
function requireState(condition, code) { if (!condition) throw reviewError(code); }

class DesktopProviderReview {
  constructor({ getOwner, appPath, userDataPath, environment = process.env, engineModule, fetchImpl, getEnvFile = () => '' }) {
    this.getOwner = getOwner;
    this.appPath = appPath;
    this.userDataPath = userDataPath;
    this.environment = environment;
    this.module = engineModule;
    this.fetchImpl = fetchImpl;
    this.getEnvFile = getEnvFile;
    this.capture = null;
    this.controller = null;
    this.busy = false;
  }

  loadModule() { return this.module ||= require('./provider-review-engine.cjs'); }

  credentials() {
    // Owner-managed files are outside the installer. No secrets enter runtime-config or IPC.
    const shared = path.resolve(this.appPath, '../../environment/.env');
    const file = this.environment.TRUVEIL_REVIEW_ENV_FILE || this.getEnvFile() || (fs.existsSync(shared) ? shared : path.join(this.userDataPath, 'provider-review.env'));
    let saved = {};
    try { saved = dotenv.parse(fs.readFileSync(file)); } catch {}
    const adjacentSystem = path.resolve(path.dirname(file), '../ai-review-system');
    let sharedLedger = false;
    try { sharedLedger = JSON.parse(fs.readFileSync(path.join(adjacentSystem, 'package.json'), 'utf8')).name === 'truveil-ai-review-system'; } catch {}
    return { pangramKey: this.environment.PANGRAM_API_KEY || saved.PANGRAM_API_KEY,
      openRouterKey: this.environment.OPENROUTER_API_KEY || saved.OPENROUTER_API_KEY,
      ledger: sharedLedger ? path.join(adjacentSystem, '.state') : path.join(this.userDataPath, 'provider-review-state') };
  }

  session() {
    const owner = this.getOwner();
    requireState(owner?.startedAt && !owner.endedAt && owner.candidateReady && owner.telemetry?.connected !== false, 'ACTIVE_CONNECTED_SESSION_REQUIRED');
    requireState(owner.externalReviewConsent?.version === CONSENT_VERSION && owner.externalReviewConsent.enabled === true, 'CANDIDATE_PROVIDER_CONSENT_REQUIRED');
    return owner;
  }

  status() {
    const keys = this.credentials();
    const owner = this.getOwner();
    return { configured: { pangram: Boolean(keys.pangramKey), sol: Boolean(keys.openRouterKey) },
      activeConnected: Boolean(owner?.startedAt && !owner.endedAt && owner.candidateReady && owner.telemetry?.connected !== false),
      candidateConsented: owner?.externalReviewConsent?.version === CONSENT_VERSION && owner.externalReviewConsent.enabled === true,
      stage: this.capture?.owner === owner ? this.capture.stage : 'idle', busy: this.busy,
      preview: this.capture?.owner === owner && this.capture.stage === 'finalized' ? this.capture.text : '',
      wordCount: this.capture?.owner === owner ? this.capture.wordCount || 0 : 0 };
  }

  async checkConnections() {
    const keys = this.credentials();
    const providers = new (this.loadModule().Providers)({ ...keys, ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}) });
    const check = async run => { try { await run(); return { available: true }; } catch (error) {
      return { available: false, reason: /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'CONNECTION_CHECK_FAILED' };
    } };
    return { pangram: await check(() => providers.discoverPangram()), sol: await check(() => providers.verifySolPricing()),
      creditsVerified: false, note: 'Model access checked without submitting interview text. Credit balance is not checked.' };
  }

  begin() {
    requireState(!this.busy && !this.capture, 'FINISH_OR_DISCARD_CURRENT_ANSWER');
    const owner = this.session();
    this.capture = { owner, id: randomUUID(), stage: 'capturing', before: new Set(owner.transcripts), startedAt: Date.now() };
    return this.status();
  }

  finish() {
    const owner = this.session();
    requireState(this.capture?.owner === owner && this.capture.stage === 'capturing', 'START_AN_ANSWER_FIRST');
    const entries = owner.transcripts.filter(entry => !this.capture.before.has(entry) && !entry.interim && entry.text);
    requireState(entries.length > 0 && entries.length <= 500, 'NO_FINAL_CAPTIONS_IN_ANSWER');
    const text = entries.map(entry => entry.text).join(' ');
    requireState(Buffer.byteLength(text) <= 24000, 'ANSWER_TOO_LONG');
    const counts = entries.map(entry => entry.transcriptConfidence);
    this.capture = { ...this.capture, stage: 'finalized', text, wordCount: this.loadModule().wordCount(text),
      confidence: counts.every(n => Number.isFinite(n) && n >= 0 && n <= 1) ? Math.min(...counts) : null,
      hasGaps: entries.some(e => e.qualityReason || (e.lowConfidenceWordRatio != null && e.lowConfidenceWordRatio > 0.1)),
      fallback: entries.some(e => !/^deepgram-nova-3-(?:direct|live)$/.test(e.source || '')) };
    return this.status();
  }

  cancel() {
    this.controller?.abort();
    this.capture = null;
    return this.status();
  }

  async review({ singleAnswerConfirmed, providerPrivacyReviewed } = {}) {
    const owner = this.session();
    requireState(!this.busy && this.capture?.owner === owner && this.capture.stage === 'finalized', 'FINALIZE_AN_ANSWER_FIRST');
    requireState(singleAnswerConfirmed === true && providerPrivacyReviewed === true, 'ANSWER_AND_PRIVACY_CONFIRMATION_REQUIRED');
    const capture = this.capture;
    this.busy = true;
    this.controller = new AbortController();
    const keys = this.credentials();
    const { Providers, ReviewStore, ReviewEngine } = this.loadModule();
    const stillAllowed = () => this.capture === capture && this.getOwner() === owner && !owner.endedAt &&
      owner.candidateReady && owner.telemetry?.connected !== false && owner.externalReviewConsent?.enabled === true;
    try {
      const providers = new Providers({ ...keys, signal: this.controller.signal, requestAllowed: stillAllowed,
        ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}) });
      const engine = new ReviewEngine({ store: new ReviewStore(keys.ledger, { pangram: 8_000_000, openrouter: 25_000_000 }), providers });
      const result = await engine.review({ responseId: capture.id, text: capture.text, language: 'en', origin: 'speech',
        dataUse: 'private', finalized: true, singleResponse: true, externalProcessingConsent: true, pangramRetentionAccepted: true,
        allowExperimentalSpeech: true, transcriptionConfidence: capture.confidence,
        transcriptionHasGaps: capture.hasGaps, transcriptionHadFallback: capture.fallback });
      requireState(stillAllowed(), 'REVIEW_CANCELLED');
      owner.providerReviews ||= [];
      const review = { ...result, reviewedAt: Date.now(), text: capture.text };
      owner.providerReviews.push(review);
      this.capture = null;
      return review;
    } finally { this.busy = false; this.controller = null; }
  }
}

module.exports = { DesktopProviderReview, CONSENT_VERSION };
