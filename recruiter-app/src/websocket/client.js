const WebSocket = require('ws');
const { EventEmitter } = require('events');

class WSClient extends EventEmitter {
  constructor(sessionId, role) {
    super();
    this.url = `${process.env.BACKEND_WS_URL}?session=${sessionId}&role=${role}`;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnects = 5;
    this.connect();
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.on('open', () => {
      console.log('[WS] Connected to Truveil backend');
      this.reconnectAttempts = 0;
      this.emit('connected');
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        this.emit(msg.type, msg.data || msg);
      } catch {}
    });

    this.ws.on('close', () => {
      if (this.reconnectAttempts < this.maxReconnects) {
        const delay = 2000 * (this.reconnectAttempts + 1);
        console.log(`[WS] Reconnecting in ${delay}ms...`);
        setTimeout(() => {
          this.reconnectAttempts++;
          this.connect();
        }, delay);
      }
    });

    this.ws.on('error', (err) => console.error('[WS Error]', err.message));
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ ...data, timestamp: Date.now() }));
    }
  }

  close() {
    this.maxReconnects = 0;
    this.ws?.close();
  }
}

module.exports = WSClient;
