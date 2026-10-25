let context: AudioContext | null = null;
let volume: GainNode | null = null;
export function setSeaAudio(enabled: boolean) {
  if (!enabled) {
    if (context && volume) volume.gain.setTargetAtTime(0, context.currentTime, 0.15);
    return;
  }
  if (!context) {
    context = new AudioContext();
    const buffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < data.length; i++) {
      previous = (previous + (Math.random() * 2 - 1) * 0.035) / 1.035;
      data[i] = previous * 4;
    }
    const noise = context.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 950;
    volume = context.createGain();
    volume.gain.value = 0;
    noise.connect(filter);
    filter.connect(volume);
    volume.connect(context.destination);
    noise.start();
  }
  void context.resume().catch(() => {});
  volume!.gain.setTargetAtTime(0.14, context.currentTime, 0.3);
}
