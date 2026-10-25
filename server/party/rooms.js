/* =========================================================
   房间与回合状态机
   lobby → intro → playing → result → intro … → final → lobby

   消息协议（JSON，字段 t 为类型）：
   大屏 → 服务端   host:create {origin} | host:resume {code, token} | host:start | host:lobby
   手机 → 服务端   join {code, name, pid?} | progress {round, p} | finish {round, success, score}
   服务端 → 全体   lobby | intro | start | result | say | final
   服务端 → 大屏   room | progress | finished
   服务端 → 手机   joined | wait | error
   ========================================================= */
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { finalComment, roundComment } from './ai.js';
import { pickPlaylist } from './games.js';

const MAX_PLAYERS = 8;
const MAX_ROOMS = 20;
const ROUNDS = 5;
const INTRO_MS = 2600;        // 关卡开场（大字“倒！”）
const GRACE_MS = 1500;        // 网络宽限：手机本地计时结束后，等待结果上报
const RESULT_MS = 7000;       // 结算画面停留（AI 台词在这段时间内生成并朗读）
const ROOM_IDLE_MS = 15 * 60 * 1000;
const POINTS = [5, 4, 3, 2, 1, 1, 1, 1];
const AVATAR_COLORS = ['#ff5a5f', '#ffb400', '#3ec46d', '#2d9cdb', '#ff7eb6', '#00b8a9', '#f2994a', '#8d6e63'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆的 I/O/0/1

export class RoomManager {
  constructor() {
    this.rooms = new Map();
    setInterval(() => this.sweep(), 60 * 1000).unref();
  }

  get size() {
    return this.rooms.size;
  }

  attach(ws) {
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (!msg || typeof msg.t !== 'string') return;
      try {
        this.handle(ws, msg);
      } catch (err) {
        console.error('[room] 处理消息出错', msg.t, err);
      }
    });
    ws.on('close', () => {
      const room = ws.roomCode && this.rooms.get(ws.roomCode);
      if (room) room.onDisconnect(ws);
    });
  }

  handle(ws, msg) {
    if (msg.t === 'host:create') { if (ws.roomCode) return; return this.createRoom(ws, msg); }
    if (msg.t === 'host:resume') {
      const room = this.rooms.get(String(msg.code || '').toUpperCase());
      if (!room || room.hostToken !== msg.token) return send(ws, { t: 'error', code: 'no-room', msg: '房间已失效，请重新创建' });
      return room.attachHost(ws);
    }
    if (msg.t === 'join') {
      const room = this.rooms.get(String(msg.code || '').toUpperCase().trim());
      if (!room) return send(ws, { t: 'error', code: 'no-room', msg: '房间不存在，请检查房间号' });
      return room.join(ws, msg);
    }

    const room = ws.roomCode && this.rooms.get(ws.roomCode);
    if (!room) return;
    if (ws.role === 'host') {
      if (msg.t === 'host:start') room.startGame();
      else if (msg.t === 'host:lobby') room.backToLobby();
    } else if (ws.role === 'player') {
      if (msg.t === 'progress') room.onProgress(ws.pid, msg);
      else if (msg.t === 'finish') room.onFinish(ws.pid, msg);
    }
  }

  createRoom(ws, msg) {
    if (this.rooms.size >= MAX_ROOMS) this.sweep(true);
    if (this.rooms.size >= MAX_ROOMS) return send(ws, { t: 'error', code: 'full', msg: '服务器房间已满，请稍后再试' });
    let code;
    do {
      code = Array.from({ length: 4 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
    } while (this.rooms.has(code));
    const room = new Room(code, safeOrigin(ws.trustedOrigin || msg.origin));
    this.rooms.set(code, room);
    room.attachHost(ws);
    console.log(`[room] 创建 ${code}（当前 ${this.rooms.size} 个房间）`);
  }

  /** 清理长时间无人的房间；force 时清理所有没有在线成员的房间 */
  sweep(force = false) {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.hasAnyoneOnline()) {
        room.lastActive = now;
        continue;
      }
      if (force || now - room.lastActive > ROOM_IDLE_MS) {
        room.dispose();
        this.rooms.delete(code);
        console.log(`[room] 回收 ${code}`);
      }
    }
  }
}

