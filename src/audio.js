/**
 * Fully procedural ambience with the Web Audio API: sea waves, birds, a quiet
 * music-box melody and footsteps. No audio files needed.
 * Browsers only allow audio after a user gesture, so call start() from one.
 */
export function createAudio() {
  let ctx = null;
  let master = null;
  let seaGain = null;
  let muted = false;
  let noiseBuffer = null;
  let echo = null;

  function start() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ctx.destination);

    // Soft echo shared by the music and birds
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.32;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.35;
    delay.connect(feedback).connect(delay);
    delay.connect(master);
    echo = ctx.createGain();
    echo.gain.value = 0.5;
    echo.connect(delay);

    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    startSea();
    scheduleBird();
    scheduleMusic();
  }

  function startSea() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    seaGain = ctx.createGain();
    seaGain.gain.value = 0.05;
    // Slow swell like waves rolling in
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.12;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.5;
    const swell = ctx.createGain();
    swell.gain.value = 0.5;
    lfo.connect(lfoDepth).connect(swell.gain);
    src.connect(filter).connect(swell).connect(seaGain).connect(master);
    src.start();
    lfo.start();
  }

  function scheduleBird() {
    setTimeout(() => {
      if (ctx.state === 'running') chirp();
      scheduleBird();
    }, 2500 + Math.random() * 6000);
  }

  function chirp() {
    const t0 = ctx.currentTime;
    const base = 2200 + Math.random() * 1500;
    const count = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const t = t0 + i * 0.13;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.exponentialRampToValueAtTime(base * 1.4, t + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.025, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      osc.connect(g);
      g.connect(master);
      g.connect(echo);
      osc.start(t);
      osc.stop(t + 0.12);
    }
  }

  // Pentatonic music box: random walk over a gentle scale
  const scale = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66];
  let step = 2;
  function scheduleMusic() {
    setTimeout(() => {
      if (ctx.state === 'running' && Math.random() < 0.7) {
        step = Math.max(0, Math.min(scale.length - 1, step + Math.floor(Math.random() * 5) - 2));
        note(scale[step], 0.035);
        if (Math.random() < 0.25) note(scale[step] / 2, 0.025);
      }
      scheduleMusic();
    }, 600);
  }

  function note(freq, vol) {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    osc.connect(g);
    g.connect(master);
    g.connect(echo);
    osc.start(t);
    osc.stop(t + 1.7);
  }

  /** onWood: footsteps on the pier sound hollow */
  function footstep(onWood) {
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = onWood ? 'bandpass' : 'lowpass';
    filter.frequency.value = onWood ? 900 : 700;
    const g = ctx.createGain();
    g.gain.setValueAtTime(onWood ? 0.12 : 0.07, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    src.connect(filter).connect(g).connect(master);
    src.start(t, Math.random() * 1.5, 0.1);
  }

  /** 0 = island centre, 1 = standing at the shore */
  function setShoreProximity(v) {
    if (seaGain) seaGain.gain.setTargetAtTime(0.03 + v * 0.12, ctx.currentTime, 0.5);
  }

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.05);
    return muted;
  }

  return { start, footstep, setShoreProximity, toggleMute, isMuted: () => muted };
}
