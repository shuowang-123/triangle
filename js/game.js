// 三角形部队 —— 主游戏逻辑（Three.js）
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const R = 52; // 战场半径

  // ================= 渲染器 / 场景 =================
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  $('game').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05030f);
  scene.fog = new THREE.Fog(0x05030f, 55, 140);
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 500);
  camera.position.set(0, 26, 20);

  scene.add(new THREE.HemisphereLight(0x99aaff, 0x330044, 0.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.3);
  sun.position.set(20, 40, 15);
  scene.add(sun);

  // 发光贴图（用 canvas 画一个径向渐变）
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.2, 'rgba(255,255,255,0.85)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.25)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  function emojiTex(ch) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.font = '100px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ch, 64, 70);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function glowSprite(color, size, opacity) {
    const m = new THREE.SpriteMaterial({
      map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      opacity: opacity == null ? 0.9 : opacity, toneMapped: false,
    });
    const s = new THREE.Sprite(m);
    s.scale.setScalar(size);
    return s;
  }

  // ---------- 霓虹地面 ----------
  const floorMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPlayer: { value: new THREE.Vector3() }, uR: { value: R } },
    vertexShader: `varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uPlayer; uniform float uR; varying vec3 vW;
      float grid(vec2 p, float s, float w){
        vec2 g = abs(fract(p / s - 0.5) - 0.5) * s;
        vec2 fw = fwidth(p) * 1.2 + w;
        vec2 l = 1.0 - smoothstep(vec2(0.0), fw, g);
        return max(l.x, l.y);
      }
      void main(){
        float d = length(vW.xz);
        vec3 c1 = mix(vec3(0.1,0.45,1.0), vec3(0.85,0.2,1.0), 0.5 + 0.5 * sin(d * 0.08 - uTime * 0.7));
        float g1 = grid(vW.xz, 4.0, 0.02);
        float g2 = grid(vW.xz, 20.0, 0.07);
        float pd = length(vW.xz - uPlayer.xz);
        float wave = mod(uTime * 16.0, 48.0);
        float pulse = smoothstep(2.5, 0.0, abs(pd - wave)) * (1.0 - wave / 48.0);
        vec3 col = vec3(0.015,0.01,0.05) + c1 * (g1 * 0.32 + g2 * 0.75) + c1 * pulse * (0.15 + g1 * 0.8);
        col += vec3(0.2,0.6,1.0) * smoothstep(9.0, 0.0, pd) * 0.18;
        float edge = smoothstep(uR - 2.0, uR, d) * (1.0 - smoothstep(uR, uR + 0.8, d));
        col += vec3(1.0,0.25,0.6) * edge * 2.2;
        if (d > uR) col *= 0.3;
        col *= 1.0 - smoothstep(70.0, 130.0, d);
        gl_FragColor = vec4(col, 1.0);
      }`,
    extensions: { derivatives: true },
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // ---------- 场地边缘的发光三角柱 ----------
  const pillars = [];
  {
    const geo = new THREE.CylinderGeometry(1, 1, 7, 3);
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2;
      const col = i % 2 ? 0xff2d95 : 0x2d9bff;
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1, flatShading: true }));
      m.position.set(Math.cos(a) * (R + 3), 3.5, Math.sin(a) * (R + 3));
      m.rotation.y = -a;
      const gs = glowSprite(col, 7, 0.7); gs.position.y = 4.5; m.add(gs);
      scene.add(m);
      pillars.push(m);
    }
  }

  // ---------- 星空 + 天上旋转的大三角 ----------
  {
    const n = 1800, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI * 0.45;
      const r = rand(180, 260);
      pos[i * 3] = Math.cos(th) * Math.sin(ph) * r;
      pos[i * 3 + 1] = Math.cos(ph) * r * 0.7 + 10;
      pos[i * 3 + 2] = Math.sin(th) * Math.sin(ph) * r;
      c.setHSL(rand(0.5, 0.85), 0.8, rand(0.6, 0.95));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 2.2, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    scene.add(stars);
  }
  const skyTris = [];
  [[0x2d9bff, 60, -120, 40, -150], [0xff2d95, 45, 130, 55, -110], [0xffe15a, 30, 0, 75, -200], [0xb84dff, 50, -150, 30, 120]].forEach(([col, size, x, y, z]) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(size, size * 0.03, 4, 3),
      new THREE.MeshBasicMaterial({ color: col, fog: false, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    scene.add(m);
    skyTris.push(m);
  });

  // ================= 三角形士兵 =================
  const triGeo = new THREE.ConeGeometry(0.75, 1.7, 3);
  triGeo.rotateX(Math.PI / 2);   // 尖头朝 +Z（前方）
  triGeo.rotateZ(Math.PI);       // 平的一面朝下
  triGeo.scale(1, 0.65, 1);
  const triEdges = new THREE.EdgesGeometry(triGeo);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  const TROOP_COLORS = [0x2d7bff, 0x00e5ff, 0xb84dff, 0xffd21f, 0x3dffb0, 0xff6ad5];

  function makeTri(color, scale) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, metalness: 0.2, roughness: 0.35, flatShading: true });
    const mesh = new THREE.Mesh(triGeo, mat);
    const edges = new THREE.LineSegments(triEdges, edgeMat);
    const glow = glowSprite(color, 3.4, 0.5);
    glow.position.y = -0.3;
    g.add(mesh, edges, glow);
    g.scale.setScalar(scale);
    g.userData = { mesh, mat, glow, color };
    return g;
  }

  // 指挥官
  const commander = makeTri(0x7ef9ff, 1.8);
  const crown = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.09, 6, 3),
    new THREE.MeshStandardMaterial({ color: 0xffd21f, emissive: 0xffaa00, emissiveIntensity: 1.2, metalness: 0.8, roughness: 0.2 }));
  crown.rotation.x = Math.PI / 2;
  crown.position.y = 1.1;
  commander.add(crown);
  const cmdRing = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.7, 3),
    new THREE.MeshBasicMaterial({ color: 0x7ef9ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
  cmdRing.rotation.x = -Math.PI / 2;
  cmdRing.position.y = -0.35;
  commander.add(cmdRing);
  const cmdLight = new THREE.PointLight(0x7ef9ff, 18, 20, 1.6);
  cmdLight.position.y = 2;
  commander.add(cmdLight);
  commander.position.y = 0.8;
  scene.add(commander);

  // ================= 对象池：子弹、粒子、碎片、光环 =================
  const matCache = {};
  function basicMat(color) {
    return matCache[color] || (matCache[color] = new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  }
  const spriteMatCache = {};
  function sharedGlowMat(color, op) {
    const k = color + '_' + op;
    return spriteMatCache[k] || (spriteMatCache[k] = new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: op, toneMapped: false }));
  }

  // 子弹
  const bulletGeo = new THREE.BoxGeometry(0.2, 0.2, 1.3);
  const orbGeo = new THREE.IcosahedronGeometry(0.45, 1);
  const bullets = [], eBullets = [];
  function getBullet(list, enemy) {
    for (const b of list) if (!b.alive) return b;
    if (list.length > 500) return null;
    const mesh = new THREE.Mesh(enemy ? orbGeo : bulletGeo, basicMat(0xffffff));
    const glow = new THREE.Sprite(sharedGlowMat(0xffffff, 0.8));
    glow.scale.setScalar(enemy ? 2.6 : 1.6);
    mesh.add(glow);
    scene.add(mesh);
    const b = { mesh, glow, vel: new THREE.Vector3(), life: 0, dmg: 1, pierce: 0, hits: [], alive: false };
    list.push(b);
    return b;
  }
  function fireBullet(from, dir, color, dmg) {
    const b = getBullet(bullets, false);
    if (!b) return;
    b.alive = true; b.mesh.visible = true;
    b.mesh.position.copy(from);
    b.vel.copy(dir).setY(0).normalize().multiplyScalar(48);
    b.mesh.material = basicMat(color);
    b.glow.material = sharedGlowMat(color, 0.8);
    b.mesh.lookAt(tmpV.copy(b.mesh.position).add(b.vel));
    b.life = S.range / 48 + 0.1;
    b.dmg = dmg; b.pierce = S.pierce; b.hits.length = 0;
  }
  function fireOrb(from, dir, speed) {
    const b = getBullet(eBullets, true);
    if (!b) return;
    b.alive = true; b.mesh.visible = true;
    b.mesh.position.copy(from).setY(1);
    b.vel.copy(dir).setY(0).normalize().multiplyScalar(speed);
    b.mesh.material = basicMat(0xff2255);
    b.glow.material = sharedGlowMat(0xff2255, 0.9);
    b.life = 5;
  }

  // 粒子
  const P_N = 3500;
  const pPos = new Float32Array(P_N * 3), pCol = new Float32Array(P_N * 3), pVel = new Float32Array(P_N * 3);
  const pBase = new Float32Array(P_N * 3), pLife = new Float32Array(P_N), pMax = new Float32Array(P_N);
  let pIdx = 0;
  for (let i = 0; i < P_N; i++) pPos[i * 3 + 1] = -100;
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
    size: 0.9, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  particles.frustumCulled = false;
  scene.add(particles);
  const tmpC = new THREE.Color(), tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

  function emit(pos, color, count, speed, life, upBias) {
    tmpC.set(color);
    for (let n = 0; n < count; n++) {
      const i = pIdx; pIdx = (pIdx + 1) % P_N;
      const th = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, s = Math.sqrt(1 - u * u);
      const sp = speed * rand(0.25, 1);
      pPos[i * 3] = pos.x; pPos[i * 3 + 1] = pos.y; pPos[i * 3 + 2] = pos.z;
      pVel[i * 3] = Math.cos(th) * s * sp;
      pVel[i * 3 + 1] = Math.abs(u) * sp * 0.8 + (upBias || 0);
      pVel[i * 3 + 2] = Math.sin(th) * s * sp;
      const k = rand(0.7, 1.3);
      pBase[i * 3] = tmpC.r * k; pBase[i * 3 + 1] = tmpC.g * k; pBase[i * 3 + 2] = tmpC.b * k;
      pLife[i] = pMax[i] = life * rand(0.5, 1);
    }
  }
  function updateParticles(dt) {
    const damp = Math.max(0, 1 - 2.2 * dt);
    for (let i = 0; i < P_N; i++) {
      if (pLife[i] <= 0) continue;
      pLife[i] -= dt;
      const j = i * 3;
      if (pLife[i] <= 0) { pCol[j] = pCol[j + 1] = pCol[j + 2] = 0; pPos[j + 1] = -100; continue; }
      pPos[j] += pVel[j] * dt; pPos[j + 1] += pVel[j + 1] * dt; pPos[j + 2] += pVel[j + 2] * dt;
      pVel[j] *= damp; pVel[j + 2] *= damp; pVel[j + 1] = pVel[j + 1] * damp - 6 * dt;
      if (pPos[j + 1] < 0.1) { pPos[j + 1] = 0.1; pVel[j + 1] *= -0.4; }
      const f = pLife[i] / pMax[i];
      pCol[j] = pBase[j] * f; pCol[j + 1] = pBase[j + 1] * f; pCol[j + 2] = pBase[j + 2] * f;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
  }

  // 碎片
  const shardGeo = new THREE.TetrahedronGeometry(0.4);
  const shards = [];
  for (let i = 0; i < 160; i++) {
    const m = new THREE.Mesh(shardGeo, basicMat(0xffffff));
    m.visible = false; scene.add(m);
    shards.push({ m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, max: 1, s: 1 });
  }
  let shardIdx = 0;
  function spawnShards(pos, color, n, size) {
    for (let k = 0; k < n; k++) {
      const sh = shards[shardIdx]; shardIdx = (shardIdx + 1) % shards.length;
      sh.m.material = basicMat(color);
      sh.m.position.copy(pos);
      sh.vel.set(rand(-1, 1), rand(0.6, 1.6), rand(-1, 1)).multiplyScalar(9 * Math.sqrt(size));
      sh.spin.set(rand(-10, 10), rand(-10, 10), rand(-10, 10));
      sh.life = sh.max = rand(0.7, 1.3);
      sh.s = rand(0.6, 1.4) * Math.sqrt(size);
      sh.m.visible = true;
    }
  }
  function updateShards(dt) {
    for (const sh of shards) {
      if (sh.life <= 0) continue;
      sh.life -= dt;
      if (sh.life <= 0) { sh.m.visible = false; continue; }
      sh.vel.y -= 25 * dt;
      sh.m.position.addScaledVector(sh.vel, dt);
      if (sh.m.position.y < 0.2) { sh.m.position.y = 0.2; sh.vel.y *= -0.45; sh.vel.x *= 0.7; sh.vel.z *= 0.7; }
      sh.m.rotation.x += sh.spin.x * dt; sh.m.rotation.y += sh.spin.y * dt; sh.m.rotation.z += sh.spin.z * dt;
      sh.m.scale.setScalar(sh.s * Math.min(1, sh.life / sh.max * 2));
    }
  }

  // 冲击光环
  const ringGeo = new THREE.RingGeometry(0.85, 1, 64);
  const rings = [];
  for (let i = 0; i < 30; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m);
    rings.push({ m, life: 0, max: 1, size: 1, delay: 0 });
  }
  let ringIdx = 0;
  function spawnRing(pos, color, size, life, delay) {
    const r = rings[ringIdx]; ringIdx = (ringIdx + 1) % rings.length;
    r.m.material.color.set(color);
    r.m.position.set(pos.x, 0.3, pos.z);
    r.life = r.max = life; r.size = size; r.delay = delay || 0;
    r.m.visible = false; r.m.scale.setScalar(0.01);
  }
  function updateRings(dt) {
    for (const r of rings) {
      if (r.life <= 0) continue;
      if (r.delay > 0) { r.delay -= dt; continue; }
      r.life -= dt;
      if (r.life <= 0) { r.m.visible = false; continue; }
      r.m.visible = true;
      const t = 1 - r.life / r.max;
      r.m.scale.setScalar(0.5 + r.size * (1 - Math.pow(1 - t, 3)));
      r.m.material.opacity = (1 - t) * 0.9;
    }
  }

  // 闪光
  const flashes = [];
  for (let i = 0; i < 24; i++) {
    const s = glowSprite(0xffffff, 1, 1);
    s.visible = false; scene.add(s);
    flashes.push({ s, life: 0, max: 1, size: 1 });
  }
  let flashIdx = 0;
  function spawnFlash(pos, color, size, life) {
    const f = flashes[flashIdx]; flashIdx = (flashIdx + 1) % flashes.length;
    f.s.material.color.set(color);
    f.s.position.copy(pos).setY(Math.max(1, pos.y));
    f.life = f.max = life; f.size = size; f.s.visible = true;
  }
  function updateFlashes(dt) {
    for (const f of flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) { f.s.visible = false; continue; }
      const t = f.life / f.max;
      f.s.scale.setScalar(f.size * (1.4 - t * 0.4));
      f.s.material.opacity = t;
    }
  }

  let shake = 0;
  function explode(pos, color, size) {
    emit(pos, color, Math.round(22 * size), 10 * Math.sqrt(size), 0.9, 2);
    emit(pos, 0xffffff, Math.round(8 * size), 7 * Math.sqrt(size), 0.5, 1);
    emit(pos, 0xffaa33, Math.round(8 * size), 5 * Math.sqrt(size), 0.7, 3);
    spawnRing(pos, color, 3.5 * size, 0.45 + size * 0.1);
    spawnFlash(pos, color, 5 * size, 0.25 + size * 0.05);
    spawnShards(pos, color, Math.min(14, 3 + Math.round(size * 2)), size);
    shake = Math.max(shake, Math.min(1.4, 0.12 * size));
    Sfx.boom(size >= 3);
  }

  // 飘字（用 HTML 叠加，清晰好看）
  const floatersEl = $('floaters');
  function floatText(pos, text, color, size) {
    if (floatersEl.childElementCount > 35) return;
    tmpV2.copy(pos).project(camera);
    if (tmpV2.z > 1) return;
    const d = document.createElement('div');
    d.className = 'floater';
    d.textContent = text;
    d.style.left = ((tmpV2.x * 0.5 + 0.5) * innerWidth) + 'px';
    d.style.top = ((-tmpV2.y * 0.5 + 0.5) * innerHeight) + 'px';
    d.style.color = color || '#fff';
    if (size) d.style.fontSize = size + 'px';
    floatersEl.appendChild(d);
    setTimeout(() => d.remove(), 1000);
  }
  const flashEl = $('flash');
  function screenFlash(color, strength) {
    flashEl.style.transition = 'none';
    flashEl.style.background = color;
    flashEl.style.opacity = strength;
    requestAnimationFrame(() => {
      flashEl.style.transition = 'opacity .45s';
      flashEl.style.opacity = 0;
    });
  }
  const bannerEl = $('banner');
  function banner(main, sub, red) {
    bannerEl.querySelector('.b-main').textContent = main;
    bannerEl.querySelector('.b-sub').textContent = sub || '';
    bannerEl.classList.remove('hidden', 'show', 'red');
    void bannerEl.offsetWidth;
    bannerEl.classList.add('show');
    if (red) bannerEl.classList.add('red');
  }

  // ================= 游戏数据 =================
  let S = {};          // 能力数值
  let state = 'title'; // title | playing | paused | menu | dead | over
  let gameId = 0;
  let troops = [], enemies = [], pickups = [];
  let score = 0, wave = 0, level = 1, xp = 0, kills = 0, maxTroops = 0;
  let hp = 10, invuln = 0, superCharge = 0, combo = 0, comboTimer = 0;
  let spawnQueue = [], spawnTimer = 0, waveActive = false, recruitTimer = 0;
  let pendingLevels = 0, revivesLeft = 2, boss = null, cmdCooldown = 0;
  let best = 0;
  try { best = +localStorage.getItem('tri_best') || 0; } catch (e) {}
  $('bestScore').textContent = best;

  function resetStats() {
    S = { speed: 13, fireRate: 1, dmg: 1, multi: 0, pierce: 0, range: 20, maxHp: 10, superGain: 1, magnet: 7 };
  }
  resetStats();

  // ---------- 部队 ----------
  function slotOffset(i, t) {
    let ring = 1, cap = 6, idx = i;
    while (idx >= cap) { idx -= cap; ring++; cap = 6 * ring; }
    const rad = 0.6 + ring * 2.1;
    const a = idx / cap * Math.PI * 2 + ring * 0.5 + t * (ring % 2 ? 0.35 : -0.25);
    return tmpV2.set(Math.cos(a) * rad, 0, Math.sin(a) * rad);
  }
  function addTroop(fromPos) {
    if (troops.length >= 60) { score += 50; return false; }
    const col = TROOP_COLORS[Math.floor(Math.random() * TROOP_COLORS.length)];
    const g = makeTri(col, 0.95);
    g.position.copy(fromPos || commander.position);
    g.position.y = 0.7;
    scene.add(g);
    troops.push({ g, color: col, cool: Math.random() * 0.5, phase: Math.random() * 6 });
    emit(g.position, col, 16, 5, 0.6, 3);
    maxTroops = Math.max(maxTroops, troops.length);
    return true;
  }
  function killTroop(idx) {
    const t = troops[idx];
    explode(t.g.position, t.color, 0.8);
    scene.remove(t.g);
    t.g.userData.mat.dispose();
    t.g.userData.glow.material.dispose();
    troops.splice(idx, 1);
  }

  // ---------- 敌人 ----------
  const eyeWhiteGeo = new THREE.SphereGeometry(0.26, 12, 10);
  const pupilGeo = new THREE.SphereGeometry(0.13, 10, 8);
  const browGeo = new THREE.BoxGeometry(0.42, 0.09, 0.09);
  const eyeWhiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x110000 });
  const ETYPES = {
    cube:    { name: '方块怪', hp: 3, speed: 4.4, r: 1.0, color: 0xff3355, score: 10, xp: 1, dmg: 1, geo: new THREE.BoxGeometry(1.5, 1.5, 1.5) },
    spike:   { name: '尖刺球', hp: 2, speed: 7.8, r: 0.8, color: 0xff8a1f, score: 15, xp: 1, dmg: 1, geo: new THREE.IcosahedronGeometry(0.85, 0) },
    split:   { name: '分裂怪', hp: 7, speed: 3.6, r: 1.25, color: 0xff2dc8, score: 30, xp: 2, dmg: 1, geo: new THREE.DodecahedronGeometry(1.3, 0) },
    mini:    { name: '小方块', hp: 1, speed: 6.5, r: 0.6, color: 0xff6ad5, score: 5, xp: 0, dmg: 1, geo: new THREE.BoxGeometry(0.85, 0.85, 0.85) },
    tank:    { name: '石头巨人', hp: 18, speed: 2.4, r: 1.8, color: 0x9d4dff, score: 50, xp: 4, dmg: 2, geo: new THREE.OctahedronGeometry(2, 0) },
    shooter: { name: '炮台怪', hp: 6, speed: 3.2, r: 1.1, color: 0xff5500, score: 35, xp: 2, dmg: 1, geo: new THREE.ConeGeometry(1.2, 2.2, 4) },
    boss:    { name: '暗黑魔方王', hp: 260, speed: 2.3, r: 4.6, color: 0xff0044, score: 1000, xp: 20, dmg: 3, geo: new THREE.IcosahedronGeometry(4.2, 0) },
  };
  for (const k in ETYPES) ETYPES[k].edges = new THREE.EdgesGeometry(ETYPES[k].geo);

  let enemyUid = 0;
  function spawnEnemy(type, pos) {
    const T = ETYPES[type];
    const g = new THREE.Group();
    const body = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: T.color, emissive: T.color, emissiveIntensity: 0.35, flatShading: true, roughness: 0.35, metalness: 0.25 });
    body.add(new THREE.Mesh(T.geo, mat));
    body.add(new THREE.LineSegments(T.edges, new THREE.LineBasicMaterial({ color: 0xffd0d8, transparent: true, opacity: 0.7 })));
    g.add(body);
    // 生气的大眼睛
    const eyes = new THREE.Group();
    const es = T.r * 0.75;
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(eyeWhiteGeo, eyeWhiteMat);
      w.position.set(sx * 0.32 * es, 0.25 * es, 0);
      const p = new THREE.Mesh(pupilGeo, pupilMat);
      p.position.set(0, 0, 0.17);
      w.add(p);
      const b = new THREE.Mesh(browGeo, pupilMat);
      b.position.set(0, 0.3, 0.12);
      b.rotation.z = sx * 0.45;
      w.add(b);
      w.scale.setScalar(es);
      eyes.add(w);
    }
    eyes.position.z = T.r * 0.95;
    g.add(eyes);
    if (type === 'boss') {
      const crownB = new THREE.Mesh(new THREE.TorusGeometry(6.5, 0.25, 6, 3),
        new THREE.MeshBasicMaterial({ color: 0xff2255, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending }));
      crownB.rotation.x = Math.PI / 2;
      g.add(crownB);
      g.userData.crown = crownB;
      g.add(glowSprite(0xff0044, 18, 0.5));
    } else {
      g.add(glowSprite(T.color, T.r * 3.2, 0.35));
    }
    const hpMul = 1 + (wave - 1) * 0.16;
    const e = {
      id: ++enemyUid, type, T, g, body, mat,
      hp: Math.ceil(T.hp * hpMul), maxHp: Math.ceil(T.hp * hpMul),
      speed: T.speed * (1 + Math.min(0.45, wave * 0.025)) * rand(0.9, 1.1),
      r: T.r, flash: 0, kb: new THREE.Vector3(), shootT: rand(1.5, 3), spawnT: 0, phase: Math.random() * 6, spawnIn: 0.5,
    };
    g.position.copy(pos);
    g.position.y = T.r * 0.9;
    g.scale.setScalar(0.01);
    scene.add(g);
    enemies.push(e);
    return e;
  }
  function removeEnemy(e) {
    scene.remove(e.g);
    e.mat.dispose();
    const i = enemies.indexOf(e);
    if (i >= 0) enemies.splice(i, 1);
    if (e === boss) { boss = null; $('bossbox').classList.add('hidden'); }
  }
  function damageEnemy(e, dmg, silent) {
    if (e.hp <= 0) return;
    e.hp -= dmg;
    e.flash = 0.08;
    if (!silent) Sfx.hit();
    if (e.hp <= 0) killEnemy(e);
  }
  function killEnemy(e) {
    const p = e.g.position.clone();
    kills++;
    combo++; comboTimer = 2.2;
    const mult = 1 + Math.floor(combo / 10);
    const pts = e.T.score * mult;
    score += pts;
    superCharge = Math.min(100, superCharge + (e.type === 'boss' ? 60 : 3.5) * S.superGain);
    if (e.type === 'boss') {
      for (let i = 0; i < 6; i++) setTimeout(() => {
        if (state === 'title') return;
        explode(tmpV.set(p.x + rand(-5, 5), rand(1, 6), p.z + rand(-5, 5)).clone(), [0xff0044, 0xffe15a, 0xff8a1f][i % 3], 3.5);
      }, i * 160);
      screenFlash('#fff', 0.8);
      banner('打败大王！', '超级厉害！奖励 5 名士兵 🎉');
      for (let i = 0; i < 5; i++) addTroop(p);
      shake = 2;
    } else {
      explode(p, e.T.color, e.r * 1.2);
    }
    floatText(p.clone().setY(p.y + 1.5), '+' + pts, mult > 1 ? '#ffe15a' : '#fff', mult > 1 ? 30 : 22);
    if ([5, 10, 20, 30, 50, 75, 100].includes(combo)) {
      floatText(commander.position.clone().setY(4), `${combo} 连击！`, '#ff7a18', 44);
    }
    for (let i = 0; i < e.T.xp; i++) spawnPickup('gem', p);
    if (e.type === 'split') for (let i = 0; i < 3; i++) {
      const m = spawnEnemy('mini', tmpV.set(p.x + rand(-1.5, 1.5), 0, p.z + rand(-1.5, 1.5)));
      m.spawnIn = 0.15;
    }
    const roll = Math.random();
    if (e.type !== 'mini' && e.type !== 'boss') {
      if (roll < 0.06) spawnPickup('recruit', p);
      else if (roll < 0.085) spawnPickup('heart', p);
    }
    removeEnemy(e);
  }

  // ---------- 道具 ----------
  const gemGeo = new THREE.OctahedronGeometry(0.35, 0);
  const gemMat = new THREE.MeshStandardMaterial({ color: 0xffe15a, emissive: 0xffc400, emissiveIntensity: 1, flatShading: true });
  const beamGeo = new THREE.CylinderGeometry(0.5, 1.1, 4.5, 16, 1, true);
  const heartTex = emojiTex('❤️');
  function spawnPickup(kind, pos) {
    let g;
    if (kind === 'gem') {
      g = new THREE.Mesh(gemGeo, gemMat);
      g.add(new THREE.Sprite(sharedGlowMat(0xffc400, 0.6)));
      g.children[0].scale.setScalar(1.6);
    } else if (kind === 'recruit') {
      g = makeTri(0x5dff8a, 1.1);
      const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0x5dff8a, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      beam.position.y = 1.2;
      g.add(beam);
    } else {
      g = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, transparent: true, depthWrite: false }));
      g.scale.setScalar(2.4);
    }
    g.position.set(pos.x + (kind === 'gem' ? rand(-1.2, 1.2) : 0), 1, pos.z + (kind === 'gem' ? rand(-1.2, 1.2) : 0));
    scene.add(g);
    pickups.push({ kind, g, t: Math.random() * 6, life: kind === 'gem' ? 25 : 30, vel: new THREE.Vector3(rand(-4, 4), 7, rand(-4, 4)) });
  }
  function removePickup(i) {
    const p = pickups[i];
    scene.remove(p.g);
    if (p.kind === 'recruit') { p.g.userData.mat.dispose(); p.g.userData.glow.material.dispose(); p.g.children[3].material.dispose(); }
    if (p.kind === 'heart') p.g.material.dispose();
    pickups.splice(i, 1);
  }

  // ================= 输入 =================
  const keys = {};
  addEventListener('keydown', e => {
    Sfx.init();
    keys[e.code] = true;
    if (e.code === 'Space') { e.preventDefault(); if (state === 'playing') useSuper(); }
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'playing') pause(); else if (state === 'paused') resume();
    }
    if (state === 'menu' && !$('upgrade').classList.contains('hidden')) {
      const n = parseInt(e.key, 10);
      const cards = $('upgradeCards').children;
      if (n >= 1 && n <= cards.length) cards[n - 1].click();
    }
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (state === 'playing') pause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') pause(); });

  // 拖动摇杆（手指或鼠标）
  const joy = { active: false, id: null, sx: 0, sy: 0, x: 0, y: 0 };
  const joyBase = $('joyBase'), joyKnob = $('joyKnob');
  renderer.domElement.addEventListener('pointerdown', e => {
    Sfx.init();
    if (state !== 'playing' || joy.active) return;
    joy.active = true; joy.id = e.pointerId; joy.sx = e.clientX; joy.sy = e.clientY; joy.x = joy.y = 0;
    joyBase.style.left = e.clientX + 'px'; joyBase.style.top = e.clientY + 'px';
    joyKnob.style.transform = '';
    joyBase.classList.remove('hidden');
  });
  addEventListener('pointermove', e => {
    if (!joy.active || e.pointerId !== joy.id) return;
    let dx = e.clientX - joy.sx, dy = e.clientY - joy.sy;
    const len = Math.hypot(dx, dy), max = 60;
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    joy.x = dx / max; joy.y = dy / max;
    joyKnob.style.transform = `translate(${dx}px,${dy}px)`;
  });
  function endJoy(e) {
    if (!joy.active || (e && e.pointerId !== joy.id)) return;
    joy.active = false; joy.x = joy.y = 0;
    joyBase.classList.add('hidden');
  }
  addEventListener('pointerup', endJoy);
  addEventListener('pointercancel', endJoy);

  // ================= 界面按钮 =================
  function refreshToggles() {
    const L = Learn.enabled;
    ['learnToggle', 'learnToggle2'].forEach(id => { $(id).textContent = `📚 学习模式：${L ? '开' : '关'}`; $(id).classList.toggle('off', !L); });
    ['soundToggle', 'soundToggle2'].forEach(id => { $(id).textContent = `🔊 音效：${Sfx.soundOn ? '开' : '关'}`; $(id).classList.toggle('off', !Sfx.soundOn); });
    ['musicToggle', 'musicToggle2'].forEach(id => { $(id).textContent = `🎵 音乐：${Sfx.musicOn ? '开' : '关'}`; $(id).classList.toggle('off', !Sfx.musicOn); });
    $('learnBadge').textContent = `📚 学习模式 ${L ? '开' : '关'}`;
    $('learnBadge').classList.toggle('off', !L);
    $('learnTip').textContent = L
      ? `学习模式已打开：出发、过关、升级、复活前都要答对英语单词！已学会 ${Learn.seenCount()} / ${Learn.total} 个单词`
      : '学习模式已关闭：直接开打（打开学习模式还能获得复活机会哦）';
  }
  function bind(id, fn) { $(id).addEventListener('click', () => { Sfx.init(); fn(); }); }
  bind('learnToggle', () => { Learn.setEnabled(!Learn.enabled); refreshToggles(); });
  bind('learnToggle2', () => { Learn.setEnabled(!Learn.enabled); refreshToggles(); });
  bind('soundToggle', () => { Sfx.setSound(!Sfx.soundOn); refreshToggles(); });
  bind('soundToggle2', () => { Sfx.setSound(!Sfx.soundOn); refreshToggles(); });
  bind('musicToggle', () => { Sfx.setMusic(!Sfx.musicOn); refreshToggles(); });
  bind('musicToggle2', () => { Sfx.setMusic(!Sfx.musicOn); refreshToggles(); });
  bind('startBtn', () => newGame());
  bind('againBtn', () => newGame());
  bind('homeBtn', () => toTitle());
  bind('quitBtn', () => toTitle());
  bind('resumeBtn', () => resume());
  bind('pauseBtn', () => { if (state === 'playing') pause(); });
  bind('superBtn', () => { if (state === 'playing') useSuper(); });
  bind('bookBtn', () => {
    $('bookStats').textContent = `已学 ${Learn.seenCount()} 个 · 已掌握 ⭐ ${Learn.masteredCount()} 个 · 一共 ${Learn.total} 个`;
    $('bookGrid').innerHTML = Learn.bookHTML();
    $('book').classList.remove('hidden');
  });
  $('bookGrid').addEventListener('click', e => {
    const w = e.target.closest('.word');
    if (w && !w.classList.contains('locked')) Learn.speak(w.dataset.en);
  });
  bind('bookClose', () => $('book').classList.add('hidden'));
  refreshToggles();

  function pause() {
    state = 'paused';
    endJoy();
    refreshToggles();
    $('pause').classList.remove('hidden');
  }
  function resume() {
    $('pause').classList.add('hidden');
    state = 'playing';
  }

  // ================= 游戏流程 =================
  function clearWorld() {
    while (troops.length) { const t = troops.pop(); scene.remove(t.g); t.g.userData.mat.dispose(); }
    while (enemies.length) removeEnemy(enemies[0]);
    while (pickups.length) removePickup(0);
    for (const b of bullets) { b.alive = false; b.mesh.visible = false; }
    for (const b of eBullets) { b.alive = false; b.mesh.visible = false; }
    boss = null;
    $('bossbox').classList.add('hidden');
  }
  function hideScreens() {
    ['title', 'pause', 'upgrade', 'over', 'book'].forEach(id => $(id).classList.add('hidden'));
  }

  function toTitle() {
    gameId++;
    clearWorld();
    hideScreens();
    $('quiz').classList.add('hidden');
    $('hud').classList.add('hidden');
    bannerEl.classList.add('hidden');
    $('title').classList.remove('hidden');
    $('bestScore').textContent = best;
    commander.position.set(0, 0.8, 0);
    commander.visible = true;
    for (let i = 0; i < 14; i++) addTroop();
    state = 'title';
    refreshToggles();
  }

  async function newGame() {
    const id = ++gameId;
    clearWorld();
    hideScreens();
    resetStats();
    Learn.resetSession();
    score = 0; wave = 0; level = 1; xp = 0; kills = 0; maxTroops = 0;
    hp = S.maxHp; invuln = 0; superCharge = 30; combo = 0; pendingLevels = 0; revivesLeft = 2;
    commander.position.set(0, 0.8, 0);
    commander.visible = true;
    for (let i = 0; i < 5; i++) addTroop();
    $('hud').classList.remove('hidden');
    refreshToggles();
    state = 'menu';
    if (Learn.enabled) {
      await Learn.learnNew(2, '📚 出发前先背单词');
      if (id !== gameId) return;
    }
    startWave(1);
  }

  function buildWave(n) {
    const q = [];
    if (n % 5 === 0) {
      q.push('boss');
      for (let i = 0; i < 4 + n; i++) q.push(i % 3 === 0 ? 'spike' : 'cube');
      return q;
    }
    const count = 7 + n * 3;
    for (let i = 0; i < count; i++) {
      const opts = [['cube', 10]];
      if (n >= 2) opts.push(['spike', 6]);
      if (n >= 3) opts.push(['split', 3 + n * 0.3]);
      if (n >= 4) opts.push(['tank', 1.5 + n * 0.25]);
      if (n >= 6) opts.push(['shooter', 2 + n * 0.2]);
      let tot = opts.reduce((s, o) => s + o[1], 0), r = Math.random() * tot;
      for (const o of opts) { r -= o[1]; if (r <= 0) { q.push(o[0]); break; } }
    }
    return q;
  }

  function startWave(n) {
    wave = n;
    spawnQueue = buildWave(n);
    spawnTimer = 1.2;
    recruitTimer = 4;
    waveActive = true;
    state = 'playing';
    if (n % 5 === 0) {
      banner('⚠ 大王来袭 ⚠', `第 ${n} 波 · 暗黑魔方王出现了！`, true);
      Sfx.warn();
      screenFlash('#ff0033', 0.35);
    } else {
      banner(`第 ${n} 波`, ['准备战斗！', '冲啊！三角形部队！', '怪兽来了，保护指挥官！', '全体开火！'][n % 4]);
      Sfx.wave();
    }
  }

  function spawnPoint() {
    let bestP = null, bestD = -1;
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2, r = R - rand(2, 6);
      const p = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
      const d = p.distanceTo(commander.position);
      if (d > bestD) { bestD = d; bestP = p; }
      if (d > 26) break;
    }
    return bestP;
  }

  async function waveCleared() {
    const id = gameId;
    waveActive = false;
    const bonus = wave % 5 === 0 ? 0 : 2;
    banner(`第 ${wave} 波 胜利！`, bonus ? `奖励 ${bonus} 名士兵 + 回复生命 ❤️` : '回复生命 ❤️');
    Sfx.levelUp();
    for (let i = 0; i < bonus; i++) addTroop();
    hp = Math.min(S.maxHp, hp + 3);
    spawnRing(commander.position, 0xffe15a, 14, 0.9);
    // 把地上的水晶都吸过来
    for (const p of pickups) if (p.kind === 'gem') p.life = Math.min(p.life, 25), p.forced = true;
    await wait(2600);
    if (id !== gameId) return;
    while (state !== 'playing' || pendingLevels > 0) {
      await wait(200);
      if (id !== gameId) return;
    }
    if (Learn.enabled) {
      state = 'menu';
      const bossNext = (wave + 1) % 5 === 0;
      await Learn.learnNew(bossNext ? 3 : 2, bossNext ? '📚 大王要来了！先背单词' : '📚 背单词时间');
      if (id !== gameId) return;
    }
    startWave(wave + 1);
  }
  function wait(ms) {
    return new Promise(res => {
      let left = ms;
      const iv = setInterval(() => {
        // 暂停时不计时
        if (state === 'playing' || state === 'menu' || state === 'dead') left -= 100;
        if (left <= 0 || state === 'title' || state === 'over') { clearInterval(iv); res(); }
      }, 100);
    });
  }

  async function doLevelUp() {
    const id = gameId;
    state = 'menu';
    endJoy();
    Sfx.levelUp();
    spawnRing(commander.position, 0x7ef9ff, 10, 0.7);
    emit(commander.position, 0x7ef9ff, 60, 12, 1, 6);
    if (Learn.enabled) {
      await Learn.review(1, '⬆️ 升级啦！', '答对 1 个单词，解锁新能力！');
      if (id !== gameId) return;
    }
    showUpgrades();
  }

  const UPGRADES = [
    { icon: '🔺', name: '紧急招募', desc: '立刻增加 4 名三角形士兵', apply() { for (let i = 0; i < 4; i++) addTroop(); } },
    { icon: '🔥', name: '火力全开', desc: '全队射速 +25%', apply() { S.fireRate *= 1.25; } },
    { icon: '💥', name: '超级激光', desc: '子弹威力 +35%', apply() { S.dmg *= 1.35; } },
    { icon: '🔱', name: '三叉射击', desc: '指挥官每次多发射 2 颗子弹', ok: () => S.multi < 6, apply() { S.multi += 2; } },
    { icon: '👟', name: '飞毛腿', desc: '移动速度 +15%', ok: () => S.speed < 22, apply() { S.speed *= 1.15; } },
    { icon: '❤️', name: '钢铁之心', desc: '生命上限 +3，并且回满生命', apply() { S.maxHp += 3; hp = S.maxHp; } },
    { icon: '🏹', name: '穿甲弹', desc: '子弹能穿过 1 个怪兽继续飞', ok: () => S.pierce < 3, apply() { S.pierce++; } },
    { icon: '🎯', name: '鹰眼', desc: '射程 +20%，打得更远', ok: () => S.range < 34, apply() { S.range *= 1.2; } },
    { icon: '⚡', name: '冲击波大师', desc: '冲击波充能更快，现在立刻充满！', apply() { S.superGain *= 1.4; superCharge = 100; } },
    { icon: '🧲', name: '超级磁铁', desc: '更远就能吸到经验水晶', ok: () => S.magnet < 20, apply() { S.magnet *= 1.5; } },
  ];
  function showUpgrades() {
    const pool = UPGRADES.filter(u => !u.ok || u.ok());
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const picks = pool.slice(0, 3);
    if (troops.length < 4 && !picks.includes(UPGRADES[0])) picks[0] = UPGRADES[0]; // 兵太少时一定给招募
    const box = $('upgradeCards');
    box.innerHTML = '';
    picks.forEach((u, i) => {
      const d = document.createElement('div');
      d.className = 'ucard';
      d.innerHTML = `<div class="ui">${u.icon}</div><div class="un">${u.name}</div><div class="ud">${u.desc}</div><div class="uk">按 ${i + 1} 选择</div>`;
      d.onclick = () => {
        if (state !== 'menu') return;
        Sfx.pickup();
        u.apply();
        $('upgrade').classList.add('hidden');
        pendingLevels--;
        floatText(commander.position.clone().setY(3), u.icon + ' ' + u.name, '#ffe15a', 34);
        state = 'playing';
      };
      box.appendChild(d);
    });
    $('upgrade').classList.remove('hidden');
  }

  function useSuper() {
    if (superCharge < 100) return;
    superCharge = 0;
    const p = commander.position;
    Sfx.super();
    screenFlash('#bfe9ff', 0.7);
    shake = 1.6;
    spawnRing(p, 0x7ef9ff, 26, 0.8);
    spawnRing(p, 0xffe15a, 22, 0.8, 0.1);
    spawnRing(p, 0xff2d95, 18, 0.8, 0.2);
    spawnFlash(p, 0x7ef9ff, 30, 0.5);
    emit(p, 0x7ef9ff, 200, 30, 1.2, 2);
    emit(p, 0xffe15a, 120, 22, 1, 4);
    floatText(p.clone().setY(4), '⚡ 超级冲击波！', '#7ef9ff', 48);
    for (const b of eBullets) { b.alive = false; b.mesh.visible = false; }
    for (const e of enemies.slice()) {
      const d = e.g.position.distanceTo(p);
      if (d < 24) {
        e.kb.copy(e.g.position).sub(p).setY(0).normalize().multiplyScalar(30);
        damageEnemy(e, e.type === 'boss' ? 45 : 40 * S.dmg, true);
      }
    }
  }

  function hurtCommander(dmg) {
    if (invuln > 0 || state !== 'playing') return;
    hp -= dmg;
    invuln = 1.1;
    shake = Math.max(shake, 0.7);
    screenFlash('#ff0033', 0.4);
    Sfx.hurt();
    floatText(commander.position.clone().setY(3), '-' + dmg, '#ff5577', 34);
    combo = 0;
    if (hp <= 0) commanderDown();
  }

  async function commanderDown() {
    const id = gameId;
    hp = 0;
    state = 'dead';
    endJoy();
    commander.visible = false;
    explode(commander.position, 0x7ef9ff, 4);
    screenFlash('#fff', 0.8);
    await wait(1600);
    if (id !== gameId) return;
    if (Learn.enabled && revivesLeft > 0) {
      state = 'menu';
      const ok = await Learn.review(2, '💖 复活机会！', `答对 2 个单词就能复活指挥官（还剩 ${revivesLeft} 次机会）`, '不复活了，结束游戏');
      if (id !== gameId) return;
      if (ok) {
        revivesLeft--;
        hp = S.maxHp;
        invuln = 3;
        commander.visible = true;
        while (troops.length < 3) addTroop();
        state = 'playing';
        superCharge = 100;
        useSuper();
        banner('复活！', '继续战斗！💪');
        return;
      }
    }
    gameOver();
  }

  function gameOver() {
    state = 'over';
    const newBest = score > best;
    if (newBest) { best = score; try { localStorage.setItem('tri_best', best); } catch (e) {} }
    $('overTitle').textContent = wave >= 10 ? '🏆 超级英雄部队！' : '💥 部队被打败了';
    $('overStats').innerHTML = `
      分数 <b>${score}</b><br>
      到达第 <b>${wave}</b> 波 · 打败 <b>${kills}</b> 个怪兽<br>
      最大部队 <b>${maxTroops}</b> 人 · 等级 <b>${level}</b><br>
      ${Learn.enabled ? `本局答对 <b>${Learn.sessionRight}</b> 个单词 📚<br>` : ''}
      ${newBest ? '<span class="newbest">🎉 新纪录！</span>' : `最高分 ${best}`}`;
    $('over').classList.remove('hidden');
  }

  // ================= 每帧更新 =================
  const moveDir = new THREE.Vector3();
  let cmdFacing = 0;
  function nearestEnemy(pos, range) {
    let best = null, bd = range * range;
    for (const e of enemies) {
      if (e.spawnIn > 0) continue;
      const dx = e.g.position.x - pos.x, dz = e.g.position.z - pos.z;
      const d = dx * dx + dz * dz - e.r * e.r;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  function updateCommander(dt) {
    moveDir.set(0, 0, 0);
    if (keys.KeyW || keys.ArrowUp) moveDir.z -= 1;
    if (keys.KeyS || keys.ArrowDown) moveDir.z += 1;
    if (keys.KeyA || keys.ArrowLeft) moveDir.x -= 1;
    if (keys.KeyD || keys.ArrowRight) moveDir.x += 1;
    if (joy.active) { moveDir.x += joy.x; moveDir.z += joy.y; }
    const len = moveDir.length();
    if (len > 1) moveDir.divideScalar(len);
    const p = commander.position;
    p.addScaledVector(moveDir, S.speed * dt);
    const d = Math.hypot(p.x, p.z);
    if (d > R - 1.5) { p.x *= (R - 1.5) / d; p.z *= (R - 1.5) / d; }

    const target = nearestEnemy(p, S.range);
    let face = cmdFacing;
    if (target) face = Math.atan2(target.g.position.x - p.x, target.g.position.z - p.z);
    else if (len > 0.1) face = Math.atan2(moveDir.x, moveDir.z);
    let diff = face - cmdFacing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    cmdFacing += diff * Math.min(1, dt * 12);
    commander.rotation.y = cmdFacing;
    commander.rotation.z = -moveDir.x * 0.25;

    cmdCooldown -= dt;
    if (target && cmdCooldown <= 0) {
      cmdCooldown = 0.32 / S.fireRate;
      const n = 1 + S.multi;
      const base = Math.atan2(target.g.position.x - p.x, target.g.position.z - p.z);
      for (let i = 0; i < n; i++) {
        const a = base + (i - (n - 1) / 2) * 0.13;
        fireBullet(tmpV.set(p.x + Math.sin(a), 1, p.z + Math.cos(a)), tmpV2.set(Math.sin(a), 0, Math.cos(a)), 0x7ef9ff, 1.4 * S.dmg);
      }
      Sfx.shoot();
    }
    if (invuln > 0) {
      invuln -= dt;
      commander.visible = invuln <= 0 || Math.floor(invuln * 12) % 2 === 0;
    } else commander.visible = state !== 'dead' && state !== 'over';
  }

  function updateTroops(dt, t, combat) {
    for (let i = 0; i < troops.length; i++) {
      const tr = troops[i], g = tr.g;
      const off = slotOffset(i, t);
      const tx = commander.position.x + off.x, tz = commander.position.z + off.z;
      const k = Math.min(1, dt * 7);
      g.position.x += (tx - g.position.x) * k;
      g.position.z += (tz - g.position.z) * k;
      g.position.y = 0.75 + Math.sin(t * 4 + tr.phase) * 0.15;
      let target = combat ? nearestEnemy(g.position, S.range * 0.9) : null;
      const face = target ? Math.atan2(target.g.position.x - g.position.x, target.g.position.z - g.position.z) : cmdFacing;
      let diff = face - g.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      g.rotation.y += diff * Math.min(1, dt * 10);
      if (!combat) continue;
      tr.cool -= dt;
      if (target && tr.cool <= 0) {
        tr.cool = (0.6 / S.fireRate) * rand(0.9, 1.15);
        fireBullet(tmpV.copy(g.position).setY(1), tmpV2.set(target.g.position.x - g.position.x, 0, target.g.position.z - g.position.z), tr.color, S.dmg);
        Sfx.shoot();
      }
    }
  }

  function updateBullets(dt) {
    for (const b of bullets) {
      if (!b.alive) continue;
      b.life -= dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      if (b.life <= 0) { b.alive = false; b.mesh.visible = false; continue; }
      const bp = b.mesh.position;
      for (const e of enemies) {
        if (e.spawnIn > 0 || b.hits.includes(e.id)) continue;
        const dx = e.g.position.x - bp.x, dz = e.g.position.z - bp.z, rr = e.r + 0.35;
        if (dx * dx + dz * dz < rr * rr) {
          b.hits.push(e.id);
          emit(bp, b.mesh.material.color, 5, 6, 0.3, 1);
          e.kb.addScaledVector(b.vel, e.type === 'boss' ? 0.005 : 0.06);
          damageEnemy(e, b.dmg);
          if (b.pierce-- <= 0) { b.alive = false; b.mesh.visible = false; }
          break;
        }
      }
    }
    for (const b of eBullets) {
      if (!b.alive) continue;
      b.life -= dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      b.mesh.rotation.y += dt * 5;
      const bp = b.mesh.position;
      if (b.life <= 0 || Math.hypot(bp.x, bp.z) > R + 5) { b.alive = false; b.mesh.visible = false; continue; }
      let hit = false;
      for (let i = troops.length - 1; i >= 0; i--) {
        const tp = troops[i].g.position;
        if ((tp.x - bp.x) ** 2 + (tp.z - bp.z) ** 2 < 0.9) { killTroop(i); hit = true; break; }
      }
      if (!hit && commander.position.distanceToSquared(tmpV.set(bp.x, commander.position.y, bp.z)) < 1.6) {
        hurtCommander(1); hit = true;
      }
      if (hit) { b.alive = false; b.mesh.visible = false; emit(bp, 0xff2255, 12, 6, 0.4, 1); }
    }
  }

  function updateEnemies(dt, t) {
    const cp = commander.position;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i], g = e.g;
      if (e.spawnIn > 0) {
        e.spawnIn -= dt;
        g.scale.setScalar(Math.max(0.01, 1 - e.spawnIn / 0.5));
        continue;
      }
      g.scale.setScalar(1);
      let dx = cp.x - g.position.x, dz = cp.z - g.position.z;
      const dist = Math.hypot(dx, dz) || 1;
      dx /= dist; dz /= dist;
      let spd = e.speed * (boss === e && e.hp < e.maxHp / 2 ? 1.5 : 1);
      if (e.type === 'shooter' && dist < 15) spd = -e.speed * 0.5; // 炮台怪保持距离
      // 互相推开，避免挤成一团
      let sx = 0, sz = 0;
      for (let j = 0; j < enemies.length; j++) {
        if (j === i) continue;
        const o = enemies[j];
        const ox = g.position.x - o.g.position.x, oz = g.position.z - o.g.position.z;
        const rr = e.r + o.r;
        const d2 = ox * ox + oz * oz;
        if (d2 < rr * rr && d2 > 0.0001) { const d = Math.sqrt(d2); sx += ox / d * (rr - d); sz += oz / d * (rr - d); }
      }
      g.position.x += (dx * spd + e.kb.x) * dt + sx * 0.5 * (e.type === 'boss' ? 0.05 : 1);
      g.position.z += (dz * spd + e.kb.z) * dt + sz * 0.5 * (e.type === 'boss' ? 0.05 : 1);
      e.kb.multiplyScalar(Math.max(0, 1 - dt * 6));
      const ed = Math.hypot(g.position.x, g.position.z);
      if (ed > R) { g.position.x *= R / ed; g.position.z *= R / ed; }
      g.rotation.y = Math.atan2(dx, dz);
      g.position.y = e.r * 0.9 + Math.abs(Math.sin(t * 6 + e.phase)) * (e.type === 'boss' ? 0.6 : 0.35);
      e.body.rotation.x += dt * (e.type === 'spike' ? 6 : 1.2);
      e.body.rotation.z += dt * 0.7;
      if (g.userData.crown) g.userData.crown.rotation.z += dt * 1.5;
      if (e.flash > 0) {
        e.flash -= dt;
        e.mat.emissive.setHex(0xffffff); e.mat.emissiveIntensity = 1.5;
      } else { e.mat.emissive.setHex(e.T.color); e.mat.emissiveIntensity = 0.35; }

      // 射击
      if (e.type === 'shooter' || e.type === 'boss') {
        e.shootT -= dt;
        if (e.shootT <= 0) {
          if (e.type === 'shooter') {
            e.shootT = rand(2.2, 3.2);
            fireOrb(g.position, tmpV.set(dx, 0, dz), 11);
          } else {
            const angry = e.hp < e.maxHp / 2;
            e.shootT = angry ? 2.2 : 3;
            const n = angry ? 16 : 12, off = Math.random();
            for (let k = 0; k < n; k++) {
              const a = (k + off) / n * Math.PI * 2;
              fireOrb(g.position, tmpV.set(Math.cos(a), 0, Math.sin(a)), 10);
            }
            spawnRing(g.position, 0xff0044, 8, 0.5);
          }
        }
      }
      if (e.type === 'boss') {
        e.spawnT -= dt;
        if (e.spawnT <= 0) {
          e.spawnT = 7;
          for (let k = 0; k < 4; k++) {
            const a = Math.random() * Math.PI * 2;
            const m = spawnEnemy(Math.random() < 0.5 ? 'cube' : 'spike', tmpV.set(g.position.x + Math.cos(a) * 6, 0, g.position.z + Math.sin(a) * 6));
            m.spawnIn = 0.4;
          }
        }
      }

      // 撞到士兵
      for (let k = troops.length - 1; k >= 0; k--) {
        const tp = troops[k].g.position;
        const rr = e.r + 0.55;
        if ((tp.x - g.position.x) ** 2 + (tp.z - g.position.z) ** 2 < rr * rr) {
          killTroop(k);
          e.kb.set(-dx, 0, -dz).multiplyScalar(e.type === 'boss' ? 2 : 10);
          damageEnemy(e, e.type === 'boss' ? 3 : 2 * S.dmg, true);
          break;
        }
      }
      if (e.hp <= 0) { i--; continue; }
      // 撞到指挥官
      const rc = e.r + 1.1;
      if (dist < rc && state === 'playing') {
        hurtCommander(e.T.dmg);
        e.kb.set(-dx, 0, -dz).multiplyScalar(e.type === 'boss' ? 6 : 22);
      }
    }
  }

  function updatePickups(dt, t) {
    const cp = commander.position;
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i], g = p.g;
      p.t += dt; p.life -= dt;
      if (p.life <= 0) { removePickup(i); continue; }
      if (p.vel.lengthSq() > 0.01) {
        g.position.addScaledVector(p.vel, dt);
        p.vel.y -= 20 * dt;
        if (g.position.y < 0.8) { g.position.y = 0.8; p.vel.set(0, 0, 0); }
      } else {
        g.position.y = 0.9 + Math.sin(p.t * 3) * 0.25;
      }
      g.rotation.y += dt * 2.5;
      if (p.life < 4) g.visible = Math.floor(p.life * 6) % 2 === 0;
      const dx = cp.x - g.position.x, dz = cp.z - g.position.z;
      const d = Math.hypot(dx, dz);
      if (p.kind === 'gem' && (d < S.magnet || p.forced) && state === 'playing') {
        const sp = (p.forced ? 30 : 18) + (S.magnet - d) * 2;
        g.position.x += dx / d * sp * dt; g.position.z += dz / d * sp * dt;
      }
      if (d < (p.kind === 'gem' ? 1.3 : 2) && state === 'playing') {
        if (p.kind === 'gem') {
          xp++;
          Sfx.gem();
          const need = 4 + level * 3;
          if (xp >= need) { xp -= need; level++; pendingLevels++; }
        } else if (p.kind === 'recruit') {
          if (addTroop(g.position)) floatText(g.position.clone().setY(2.5), '+1 士兵！', '#5dff8a', 30);
          else floatText(g.position.clone().setY(2.5), '部队满员！+50', '#ffe15a', 26);
          Sfx.recruit();
          spawnRing(g.position, 0x5dff8a, 5, 0.5);
        } else {
          hp = Math.min(S.maxHp, hp + 2);
          floatText(g.position.clone().setY(2.5), '❤️ +2', '#ff5577', 30);
          Sfx.pickup();
        }
        removePickup(i);
      }
    }
  }

  function updateWave(dt) {
    if (!waveActive) return;
    spawnTimer -= dt;
    if (spawnQueue.length && spawnTimer <= 0) {
      spawnTimer = Math.max(0.35, 1.25 - wave * 0.06);
      const p = spawnPoint();
      const n = Math.min(spawnQueue.length, 1 + Math.floor(Math.random() * Math.min(4, 1 + wave / 2)));
      spawnRing(p, 0xff3355, 5, 0.6);
      emit(p, 0xff3355, 25, 6, 0.8, 8);
      for (let i = 0; i < n; i++) {
        const type = spawnQueue.shift();
        const e = spawnEnemy(type, tmpV.set(p.x + rand(-2, 2), 0, p.z + rand(-2, 2)));
        if (type === 'boss') {
          boss = e;
          $('bossname').textContent = `👑 ${e.T.name} · 第 ${wave / 5} 号`;
          $('bossbox').classList.remove('hidden');
          e.hp = e.maxHp = Math.ceil(ETYPES.boss.hp * (1 + (wave / 5 - 1) * 0.8));
          e.spawnIn = 1.2;
          shake = 1.2;
        }
      }
    }
    recruitTimer -= dt;
    if (recruitTimer <= 0) {
      recruitTimer = rand(6, 9);
      const nRec = pickups.filter(p => p.kind === 'recruit').length;
      if (nRec < 3 && troops.length < 60) {
        for (let k = 0; k < 8; k++) {
          const a = Math.random() * Math.PI * 2, r = rand(8, R * 0.75);
          const pos = tmpV.set(Math.cos(a) * r, 0, Math.sin(a) * r);
          if (pos.distanceTo(commander.position) > 10) {
            spawnPickup('recruit', pos);
            pickups[pickups.length - 1].vel.set(0, 0, 0);
            break;
          }
        }
      }
    }
    if (!spawnQueue.length && enemies.length === 0) waveCleared();
  }

  // ---------- HUD ----------
  const hudCache = {};
  function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
  function setWidth(id, v) { const s = v.toFixed(1) + '%'; if (hudCache[id] !== s) { hudCache[id] = s; $(id).style.width = s; } }
  function updateHUD() {
    setText('score', score);
    setText('wave', wave);
    setText('level', level);
    setText('troops', troops.length);
    setWidth('hpbar', Math.max(0, hp) / S.maxHp * 100);
    setWidth('xpbar', xp / (4 + level * 3) * 100);
    setWidth('superFill', superCharge);
    const ready = superCharge >= 100;
    setText('superText', ready ? '⚡ 超级冲击波 准备好了！按空格' : `⚡ 超级冲击波 ${Math.floor(superCharge)}%`);
    $('superBtn').classList.toggle('ready', ready);
    if (boss) setWidth('bossbar', Math.max(0, boss.hp) / boss.maxHp * 100);
  }

  // ---------- 镜头 ----------
  const camTarget = new THREE.Vector3();
  function updateCamera(dt, t) {
    if (state === 'title') {
      const a = t * 0.15;
      camera.position.set(Math.cos(a) * 24, 11 + Math.sin(t * 0.3) * 2, Math.sin(a) * 24);
      camTarget.set(0, 1.5, 0);
    } else {
      const portrait = innerHeight > innerWidth;
      const far = (portrait ? 1.45 : 1) * (1 + Math.min(0.35, troops.length / 120));
      const want = tmpV.set(commander.position.x, 25 * far, commander.position.z + 19 * far);
      camera.position.lerp(want, Math.min(1, dt * 4));
      camTarget.lerp(tmpV2.copy(commander.position).setY(0), Math.min(1, dt * 6));
    }
    if (shake > 0) {
      camera.position.x += rand(-1, 1) * shake * 0.6;
      camera.position.y += rand(-1, 1) * shake * 0.6;
      shake = Math.max(0, shake - dt * 2.5);
    }
    camera.lookAt(camTarget);
  }

  // ---------- 主循环 ----------
  let last = performance.now(), time = 0, titleFx = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const running = state === 'playing' || state === 'dead';
    if (state !== 'paused' && state !== 'menu') time += dt;
    const t = time;

    floorMat.uniforms.uTime.value = t;
    floorMat.uniforms.uPlayer.value.copy(commander.position);
    skyTris.forEach((m, i) => { m.rotation.z += dt * (0.05 + i * 0.02); });
    pillars.forEach((m, i) => { m.material.emissiveIntensity = 0.7 + Math.sin(t * 3 + i * 0.8) * 0.4; });
    crown.rotation.z += dt * 2;
    cmdRing.rotation.z -= dt * 1.5;
    commander.position.y = 0.9 + Math.sin(t * 3) * 0.12;

    if (state === 'title') {
      commander.rotation.y += dt * 0.6;
      cmdFacing = commander.rotation.y;
      updateTroops(dt, t, false);
      titleFx -= dt;
      if (titleFx <= 0) {
        titleFx = rand(0.6, 1.4);
        const a = Math.random() * Math.PI * 2, r = rand(33, 46);
        explode(tmpV.set(Math.cos(a) * r, rand(4, 12), Math.sin(a) * r).clone(), TROOP_COLORS[Math.floor(Math.random() * TROOP_COLORS.length)], 1.6);
      }
    } else if (running) {
      if (state === 'playing') {
        updateCommander(dt);
        comboTimer -= dt;
        if (comboTimer <= 0) combo = 0;
        updateWave(dt);
      }
      updateTroops(dt, t, state === 'playing');
      updateBullets(dt);
      updateEnemies(dt, t);
      updatePickups(dt, t);
      if (state === 'playing' && pendingLevels > 0) doLevelUp();
    }
    if (state !== 'paused' && state !== 'menu') {
      updateParticles(dt);
      updateShards(dt);
      updateRings(dt);
      updateFlashes(dt);
    }
    if (state !== 'title') updateHUD();
    updateCamera(dt, t);
    renderer.render(scene, camera);
  }

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // 调试/测试用
  window.__game = {
    get state() { return state; }, get wave() { return wave; }, get enemies() { return enemies.length; },
    get troops() { return troops.length; }, get score() { return score; },
    killAll() { enemies.slice().forEach(e => damageEnemy(e, 9999, true)); },
    hurt(n) { invuln = 0; hurtCommander(n); },
    charge() { superCharge = 100; },
    spawn(kind) { spawnPickup(kind, tmpV.set(commander.position.x + 4, 0, commander.position.z)); pickups[pickups.length - 1].vel.set(0, 0, 0); },
    addXp(n) { for (let i = 0; i < n; i++) { xp++; const need = 4 + level * 3; if (xp >= need) { xp -= need; level++; pendingLevels++; } } },
  };

  toTitle();
  requestAnimationFrame(frame);
})();