class Room {
  constructor(code, origin) {
    this.code = code;
    this.origin = origin;
    this.hostToken = crypto.randomBytes(12).toString('hex');
    this.host = null;
    this.players = new Map(); // pid → player
    this.phase = 'lobby';
    this.playlist = [];
    this.round = 0;
    this.current = null;
    this.timer = null;
    this.highlights = [];
    this.lastActive = Date.now();
    this.qr = null;
  }

  /* ---------------- 连接管理 ---------------- */

  async attachHost(ws) {
    if (this.host && this.host !== ws) this.host.close(4000, 'replaced');
    this.host = ws;
    ws.role = 'host';
    ws.roomCode = this.code;
    const joinUrl = `${this.origin}/party/?room=${this.code}`;
    if (!this.qr) {
      this.qr = await QRCode.toString(joinUrl, {
        type: 'svg',
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#111214', light: '#ffffff' },
      });
    }
    send(ws, { t: 'room', code: this.code, token: this.hostToken, joinUrl, qr: this.qr, maxPlayers: MAX_PLAYERS, rounds: ROUNDS });
    this.broadcastLobby();
    // 大屏刷新后恢复当前画面
    if (this.phase === 'intro' || this.phase === 'playing') {
      send(ws, { t: 'intro', ...this.introPayload() });
      if (this.phase === 'playing') send(ws, { t: 'start', round: this.round });
    } else if (this.phase === 'final') {
      send(ws, { t: 'final', standings: this.standings() });
    }
  }

  join(ws, msg) {
    let player = msg.pid && this.players.get(String(msg.pid));
    if (player) {
      if (player.resumeToken !== msg.resumeToken) return send(ws, { t: 'error', code: 'invalid-player', msg: '无法恢复这个玩家身份，请重新加入房间。' });
      // 断线重连：沿用原来的身份和分数
      if (player.ws && player.ws !== ws) player.ws.close(4000, 'replaced');
    } else {
      if (this.players.size >= MAX_PLAYERS) {
        return send(ws, { t: 'error', code: 'full', msg: `房间已满（最多 ${MAX_PLAYERS} 人）` });
      }
      player = {
        pid: crypto.randomBytes(8).toString('hex'),
        resumeToken: crypto.randomBytes(20).toString('hex'),
        name: this.uniqueName(cleanName(msg.name) || `玩家${this.players.size + 1}`),
        color: AVATAR_COLORS[this.players.size % AVATAR_COLORS.length],
        score: 0,
        memory: [],      // 派对记忆：本局发生在 TA 身上的事
        winStreak: 0,
        loseStreak: 0,
        ws: null,
      };
      this.players.set(player.pid, player);
    }
    player.ws = ws;
    player.online = true;
    ws.role = 'player';
    ws.roomCode = this.code;
    ws.pid = player.pid;
    this.lastActive = Date.now();

    send(ws, { t: 'joined', pid: player.pid, resumeToken: player.resumeToken, name: player.name, color: player.color, code: this.code });
    if (this.phase === 'intro' || this.phase === 'playing') {
      send(ws, { t: 'wait', msg: '本关进行中，下一关一起玩！' });
    } else if (this.phase === 'final') {
      send(ws, { t: 'final', standings: this.standings() });
    }
    this.broadcastLobby();
  }

  onDisconnect(ws) {
    if (ws === this.host) {
      this.host = null;
      return;
    }
    const player = ws.pid && this.players.get(ws.pid);
    if (!player || player.ws !== ws) return;
    player.online = false;
    player.ws = null;
    // 大厅里断开的直接移除；游戏中保留身份，方便重连
    if (this.phase === 'lobby') this.players.delete(player.pid);
    this.broadcastLobby();
    if (this.phase === 'playing') this.maybeEndEarly();
  }

  hasAnyoneOnline() {
    if (this.host) return true;
    for (const p of this.players.values()) if (p.online) return true;
    return false;
  }

