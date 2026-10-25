/* =========================================================
   大屏端：房间二维码、玩家赛道、结算、AI 主持人语音
   ========================================================= */
import { connect } from './net.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['home', 'lobby', 'intro', 'play', 'result', 'final'];

let net = null;
let room = null;           // {code, token}
let players = [];
let lanes = new Map();     // pid → {bar, status}
let timerRaf = 0;

/* ---------------- 建房 ---------------- */

$('btn-create').addEventListener('click', () => {
  unlockSpeech(); // 浏览器要求语音播放由用户手势触发
  $('btn-create').disabled = true;
  startNet();
});

$('btn-start').addEventListener('click', () => net.send({ t: 'host:start' }));
$('btn-again').addEventListener('click', () => net.send({ t: 'host:start' }));
$('btn-lobby').addEventListener('click', () => net.send({ t: 'host:lobby' }));

function startNet() {
  net = connect({
    onOpen() {
      $('net-banner').hidden = true;
      const saved = JSON.parse(sessionStorage.getItem('party.host') || 'null');
      if (saved) net.send({ t: 'host:resume', code: saved.code, token: saved.token });
      else net.send({ t: 'host:create', origin: location.origin });
    },
    onClose() {
      $('net-banner').hidden = false;
    },
    onMessage: handle,
  });
}

// 大屏刷新：已有房间则自动恢复（语音需要再点一下页面才能出声）
if (sessionStorage.getItem('party.host')) {
  startNet();
  document.addEventListener('pointerdown', unlockSpeech, { once: true });
}

/* ---------------- 消息处理 ---------------- */

function handle(msg) {
  switch (msg.t) {
    case 'error':
      if (msg.code === 'no-room') {
        sessionStorage.removeItem('party.host');
        net.send({ t: 'host:create', origin: location.origin });
      } else {
        alert(msg.msg);
      }
      break;

    case 'room':
      room = { code: msg.code, token: msg.token };
      sessionStorage.setItem('party.host', JSON.stringify(room));
      $('qr').innerHTML = msg.qr; // 服务端用 qrcode 库生成的 SVG
      $('join-url').textContent = msg.joinUrl;
      $('room-code').textContent = msg.code;
      $('room-badge').textContent = `房间 ${msg.code}`;
      $('room-badge').hidden = false;
      $('player-max').textContent = msg.maxPlayers;
      $('https-warn').hidden = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
      show('lobby');
      break;

    case 'lobby':
      players = msg.players;
      renderLobby();
      if (msg.phase === 'lobby') {
        hideMc();
        show('lobby');
      }
      break;

    case 'intro':
      hideMc();
      players = msg.players;
      $('intro-round').textContent = `第 ${msg.round} / ${msg.total} 关`;
      $('intro-verb').textContent = msg.game.verb;
      $('intro-title').textContent = msg.game.title;
      $('intro-hint').textContent = msg.game.hint;
      prepareLanes(msg);
      show('intro');
      break;

    case 'start':
      startTimer();
      show('play');
      break;

    case 'progress': {
      const lane = lanes.get(msg.pid);
      if (lane && !lane.done) lane.bar.style.width = `${Math.round(msg.p * 100)}%`;
      break;
    }

    case 'finished': {
      const lane = lanes.get(msg.pid);
      if (!lane) break;
      lane.done = true;
      lane.row.classList.add(msg.success ? 'win' : 'lose');
      lane.status.textContent = msg.success ? '✓' : '✗';
      if (msg.success) lane.bar.style.width = '100%';
      break;
    }

    case 'result':
      cancelAnimationFrame(timerRaf);
      renderResult(msg);
      show('result');
      break;

    case 'say':
      say(msg.text);
      break;

    case 'final':
      hideMc();
      renderFinal(msg.standings);
      show('final');
      break;
  }
}

/* ---------------- 渲染 ---------------- */

function renderLobby() {
  const online = players.filter((p) => p.online);
  $('player-count').textContent = online.length;
  $('btn-start').disabled = online.length === 0;
  $('btn-start').textContent = online.length ? `开始派对（${online.length} 人）` : '等待玩家加入…';
  const grid = $('player-grid');
  grid.textContent = '';
  const max = Number($('player-max').textContent) || 8;
  for (let i = 0; i < max; i++) {
    const p = online[i];
    const cell = document.createElement('div');
    cell.className = p ? 'slot filled' : 'slot';
    if (p) {
      cell.appendChild(avatar(p));
      const name = document.createElement('div');
      name.className = 'slot-name';
      name.textContent = p.name;
      cell.appendChild(name);
    } else {
      cell.textContent = '空位';
    }
    grid.appendChild(cell);
  }
}

