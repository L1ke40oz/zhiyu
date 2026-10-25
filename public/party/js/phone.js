/* =========================================================
   手机端（手柄）
   加入房间 → 申请传感器权限 → 跟随服务端的回合指令运行微游戏 → 上报结果
   ========================================================= */
import { connect } from './net.js';
import { sensors } from './sensors.js';
import * as sand from './games/sand.js';
import * as color from './games/color.js';
import * as shake from './games/shake.js';
import * as balance from './games/balance.js';
import * as blow from './games/blow.js';

const GAMES = { sand, color, shake, balance, blow };
const $ = (id) => document.getElementById(id);
const SCREENS = ['join', 'lobby', 'intro', 'play', 'result', 'final'];

const me = { pid: null, name: '', color: '#ccc', code: '' };
let net = null;
let intro = null;     // 当前关卡信息（intro 消息）
let session = null;   // 正在进行的微游戏
let wakeLock = null;
let joining = false;
let joinTimer = 0;
let joinKey = '';
let connectedCode = '';
const joinButton = $('join-form').querySelector('button');
function joiningState(pending, label = '正在加入派对…') {
  joining = pending;
  joinButton.disabled = pending;
  joinButton.textContent = pending ? label : '加入派对';
  $('in-code').disabled = pending;
  $('in-name').disabled = pending;
}

/* ---------------- 加入 ---------------- */

const params = new URLSearchParams(location.search);
$('in-code').value = (params.get('room') || sessionStorage.getItem('party.code') || '').toUpperCase();
$('in-name').value = localStorage.getItem('party.name') || '';

$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (joining) return;
  const code = $('in-code').value.trim().toUpperCase();
  const name = $('in-name').value.trim();
  if (!code || !name) return;
  $('join-error').hidden = true;
  localStorage.setItem('party.name', name);
  // 同一房间刷新后沿用身份（分数不丢）
  if (sessionStorage.getItem('party.code') !== code) { sessionStorage.removeItem('party.pid'); sessionStorage.removeItem('party.resumeToken'); }
  const storageKey = `party.joinKey:${code}`;
  joinKey = sessionStorage.getItem(storageKey) || Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  sessionStorage.setItem(storageKey, joinKey);
  sessionStorage.setItem('party.code', code);
  me.code = code;
  me.name = name;

  // 必须在点击事件里同步发起：陀螺仪 + 摄像头 + 麦克风 权限
  joiningState(true);
  let perms;
  try { perms = sensors.init(); }
  catch { perms = Promise.resolve({ motion: 'denied', camera: false, mic: false }); }
  requestWakeLock();
  // Connect while permissions are being requested; a slow permission prompt must not create join retries.
  perms.then(renderPerms).catch(() => renderPerms({ motion: 'denied', camera: false, mic: false }));
  startNet();
  clearTimeout(joinTimer);
  joinTimer = setTimeout(() => {
    if (joining) {
      joiningState(false);
      $('join-error').textContent = '网络响应较慢，可以重试加入；重复点击不会占用新席位。';
      $('join-error').hidden = false;
    }
  }, 15000);
});

function startNet() {
  if (net && connectedCode !== me.code) { net.close(); net = null; me.pid = null; }
  if (net) return sendJoin();
  connectedCode = me.code;
  net = connect({
    onOpen: () => {
      $('net-banner').hidden = true;
      sendJoin();
    },
    onClose: () => {
      if (me.pid) $('net-banner').hidden = false;
      if (joining) joinButton.textContent = '连接中，正在重试…';
    },
    onMessage: handle,
  });
}

function sendJoin() {
  net.send({ t: 'join', code: me.code, name: me.name, joinKey, pid: sessionStorage.getItem('party.pid') || undefined, resumeToken: sessionStorage.getItem('party.resumeToken') || undefined });
}

function renderPerms(r) {
  const items = [
    ['陀螺仪', r.motion === 'ok'],
    ['摄像头', r.camera],
    ['麦克风', r.mic],
  ];
  const list = $('perm-list');
  list.textContent = '';
  for (const [label, ok] of items) {
    const el = document.createElement('span');
    el.className = ok ? 'perm ok' : 'perm bad';
    el.textContent = `${ok ? '✓' : '✗'} ${label}`;
    list.appendChild(el);
  }
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    /* 不支持或被拒绝时忽略 */
  }
}
document.addEventListener('visibilitychange', () => {
  // 切到后台时屏幕常亮锁会被系统释放，回来后重新申请
  if (document.visibilityState === 'visible' && me.pid && (!wakeLock || wakeLock.released)) requestWakeLock();
});

/* ---------------- 消息处理 ---------------- */