  /* ---------------- 游戏流程 ---------------- */

  startGame() {
    if (this.phase !== 'lobby' && this.phase !== 'final') return;
    if (![...this.players.values()].some((p) => p.online)) return;
    for (const p of this.players.values()) {
      p.score = 0;
      p.memory = [];
      p.winStreak = 0;
      p.loseStreak = 0;
    }
    this.highlights = [];
    this.playlist = pickPlaylist(ROUNDS);
    this.round = 0;
    this.nextRound();
  }

  backToLobby() {
    clearTimeout(this.timer);
    this.phase = 'lobby';
    this.current = null;
    for (const [pid, p] of this.players) if (!p.online) this.players.delete(pid);
    for (const p of this.players.values()) p.score = 0;
    this.broadcastLobby();
  }

  nextRound() {
    clearTimeout(this.timer);
    if (this.round >= this.playlist.length) return this.finishGame();
    const game = this.playlist[this.round];
    this.round += 1;
    const participants = new Set([...this.players.values()].filter((p) => p.online).map((p) => p.pid));
    if (participants.size === 0) return this.backToLobby();
    this.current = { round: this.round, game, participants, results: new Map(), startedAt: 0, lastProgress: new Map() };
    this.phase = 'intro';
    this.broadcast({ t: 'intro', ...this.introPayload() });
    this.timer = setTimeout(() => this.beginPlay(), INTRO_MS);
  }

  introPayload() {
    return { round: this.round, total: this.playlist.length, game: this.current.game, players: this.publicPlayers() };
  }

  beginPlay() {
    this.phase = 'playing';
    this.current.startedAt = Date.now();
    this.broadcast({ t: 'start', round: this.round });
    this.timer = setTimeout(() => this.endRound(), this.current.game.duration * 1000 + GRACE_MS);
  }

  onProgress(pid, msg) {
    const cur = this.current;
    if (this.phase !== 'playing' || !cur || msg.round !== cur.round || !cur.participants.has(pid)) return;
    // 限流：每个玩家最多 ~10 次/秒
    const now = Date.now();
    if (now - (cur.lastProgress.get(pid) || 0) < 90) return;
    cur.lastProgress.set(pid, now);
    const p = clamp(Number(msg.p) || 0, 0, 1);
    send(this.host, { t: 'progress', pid, p });
  }

  onFinish(pid, msg) {
    const cur = this.current;
    if (this.phase !== 'playing' || !cur || msg.round !== cur.round) return;
    if (!cur.participants.has(pid) || cur.results.has(pid)) return;
    const result = {
      success: msg.success === true,
      score: clamp(Number(msg.score) || 0, 0, 1),
      time: Date.now() - cur.startedAt,
    };
    cur.results.set(pid, result);
    send(this.host, { t: 'finished', pid, success: result.success });
    this.maybeEndEarly();
  }

  /** 所有在线参与者都交卷了就提前结束，不用干等倒计时 */
  maybeEndEarly() {
    const cur = this.current;
    if (this.phase !== 'playing' || !cur) return;
    for (const pid of cur.participants) {
      const p = this.players.get(pid);
      if (p && p.online && !cur.results.has(pid)) return;
    }
    this.endRound();
  }