function prepareLanes(msg) {
  $('play-verb').textContent = msg.game.verb;
  $('play-title').textContent = `${msg.game.title} · 第 ${msg.round}/${msg.total} 关`;
  $('play-timer-fill').dataset.duration = msg.game.duration;
  const box = $('lanes');
  box.textContent = '';
  lanes = new Map();
  for (const p of msg.players.filter((pl) => pl.online)) {
    const row = document.createElement('div');
    row.className = 'lane';
    const name = document.createElement('div');
    name.className = 'lane-name';
    name.textContent = p.name;
    const track = document.createElement('div');
    track.className = 'lane-track';
    const bar = document.createElement('i');
    bar.style.background = p.color;
    track.appendChild(bar);
    const status = document.createElement('div');
    status.className = 'lane-status';
    row.append(avatar(p), name, track, status);
    box.appendChild(row);
    lanes.set(p.pid, { row, bar, status, done: false });
  }
}

function startTimer() {
  const fill = $('play-timer-fill');
  const duration = Number(fill.dataset.duration) * 1000;
  const start = performance.now();
  cancelAnimationFrame(timerRaf);
  timerRaf = requestAnimationFrame(function tick(now) {
    const left = Math.max(0, 1 - (now - start) / duration);
    fill.style.transform = `scaleX(${left})`;
    fill.classList.toggle('urgent', left < 0.3);
    if (left > 0) timerRaf = requestAnimationFrame(tick);
  });
}

function renderResult(msg) {
  $('result-title').textContent = `《${msg.game.title}》结算 · 第 ${msg.round} 关`;
  const list = $('result-list');
  list.textContent = '';
  msg.ranking.forEach((r) => {
    const row = document.createElement('div');
    row.className = `rank-row ${r.success ? 'win' : 'lose'}`;
    row.style.animationDelay = `${(msg.ranking.length - r.rank) * 0.12}s`;
    row.append(
      text('rank-no', r.success ? r.rank : '✗'),
      avatar(r),
      text('rank-name', r.name),
      text('rank-gain', r.gained ? `+${r.gained}` : '+0'),
      text('rank-total', `${r.total} 分`),
    );
    list.appendChild(row);
  });
}

function renderFinal(standings) {
  const podium = $('podium');
  podium.textContent = '';
  // 领奖台顺序：第二、第一、第三
  [1, 0, 2].forEach((i) => {
    const p = standings[i];
    if (!p) return;
    const col = document.createElement('div');
    col.className = `podium-col p${i + 1}`;
    const av = avatar(p);
    av.classList.add('avatar-lg');
    col.append(av, text('podium-name', p.name), text('podium-score', `${p.score} 分`), text('podium-block', String(i + 1)));
    podium.appendChild(col);
  });
  const rest = $('final-rest');
  rest.textContent = '';
  standings.slice(3).forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'rank-row';
    row.append(text('rank-no', i + 4), avatar(p), text('rank-name', p.name), text('rank-total', `${p.score} 分`));
    rest.appendChild(row);
  });
}

/* ---------------- AI 主持人 ---------------- */

let zhVoice = null;
function unlockSpeech() {
  if (!('speechSynthesis' in window)) return;
  // 用一段空语音“解锁”自动播放限制
  const u = new SpeechSynthesisUtterance('');
  speechSynthesis.speak(u);
  const pickVoice = () => {
    const voices = speechSynthesis.getVoices();
    zhVoice = voices.find((v) => /zh[-_]CN/i.test(v.lang)) || voices.find((v) => /^zh/i.test(v.lang)) || null;
  };
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

function say(textContent) {
  $('mc-text').textContent = textContent;
  const mc = $('mc');
  mc.hidden = false;
  mc.classList.remove('talk');
  void mc.offsetWidth;
  mc.classList.add('talk');
  if ('speechSynthesis' in window) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(textContent);
    u.lang = 'zh-CN';
    if (zhVoice) u.voice = zhVoice;
    u.rate = 1.1;
    u.pitch = 1.1;
    speechSynthesis.speak(u);
  }
}

function hideMc() {
  $('mc').hidden = true;
}

/* ---------------- 工具 ---------------- */

function show(name) {
  for (const v of VIEWS) $(`v-${v}`).hidden = v !== name;
}

function avatar(p) {
  const el = document.createElement('div');
  el.className = 'avatar';
  el.style.background = p.color;
  el.textContent = Array.from(p.name)[0] || '?';
  return el;
}

function text(className, content) {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = content;
  return el;
}

// The HTML may paint before its module is ready; avoid losing a very early tap.
if (!sessionStorage.getItem('party.host')) $('btn-create').disabled = false;
