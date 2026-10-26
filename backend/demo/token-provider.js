'use strict';

function validateToken(value) {
  if (!value || typeof value.accessToken !== 'string' || !value.accessToken || value.accessToken.length > 8192 ||
      !Number.isInteger(value.expiresIn) || value.expiresIn < 1 || value.expiresIn > 30) {
    throw new Error('Transcription provider returned an invalid temporary token.');
  }
  return { accessToken: value.accessToken, expiresIn: value.expiresIn };
}

function createDeepgramTokenProvider({ apiKey = process.env.DEEPGRAM_API_KEY, fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  if (!apiKey) return null;
  return async ({ signal } = {}) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
      const response = await fetchImpl('https://api.deepgram.com/v1/auth/grant', {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl_seconds: 30 })
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error('provider'); }
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 16384) { await reader.cancel(); throw new Error('provider'); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      if (controller.signal.aborted) throw new Error('aborted');
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      return validateToken({ accessToken: value.access_token, expiresIn: value.expires_in });
    } catch {
      throw new Error(controller.signal.aborted ? 'Transcription provider timeout or cancelled request.' : 'Transcription provider unavailable.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };
}

module.exports = { createDeepgramTokenProvider, validateToken };