  endRound() {
    clearTimeout(this.timer);
    const cur = this.current;
    if (!cur || this.phase !== 'playing') return;
    this.phase = 'result';

    const entries = [...cur.participants]
      .map((pid) => ({ pid, player: this.players.get(pid), ...(cur.results.get(pid) || { success: false, score: 0, time: Infinity }) }))
      .filter((e) => e.player);
    // 名次：成功优先 → 得分高优先 → 用时短优先
    entries.sort((a, b) => b.success - a.success || b.score - a.score || a.time - b.time);

    const ranking = entries.map((e, i) => {
      const p = e.player;
      const gained = e.success ? POINTS[i] : 0;
      p.score += gained;
      if (e.success) {
        p.winStreak += 1;
        p.loseStreak = 0;
      } else {
        p.loseStreak += 1;
        p.winStreak = 0;
      }
      return { pid: p.pid, name: p.name, color: p.color, success: e.success, score: e.score, gained, total: p.score, rank: i + 1 };
    });

    this.remember(cur, ranking);
    this.broadcast({ t: 'result', round: cur.round, game: cur.game, ranking, standings: this.standings(), last: cur.round >= this.playlist.length });

    // AI 点评在结算画面期间生成；回来时如果已经进入下一关就丢弃
    const memory = ranking.map((r) => ({ name: r.name, memory: this.players.get(r.pid).memory.slice(0, -1).slice(-3) }));
    roundComment({ game: cur.game, round: cur.round, total: this.playlist.length, ranking, memory }).then((text) => {
      if (this.current === cur && this.phase === 'result') this.broadcast({ t: 'say', text });
    });

    this.timer = setTimeout(() => this.nextRound(), RESULT_MS);
  }

  /** 把本关值得“翻旧账”的事写进玩家记忆，供之后的 AI 点评引用 */
  remember(cur, ranking) {
    const title = `第${cur.round}关《${cur.game.title}》`;
    const n = ranking.length;
    ranking.forEach((r) => {
      const p = this.players.get(r.pid);
      let event;
      if (r.rank === 1 && r.success) event = `${title}拿了第一`;
      else if (!r.success) event = `${title}失败了`;
      else if (r.rank === n && n > 1) event = `${title}垫底`;
      else event = `${title}第${r.rank}名`;
      if (p.loseStreak >= 2) event += `（已连续${p.loseStreak}关失败）`;
      if (p.winStreak >= 2 && r.rank === 1) event += `（连胜${p.winStreak}关）`;
      p.memory.push(event);
    });
    const first = ranking[0];
    if (first && first.success) this.highlights.push(`${first.name} 赢下${title}`);
    const allFail = ranking.length > 1 && ranking.every((r) => !r.success);
    if (allFail) this.highlights.push(`${title}全员失败`);
  }

  finishGame() {
    clearTimeout(this.timer);
    this.phase = 'final';
    this.current = null;
    const standings = this.standings();
    this.broadcast({ t: 'final', standings });
    finalComment(standings, this.highlights.slice(-6)).then((text) => {
      if (this.phase === 'final') this.broadcast({ t: 'say', text, final: true });
    });
  }

  /* ---------------- 工具 ---------------- */

  standings() {
    return [...this.players.values()]
      .sort((a, b) => b.score - a.score)
      .map((p) => ({ pid: p.pid, name: p.name, color: p.color, score: p.score, online: !!p.online }));
  }

  publicPlayers() {
    return [...this.players.values()].map((p) => ({ pid: p.pid, name: p.name, color: p.color, score: p.score, online: !!p.online }));
  }

  broadcastLobby() {
    this.broadcast({ t: 'lobby', phase: this.phase, players: this.publicPlayers(), maxPlayers: MAX_PLAYERS });
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    if (this.host) sendRaw(this.host, data);
    for (const p of this.players.values()) if (p.ws) sendRaw(p.ws, data);
  }

  uniqueName(name) {
    const names = new Set([...this.players.values()].map((p) => p.name));
    if (!names.has(name)) return name;
    for (let i = 2; ; i++) if (!names.has(`${name}${i}`)) return `${name}${i}`;
  }

  dispose() {
    clearTimeout(this.timer);
  }
}

function send(ws, msg) {
  if (ws) sendRaw(ws, JSON.stringify(msg));
}

function sendRaw(ws, data) {
  if (ws.readyState === 1) ws.send(data);
}

function clamp(x, min, max) {
  return Math.min(max, Math.max(min, x));
}

/** 昵称：去掉控制字符和尖括号，最多 8 个字 */
function cleanName(name) {
  return Array.from(String(name || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim()).slice(0, 8).join('');
}

/** 只接受 http(s) 源，用于生成扫码地址 */
function safeOrigin(origin) {
  try {
    const u = new URL(String(origin));
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin;
  } catch {
    /* 忽略 */
  }
  return 'http://localhost:3000';
}

