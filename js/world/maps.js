// 三张大地图：地形形状、地面材质分布、树、石头、建筑和任务地点
// 每张地图 1.6 公里见方。layout() 用 TSBuild 摆房子和军事设施，并返回任务要用的地点（spots）
(function () {
  'use strict';
  const N = () => TSNoise;
  const S = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;

  // 平整一块地（营地、村子、要塞要放在平地上）
  function applyStamps(h, x, z, stamps) {
    for (const s of stamps) {
      const d = s.box ? Math.max(Math.abs(x - s.x) - s.w, Math.abs(z - s.z) - s.d, 0) : Math.max(0, Math.hypot(x - s.x, z - s.z) - s.r);
      const k = 1 - S(0, s.fall || 25, d);
      if (k > 0) h = lerp(h, s.h, k * (s.k || 1));
    }
    return h;
  }
  function stampDist(x, z, s) { return s.box ? Math.max(Math.abs(x - s.x) - s.w, Math.abs(z - s.z) - s.d, 0) : Math.max(0, Math.hypot(x - s.x, z - s.z) - s.r); }
  // 路：一串点连成的折线
  function roadDist(x, z, pts) {
    let best = 1e9, bi = 0, bt = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
      const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
      let t = l2 > 0 ? ((x - ax) * vx + (z - az) * vz) / l2 : 0; t = Math.max(0, Math.min(1, t));
      const dx = x - (ax + vx * t), dz = z - (az + vz * t), d = dx * dx + dz * dz;
      if (d < best) { best = d; bi = i; bt = t; }
    }
    return [Math.sqrt(best), bi, bt];
  }

  // ======================= 通用的地图生成 =======================
  function makeMap(cfg) {
    const n1 = N().makeSimplex(cfg.seed), n2 = N().makeSimplex(cfg.seed + 12), n3 = N().makeSimplex(cfg.seed + 26);
    const SIZE = 1600, HALF = 800;
    const WATER = cfg.water != null ? cfg.water : -50;
    const LAKE = cfg.lake || null;
    const stamps = cfg.stamps, roads = cfg.roads;
    const ctx = { n1, n2, n3, HALF, S, lerp };
    const base = (x, z) => cfg.base(x, z, ctx);
    function height(x, z) {
      let h = base(x, z);
      if (LAKE) {
        const ld = Math.hypot(x - LAKE.x, (z - LAKE.z) * 1.35) / LAKE.r + N().fbm(n2, x / 90, z / 90, 3) * 0.25;
        h = lerp(h, WATER - 7 - (1 - Math.min(1, ld)) * 6, 1 - S(0.75, 1.35, ld));
      }
      return applyStamps(h, x, z, stamps);
    }
    // 路面压平：沿路的高度先做平滑（不会出现深沟），再把路两边慢慢拉过去
    function post(H, V, cell, half) {
      const at = (x, z) => { const i = Math.max(0, Math.min(V - 1, Math.round((x + half) / cell))), j = Math.max(0, Math.min(V - 1, Math.round((z + half) / cell))); return H[j * V + i]; };
      for (const r of roads) {
        const samp = [];
        for (let i = 0; i < r.length - 1; i++) {
          const ax = r[i][0], az = r[i][1], bx = r[i + 1][0], bz = r[i + 1][1];
          const L = Math.hypot(bx - ax, bz - az), steps = Math.ceil(L / 2);
          for (let s = 0; s < steps; s++) { const t = s / steps; samp.push([ax + (bx - ax) * t, az + (bz - az) * t]); }
        }
        samp.push(r[r.length - 1]);
        const raw = samp.map(([x, z]) => at(x, z));
        const sm = raw.map((_, i) => { let s = 0, n = 0; for (let k = -15; k <= 15; k++) { const j = i + k; if (j >= 0 && j < raw.length) { s += raw[j]; n++; } } return s / n; });
        const R = Math.ceil(18 / cell);
        const done = new Float32Array(V * V);
        samp.forEach(([cx, cz], si) => {
          const ci = Math.round((cx + half) / cell), cj = Math.round((cz + half) / cell);
          for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
            const ii = ci + di, jj = cj + dj; if (ii < 0 || jj < 0 || ii >= V || jj >= V) continue;
            const d = Math.hypot(ii * cell - half - cx, jj * cell - half - cz);
            const k = 1 - S(3.5, 18, d);
            const idx = jj * V + ii;
            if (k > done[idx]) { done[idx] = k; H[idx] = lerp(H[idx], sm[si], k * k * (3 - 2 * k)); }
          }
        });
      }
    }
    function far(x, z) {
      const r = Math.max(Math.abs(x), Math.abs(z)) / HALF;
      return base(x, z) + S(1, 2.5, r) * 260 * (0.6 + 0.4 * N().fbm(n1, x / 900, z / 900, 3));
    }
    const fk = cfg.forest != null ? cfg.forest : 0.1;
    function forestMask(x, z) { return S(0.05, 0.35, N().fbm(n2, x / 260 + 7, z / 260, 4) + fk); }
    const paved = cfg.paved || [];
    function splat(x, z, h, slope) {
      let rd = 99; for (const r of roads) rd = Math.min(rd, roadDist(x, z, r)[0]);
      const f = forestMask(x, z);
      let meadow = S(0.25, 0.05, slope) * (1 - f) * (0.7 + 0.3 * N().fbm(n3, x / 60, z / 60, 3)) * (cfg.meadowK || 1);
      let leaves = f * S(0.4, 0.8, N().fbm(n1, x / 40, z / 40, 3) + 0.5) * 0.9;
      let ground = 0.35 + f * 0.4;
      let rock = S(cfg.rockLine || 140, (cfg.rockLine || 140) + 60, h) * 0.6 + S(0.35, 0.7, slope) * 0.8;
      if (LAKE) { const shore = 1 - S(WATER + 0.5, WATER + 3.5, h); ground += shore * 1.5; meadow *= 1 - shore; leaves *= 1 - shore; }
      const road = 1 - S(2.2, 5.5, rd + N().fbm(n3, x / 6, z / 6, 2) * 1.5);
      ground = lerp(ground, 2.5, road); meadow *= 1 - road; leaves *= 1 - road;
      for (const s of stamps) {
        if (s.noDirt) continue;
        const d = stampDist(x, z, s); const sz = s.box ? Math.min(s.w, s.d) * 0.3 : s.r * 0.5;
        const k = 1 - S(sz * 0.2, sz + 12, d); ground += k * 2; meadow *= 1 - k * 0.8; leaves *= 1 - k;
      }
      const sum = ground + meadow + rock + leaves;
      return [ground / sum, meadow / sum, rock / sum, leaves / sum];
    }
    function wet(x, z, h) { return LAKE ? 1 - S(WATER - 0.5, WATER + 1.5, h) : 0; }
    // 不许种树的地方（营地、路、房子）
    function isOK(x, z, r) {
      for (const s of stamps) if (stampDist(x, z, s) < r + (s.clear != null ? s.clear : 4)) return false;
      for (const rd of roads) if (roadDist(x, z, rd)[0] < 6 + r * 0.5) return false;
      return true;
    }
    function scatter(terrain, rnd, dens) {
      dens = dens || 1;
      const trees = [], rocks = [], props = [];
      const step = 9 / Math.sqrt(dens);
      for (let x = -HALF + 20; x < HALF - 20; x += step) for (let z = -HALF + 20; z < HALF - 20; z += step) {
        const px = x + (rnd() - 0.5) * step * 0.9, pz = z + (rnd() - 0.5) * step * 0.9;
        const f = forestMask(px, pz);
        if (rnd() > f * 0.95) continue;
        const h = terrain.heightAt(px, pz);
        if (h < WATER + 1.5 || h > (cfg.treeLine || 230)) continue;
        const sp = terrain.splatAt(px, pz);
        if (sp[0] > 0.7 && f < 0.6) continue;
        const nrm = terrain.normalAt(px, pz, new THREE.Vector3());
        if (nrm.y < 0.8) continue;
        if (!isOK(px, pz, 6)) continue;
        trees.push({ x: px, z: pz, s: 0.75 + rnd() * 0.55, kind: rnd() < 0.2 ? 3 : Math.floor(rnd() * 3) });
      }
      for (let i = 0; i < 1600 * dens; i++) {
        const px = (rnd() - 0.5) * (SIZE - 60), pz = (rnd() - 0.5) * (SIZE - 60);
        const nrm = terrain.normalAt(px, pz, new THREE.Vector3());
        const steep = 1 - nrm.y;
        if (rnd() > 0.25 + steep * 2.5) continue;
        if (!isOK(px, pz, 3)) continue;
        const big = rnd() < 0.18 + steep;
        rocks.push({ x: px, z: pz, v: big ? Math.floor(rnd() * 4) : 4 + Math.floor(rnd() * 4), s: big ? 1 + rnd() * 3.5 + steep * 4 : 0.6 + rnd() * 1.4, sink: 0.25, tilt: 0.3 });
      }
      if (LAKE) for (let i = 0; i < 70; i++) {
        const a = rnd() * 6.283, rr = LAKE.r * (1.05 + rnd() * 0.25);
        const px = LAKE.x + Math.cos(a) * rr, pz = LAKE.z + Math.sin(a) * rr / 1.35;
        if (!isOK(px, pz, 2)) continue;
        rocks.push({ x: px, z: pz, v: 4 + Math.floor(rnd() * 4), s: 0.8 + rnd() * 1.6, sink: 0.3, tilt: 0.3 });
      }
      for (let i = 0; i < 260 * dens; i++) {
        const px = (rnd() - 0.5) * (SIZE - 80), pz = (rnd() - 0.5) * (SIZE - 80);
        if (forestMask(px, pz) < 0.4 || !isOK(px, pz, 3)) continue;
        const h = terrain.heightAt(px, pz); if (h < WATER + 1) continue;
        if (rnd() < 0.35) props.push({ key: 'glb/stump/a_lod0', tex: 'stump', x: px, z: pz, s: 0.9 + rnd() * 0.5, r: rnd() * 6.28, y: -0.05, col: [0.35, 0.6] });
        else props.push({ key: rnd() < 0.5 ? 'glb/branches/a_lod0' : 'glb/branches/b_lod0', tex: 'branches', x: px, z: pz, s: 1 + rnd() * 0.6, r: rnd() * 6.28 });
      }
      return { trees, rocks, props };
    }
    const carpet = [
      { variants: ['glb/grass/tall_a_lod0', 'glb/grass/tall_b_lod0', 'glb/grass/tall_c_lod0', 'glb/grass/small_b_lod0'], tex: 'grass', max: 22000, radius: 40, cell: 4, perCell: 30, scale: [2.4, 3.8], wind: 0.35, color: cfg.grassColor || 0xd8e0c8,
        weight: (x, z, T) => { const s = T.splatAt(x, z); return s[1] * 1.6 + s[0] * 0.25; } },
      { variants: ['glb/fern/a_lod0', 'glb/fern/b_lod0', 'glb/fern/c_lod0', 'glb/fern/d_lod0'], tex: 'fern', max: 1400, radius: 40, cell: 5, perCell: 3, scale: [0.9, 1.6], wind: 0.08,
        weight: (x, z, T) => { const s = T.splatAt(x, z); return (s[3] * 1.4 + s[0] * 0.25) * forestMask(x, z); } },
    ];
    return {
      id: cfg.id, name: cfg.name, size: SIZE, half: HALF, water: WATER, lake: LAKE, packs: cfg.packs || ['core'],
      layers: cfg.layers || [
        { name: 'forrest_ground_01', scale: 3.2, rough: 0.95, ns: 1.1 },
        { name: 'aerial_grass_rock', scale: 9, rough: 0.9, ns: 0.8, tint: 0xe6efd8 },
        { name: 'mossy_rock', scale: 7, rough: 0.85, ns: 1.2, tint: 0x948e80 },
        { name: 'forest_leaves_02', scale: 3.5, rough: 0.9, ns: 1.0 },
      ],
      stamps, roads, height, post, far, splat, wet, scatter, carpet, forestMask, isOK, layout: cfg.layout, bounds: HALF - 30,
    };
  }

  // 一圈营地的小工具（营地 = 帐篷 + 沙袋 + 箱子 + 瞭望塔）
  function campKit(B, c, opts) {
    opts = opts || {};
    const guards = [];
    const R = c.r || 30;
    const rnd = TSNoise.mulberry(Math.round(c.x * 7 + c.z * 13));
    const P = (a, r) => [c.x + Math.cos(a) * r, c.z + Math.sin(a) * r];
    // 外圈沙袋
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + rnd() * 0.3;
      const [x, z] = P(a, R * 0.92);
      B.sandbags(x, z, 5 + rnd() * 3, -a + Math.PI / 2, 3, 0.4);
      const [gx, gz] = P(a, R * 0.92 - 1.5);
      guards.push([gx, null, gz]);
    }
    // 帐篷
    const nt = opts.tents != null ? opts.tents : 3;
    for (let i = 0; i < nt; i++) { const a = i / nt * Math.PI * 2 + 0.6; const [x, z] = P(a, R * 0.45); B.tent(x, z, -a, 4.5, 6); }
    // 瞭望塔
    const nw = opts.towers != null ? opts.towers : 1;
    for (let i = 0; i < nw; i++) {
      const a = i / Math.max(1, nw) * Math.PI * 2 + 2.2;
      const [x, z] = P(a, R * 0.7);
      const t = B.tower(x, z, -a, 6);
      guards.push([t.x, t.y, t.z, 'tower']);
    }
    // 箱子、油桶
    for (let i = 0; i < 4; i++) { const a = rnd() * 6.28; const [x, z] = P(a, R * (0.25 + rnd() * 0.4)); B.crateStack(x, z, rnd() * 3); guards.push([x + 2, null, z + 2]); }
    const drums = [];
    for (let i = 0; i < (opts.drums || 3); i++) { const a = rnd() * 6.28; const [x, z] = P(a, R * (0.3 + rnd() * 0.5)); drums.push(B.drum(x, z, i % 2 === 0)); }
    if (opts.net) { const [x, z] = P(rnd() * 6.28, R * 0.3); B.camoNet(x, z, 9, 7, rnd() * 3, 3.2); }
    if (opts.containers) for (let i = 0; i < opts.containers; i++) { const a = rnd() * 6.28; const [x, z] = P(a, R * 0.55); B.container(x, z, -a + Math.PI / 2); const [gx, gz] = P(a, R * 0.55 - 3); guards.push([gx, null, gz]); }
    for (let i = 0; i < 6; i++) { const a = rnd() * 6.28; const [x, z] = P(a, R * (0.2 + rnd() * 0.5)); guards.push([x, null, z]); }
    return { x: c.x, z: c.z, r: R, guards: guards.map(g => g.slice(0, 4)) };
  }

  // 我方基地：停机坪、集装箱、帐篷、伪装网
  function homeBase(B, x, z, yaw) {
    const L = (a, b) => B.loc(x, z, yaw, a, b);
    const pad = L(0, 22);
    const py = B.helipad(pad[0], pad[1], 9);
    for (const [a, b, r] of [[-14, -6, 0], [14, -6, 0], [-14, 4, 0], [14, 4, 0]]) { const [px, pz] = L(a, b); B.tent(px, pz, yaw + r, 4.5, 6); }
    for (const [a, b] of [[-22, -16], [22, -16]]) { const [px, pz] = L(a, b); B.container(px, pz, yaw + Math.PI / 2); }
    { const [px, pz] = L(0, -14); B.camoNet(px, pz, 12, 9, yaw, 3.4); }
    for (const [a, b] of [[-6, -14], [6, -16]]) { const [px, pz] = L(a, b); B.crateStack(px, pz, yaw); }
    for (const a of [-1, 1]) { const [px, pz] = L(a * 24, 8); B.sandbags(px, pz, 6, yaw + Math.PI / 2, 3); }
    { const [px, pz] = L(-24, 20); B.tower(px, pz, yaw, 6); }
    B.prop('glb/covered_car', ...L(10, -2), yaw + 0.2, 1, [1.2, 1.5]);
    B.prop('glb/metal_jerrycan', ...L(-4, -10), 0.4, 1);
    B.prop('glb/wooden_picnic_table', ...L(-8, 6), yaw + 1.2, 1, [1, 0.8]);
    return { pad: { x: pad[0], z: pad[1], y: py }, spawn: { x, z, yaw } };
  }

  // ======================= 地图 1：松林山谷 =======================
  function valley() {
    const camps = {
      home: { x: 0, z: 520, r: 45 }, outpost: { x: 230, z: 210, r: 34 }, logging: { x: -330, z: -120, r: 40 },
      radar: { x: 160, z: -260, r: 42 }, pass: { x: -60, z: -470, r: 36 }, east: { x: 420, z: -40, r: 32 },
    };
    return makeMap({
      id: 'valley', name: '松林山谷', seed: 11, water: 4, lake: { x: -180, z: 140, r: 120 },
      stamps: [
        { x: 0, z: 520, r: 45, h: 18, fall: 40 }, { x: 230, z: 210, r: 38, h: 22, fall: 35 }, { x: -330, z: -120, r: 40, h: 34, fall: 35 },
        { x: 160, z: -260, r: 42, h: 46, fall: 40 }, { x: -60, z: -470, r: 36, h: 70, fall: 45 }, { x: 420, z: -40, r: 32, h: 30, fall: 30 },
      ],
      roads: [
        [[0, 560], [10, 470], [60, 380], [140, 300], [230, 210], [260, 120], [240, 0], [190, -150], [160, -260], [80, -360], [-60, -470]],
        [[60, 380], [-60, 330], [-200, 300], [-300, 200], [-340, 40], [-330, -120]],
        [[240, 0], [340, -20], [420, -40]],
      ],
      base(x, z, c) {
        const r = Math.max(Math.abs(x), Math.abs(z)) / c.HALF;
        let h = N().fbm(c.n1, x / 520, z / 520, 5) * 38 + N().fbm(c.n2, x / 160, z / 160, 4) * 7;
        h += N().ridged(c.n3, x / 700 + 3, z / 700, 5) * 160 * S(0.55, 1.05, r);
        h += S(0.75, 1.3, r) * 90;
        h += 20 - 12 * S(0.6, 0, Math.hypot(x + 50, z - 100) / c.HALF);
        return h;
      },
      layout(B) {
        const home = homeBase(B, 0, 515, 0);
        const A = {};
        A.outpost = campKit(B, camps.outpost, { towers: 2, net: true });
        { const b = B.bunker(240, 196, 0.3); A.outpost.guards.push([b.x, b.y, b.z, 'roof']); }
        A.logging = campKit(B, camps.logging, { tents: 2, towers: 1 });
        // 木头堆
        for (let i = 0; i < 4; i++) for (let k = 0; k < 5; k++) B.add('bark', B.placed(B.cyl(0.35, 0.35, 7, 10, 2).rotateZ(Math.PI / 2), -345 + i * 9, B.H(-345 + i * 9, -100) + 0.35 + Math.floor(k / 3) * 0.6, -100 + (k % 3) * 0.72, 0.2));
        B.shed(-310, -140, 7, 5, 0.4); B.shed(-350, -135, 6, 5, -0.2);
        A.radar = campKit(B, camps.radar, { tents: 2, towers: 2, containers: 2 });
        B.fence([[120, -300], [200, -300], [200, -220], [120, -220], [120, -290]]);
        A.pass = campKit(B, camps.pass, { tents: 1, towers: 1 });
        { const b = B.bunker(-60, -455, Math.PI); A.pass.guards.push([b.x, b.y, b.z, 'roof']); B.jerseyLine(-60, -440, 5, 0); }
        A.east = campKit(B, camps.east, { tents: 2, towers: 1, net: true });
        B.powerLine([[30, 470], [70, 380], [150, 300], [230, 230]]);
        return {
          home, areas: A,
          cages: { east: [[425, -30], [410, -50]], logging: [[-320, -110]] },
          targets: { radar: [[150, -270, 'dish'], [175, -250, 'dish'], [160, -240, 'ammo']] },
          intel: { logging: [[-312, -138], [-348, -133], [-330, -95]] },
          extract: { pass: { x: -60, z: -500 }, radar: { x: 160, z: -320 }, home: home.pad },
          chests: [[60, 380], [-200, 300], [-345, 40], [255, 120], [240, 0], [190, -150], [80, -360], [340, -20], [-140, -60], [380, 300], [-420, 360], [90, 120], [-250, -330], [300, -400]],
        };
      },
    });
  }

  // ======================= 地图 2：山间小镇 =======================
  function town() {
    const T = { x: 0, z: -40 };
    return makeMap({
      id: 'town', name: '山间小镇', seed: 61, packs: ['core', 'town'], forest: 0.0, meadowK: 1.2,
      stamps: [
        { x: T.x, z: T.z, box: true, w: 140, d: 110, h: 26, fall: 70, clear: 10, noDirt: true },
        { x: 0, z: 540, r: 45, h: 20, fall: 40 },            // 我方营地
        { x: -400, z: 220, r: 40, h: 30, fall: 35 },         // 西边农场
        { x: 400, z: -260, r: 40, h: 40, fall: 40 },         // 东边采石场
        { x: 0, z: -420, r: 42, h: 46, fall: 40 },           // 北边检查站
      ],
      roads: [
        [[0, 580], [-20, 470], [-10, 360], [20, 250], [0, 140], [0, 70]],
        [[-140, -40], [-260, 60], [-340, 160], [-400, 220]],
        [[140, -40], [250, -120], [340, -200], [400, -260]],
        [[0, -150], [10, -260], [0, -420]],
      ],
      paved: true,
      base(x, z, c) {
        const r = Math.max(Math.abs(x), Math.abs(z)) / c.HALF;
        let h = N().fbm(c.n1, x / 450, z / 450, 5) * 30 + N().fbm(c.n2, x / 140, z / 140, 4) * 6;
        h += N().ridged(c.n3, x / 600 + 3, z / 600, 5) * 170 * S(0.5, 1.05, r);
        h += S(0.75, 1.3, r) * 100;
        return h + 26;
      },
      layout(B) {
        const home = homeBase(B, 0, 535, 0);
        const A = {};
        const rnd = TSNoise.mulberry(99);
        const walls = ['plaster', 'plasterOchre', 'plasterBlue', 'plaster'];
        // 街道：主街东西向，三条南北向
        const streets = [
          [[T.x - 150, T.z], [T.x + 150, T.z]],
          [[T.x - 80, T.z - 115], [T.x - 80, T.z + 115]],
          [[T.x, T.z - 115], [T.x, T.z + 115]],
          [[T.x + 80, T.z - 115], [T.x + 80, T.z + 115]],
        ];
        for (const s of streets) B.road(s, 7, 'cobble');
        // 广场
        B.road([[T.x - 22, T.z], [T.x + 22, T.z]], 40, 'cobble');
        const houses = [];
        const nearStreet = (x, z, skip) => {
          if (Math.abs(x - T.x) < 26 && Math.abs(z - T.z) < 26) return true;
          for (const xx of [-80, 0, 80]) if (Math.abs(x - (T.x + xx)) < 10 && skip !== 'v') return true;
          if (Math.abs(z - T.z) < 10 && skip !== 'h') return true;
          return false;
        };
        // 主街两边
        for (let x = T.x - 140; x <= T.x + 140; x += 14) for (const sd of [-1, 1]) {
          const w = 9 + rnd() * 3, d = 8 + rnd() * 2;
          const hx = x + (rnd() - 0.5) * 2, hz = T.z + sd * (6 + d / 2 + 1);
          if (nearStreet(hx, hz, 'h')) continue;
          houses.push(B.house(hx, hz, w, d, 1 + Math.floor(rnd() * 3), sd > 0 ? 0 : Math.PI, { wall: walls[Math.floor(rnd() * 4)] }));
        }
        // 南北街两边
        for (const sx of [-80, 0, 80]) for (let z = T.z - 105; z <= T.z + 105; z += 14) for (const sd of [-1, 1]) {
          if (Math.abs(z - T.z) < 22) continue;
          const w = 8 + rnd() * 2, d = 9 + rnd() * 3;
          const hx = T.x + sx + sd * (6 + w / 2 + 1), hz = z + (rnd() - 0.5) * 2;
          if (Math.abs(hx - T.x) < 26 && Math.abs(hz - T.z) < 26) continue;
          houses.push(B.house(hx, hz, w, d, 1 + Math.floor(rnd() * 3), sd > 0 ? Math.PI / 2 : -Math.PI / 2, { wall: walls[Math.floor(rnd() * 4)] }));
        }
        // 广场中间的钟楼
        B.house(T.x, T.z - 36, 9, 9, 5, 0, { wall: 'stone', shutters: false });
        for (let i = 0; i < 10; i++) B.lamp(T.x - 120 + i * 27, T.z + 5.5);
        // 小镇里的敌人位置：街上、广场、路障
        const tg = [];
        for (let i = 0; i < 26; i++) { const st = streets[i % 4]; const t = rnd(); tg.push([st[0][0] + (st[1][0] - st[0][0]) * t + (rnd() - 0.5) * 4, null, st[0][1] + (st[1][1] - st[0][1]) * t + (rnd() - 0.5) * 4]); }
        for (const [x, z, yaw] of [[T.x - 150, T.z, Math.PI / 2], [T.x + 150, T.z, Math.PI / 2], [T.x, T.z + 118, 0], [T.x, T.z - 118, 0]]) { B.jerseyLine(x, z, 3, yaw); B.sandbags(x + 4, z + 4, 4, yaw, 3); tg.push([x + 3, null, z + 3]); }
        for (let i = 0; i < 8; i++) { const [x, z] = [T.x + (rnd() - 0.5) * 36, T.z + (rnd() - 0.5) * 36]; if (i < 4) B.crateStack(x, z, rnd() * 3); tg.push([x + 2, null, z + 1]); }
        // 车和杂物
        for (let i = 0; i < 6; i++) { const x = T.x - 120 + rnd() * 240; B.prop('glb/covered_car', x, T.z + 3.5 * (i % 2 ? 1 : -1), Math.PI / 2 + (rnd() - 0.5) * 0.2, 1, [1.2, 1.5]); }
        for (let i = 0; i < 10; i++) { const x = T.x - 130 + rnd() * 260; B.prop(i % 2 ? 'glb/metal_trash_can' : 'glb/trashbag', x, T.z + 5.2 * (i % 3 ? 1 : -1), rnd() * 6, 1); }
        for (let i = 0; i < 8; i++) B.drum(T.x - 100 + rnd() * 200, T.z + (rnd() < 0.5 ? 4 : -4), i % 2 === 0);
        A.town = { x: T.x, z: T.z, r: 140, guards: tg };
        A.farm = campKit(B, { x: -400, z: 220, r: 36 }, { tents: 1, towers: 1 });
        B.shed(-385, 235, 8, 6, 0.3); B.house(-420, 200, 10, 8, 2, 0.5, { wall: 'plasterOchre' });
        A.quarry = campKit(B, { x: 400, z: -260, r: 38 }, { tents: 2, towers: 2, containers: 3 });
        A.check = campKit(B, { x: 0, z: -420, r: 40 }, { tents: 2, towers: 2, net: true });
        { const b = B.bunker(0, -395, 0); A.check.guards.push([b.x, b.y, b.z, 'roof']); B.jerseyLine(0, -380, 4, 0); }
        const H = houses.filter(Boolean);
        const pick = (i) => { const h = H[(i * 7) % H.length]; return [h.x + 0, h.z]; };
        return {
          home, areas: A,
          cages: { town: [[T.x - 60, T.z + 30], [T.x + 60, T.z - 30], [T.x + 10, T.z + 70]], farm: [[-395, 210]] },
          targets: { quarry: [[385, -270, 'ammo'], [410, -250, 'ammo'], [395, -240, 'ammo'], [420, -275, 'ammo']], town: [[T.x - 10, T.z + 10, 'ammo'], [T.x + 12, T.z - 12, 'ammo']] },
          intel: { town: [[T.x - 70, T.z - 8], [T.x + 90, T.z + 8], [T.x - 5, T.z - 30], [T.x + 72, T.z + 60]] },
          extract: { check: { x: 0, z: -460 }, town: { x: T.x, z: T.z }, home: home.pad, farm: { x: -400, z: 270 } },
          chests: [[-20, 470], [20, 250], [-260, 60], [250, -120], [10, -260], [-500, -300], [500, 300], [-100, 200], [150, 160], [-300, -250], [300, 50]].concat([0, 1, 2].map(pick)),
        };
      },
    });
  }

  // ======================= 地图 3：鹰巢要塞 =======================
  function fort() {
    const F = { x: 0, z: -140 };
    return makeMap({
      id: 'fort', name: '鹰巢要塞', seed: 131, packs: ['core', 'fort', 'town'], forest: 0.12, rockLine: 110, treeLine: 150,
      stamps: [
        { x: F.x, z: F.z, box: true, w: 80, d: 80, h: 132, fall: 26, clear: 12, noDirt: false },
        { x: 0, z: 560, r: 45, h: 16, fall: 40 },
        { x: 0, z: 40, r: 26, h: 104, fall: 30 },            // 半山腰的哨卡
        { x: -360, z: 160, r: 40, h: 26, fall: 35 },
        { x: 380, z: -320, r: 40, h: 60, fall: 40 },
      ],
      roads: [
        [[0, 600], [20, 480], [-40, 380], [60, 300], [-60, 220], [50, 140], [0, 40], [-40, -20], [0, -50], [0, -70]],
        [[20, 480], [-150, 360], [-300, 220], [-360, 160]],
        [[60, 300], [260, 160], [380, -100], [380, -320]],
      ],
      base(x, z, c) {
        const r = Math.max(Math.abs(x), Math.abs(z)) / c.HALF;
        let h = N().fbm(c.n1, x / 480, z / 480, 5) * 32 + N().fbm(c.n2, x / 150, z / 150, 4) * 7;
        const dm = Math.hypot(x - F.x, (z - F.z) * 0.9);
        h += 125 * Math.exp(-Math.pow(dm / 260, 2)) + N().ridged(c.n3, x / 200, z / 200, 4) * 30 * S(320, 60, dm);
        h += N().ridged(c.n3, x / 700 + 3, z / 700, 5) * 170 * S(0.55, 1.05, r);
        h += S(0.75, 1.3, r) * 100;
        return h;
      },
      layout(B) {
        const home = homeBase(B, 0, 555, 0);
        const A = {};
        const rnd = TSNoise.mulberry(7);
        const fy = 132, W = 72;
        // 城墙（南边留城门）
        const wl = (pts) => B.wallLine(pts, 7, 2.4, 'fortWall', true);
        wl([[F.x - 7, F.z + W], [F.x - W, F.z + W], [F.x - W, F.z - W], [F.x + W, F.z - W], [F.x + W, F.z + W], [F.x + 7, F.z + W]]);
        // 城墙上的走道（敌人可以站上去）
        const wallTop = [];
        for (let t = -W + 6; t <= W - 6; t += 12) { wallTop.push([F.x + t, fy + 7.4, F.z - W + 0.1]); wallTop.push([F.x - W + 0.1, fy + 7.4, F.z + t]); wallTop.push([F.x + W - 0.1, fy + 7.4, F.z + t]); }
        // 四个角楼
        const corners = [];
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const x = F.x + sx * W, z = F.z + sz * W;
          const y = B.minH(x, z, 9, 9, 0) - 1;
          const hh = fy - y + 12;
          for (let c = -4; c <= 4; c += 2) { B.add('blocks', B.placed(B.box(1, 1, 1, 2), x + c, fy + 13, z - 4.6, 0)); B.add('blocks', B.placed(B.box(1, 1, 1, 2), x + c, fy + 13, z + 4.6, 0)); B.add('blocks', B.placed(B.box(1, 1, 1, 2), x - 4.6, fy + 13, z + c, 0)); B.add('blocks', B.placed(B.box(1, 1, 1, 2), x + 4.6, fy + 13, z + c, 0)); }
          B.solid('blocks', x, y, z, 9, hh, 9, 0, 3, 'tower');
          corners.push([x, fy + 12.6, z, 'tower']);
        }
        // 城门两边的门楼
        for (const s of [-1, 1]) B.solid('blocks', F.x + s * 11, fy - 2, F.z + W, 8, 14, 8, 0, 3, 'tower');
        B.add('blocks', B.placed(B.box(30, 3, 8, 3), F.x, fy + 10.5, F.z + W, 0));
        B.road([[F.x, F.z + W + 30], [F.x, F.z + W - 10]], 8, 'tiles');
        // 里面：主楼、营房、碉堡、集装箱、停机坪
        B.road([[F.x - 50, F.z], [F.x + 50, F.z]], 70, 'tiles');
        B.house(F.x, F.z - 40, 22, 14, 3, 0, { wall: 'blocks', shutters: false });
        B.house(F.x - 42, F.z - 30, 12, 20, 2, 0, { wall: 'blocks', shutters: false });
        B.house(F.x + 42, F.z - 30, 12, 20, 2, 0, { wall: 'blocks', shutters: false });
        const bk = [B.bunker(F.x - 30, F.z + 45, 0), B.bunker(F.x + 30, F.z + 45, 0)];
        for (let i = 0; i < 4; i++) B.container(F.x + 45, F.z + 10 + i * 3.2, Math.PI / 2 + (rnd() - 0.5) * 0.1);
        B.container(F.x + 45, F.z + 14, Math.PI / 2, null, 1);
        for (let i = 0; i < 6; i++) B.crateStack(F.x - 50 + rnd() * 30, F.z + 10 + rnd() * 30, rnd() * 3);
        const padY = B.helipad(F.x - 40, F.z + 20, 8);
        for (let i = 0; i < 6; i++) B.drum(F.x - 20 + rnd() * 40, F.z + 20 + rnd() * 30, i % 2 === 0);
        for (const [x, z] of [[F.x - 60, F.z + 60], [F.x + 60, F.z + 60], [F.x - 60, F.z - 60], [F.x + 60, F.z - 60]]) B.lamp(x, z, true);
        const fg = [];
        for (let i = 0; i < 24; i++) fg.push([F.x + (rnd() - 0.5) * 120, null, F.z + (rnd() - 0.5) * 120]);
        A.fort = { x: F.x, z: F.z, r: 75, guards: fg.concat(corners, wallTop.filter((_, i) => i % 2 === 0), bk.map(b => [b.x, b.y, b.z, 'roof'])) };
        A.gate = { x: F.x, z: F.z + W + 20, r: 25, guards: [[F.x - 8, null, F.z + W + 12], [F.x + 8, null, F.z + W + 12], [F.x, null, F.z + W + 25], [F.x - 15, null, F.z + W + 20], [F.x + 15, null, F.z + W + 20]] };
        B.jerseyLine(F.x, F.z + W + 18, 3, 0); B.sandbags(F.x - 12, F.z + W + 16, 5, 0, 3); B.sandbags(F.x + 12, F.z + W + 16, 5, 0, 3);
        A.mid = campKit(B, { x: 0, z: 40, r: 24 }, { tents: 1, towers: 1 });
        A.lower = campKit(B, { x: -360, z: 160, r: 36 }, { tents: 3, towers: 1, net: true });
        A.radar = campKit(B, { x: 380, z: -320, r: 38 }, { tents: 2, towers: 2, containers: 2 });
        return {
          home, areas: A,
          cages: { fort: [[F.x - 42, F.z - 15], [F.x + 42, F.z - 15], [F.x, F.z - 26]], lower: [[-350, 170], [-370, 150]] },
          targets: {
            fort: [[F.x - 55, F.z - 55, 'aa'], [F.x + 55, F.z - 55, 'aa'], [F.x - 55, F.z + 40, 'aa'], [F.x + 55, F.z + 40, 'aa']],
            radar: [[370, -330, 'dish'], [395, -310, 'dish']],
          },
          intel: { fort: [[F.x, F.z - 30], [F.x - 42, F.z - 38], [F.x + 42, F.z - 22]] },
          extract: { fort: { x: F.x - 40, z: F.z + 20, y: padY }, home: home.pad, mid: { x: 0, z: 70 } },
          chests: [[20, 480], [-40, 380], [60, 300], [-60, 220], [50, 140], [-150, 360], [-300, 220], [260, 160], [380, -100], [-200, -200], [250, 450], [-450, -400], [F.x - 60, F.z - 10], [F.x + 60, F.z]],
        };
      },
    });
  }

  window.TSMaps = { valley, town, fort, get(id) { return { valley, town, fort }[id](); }, roadDist, applyStamps, S, lerp };
})();
