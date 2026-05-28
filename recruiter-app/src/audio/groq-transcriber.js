const fs = require('fs');
const path = require('path');
const https = require('https');

const GROQ_TRANSCRIPT_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MODEL = 'whisper-large-v3-turbo';

function extToMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.ogg') return 'audio/ogg';
  return 'audio/webm';
}

function buildMultipartBody({ filePath, model }) {
  const boundary = `----truveil-groq-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  const filename = path.basename(filePath) || 'audio.webm';
  const file = fs.readFileSync(filePath);
  const chunks = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="temperature"\r\n\r\n0\r\n`),
    Buffer.from(
      `--${boundary}\r\n`
      + `Content-Disposition: form-data; name="file"; filename="${filename.replace(/"/g, '')}"\r\n`
      + `Content-Type: ${extToMime(filePath)}\r\n\r\n`
    ),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ];

  return {
    boundary,
    body: Buffer.concat(chunks)
  };
}

class GroqTranscriber {
  constructor({ apiKey, onStatus } = {}) {
    this.apiKey = apiKey || '';
    this.onStatus = onStatus || (() => {});
  }

  isConfigured() {
    return Boolean(this.apiKey && !this.apiKey.includes('dummy'));
  }

  emitStatus(status) {
    this.onStatus({
      engine: 'groq-whisper',
      model: GROQ_MODEL,
      ...status,
      timestamp: Date.now()
    });
  }

  async transcribe(inputPath, metadata = {}) {
    if (!this.isConfigured()) {
      throw new Error('Groq API key is not configured.');
    }
    if (!fs.existsSync(inputPath)) {
      throw new Error('Audio file was not found for Groq transcription.');
    }

    this.emitStatus({
      state: 'transcribing',
      message: `Groq fallback transcribing chunk ${Number(metadata.sequence || 0) + 1}`,
      chunkId: metadata.chunkId
    });

    const { boundary, body } = buildMultipartBody({ filePath: inputPath, model: GROQ_MODEL });
    const response = await new Promise((resolve, reject) => {
      const request = https.request(GROQ_TRANSCRIPT_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length
        },
        timeout: 45000
      }, (res) => {
        const parts = [];
        res.on('data', chunk => parts.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(parts).toString('utf8');
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(text || '{}'));
            } catch {
              reject(new Error('Groq returned an unreadable response.'));
            }
            return;
          }
          let message = `Groq transcription failed with HTTP ${res.statusCode}`;
          try {
            const parsed = JSON.parse(text || '{}');
            message = parsed.error?.message || parsed.message || message;
          } catch {}
          reject(new Error(message));
        });
      });

      request.on('timeout', () => request.destroy(new Error('Groq transcription timed out.')));
      request.on('error', reject);
      request.end(body);
    });

    const text = String(response.text || '').replace(/\s+/g, ' ').trim();
    this.emitStatus({ state: 'ready', message: 'Groq fallback ready', chunkId: metadata.chunkId });
    return { ok: true, text, raw: response };
  }
}

module.exports = { GroqTranscriber, GROQ_MODEL };
