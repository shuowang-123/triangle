// 建筑和军事设施：全部用真实照片 PBR 材质（Poly Haven CC0），贴图按真实尺寸铺（1 个单位 = 1 米）
// 静态的东西按材质合并成大网格（画得快），会被打坏的东西（油桶、目标）单独做
(function () {
  'use strict';
  const A = () => TSAssets;
  const V3 = THREE.Vector3;
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new V3(), tmpP = new V3(), up = new V3(0, 1, 0);

  // ---------- 几何体工具 ----------
  // 盒子，每个面的 UV 都按米算（tile = 贴图覆盖多少米）
  function box(w, h, d, tile, tileV) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv, n = g.attributes.normal;
    const tu = tile || 2, tv = tileV || tu;
    for (let i = 0; i < uv.count; i++) {
      const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
      let su, sv;
      if (nx > 0.5) { su = d; sv = h; } else if (ny > 0.5) { su = w; sv = d; } else { su = w; sv = h; }
      uv.setXY(i, uv.getX(i) * su / tu, uv.getY(i) * sv / tv);
    }
    return g;
  }
  function cyl(rt, rb, h, seg, tile, open) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg || 12, 1, !!open);
    const uv = g.attributes.uv;
    const t = tile || 2;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * Math.max(rt, rb) / t, uv.getY(i) * h / t);
    return g;
  }
  // 合并几何体（只要 position / normal / uv）
  function merge(list) {
    let nv = 0, ni = 0;
    for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let ov = 0, oi = 0;
    for (const g of list) {
      const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
      pos.set(p.array, ov * 3); nor.set(n.array, ov * 3);
      if (u) uv.set(u.array, ov * 2);
      if (g.index) { const a = g.index.array; for (let k = 0; k < a.length; k++) idx[oi + k] = a[k] + ov; oi += a.length; }
      else { for (let k = 0; k < p.count; k++) idx[oi + k] = ov + k; oi += p.count; }
      ov += p.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    return out;
  }
  function placed(g, x, y, z, yaw, rx, rz, sx, sy, sz) {
    const e = new THREE.Euler(rx || 0, yaw || 0, rz || 0, 'YXZ');
    tmpQ.setFromEuler(e);
    tmpS.set(sx || 1, sy || sx || 1, sz || sx || 1);
    tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS);
    const c = g.clone(); c.applyMatrix4(tmpM);
    return c;
  }

  // ---------- 程序画的贴图（照片里没有的） ----------
  function canvasTex(w, h, draw, srgb) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    return t;
  }
  function noiseFill(g, w, h, base, n, a) {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * a})`; const s = 1 + Math.random() * 3; g.fillRect(Math.random() * w, Math.random() * h, s, s); }
  }

  function create(scene, terrain, phys, opts) {
    opts = opts || {};
    const batches = {};       // 材质 key -> {mat, geos: []}
    const mats = {};
    const dynamic = [];
    const H = (x, z) => terrain.heightAt(x, z);
    function minH(x, z, w, d, yaw) {
      const c = Math.cos(yaw || 0), s = Math.sin(yaw || 0);
      let m = H(x, z);
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const lx = a * w / 2, lz = b * d / 2;
        m = Math.min(m, H(x + lx * c + lz * s, z - lx * s + lz * c));
      }
      return m;
    }
    function maxH(x, z, w, d, yaw) {
      const c = Math.cos(yaw || 0), s = Math.sin(yaw || 0);
      let m = H(x, z);
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const lx = a * w / 2, lz = b * d / 2; m = Math.max(m, H(x + lx * c + lz * s, z - lx * s + lz * c)); }
      return m;
    }
    // ---------- 材质库 ----------
    function M(key) {
      if (mats[key]) return mats[key];
      const P = A().pbr.bind(A());
      let m;
      switch (key) {
        case 'concrete': m = P('concrete', { ns: 1 }); break;
        case 'concreteDark': m = P('concrete', { color: 0x9a968c, ns: 1 }); break;
        case 'asphalt': m = P('asphalt_02', {}); break;
        case 'planks': m = P('old_planks_02', {}); break;
        case 'planksWeather': m = P('weathered_brown_planks', {}); break;
        case 'bark': m = P('pine_bark', {}); break;
        case 'plaster': m = A().has('tex/white_plaster_rough_01/diff') ? P('white_plaster_rough_01', { color: 0xf2eadc }) : P('concrete', { color: 0xe8e0d0 }); break;
        case 'plasterOchre': m = A().has('tex/white_plaster_rough_01/diff') ? P('white_plaster_rough_01', { color: 0xe6c99a }) : P('concrete', { color: 0xd8c098 }); break;
        case 'plasterBlue': m = A().has('tex/white_plaster_rough_01/diff') ? P('white_plaster_rough_01', { color: 0xc8d6dc }) : P('concrete', { color: 0xc8d0d4 }); break;
        case 'roof': m = A().has('tex/clay_roof_tiles/diff') ? P('clay_roof_tiles', {}) : P('old_planks_02', { color: 0x8a5a40 }); break;
        case 'stone': m = A().has('tex/castle_wall_slates/diff') ? P('castle_wall_slates', {}) : P('mossy_rock', {}); break;
        case 'cobble': m = A().has('tex/cobblestone_floor_04/diff') ? P('cobblestone_floor_04', {}) : P('asphalt_02', {}); break;
        case 'gate': m = A().has('tex/wooden_gate/diff') ? P('wooden_gate', {}) : P('old_planks_02', {}); break;
        case 'blocks': m = A().has('tex/medieval_blocks_03/diff') ? P('medieval_blocks_03', {}) : P('concrete', { color: 0xb0a898 }); break;
        case 'tiles': m = A().has('tex/large_floor_tiles_02/diff') ? P('large_floor_tiles_02', {}) : P('concrete', {}); break;
        case 'fortWall': m = A().has('tex/castle_wall_varriation/diff') ? P('castle_wall_varriation', {}) : P('mossy_rock', {}); break;
        case 'rockWall': m = P('mossy_rock', {}); break;
        case 'metal': m = new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.45, metalness: 0.85, map: A().tex('old/metal', { srgb: true }), normalMap: A().tex('old/metal_n') }); break;
        case 'darkMetal': m = new THREE.MeshStandardMaterial({ color: 0x3a3e42, roughness: 0.5, metalness: 0.8 }); break;
        case 'tin': m = new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.55, metalness: 0.75, map: A().tex('old/container', { srgb: true }), normalMap: A().tex('old/container_n') }); break;
        case 'rust': m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0.4, map: A().tex('old/barrel', { srgb: true }), normalMap: A().tex('old/barrel_n') }); break;
        case 'burlap': m = new THREE.MeshStandardMaterial({ color: 0xd8c8a4, roughness: 0.95, map: A().tex('old/burlap', { srgb: true }), normalMap: A().tex('old/burlap_n') }); break;
        case 'glass': m = new THREE.MeshStandardMaterial({ color: 0x1a2228, roughness: 0.05, metalness: 0.9 }); break;
        case 'frame': m = P('weathered_brown_planks', { color: 0xb8a088 }); break;
        case 'shutter': m = P('old_planks_02', { color: 0x6f8a68 }); break;
        case 'canvas': m = new THREE.MeshStandardMaterial({ roughness: 0.95, side: THREE.DoubleSide, map: canvasTex(256, 256, (g, w, h) => { noiseFill(g, w, h, '#5d6440', 5000, 0.12); g.strokeStyle = 'rgba(0,0,0,0.12)'; for (let y = 0; y < h; y += 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); } }) }); break;
        case 'net': m = new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.DoubleSide, alphaTest: 0.5, map: canvasTex(256, 256, (g, w, h) => {
          g.clearRect(0, 0, w, h);
          const cols = ['#4a5530', '#3a4226', '#6b6a44', '#2e3420'];
          for (let i = 0; i < 900; i++) { g.fillStyle = cols[i % 4]; g.save(); g.translate(Math.random() * w, Math.random() * h); g.rotate(Math.random() * 6); g.fillRect(-6, -3, 12, 6); g.restore(); }
          g.strokeStyle = '#2a2a1a'; g.lineWidth = 1.5; for (let k = 0; k < w; k += 16) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, h); g.moveTo(0, k); g.lineTo(w, k); g.stroke(); }
        }) }); break;
        case 'olive': m = new THREE.MeshStandardMaterial({ color: 0x4f5a34, roughness: 0.6, metalness: 0.3, map: A().tex('old/metal', { srgb: true }) }); break;
        case 'red': m = new THREE.MeshStandardMaterial({ color: 0xc23a28, roughness: 0.55, metalness: 0.3, map: A().tex('old/barrel', { srgb: true }), normalMap: A().tex('old/barrel_n') }); break;
        case 'white': m = new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.4, metalness: 0.4 }); break;
        case 'lampGlow': m = new THREE.MeshBasicMaterial({ color: 0xffd8a0, toneMapped: false }); m.color.multiplyScalar(4); break;
        case 'windowGlow': m = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffb060, emissiveIntensity: 1.6, roughness: 0.2 }); break;
        case 'helipad': m = new THREE.MeshStandardMaterial({ roughness: 0.85, map: canvasTex(512, 512, (g, w, h) => {
          noiseFill(g, w, h, '#77746c', 9000, 0.08);
          g.strokeStyle = '#e8e2c8'; g.lineWidth = 16; g.beginPath(); g.arc(256, 256, 220, 0, Math.PI * 2); g.stroke();
          g.fillStyle = '#e8e2c8'; g.fillRect(170, 140, 40, 232); g.fillRect(302, 140, 40, 232); g.fillRect(170, 236, 172, 40);
        }), normalMap: A().tex('tex/concrete/nor') }); break;
        default: {
          if (key.startsWith('paint:')) { // 涂漆的金属（集装箱）
            const col = +key.slice(6);
            m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, metalness: 0.45, map: A().tex('old/container', { srgb: true }), normalMap: A().tex('old/container_n') });
          } else m = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8 });
        }
      }
      if (opts.envK) m.envMapIntensity = opts.envK;
      return (mats[key] = m);
    }
    function add(key, geo) { (batches[key] || (batches[key] = { geos: [] })).geos.push(geo); }
    // 一个带碰撞的盒子
    function solid(key, x, y, z, w, h, d, yaw, tile, kind, noCol) {
      add(key, placed(box(w, h, d, tile), x, y + h / 2, z, yaw));
      if (!noCol) return phys.box(x, z, y, h, w / 2, d / 2, yaw || 0, kind || 'wall');
      return null;
    }
    // 本地坐标 → 世界坐标
    function loc(x, z, yaw, lx, lz) { const c = Math.cos(yaw), s = Math.sin(yaw); return [x + lx * c + lz * s, z - lx * s + lz * c]; }

    // ================= 军事设施 =================
    // 沙袋墙：一袋一袋垒起来
    const bagGeo = (() => {
      const g = new THREE.SphereGeometry(0.5, 10, 6);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        x *= 0.62; z *= 0.32; y *= 0.22;
        y = Math.sign(y) * Math.pow(Math.abs(y) / 0.22, 0.6) * 0.15;
        x = Math.sign(x) * Math.pow(Math.abs(x) / 0.31, 0.75) * 0.31;
        p.setXYZ(i, x, y, z);
      }
      g.computeVertexNormals();
      return g;
    })();
    function sandbags(x, z, len, yaw, rows, curve) {
      rows = rows || 3;
      const y0 = minH(x, z, len, 0.7, yaw) - 0.05;
      const n = Math.max(1, Math.round(len / 0.58));
      for (let r = 0; r < rows; r++) for (let i = 0; i < n - (r % 2); i++) {
        const t = (i + (r % 2) * 0.5 + 0.5) / n - 0.5;
        const lx = t * len, lz = curve ? -Math.pow(t * 2, 2) * curve : 0;
        const [px, pz] = loc(x, z, yaw, lx, lz);
        const a = yaw + (curve ? Math.atan(4 * t * curve * 2 / len) : 0);
        add('burlap', placed(bagGeo, px, y0 + 0.14 + r * 0.27, pz, a + (Math.random() - 0.5) * 0.12, 0, (Math.random() - 0.5) * 0.08, 1, 1, 1));
      }
      phys.box(x, z, y0 - 1, rows * 0.27 + 1.05, len / 2, 0.36, yaw, 'bags');
    }
    // 混凝土防撞墙（新泽西护栏）
    const jerseyGeo = (() => {
      const s = new THREE.Shape();
      s.moveTo(-0.3, 0); s.lineTo(0.3, 0); s.lineTo(0.3, 0.08); s.lineTo(0.13, 0.33); s.lineTo(0.09, 0.82); s.lineTo(-0.09, 0.82); s.lineTo(-0.13, 0.33); s.lineTo(-0.3, 0.08); s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 3, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 });
      g.translate(0, 0, -1.5);
      g.rotateY(Math.PI / 2);
      // 按米铺 UV
      const p = g.attributes.position, uv = g.attributes.uv, n = g.attributes.normal;
      for (let i = 0; i < p.count; i++) { const ax = Math.abs(n.getX(i)) > 0.7; uv.setXY(i, (ax ? p.getZ(i) : p.getX(i)) / 2, p.getY(i) / 2 + (ax ? 0 : p.getZ(i) / 2)); }
      return g;
    })();
    function jersey(x, z, yaw) {
      const y = minH(x, z, 3, 0.6, yaw);
      add('concrete', placed(jerseyGeo, x, y - 0.03, z, yaw));
      phys.box(x, z, y - 1, 1.85, 1.5, 0.22, yaw, 'barrier');
    }
    function jerseyLine(x, z, n, yaw) { for (let i = 0; i < n; i++) { const [px, pz] = loc(x, z, yaw, (i - (n - 1) / 2) * 3.05, 0); jersey(px, pz, yaw + (Math.random() - 0.5) * 0.05); } }
    // 集装箱：真的有波纹的钢板
    const contGeo = (() => {
      const L = 6.06, W = 2.44, Hh = 2.59;
      const parts = [];
      const side = (len, hgt, waves) => {
        const g = new THREE.PlaneGeometry(len, hgt, waves * 4, 1);
        const p = g.attributes.position, uv = g.attributes.uv;
        for (let i = 0; i < p.count; i++) { const xx = p.getX(i); p.setZ(i, Math.max(-0.5, Math.min(0.5, Math.sin(xx / len * waves * Math.PI * 2) * 1.6)) * 0.045); uv.setXY(i, xx / 2.4, p.getY(i) / 2.4); }
        g.computeVertexNormals();
        return g;
      };
      const s1 = side(L - 0.2, Hh - 0.25, 24); parts.push(placed(s1, 0, Hh / 2, W / 2, 0));
      parts.push(placed(s1, 0, Hh / 2, -W / 2, Math.PI));
      const s2 = side(W - 0.2, Hh - 0.25, 8);
      parts.push(placed(s2, L / 2, Hh / 2, 0, Math.PI / 2)); parts.push(placed(s2, -L / 2, Hh / 2, 0, -Math.PI / 2));
      const roof = new THREE.PlaneGeometry(L, W); roof.rotateX(-Math.PI / 2); parts.push(placed(roof, 0, Hh, 0, 0));
      // 四个角柱和上下梁
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(placed(box(0.16, Hh, 0.16, 1), sx * (L / 2 - 0.08), Hh / 2, sz * (W / 2 - 0.08), 0));
      for (const sz of [-1, 1]) for (const yy of [0.08, Hh - 0.08]) parts.push(placed(box(L, 0.16, 0.14, 1), 0, yy, sz * (W / 2 - 0.07), 0));
      for (const sx of [-1, 1]) for (const yy of [0.08, Hh - 0.08]) parts.push(placed(box(0.14, 0.16, W, 1), sx * (L / 2 - 0.07), yy, 0, 0));
      return merge(parts);
    })();
    const PAINT = [0x2f5f7f, 0x8a3a2a, 0x5a6a35, 0xb07a2a, 0x6a6a6a, 0x3a5a48];
    function container(x, z, yaw, col, stack) {
      const c = col != null ? col : PAINT[Math.floor(Math.random() * PAINT.length)];
      const y = minH(x, z, 6.06, 2.44, yaw) - 0.05;
      add('paint:' + c, placed(contGeo, x, y + (stack || 0) * 2.59, z, yaw));
      phys.box(x, z, y - 1 + (stack || 0) * 2.59, 2.59 + 1, 3.03, 1.22, yaw, 'container');
      return y + 2.59 * ((stack || 0) + 1);
    }
    // 木箱
    function crate(x, z, s, yaw, y0) {
      const y = y0 != null ? y0 : H(x, z) - 0.02;
      add('planks', placed(box(s, s, s, 1.2), x, y + s / 2, z, yaw || 0));
      for (const yy of [0.04, s - 0.04]) add('planksWeather', placed(box(s + 0.03, 0.08, s + 0.03, 1), x, y + yy, z, yaw || 0));
      phys.box(x, z, y - 0.5, s + 0.5, s / 2, s / 2, yaw || 0, 'crate');
      return y + s;
    }
    function crateStack(x, z, yaw) {
      const y = H(x, z);
      const top = crate(x, z, 1.2, yaw, y);
      const [a, b] = loc(x, z, yaw, 1.25, 0.1); crate(a, b, 1.1, yaw + 0.1, H(a, b));
      if (Math.random() < 0.6) crate(x + 0.05, z, 1.0, yaw + 0.3, top);
    }
    // 油桶（可以被打爆）
    const drumGeo = (() => {
      const parts = [cyl(0.29, 0.29, 0.88, 18, 1.8)];
      for (const yy of [-0.29, 0.29]) parts.push(placed(new THREE.TorusGeometry(0.295, 0.018, 6, 20).rotateX(Math.PI / 2), 0, yy, 0, 0));
      return merge(parts.map(g => { if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; }));
    })();
    function drum(x, z, explosive) {
      const y = H(x, z);
      const m = new THREE.Mesh(drumGeo, M(explosive ? 'red' : (Math.random() < 0.5 ? 'olive' : 'rust')));
      m.position.set(x, y + 0.44, z); m.rotation.y = Math.random() * 6;
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
      const ob = phys.cyl(x, z, y - 0.5, 1.4, 0.3, explosive ? 'barrel' : 'drum', { mesh: m, hp: 3 });
      dynamic.push(m);
      return ob;
    }
    // 瞭望塔：木头腿、木平台、铁皮顶
    function tower(x, z, yaw, h) {
      h = h || 6;
      const y = minH(x, z, 3.4, 3.4, yaw);
      const legs = [[-1.4, -1.4], [1.4, -1.4], [1.4, 1.4], [-1.4, 1.4]];
      for (const [a, b] of legs) {
        const [px, pz] = loc(x, z, yaw, a, b);
        add('bark', placed(cyl(0.12, 0.15, h + 3.4, 8, 1.5), px, y + (h + 3.4) / 2 - 0.3, pz, 0));
        phys.cyl(px, pz, y - 1, h + 3, 0.16, 'post');
      }
      // 斜撑
      for (let k = 0; k < 4; k++) {
        const [a1, b1] = legs[k], [a2, b2] = legs[(k + 1) % 4];
        const mx = (a1 + a2) / 2, mz = (b1 + b2) / 2;
        const [px, pz] = loc(x, z, yaw, mx, mz);
        const ang = Math.atan2(b2 - b1, a2 - a1);
        add('planksWeather', placed(box(4.1, 0.12, 0.1, 1), px, y + h * 0.45, pz, yaw - ang, 0, 0.9));
        add('planksWeather', placed(box(4.1, 0.12, 0.1, 1), px, y + h * 0.45, pz, yaw - ang, 0, -0.9));
      }
      // 平台
      add('planks', placed(box(3.6, 0.16, 3.6, 1.5), x, y + h, z, yaw));
      phys.box(x, z, y + h - 0.2, 0.36, 1.8, 1.8, yaw, 'platform');
      // 栏杆（半人高的木板）
      for (const [a, b, w, d] of [[0, -1.75, 3.6, 0.08], [0, 1.75, 3.6, 0.08], [-1.75, 0, 0.08, 3.6], [1.75, 0, 0.08, 3.6]]) {
        const [px, pz] = loc(x, z, yaw, a, b);
        add('planksWeather', placed(box(w, 1.0, d, 1.2), px, y + h + 0.6, pz, yaw));
        phys.box(px, pz, y + h, 1.1, w / 2, d / 2 + 0.02, yaw, 'rail');
      }
      // 铁皮屋顶
      const roof = placed(box(4.2, 0.06, 4.2, 2.4), x, y + h + 3.1, z, yaw, 0.08);
      add('tin', roof);
      // 梯子
      const [lx, lz] = loc(x, z, yaw, 0, 2.05);
      for (const sx of [-0.25, 0.25]) { const [px, pz] = loc(lx, lz, yaw, sx, 0); add('planksWeather', placed(box(0.07, h + 0.8, 0.07, 1), px, y + (h + 0.8) / 2, pz, yaw, 0.12)); }
      for (let r = 0.4; r < h; r += 0.42) { const [px, pz] = loc(x, z, yaw, 0, 2.05 - r * 0.12 + 0.4); add('planksWeather', placed(box(0.5, 0.05, 0.06, 1), px, y + r, pz, yaw)); }
      return { x, z, y: y + h + 0.1, top: y + h };
    }
    // 碉堡：厚厚的混凝土，前面一条射击口，顶上有沙袋
    function bunker(x, z, yaw, w, d) {
      w = w || 6; d = d || 4.5;
      const y = minH(x, z, w, d, yaw) - 0.3;
      const hh = 2.6;
      const parts = [
        [0, -d / 2 + 0.25, w, 0.5, hh * 0.45, 0], [0, -d / 2 + 0.25, w, 0.5, hh * 0.25, hh * 0.75],
        [-w / 2 + 0.25, 0, 0.5, d, hh, 0], [w / 2 - 0.25, 0, 0.5, d, hh, 0],
        [w / 4 + 0.6, d / 2 - 0.25, w / 2 - 1.2, 0.5, hh, 0], [-w / 4 - 0.6, d / 2 - 0.25, w / 2 - 1.2, 0.5, hh, 0],
      ];
      for (const [a, b, ww, dd, h2, y2] of parts) {
        const [px, pz] = loc(x, z, yaw, a, b);
        solid('concreteDark', px, y + y2, pz, ww, h2, dd, yaw, 2);
      }
      // 射击口两边的柱子
      for (const a of [-w / 4, w / 4]) { const [px, pz] = loc(x, z, yaw, a, -d / 2 + 0.25); solid('concreteDark', px, y + hh * 0.45, pz, 0.5, hh * 0.3, 0.5, yaw, 2); }
      const [rx, rz] = loc(x, z, yaw, 0, 0);
      add('concreteDark', placed(box(w + 0.4, 0.4, d + 0.4, 2), rx, y + hh + 0.2, rz, yaw));
      phys.box(rx, rz, y + hh, 0.4, w / 2 + 0.2, d / 2 + 0.2, yaw, 'roof');
      // 顶上的沙袋
      const [sx, sz] = loc(x, z, yaw, 0, -d / 2 + 0.3);
      sandbagsAt(sx, sz, w * 0.8, yaw, y + hh + 0.4, 2);
      return { x, z, y: y + hh + 0.4 };
    }
    function sandbagsAt(x, z, len, yaw, y0, rows) {
      const n = Math.max(1, Math.round(len / 0.58));
      for (let r = 0; r < rows; r++) for (let i = 0; i < n - (r % 2); i++) {
        const t = (i + (r % 2) * 0.5 + 0.5) / n - 0.5;
        const [px, pz] = loc(x, z, yaw, t * len, 0);
        add('burlap', placed(bagGeo, px, y0 + 0.14 + r * 0.27, pz, yaw + (Math.random() - 0.5) * 0.12, 0, (Math.random() - 0.5) * 0.08));
      }
      phys.box(x, z, y0, rows * 0.27 + 0.05, len / 2, 0.36, yaw, 'bags');
    }
    // 军用帐篷
    function tent(x, z, yaw, w, d) {
      w = w || 4.5; d = d || 6;
      const y = minH(x, z, w, d, yaw);
      const hh = 2.6;
      const sh = new THREE.Shape();
      sh.moveTo(-w / 2, 0); sh.lineTo(-w / 2, 1.1); sh.lineTo(0, hh); sh.lineTo(w / 2, 1.1); sh.lineTo(w / 2, 0); sh.lineTo(w / 2 - 0.02, 0); sh.lineTo(w / 2 - 0.02, 1.08); sh.lineTo(0, hh - 0.03); sh.lineTo(-w / 2 + 0.02, 1.08); sh.lineTo(-w / 2 + 0.02, 0);
      const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: false });
      const p = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + p.getZ(i)) / 2, p.getY(i) / 2);
      g.translate(0, 0, -d / 2);
      add('canvas', placed(g, x, y - 0.02, z, yaw));
      // 两头的布
      const end = new THREE.ShapeGeometry((() => { const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(-w / 2, 1.1); s.lineTo(0, hh); s.lineTo(w / 2, 1.1); s.lineTo(w / 2, 0); s.lineTo(0.5, 0); s.lineTo(0.5, 1.7); s.lineTo(-0.5, 1.7); s.lineTo(-0.5, 0); return s; })());
      { const p2 = end.attributes.position, u2 = end.attributes.uv; for (let i = 0; i < p2.count; i++) u2.setXY(i, p2.getX(i) / 2, p2.getY(i) / 2); }
      add('canvas', placed(end, ...loc(x, z, yaw, 0, d / 2).reduce((a, v, i) => (i === 0 ? [v, y] : [...a, v]), []), yaw));
      add('canvas', placed(end, ...loc(x, z, yaw, 0, -d / 2).reduce((a, v, i) => (i === 0 ? [v, y] : [...a, v]), []), yaw + Math.PI));
      phys.box(x, z, y - 0.5, hh * 0.8 + 0.5, w / 2, d / 2, yaw, 'tent');
    }
    // 伪装网：几根杆子撑起来的一大片网
    function camoNet(x, z, w, d, yaw, hgt) {
      hgt = hgt || 3.2;
      const y = H(x, z);
      const g = new THREE.PlaneGeometry(w, d, 12, 12);
      const p = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        const u = p.getX(i) / (w / 2), v = p.getY(i) / (d / 2);
        const sag = (1 - Math.abs(Math.cos(u * Math.PI))) * 0.35 + (1 - Math.abs(Math.cos(v * Math.PI))) * 0.35;
        p.setZ(i, -sag - Math.max(Math.abs(u), Math.abs(v)) ** 4 * 1.4);
        uv.setXY(i, p.getX(i) / 2.5, p.getY(i) / 2.5);
      }
      g.rotateX(-Math.PI / 2);
      g.computeVertexNormals();
      add('net', placed(g, x, y + hgt, z, yaw));
      for (const [a, b] of [[-w / 2 + 0.6, -d / 2 + 0.6], [w / 2 - 0.6, -d / 2 + 0.6], [w / 2 - 0.6, d / 2 - 0.6], [-w / 2 + 0.6, d / 2 - 0.6], [0, 0]]) {
        const [px, pz] = loc(x, z, yaw, a, b);
        const hy = H(px, pz);
        const hh2 = y + hgt - hy - (a === 0 && b === 0 ? 0.1 : 0.9);
        add('darkMetal', placed(cyl(0.035, 0.035, hh2, 6, 1), px, hy + hh2 / 2, pz, 0));
      }
    }
    // 铁丝网围栏
    function fence(pts, kind) {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 3));
        const yaw = Math.atan2(-(bz - az), bx - ax);
        for (let k = 0; k <= n; k++) {
          const t = k / n, px = ax + (bx - ax) * t, pz = az + (bz - az) * t, y = H(px, pz);
          add(kind === 'wood' ? 'bark' : 'darkMetal', placed(cyl(0.05, 0.06, 2.0, 6, 1), px, y + 0.9, pz, 0));
          if (k < n) {
            const qx = ax + (bx - ax) * (t + 0.5 / n), qz = az + (bz - az) * (t + 0.5 / n), qy = H(qx, qz);
            for (const hy of kind === 'wood' ? [0.5, 1.1] : [0.35, 0.8, 1.25, 1.7]) add(kind === 'wood' ? 'planksWeather' : 'darkMetal', placed(box(L / n, kind === 'wood' ? 0.12 : 0.015, kind === 'wood' ? 0.04 : 0.015, 1), qx, qy + hy, qz, yaw));
          }
        }
        const cx = (ax + bx) / 2, cz = (az + bz) / 2;
        phys.box(cx, cz, Math.min(H(ax, az), H(bx, bz)) - 1, 3, L / 2, 0.08, yaw, 'fence');
      }
    }
    // 直升机停机坪
    function helipad(x, z, r) {
      r = r || 9;
      const y = maxH(x, z, r * 2, r * 2, 0) + 0.05;
      const g = new THREE.CylinderGeometry(r, r + 0.3, 0.6, 40, 1);
      const uv = g.attributes.uv, p = g.attributes.position;
      for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / (2 * r) + 0.5, -p.getZ(i) / (2 * r) + 0.5);
      add('helipad', placed(g, x, y - 0.3, z, 0));
      phys.cyl(x, z, y - 3, 3, r, 'pad');
      return y;
    }
    // 雷达天线、防空炮、弹药箱这些“目标”单独做，可以被炸掉
    function dish(x, z) {
      const g = new THREE.Group();
      const y = H(x, z);
      const base = new THREE.Mesh(box(2.4, 2.6, 2.4, 2), M('concreteDark')); base.position.y = 1.3; g.add(base);
      const mast = new THREE.Mesh(cyl(0.18, 0.24, 2.0, 10, 1), M('metal')); mast.position.y = 3.6; g.add(mast);
      const head = new THREE.Group(); head.position.y = 4.6; g.add(head);
      const dsh = new THREE.Mesh(new THREE.SphereGeometry(1.9, 28, 12, 0, Math.PI * 2, 0, Math.PI / 3.2), new THREE.MeshStandardMaterial({ color: 0xe0e0d8, metalness: 0.5, roughness: 0.35, side: THREE.DoubleSide }));
      dsh.rotation.x = -Math.PI / 2 - 0.45; head.add(dsh);
      const horn = new THREE.Mesh(cyl(0.05, 0.05, 1.7, 6, 1), M('metal')); horn.rotation.x = -0.45 + Math.PI / 2; horn.position.set(0, 0.4, 0.75); head.add(horn);
      g.position.set(x, y, z);
      g.traverse(c => { if (c.isMesh) { c.castShadow = c.receiveShadow = true; } });
      scene.add(g);
      const ob = phys.box(x, z, y - 1, 3.6, 1.2, 1.2, 0, 'target');
      return { g, head, ob, y };
    }
    function aaGun(x, z) {
      const g = new THREE.Group();
      const y = H(x, z);
      const ring = new THREE.Mesh(cyl(1.6, 1.8, 0.5, 20, 2), M('concreteDark')); ring.position.y = 0.25; g.add(ring);
      const turret = new THREE.Group(); turret.position.y = 0.6; g.add(turret);
      const body = new THREE.Mesh(box(1.6, 0.9, 1.4, 1), M('olive')); body.position.y = 0.5; turret.add(body);
      const seat = new THREE.Mesh(box(0.5, 0.5, 0.5, 1), M('darkMetal')); seat.position.set(0.9, 0.4, 0.2); turret.add(seat);
      for (const sx of [-0.35, 0.35]) {
        const b = new THREE.Mesh(cyl(0.07, 0.07, 3.2, 10, 1), M('darkMetal'));
        b.rotation.x = Math.PI / 2 - 0.7; b.position.set(sx, 1.6, -1.1); turret.add(b);
        const muz = new THREE.Mesh(cyl(0.1, 0.1, 0.3, 10, 1), M('darkMetal')); muz.rotation.x = Math.PI / 2 - 0.7; muz.position.set(sx, 2.6, -2.25); turret.add(muz);
      }
      g.position.set(x, y, z);
      g.traverse(c => { if (c.isMesh) { c.castShadow = c.receiveShadow = true; } });
      scene.add(g);
      const ob = phys.cyl(x, z, y - 1, 2.6, 1.7, 'target');
      return { g, head: turret, ob, y };
    }
    function ammoCache(x, z, yaw) {
      const g = new THREE.Group();
      const y = H(x, z);
      const mat = M('olive');
      for (let i = 0; i < 6; i++) {
        const b = new THREE.Mesh(box(1.1, 0.45, 0.55, 1), mat);
        b.position.set((i % 3 - 1) * 1.15, 0.23 + Math.floor(i / 3) * 0.46, (Math.floor(i / 3) % 2) * 0.1);
        b.rotation.y = (Math.random() - 0.5) * 0.1; g.add(b);
      }
      const tarp = new THREE.Mesh(box(3.6, 0.04, 1.6, 2), M('canvas')); tarp.position.y = 0.95; tarp.rotation.z = 0.04; g.add(tarp);
      g.position.set(x, y, z); g.rotation.y = yaw || 0;
      g.traverse(c => { if (c.isMesh) { c.castShadow = c.receiveShadow = true; } });
      scene.add(g);
      const ob = phys.box(x, z, y - 1, 2, 1.75, 0.6, yaw || 0, 'target');
      return { g, head: null, ob, y };
    }
    // 电线杆和电线
    function powerLine(pts) {
      const poles = [];
      for (const [x, z] of pts) {
        const y = H(x, z);
        add('bark', placed(cyl(0.12, 0.16, 9, 8, 1.5), x, y + 4.4, z, 0));
        add('planksWeather', placed(box(2.2, 0.14, 0.14, 1), x, y + 8.4, z, 0));
        phys.cyl(x, z, y - 1, 10, 0.16, 'post');
        poles.push([x, y + 8.5, z]);
      }
      const segs = [];
      for (let i = 0; i < poles.length - 1; i++) for (const off of [-0.9, 0, 0.9]) {
        const a = poles[i], b = poles[i + 1];
        for (let k = 0; k < 12; k++) {
          const t0 = k / 12, t1 = (k + 1) / 12;
          const sag = t => -Math.sin(t * Math.PI) * 1.2;
          segs.push(a[0] + off + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0 + sag(t0), a[2] + (b[2] - a[2]) * t0, a[0] + off + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1 + sag(t1), a[2] + (b[2] - a[2]) * t1);
        }
      }
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
      const ln = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x1a1a1a }));
      scene.add(ln); dynamic.push(ln);
    }
    // 路灯
    function lamp(x, z, night) {
      const y = H(x, z);
      add('darkMetal', placed(cyl(0.07, 0.1, 5, 8, 1), x, y + 2.5, z, 0));
      add('darkMetal', placed(box(1.2, 0.08, 0.08, 1), x + 0.5, y + 4.95, z, 0));
      add('lampGlow', placed(box(0.35, 0.08, 0.2, 1), x + 1.0, y + 4.88, z, 0));
      phys.cyl(x, z, y - 1, 6, 0.12, 'post');
      if (night) { const l = new THREE.PointLight(0xffc888, 18, 22, 2); l.position.set(x + 1, y + 4.6, z); scene.add(l); dynamic.push(l); }
    }

    // ================= 房子 =================
    // 带石头墙基、窗户、木百叶窗、瓦片屋顶的两层小楼
    function house(x, z, w, d, floors, yaw, style) {
      style = style || {};
      const fh = 3.0, wallH = floors * fh;
      const y = minH(x, z, w, d, yaw) - 0.1;
      const top = maxH(x, z, w, d, yaw);
      const baseH = Math.max(0.6, top - y + 0.5);
      const wallMat = style.wall || 'plaster';
      // 墙基
      add('stone', placed(box(w + 0.16, baseH + 1, d + 0.16, 2), x, y - 0.5 + (baseH + 1) / 2, z, yaw));
      // 墙
      const y1 = y + baseH;
      add(wallMat, placed(box(w, wallH, d, 3), x, y1 + wallH / 2, z, yaw));
      phys.box(x, z, y - 1, baseH + wallH + 1, w / 2, d / 2, yaw, 'house');
      // 楼层之间的线脚
      for (let f = 1; f < floors; f++) add('stone', placed(box(w + 0.1, 0.18, d + 0.1, 2), x, y1 + f * fh, z, yaw));
      add('stone', placed(box(w + 0.2, 0.22, d + 0.2, 2), x, y1 + wallH - 0.05, z, yaw));
      // 窗户和门
      const glow = style.night && Math.random() < 0.5;
      const faces = [[0, d / 2, w, 0], [0, -d / 2, w, Math.PI], [w / 2, 0, d, Math.PI / 2], [-w / 2, 0, d, -Math.PI / 2]];
      faces.forEach(([fx, fz, len, ang], fi) => {
        const nWin = Math.max(1, Math.floor((len - 1) / 2.4));
        for (let f = 0; f < floors; f++) for (let k = 0; k < nWin; k++) {
          const lx = (k - (nWin - 1) / 2) * (len / nWin);
          const isDoor = f === 0 && fi === 0 && k === Math.floor(nWin / 2);
          const wy = y1 + f * fh + (isDoor ? 0 : 1.0);
          const wh = isDoor ? 2.2 : 1.35, ww = isDoor ? 1.1 : 0.95;
          const a = yaw + ang;
          const [cx, cz] = loc(x, z, yaw, fx, fz);
          const [px, pz] = loc(cx, cz, a, lx, 0.03);
          add(isDoor ? 'gate' : (glow && !isDoor ? 'windowGlow' : 'glass'), placed(box(ww, wh, 0.06, ww), px, wy + wh / 2, pz, a));
          // 窗框
          add('frame', placed(box(ww + 0.16, 0.1, 0.12, 1), px, wy - 0.02, pz, a));
          add('frame', placed(box(ww + 0.16, 0.1, 0.12, 1), px, wy + wh + 0.02, pz, a));
          for (const s of [-1, 1]) { const [qx, qz] = loc(px, pz, a, s * (ww / 2 + 0.04), 0); add('frame', placed(box(0.08, wh, 0.12, 1), qx, wy + wh / 2, qz, a)); }
          if (!isDoor) {
            add('frame', placed(box(0.05, wh, 0.07, 1), px, wy + wh / 2, pz, a));
            if (style.shutters !== false) for (const s of [-1, 1]) { const [qx, qz] = loc(px, pz, a, s * (ww * 0.78), 0.05); add('shutter', placed(box(ww * 0.5, wh, 0.05, 1), qx, wy + wh / 2, qz, a + s * 0.15)); }
          }
        }
      });
      // 屋顶：两片瓦 + 两个山墙
      const rh = Math.min(w, d) * 0.32;
      const along = w >= d;
      const span = along ? d : w, len = along ? w : d;
      const slope = Math.atan2(rh, span / 2), sl = Math.hypot(rh, span / 2) + 0.35;
      for (const s of [-1, 1]) {
        const lz = s * span / 4;
        const [px, pz] = along ? loc(x, z, yaw, 0, lz) : loc(x, z, yaw, lz, 0);
        const g = box(along ? len + 0.6 : sl, 0.12, along ? sl : len + 0.6, 2.2);
        const rot = along ? placed(g, px, y1 + wallH + rh / 2, pz, yaw, s * slope, 0) : placed(g, px, y1 + wallH + rh / 2, pz, yaw, 0, -s * slope);
        add('roof', rot);
      }
      const gable = new THREE.ShapeGeometry((() => { const s = new THREE.Shape(); s.moveTo(-span / 2, 0); s.lineTo(span / 2, 0); s.lineTo(0, rh); s.closePath(); return s; })());
      { const p = gable.attributes.position, u = gable.attributes.uv; for (let i = 0; i < p.count; i++) u.setXY(i, p.getX(i) / 3, p.getY(i) / 3); }
      for (const s of [-1, 1]) {
        const [px, pz] = along ? loc(x, z, yaw, s * len / 2, 0) : loc(x, z, yaw, 0, s * len / 2);
        add(wallMat, placed(gable, px, y1 + wallH, pz, yaw + (along ? s * Math.PI / 2 : (s > 0 ? 0 : Math.PI))));
      }
      // 烟囱
      if (Math.random() < 0.6) { const [px, pz] = loc(x, z, yaw, w * 0.25, d * 0.15); add('stone', placed(box(0.6, rh + 1.2, 0.6, 1.5), px, y1 + wallH + (rh + 1.2) / 2, pz, yaw)); }
      return { x, z, y: y1 + wallH, top: y1 + wallH + rh };
    }
    // 小木棚
    function shed(x, z, w, d, yaw) {
      const y = minH(x, z, w, d, yaw) - 0.1;
      const hh = 2.6;
      add('planksWeather', placed(box(w, hh, d, 1.6), x, y + hh / 2, z, yaw));
      add('tin', placed(box(w + 0.5, 0.06, d + 0.6, 2.4), x, y + hh + 0.2, z, yaw, 0.12));
      const [dx, dz] = loc(x, z, yaw, 0, d / 2 + 0.02);
      add('gate', placed(box(1.2, 2.0, 0.05, 1.2), dx, y + 1.0, dz, yaw));
      phys.box(x, z, y - 1, hh + 1.3, w / 2, d / 2, yaw, 'shed');
    }
    // 石头 / 混凝土围墙
    function wallLine(pts, h, thick, matKey, crenel) {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const L = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(-(bz - az), bx - ax);
        const n = Math.max(1, Math.ceil(L / 8));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n, px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
          const sl = L / n + thick * 0.5;
          const y = minH(px, pz, sl, thick, yaw) - 0.5;
          const tt = maxH(px, pz, sl, thick, yaw);
          const hh = tt - y + h;
          add(matKey, placed(box(sl, hh, thick, 3), px, y + hh / 2, pz, yaw));
          phys.box(px, pz, y, hh, sl / 2, thick / 2, yaw, 'wall');
          if (crenel) for (let c = -sl / 2 + 0.6; c < sl / 2 - 0.3; c += 1.6) { const [qx, qz] = loc(px, pz, yaw, c, 0); add(matKey, placed(box(0.8, 0.7, thick + 0.1, 2), qx, y + hh + 0.35, qz, yaw)); }
        }
      }
    }
    // 柏油路 / 石板路：贴着地形的长条
    function road(pts, width, matKey) {
      const pos = [], uv = [], idx = [], nor = [];
      let along = 0;
      const samp = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 2);
        for (let k = 0; k < n; k++) samp.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
      }
      samp.push(pts[pts.length - 1]);
      for (let i = 0; i < samp.length; i++) {
        const a = samp[Math.max(0, i - 1)], b = samp[Math.min(samp.length - 1, i + 1)];
        let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        const nx = -tz, nz = tx;
        if (i > 0) along += Math.hypot(samp[i][0] - samp[i - 1][0], samp[i][1] - samp[i - 1][1]);
        for (let s = -1; s <= 1; s += 0.5) {
          const px = samp[i][0] + nx * s * width / 2, pz = samp[i][1] + nz * s * width / 2;
          pos.push(px, H(px, pz) + 0.06, pz); nor.push(0, 1, 0);
          uv.push((s + 1) * width / 2 / 4, along / 4);
        }
      }
      const cols = 5;
      for (let i = 0; i < samp.length - 1; i++) for (let s = 0; s < cols - 1; s++) {
        const a = i * cols + s, b = a + 1, c = a + cols, d2 = c + 1;
        idx.push(a, c, b, b, c, d2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, M(matKey || 'asphalt'));
      m.material.polygonOffset = true; m.material.polygonOffsetFactor = -2; m.material.polygonOffsetUnits = -2;
      m.receiveShadow = true;
      scene.add(m); dynamic.push(m);
    }
    // Poly Haven 的小物件：油桶、轮胎、煤气罐、垃圾桶、盖着布的车……
    const propList = [];
    function prop(key, x, z, yaw, s, col, y) {
      propList.push({ key, x, z, yaw: yaw || 0, s: s || 1, y });
      if (col) phys.cyl(x, z, H(x, z) - 0.5, col[1] + 0.5, col[0], 'prop');
    }
    async function finishProps() {
      const by = {};
      for (const p of propList) (by[p.key] || (by[p.key] = [])).push(p);
      for (const key in by) {
        const src = await A().model(key);
        if (!src) continue;
        for (const p of by[key]) {
          const o = src.clone(true);
          o.position.set(p.x, p.y != null ? p.y : H(p.x, p.z), p.z); o.rotation.y = p.yaw; o.scale.setScalar(p.s);
          if (opts.envK) o.traverse(c => { if (c.isMesh && c.material) c.material.envMapIntensity = opts.envK; });
          scene.add(o); dynamic.push(o);
        }
      }
    }
    // 合并：同一种材质、同一个 200 米区域的东西变成一个网格
    const built = [];
    function finish() {
      for (const key in batches) {
        const geos = batches[key].geos;
        const cells = {};
        for (const g of geos) {
          if (!g.boundingSphere) g.computeBoundingSphere();
          const c = g.boundingSphere.center;
          const k = Math.floor(c.x / 200) + ',' + Math.floor(c.z / 200);
          (cells[k] || (cells[k] = [])).push(g);
        }
        for (const k in cells) {
          const m = new THREE.Mesh(merge(cells[k]), M(key));
          m.castShadow = !key.includes('Glow') && key !== 'helipad'; m.receiveShadow = true;
          m.matrixAutoUpdate = false;
          scene.add(m); built.push(m);
        }
        cells.length = 0;
      }
      for (const k in batches) delete batches[k];
    }
    function dispose() {
      built.concat(dynamic).forEach(o => { scene.remove(o); if (o.geometry && !o.isGroup) o.geometry.dispose(); });
      built.length = 0; dynamic.length = 0;
    }
    return {
      M, add, solid, placed, box, cyl, loc, H, minH, maxH,
      sandbags, jersey, jerseyLine, container, crate, crateStack, drum, tower, bunker, tent, camoNet, fence, helipad,
      dish, aaGun, ammoCache, powerLine, lamp, house, shed, wallLine, road, prop, finishProps, finish, dispose, built, dynamic,
    };
  }
  window.TSBuild = { create, box, cyl, merge, placed, canvasTex };
})();
