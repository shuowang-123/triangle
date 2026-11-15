// 真实比例的士兵模型（全部用代码搭出来，没有外部模型文件）
// Humans.make(kind)  kind: ally | grunt | runner | heavy | boss | hostage
// Humans.animate(v, dt, speed)  走路 / 跑步 / 站立呼吸
window.Humans = (function () {
  'use strict';
  const TAU = Math.PI * 2;

  // ---------- 贴图：迷彩布料 + 布纹法线 ----------
  function canvas(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    return c;
  }
  function tex(c, srgb, rep) {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (rep) t.repeat.set(rep, rep);
    return t;
  }
  function camo(colors, seed) {
    return canvas(256, 256, (g, w, h) => {
      g.fillStyle = colors[0]; g.fillRect(0, 0, w, h);
      let s = seed || 1;
      const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      for (let layer = 1; layer < colors.length; layer++) {
        g.fillStyle = colors[layer];
        for (let i = 0; i < 26; i++) {
          const x = rnd() * w, y = rnd() * h, r = 8 + rnd() * 22;
          for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
            g.beginPath();
            for (let k = 0; k < 9; k++) {
              const a = k / 9 * TAU, rr = r * (0.6 + rnd() * 0.6);
              const px = x + ox + Math.cos(a) * rr * 1.4, py = y + oy + Math.sin(a) * rr;
              if (k) g.lineTo(px, py); else g.moveTo(px, py);
            }
            g.fill();
          }
        }
      }
      // 布纹
      g.globalAlpha = 0.08;
      for (let y = 0; y < h; y += 2) { g.fillStyle = y % 4 ? '#000' : '#fff'; g.fillRect(0, y, w, 1); }
      g.globalAlpha = 1;
    });
  }
  const fabricNormal = (() => {
    // 斜纹布：由高度图算出法线
    const N = 128;
    const hgt = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      hgt[y * N + x] = Math.sin((x + y) * 0.9) * 0.5 + Math.sin(x * 0.45) * 0.15 + (Math.random() - 0.5) * 0.25;
    }
    const c = canvas(N, N, (g) => {
      const img = g.createImageData(N, N);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const l = hgt[y * N + (x + N - 1) % N], r = hgt[y * N + (x + 1) % N];
        const u = hgt[((y + N - 1) % N) * N + x], d = hgt[((y + 1) % N) * N + x];
        let nx = (l - r) * 1.2, ny = (u - d) * 1.2, nz = 1;
        const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
        const i = (y * N + x) * 4;
        img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = (nz * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    });
    return tex(c, false, 6);
  })();

  const CAMO = {
    ally: tex(camo(['#b9a77e', '#8f7d55', '#6f6a44', '#d4c39a'], 7), true, 2),
    enemy: tex(camo(['#66686c', '#43454a', '#7d766c', '#2c2d31'], 3), true, 2),
    runner: tex(camo(['#5b4a3a', '#3c3128', '#7a6450', '#2a231d'], 11), true, 2),
  };
  function fabric(map, color, rough) {
    return new THREE.MeshStandardMaterial({ map, color: color || 0xffffff, normalMap: fabricNormal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: rough || 0.92, metalness: 0 });
  }
  const MAT = {
    skinA: new THREE.MeshStandardMaterial({ color: 0xe0ac84, roughness: 0.62 }),
    skinB: new THREE.MeshStandardMaterial({ color: 0xc68a62, roughness: 0.62 }),
    skinC: new THREE.MeshStandardMaterial({ color: 0x8d5a3b, roughness: 0.6 }),
    eyeW: new THREE.MeshStandardMaterial({ color: 0xf3f0ea, roughness: 0.25 }),
    iris: new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.2 }),
    hair: new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.9 }),
    boot: new THREE.MeshStandardMaterial({ color: 0x3b3025, roughness: 0.75 }),
    sole: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }),
    glove: new THREE.MeshStandardMaterial({ color: 0x2e2a24, roughness: 0.85 }),
    gunMetal: new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.42, metalness: 0.75 }),
    gunPoly: new THREE.MeshStandardMaterial({ color: 0x1f2124, roughness: 0.7, metalness: 0.1 }),
    strap: new THREE.MeshStandardMaterial({ color: 0x2d2a22, roughness: 0.9 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x0d1a24, roughness: 0.05, metalness: 0.9 }),
    blueBand: new THREE.MeshStandardMaterial({ color: 0x2f6bd8, roughness: 0.7, emissive: 0x0a2050, emissiveIntensity: 0.4 }),
    redBand: new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.7, emissive: 0x400808, emissiveIntensity: 0.4 }),
    iff: new THREE.MeshBasicMaterial({ color: 0x5fd7ff, toneMapped: false }),
    visor: new THREE.MeshStandardMaterial({ color: 0xff8a1f, emissive: 0xff6a00, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.6 }),
    beret: new THREE.MeshStandardMaterial({ color: 0xa3201b, roughness: 0.95 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd8b04a, roughness: 0.3, metalness: 0.9 }),
    medalRibbon: new THREE.MeshStandardMaterial({ color: 0x2a55b0, roughness: 0.7 }),
  };

  // ---------- 几何体（缓存起来共用） ----------
  const G = {};
  function limb(r, len) {
    const k = 'l' + r + '_' + len;
    if (!G[k]) { const g = new THREE.CapsuleGeometry(r, len, 5, 12); g.translate(0, -len / 2, 0); G[k] = g; }
    return G[k];
  }
  function sph(r, ws, hs) { const k = 's' + r + (ws || 0); return G[k] || (G[k] = new THREE.SphereGeometry(r, ws || 18, hs || 14)); }
  function box(w, h, d) { const k = 'b' + w + '_' + h + '_' + d; return G[k] || (G[k] = new THREE.BoxGeometry(w, h, d)); }
  function cyl(rt, rb, h, seg) { const k = 'c' + rt + '_' + rb + '_' + h; return G[k] || (G[k] = new THREE.CylinderGeometry(rt, rb, h, seg || 14)); }
  // 圆角盒子（防弹背心用）
  function rbox(w, h, d, r) {
    const k = 'r' + w + '_' + h + '_' + d;
    if (G[k]) return G[k];
    const shape = new THREE.Shape();
    const x = -w / 2, y = -h / 2;
    shape.moveTo(x + r, y); shape.lineTo(x + w - r, y); shape.quadraticCurveTo(x + w, y, x + w, y + r);
    shape.lineTo(x + w, y + h - r); shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    shape.lineTo(x + r, y + h); shape.quadraticCurveTo(x, y + h, x, y + h - r);
    shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
    const g = new THREE.ExtrudeGeometry(shape, { depth: d - r, bevelEnabled: true, bevelThickness: r / 2, bevelSize: r / 2, bevelSegments: 2, curveSegments: 4 });
    g.translate(0, 0, -(d - r) / 2);
    return (G[k] = g);
  }
  const helmetGeo = new THREE.SphereGeometry(0.138, 22, 12, 0, TAU, 0, Math.PI * 0.56);
  const beretGeo = (() => { const g = new THREE.SphereGeometry(0.15, 20, 8, 0, TAU, 0, Math.PI * 0.5); g.scale(1.1, 0.42, 1.05); return g; })();

  function mesh(parent, geo, mat, x, y, z, sx, sy, sz) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (sx) m.scale.set(sx, sy, sz);
    parent.add(m);
    return m;
  }
  function grp(parent, x, y, z) { const g = new THREE.Group(); g.position.set(x || 0, y || 0, z || 0); parent.add(g); return g; }

  // NPC 拿的步枪（朝 +z）
  function npcRifle(heavy) {
    const g = new THREE.Group();
    const k = heavy ? 1.25 : 1;
    mesh(g, box(0.05 * k, 0.075 * k, 0.32), MAT.gunMetal, 0, 0, 0);
    mesh(g, box(0.055 * k, 0.06 * k, 0.2), MAT.gunPoly, 0, 0.002, 0.24);
    const br = mesh(g, cyl(0.011 * k, 0.011 * k, 0.24, 8), MAT.gunMetal, 0, 0.008, 0.44); br.rotation.x = Math.PI / 2;
    const mz = mesh(g, cyl(0.017 * k, 0.017 * k, 0.05, 8), MAT.gunPoly, 0, 0.008, 0.57); mz.rotation.x = Math.PI / 2;
    const mg = mesh(g, box(0.035 * k, 0.15, 0.06), MAT.gunPoly, 0, -0.1, 0.07); mg.rotation.x = 0.25;
    const gp = mesh(g, box(0.035, 0.1, 0.045), MAT.gunPoly, 0, -0.08, -0.08); gp.rotation.x = -0.35;
    mesh(g, box(0.045, 0.085, 0.22), MAT.gunPoly, 0, -0.015, -0.26);
    mesh(g, box(0.04, 0.04, 0.08), MAT.gunMetal, 0, 0.06, 0.02);
    if (heavy) mesh(g, cyl(0.06, 0.06, 0.12, 12), MAT.gunPoly, 0, -0.1, 0.12);
    return g;
  }

  function make(kind) {
    const enemy = kind !== 'ally' && kind !== 'hostage';
    const cam = kind === 'runner' ? CAMO.runner : enemy ? CAMO.enemy : CAMO.ally;
    const uni = fabric(cam, kind === 'boss' ? 0x8a5a55 : 0xffffff);
    const pants = fabric(cam, kind === 'boss' ? 0x6a4a46 : 0xdddddd);
    const flashMats = [uni, pants];
    const skin = kind === 'boss' ? MAT.skinB : enemy ? MAT.skinA : [MAT.skinA, MAT.skinB, MAT.skinC][Math.floor(Math.random() * 3)];
    let vestMat = null;
    if (kind === 'ally' || kind === 'hostage') vestMat = new THREE.MeshStandardMaterial({ color: 0x6b6a4a, roughness: 0.85, normalMap: fabricNormal, normalScale: new THREE.Vector2(0.5, 0.5) });
    else if (kind === 'grunt') vestMat = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.85, normalMap: fabricNormal, normalScale: new THREE.Vector2(0.5, 0.5) });
    else if (kind === 'heavy') vestMat = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.5, metalness: 0.35 });
    if (vestMat) flashMats.push(vestMat);

    const g = new THREE.Group();
    const v = { g, kind, flashMats, phase: Math.random() * TAU, armed: kind !== 'runner' && kind !== 'hostage', baseColor: enemy ? 0x4a4b4f : 0xb9a77e };
    const pelvis = grp(g, 0, 0.98, 0); v.pelvis = pelvis;
    mesh(pelvis, sph(0.16), pants, 0, -0.02, 0, 1.05, 0.72, 0.78);
    mesh(pelvis, cyl(0.17, 0.17, 0.06, 18), MAT.strap, 0, 0.04, 0, 1, 1, 0.75); // 腰带
    mesh(pelvis, box(0.05, 0.04, 0.02), MAT.gold, 0, 0.04, 0.13);
    // 腿
    v.thighs = []; v.knees = []; v.feet = [];
    for (const sx of [-1, 1]) {
      const hip = grp(pelvis, sx * 0.095, -0.04, 0);
      mesh(hip, limb(0.078, 0.34), pants, 0, 0, 0);
      mesh(hip, box(0.05, 0.11, 0.1), pants, sx * 0.075, -0.2, 0.01); // 大腿口袋
      const knee = grp(hip, 0, -0.44, 0);
      mesh(knee, sph(0.06), MAT.strap, 0, 0, 0.045, 1, 1, 0.6); // 护膝
      mesh(knee, limb(0.062, 0.32), pants, 0, -0.02, 0);
      const foot = grp(knee, 0, -0.44, 0);
      mesh(foot, box(0.115, 0.13, 0.15), MAT.boot, 0, 0.0, -0.005);
      mesh(foot, box(0.11, 0.09, 0.27), MAT.boot, 0, -0.02, 0.05);
      mesh(foot, box(0.12, 0.025, 0.29), MAT.sole, 0, -0.07, 0.05);
      v.thighs.push(hip); v.knees.push(knee); v.feet.push(foot);
    }
    // 上半身
    const spine = grp(pelvis, 0, 0.06, 0); v.spine = spine;
    mesh(spine, sph(0.15), uni, 0, 0.13, 0, 1.0, 1.05, 0.72);
    const chest = mesh(spine, sph(0.2), uni, 0, 0.33, 0, 1.0, 0.95, 0.66); v.chest = chest;
    if (vestMat) {
      const big = kind === 'heavy' ? 1.15 : 1;
      mesh(spine, rbox(0.36 * big, 0.36 * big, 0.25 * big, 0.04), vestMat, 0, 0.31, 0.005);
      for (const px of [-0.1, 0, 0.1]) mesh(spine, rbox(0.08, 0.11, 0.05, 0.015), vestMat, px * big, 0.22, 0.14 * big);
      mesh(spine, rbox(0.12, 0.08, 0.04, 0.012), vestMat, -0.08 * big, 0.4, 0.14 * big);
      for (const sx of [-1, 1]) mesh(spine, box(0.06, 0.05, 0.22 * big), vestMat, sx * 0.11, 0.5, 0);
      if (kind === 'heavy') for (const sx of [-1, 1]) { const sp = mesh(spine, sph(0.11), vestMat, sx * 0.25, 0.44, 0, 1, 0.6, 1); sp.rotation.z = sx * 0.4; }
    }
    if (kind === 'ally') { mesh(spine, rbox(0.3, 0.38, 0.14, 0.04), fabric(CAMO.ally, 0x9a9070), 0, 0.3, -0.19); } // 背包
    if (kind === 'boss') {
      // 军官外套的扣子、勋章、肩章
      for (let i = 0; i < 4; i++) mesh(spine, sph(0.012, 8, 6), MAT.gold, 0.03, 0.12 + i * 0.09, 0.135);
      for (let i = 0; i < 3; i++) { mesh(spine, box(0.03, 0.02, 0.01), MAT.medalRibbon, -0.12 + i * 0.04, 0.38, 0.13); const m = mesh(spine, cyl(0.014, 0.014, 0.006, 10), MAT.gold, -0.12 + i * 0.04, 0.35, 0.133); m.rotation.x = Math.PI / 2; }
      for (const sx of [-1, 1]) mesh(spine, box(0.12, 0.025, 0.1), MAT.gold, sx * 0.19, 0.5, 0);
    }
    // 脖子 + 头
    mesh(spine, cyl(0.05, 0.055, 0.1, 12), skin, 0, 0.55, 0);
    const head = grp(spine, 0, 0.6, 0); v.head = head;
    const masked = kind === 'grunt' || kind === 'runner';
    const headMat = masked ? fabric(null, kind === 'runner' ? 0x3a2f27 : 0x1f2023, 0.95) : skin;
    if (masked) flashMats.push(headMat);
    mesh(head, sph(0.105, 22, 16), headMat, 0, 0.1, 0, 0.92, 1.1, 1.0);
    mesh(head, sph(0.075), headMat, 0, 0.035, 0.03, 0.95, 0.7, 0.9); // 下巴
    const nose = mesh(head, new THREE.ConeGeometry(0.016, 0.045, 8), headMat, 0, 0.085, 0.102); nose.rotation.x = Math.PI / 2 + 0.25;
    for (const sx of [-1, 1]) mesh(head, sph(0.026, 10, 8), headMat, sx * 0.097, 0.095, 0, 0.45, 1, 0.75); // 耳朵
    const showEyes = kind !== 'heavy';
    if (masked) mesh(head, box(0.12, 0.034, 0.03), skin, 0, 0.122, 0.088); // 头套露出眼睛的那条缝
    if (showEyes && kind !== 'boss') {
      for (const sx of [-1, 1]) {
        mesh(head, sph(0.015, 10, 8), MAT.eyeW, sx * 0.036, 0.122, 0.092);
        mesh(head, sph(0.008, 8, 6), MAT.iris, sx * 0.036, 0.122, 0.105);
        const br = mesh(head, box(0.04, 0.009, 0.012), masked ? headMat : MAT.hair, sx * 0.037, 0.145, 0.098);
        br.rotation.z = enemy ? sx * 0.28 : -sx * 0.06; // 坏蛋皱眉
      }
    }
    if (!masked && kind !== 'heavy') mesh(head, box(0.045, 0.007, 0.01), MAT.skinC, 0, 0.045, 0.1); // 嘴
    if (kind === 'boss') {
      for (const sx of [-1, 1]) mesh(head, box(0.05, 0.03, 0.012), MAT.lens, sx * 0.034, 0.122, 0.102);
      mesh(head, box(0.025, 0.008, 0.01), MAT.lens, 0, 0.128, 0.104);
      mesh(head, box(0.075, 0.016, 0.02), MAT.hair, 0, 0.062, 0.1); // 胡子
      const b = mesh(head, beretGeo, MAT.beret, 0.02, 0.19, -0.005); b.rotation.z = -0.22;
      mesh(head, sph(0.1), MAT.hair, 0, 0.12, -0.02, 0.98, 0.95, 1.02);
    }
    // 头盔
    if (kind === 'ally' || kind === 'grunt' || kind === 'heavy' || kind === 'hostage') {
      const hm = new THREE.MeshStandardMaterial({ color: kind === 'ally' || kind === 'hostage' ? 0x7a7552 : 0x2b2c2f, roughness: 0.7, normalMap: fabricNormal, normalScale: new THREE.Vector2(0.3, 0.3) });
      flashMats.push(hm);
      const hs = kind === 'heavy' ? 1.12 : 1;
      mesh(head, helmetGeo, hm, 0, 0.115, -0.005, hs, hs * 1.0, hs * 1.08);
      mesh(head, cyl(0.142 * hs, 0.142 * hs, 0.02, 22), hm, 0, 0.12, -0.005, 1, 1, 1.08);
      for (const sx of [-1, 1]) { const ear = mesh(head, cyl(0.04, 0.04, 0.035, 12), MAT.strap, sx * 0.115, 0.09, 0); ear.rotation.z = Math.PI / 2; }
      if (kind === 'heavy') {
        mesh(head, box(0.2, 0.07, 0.05), MAT.visor, 0, 0.12, 0.115);
        mesh(head, box(0.16, 0.08, 0.04), hm, 0, 0.04, 0.11);
      } else {
        // 护目镜推在头盔上
        mesh(head, box(0.17, 0.045, 0.03), MAT.strap, 0, 0.2, 0.12);
        for (const sx of [-1, 1]) mesh(head, box(0.065, 0.035, 0.012), MAT.lens, sx * 0.04, 0.2, 0.136);
      }
      if (kind === 'ally' || kind === 'hostage') mesh(head, box(0.025, 0.025, 0.025), MAT.iff, 0, 0.24, -0.08);
    }
    if (kind === 'runner') mesh(head, cyl(0.112, 0.112, 0.04, 18), MAT.redBand, 0, 0.17, 0, 0.95, 1, 1.02); // 红头巾
    // 手臂
    v.shoulders = []; v.elbows = [];
    for (const sx of [-1, 1]) {
      const sh = grp(spine, sx * 0.205, 0.45, 0);
      mesh(sh, sph(0.07), uni, 0, -0.01, 0, 1, 0.95, 1);
      mesh(sh, limb(0.056, 0.2), uni, 0, -0.02, 0);
      mesh(sh, box(0.008, 0.07, 0.11), enemy ? MAT.redBand : MAT.blueBand, sx * 0.056, -0.1, 0); // 臂章：蓝色是自己人，红色是坏蛋
      const el = grp(sh, 0, -0.3, 0);
      mesh(el, limb(0.048, 0.18), uni, 0, 0, 0);
      const hand = grp(el, 0, -0.27, 0);
      mesh(hand, box(0.065, 0.085, 0.035), kind === 'boss' ? skin : MAT.glove, 0, -0.03, 0);
      mesh(hand, sph(0.022), kind === 'boss' ? skin : MAT.glove, sx * -0.03, -0.02, 0.015);
      v.shoulders.push(sh); v.elbows.push(el);
    }
    if (v.armed) {
      const rifle = npcRifle(kind === 'heavy');
      rifle.position.set(0.07, 0.3, 0.3);
      spine.add(rifle);
      v.rifle = rifle;
    }
    v.muzzleZ = 0.6;
    if (kind === 'hostage') setSit(v);
    else if (v.armed) aimPose(v, 0);
    v.g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
    return v;
  }
  function aimPose(v, sway) {
    const [L, Rr] = v.shoulders, [eL, eR] = v.elbows;
    Rr.rotation.set(-0.7 + sway, 0.0, -0.2);
    eR.rotation.set(-1.3, 0, 0);
    L.rotation.set(-1.1 + sway, 0, 0.5);
    eL.rotation.set(-0.6, 0, 0);
  }
  function setSit(v) {
    v.pelvis.position.y = 0.2;
    v.thighs.forEach((t, i) => { t.rotation.set(-1.45, 0, (i ? -1 : 1) * 0.12); });
    v.knees.forEach(k => { k.rotation.x = 1.5; });
    v.shoulders.forEach((s, i) => { s.rotation.set(0.35, 0, (i ? -1 : 1) * 0.1); });
    v.elbows.forEach(e => { e.rotation.x = -0.4; });
    v.spine.rotation.x = 0.12;
    v.head.rotation.x = 0.25;
  }

  // 走路 / 跑步动画。speed 是每秒多少米
  function animate(v, dt, speed) {
    if (v.kind === 'hostage') return;
    const run = Math.min(1, speed / 5);
    const amp = Math.min(1, speed / 2.2) * (0.55 + run * 0.3);
    v.phase += dt * (speed > 0.2 ? 3 + speed * 1.1 : 0);
    v.breath = (v.breath || 0) + dt * 2.2;
    const p = v.phase;
    for (let i = 0; i < 2; i++) {
      const s = i ? Math.PI : 0;
      v.thighs[i].rotation.x = -Math.sin(p + s) * amp;
      v.knees[i].rotation.x = 0.05 + amp * 1.25 * Math.max(0, Math.sin(p + s + 1.3)) + run * 0.2;
      v.feet[i].rotation.x = -0.15 * amp * Math.sin(p + s);
    }
    v.pelvis.position.y = 0.98 - Math.abs(Math.cos(p)) * 0.035 * amp - run * 0.04 * (amp > 0 ? 1 : 0);
    v.pelvis.rotation.y = Math.sin(p) * 0.08 * amp;
    v.spine.rotation.y = -Math.sin(p) * 0.1 * amp;
    v.spine.rotation.x = 0.04 + run * 0.18 * (amp > 0 ? 1 : 0);
    v.chest.scale.y = 0.95 + Math.sin(v.breath) * 0.008;
    if (v.armed) aimPose(v, Math.sin(v.breath) * 0.015 + Math.sin(p * 2) * 0.03 * amp);
    else {
      for (let i = 0; i < 2; i++) {
        const s = i ? 0 : Math.PI;
        v.shoulders[i].rotation.set(-Math.sin(p + s) * amp * 0.9, 0, (i ? -1 : 1) * 0.08);
        v.elbows[i].rotation.x = -0.35 - run * 0.9;
      }
    }
  }
  return { make, animate, CAMO, fabricNormal, MAT, npcRifle };
})();
