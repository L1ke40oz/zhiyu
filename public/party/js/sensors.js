/* =========================================================
   传感器管理：把手机变成手柄
   - 陀螺仪（deviceorientation）→ 屏幕坐标系下的重力方向
   - 加速度计（devicemotion）→ 摇晃次数
   - 摄像头 + 麦克风（getUserMedia）→ 整场只申请一次，后续关卡复用同一个流
   - 没有传感器时（电脑调试 / 用户拒绝）：鼠标拖拽 = 倾斜，点击 = 摇晃，按住 = 吹气
   ========================================================= */

const D2R = Math.PI / 180;

const state = {
  hasMotion: false,
  hasCamera: false,
  hasMic: false,
  stream: null,
  audioCtx: null,
  analyser: null,
  audioBuf: null,
  ambient: 0,     // 环境底噪（RMS 的滑动平均）
  gravity: { x: 0, y: 0 },
  pointer: null, // {x, y} 按住屏幕时相对中心的偏移（-1~1）
  keys: { x: 0, y: 0 },
  shakeListeners: new Set(),
  lastShakeAt: 0,
};

export const sensors = {
  get hasMotion() { return state.hasMotion; },
  get hasCamera() { return state.hasCamera; },
  get hasMic() { return state.hasMic; },
  get stream() { return state.stream; },

  /**
   * 必须在用户点击事件里同步调用（iOS 要求权限请求由用户手势触发）。
   * 陀螺仪权限和摄像头/麦克风权限并行申请，避免第二个请求丢失手势上下文。
   */
  init() {
    // AudioContext 也必须在手势里创建/恢复，否则 iOS 上不出声也拿不到数据
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC && !state.audioCtx) state.audioCtx = new AC();
    if (state.audioCtx && state.audioCtx.state === 'suspended') state.audioCtx.resume();

    listenInputs();
    return Promise.all([requestMotion(), requestMedia()]).then(([motion, media]) => {
      return { motion, camera: state.hasCamera, mic: state.hasMic, mediaError: media };
    });
  },

  /** 当前重力方向（屏幕坐标，x 向右、y 向下，长度 0~1）。无陀螺仪时用鼠标/键盘模拟 */
  gravity(rest = { x: 0, y: 0 }) {
    if (state.hasMotion) return state.gravity;
    if (state.pointer) return state.pointer;
    if (state.keys.x || state.keys.y) return state.keys;
    return rest;
  },

  /** 订阅摇晃；返回取消订阅函数 */
  onShake(fn) {
    state.shakeListeners.add(fn);
    return () => state.shakeListeners.delete(fn);
  },

  /** 麦克风音量（RMS，0~1）；无麦克风时按住屏幕视为吹气 */
  micLevel() {
    if (!state.analyser) return state.pointer ? 0.5 : 0;
    return readRms();
  },

  /** 环境底噪：加入房间后在后台持续测量（约 1 秒的滑动平均），吹气类游戏用它做起点 */
  get ambientLevel() { return state.ambient; },

  /** 音频上下文状态（running / suspended / interrupted），用于现场调试 */
  get audioState() { return state.audioCtx ? state.audioCtx.state : 'none'; },

  /** 是否处于“按住屏幕”状态（备用输入） */
  get pressing() { return !!state.pointer; },
};

/**
 * iOS 开启麦克风后会切换音频会话，之前创建的 AudioContext 可能被挂起（suspended / interrupted），
 * 挂起期间分析器读到的全是 0。每次读音量前检查一下，不在运行就尝试恢复。
 */
function readRms() {
  wakeAudio();
  state.analyser.getFloatTimeDomainData(state.audioBuf);
  let sum = 0;
  for (let i = 0; i < state.audioBuf.length; i++) sum += state.audioBuf[i] * state.audioBuf[i];
  return Math.sqrt(sum / state.audioBuf.length);
}

function wakeAudio() {
  const ac = state.audioCtx;
  if (ac && ac.state !== 'running' && ac.state !== 'closed') ac.resume().catch(() => {});
}

/* ---------------- 陀螺仪 / 加速度计 ---------------- */

async function requestMotion() {
  // iOS 13+：必须显式申请“动作与方向”权限；安卓和桌面浏览器没有这个函数
  try {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      const r = await DeviceMotionEvent.requestPermission();
      if (r !== 'granted') return 'denied';
    }
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      await DeviceOrientationEvent.requestPermission();
    }
  } catch {
    return 'denied';
  }
  window.addEventListener('deviceorientation', onOrientation);
  window.addEventListener('devicemotion', onMotion);
  return 'ok';
}

