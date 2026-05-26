const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const WHISPER_CPP_VERSION = '1.5.5';
const WHISPER_MODEL = 'tiny.en';

function getExecutablePath(modulePath) {
  return String(modulePath || '').replace('app.asar', 'app.asar.unpacked');
}

function getWhisperExecutablePath(whisperPath) {
  return process.platform === 'win32'
    ? path.join(whisperPath, 'main.exe')
    : path.join(whisperPath, 'main');
}

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

class LocalTranscriber {
  constructor({ userDataPath, onStatus } = {}) {
    this.userDataPath = userDataPath;
    this.onStatus = onStatus || (() => {});
    this.whisperPath = path.join(userDataPath, 'whisper.cpp');
    this.workDir = path.join(userDataPath, 'audio-work');
    this.readyPromise = null;
    this.queue = Promise.resolve();
    this.lastProgressMessage = '';
    this.lastProgressAt = 0;
    fs.mkdirSync(this.workDir, { recursive: true });
  }

  emitStatus(status) {
    const progressKey = `${status.state}:${Math.round((status.progress || 0) * 100)}`;
    if (status.state === 'downloading-model' && progressKey === this.lastProgressMessage && Date.now() - this.lastProgressAt < 1000) {
      return;
    }
    this.lastProgressMessage = progressKey;
    this.lastProgressAt = Date.now();
    this.onStatus({
      engine: 'whisper.cpp',
      model: WHISPER_MODEL,
      ...status,
      timestamp: Date.now()
    });
  }

  async loadTools() {
    return import('@remotion/install-whisper-cpp');
  }

  async ensureReady() {
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = (async () => {
      const { installWhisperCpp, downloadWhisperModel } = await this.loadTools();
      const executablePath = getWhisperExecutablePath(this.whisperPath);
      if (fs.existsSync(this.whisperPath) && !fs.existsSync(executablePath)) {
        fs.rmSync(this.whisperPath, { recursive: true, force: true });
      }

      this.emitStatus({ state: 'installing', message: 'Preparing local speech engine' });
      await installWhisperCpp({
        to: this.whisperPath,
        version: WHISPER_CPP_VERSION,
        printOutput: false
      });

      this.emitStatus({ state: 'downloading-model', message: 'Downloading local tiny English model' });
      await downloadWhisperModel({
        model: WHISPER_MODEL,
        folder: this.whisperPath,
        printOutput: false,
        onProgress: (downloadedBytes, totalBytes) => {
          const progress = totalBytes ? downloadedBytes / totalBytes : 0;
          this.emitStatus({
            state: 'downloading-model',
            progress,
            message: `Downloading local speech model ${Math.round(progress * 100)}%`
          });
        }
      });

      this.emitStatus({ state: 'ready', message: 'Local speech engine ready' });
    })().catch((error) => {
      this.readyPromise = null;
      this.emitStatus({ state: 'error', message: error.message });
      throw error;
    });

    return this.readyPromise;
  }

  async convertToWav(inputPath, chunkId) {
    const executable = getExecutablePath(ffmpegPath);
    if (!executable || !fs.existsSync(executable)) {
      throw new Error('Local ffmpeg binary was not found.');
    }

    const wavPath = path.join(this.workDir, `${chunkId}.wav`);
    await execFileAsync(executable, [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-f',
      'wav',
      wavPath
    ], { windowsHide: true, timeout: 45000 });
    return wavPath;
  }

  async transcribeNow(inputPath, metadata = {}) {
    await this.ensureReady();
    const { transcribe } = await this.loadTools();
    const chunkId = metadata.chunkId || path.basename(inputPath, path.extname(inputPath));
    const wavPath = await this.convertToWav(inputPath, chunkId);

    try {
      this.emitStatus({ state: 'transcribing', message: `Transcribing chunk ${metadata.sequence ?? ''}`.trim() });
      const result = await transcribe({
        inputPath: wavPath,
        whisperPath: this.whisperPath,
        whisperCppVersion: WHISPER_CPP_VERSION,
        model: WHISPER_MODEL,
        tokenLevelTimestamps: false,
        language: 'en',
        splitOnWord: true,
        printOutput: false,
        tokensPerItem: 32
      });

      const text = (result.transcription || [])
        .map(item => String(item.text || '').trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      this.emitStatus({ state: 'ready', message: 'Local speech engine ready' });
      return { ok: true, text, raw: result };
    } finally {
      fs.rm(wavPath, { force: true }, () => {});
    }
  }

  transcribeQueued(inputPath, metadata = {}) {
    const run = () => this.transcribeNow(inputPath, metadata);
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }
}

module.exports = { LocalTranscriber, WHISPER_MODEL };
