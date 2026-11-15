// 三角形部队 —— 第一人称射击（Three.js）
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const R = 42; // 战场半径
  const isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
  if (isTouch) document.body.classList.add('touch');

  // ================= 渲染器 / 场景 =================
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  $('game').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05030f);
  scene.fog = new THREE.Fog(0x05030f, 30, 110);
  const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 500);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  scene.add(new THREE.HemisphereLight(0x99aaff, 0x330044, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(20, 40, 15);
  scene.add(sun);

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
        float g1 = grid(vW.xz, 2.0, 0.015);
        float g2 = grid(vW.xz, 10.0, 0.05);
        float pd = length(vW.xz - uPlayer.xz);
        float wave = mod(uTime * 14.0, 48.0);
        float pulse = smoothstep(2.0, 0.0, abs(pd - wave)) * (1.0 - wave / 48.0);
        vec3 col = vec3(0.015,0.01,0.05) + c1 * (g1 * 0.28 + g2 * 0.7) + c1 * pulse * (0.1 + g1 * 0.7);
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

  // ---------- 能量护盾墙 ----------
  const wallMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv;
      void main(){
        float a = (1.0 - vUv.y) * 0.55;
        float stripe = 0.5 + 0.5 * sin(vUv.x * 300.0 + uTime * 2.0);
        float scan = smoothstep(0.03, 0.0, abs(fract(vUv.y - uTime * 0.25) - 0.5));
        vec3 c = mix(vec3(1.0,0.2,0.6), vec3(0.2,0.6,1.0), vUv.y);
        gl_FragColor = vec4(c * (a * (0.5 + stripe * 0.5) + scan * 0.6), 1.0);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.6, R + 0.6, 6, 128, 1, true), wallMat);
  wall.position.y = 3;
  scene.add(wall);

  const pillars = [];
  {
    const geo = new THREE.CylinderGeometry(1, 1, 9, 3);
    for (let i = 0; i < 20; i++) {
      const a = i / 20 * Math.PI * 2;
      const col = i % 2 ? 0xff2d95 : 0x2d9bff;
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1, flatShading: true }));
      m.position.set(Math.cos(a) * (R + 2.5), 4.5, Math.sin(a) * (R + 2.5));
      m.rotation.y = -a;
      const gs = glowSprite(col, 7, 0.7); gs.position.y = 5.5; m.add(gs);
      scene.add(m);
      pillars.push(m);
    }
  }

  // ---------- 星空 + 天上的大三角 ----------
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
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 2.2, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
  }
  const skyTris = [];
  [[0x2d9bff, 60, -120, 60, -150], [0xff2d95, 45, 130, 70, -110], [0xffe15a, 30, 0, 95, -200], [0xb84dff, 50, -150, 50, 120], [0x2d9bff, 40, 140, 60, 140]].forEach(([col, size, x, y, z]) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(size, size * 0.03, 4, 3),
      new THREE.MeshBasicMaterial({ color: col, fog: false, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    scene.add(m);
    skyTris.push(m);
  });

  // ---------- 掩体（可以躲，也可以跳上去） ----------
  const obstacles = [];
  const OB_COLORS = [0x00e5ff, 0xff2d95, 0xb84dff, 0xffd21f];
  function addBox(x, z, w, d, h, ci) {
    const col = OB_COLORS[ci % OB_COLORS.length];
    const geo = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x15153a, emissive: col, emissiveIntensity: 0.08, roughness: 0.5, metalness: 0.4 }));
    m.position.set(x, h / 2, z);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: col, toneMapped: false }));
    m.add(e);
    scene.add(m);
    obstacles.push({ x, z, hx: w / 2, hz: d / 2, h });
  }
  [
    [10, 2, 3, 3, 2.2], [-11, 5, 3, 7, 3], [0, -13, 9, 2, 2.2], [8, 13, 3, 3, 4], [-9, -11, 3, 3, 1.6],
    [20, -9, 2, 9, 3], [-20, 13, 4, 4, 3.5], [23, 14, 3, 3, 2], [-23, -14, 7, 2, 2.4], [3, 24, 7, 2, 3],
    [-4, -26, 3, 3, 4], [29, -1, 2, 7, 2.5], [-30, 1, 3, 3, 3], [15, 25, 2, 2, 5], [-15, -25, 2, 2, 5],
    [16, -22, 4, 2, 1.8], [-15, 23, 2, 4, 1.8], [12, 3.5, 1.6, 1.6, 1.1], [-31, -9, 2.5, 2.5, 1.4], [31, 10, 2.5, 2.5, 1.4],
  ].forEach((b, i) => addBox(b[0], b[1], b[2], b[3], b[4], i));

  // 把圆形推出箱子。feetY 高于箱顶的就不挡（站在上面）
  function pushOut(p, r, feetY) {
    for (const o of obstacles) {
      if (feetY != null && feetY > o.h - 0.35) continue;
      const cx = clamp(p.x, o.x - o.hx, o.x + o.hx), cz = clamp(p.z, o.z - o.hz, o.z + o.hz);
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        p.x = cx + dx / d * r; p.z = cz + dz / d * r;
      } else {
        const px = o.hx - Math.abs(p.x - o.x) + r, pz = o.hz - Math.abs(p.z - o.z) + r;
        if (px < pz) p.x += (p.x >= o.x ? 1 : -1) * px; else p.z += (p.z >= o.z ? 1 : -1) * pz;
      }
    }
  }
  function groundAt(x, z, r, feetY) {
    let h = 0;
    for (const o of obstacles) {
      if (Math.abs(x - o.x) < o.hx + r * 0.6 && Math.abs(z - o.z) < o.hz + r * 0.6 && feetY >= o.h - 0.4) h = Math.max(h, o.h);
    }
    return h;
  }
  function insideBox(p) {
    for (const o of obstacles) {
      if (Math.abs(p.x - o.x) < o.hx && Math.abs(p.z - o.z) < o.hz && p.y < o.h && p.y > 0) return o;
    }
    return null;
  }
  // 射线打到箱子 / 地面的距离
  function rayObstacles(o, d, maxT) {
    let best = maxT;
    if (d.y < -1e-4) { const t = -o.y / d.y; if (t > 0 && t < best) best = t; }
    for (const b of obstacles) {
      let t0 = 0, t1 = best;
      const mins = [b.x - b.hx, 0, b.z - b.hz], maxs = [b.x + b.hx, b.h, b.z + b.hz];
      const oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
      let hit = true;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(dd[k]) < 1e-8) { if (oo[k] < mins[k] || oo[k] > maxs[k]) { hit = false; break; } continue; }
        let ta = (mins[k] - oo[k]) / dd[k], tb = (maxs[k] - oo[k]) / dd[k];
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) { hit = false; break; }
      }
      if (hit && t0 > 0 && t0 < best) best = t0;
    }
    return best;
  }
  function raySphere(o, d, c, r) {
    const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const cc = ox * ox + oy * oy + oz * oz - r * r;
    const disc = b * b - cc;
    if (disc < 0) return -1;
    const t = -b - Math.sqrt(disc);
    return t > 0 ? t : (cc < 0 ? 0.01 : -1);
  }

  // ================= 对象池 =================
  const matCache = {};
  function basicMat(color) {
    return matCache[color] || (matCache[color] = new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  }
  const spriteMatCache = {};
  function sharedGlowMat(color, op) {
    const k = color + '_' + op;
    return spriteMatCache[k] || (spriteMatCache[k] = new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: op, toneMapped: false }));
  }
  const tmpC = new THREE.Color(), tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpV3 = new THREE.Vector3();

  // 粒子
  const P_N = 4000;
  const pPos = new Float32Array(P_N * 3), pCol = new Float32Array(P_N * 3), pVel = new Float32Array(P_N * 3);
  const pBase = new Float32Array(P_N * 3), pLife = new Float32Array(P_N), pMax = new Float32Array(P_N);
  let pIdx = 0;
  for (let i = 0; i < P_N; i++) pPos[i * 3 + 1] = -100;
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
    size: 0.5, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  particles.frustumCulled = false;
  scene.add(particles);

  function emit(pos, color, count, speed, life, upBias) {
    tmpC.set(color);
    for (let n = 0; n < count; n++) {
      const i = pIdx; pIdx = (pIdx + 1) % P_N;
      const th = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, s = Math.sqrt(1 - u * u);
      const sp = speed * rand(0.25, 1);
      pPos[i * 3] = pos.x; pPos[i * 3 + 1] = pos.y; pPos[i * 3 + 2] = pos.z;
      pVel[i * 3] = Math.cos(th) * s * sp;
      pVel[i * 3 + 1] = u * sp * 0.8 + (upBias || 0);
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
      if (pPos[j + 1] < 0.05) { pPos[j + 1] = 0.05; pVel[j + 1] *= -0.4; }
      const f = pLife[i] / pMax[i];
      pCol[j] = pBase[j] * f; pCol[j + 1] = pBase[j + 1] * f; pCol[j + 2] = pBase[j + 2] * f;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
  }

  // 方块碎片（坏蛋被打败时变成一堆小方块）
  const shardGeo = new THREE.BoxGeometry(0.28, 0.28, 0.28);
  const shards = [];
  for (let i = 0; i < 200; i++) {
    const m = new THREE.Mesh(shardGeo, basicMat(0xffffff));
    m.visible = false; scene.add(m);
    shards.push({ m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, max: 1, s: 1 });
  }
  let shardIdx = 0;
  function spawnShards(pos, color, n, size) {
    for (let k = 0; k < n; k++) {
      const sh = shards[shardIdx]; shardIdx = (shardIdx + 1) % shards.length;
      sh.m.material = basicMat(k % 3 === 0 ? 0x221a33 : color);
      sh.m.position.set(pos.x + rand(-0.4, 0.4) * size, pos.y + rand(-0.6, 0.6) * size, pos.z + rand(-0.4, 0.4) * size);
      sh.vel.set(rand(-1, 1), rand(0.4, 1.5), rand(-1, 1)).multiplyScalar(7 * Math.sqrt(size));
      sh.spin.set(rand(-10, 10), rand(-10, 10), rand(-10, 10));
      sh.life = sh.max = rand(0.8, 1.4);
      sh.s = rand(0.6, 1.4) * Math.sqrt(size);
      sh.m.visible = true;
    }
  }
  function updateShards(dt) {
    for (const sh of shards) {
      if (sh.life <= 0) continue;
      sh.life -= dt;
      if (sh.life <= 0) { sh.m.visible = false; continue; }
      sh.vel.y -= 22 * dt;
      sh.m.position.addScaledVector(sh.vel, dt);
      if (sh.m.position.y < 0.15) { sh.m.position.y = 0.15; sh.vel.y *= -0.45; sh.vel.x *= 0.7; sh.vel.z *= 0.7; }
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
    r.m.position.set(pos.x, Math.max(0.1, pos.y - 0.5), pos.z);
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
    f.s.position.copy(pos);
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

  // 激光轨迹
  const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
  const tracers = [];
  for (let i = 0; i < 50; i++) {
    const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    m.visible = false; scene.add(m);
    tracers.push({ m, life: 0, max: 0.1, w: 0.05 });
  }
  let tracerIdx = 0;
  function spawnTracer(a, b, color, width, life) {
    const tr = tracers[tracerIdx]; tracerIdx = (tracerIdx + 1) % tracers.length;
    const len = a.distanceTo(b);
    if (len < 0.01) return;
    tr.m.position.copy(a).add(b).multiplyScalar(0.5);
    tr.m.lookAt(b);
    tr.w = width;
    tr.m.scale.set(width, width, len);
    tr.m.material.color.set(color);
    tr.life = tr.max = life || 0.09;
    tr.m.visible = true;
  }
  function updateTracers(dt) {
    for (const tr of tracers) {
      if (tr.life <= 0) continue;
      tr.life -= dt;
      if (tr.life <= 0) { tr.m.visible = false; continue; }
      const f = tr.life / tr.max;
      tr.m.material.opacity = f;
      tr.m.scale.x = tr.m.scale.y = tr.w * (0.4 + f * 0.6);
    }
  }

  let shake = 0;
  function explode(pos, color, size, silent) {
    emit(pos, color, Math.round(22 * size), 9 * Math.sqrt(size), 0.9, 2);
    emit(pos, 0xffffff, Math.round(8 * size), 6 * Math.sqrt(size), 0.5, 1);
    emit(pos, 0xffaa33, Math.round(10 * size), 5 * Math.sqrt(size), 0.7, 3);
    spawnRing(pos, color, 3 * size, 0.45 + size * 0.1);
    spawnFlash(pos, color, 4 * size, 0.25 + size * 0.05);
    spawnShards(pos, color, Math.min(16, 4 + Math.round(size * 3)), size);
    const d = camera.position.distanceTo(pos);
    shake = Math.max(shake, Math.min(1, size * 2.5 / (d + 3)));
    if (!silent) Sfx.boom(size >= 2.5);
  }

  // 飘字
  const floatersEl = $('floaters');
  function floatText(pos, text, color, size) {
    if (floatersEl.childElementCount > 30) return;
    tmpV3.copy(pos).project(camera);
    if (tmpV3.z > 1 || Math.abs(tmpV3.x) > 1.1 || Math.abs(tmpV3.y) > 1.1) return;
    const d = document.createElement('div');
    d.className = 'floater';
    d.textContent = text;
    d.style.left = ((tmpV3.x * 0.5 + 0.5) * innerWidth) + 'px';
    d.style.top = ((-tmpV3.y * 0.5 + 0.5) * innerHeight) + 'px';
    d.style.color = color || '#fff';
    if (size) d.style.fontSize = size + 'px';
    floatersEl.appendChild(d);
    setTimeout(() => d.remove(), 1000);
  }
  function centerText(text, color, size) {
    if (floatersEl.childElementCount > 30) return;
    const d = document.createElement('div');
    d.className = 'floater';
    d.textContent = text;
    d.style.left = '50%'; d.style.top = '38%';
    d.style.color = color; d.style.fontSize = (size || 40) + 'px';
    floatersEl.appendChild(d);
    setTimeout(() => d.remove(), 1000);
  }
  const flashEl = $('flash'), hurtEl = $('hurt');
  function screenFlash(color, strength) {
    flashEl.style.transition = 'none';
    flashEl.style.background = color;
    flashEl.style.opacity = strength;
    requestAnimationFrame(() => {
      flashEl.style.transition = 'opacity .45s';
      flashEl.style.opacity = 0;
    });
  }
  function hurtFlash() {
    hurtEl.style.transition = 'none';
    hurtEl.style.opacity = 1;
    requestAnimationFrame(() => { hurtEl.style.transition = 'opacity .6s'; hurtEl.style.opacity = 0; });
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
  const hitEl = $('hitmarker');
  let hitTimer = null;
  function hitMarker(head) {
    hitEl.classList.add('on');
    hitEl.classList.toggle('head', !!head);
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => hitEl.classList.remove('on'), 90);
  }

  // ================= 激光枪（第一人称手里的枪） =================
  const gun = new THREE.Group();
  camera.add(gun);
  const GUN_BASE = new THREE.Vector3(0.2, -0.2, -0.72);
  gun.position.copy(GUN_BASE);
  gun.scale.setScalar(0.8);
  const muzzle = new THREE.Object3D();
  {
    const metal = new THREE.MeshStandardMaterial({ color: 0x2b2f6a, metalness: 0.5, roughness: 0.4 });
    const glowM = new THREE.MeshBasicMaterial({ color: 0x7ef9ff, toneMapped: false });
    const goldM = new THREE.MeshStandardMaterial({ color: 0xffd21f, emissive: 0xffaa00, emissiveIntensity: 0.8, metalness: 0.6, roughness: 0.3 });
    const parts = [
      [new THREE.BoxGeometry(0.1, 0.12, 0.5), metal, 0, 0, 0],
      [new THREE.BoxGeometry(0.012, 0.035, 0.4), glowM, 0.052, 0.01, -0.02],
      [new THREE.BoxGeometry(0.012, 0.035, 0.4), glowM, -0.052, 0.01, -0.02],
      [new THREE.BoxGeometry(0.04, 0.025, 0.3), metal, 0, 0.07, 0.02],
      [new THREE.CylinderGeometry(0.032, 0.042, 0.28, 3), metal, 0, 0.0, -0.37, Math.PI / 2],
      [new THREE.CylinderGeometry(0.044, 0.044, 0.025, 3), glowM, 0, 0.0, -0.51, Math.PI / 2],
      [new THREE.ConeGeometry(0.035, 0.07, 3), goldM, 0, 0.11, -0.12],
      [new THREE.BoxGeometry(0.07, 0.18, 0.09), metal, 0, -0.13, 0.12, -0.3],
      [new THREE.BoxGeometry(0.08, 0.08, 0.1), metal, 0, -0.02, 0.27],
    ];
    parts.forEach(([geo, mat, x, y, z, rx], i) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (rx) m.rotation.x = rx;
      m.renderOrder = 1000 + i;
      gun.add(m);
    });
    gun.traverse(o => { if (o.material) { o.material.depthTest = false; o.material.depthWrite = false; } });
    muzzle.position.set(0, 0, -0.55);
    gun.rotation.y = 0.04;
    gun.add(muzzle);
  }
  const muzzleFlash = glowSprite(0x7ef9ff, 0.5, 1);
  muzzleFlash.material.depthTest = false;
  muzzleFlash.renderOrder = 1100;
  muzzleFlash.position.set(0, 0, -0.56);
  muzzleFlash.visible = false;
  gun.add(muzzleFlash);
  const gunLight = new THREE.PointLight(0x7ef9ff, 0, 10, 2);
  gunLight.position.set(0, 0, -0.7);
  gun.add(gunLight);

  // ================= 三角形队友 =================
  const triGeo = new THREE.ConeGeometry(0.75, 1.7, 3);
  triGeo.rotateX(Math.PI / 2);
  triGeo.rotateZ(Math.PI);
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

  // ================= 方块坏蛋 =================
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const G = {
    leg: box(0.26, 0.9, 0.3), boot: box(0.32, 0.16, 0.42), torso: box(0.8, 0.85, 0.5), belt: box(0.84, 0.12, 0.54),
    badge: box(0.22, 0.22, 0.04), head: box(0.62, 0.58, 0.58), helmet: box(0.7, 0.18, 0.68), horn: new THREE.ConeGeometry(0.09, 0.32, 4),
    arm: box(0.22, 0.7, 0.24), blaster: box(0.13, 0.15, 0.62), eye: new THREE.SphereGeometry(0.1, 12, 10), pupil: new THREE.SphereGeometry(0.05, 8, 6),
    brow: box(0.2, 0.05, 0.05), mouth: box(0.26, 0.04, 0.03), droneBody: new THREE.SphereGeometry(0.7, 20, 14), droneRing: new THREE.TorusGeometry(1.05, 0.08, 6, 24),
    crownSpike: new THREE.ConeGeometry(0.12, 0.4, 4), cape: new THREE.PlaneGeometry(1.0, 1.4),
  };
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1628, roughness: 0.7 });
  const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0xff1133, toneMapped: false });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xffd21f, emissive: 0xffaa00, emissiveIntensity: 0.6, metalness: 0.7, roughness: 0.3 });
  const capeMat = new THREE.MeshStandardMaterial({ color: 0x5a0018, side: THREE.DoubleSide, roughness: 0.8 });

  function addMesh(parent, geo, mat, x, y, z) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  function makeVillain(T) {
    const g = new THREE.Group();
    const armor = new THREE.MeshStandardMaterial({ color: T.color, emissive: T.color, emissiveIntensity: 0.2, roughness: 0.45, metalness: 0.3, flatShading: true });
    const v = { g, armor, legs: [], arms: [] };
    if (T.drone) {
      const body = new THREE.Group();
      addMesh(body, G.droneBody, armor, 0, 0, 0);
      const eyeW = addMesh(body, G.eye, whiteMat, 0, 0.05, 0.58); eyeW.scale.setScalar(3);
      const p = addMesh(eyeW, G.pupil, pupilMat, 0, 0, 0.08); p.scale.setScalar(0.9);
      const brow = addMesh(body, G.brow, darkMat, 0, 0.42, 0.6); brow.scale.set(2.2, 1.6, 1);
      const ring = addMesh(body, G.droneRing, darkMat, 0, 0, 0); ring.rotation.x = Math.PI / 2;
      addMesh(body, G.blaster, darkMat, 0, -0.6, 0.3);
      body.add(glowSprite(T.color, 3, 0.4));
      v.ring = ring;
      g.add(body);
      v.body = body;
      return v;
    }
    for (const sx of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(sx * 0.22, 0.92, 0);
      addMesh(hip, G.leg, darkMat, 0, -0.45, 0);
      addMesh(hip, G.boot, armor, 0, -0.84, 0.05);
      g.add(hip); v.legs.push(hip);
    }
    addMesh(g, G.torso, armor, 0, 1.35, 0);
    addMesh(g, G.belt, darkMat, 0, 0.98, 0);
    addMesh(g, G.badge, goldMat, 0, 1.45, 0.26);
    addMesh(g, G.head, darkMat, 0, 2.05, 0);
    addMesh(g, G.helmet, armor, 0, 2.38, 0);
    for (const sx of [-1, 1]) {
      const h = addMesh(g, G.horn, armor, sx * 0.25, 2.6, 0); h.rotation.z = -sx * 0.4;
      const e = addMesh(g, G.eye, whiteMat, sx * 0.14, 2.1, 0.28); e.scale.set(1.2, 1, 1);
      addMesh(e, G.pupil, pupilMat, 0, -0.01, 0.07);
      const b = addMesh(g, G.brow, armor, sx * 0.14, 2.24, 0.3); b.rotation.z = sx * 0.5;
    }
    const mouth = addMesh(g, G.mouth, whiteMat, 0, 1.9, 0.3); mouth.rotation.z = 0.15;
    for (const sx of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(sx * 0.52, 1.7, 0);
      addMesh(sh, G.arm, armor, 0, -0.32, 0);
      if (sx > 0) { addMesh(sh, G.blaster, darkMat, 0, -0.62, 0.22); const tip = addMesh(sh, G.badge, pupilMat, 0, -0.62, 0.54); tip.scale.set(0.6, 0.6, 1); }
      g.add(sh); v.arms.push(sh);
    }
    v.arms[1].rotation.x = -1.35; // 举枪
    if (T.boss) {
      for (let i = 0; i < 5; i++) {
        const sp = addMesh(g, G.crownSpike, goldMat, (i - 2) * 0.15, 2.62, 0.3 - Math.abs(i - 2) * 0.05);
        sp.rotation.x = -0.2;
      }
      const cape = addMesh(g, G.cape, capeMat, 0, 1.1, -0.32);
      cape.rotation.x = 0.12;
      v.cape = cape;
      const aura = glowSprite(0xff0044, 6, 0.4);
      aura.position.y = 1.4;
      g.add(aura);
    }
    return v;
  }

  const ETYPES = {
    grunt:  { name: '小坏蛋', hp: 4, speed: 3.6, scale: 1, color: 0xd9304a, score: 10, xp: 1, dmg: 1, shoot: [2.6, 4.2], keep: 9 },
    runner: { name: '冲锋坏蛋', hp: 3, speed: 7.2, scale: 0.9, color: 0xff8a1f, score: 15, xp: 1, dmg: 1 },
    drone:  { name: '坏蛋无人机', hp: 3, speed: 5, scale: 1, color: 0xff2dc8, score: 20, xp: 2, dmg: 1, shoot: [2.2, 3.4], keep: 12, drone: true },
    tank:   { name: '重甲坏蛋', hp: 22, speed: 2.3, scale: 1.55, color: 0x7a3dff, score: 50, xp: 4, dmg: 2, shoot: [3, 4], keep: 7, burst: 3 },
    boss:   { name: '方块大魔王', hp: 320, speed: 2.1, scale: 2.8, color: 0xb3001b, score: 1000, xp: 20, dmg: 3, shoot: [2.4, 3], boss: true },
  };

  // ================= 游戏数据 =================
  let S = {};
  let state = 'title'; // title | playing | paused | menu | dead | over
  let gameId = 0;
  let allies = [], enemies = [], pickups = [], orbs = [], grenades = [];
  let score = 0, wave = 0, level = 1, xp = 0, kills = 0, headshots = 0;
  let hp = 10, invuln = 0, combo = 0, comboTimer = 0, grenadeCount = 3;
  let spawnQueue = [], spawnTimer = 0, waveActive = false, recruitTimer = 0;
  let pendingLevels = 0, revivesLeft = 2, boss = null, fireCool = 0, grenadeCool = 0;
  let best = 0;
  try { best = +localStorage.getItem('tri_best') || 0; } catch (e) {}
  $('bestScore').textContent = best;
  let sens = 1;
  try { sens = +localStorage.getItem('tri_sens') || 1; } catch (e) {}
  $('sens').value = sens;
  $('sens').addEventListener('input', e => { sens = +e.target.value; try { localStorage.setItem('tri_sens', sens); } catch (er) {} });

  function resetStats() {
    S = { speed: 8.5, fireRate: 1, dmg: 1, pellets: 1, maxHp: 10, magnet: 6, gRadius: 7, gDmg: 1, maxGrenades: 6, jumps: 1, maxAllies: 8 };
  }
  resetStats();

  const player = { pos: new THREE.Vector3(0, 0, 6), vel: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: true, jumpsUsed: 0, bob: 0 };
  const fwd = new THREE.Vector3(0, 0, -1), right = new THREE.Vector3(1, 0, 0);
  function eyePos(out) { return out.set(player.pos.x, player.pos.y + 1.65, player.pos.z); }

  // ---------- 队友 ----------
  function addAlly(fromPos) {
    if (allies.length >= S.maxAllies) { score += 50; return false; }
    const col = TROOP_COLORS[Math.floor(Math.random() * TROOP_COLORS.length)];
    const g = makeTri(col, 0.9);
    g.position.copy(fromPos || player.pos);
    g.position.y = 1;
    scene.add(g);
    allies.push({ g, color: col, cool: Math.random(), phase: Math.random() * 6 });
    emit(g.position, col, 18, 5, 0.6, 3);
    return true;
  }
  function killAlly(i) {
    const a = allies[i];
    explode(a.g.position, a.color, 0.7);
    scene.remove(a.g);
    a.g.userData.mat.dispose();
    a.g.userData.glow.material.dispose();
    allies.splice(i, 1);
  }

  // ---------- 坏蛋 ----------
  let enemyUid = 0;
  function spawnEnemy(type, pos, idle) {
    const T = ETYPES[type];
    const v = makeVillain(T);
    const s = T.scale;
    v.g.scale.setScalar(s);
    v.g.position.set(pos.x, T.drone ? 3.2 : 0, pos.z);
    scene.add(v.g);
    const hpMul = 1 + Math.max(0, wave - 1) * 0.15;
    const e = {
      id: ++enemyUid, type, T, v, g: v.g, s,
      hp: Math.ceil(T.hp * hpMul), maxHp: Math.ceil(T.hp * hpMul),
      speed: T.speed * (1 + Math.min(0.4, wave * 0.02)) * rand(0.9, 1.1),
      r: (T.drone ? 0.8 : 0.55) * s, flash: 0, kb: new THREE.Vector3(),
      shootT: T.shoot ? rand(1.5, T.shoot[1]) : 0, atk: 0, phase: Math.random() * 6, spawnIn: idle ? 0 : 0.6, idle: !!idle,
      strafe: Math.random() < 0.5 ? 1 : -1, strafeT: rand(1, 3), burst: 0, burstT: 0, summonT: 6,
    };
    if (!idle) { spawnRing(v.g.position, 0xff3355, 3 * s, 0.6); emit(tmpV.copy(v.g.position).setY(1), 0xff3355, 25, 5, 0.8, 6); }
    enemies.push(e);
    return e;
  }
  // 命中判定：身体两个球 + 头一个球
  function hitSpheres(e) {
    const p = e.g.position, s = e.s;
    if (e.T.drone) return [[p.x, p.y, p.z, 0.85 * s, false]];
    return [[p.x, p.y + 1.3 * s, p.z, 0.62 * s, false], [p.x, p.y + 0.55 * s, p.z, 0.45 * s, false], [p.x, p.y + 2.1 * s, p.z, 0.45 * s, true]];
  }
  function removeEnemy(e) {
    scene.remove(e.g);
    e.v.armor.dispose();
    const i = enemies.indexOf(e);
    if (i >= 0) enemies.splice(i, 1);
    if (e === boss) { boss = null; $('bossbox').classList.add('hidden'); }
  }
  function damageEnemy(e, dmg, at, head) {
    if (e.hp <= 0) return;
    e.hp -= dmg;
    e.flash = 0.08;
    e.kb.add(tmpV3.set(e.g.position.x - player.pos.x, 0, e.g.position.z - player.pos.z).normalize().multiplyScalar(e.T.boss ? 0.2 : 1.6));
    if (at) floatText(at, (head ? '💥' : '') + Math.round(dmg * 10) / 10, head ? '#ffe15a' : '#fff', head ? 30 : 22);
    if (e.hp <= 0) killEnemy(e, head);
  }
  function killEnemy(e, head) {
    const p = e.g.position.clone();
    const center = p.clone().setY(p.y + (e.T.drone ? 0 : 1.2 * e.s));
    kills++;
    combo++; comboTimer = 3;
    const mult = 1 + Math.floor(combo / 5);
    const pts = e.T.score * mult * (head ? 2 : 1);
    score += pts;
    if (head) { headshots++; centerText('爆头！+' + pts, '#ffe15a', 44); Sfx.headshot(); }
    if (e.T.boss) {
      for (let i = 0; i < 7; i++) setTimeout(() => {
        if (state === 'title') return;
        explode(new THREE.Vector3(p.x + rand(-3, 3), rand(1, 7), p.z + rand(-3, 3)), [0xff0044, 0xffe15a, 0xff8a1f][i % 3], 3);
      }, i * 160);
      screenFlash('#fff', 0.8);
      banner('打败大魔王！', '超级厉害！奖励 3 个队友 + 3 颗手榴弹 🎉');
      for (let i = 0; i < 3; i++) addAlly(p);
      grenadeCount = Math.min(S.maxGrenades + 3, grenadeCount + 3);
      shake = 1.5;
    } else {
      explode(center, e.T.color, 1.2 * e.s);
      emit(center, 0xffe15a, 12, 6, 0.8, 4); // 星星
    }
    if ([5, 10, 15, 20, 30, 50].includes(combo)) centerText(`${combo} 连杀！`, '#ff7a18', 52);
    for (let i = 0; i < e.T.xp; i++) spawnPickup('gem', center);
    if (!e.T.boss) {
      const roll = Math.random();
      if (roll < 0.1) spawnPickup('grenade', center);
      else if (roll < 0.15) spawnPickup('heart', center);
      else if (roll < 0.19) spawnPickup('recruit', center);
    }
    removeEnemy(e);
  }

  // 敌人的能量弹
  const orbGeo = new THREE.IcosahedronGeometry(0.22, 1);
  function fireOrb(from, to, speed, color) {
    let o = orbs.find(b => !b.alive);
    if (!o) {
      if (orbs.length > 120) return;
      const mesh = new THREE.Mesh(orbGeo, basicMat(0xff2255));
      const gl = new THREE.Sprite(sharedGlowMat(0xff2255, 0.9)); gl.scale.setScalar(1.6); mesh.add(gl);
      scene.add(mesh);
      o = { mesh, gl, vel: new THREE.Vector3(), life: 0, alive: false };
      orbs.push(o);
    }
    o.alive = true; o.mesh.visible = true;
    o.mesh.material = basicMat(color || 0xff2255);
    o.gl.material = sharedGlowMat(color || 0xff2255, 0.9);
    o.mesh.position.copy(from);
    o.vel.copy(to).sub(from).normalize().multiplyScalar(speed);
    o.life = 6;
    Sfx.enemyShot();
  }

  // ---------- 道具 ----------
  const gemGeo = new THREE.OctahedronGeometry(0.25, 0);
  const gemMat = new THREE.MeshStandardMaterial({ color: 0xffe15a, emissive: 0xffc400, emissiveIntensity: 1, flatShading: true });
  const beamGeo = new THREE.CylinderGeometry(0.5, 1.1, 4.5, 16, 1, true);
  const heartTex = emojiTex('❤️'), bombTex = emojiTex('💣');
  const crateGeo = box(0.7, 0.5, 0.5);
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x3a5a2a, emissive: 0xffaa00, emissiveIntensity: 0.15, roughness: 0.6 });
  function spawnPickup(kind, pos) {
    let g;
    if (kind === 'gem') {
      g = new THREE.Mesh(gemGeo, gemMat);
      const s = new THREE.Sprite(sharedGlowMat(0xffc400, 0.6)); s.scale.setScalar(1.2); g.add(s);
    } else if (kind === 'recruit') {
      g = makeTri(0x5dff8a, 1.0);
      const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0x5dff8a, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      beam.position.y = 1.2;
      g.add(beam);
    } else if (kind === 'grenade') {
      g = new THREE.Mesh(crateGeo, crateMat);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: bombTex, transparent: true, depthWrite: false }));
      s.scale.setScalar(1); s.position.y = 0.75; g.add(s);
      const gl = new THREE.Sprite(sharedGlowMat(0xffaa00, 0.5)); gl.scale.setScalar(2.2); g.add(gl);
    } else {
      g = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, transparent: true, depthWrite: false }));
      g.scale.setScalar(1.4);
    }
    const spread = kind === 'gem' ? 1.2 : 0.3;
    g.position.set(pos.x + rand(-spread, spread), Math.max(0.8, pos.y), pos.z + rand(-spread, spread));
    scene.add(g);
    pickups.push({ kind, g, t: Math.random() * 6, life: kind === 'gem' ? 30 : 35, vel: new THREE.Vector3(rand(-3, 3), 5, rand(-3, 3)) });
  }
  function removePickup(i) {
    const p = pickups[i];
    scene.remove(p.g);
    if (p.kind === 'recruit') { p.g.userData.mat.dispose(); p.g.userData.glow.material.dispose(); p.g.children[3].material.dispose(); }
    if (p.kind === 'heart') p.g.material.dispose();
    if (p.kind === 'grenade') p.g.children[0].material.dispose();
    pickups.splice(i, 1);
  }

  // ---------- 手榴弹 ----------
  const grenGeo = new THREE.IcosahedronGeometry(0.16, 0);
  const grenMat = new THREE.MeshStandardMaterial({ color: 0x3dff8a, emissive: 0x3dff8a, emissiveIntensity: 0.8, flatShading: true });
  let gunKick = 0, gunDip = 0, muzzleT = 0;
  function throwGrenade() {
    if (state !== 'playing' || grenadeCool > 0) return;
    if (grenadeCount <= 0) { centerText('没有手榴弹了！打坏蛋能捡到 💣', '#ffb347', 26); return; }
    grenadeCount--;
    grenadeCool = 0.45;
    gunDip = 1;
    Sfx.throwIt();
    bumpGrenadeBox();
    let gr = grenades.find(x => !x.alive);
    if (!gr) {
      const mesh = new THREE.Mesh(grenGeo, grenMat);
      const gl = glowSprite(0x3dff8a, 1.4, 0.9);
      mesh.add(gl);
      scene.add(mesh);
      gr = { mesh, gl, vel: new THREE.Vector3(), fuse: 0, alive: false };
      grenades.push(gr);
    }
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    gr.mesh.position.copy(eyePos(new THREE.Vector3())).addScaledVector(dir, 0.6).add(new THREE.Vector3(0, -0.15, 0));
    gr.vel.copy(dir).multiplyScalar(19).add(new THREE.Vector3(player.vel.x, 4.5, player.vel.z));
    gr.fuse = 1.6;
    gr.alive = true; gr.mesh.visible = true;
  }
  function grenadeBlast(pos) {
    const r = S.gRadius;
    explode(pos, 0x3dff8a, 3.2);
    explode(pos, 0xffaa33, 2.2, true);
    spawnRing(pos, 0xffe15a, r * 1.3, 0.6);
    spawnRing(pos, 0x3dff8a, r, 0.5, 0.08);
    emit(pos, 0xffe15a, 80, 16, 1, 6);
    shake = Math.max(shake, 1.2);
    for (const e of enemies.slice()) {
      if (e.idle || e.spawnIn > 0) continue;
      const c = new THREE.Vector3().copy(e.g.position); c.y += e.T.drone ? 0 : 1.2 * e.s;
      const d = c.distanceTo(pos);
      if (d < r + e.r) {
        const f = 1 - Math.min(1, d / (r + e.r)) * 0.5;
        e.kb.add(new THREE.Vector3().copy(e.g.position).sub(pos).setY(0).normalize().multiplyScalar(e.T.boss ? 3 : 18 * f));
        damageEnemy(e, 14 * S.gDmg * f * (e.T.boss ? 0.6 : 1), c);
      }
    }
    for (const o of orbs) if (o.alive && o.mesh.position.distanceTo(pos) < r) { o.alive = false; o.mesh.visible = false; }
  }
  function updateGrenades(dt) {
    for (const gr of grenades) {
      if (!gr.alive) continue;
      gr.fuse -= dt;
      gr.vel.y -= 20 * dt;
      const p = gr.mesh.position;
      p.addScaledVector(gr.vel, dt);
      gr.mesh.rotation.x += dt * 10; gr.mesh.rotation.y += dt * 7;
      gr.gl.material.opacity = Math.floor(gr.fuse * (gr.fuse < 0.6 ? 16 : 6)) % 2 ? 1 : 0.3;
      if (p.y < 0.16) { p.y = 0.16; gr.vel.y *= -0.45; gr.vel.x *= 0.65; gr.vel.z *= 0.65; }
      const o = insideBox(p);
      if (o) {
        // 从最近的面弹出来
        const px = o.hx - Math.abs(p.x - o.x), pz = o.hz - Math.abs(p.z - o.z), py = o.h - p.y;
        if (py < px && py < pz) { p.y = o.h + 0.01; gr.vel.y = Math.abs(gr.vel.y) * 0.45; gr.vel.x *= 0.7; gr.vel.z *= 0.7; }
        else if (px < pz) { p.x = o.x + Math.sign(p.x - o.x || 1) * (o.hx + 0.01); gr.vel.x *= -0.5; }
        else { p.z = o.z + Math.sign(p.z - o.z || 1) * (o.hz + 0.01); gr.vel.z *= -0.5; }
      }
      const d = Math.hypot(p.x, p.z);
      if (d > R) { p.x *= R / d; p.z *= R / d; gr.vel.x *= -0.5; gr.vel.z *= -0.5; }
      if (Math.random() < 0.6) emit(p, 0x3dff8a, 1, 0.5, 0.3, 0.5);
      let touch = false;
      for (const e of enemies) {
        if (e.idle || e.spawnIn > 0) continue;
        for (const s of hitSpheres(e)) {
          if ((p.x - s[0]) ** 2 + (p.y - s[1]) ** 2 + (p.z - s[2]) ** 2 < (s[3] + 0.2) ** 2) { touch = true; break; }
        }
        if (touch) break;
      }
      if (gr.fuse <= 0 || touch) {
        gr.alive = false; gr.mesh.visible = false;
        grenadeBlast(p.clone());
      }
    }
  }
  const grenadeBoxEl = $('grenadeBox');
  function bumpGrenadeBox() {
    grenadeBoxEl.classList.remove('bump'); void grenadeBoxEl.offsetWidth; grenadeBoxEl.classList.add('bump');
  }

  // ================= 开枪 =================
  function shoot() {
    fireCool = 0.15 / S.fireRate;
    gunKick = 1;
    muzzleT = 0.05;
    Sfx.blaster();
    const eye = eyePos(new THREE.Vector3());
    const aim = new THREE.Vector3();
    camera.getWorldDirection(aim);
    const from = new THREE.Vector3();
    muzzle.getWorldPosition(from);
    let anyHit = false, anyHead = false;
    for (let k = 0; k < S.pellets; k++) {
      const spread = S.pellets > 1 ? 0.06 : 0.008;
      const dir = aim.clone().add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(spread)).normalize();
      let bestT = rayObstacles(eye, dir, 90), bestE = null, bestHead = false;
      for (const e of enemies) {
        if (e.idle || e.spawnIn > 0) continue;
        for (const s of hitSpheres(e)) {
          const t = raySphere(eye, dir, tmpV2.set(s[0], s[1], s[2]), s[3] * 1.15); // 小小的瞄准辅助
          if (t > 0 && t < bestT) { bestT = t; bestE = e; bestHead = s[4]; }
        }
      }
      const hitP = eye.clone().addScaledVector(dir, bestT);
      spawnTracer(from, hitP, k % 2 ? 0xb84dff : 0x7ef9ff, 0.07, 0.09);
      if (bestE) {
        anyHit = true; anyHead = anyHead || bestHead;
        emit(hitP, bestE.T.color, 8, 6, 0.4, 1);
        emit(hitP, 0xffffff, 4, 4, 0.25, 1);
        damageEnemy(bestE, S.dmg * (bestHead ? 2 : 1), hitP, bestHead);
      } else if (bestT < 90) {
        emit(hitP, 0x7ef9ff, 6, 4, 0.35, 2);
      }
    }
    if (anyHit) { hitMarker(anyHead); Sfx.hit(); }
    player.pitch = Math.min(1.45, player.pitch + 0.006);
  }

  // ================= 输入 =================
  const keys = {};
  let mouseDown = false, touchFire = false;
  let locked = false, lockFallback = isTouch;
  function requestLock() {
    if (isTouch) return;
    try {
      const r = renderer.domElement.requestPointerLock();
      if (r && r.catch) r.catch(() => { lockFallback = true; });
    } catch (e) { lockFallback = true; }
  }
  function exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === renderer.domElement;
    if (!locked) mouseDown = false;
    if (!locked && state === 'playing' && !lockFallback) pause();
  });
  document.addEventListener('pointerlockerror', () => { lockFallback = true; });
  function needLock() { return !isTouch && !lockFallback && !locked; }

  addEventListener('keydown', e => {
    Sfx.init();
    keys[e.code] = true;
    if (e.code === 'Space') { e.preventDefault(); if (state === 'playing') jump(); }
    if (e.code === 'KeyG' || e.code === 'KeyQ') { if (state === 'playing') throwGrenade(); }
    if (e.code === 'KeyP' || (e.code === 'Escape' && lockFallback)) {
      if (state === 'playing') pause(); else if (state === 'paused') resume();
    }
    if (state === 'menu' && !$('upgrade').classList.contains('hidden')) {
      const n = parseInt(e.key, 10);
      const cards = $('upgradeCards').children;
      if (n >= 1 && n <= cards.length) cards[n - 1].click();
    }
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown = false; if (state === 'playing') pause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') pause(); });
  addEventListener('contextmenu', e => { if (state === 'playing' || state === 'paused') e.preventDefault(); });
  renderer.domElement.addEventListener('mousedown', e => {
    Sfx.init();
    if (state !== 'playing' || isTouch) return;
    if (needLock()) { requestLock(); return; }
    if (e.button === 0) mouseDown = true;
    if (e.button === 2) throwGrenade();
  });
  addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; });
  addEventListener('mousemove', e => {
    if (state !== 'playing' || isTouch) return;
    if (!locked && !lockFallback) return;
    look(e.movementX || 0, e.movementY || 0, 0.0022 * sens);
  });
  function look(dx, dy, k) {
    player.yaw -= dx * k;
    player.pitch = clamp(player.pitch - dy * k, -1.45, 1.45);
  }
  $('clickToPlay').addEventListener('click', () => { Sfx.init(); requestLock(); });

  // 触控：左边摇杆，右边拖动瞄准，按钮开火/手榴弹/跳
  const joy = { id: null, x: 0, y: 0 };
  const lookT = { id: null, x: 0, y: 0 };
  const joyBase = $('joyBase'), joyKnob = $('joyKnob');
  if (isTouch) {
    $('touchUI').classList.remove('hidden');
    $('howtoPC').classList.add('hidden');
    $('howtoTouch').classList.remove('hidden');
  }
  function joyMove(t) {
    const r = joyBase.getBoundingClientRect();
    let dx = t.clientX - (r.left + r.width / 2), dy = t.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy), max = r.width / 2 - 10;
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    joy.x = dx / max; joy.y = dy / max;
    joyKnob.style.transform = `translate(${dx}px,${dy}px)`;
  }
  function onTouchStart(e) {
    Sfx.init();
    if (state !== 'playing') return;
    for (const t of e.changedTouches) {
      if (t.target.closest && t.target.closest('.tbtn, button')) continue;
      if (joy.id === null && t.clientX < innerWidth * 0.4) { joy.id = t.identifier; joyMove(t); }
      else if (lookT.id === null) { lookT.id = t.identifier; lookT.x = t.clientX; lookT.y = t.clientY; }
    }
  }
  function onTouchMove(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) joyMove(t);
      else if (t.identifier === lookT.id) {
        if (state === 'playing') look(t.clientX - lookT.x, t.clientY - lookT.y, 0.006 * sens);
        lookT.x = t.clientX; lookT.y = t.clientY;
      }
    }
    if (state === 'playing') e.preventDefault();
  }
  function onTouchEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) { joy.id = null; joy.x = joy.y = 0; joyKnob.style.transform = ''; }
      if (t.identifier === lookT.id) lookT.id = null;
    }
  }
  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd);
  document.addEventListener('touchcancel', onTouchEnd);
  function holdBtn(id, down, up) {
    const el = $(id);
    el.addEventListener('touchstart', e => { e.preventDefault(); Sfx.init(); el.classList.add('down'); down(); }, { passive: false });
    const end = e => { e.preventDefault(); el.classList.remove('down'); if (up) up(); };
    el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
  }
  holdBtn('tFire', () => { touchFire = true; }, () => { touchFire = false; });
  holdBtn('tGrenade', () => throwGrenade());
  holdBtn('tJump', () => { if (state === 'playing') jump(); });

  function jump() {
    if (player.onGround) { player.vel.y = 9; player.onGround = false; player.jumpsUsed = 1; Sfx.jump(); }
    else if (player.jumpsUsed < S.jumps) { player.vel.y = 8.5; player.jumpsUsed++; Sfx.jump(); emit(player.pos, 0x7ef9ff, 15, 4, 0.4, 0); }
  }

  // ================= 界面按钮 =================
  function refreshToggles() {
    const L = Learn.enabled;
    ['learnToggle', 'learnToggle2'].forEach(id => { $(id).textContent = `📚 学习模式：${L ? '开' : '关'}`; $(id).classList.toggle('off', !L); });
    ['soundToggle', 'soundToggle2'].forEach(id => { $(id).textContent = `🔊 音效：${Sfx.soundOn ? '开' : '关'}`; $(id).classList.toggle('off', !Sfx.soundOn); });
    ['musicToggle', 'musicToggle2'].forEach(id => { $(id).textContent = `🎵 音乐：${Sfx.musicOn ? '开' : '关'}`; $(id).classList.toggle('off', !Sfx.musicOn); });
    $('learnBadge').textContent = `📚 学习模式 ${L ? '开' : '关'}`;
    $('learnBadge').classList.toggle('off', !L);
    $('learnTip').textContent = L
      ? `学习模式已打开：出发、升级、复活前都要答对英语单词！已学会 ${Learn.seenCount()} / ${Learn.total} 个单词`
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
    if (state !== 'playing') return;
    state = 'paused';
    mouseDown = false; touchFire = false;
    refreshToggles();
    $('pause').classList.remove('hidden');
    exitLock();
  }
  function resume() {
    $('pause').classList.add('hidden');
    state = 'playing';
    requestLock();
  }
  function enterMenu() {
    state = 'menu';
    mouseDown = false; touchFire = false;
    exitLock();
  }

  // ================= 游戏流程 =================
  function clearWorld() {
    while (allies.length) { const a = allies.pop(); scene.remove(a.g); a.g.userData.mat.dispose(); }
    while (enemies.length) removeEnemy(enemies[0]);
    while (pickups.length) removePickup(0);
    for (const o of orbs) { o.alive = false; o.mesh.visible = false; }
    for (const g of grenades) { g.alive = false; g.mesh.visible = false; }
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
    exitLock();
    $('quiz').classList.add('hidden');
    $('hud').classList.add('hidden');
    $('clickToPlay').classList.add('hidden');
    bannerEl.classList.add('hidden');
    $('title').classList.remove('hidden');
    $('bestScore').textContent = best;
    gun.visible = false;
    // 开始界面摆几个坏蛋和队友
    wave = 1;
    const props = [['grunt', -5, -3], ['tank', 0, -6], ['runner', 5, -3], ['drone', 2.5, -4]];
    for (const [t, x, z] of props) spawnEnemy(t, new THREE.Vector3(x, 0, z), true);
    for (let i = 0; i < 6; i++) addAlly(new THREE.Vector3(Math.cos(i) * 3, 0, 4 + Math.sin(i) * 2));
    state = 'title';
    refreshToggles();
  }

  async function newGame() {
    const id = ++gameId;
    clearWorld();
    hideScreens();
    resetStats();
    Learn.resetSession();
    score = 0; wave = 0; level = 1; xp = 0; kills = 0; headshots = 0;
    hp = S.maxHp; invuln = 0; combo = 0; pendingLevels = 0; revivesLeft = 2; grenadeCount = 3;
    player.pos.set(0, 0, 6); player.vel.set(0, 0, 0); player.yaw = 0; player.pitch = -0.05;
    fwd.set(0, 0, -1); right.set(1, 0, 0);
    for (let i = 0; i < 2; i++) addAlly(new THREE.Vector3(i ? 2 : -2, 0, 9));
    gun.visible = true;
    $('hud').classList.remove('hidden');
    refreshToggles();
    enterMenu();
    if (Learn.enabled) {
      await Learn.learnNew(2, '📚 出发前先背单词');
      if (id !== gameId) return;
    } else requestLock();
    startWave(1);
  }

  function buildWave(n) {
    const q = [];
    if (n % 5 === 0) {
      q.push('boss');
      for (let i = 0; i < 2 + Math.floor(n / 2); i++) q.push(i % 2 ? 'runner' : 'grunt');
      return q;
    }
    const count = 5 + n * 2;
    for (let i = 0; i < count; i++) {
      const opts = [['grunt', 10]];
      if (n >= 2) opts.push(['runner', 6]);
      if (n >= 3) opts.push(['drone', 3 + n * 0.3]);
      if (n >= 4) opts.push(['tank', 1.5 + n * 0.25]);
      let tot = opts.reduce((s, o) => s + o[1], 0), r = Math.random() * tot;
      for (const o of opts) { r -= o[1]; if (r <= 0) { q.push(o[0]); break; } }
    }
    return q;
  }

  function startWave(n) {
    wave = n;
    spawnQueue = buildWave(n);
    spawnTimer = 1.5;
    recruitTimer = 5;
    waveActive = true;
    state = 'playing';
    if (n % 5 === 0) {
      banner('⚠ 大魔王来袭 ⚠', `第 ${n} 波 · 方块大魔王出现了！`, true);
      Sfx.warn();
      screenFlash('#ff0033', 0.35);
    } else {
      banner(`第 ${n} 波`, ['准备战斗！', '冲啊！三角形部队！', '坏蛋来了，找掩护！', '全体开火！'][n % 4]);
      Sfx.wave();
    }
  }

  function spawnPoint() {
    let bestP = null, bestD = -1;
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2, r = R - rand(2, 5);
      const p = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
      pushOut(p, 1.2);
      const d = p.distanceTo(player.pos);
      if (d > bestD) { bestD = d; bestP = p; }
      if (d > 25) break;
    }
    return bestP;
  }

  function wait(ms) {
    return new Promise(res => {
      let left = ms;
      const iv = setInterval(() => {
        if (state === 'playing' || state === 'menu' || state === 'dead') left -= 100;
        if (left <= 0 || state === 'title' || state === 'over') { clearInterval(iv); res(); }
      }, 100);
    });
  }

  async function waveCleared() {
    const id = gameId;
    waveActive = false;
    banner(`第 ${wave} 波 胜利！`, '奖励 2 颗手榴弹 + 1 个队友 + 回复生命 ❤️');
    Sfx.levelUp();
    grenadeCount = Math.min(S.maxGrenades, grenadeCount + 2);
    addAlly();
    hp = Math.min(S.maxHp, hp + 3);
    for (const p of pickups) if (p.kind === 'gem') p.forced = true;
    await wait(2800);
    if (id !== gameId) return;
    while (state !== 'playing' || pendingLevels > 0 || needLock()) {
      await wait(200);
      if (id !== gameId || state === 'over') return;
    }
    if (Learn.enabled) {
      enterMenu();
      const bossNext = (wave + 1) % 5 === 0;
      await Learn.learnNew(bossNext ? 3 : 2, bossNext ? '📚 大魔王要来了！先背单词' : '📚 背单词时间');
      if (id !== gameId) return;
    }
    startWave(wave + 1);
  }

  async function doLevelUp() {
    const id = gameId;
    enterMenu();
    Sfx.levelUp();
    emit(new THREE.Vector3(player.pos.x, 1, player.pos.z), 0x7ef9ff, 60, 10, 1, 6);
    if (Learn.enabled) {
      await Learn.review(1, '⬆️ 升级啦！', '答对 1 个单词，解锁新能力！');
      if (id !== gameId) return;
    }
    showUpgrades();
  }

  const UPGRADES = [
    { icon: '🔥', name: '火力全开', desc: '开枪速度 +25%', apply() { S.fireRate *= 1.25; } },
    { icon: '💥', name: '超级激光', desc: '激光威力 +35%', apply() { S.dmg *= 1.35; } },
    { icon: '🔱', name: '散射激光', desc: '每次多射出 2 道激光', ok: () => S.pellets < 7, apply() { S.pellets += 2; } },
    { icon: '💣', name: '手榴弹包', desc: '立刻拿到 4 颗手榴弹，最多能带 +2', apply() { S.maxGrenades += 2; grenadeCount = Math.min(S.maxGrenades, grenadeCount + 4); } },
    { icon: '☄️', name: '超级炸弹', desc: '手榴弹爆炸范围和威力 +30%', apply() { S.gRadius *= 1.3; S.gDmg *= 1.3; } },
    { icon: '👟', name: '飞毛腿', desc: '跑得更快 +15%', ok: () => S.speed < 14, apply() { S.speed *= 1.15; } },
    { icon: '❤️', name: '钢铁之心', desc: '生命上限 +3，并且回满生命', apply() { S.maxHp += 3; hp = S.maxHp; } },
    { icon: '🔺', name: '紧急招募', desc: '马上来 2 个三角形队友帮你打', apply() { addAlly(); addAlly(); } },
    { icon: '🧲', name: '超级磁铁', desc: '更远就能吸到经验水晶', ok: () => S.magnet < 18, apply() { S.magnet *= 1.5; } },
    { icon: '🦘', name: '弹簧鞋', desc: '可以在空中再跳一次！', ok: () => S.jumps < 3, apply() { S.jumps++; } },
  ];
  function showUpgrades() {
    const pool = UPGRADES.filter(u => !u.ok || u.ok());
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const picks = pool.slice(0, 3);
    const cbox = $('upgradeCards');
    cbox.innerHTML = '';
    picks.forEach((u, i) => {
      const d = document.createElement('div');
      d.className = 'ucard';
      d.innerHTML = `<div class="ui">${u.icon}</div><div class="un">${u.name}</div><div class="ud">${u.desc}</div><div class="uk">${isTouch ? '点一下选择' : `按 ${i + 1} 选择`}</div>`;
      d.onclick = () => {
        if (state !== 'menu') return;
        Sfx.pickup();
        u.apply();
        $('upgrade').classList.add('hidden');
        pendingLevels--;
        centerText(u.icon + ' ' + u.name, '#ffe15a', 40);
        state = 'playing';
        requestLock();
      };
      cbox.appendChild(d);
    });
    $('upgrade').classList.remove('hidden');
  }

  function hurtPlayer(dmg) {
    if (invuln > 0 || state !== 'playing') return;
    hp -= dmg;
    invuln = 0.7;
    shake = Math.max(shake, 0.5);
    hurtFlash();
    Sfx.hurt();
    combo = 0;
    if (hp <= 0) playerDown();
  }

  async function playerDown() {
    const id = gameId;
    hp = 0;
    state = 'dead';
    mouseDown = false; touchFire = false;
    screenFlash('#ff0033', 0.6);
    Sfx.boom(true);
    await wait(1600);
    if (id !== gameId) return;
    exitLock();
    if (Learn.enabled && revivesLeft > 0) {
      state = 'menu';
      const ok = await Learn.review(2, '💖 复活机会！', `答对 2 个单词就能复活（还剩 ${revivesLeft} 次机会）`, '不复活了，结束游戏');
      if (id !== gameId) return;
      if (ok) {
        revivesLeft--;
        hp = S.maxHp;
        invuln = 3;
        state = 'playing';
        while (allies.length < 2) addAlly();
        grenadeCount = Math.max(grenadeCount, 3);
        // 复活冲击波：把附近坏蛋炸飞
        grenadeBlast(new THREE.Vector3(player.pos.x, 1, player.pos.z));
        banner('复活！', '继续战斗！💪');
        return;
      }
    }
    gameOver();
  }

  function gameOver() {
    state = 'over';
    exitLock();
    const newBest = score > best;
    if (newBest) { best = score; try { localStorage.setItem('tri_best', best); } catch (e) {} }
    $('overTitle').textContent = wave >= 10 ? '🏆 超级英雄！' : '💥 你被打败了';
    $('overStats').innerHTML = `
      分数 <b>${score}</b><br>
      到达第 <b>${wave}</b> 波 · 打败 <b>${kills}</b> 个坏蛋 · 爆头 <b>${headshots}</b> 次<br>
      等级 <b>${level}</b><br>
      ${Learn.enabled ? `本局答对 <b>${Learn.sessionRight}</b> 个单词 📚<br>` : ''}
      ${newBest ? '<span class="newbest">🎉 新纪录！</span>' : `最高分 ${best}`}`;
    $('over').classList.remove('hidden');
  }

  // ================= 每帧更新 =================
  function updatePlayer(dt) {
    fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
    let mz = 0, mx = 0;
    if (keys.KeyW || keys.ArrowUp) mz += 1;
    if (keys.KeyS || keys.ArrowDown) mz -= 1;
    if (keys.KeyA || keys.ArrowLeft) mx -= 1;
    if (keys.KeyD || keys.ArrowRight) mx += 1;
    if (joy.id !== null) { mx += joy.x; mz -= joy.y; }
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const wantX = (fwd.x * mz + right.x * mx) * S.speed, wantZ = (fwd.z * mz + right.z * mx) * S.speed;
    const acc = Math.min(1, dt * (player.onGround ? 12 : 4));
    player.vel.x += (wantX - player.vel.x) * acc;
    player.vel.z += (wantZ - player.vel.z) * acc;
    player.vel.y -= 24 * dt;
    const p = player.pos;
    p.addScaledVector(player.vel, dt);
    pushOut(p, 0.45, p.y);
    const d = Math.hypot(p.x, p.z);
    if (d > R - 0.8) { p.x *= (R - 0.8) / d; p.z *= (R - 0.8) / d; }
    const gh = groundAt(p.x, p.z, 0.45, p.y);
    if (p.y <= gh) { p.y = gh; if (player.vel.y < 0) player.vel.y = 0; player.onGround = true; player.jumpsUsed = 0; }
    else player.onGround = p.y - gh < 0.05;
    const moving = Math.hypot(player.vel.x, player.vel.z) > 1 && player.onGround;
    if (moving) player.bob += dt * 11;

    fireCool -= dt;
    grenadeCool -= dt;
    if ((mouseDown || touchFire) && fireCool <= 0) shoot();
    if (invuln > 0) invuln -= dt;
  }

  function updateCamera(dt, t) {
    if (state === 'title') {
      const a = t * 0.12;
      camera.position.set(Math.sin(a) * 16, 6 + Math.sin(t * 0.3), Math.cos(a) * 16 + 2);
      camera.lookAt(0, 1.5, -1);
      return;
    }
    eyePos(camera.position);
    camera.position.y += Math.sin(player.bob) * 0.06;
    camera.rotation.set(player.pitch, player.yaw, 0);
    if (state === 'dead' || (state === 'menu' && hp <= 0) || state === 'over') {
      camera.position.y = player.pos.y + 0.5;
      camera.rotation.z = 0.5;
    }
    if (shake > 0) {
      camera.position.x += rand(-1, 1) * shake * 0.15;
      camera.position.y += rand(-1, 1) * shake * 0.15;
      camera.rotation.z += rand(-1, 1) * shake * 0.02;
      shake = Math.max(0, shake - dt * 2.5);
    }
    // 枪的晃动、后坐力
    gunKick = Math.max(0, gunKick - dt * 12);
    gunDip = Math.max(0, gunDip - dt * 3);
    gun.position.set(
      GUN_BASE.x + Math.cos(player.bob * 0.5) * 0.012,
      GUN_BASE.y + Math.abs(Math.sin(player.bob * 0.5)) * 0.015 - gunDip * 0.25,
      GUN_BASE.z + gunKick * 0.08);
    gun.rotation.x = gunKick * 0.12 - gunDip * 0.6;
    gun.rotation.y = 0.04;
    muzzleT -= dt;
    muzzleFlash.visible = muzzleT > 0;
    muzzleFlash.material.rotation = Math.random() * 6;
    gunLight.intensity = muzzleT > 0 ? 6 : 0;
  }

  function nearestEnemy(pos, range) {
    let bestE = null, bd = range * range;
    for (const e of enemies) {
      if (e.idle || e.spawnIn > 0) continue;
      const dx = e.g.position.x - pos.x, dz = e.g.position.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; bestE = e; }
    }
    return bestE;
  }

  function updateAllies(dt, t, combat) {
    for (let i = 0; i < allies.length; i++) {
      const a = allies[i], g = a.g;
      if (state === 'title') {
        g.position.y = 1 + Math.sin(t * 3 + a.phase) * 0.2;
        g.rotation.y = Math.atan2(-g.position.x, -6 - g.position.z) + Math.sin(t + a.phase) * 0.2;
        continue;
      }
      // 在玩家身后排成两排
      const col = i % 4, row = Math.floor(i / 4);
      const lx = (col - 1.5) * 2.4, lz = 2.8 + row * 2.2;
      const tx = player.pos.x + right.x * lx - fwd.x * lz, tz = player.pos.z + right.z * lx - fwd.z * lz;
      const k = Math.min(1, dt * 4);
      g.position.x += (tx - g.position.x) * k;
      g.position.z += (tz - g.position.z) * k;
      pushOut(g.position, 0.6);
      g.position.y = player.pos.y + 1.1 + Math.sin(t * 4 + a.phase) * 0.15;
      const target = combat ? nearestEnemy(g.position, 26) : null;
      const face = target ? Math.atan2(target.g.position.x - g.position.x, target.g.position.z - g.position.z) : Math.atan2(fwd.x, fwd.z);
      let diff = face - g.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      g.rotation.y += diff * Math.min(1, dt * 8);
      if (!combat) continue;
      a.cool -= dt;
      if (target && a.cool <= 0) {
        a.cool = rand(0.8, 1.1);
        const tp = new THREE.Vector3().copy(target.g.position); tp.y += target.T.drone ? 0 : 1.3 * target.s;
        spawnTracer(g.position, tp, a.color, 0.06, 0.1);
        emit(tp, a.color, 5, 4, 0.3, 1);
        damageEnemy(target, S.dmg * 0.7);
      }
    }
  }

  function updateEnemies(dt, t) {
    const pp = player.pos;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i], g = e.g, v = e.v;
      if (e.idle) {
        g.rotation.y = Math.atan2(camera.position.x - g.position.x, camera.position.z - g.position.z);
        if (v.legs.length) { v.arms[0].rotation.x = Math.sin(t * 3 + e.phase) * 0.4; g.position.y = Math.abs(Math.sin(t * 2 + e.phase)) * 0.15; }
        else { g.position.y = 3 + Math.sin(t * 2 + e.phase) * 0.3; v.ring.rotation.z += dt * 8; }
        continue;
      }
      if (e.spawnIn > 0) {
        e.spawnIn -= dt;
        g.scale.setScalar(e.s * Math.max(0.01, 1 - e.spawnIn / 0.6));
        continue;
      }
      g.scale.setScalar(e.s);
      let dx = pp.x - g.position.x, dz = pp.z - g.position.z;
      const dist = Math.hypot(dx, dz) || 1;
      dx /= dist; dz /= dist;
      let spd = e.speed * (e.T.boss && e.hp < e.maxHp / 2 ? 1.5 : 1);
      let mvx = dx, mvz = dz;
      // 会开枪的坏蛋保持距离，左右横移
      if (e.T.keep && dist < e.T.keep) {
        e.strafeT -= dt;
        if (e.strafeT <= 0) { e.strafe *= -1; e.strafeT = rand(1, 2.5); }
        mvx = -dz * e.strafe * 0.8 - dx * 0.3; mvz = dx * e.strafe * 0.8 - dz * 0.3;
        spd *= 0.7;
      }
      if (state !== 'playing') spd = 0;
      // 互相推开
      let sx = 0, sz = 0;
      for (let j = 0; j < enemies.length; j++) {
        if (j === i) continue;
        const o = enemies[j];
        const ox = g.position.x - o.g.position.x, oz = g.position.z - o.g.position.z;
        const rr = e.r + o.r + 0.3;
        const d2 = ox * ox + oz * oz;
        if (d2 < rr * rr && d2 > 1e-4) { const d = Math.sqrt(d2); sx += ox / d * (rr - d); sz += oz / d * (rr - d); }
      }
      g.position.x += (mvx * spd + e.kb.x) * dt + sx * 0.4;
      g.position.z += (mvz * spd + e.kb.z) * dt + sz * 0.4;
      e.kb.multiplyScalar(Math.max(0, 1 - dt * 5));
      if (!e.T.drone) pushOut(g.position, e.r + 0.1);
      const ed = Math.hypot(g.position.x, g.position.z);
      if (ed > R - 1) { g.position.x *= (R - 1) / ed; g.position.z *= (R - 1) / ed; }
      g.rotation.y = Math.atan2(dx, dz);

      // 动画
      const walk = t * Math.max(2, spd) * 2.2 + e.phase;
      if (v.legs.length) {
        const amp = spd > 0 ? 0.7 : 0.1;
        v.legs[0].rotation.x = Math.sin(walk) * amp;
        v.legs[1].rotation.x = -Math.sin(walk) * amp;
        v.arms[0].rotation.x = -Math.sin(walk) * amp * 0.8;
        v.arms[1].rotation.x = -1.35 + Math.sin(walk) * 0.08 + (e.burstT > 0 ? -0.15 : 0);
        g.position.y = Math.abs(Math.sin(walk)) * 0.08 * e.s;
        if (v.cape) v.cape.rotation.x = 0.25 + Math.sin(walk * 0.7) * 0.15;
      } else {
        g.position.y = 3.2 + Math.sin(t * 2.5 + e.phase) * 0.5;
        v.ring.rotation.z += dt * 10;
        v.body.rotation.x = Math.atan2(g.position.y - (pp.y + 1.4), dist) * 0.6;
      }
      if (e.flash > 0) { e.flash -= dt; v.armor.emissive.setHex(0xffffff); v.armor.emissiveIntensity = 1.4; }
      else { v.armor.emissive.setHex(e.T.color); v.armor.emissiveIntensity = 0.2; }

      // 开枪
      if (e.T.shoot && state === 'playing') {
        e.shootT -= dt;
        e.burstT -= dt;
        if (e.shootT <= 0 && dist < 34) {
          e.shootT = rand(e.T.shoot[0], e.T.shoot[1]) * (wave > 8 ? 0.8 : 1);
          if (e.T.boss) {
            const angry = e.hp < e.maxHp / 2;
            const n = angry ? 18 : 12, off = Math.random();
            const from = new THREE.Vector3(g.position.x, 1.1, g.position.z);
            for (let k = 0; k < n; k++) {
              const a = (k + off) / n * Math.PI * 2;
              fireOrb(from, new THREE.Vector3(from.x + Math.cos(a), 1.1, from.z + Math.sin(a)), 9, 0xff2255);
            }
            spawnRing(g.position, 0xff0044, 8, 0.5);
            centerText('跳起来躲开！', '#ff5577', 30);
          } else {
            e.burst = e.T.burst || 1;
          }
        }
        if (e.burst > 0 && e.burstT <= 0) {
          e.burst--; e.burstT = 0.22;
          const from = new THREE.Vector3().copy(g.position);
          from.y += e.T.drone ? -0.4 : 1.15 * e.s;
          from.x += dx * 0.8 * e.s + dz * 0.4 * e.s; from.z += dz * 0.8 * e.s - dx * 0.4 * e.s;
          const to = new THREE.Vector3(pp.x + rand(-0.6, 0.6), pp.y + 1.2, pp.z + rand(-0.6, 0.6));
          fireOrb(from, to, e.T.drone ? 13 : 11, e.T.color);
          spawnFlash(from, 0xff5577, 1.2, 0.12);
        }
        if (e.T.boss) {
          e.summonT -= dt;
          if (e.summonT <= 0) {
            e.summonT = 8;
            for (let k = 0; k < 3; k++) {
              const a = Math.random() * Math.PI * 2;
              spawnEnemy(Math.random() < 0.5 ? 'grunt' : 'runner', new THREE.Vector3(g.position.x + Math.cos(a) * 5, 0, g.position.z + Math.sin(a) * 5));
            }
          }
        }
      }

      // 撞到队友
      for (let k = allies.length - 1; k >= 0; k--) {
        const ap = allies[k].g.position;
        const rr = e.r + 0.6;
        if (!e.T.drone && (ap.x - g.position.x) ** 2 + (ap.z - g.position.z) ** 2 < rr * rr) {
          killAlly(k);
          e.kb.set(-dx, 0, -dz).multiplyScalar(e.T.boss ? 2 : 10);
          damageEnemy(e, e.T.boss ? 4 : 3 * S.dmg);
          break;
        }
      }
      if (e.hp <= 0) { i--; continue; }
      // 近身攻击
      e.atk -= dt;
      const reach = e.r + 0.7;
      if (!e.T.drone && dist < reach && pp.y < g.position.y + 2 * e.s && e.atk <= 0 && state === 'playing') {
        e.atk = 1.1;
        hurtPlayer(e.T.dmg);
        e.kb.set(-dx, 0, -dz).multiplyScalar(e.T.boss ? 4 : 12);
        player.vel.x += dx * 8; player.vel.z += dz * 8;
      }
    }
  }

  function updateOrbs(dt) {
    const pp = player.pos;
    for (const o of orbs) {
      if (!o.alive) continue;
      o.life -= dt;
      const p = o.mesh.position;
      p.addScaledVector(o.vel, dt);
      o.mesh.rotation.y += dt * 6;
      if (o.life <= 0 || Math.hypot(p.x, p.z) > R + 3 || p.y < 0 || insideBox(p)) {
        if (o.life > 0) emit(p, 0xff2255, 6, 3, 0.3, 1);
        o.alive = false; o.mesh.visible = false; continue;
      }
      let hit = false;
      for (let i = allies.length - 1; i >= 0; i--) {
        const ap = allies[i].g.position;
        if ((ap.x - p.x) ** 2 + (ap.y - p.y) ** 2 + (ap.z - p.z) ** 2 < 0.6) { killAlly(i); hit = true; break; }
      }
      if (!hit && (pp.x - p.x) ** 2 + (pp.z - p.z) ** 2 < 0.45 && p.y > pp.y && p.y < pp.y + 1.9) {
        hurtPlayer(1); hit = true;
      }
      if (hit) { o.alive = false; o.mesh.visible = false; emit(p, 0xff2255, 12, 5, 0.4, 1); }
    }
  }

  function updatePickups(dt) {
    const pp = player.pos;
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i], g = p.g;
      p.t += dt; p.life -= dt;
      if (p.life <= 0) { removePickup(i); continue; }
      if (p.vel.lengthSq() > 0.01) {
        g.position.addScaledVector(p.vel, dt);
        p.vel.y -= 16 * dt;
        if (g.position.y < 0.7) { g.position.y = 0.7; p.vel.set(0, 0, 0); }
      } else {
        g.position.y = 0.8 + Math.sin(p.t * 3) * 0.2;
      }
      if (!g.isSprite) g.rotation.y += dt * 2.5;
      if (p.life < 4) g.visible = Math.floor(p.life * 6) % 2 === 0;
      const dx = pp.x - g.position.x, dz = pp.z - g.position.z;
      const d = Math.hypot(dx, dz) || 0.01;
      if (p.kind === 'gem' && (d < S.magnet || p.forced) && state === 'playing') {
        const sp = (p.forced ? 30 : 14) + Math.max(0, S.magnet - d) * 2;
        g.position.x += dx / d * sp * dt; g.position.z += dz / d * sp * dt;
      }
      if (d < 1.4 && state === 'playing') {
        if (p.kind === 'gem') {
          xp++;
          Sfx.gem();
          const need = 4 + level * 3;
          if (xp >= need) { xp -= need; level++; pendingLevels++; }
        } else if (p.kind === 'recruit') {
          if (addAlly(g.position)) centerText('🔺 新队友加入！', '#5dff8a', 36);
          else centerText('队伍满员！+50 分', '#ffe15a', 30);
          Sfx.recruit();
        } else if (p.kind === 'grenade') {
          if (grenadeCount >= S.maxGrenades) continue;
          grenadeCount = Math.min(S.maxGrenades, grenadeCount + 2);
          centerText('💣 +2 手榴弹', '#ffb347', 34);
          bumpGrenadeBox();
          Sfx.pickup();
        } else {
          if (hp >= S.maxHp) continue;
          hp = Math.min(S.maxHp, hp + 3);
          centerText('❤️ +3', '#ff5577', 36);
          Sfx.pickup();
        }
        removePickup(i);
      }
    }
  }

  function updateWave(dt) {
    if (!waveActive) return;
    spawnTimer -= dt;
    const maxAlive = 5 + Math.min(10, wave);
    const alive = enemies.length;
    if (spawnQueue.length && spawnTimer <= 0 && alive < maxAlive) {
      spawnTimer = Math.max(0.6, 2 - wave * 0.08);
      const p = spawnPoint();
      const n = Math.min(spawnQueue.length, 1 + Math.floor(Math.random() * Math.min(3, 1 + wave / 3)), maxAlive - alive);
      for (let i = 0; i < n; i++) {
        const type = spawnQueue.shift();
        const e = spawnEnemy(type, new THREE.Vector3(p.x + rand(-2, 2), 0, p.z + rand(-2, 2)));
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
      recruitTimer = rand(9, 13);
      const nRec = pickups.filter(p => p.kind === 'recruit').length;
      if (nRec < 2 && allies.length < S.maxAllies) {
        for (let k = 0; k < 10; k++) {
          const a = Math.random() * Math.PI * 2, r = rand(6, R * 0.8);
          const pos = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
          if (pos.distanceTo(player.pos) > 8 && !obstacles.some(o => Math.abs(pos.x - o.x) < o.hx + 1 && Math.abs(pos.z - o.z) < o.hz + 1)) {
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
  const radar = $('radar'), rctx = radar.getContext('2d');
  const crossEl = $('crosshair');
  const aimDir = new THREE.Vector3(), aimEye = new THREE.Vector3(), aimC = new THREE.Vector3();
  function updateHUD() {
    setText('score', score);
    setText('wave', wave);
    setText('left', enemies.length + spawnQueue.length);
    setText('level', level);
    setText('troops', allies.length);
    setText('grenades', grenadeCount);
    setWidth('hpbar', Math.max(0, hp) / S.maxHp * 100);
    setWidth('xpbar', xp / (4 + level * 3) * 100);
    if (boss) setWidth('bossbar', Math.max(0, boss.hp) / boss.maxHp * 100);
    // 准星对准坏蛋时变红
    if (state === 'playing') {
      eyePos(aimEye);
      camera.getWorldDirection(aimDir);
      let hot = false;
      for (const e of enemies) {
        if (e.idle || e.spawnIn > 0) continue;
        for (const s of hitSpheres(e)) if (raySphere(aimEye, aimDir, aimC.set(s[0], s[1], s[2]), s[3] * 1.15) > 0) { hot = true; break; }
        if (hot) break;
      }
      crossEl.classList.toggle('hot', hot);
    }
    drawRadar();
  }
  function drawRadar() {
    const W = 300, c = W / 2, scale = 140 / 40;
    rctx.clearRect(0, 0, W, W);
    rctx.strokeStyle = 'rgba(126,249,255,0.25)';
    rctx.lineWidth = 2;
    for (const r of [45, 90, 135]) { rctx.beginPath(); rctx.arc(c, c, r, 0, Math.PI * 2); rctx.stroke(); }
    const pp = player.pos;
    const local = (x, z) => {
      const dx = x - pp.x, dz = z - pp.z;
      return [(dx * right.x + dz * right.z) * scale, -(dx * fwd.x + dz * fwd.z) * scale];
    };
    // 掩体
    rctx.fillStyle = 'rgba(126,249,255,0.18)';
    for (const o of obstacles) {
      const [px, py] = local(o.x, o.z);
      if (Math.hypot(px, py) > 140) continue;
      rctx.beginPath(); rctx.arc(c + px, c + py, Math.max(o.hx, o.hz) * scale * 0.8, 0, Math.PI * 2); rctx.fill();
    }
    const plot = (x, z, color, size) => {
      let [px, py] = local(x, z);
      const l = Math.hypot(px, py);
      if (l > 140) { px = px / l * 140; py = py / l * 140; }
      rctx.fillStyle = color;
      rctx.beginPath(); rctx.arc(c + px, c + py, size, 0, Math.PI * 2); rctx.fill();
    };
    for (const p of pickups) if (p.kind !== 'gem') plot(p.g.position.x, p.g.position.z, p.kind === 'recruit' ? '#5dff8a' : (p.kind === 'grenade' ? '#ffb347' : '#ff7799'), 6);
    for (const a of allies) plot(a.g.position.x, a.g.position.z, '#7ef9ff', 5);
    for (const e of enemies) plot(e.g.position.x, e.g.position.z, e.T.boss ? '#ff2255' : '#ff5577', e.T.boss ? 14 : 7);
    // 视野扇形 + 自己
    rctx.fillStyle = 'rgba(126,249,255,0.12)';
    rctx.beginPath(); rctx.moveTo(c, c); rctx.arc(c, c, 140, -Math.PI / 2 - 0.65, -Math.PI / 2 + 0.65); rctx.fill();
    rctx.fillStyle = '#ffe15a';
    rctx.beginPath(); rctx.moveTo(c, c - 12); rctx.lineTo(c + 9, c + 9); rctx.lineTo(c - 9, c + 9); rctx.fill();
  }

  // ---------- 主循环 ----------
  let last = performance.now(), time = 0, titleFx = 0;
  const ctpEl = $('clickToPlay');
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const waitingLock = state === 'playing' && needLock();
    ctpEl.classList.toggle('hidden', !waitingLock);
    const active = (state === 'playing' && !waitingLock) || state === 'dead';
    if (active || state === 'title') time += dt;
    const t = time;

    floorMat.uniforms.uTime.value = t;
    floorMat.uniforms.uPlayer.value.copy(player.pos);
    wallMat.uniforms.uTime.value = t;
    skyTris.forEach((m, i) => { m.rotation.z += dt * (0.05 + i * 0.02); });
    pillars.forEach((m, i) => { m.material.emissiveIntensity = 0.7 + Math.sin(t * 3 + i * 0.8) * 0.4; });

    if (state === 'title') {
      updateAllies(dt, t, false);
      updateEnemies(dt, t);
      titleFx -= dt;
      if (titleFx <= 0) {
        titleFx = rand(0.7, 1.5);
        const a = Math.random() * Math.PI * 2, r = rand(26, 38);
        explode(new THREE.Vector3(Math.cos(a) * r, rand(6, 14), Math.sin(a) * r), TROOP_COLORS[Math.floor(Math.random() * TROOP_COLORS.length)], 1.6, true);
      }
    } else if (active) {
      if (state === 'playing') {
        updatePlayer(dt);
        comboTimer -= dt;
        if (comboTimer <= 0) combo = 0;
        updateWave(dt);
      }
      updateAllies(dt, t, state === 'playing');
      updateEnemies(dt, t);
      updateOrbs(dt);
      updateGrenades(dt);
      updatePickups(dt);
      if (state === 'playing' && pendingLevels > 0) doLevelUp();
    }
    if (active || state === 'title') {
      updateParticles(dt);
      updateShards(dt);
      updateRings(dt);
      updateFlashes(dt);
      updateTracers(dt);
    }
    if (state !== 'title') updateHUD();
    updateCamera(active ? dt : 0, t);
    renderer.render(scene, camera);
  }

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // 测试用的小工具
  window.__game = {
    get state() { return state; }, get wave() { return wave; }, get enemies() { return enemies.length; },
    get allies() { return allies.length; }, get score() { return score; }, get grenades() { return grenadeCount; },
    get hp() { return hp; },
    noLock() { lockFallback = true; },
    killAll() { enemies.slice().forEach(e => { if (!e.idle) damageEnemy(e, 9999); }); },
    hurt(n) { invuln = 0; hurtPlayer(n); },
    addXp(n) { for (let i = 0; i < n; i++) { xp++; const need = 4 + level * 3; if (xp >= need) { xp -= need; level++; pendingLevels++; } } },
    aimAtNearest() {
      const e = nearestEnemy(player.pos, 200);
      if (!e) return false;
      const dx = e.g.position.x - player.pos.x, dz = e.g.position.z - player.pos.z;
      player.yaw = Math.atan2(-dx, -dz);
      const dy = (e.g.position.y + (e.T.drone ? 0 : 1.3 * e.s)) - (player.pos.y + 1.65);
      player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      return true;
    },
    fire(on) { mouseDown = on; },
    grenade() { throwGrenade(); },
    spawn(kind) { spawnPickup(kind, new THREE.Vector3().copy(player.pos).addScaledVector(fwd, 4)); },
  };

  toTitle();
  requestAnimationFrame(frame);
})();
