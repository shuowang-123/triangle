// 声音：全部用 WebAudio 实时合成，不需要任何音频文件。
window.Sfx = (function () {
  let ctx = null, master = null, musicGain = null, noiseBuf = null;
  let soundOn = true, musicOn = true;
  let lastShot = 0, musicTimer = null, step = 0, nextNoteTime = 0;

  try {
    soundOn = localStorage.getItem('tri_sound') !== 'off';
    musicOn = localStorage.getItem('tri_music') !== 'off';
  } catch (e) { /* 无痕模式下 localStorage 可能不可用 */ }

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = soundOn ? 0.55 : 0;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = musicOn ? 0.18 : 0;
    musicGain.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    startMusic();
  }

  function tone(freq, dur, type, vol, slideTo, when, dest) {
    if (!ctx) return;
    const t = when || ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol || 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(dur, vol, freq, when, dest) {
    if (!ctx) return;
    const t = when || ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq || 1200, t);
    f.frequency.exponentialRampToValueAtTime(60, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  // 背景音乐：简单的电子低音 + 琶音循环
  const bass = [55, 55, 65.4, 49, 55, 55, 73.4, 65.4];
  const arp = [440, 523.3, 659.3, 523.3, 392, 493.9, 587.3, 493.9];
  function startMusic() {
    if (musicTimer || !ctx) return;
    nextNoteTime = ctx.currentTime + 0.1;
    musicTimer = setInterval(() => {
      if (!ctx) return;
      while (nextNoteTime < ctx.currentTime + 0.25) {
        const beat = 0.15;
        const bar = Math.floor(step / 8) % bass.length;
        if (step % 2 === 0) tone(bass[bar], 0.28, 'sawtooth', 0.35, null, nextNoteTime, musicGain);
        tone(arp[(step + bar) % arp.length] * (bar % 4 === 3 ? 1.122 : 1), 0.12, 'square', 0.08, null, nextNoteTime, musicGain);
        if (step % 4 === 0) kick(nextNoteTime);
        if (step % 8 === 4) noise(0.12, 0.5, 3000, nextNoteTime, musicGain);
        if (step % 16 === 14) noise(0.08, 0.3, 3000, nextNoteTime, musicGain);
        step++;
        nextNoteTime += beat;
      }
    }, 60);
  }
  function kick(t) {
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g); g.connect(musicGain);
    o.start(t); o.stop(t + 0.2);
  }

  return {
    init,
    get soundOn() { return soundOn; },
    get musicOn() { return musicOn; },
    setSound(on) {
      soundOn = on;
      try { localStorage.setItem('tri_sound', on ? 'on' : 'off'); } catch (e) {}
      if (master) master.gain.value = on ? 0.55 : 0;
    },
    setMusic(on) {
      musicOn = on;
      try { localStorage.setItem('tri_music', on ? 'on' : 'off'); } catch (e) {}
      if (musicGain) musicGain.gain.value = on ? 0.18 : 0;
    },
    shoot() {
      if (!ctx) return;
      const now = ctx.currentTime;
      if (now - lastShot < 0.06) return; // 部队很多时避免太吵
      lastShot = now;
      tone(900 + Math.random() * 300, 0.08, 'square', 0.05, 300);
    },
    hit() { tone(220, 0.06, 'triangle', 0.12, 120); },
    boom(big) {
      noise(big ? 1.2 : 0.4, big ? 0.9 : 0.35, big ? 2000 : 1400);
      tone(big ? 90 : 140, big ? 0.8 : 0.3, 'sine', big ? 0.6 : 0.3, 30);
    },
    pickup() { tone(660, 0.1, 'sine', 0.25, 1320); },
    gem() { tone(1200 + Math.random() * 400, 0.06, 'sine', 0.08); },
    recruit() {
      tone(523, 0.12, 'triangle', 0.3);
      tone(784, 0.18, 'triangle', 0.3, null, ctx ? ctx.currentTime + 0.08 : 0);
    },
    levelUp() {
      if (!ctx) return;
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.3, null, ctx.currentTime + i * 0.08));
    },
    correct() {
      if (!ctx) return;
      tone(784, 0.15, 'sine', 0.35, null, ctx.currentTime);
      tone(1175, 0.3, 'sine', 0.35, null, ctx.currentTime + 0.12);
    },
    wrong() { tone(160, 0.35, 'sawtooth', 0.25, 90); },
    hurt() { tone(300, 0.2, 'sawtooth', 0.3, 80); noise(0.2, 0.3, 800); },
    super() {
      noise(1.5, 1, 4000);
      tone(60, 1.2, 'sawtooth', 0.5, 20);
      tone(1500, 0.6, 'sine', 0.2, 200);
    },
    warn() {
      if (!ctx) return;
      for (let i = 0; i < 3; i++) tone(440, 0.25, 'square', 0.18, 330, ctx.currentTime + i * 0.4);
    },
    throwIt() { noise(0.3, 0.25, 3000); tone(500, 0.2, 'sine', 0.12, 200); },
    jump() { tone(300, 0.12, 'sine', 0.15, 600); },
    headshot() {
      if (!ctx) return;
      tone(1400, 0.08, 'square', 0.12, null, ctx.currentTime);
      tone(1900, 0.12, 'square', 0.12, null, ctx.currentTime + 0.06);
    },
    blaster() {
      if (!ctx) return;
      const now = ctx.currentTime;
      if (now - lastShot < 0.05) return;
      lastShot = now;
      tone(1300, 0.09, 'sawtooth', 0.09, 220);
      noise(0.06, 0.12, 5000);
    },
    enemyShot() { tone(500, 0.12, 'square', 0.05, 250); },
    rifle() { noise(0.09, 0.4, 6500); tone(170, 0.07, 'square', 0.16, 70); },
    shotgun() { noise(0.3, 0.7, 3500); tone(95, 0.25, 'sine', 0.45, 40); },
    sniper() { noise(0.4, 0.8, 8000); tone(1100, 0.35, 'sine', 0.1, 180); tone(70, 0.4, 'sine', 0.4, 30); },
    rocketFire() { noise(0.7, 0.45, 1600); tone(220, 0.55, 'sawtooth', 0.18, 70); },
    reload() {
      if (!ctx) return;
      tone(1400, 0.03, 'square', 0.12, null, ctx.currentTime);
      tone(800, 0.05, 'square', 0.12, null, ctx.currentTime + 0.3);
      tone(1800, 0.03, 'square', 0.12, null, ctx.currentTime + 0.55);
    },
    empty() { tone(2200, 0.03, 'square', 0.08); },
    complete() {
      if (!ctx) return;
      [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.3, 'triangle', 0.3, null, ctx.currentTime + i * 0.12));
    },
    wave() {
      if (!ctx) return;
      [392, 523, 659].forEach((f, i) => tone(f, 0.2, 'square', 0.15, null, ctx.currentTime + i * 0.1));
    },
  };
})();
