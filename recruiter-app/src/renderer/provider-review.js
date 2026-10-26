(() => {
  const api = window.truveil;
  const element = id => document.getElementById(id);
  if (!api?.getProviderReviewStatus || !element('providerReviewTitle')) return;
  let state = {}, pending = false, refreshId = 0;
  const labels = { review_suggested: 'Human review suggested', no_text_signal: 'No AI-text signal detected',
    uncertain_text_signal: 'Uncertain text signal', insufficient_evidence: 'Insufficient reliable evidence', provider_unavailable: 'Provider unavailable' };
  const messages = {
    CANDIDATE_PROVIDER_CONSENT_REQUIRED: 'The candidate has not permitted external review.',
    ACTIVE_CONNECTED_SESSION_REQUIRED: 'A connected, active interview is required.',
    NO_FINAL_CAPTIONS_IN_ANSWER: 'No finalized captions arrived in this answer. Continue speaking or discard it.',
    LOCAL_BUDGET_EXHAUSTED: 'The local review budget has been reached.',
    PANGRAM_PAYMENT_REQUIRED: 'The Pangram developer balance needs attention.',
    TOO_SHORT_FOR_REVIEW: 'At least 150 reliable words in one answer are required.',
    TRANSCRIPTION_UNCERTAIN: 'Speech confidence is missing or too low for external review.',
    TRANSCRIPT_HAS_GAPS_OR_FALLBACK: 'The selected transcript contains gaps or fallback recognition.',
    REVIEW_CANCELLED: 'Review stopped because the interview or permission changed.',
    MISSING_PROVIDER_KEY: 'A provider key is missing. Connect your saved key file.',
    ANSWER_AND_PRIVACY_CONFIRMATION_REQUIRED: 'Confirm the answer boundary and provider privacy review first.'
  };
  const explanation = code => messages[code] || 'Review could not complete. Check the connection, permission and configured budget.';

  function render() {
    const configured = state.configured?.pangram && state.configured?.sol;
    element('providerConnectionStatus').textContent = configured ? 'Pangram and Sol keys are connected locally.' : 'Provider keys are not both configured.';
    const capturing = state.stage === 'capturing', finalized = state.stage === 'finalized';
    element('providerAnswerStatus').textContent = pending || state.busy ? 'Review request in progress...'
      : capturing ? 'Collecting finalized captions for this answer.'
        : finalized ? `${state.wordCount} words selected for review.`
          : !state.candidateConsented ? 'Candidate permission is required before external review.'
            : state.activeConnected ? 'Ready to select one answer.' : 'Waiting for an active, connected interview.';
    element('startProviderAnswerBtn').disabled = pending || state.busy || !configured || !state.candidateConsented || !state.activeConnected || state.stage !== 'idle';
    element('finishProviderAnswerBtn').disabled = pending || !capturing;
    element('discardProviderAnswerBtn').disabled = pending || state.stage === 'idle';
    element('checkProviderConnectionsBtn').disabled = pending;
    element('connectProviderFileBtn').disabled = pending;
    element('providerReviewConfirmation').hidden = !finalized;
    element('providerAnswerPreview').textContent = state.preview || '';
    element('runProviderReviewBtn').disabled = pending || !finalized || !element('providerSingleAnswerInput').checked || !element('providerPrivacyInput').checked;
  }
  async function refresh() {
    const id = ++refreshId;
    try { const next = await api.getProviderReviewStatus(); if (id === refreshId) { state = next; render(); } } catch {}
  }
  function showResult(result) {
    const host = element('providerReviewResult');
    host.textContent = '';
    const add = text => { const p = document.createElement('p'); p.textContent = text; host.appendChild(p); };
    add(labels[result.status] || 'Review complete');
    for (const reason of result.reasons || []) add(explanation(reason));
    const fractions = result.textClassification?.assignedTextFractions;
    if (fractions) add(`Pangram-assigned text: ${Math.round(fractions.ai * 100)}% AI-written, ${Math.round(fractions.assisted * 100)}% AI-assisted, ${Math.round(fractions.human * 100)}% human-written. These are text classifications, not cheating probabilities.`);
    for (const followUp of result.reviewAssistant?.followUps || []) add(followUp.text);
    if (result.reviewAssistant?.status === 'unavailable') add('Sol follow-up review is unavailable; the Pangram result is preserved.');
    if (result.budget) add(`Local reserved budgets: Pangram $${result.budget.pangram.reservedUsd.toFixed(2)} / $${result.budget.pangram.capUsd}; Sol $${result.budget.openrouter.reservedUsd.toFixed(2)} / $${result.budget.openrouter.capUsd}. Reservations are not invoices.`);
    add('Experimental speech-text review. A person must review the context; detection accuracy has not been measured on this interview.');
  }
  async function act(run, resultHandler) {
    if (pending) return;
    pending = true; render();
    try { const result = await run(); if (resultHandler) resultHandler(result); }
    catch (error) {
      const code = Object.keys(messages).find(key => String(error.message).includes(key));
      element('providerReviewResult').textContent = explanation(code);
    } finally { pending = false; await refresh(); }
  }
  element('checkProviderConnectionsBtn').addEventListener('click', () => act(() => api.checkProviderConnections(), result => {
    element('providerReviewResult').textContent = `Pangram: ${result.pangram.available ? 'model available' : explanation(result.pangram.reason)}. Sol: ${result.sol.available ? 'model available' : explanation(result.sol.reason)}. Credit balances are not checked.`;
  }));
  element('connectProviderFileBtn').addEventListener('click', () => act(() => api.connectProviderKeyFile()));
  element('startProviderAnswerBtn').addEventListener('click', () => act(() => api.beginProviderAnswer(), () => {
    element('providerReviewResult').textContent = '';
    element('providerSingleAnswerInput').checked = false;
    element('providerPrivacyInput').checked = false;
  }));
  element('finishProviderAnswerBtn').addEventListener('click', () => act(() => api.finishProviderAnswer()));
  element('discardProviderAnswerBtn').addEventListener('click', () => act(() => api.discardProviderAnswer()));
  element('runProviderReviewBtn').addEventListener('click', () => act(() => api.reviewProviderAnswer({
    singleAnswerConfirmed: element('providerSingleAnswerInput').checked === true,
    providerPrivacyReviewed: element('providerPrivacyInput').checked === true
  }), showResult));
  for (const id of ['providerSingleAnswerInput', 'providerPrivacyInput']) element(id).addEventListener('change', render);
  api.onProviderReviewConsent?.(() => { element('providerReviewResult').textContent = ''; refresh(); });
  api.onRealtimeStatus?.(() => refresh());
  refresh();
})();
