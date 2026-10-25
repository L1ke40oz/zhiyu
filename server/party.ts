import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { RoomManager } from './party/rooms.js';
import { config } from './config.ts';

export function attachParty(server: Server) {
  const rooms = new RoomManager();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const alive = new WeakMap<object, boolean>();
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== '/party/ws') {
      socket.destroy();
      return;
    }
    const origin = req.headers.origin;
    try {
      const allowedHost = config.publicOrigin ? new URL(config.publicOrigin).host : req.headers.host;
      if (!origin || new URL(origin).host !== allowedHost) throw new Error('origin mismatch');
    } catch {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    if (wss.clients.size >= 200) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      Object.assign(ws, { trustedOrigin: config.publicOrigin || origin });
      alive.set(ws, true);
      ws.on('pong', () => alive.set(ws, true));
      let count = 0,
        windowStart = Date.now();
      // Room messages are bounded and only use the actual origin for QR generation.
      ws.on('message', (raw) => {
        if (Date.now() - windowStart > 1000) {
          count = 0;
          windowStart = Date.now();
        }
        if (++count > 80) ws.close(1008, '消息过于频繁');
      });
      rooms.attach(ws);
      wss.emit('connection', ws, req);
    });
  });
  const timer = setInterval(() => {
    for (const client of wss.clients) {
      if (!alive.get(client)) {
        client.terminate();
        continue;
      }
      alive.set(client, false);
      client.ping();
    }
  }, 20000);
  timer.unref();
  return {
    rooms,
    close() {
      clearInterval(timer);
      for (const room of rooms.rooms.values()) room.dispose();
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
