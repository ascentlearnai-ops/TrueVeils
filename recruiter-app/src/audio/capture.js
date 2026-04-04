const { EventEmitter } = require('events');

class AudioCapture extends EventEmitter {
  constructor() {
    super();
    this.mediaRecorder = null;
    this.stream = null;
    this.intervalId = null;
    this.chunkInterval = 5000; // 5 second chunks for Whisper
  }

  async start() {
    // In Electron main process, we use desktopCapturer via renderer
    // This module is designed to be called from renderer context via preload
    // For main process, we send IPC to renderer to start capture

    // For system audio loopback capture in Electron:
    const { desktopCapturer } = require('electron');

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      fetchWindowIcons: false
    });

    // Note: actual getUserMedia must run in renderer process
    // This emits events that main.js handles
    this.emit('ready', sources);
  }

  // Called from renderer with audio buffer chunks
  processChunk(audioBuffer) {
    this.emit('chunk', audioBuffer);
  }

  stop() {
    clearInterval(this.intervalId);
    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.stop();
    }
    this.stream?.getTracks().forEach(t => t.stop());
  }
}

module.exports = AudioCapture;
