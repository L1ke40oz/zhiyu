let context: AudioContext | null = null;
let volume: GainNode | null = null;

function audioContext() {
  try {
    if (!context || context.state === 'closed') {
      const Audio =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Audio) return null;
      context = new Audio();
      volume = null;
    }
    return context;
  } catch {
    return null;
  }
}

const CLICK_PITCH = {
  pop: 560,
  review: 440,
  read: 620,
  islands: 520,
  party: 760,
  profile: 680,
  node: 850,
  toggle: 720,
  close: 380,
} as const;
type ClickSound = keyof typeof CLICK_PITCH;

/** A quiet, rounded toy pop; sound is only requested by explicit user actions. */
export function playClickSound(sound: ClickSound = 'pop') {
  const audio = audioContext();
  if (!audio) return;
  const now = audio.currentTime;
  void audio.resume().catch(() => {});
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(CLICK_PITCH[sound] * 1.8, now);
  oscillator.frequency.exponentialRampToValueAtTime(CLICK_PITCH[sound] * 0.55, now + 0.11);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
  oscillator.start(now);
  oscillator.stop(now + 0.16);
}

export function playControlSound(target: EventTarget | null) {
  if (!(target instanceof Element)) return;
  const control = target.closest(
    'button, a[href], [role="button"], [role="tab"], [role="switch"], [role="checkbox"]',
  );
  if (!control || control.matches(':disabled, [aria-disabled="true"]')) return;
  const tour = control.getAttribute('data-tour');
  const sound: ClickSound =
    tour && tour in CLICK_PITCH
      ? (tour as ClickSound)
      : control.closest('.kg-canvas')
        ? 'node'
        : control.matches('[role="switch"], [role="checkbox"]')
          ? 'toggle'
          : control.getAttribute('aria-label') === '关闭'
            ? 'close'
            : 'pop';
  playClickSound(sound);
}

export function setSeaAudio(enabled: boolean) {
  if (!enabled) {
    if (context && volume) volume.gain.setTargetAtTime(0, context.currentTime, 0.15);
    return;
  }
  const audio = audioContext();
  if (!audio) return;
  if (!volume) {
    const buffer = audio.createBuffer(1, audio.sampleRate * 4, audio.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < data.length; i++) {
      previous = (previous + (Math.random() * 2 - 1) * 0.035) / 1.035;
      data[i] = previous * 4;
    }
    const noise = audio.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const filter = audio.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 950;
    volume = audio.createGain();
    volume.gain.value = 0;
    noise.connect(filter);
    filter.connect(volume);
    volume.connect(audio.destination);
    noise.start();
  }
  void audio.resume().catch(() => {});
  volume.gain.setTargetAtTime(0.14, audio.currentTime, 0.3);
}
