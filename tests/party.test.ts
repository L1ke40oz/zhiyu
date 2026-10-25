import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { attachParty } from '../server/party.ts';

function peer(url: string, origin: string) {
  const ws = new WebSocket(url, { origin });
  const messages: Record<string, any>[] = [];
  const listeners = new Set<() => void>();
  ws.on('message', (raw) => {
    messages.push(JSON.parse(raw.toString()));
    for (const listener of listeners) listener();
  });
  return {
    ws,
    ready: new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    }),
    send(value: unknown) {
      ws.send(JSON.stringify(value));
    },
    wait(predicate: (message: Record<string, any>) => boolean, timeout = 6000) {
      return new Promise<Record<string, any>>((resolve, reject) => {
        const check = () => {
          const index = messages.findIndex(predicate);
          if (index < 0) return;
          const [message] = messages.splice(index, 1);
          clearTimeout(timer);
          listeners.delete(check);
          resolve(message);
        };
        const timer = setTimeout(() => {
          listeners.delete(check);
          reject(new Error('Party message timeout'));
        }, timeout);
        listeners.add(check);
        check();
      });
    },
  };
}
test('派对无需登录即可建房、加入、开始并结算一关；重连需要私有凭据', { timeout: 15000 }, async () => {
  const server = http.createServer((_req, res) => res.end('party test'));
  const party = attachParty(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const url = `${origin.replace('http:', 'ws:')}/party/ws`;
  const host = peer(url, origin),
    first = peer(url, origin),
    second = peer(url, origin),
    intruder = peer(url, origin);
  try {
    await Promise.all([host.ready, first.ready, second.ready, intruder.ready]);
    host.send({ t: 'host:create', origin: 'https://unrelated.invalid' });
    const room = await host.wait((message) => message.t === 'room');
    assert.match(room.code, /^[A-Z2-9]{4}$/);
    assert.equal(room.joinUrl, `${origin}/party/?room=${room.code}`);
    assert.match(room.qr, /<svg/);
    first.send({ t: 'join', code: room.code, name: '小海鸥' });
    second.send({ t: 'join', code: room.code, name: '小海风' });
    const joined = await first.wait((message) => message.t === 'joined');
    await second.wait((message) => message.t === 'joined');
    assert.equal(typeof joined.resumeToken, 'string');
    intruder.send({ t: 'join', code: room.code, pid: joined.pid, name: '假冒玩家' });
    assert.equal((await intruder.wait((message) => message.t === 'error')).code, 'invalid-player');
    const lobby = await host.wait((message) => message.t === 'lobby' && message.players.length === 2);
    assert.ok(lobby.players.every((player: Record<string, any>) => player.resumeToken === undefined));
    first.send({ t: 'host:start' });
    assert.equal(party.rooms.rooms.get(room.code).phase, 'lobby');
    host.send({ t: 'host:start' });
    const intro = await host.wait((message) => message.t === 'intro');
    assert.equal(intro.round, 1);
    await first.wait((message) => message.t === 'start');
    await second.wait((message) => message.t === 'start');
    first.send({ t: 'finish', round: 1, success: true, score: 0.95 });
    second.send({ t: 'finish', round: 1, success: false, score: 0.1 });
    const result = await host.wait((message) => message.t === 'result');
    assert.equal(result.ranking.length, 2);
    assert.equal(result.ranking[0].name, '小海鸥');
    assert.equal(result.ranking[0].gained, 5);
    first.ws.close();
    const resumed = peer(url, origin);
    await resumed.ready;
    resumed.send({
      t: 'join',
      code: room.code,
      pid: joined.pid,
      resumeToken: joined.resumeToken,
      name: joined.name,
    });
    assert.equal((await resumed.wait((message) => message.t === 'joined')).pid, joined.pid);
    resumed.ws.close();
  } finally {
    for (const client of [host, first, second, intruder]) client.ws.terminate();
    party.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
