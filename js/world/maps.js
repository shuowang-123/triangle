// 三张大地图：地形形状、地面材质分布、树、石头、建筑和任务地点
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
  // 路：一串点连成的折线，路面附近压平一点
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

  // ======================= 地图 1：松林山谷 =======================
  function valley() {
    const n1 = N().makeSimplex(11), n2 = N().makeSimplex(23), n3 = N().makeSimplex(37);
    const SIZE = 1600, HALF = 800;
    const WATER = 4;
    const LAKE = { x: -180, z: 140, r: 120 };
    // 营地和哨所的平地
    const stamps = [
      { x: 0, z: 520, r: 45, h: 18, fall: 40 },          // 我方营地（南边）
      { x: 230, z: 210, r: 38, h: 22, fall: 35 },        // 湖东哨所
      { x: -330, z: -120, r: 40, h: 34, fall: 35 },      // 西边林场
      { x: 160, z: -260, r: 42, h: 46, fall: 40 },       // 北边雷达站
      { x: -60, z: -470, r: 36, h: 70, fall: 45 },       // 山口
      { x: 420, z: -40, r: 32, h: 30, fall: 30 },        // 东边伐木营
    ];
    const roads = [
      [[0, 560], [10, 470], [60, 380], [140, 300], [230, 210], [260, 120], [240, 0], [190, -150], [160, -260], [80, -360], [-60, -470]],
      [[60, 380], [-60, 330], [-200, 300], [-300, 200], [-340, 40], [-330, -120]],
      [[240, 0], [340, -20], [420, -40]],
    ];
    function base(x, z) {
      const r = Math.max(Math.abs(x), Math.abs(z)) / HALF;
      let h = N().fbm(n1, x / 520, z / 520, 5) * 38 + N().fbm(n2, x / 160, z / 160, 4) * 7;
      h += N().ridged(n3, x / 700 + 3, z / 700, 5) * 160 * S(0.55, 1.05, r);
      h += S(0.75, 1.3, r) * 90;
      h += 20 - 12 * S(0.6, 0, Math.hypot(x + 50, z - 100) / HALF);
      return h;
    }
    function height(x, z) {
      let h = base(x, z);
      // 湖：中间往下挖
      const ld = Math.hypot((x - LAKE.x) * 1.0, (z - LAKE.z) * 1.35) / LAKE.r + N().fbm(n2, x / 90, z / 90, 3) * 0.25;
      h = lerp(h, WATER - 7 - (1 - Math.min(1, ld)) * 6, 1 - S(0.75, 1.35, ld));
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
    function forestMask(x, z) {
      return S(0.05, 0.35, N().fbm(n2, x / 260 + 7, z / 260, 4) + 0.1);
    }
    function splat(x, z, h, slope) {
      let rd = 99; for (const r of roads) rd = Math.min(rd, roadDist(x, z, r)[0]);
      const f = forestMask(x, z);
      let meadow = S(0.25, 0.05, slope) * (1 - f) * (0.7 + 0.3 * N().fbm(n3, x / 60, z / 60, 3));
      let leaves = f * S(0.4, 0.8, N().fbm(n1, x / 40, z / 40, 3) + 0.5) * 0.9;
      let ground = 0.35 + f * 0.4;
      let rock = S(140, 200, h) * 0.6;
      // 湖边：泥土和石头
      const shore = 1 - S(WATER + 0.5, WATER + 3.5, h);
      ground += shore * 1.5; meadow *= 1 - shore; leaves *= 1 - shore;
      // 土路
      const road = 1 - S(2.2, 5.5, rd + N().fbm(n3, x / 6, z / 6, 2) * 1.5);
      ground = lerp(ground, 2.5, road); meadow *= 1 - road; leaves *= 1 - road;
      // 营地里是踩实的泥地
      for (const s of stamps) { const d = Math.hypot(x - s.x, z - s.z); const k = 1 - S(s.r * 0.6, s.r * 1.1, d); ground += k * 2; meadow *= 1 - k * 0.8; leaves *= 1 - k; }
      const sum = ground + meadow + rock + leaves;
      return [ground / sum, meadow / sum, rock / sum, leaves / sum];
    }
    function wet(x, z, h) { return 1 - S(WATER - 0.5, WATER + 1.5, h); }

    // 树、石头、草的位置
    function scatter(terrain, rnd, isOK) {
      const trees = [], rocks = [], props = [];
      for (let x = -HALF + 20; x < HALF - 20; x += 9) for (let z = -HALF + 20; z < HALF - 20; z += 9) {
        const px = x + (rnd() - 0.5) * 8, pz = z + (rnd() - 0.5) * 8;
        const f = forestMask(px, pz);
        if (rnd() > f * 0.95) continue;
        const h = terrain.heightAt(px, pz);
        if (h < WATER + 1.5 || h > 230) continue;
        const sp = terrain.splatAt(px, pz);
        if (sp[0] > 0.7 && f < 0.6) continue;
        const nrm = terrain.normalAt(px, pz, new THREE.Vector3());
        if (nrm.y < 0.8) continue;
        if (!isOK(px, pz, 6)) continue;
        trees.push({ x: px, z: pz, s: 0.75 + rnd() * 0.55, kind: rnd() < 0.2 ? 3 : Math.floor(rnd() * 3) });
      }
      // 散落的石头
      for (let i = 0; i < 1600; i++) {
        const px = (rnd() - 0.5) * (SIZE - 60), pz = (rnd() - 0.5) * (SIZE - 60);
        const h = terrain.heightAt(px, pz);
        const nrm = terrain.normalAt(px, pz, new THREE.Vector3());
        const steep = 1 - nrm.y;
        if (rnd() > 0.25 + steep * 2.5) continue;
        if (!isOK(px, pz, 3)) continue;
        const big = rnd() < 0.18 + steep;
        rocks.push({ x: px, z: pz, v: big ? Math.floor(rnd() * 4) : 4 + Math.floor(rnd() * 4), s: big ? 1 + rnd() * 3.5 + steep * 4 : 0.6 + rnd() * 1.4, sink: 0.25, tilt: 0.3 });
        void h;
      }
      // 湖边一圈石头
      for (let i = 0; i < 70; i++) {
        const a = rnd() * 6.283, rr = LAKE.r * (1.05 + rnd() * 0.25);
        const px = LAKE.x + Math.cos(a) * rr, pz = LAKE.z + Math.sin(a) * rr / 1.35;
        if (!isOK(px, pz, 2)) continue;
        rocks.push({ x: px, z: pz, v: 4 + Math.floor(rnd() * 4), s: 0.8 + rnd() * 1.6, sink: 0.3, tilt: 0.3 });
      }
      // 树桩、枯枝
      for (let i = 0; i < 260; i++) {
        const px = (rnd() - 0.5) * (SIZE - 80), pz = (rnd() - 0.5) * (SIZE - 80);
        if (forestMask(px, pz) < 0.4 || !isOK(px, pz, 3)) continue;
        const h = terrain.heightAt(px, pz); if (h < WATER + 1) continue;
        if (rnd() < 0.35) props.push({ key: 'glb/stump/a_lod0', tex: 'stump', x: px, z: pz, s: 0.9 + rnd() * 0.5, r: rnd() * 6.28, y: -0.05, col: [0.35, 0.6] });
        else props.push({ key: rnd() < 0.5 ? 'glb/branches/a_lod0' : 'glb/branches/b_lod0', tex: 'branches', x: px, z: pz, s: 1 + rnd() * 0.6, r: rnd() * 6.28 });
      }
      return { trees, rocks, props };
    }
    const carpet = [
      { variants: ['glb/grass/tall_a_lod0', 'glb/grass/tall_b_lod0', 'glb/grass/tall_c_lod0', 'glb/grass/small_b_lod0'], tex: 'grass', max: 9000, radius: 46, cell: 4, perCell: 14, scale: [2.0, 3.6], wind: 0.35, color: 0xd8e0c8,
        weight: (x, z, T) => { const s = T.splatAt(x, z); return s[1] * 1.6 + s[0] * 0.25; } },
      { variants: ['glb/fern/a_lod0', 'glb/fern/b_lod0', 'glb/fern/c_lod0', 'glb/fern/d_lod0'], tex: 'fern', max: 1400, radius: 40, cell: 5, perCell: 3, scale: [0.9, 1.6], wind: 0.08,
        weight: (x, z, T) => { const s = T.splatAt(x, z); return (s[3] * 1.4 + s[0] * 0.25) * forestMask(x, z); } },
    ];
    return {
      id: 'valley', name: '松林山谷', size: SIZE, half: HALF, water: WATER, lake: LAKE, packs: ['core'],
      layers: [
        { name: 'forrest_ground_01', scale: 3.2, rough: 0.95, ns: 1.1 },
        { name: 'aerial_grass_rock', scale: 9, rough: 0.9, ns: 0.8, tint: 0xe6efd8 },
        { name: 'mossy_rock', scale: 7, rough: 0.85, ns: 1.2 },
        { name: 'forest_leaves_02', scale: 3.5, rough: 0.9, ns: 1.0 },
      ],
      stamps, roads, height, post, far, splat, wet, scatter, carpet, forestMask,
    };
  }

  window.TSMaps = { valley, roadDist, applyStamps, S, lerp };
})();
