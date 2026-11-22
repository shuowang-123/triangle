// 声音：全部用 WebAudio 实时合成，不需要任何音频文件。
window.Sfx = (function () {
  let ctx = null, master = null, musicGain = null, noiseBuf = null, revIn = null;
  let soundOn = true, musicOn = true;
  let lastShot = 0, lastEnemy = 0, musicTimer = null, step = 0, nextNoteTime = 0;

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
    // 压缩器：很多声音叠在一起也不会爆音
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 8; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ctx.destination);
    // 混响：模拟野外山谷的回声（开枪后“嘭——”的尾音）
    try {
      const rev = ctx.createConvolver();
      rev.buffer = makeIR(2.6);
      revIn = ctx.createGain(); revIn.gain.value = 1;
      const revOut = ctx.createGain(); revOut.gain.value = 0.7;
      revIn.connect(rev); rev.connect(revOut); revOut.connect(master);
    } catch (e) { revIn = null; }
    musicGain = ctx.createGain();
    musicGain.gain.value = musicOn ? 0.18 : 0;
    musicGain.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    startMusic();
  }

  // 生成一段“脉冲响应”：几次远处山坡的回声 + 慢慢变暗、变小的混响尾巴
  function makeIR(sec) {
    const sr = ctx.sampleRate, len = Math.floor(sr * sec), buf = ctx.createBuffer(2, len, sr);
    const echoes = [[0.07, 0.35], [0.16, 0.22], [0.38, 0.28], [0.61, 0.14], [0.95, 0.08]];
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const k = 0.5 - t * 0.45; // 越往后越闷
        lp += k * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * Math.pow(1 - t, 3.2) * 0.5 * Math.min(1, i / (sr * 0.02));
      }
      for (const [at, g] of echoes) {
        const st = Math.floor((at + (ch ? 0.013 : 0)) * sr), w = Math.floor(sr * 0.05);
        let e = 0;
        for (let i = 0; i < w && st + i < len; i++) { e += 0.25 * ((Math.random() * 2 - 1) - e); d[st + i] += e * g * 2.2 * Math.pow(1 - i / w, 2); }
      }
    }
    return buf;
  }
  // 一段过滤过的噪声
  function nz(t, dur, vol, type, f, dest, fEnd, q) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const fl = ctx.createBiquadFilter();
    fl.type = type; fl.frequency.setValueAtTime(f, t);
    if (q) fl.Q.value = q;
    if (fEnd) fl.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(dest);
    s.start(t, Math.random() * 1.2); s.stop(t + dur + 0.05);
  }
  // 真实一点的枪声：尖锐的“啪”(超音速爆音) + 火药的“砰” + 低沉的冲击 + 回声；
  // 离得越远越小声、越闷、回声占比越大，还会晚一点点传过来
  const GUN = {
    pistol: { crack: 0.5, body: 0.55, bf: 3800, thump: 0.35, tf: 190, dur: 0.16, rev: 0.35 },
    smg: { crack: 0.38, body: 0.45, bf: 4800, thump: 0.25, tf: 210, dur: 0.11, rev: 0.25 },
    rifle: { crack: 0.65, body: 0.65, bf: 3300, thump: 0.5, tf: 140, dur: 0.2, rev: 0.42 },
    shotgun: { crack: 0.45, body: 0.95, bf: 2300, thump: 0.85, tf: 95, dur: 0.38, rev: 0.55 },
    dmr: { crack: 0.85, body: 0.75, bf: 3100, thump: 0.6, tf: 120, dur: 0.3, rev: 0.6 },
    sniper: { crack: 1, body: 0.85, bf: 2900, thump: 0.85, tf: 88, dur: 0.48, rev: 0.85 },
    lmg: { crack: 0.62, body: 0.62, bf: 3000, thump: 0.55, tf: 128, dur: 0.18, rev: 0.42 },
  };
  function gun(p, dist, vol) {
    if (!ctx) return;
    const far = Math.min(1, (dist || 0) / 70);
    const t = ctx.currentTime + (dist || 0) / 900;
    const out = ctx.createGain(); out.gain.value = (vol || 1) * (1 - far * 0.85);
    let dest = out;
    if (far > 0.02) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 12000 * Math.pow(0.1, far); lp.connect(out); dest = lp; }
    out.connect(master);
    if (revIn) { const send = ctx.createGain(); send.gain.value = p.rev * (0.7 + far * 2.2); out.connect(send); send.connect(revIn); }
    nz(t, 0.035, p.crack, 'highpass', 2600, dest);
    nz(t, 0.02, p.crack * 0.6, 'bandpass', 1800, dest, null, 0.8);
    nz(t, p.dur, p.body, 'lowpass', p.bf, dest, 150);
    tone(p.tf, p.dur * 0.9, 'sine', p.thump, 36, t, dest);
    tone(p.tf * 0.5, p.dur * 1.3, 'sine', p.thump * 0.5, 28, t, dest);
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
    // 队友开枪：远一点的步枪声
    shoot(dist) {
      if (!ctx) return;
      const now = ctx.currentTime;
      if (now - lastShot < 0.06) return; // 部队很多时避免太吵
      lastShot = now;
      gun(GUN.rifle, dist == null ? 15 : dist, 0.6);
    },
    hit() { tone(220, 0.06, 'triangle', 0.12, 120); },
    // 爆炸：开头一声炸响 + 很长的低沉轰鸣 + 山谷回声；远了会变闷、变晚
    boom(big, dist) {
      if (!ctx) return;
      const d = dist || 0, far = Math.min(1, d / 90), t = ctx.currentTime + d / 900;
      const out = ctx.createGain(); out.gain.value = 1 - far * 0.7;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000 * Math.pow(0.08, far); lp.connect(out);
      out.connect(master);
      if (revIn) { const send = ctx.createGain(); send.gain.value = big ? 1.1 : 0.7; out.connect(send); send.connect(revIn); }
      nz(t, 0.08, big ? 0.9 : 0.5, 'highpass', 1500, lp);
      nz(t, big ? 1.6 : 0.7, big ? 1 : 0.55, 'lowpass', big ? 2200 : 1600, lp, 60);
      tone(big ? 75 : 110, big ? 1.4 : 0.5, 'sine', big ? 0.9 : 0.45, 22, t, lp);
      tone(big ? 45 : 70, big ? 1.8 : 0.7, 'sine', big ? 0.6 : 0.3, 18, t, lp);
      // 碎片噼里啪啦落地
      if (big) for (let i = 0; i < 6; i++) nz(t + 0.3 + Math.random() * 0.9, 0.04, 0.08, 'bandpass', 2500 + Math.random() * 2000, lp, null, 2);
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
    enemyShot(dist) {
      if (!ctx) return;
      const now = ctx.currentTime;
      if (now - lastEnemy < 0.05) return;
      lastEnemy = now;
      gun(GUN.rifle, dist == null ? 30 : dist, 0.55);
    },
    rifle() { gun(GUN.rifle); },
    shotgun() { gun(GUN.shotgun); },
    sniper() { gun(GUN.sniper); },
    pistol() { gun(GUN.pistol); },
    smg() { gun(GUN.smg); },
    dmr() { gun(GUN.dmr); },
    lmg() { gun(GUN.lmg); },
    launcher() { noise(0.18, 0.35, 900); tone(110, 0.2, 'sine', 0.45, 50); },
    draw() { if (!ctx) return; noise(0.08, 0.12, 4000); tone(900, 0.03, 'square', 0.06, null, ctx.currentTime + 0.12); },
    shellIn() { tone(1100, 0.03, 'square', 0.1); noise(0.04, 0.12, 3000); },
    casing() { if (!ctx) return; tone(3200 + Math.random() * 800, 0.05, 'sine', 0.03); tone(4100, 0.04, 'sine', 0.02, null, ctx.currentTime + 0.06); },
    bolt() { if (!ctx) return; tone(700, 0.04, 'square', 0.12); tone(1300, 0.04, 'square', 0.1, null, ctx.currentTime + 0.18); },
    pump() { if (!ctx) return; noise(0.06, 0.25, 2500); noise(0.06, 0.25, 2500, ctx.currentTime + 0.16); },
    medStart() { noise(0.15, 0.15, 3000); tone(500, 0.1, 'sine', 0.1, 700); },
    medDone() { if (!ctx) return; [660, 880, 1100].forEach((f, i) => tone(f, 0.15, 'sine', 0.18, null, ctx.currentTime + i * 0.07)); },
    jet() { noise(0.14, 0.22, 900); },
    land() { noise(0.12, 0.3, 500); tone(80, 0.1, 'sine', 0.25, 40); },
    step() { noise(0.05, 0.06, 700); },
    chest() { if (!ctx) return; tone(220, 0.1, 'square', 0.12); tone(330, 0.1, 'square', 0.12, null, ctx.currentTime + 0.1); },
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
