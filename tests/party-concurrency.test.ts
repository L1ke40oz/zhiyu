import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { attachParty } from '../server/party.ts';
import { config } from '../server/config.ts';

config.publicOrigin = '';
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
    messages,
    ready: new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    }),
    send(value: unknown) {
      ws.send(JSON.stringify(value));
    },
    wait(predicate: (value: Record<string, any>) => boolean, timeout = 10000) {
      return new Promise<Record<string, any>>((resolve, reject) => {
        const check = () => {
          const message = messages.find(predicate);
          if (!message) return;
          clearTimeout(timer);
          listeners.delete(check);
          resolve(message);
        };
        const timer = setTimeout(() => {
          listeners.delete(check);
          reject(new Error('Party concurrency message timeout'));
        }, timeout);
        listeners.add(check);
        check();
      });
    },
  };
}
async function fixture() {
  const server = http.createServer((_req, res) => res.end('party test'));
  const party = attachParty(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const clients: ReturnType<typeof peer>[] = [];
  return {
    party,
    connect() {
      const client = peer(`${origin.replace('http:', 'ws:')}/party/ws`, origin);
      clients.push(client);
      return client;
    },
    async close() {
      for (const client of clients) client.ws.terminate();
      party.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test(
  '未收到加入确认前连续重试只占一个席位；丢失确认后换连接仍复用身份且不能伪造恢复凭据',
  { timeout: 15000 },
  async () => {
    const f = await fixture();
    try {
      const host = f.connect(),
        player = f.connect();
      await Promise.all([host.ready, player.ready]);
      host.send({ t: 'host:create' });
      const room = await host.wait((m) => m.t === 'room');
      // Legacy clients without a joinKey must also be idempotent on the same socket.
      for (let n = 0; n < 6; n++) player.send({ t: 'join', code: room.code, name: '超级长名字测试测试测试' });
      const joined = await player.wait(
        (m) => m.t === 'joined' && player.messages.filter((item) => item.t === 'joined').length === 6,
      );
      assert.equal(new Set(player.messages.filter((m) => m.t === 'joined').map((m) => m.pid)).size, 1);
      const state = f.party.rooms.rooms.get(room.code);
      assert.equal(state.players.size, 1);
      assert.equal(Array.from(joined.name).length, 8);
      const retryKey = randomUUID(),
        slow = f.connect();
      await slow.ready;
      slow.send({ t: 'join', code: room.code, name: '第二位', joinKey: retryKey });
      const firstReply = await slow.wait((m) => m.t === 'joined');
      // Simulate an ACK lost to the client: retry on another connection with no pid/resumeToken.
      const resumed = f.connect();
      await resumed.ready;
      resumed.send({ t: 'join', code: room.code, name: '第二位', joinKey: retryKey });
      const recovered = await resumed.wait((m) => m.t === 'joined');
      assert.equal(recovered.pid, firstReply.pid);
      assert.equal(state.players.size, 2);
      assert.equal(state.players.get(recovered.pid).ws.readyState, 1);
      const attacker = f.connect();
      await attacker.ready;
      attacker.send({ t: 'join', code: room.code, pid: joined.pid, joinKey: randomUUID(), name: '伪造' });
      assert.equal((await attacker.wait((m) => m.t === 'error')).code, 'invalid-player');
      assert.equal(state.players.size, 2);
      const publicLobby = await host.wait((m) => m.t === 'lobby' && m.players.length === 2);
      assert.ok(publicLobby.players.every((p: Record<string, any>) => !p.joinKey && !p.resumeToken));
    } finally {
      await f.close();
    }
  },
);

test(
  '16 房间、128 玩家同时入房并各重试六次，席位唯一；并发上报和重复结算不串房、不重复加分',
  { timeout: 20000 },
  async (t) => {
    const started = Date.now(),
      f = await fixture();
    try {
      const hosts = Array.from({ length: 16 }, () => f.connect());
      await Promise.all(hosts.map((host) => host.ready));
      hosts.forEach((host) => host.send({ t: 'host:create' }));
      const rooms = await Promise.all(hosts.map((host) => host.wait((m) => m.t === 'room')));
      const groups = rooms.map(() => Array.from({ length: 8 }, () => f.connect()));
      await Promise.all(groups.flat().map((p) => p.ready));
      groups.forEach((players, group) =>
        players.forEach((player) => {
          const joinKey = randomUUID();
          for (let attempt = 0; attempt < 6; attempt++)
            player.send({ t: 'join', code: rooms[group].code, name: '大家名字一样长长长', joinKey });
        }),
      );
      await Promise.all(
        groups
          .flat()
          .map((p) =>
            p.wait((m) => m.t === 'joined' && p.messages.filter((item) => item.t === 'joined').length === 6),
          ),
      );
      for (const [index, room] of rooms.entries()) {
        const state = f.party.rooms.rooms.get(room.code);
        assert.equal(state.players.size, 8);
        assert.equal(new Set([...state.players.values()].map((p: any) => p.name)).size, 8);
        for (const p of state.players.values()) assert.ok(Array.from(p.name).length <= 8);
        for (const p of groups[index])
          assert.equal(new Set(p.messages.filter((m) => m.t === 'joined').map((m) => m.pid)).size, 1);
      }
      hosts.forEach((host) => {
        for (let n = 0; n < 3; n++) host.send({ t: 'host:start' });
      });
      await Promise.all(hosts.map((host) => host.wait((m) => m.t === 'intro')));
      for (const room of rooms) {
        const state = f.party.rooms.rooms.get(room.code);
        clearTimeout(state.timer);
        state.beginPlay();
      }
      await Promise.all(groups.flat().map((p) => p.wait((m) => m.t === 'start')));
      groups.flat().forEach((p) => {
        for (let n = 0; n < 10; n++) p.send({ t: 'progress', round: 1, p: n / 10 });
        for (let n = 0; n < 3; n++) p.send({ t: 'finish', round: 1, success: true, score: 1 });
      });
      const results = await Promise.all(hosts.map((host) => host.wait((m) => m.t === 'result')));
      results.forEach((result, index) => {
        const own = new Set([...f.party.rooms.rooms.get(rooms[index].code).players.keys()]);
        assert.equal(result.ranking.length, 8);
        assert.equal(new Set(result.ranking.map((p: any) => p.pid)).size, 8);
        assert.ok(result.ranking.every((p: any) => own.has(p.pid)));
        assert.equal(
          result.standings.reduce((sum: number, p: any) => sum + p.score, 0),
          18,
        );
        assert.equal(hosts[index].messages.filter((m) => m.t === 'result').length, 1);
      });
      t.diagnostic(
        `144 WebSocket connections; 768 join requests, 1280 progress reports, 384 finish requests; completed in ${Date.now() - started}ms on local development machine.`,
      );
    } finally {
      await f.close();
    }
  },
);

test('八人上限和二十房间上限准确，重复入房不误报满员，单连接不能占两个房间', { timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    const hosts = Array.from({ length: 20 }, () => f.connect());
    await Promise.all(hosts.map((p) => p.ready));
    hosts.forEach((p) => p.send({ t: 'host:create' }));
    const rooms = await Promise.all(hosts.map((p) => p.wait((m) => m.t === 'room')));
    const extraHost = f.connect();
    await extraHost.ready;
    extraHost.send({ t: 'host:create' });
    assert.equal((await extraHost.wait((m) => m.t === 'error')).code, 'full');
    const players = Array.from({ length: 8 }, () => f.connect());
    await Promise.all(players.map((p) => p.ready));
    players.forEach((p) => p.send({ t: 'join', code: rooms[0].code, name: '玩家' }));
    await Promise.all(players.map((p) => p.wait((m) => m.t === 'joined')));
    players[0].send({ t: 'join', code: rooms[0].code, name: '玩家' });
    await players[0].wait(
      (m) => m.t === 'joined' && players[0].messages.filter((v) => v.t === 'joined').length === 2,
    );
    const extraPlayer = f.connect();
    await extraPlayer.ready;
    extraPlayer.send({ t: 'join', code: rooms[0].code, name: '第九位' });
    assert.equal((await extraPlayer.wait((m) => m.t === 'error')).code, 'full');
    players[0].send({ t: 'join', code: rooms[1].code, name: '跨房间' });
    assert.equal((await players[0].wait((m) => m.t === 'error')).code, 'already-joined');
    assert.equal(f.party.rooms.rooms.get(rooms[0].code).players.size, 8);
    assert.equal(f.party.rooms.rooms.get(rooms[1].code).players.size, 0);
  } finally {
    await f.close();
  }
});