function handle(msg) {
  switch (msg.t) {
    case 'error':
      clearTimeout(joinTimer);
      joiningState(false);
      abortGame();
      show('join');
      $('join-error').textContent = msg.msg;
      $('join-error').hidden = false;
      if (msg.code === 'no-room' || msg.code === 'invalid-player') { sessionStorage.removeItem('party.pid'); sessionStorage.removeItem('party.resumeToken'); }
      break;

    case 'joined':
      clearTimeout(joinTimer);
      joiningState(false);
      $('join-error').hidden = true;
      Object.assign(me, { pid: msg.pid, name: msg.name, color: msg.color });
      sessionStorage.setItem('party.pid', msg.pid);
      sessionStorage.setItem('party.resumeToken', msg.resumeToken);
      sessionStorage.setItem('party.code', msg.code);
      $('me-avatar').style.background = me.color;
      $('me-avatar').textContent = Array.from(me.name)[0] || '?';
      $('me-name').textContent = me.name;
      $('me-name').title = me.name;
      $('lobby-code').textContent = msg.code;
      if (!session) show('lobby');
      break;

    case 'lobby':
      $('lobby-count').textContent = msg.players.filter((p) => p.online).length;
      if (msg.phase === 'lobby') {
        abortGame();
        $('lobby-status').textContent = '等待主持人开始…';
        show('lobby');
      }
      break;

    case 'wait':
      $('lobby-status').textContent = msg.msg;
      show('lobby');
      break;

    case 'intro':
      abortGame();
      intro = msg;
      // 中途加入、不在本关参与名单里的玩家只能观战
      if (!msg.players.some((p) => p.pid === me.pid)) {
        $('lobby-status').textContent = '本关进行中，下一关一起玩！';
        show('lobby');
        intro = null;
        break;
      }
      $('intro-round').textContent = `第 ${msg.round} / ${msg.total} 关`;
      $('intro-verb').textContent = msg.game.verb;
      $('intro-title').textContent = msg.game.title;
      $('intro-hint').textContent = msg.game.hint;
      restartAnimation($('s-intro').querySelector('.intro-bar i'));
      show('intro');
      vibrate(40);
      break;

    case 'start':
      if (intro && intro.round === msg.round) startGame(intro);
      break;

    case 'result':
      abortGame();
      showResult(msg);
      break;

    case 'say':
      showSay(msg.final ? $('final-say') : $('res-say'), msg.text);
      break;

    case 'final':
      abortGame();
      showFinal(msg.standings);
      break;
  }
}

/* ---------------- 微游戏外壳 ---------------- */

function startGame(info) {
  const { game, round } = info;
  const mod = GAMES[game.id];
  if (!mod) return;
  show('play');
  const stage = $('stage');
  stage.textContent = '';
  stage.style.removeProperty('--target');
  $('play-done').hidden = true;
  $('play-verb').textContent = game.verb;

  let finished = false;
  let lastSent = 0;
  const startedAt = performance.now();
  const ctx = {
    params: game.params,
    duration: game.duration,
    sensors,
    progress(p) {
      const now = performance.now();
      if (finished || now - lastSent < 100) return;
      lastSent = now;
      net.send({ t: 'progress', round, p: Math.min(1, Math.max(0, p)) });
    },
    win(score) {
      finish(true, score);
    },
  };

  let inst;
  try {
    inst = mod.create(stage, ctx);
  } catch (err) {
    console.error(err);
    inst = { end: () => ({ success: false, score: 0 }), destroy() {} };
  }

  const fill = $('play-timer-fill');
  let raf = requestAnimationFrame(function tick(now) {
    const left = 1 - (now - startedAt) / (game.duration * 1000);
    fill.style.transform = `scaleX(${Math.max(0, left)})`;
    fill.classList.toggle('urgent', left < 0.3);
    if (left <= 0) {
      const r = inst.end();
      finish(r.success, r.score);
      return;
    }
    raf = requestAnimationFrame(tick);
  });

  function finish(success, score) {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    inst.destroy();
    if (success) net.send({ t: 'progress', round, p: 1 });
    net.send({ t: 'finish', round, success, score });
    $('done-text').textContent = success ? '过关！' : '时间到';
    $('play-done').className = `play-done ${success ? 'win' : 'lose'}`;
    $('play-done').hidden = false;
    vibrate(success ? [80, 40, 120] : [200]);
    session = null;
  }

  session = {
    abort() {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      inst.destroy();
    },
  };
}

function abortGame() {
  if (session) session.abort();
  session = null;
}

/* ---------------- 结果 ---------------- */

function showResult(msg) {
  const mine = msg.ranking.find((r) => r.pid === me.pid);
  $('res-say').hidden = true;
  if (!mine) {
    $('res-rank').textContent = '观战中';
    $('res-gain').textContent = '';
    $('res-total').textContent = '';
  } else {
    $('res-rank').textContent = mine.success ? `第 ${mine.rank} 名` : '失败';
    $('res-rank').className = `res-rank ${mine.success ? 'win' : 'lose'}`;
    $('res-gain').textContent = `+${mine.gained}`;
    const pos = msg.standings.findIndex((s) => s.pid === me.pid) + 1;
    $('res-total').textContent = `总分 ${mine.total} · 当前第 ${pos} 名`;
  }
  show('result');
}

function showFinal(standings) {
  const idx = standings.findIndex((s) => s.pid === me.pid);
  $('final-say').hidden = true;
  $('final-rank').textContent = idx === 0 ? '🏆 冠军！' : idx >= 0 ? `第 ${idx + 1} 名` : '观战中';
  $('final-rank').className = `res-rank ${idx === 0 ? 'win' : ''}`;
  $('final-score').textContent = idx >= 0 ? `${standings[idx].score} 分` : '';
  show('final');
  if (idx === 0) vibrate([100, 60, 100, 60, 200]);
}

function showSay(el, text) {
  el.textContent = `🎙️ ${text}`;
  el.hidden = false;
}

/* ---------------- 工具 ---------------- */

function show(name) {
  for (const s of SCREENS) $(`s-${s}`).hidden = s !== name;
}

function restartAnimation(el) {
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
}

function vibrate(pattern) {
  try {
    if (typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  } catch {
    /* iOS 不支持，忽略 */
  }
}
