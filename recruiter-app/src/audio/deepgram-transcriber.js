const fs = require('fs');
const path = require('path');
const https = require('https');

const DEEPGRAM_MODEL = 'nova-3';
const DEEPGRAM_ENDPOINT = `/v1/listen?model=${DEEPGRAM_MODEL}&language=en&smart_format=true&punctuate=true&filler_words=true`;

function extToMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.ogg') return 'audio/ogg';
  return 'audio/webm';
}

function extractTranscript(response) {
  const alternative = response?.results?.channels?.[0]?.alternatives?.[0];
  return String(alternative?.transcript || '').replace(/\s+/g, ' ').trim();
}

class DeepgramTranscriber {
  constructor({ apiKey, onStatus } = {}) {
    this.apiKey = apiKey || '';
    this.onStatus = onStatus || (() => {});
  }

  isConfigured() {
    return Boolean(this.apiKey && !this.apiKey.includes('dummy'));
  }

  emitStatus(status) {
    this.onStatus({
      engine: 'deepgram',
      model: DEEPGRAM_MODEL,
      ...status,
      timestamp: Date.now()
    });
  }

  async transcribe(inputPath, metadata = {}) {
    if (!this.isConfigured()) {
      throw new Error('Deepgram API key is not configured.');
    }
    if (!fs.existsSync(inputPath)) {
      throw new Error('Audio file was not found for Deepgram transcription.');
    }

    this.emitStatus({
      state: 'transcribing',
      message: `Deepgram fallback transcribing chunk ${Number(metadata.sequence || 0) + 1}`,
      chunkId: metadata.chunkId
    });

    const audio = fs.readFileSync(inputPath);
    const response = await new Promise((resolve, reject) => {
      const request = https.request({
        hostname: 'api.deepgram.com',
        path: DEEPGRAM_ENDPOINT,
        method: 'POST',
        headers: {
          Authorization: `Token ${this.apiKey}`,
          'Content-Type': extToMime(inputPath),
          'Content-Length': audio.length
        },
        timeout: 45000
      }, (res) => {
        const parts = [];
        res.on('data', chunk => parts.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(parts).toString('utf8');
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body || '{}'));
            } catch {
              reject(new Error('Deepgram returned an unreadable response.'));
            }
            return;
          }
          let message = `Deepgram transcription failed with HTTP ${res.statusCode}`;
          try {
            const parsed = JSON.parse(body || '{}');
            message = parsed.err_msg || parsed.message || parsed.error || message;
          } catch {}
          reject(new Error(message));
        });
      });

      request.on('timeout', () => request.destroy(new Error('Deepgram transcription timed out.')));
      request.on('error', reject);
      request.end(audio);
    });

    const text = extractTranscript(response);
    this.emitStatus({ state: 'ready', message: 'Deepgram fallback ready', chunkId: metadata.chunkId });
    return { ok: true, text, raw: response };
  }
}

module.exports = { DeepgramTranscriber, DEEPGRAM_MODEL };