/**
 * 由欧拉角 beta/gamma 推出重力在屏幕上的投影。
 * 设备坐标系下的重力方向为 (sinγ·cosβ, -sinβ, -cosγ·cosβ)（x 右、y 上、z 朝外），
 * 换成屏幕坐标（y 向下）即 (sinγ·cosβ, sinβ)。
 * 手机竖直拿着时 β≈90° → 重力朝屏幕下方；平放时两分量都接近 0。
 * 用公式而不是 accelerationIncludingGravity，是因为后者在 iOS/安卓上符号约定不一致。
 */
function onOrientation(e) {
  if (e.beta == null || e.gamma == null) return; // 桌面 Chrome 会发一次空事件
  state.hasMotion = true;
  const b = e.beta * D2R;
  const g = e.gamma * D2R;
  let x = Math.sin(g) * Math.cos(b);
  let y = Math.sin(b);
  // 页面随屏幕旋转到横屏时，把向量转回页面坐标
  const angle = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * D2R;
  if (angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    [x, y] = [x * c + y * s, -x * s + y * c];
  }
  // 轻微平滑，去掉手抖
  state.gravity = { x: state.gravity.x * 0.4 + x * 0.6, y: state.gravity.y * 0.4 + y * 0.6 };
}

/** 摇晃检测：去重力加速度超过阈值算一次，120ms 内不重复计数 */
function onMotion(e) {
  let mag = 0;
  const a = e.acceleration;
  if (a && a.x != null) {
    mag = Math.hypot(a.x, a.y, a.z);
  } else if (e.accelerationIncludingGravity && e.accelerationIncludingGravity.x != null) {
    const g = e.accelerationIncludingGravity;
    mag = Math.abs(Math.hypot(g.x, g.y, g.z) - 9.81);
  }
  const now = performance.now();
  if (mag > 13 && now - state.lastShakeAt > 120) {
    state.lastShakeAt = now;
    emitShake();
  }
}

function emitShake() {
  for (const fn of state.shakeListeners) fn();
}

/* ---------------- 摄像头 + 麦克风 ---------------- */

async function requestMedia() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return 'unsupported';
  const video = { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } };
  // 关闭降噪/自动增益：否则“吹气”的噪声会被当成噪音过滤掉
  const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  const attempts = [{ video, audio }, { video }, { audio }];
  let lastError = null;
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setupStream(stream);
      return 'ok';
    } catch (err) {
      lastError = err;
      // 用户明确拒绝时不再反复弹窗
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') break;
    }
  }
  return lastError ? lastError.name : 'failed';
}

function setupStream(stream) {
  state.stream = stream;
  state.hasCamera = stream.getVideoTracks().length > 0;
  state.hasMic = stream.getAudioTracks().length > 0;
  if (state.hasMic && state.audioCtx) {
    // 只把音轨交给 Web Audio：部分 Safari 版本对“音视频混合流”取到的是静音
    const source = state.audioCtx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    state.analyser = state.audioCtx.createAnalyser();
    state.analyser.fftSize = 1024;
    state.audioBuf = new Float32Array(state.analyser.fftSize);
    source.connect(state.analyser); // 不连到扬声器，避免啸叫
    wakeAudio();
    setInterval(() => {
      const level = readRms();
      state.ambient = state.ambient ? state.ambient * 0.9 + level * 0.1 : level;
    }, 100);
  }
}

/* ---------------- 备用输入：鼠标 / 触摸 / 键盘 ---------------- */

let inputsBound = false;
function listenInputs() {
  if (inputsBound) return;
  inputsBound = true;

  const toVec = (e) => {
    const r = Math.min(innerWidth, innerHeight) / 2;
    const x = (e.clientX - innerWidth / 2) / r;
    const y = (e.clientY - innerHeight / 2) / r;
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  };
  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input')) return;
    state.pointer = toVec(e);
    if (!state.hasMotion) emitShake(); // 没有加速度计时，点一下 = 摇一下
  });
  document.addEventListener('pointermove', (e) => {
    if (state.pointer) state.pointer = toVec(e);
  });
  const release = () => { state.pointer = null; };
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);

  const KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const held = new Set();
  const update = () => {
    let x = 0, y = 0;
    for (const k of held) { x += KEYS[k][0]; y += KEYS[k][1]; }
    state.keys = { x: x * 0.8, y: y * 0.8 };
  };
  document.addEventListener('keydown', (e) => {
    if (KEYS[e.key]) { held.add(e.key); update(); }
    if (e.key === ' ' && !e.repeat) emitShake();
  });
  document.addEventListener('keyup', (e) => {
    if (KEYS[e.key]) { held.delete(e.key); update(); }
  });
}
