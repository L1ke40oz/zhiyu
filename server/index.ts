import http from 'node:http';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { openDatabase } from './db.ts';
import { createApp } from './app.ts';
import { attachParty } from './party.ts';
import { stopOCR } from './services/documents.ts';

const db = openDatabase();
const { app } = createApp(db);
const publicRoot = path.resolve(
  !process.argv.includes('--dev') && fs.existsSync('dist/index.html') ? 'dist' : 'public',
);
app.get('/party/host', (_req, res) => res.sendFile(path.join(publicRoot, 'party', 'host.html')));
app.use(express.static(publicRoot, { index: 'index.html', dotfiles: 'deny' }));
if (fs.existsSync(path.join(publicRoot, 'index.html')))
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(publicRoot, 'index.html')));
const server = http.createServer(app);
const party = attachParty(server);
server.listen(config.port, config.host, () =>
  console.log(`[知屿] http://localhost:${config.port} · 数据目录 ${config.dataDir}`),
);
async function shutdown() {
  party.close();
  server.close();
  await stopOCR().catch(() => {});
  db.close();
  process.exit(0);
}
process.once('SIGINT', () => {
  void shutdown();
});
process.once('SIGTERM', () => {
  void shutdown();
});
