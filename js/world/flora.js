// 植被和石头：真实扫描的草丛、蕨类、岩石（Poly Haven CC0），程序生成的松树
(function () {
  'use strict';
  const A = () => TSAssets;
  const hash = (i, j, s) => { const h = Math.sin(i * 127.1 + j * 311.7 + (s || 0) * 74.7) * 43758.5453; return h - Math.floor(h); };
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpE = new THREE.Euler(), up = new THREE.Vector3(0, 1, 0);
  const windUni = { uTime: { value: 0 }, uWind: { value: 1 } };

  // 让材质随风摆（顶点越高摆得越多）
  function addWind(mat, k, tag) {
    mat.onBeforeCompile = sh => {
      sh.uniforms.uTime = windUni.uTime; sh.uniforms.uWind = windUni.uWind;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            vec4 wp0 = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            float ph = wp0.x * 0.21 + wp0.z * 0.17;
            float sway = (sin(uTime * 1.7 + ph) * 0.6 + sin(uTime * 3.1 + ph * 1.7) * 0.25) * uWind;
            float hk = max(transformed.y, 0.0) * ${k.toFixed(3)};
            transformed.x += sway * hk; transformed.z += sway * hk * 0.6;
          }`);
      // 远处贴图缩小后透明度被平均掉，树叶会“变秃”；按 mip 级别补回来
      sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', `
        #ifdef USE_MAP
        {
          vec2 tsz = vec2(textureSize(map, 0));
          vec2 dx = dFdx(vMapUv * tsz), dy = dFdy(vMapUv * tsz);
          float lod = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
          diffuseColor.a *= 1.0 + lod * 0.28;
        }
        #endif
        #include <alphatest_fragment>`);
    };
    mat.customProgramCacheKey = () => 'wind' + tag;
    return mat;
  }

  // ---------- 草和蕨类：围着玩家一圈，走动时重新摆（同一个位置的草永远一样，不会乱跳） ----------
  async function makeCarpet(scene, terrain, defs, opts) {
    const layers = [];
    for (const d of defs) {
      const meshes = [];
      for (const v of d.variants) { const m = await A().glbMesh(v); if (m) meshes.push(m.geometry); }
      if (!meshes.length) continue;
      const mat = new THREE.MeshStandardMaterial({
        map: A().tex(`tex/${d.tex}/diff`, { srgb: true }), normalMap: A().tex(`tex/${d.tex}/nor`),
        roughnessMap: A().tex(`tex/${d.tex}/arm`), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1, color: d.color || 0xffffff,
      });
      if (opts.a2c) mat.alphaToCoverage = true;
      addWind(mat, d.wind, d.tex);
      const per = Math.ceil(d.max / meshes.length);
      const ims = meshes.map(g => {
        const im = new THREE.InstancedMesh(g, mat, per);
        im.count = 0; im.frustumCulled = false; im.receiveShadow = true; im.castShadow = !!d.shadow;
        scene.add(im);
        return im;
      });
      layers.push({ d, ims, per });
    }
    let lastX = 1e9, lastZ = 1e9;
    function rebuild(cx, cz) {
      for (const L of layers) {
        const d = L.d, R = d.radius * (opts.radiusK || 1), C = d.cell;
        const counts = L.ims.map(() => 0);
        const i0 = Math.floor((cx - R) / C), i1 = Math.floor((cx + R) / C), j0 = Math.floor((cz - R) / C), j1 = Math.floor((cz + R) / C);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
          for (let k = 0; k < d.perCell; k++) {
            const x = (i + hash(i, j, k)) * C, z = (j + hash(j, i, k + 9)) * C;
            const dist = Math.hypot(x - cx, z - cz);
            if (dist > R) continue;
            const w = d.weight(x, z, terrain);
            if (w <= hash(i, j, k + 31)) continue;
            const vi = Math.floor(hash(i, j, k + 51) * L.ims.length);
            if (counts[vi] >= L.per) continue;
            const y = terrain.heightAt(x, z);
            const fade = Math.min(1, (R - dist) / (R * 0.25));
            const s = d.scale[0] + (d.scale[1] - d.scale[0]) * hash(i, j, k + 71);
            tmpE.set((hash(i, j, k + 3) - 0.5) * 0.25, hash(i, j, k + 5) * 6.283, (hash(i, j, k + 7) - 0.5) * 0.25);
            tmpQ.setFromEuler(tmpE);
            tmpS.setScalar(s * (0.35 + 0.65 * fade) * Math.min(1, w * 1.5 + 0.3));
            tmpM.compose(tmpP.set(x, y - 0.03, z), tmpQ, tmpS);
            L.ims[vi].setMatrixAt(counts[vi]++, tmpM);
          }
        }
        L.ims.forEach((im, k) => { im.count = counts[k]; im.instanceMatrix.needsUpdate = true; });
      }
    }
    return {
      update(p, t) {
        windUni.uTime.value = t;
        if (Math.hypot(p.x - lastX, p.z - lastZ) > (opts.step || 3)) { lastX = p.x; lastZ = p.z; rebuild(p.x, p.z); }
      },
      force() { lastX = 1e9; },
      dispose() { layers.forEach(L => L.ims.forEach(im => { scene.remove(im); im.dispose(); })); },
    };
  }

  // ---------- 松树：树干（松树皮照片）+ 一层层的针叶枝片 ----------
  function needleTex(dark, light) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 512, 256);
    const rnd = TSNoise.mulberry(7);
    function twig(x0, y0, len, ang, w, depth) {
      const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
      g.strokeStyle = '#3a2c1c'; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      const n = Math.floor(len / 2.2);
      for (let i = 0; i < n; i++) {
        const t = i / n, px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
        const nl = (7 + rnd() * 7) * (1 - t * 0.55) * (depth ? 0.8 : 1);
        for (const sd of [-1, 1]) {
          const a = ang + sd * (0.75 + rnd() * 0.35);
          const L = Math.floor(30 + rnd() * 40 + t * 40);
          g.strokeStyle = `rgb(${dark[0] + (light[0] - dark[0]) * t * rnd() | 0},${dark[1] + (light[1] - dark[1]) * (0.3 + t * 0.7) * rnd() | 0},${dark[2] + (light[2] - dark[2]) * t * rnd() | 0})`;
          g.lineWidth = 1.6; g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * nl, py + Math.sin(a) * nl); g.stroke();
          void L;
        }
        if (!depth && i % 6 === 3 && t < 0.85) twig(px, py, len * (0.35 + rnd() * 0.2) * (1 - t), ang + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.3), 1.6, 1);
      }
    }
    twig(6, 128, 490, 0, 4, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }
  function pineGeo(rnd, H, R0, kind) {
    // 树干
    const trunk = new THREE.CylinderGeometry(0.04 + R0 * 0.05, R0 * 0.16, H, 9, 6, true);
    trunk.translate(0, H / 2, 0);
    { const p = trunk.attributes.position, uv = trunk.attributes.uv; for (let i = 0; i < p.count; i++) { uv.setXY(i, uv.getX(i) * 2, p.getY(i) / 1.6); const k = 1 + (rnd() - 0.5) * 0.06; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } }
    // 枝片
    const pos = [], nor = [], uvs = [], idx = [];
    const crownBase = H * (kind === 1 ? 0.35 : 0.18);
    const levels = Math.floor(H * (kind === 1 ? 1.1 : 1.6));
    for (let l = 0; l < levels; l++) {
      const t = l / (levels - 1);
      const y = crownBase + (H - crownBase) * Math.pow(t, 0.85);
      const len = R0 * (kind === 1 ? (0.7 + 0.3 * Math.sin(t * 3.1)) * (1 - t * 0.6) : Math.pow(1 - t, 0.9) * 1.1 + 0.15);
      const n = Math.max(3, Math.round(4 + (1 - t) * 5));
      const off = rnd() * 6.28;
      for (let b = 0; b < n; b++) {
        const a = off + b / n * Math.PI * 2 + (rnd() - 0.5) * 0.5;
        const L = len * (0.8 + rnd() * 0.4), Wd = L * 0.55;
        const droop = (kind === 1 ? 0.15 : 0.32) + rnd() * 0.2;
        const ca = Math.cos(a), sa = Math.sin(a);
        // 一张枝片两个三角形，从树干伸出去，往下垂
        const base = pos.length / 3;
        const pts = [[0, Wd * 0.5], [0, -Wd * 0.5], [L, -Wd * 0.5], [L, Wd * 0.5]];
        const tilt = (rnd() - 0.5) * 0.8;
        for (const [u, w] of pts) {
          const dy = -u * droop + w * Math.sin(tilt) * 0.5;
          const lx = u, lz = w * Math.cos(tilt);
          const x = lx * ca - lz * sa, z = lx * sa + lz * ca;
          pos.push(x, y + dy, z);
          // 法线：从树中心往外，球形的法线让树冠光照柔和
          const nx = x, ny = (y + dy - (crownBase + H) * 0.45) * 0.6 + 1.2, nz = z, nl = Math.hypot(nx, ny, nz);
          nor.push(nx / nl, ny / nl, nz / nl);
        }
        uvs.push(0, 1, 0, 0, 1, 0, 1, 1);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    // 树顶
    const tb = pos.length / 3, tw = R0 * 0.18;
    for (const r of [0, Math.PI / 2]) {
      const b = pos.length / 3, c = Math.cos(r), s = Math.sin(r);
      for (const [u, v] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) { pos.push(u * tw * c, H - 1.2 + v * 1.6, u * tw * s); nor.push(0, 1, 0); }
      uvs.push(0, 0.2, 0, 0.8, 1, 0.8, 1, 0.2);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    void tb;
    const fol = new THREE.BufferGeometry();
    fol.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    fol.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    fol.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    fol.setIndex(idx);
    return { trunk, fol };
  }

  function makeForest(scene, terrain, trees, opts) {
    // trees: [{x, z, s, kind}]
    const rnd = TSNoise.mulberry(42);
    const barkMat = A().pbr('pine_bark', { rep: [1, 1], ns: 1.2 });
    const variants = [];
    const nt = needleTex([22, 40, 20], [70, 98, 46]);
    const nt2 = needleTex([28, 46, 24], [86, 110, 52]);
    for (let k = 0; k < 4; k++) {
      const kind = k < 3 ? 0 : 1;
      const g = pineGeo(rnd, kind ? 13 : 15 + k * 2, kind ? 3.2 : 3.4 + k * 0.4, kind);
      const fm = new THREE.MeshStandardMaterial({ map: k % 2 ? nt2 : nt, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.92, color: 0xffffff });
      if (opts.a2c) fm.alphaToCoverage = true;
      addWind(fm, 0.012, 'pine' + k);
      variants.push({ g, fm });
    }
    // 按 200 米分块，这样看不见的块整块跳过
    const PATCH = 200, half = terrain.half;
    const patches = {};
    for (const t of trees) {
      const key = Math.floor((t.x + half) / PATCH) + ',' + Math.floor((t.z + half) / PATCH);
      (patches[key] || (patches[key] = [[], [], [], []]))[t.kind % 4].push(t);
    }
    const objs = [];
    for (const key in patches) {
      patches[key].forEach((list, vi) => {
        if (!list.length) return;
        const V = variants[vi];
        const tr = new THREE.InstancedMesh(V.g.trunk, barkMat, list.length);
        const fo = new THREE.InstancedMesh(V.g.fol, V.fm, list.length);
        const col = new THREE.Color();
        list.forEach((t, i) => {
          tmpQ.setFromAxisAngle(up, t.r != null ? t.r : rnd() * 6.28);
          tmpS.set(t.s, t.s * (0.9 + rnd() * 0.25), t.s);
          tmpM.compose(tmpP.set(t.x, terrain.heightAt(t.x, t.z) - 0.3, t.z), tmpQ, tmpS);
          tr.setMatrixAt(i, tmpM); fo.setMatrixAt(i, tmpM);
          const v = 0.8 + rnd() * 0.35;
          fo.setColorAt(i, col.setRGB(v * (0.92 + rnd() * 0.1), v, v * (0.85 + rnd() * 0.15)));
        });
        for (const m of [tr, fo]) { m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere(); scene.add(m); objs.push(m); }
      });
    }
    return {
      objs,
      update(cam, maxD) {
        for (const o of objs) { const bs = o.boundingSphere; o.visible = Math.hypot(bs.center.x - cam.x, bs.center.z - cam.z) - bs.radius < maxD; }
      },
      dispose() { objs.forEach(o => { scene.remove(o); o.dispose(); }); },
    };
  }

  // ---------- 岩石：扫描模型，可以放大当大石头和小山崖 ----------
  const ROCKS = [
    { key: 'glb/rock_large/r1_lod0', tex: 'rock_large', size: [2.238, 1.473, 3.369] },
    { key: 'glb/rock_large/r2_lod0', tex: 'rock_large', size: [2.2, 1.6, 2.6] },
    { key: 'glb/rock_large/r3_lod0', tex: 'rock_large', size: [2.0, 1.3, 2.4] },
    { key: 'glb/rock_large/r5_lod0', tex: 'rock_large', size: [2.0, 1.8, 2.0] },
    { key: 'glb/rock_medium/r8_lod0', tex: 'rock_medium', size: [1.0, 0.7, 1.0] },
    { key: 'glb/rock_medium/r9_lod0', tex: 'rock_medium', size: [1.0, 0.7, 1.0] },
    { key: 'glb/rock_medium/r10_lod0', tex: 'rock_medium', size: [1.0, 0.7, 1.0] },
    { key: 'glb/rock_medium/r12_lod0', tex: 'rock_medium', size: [1.0, 0.7, 1.0] },
  ];
  async function makeRocks(scene, terrain, phys, list, opts) {
    // list: [{x, z, s, v, r, sink, tilt}]
    const by = {};
    for (const r of list) (by[r.v] || (by[r.v] = [])).push(r);
    const out = [];
    for (const v in by) {
      const R = ROCKS[v];
      const mesh = await A().glbMesh(R.key);
      if (!mesh) continue;
      const g = mesh.geometry;
      g.computeBoundingBox();
      const bb = g.boundingBox, sz = bb.getSize(new THREE.Vector3());
      const mat = new THREE.MeshStandardMaterial({
        map: A().tex(`tex/${R.tex}/diff`, { srgb: true }), normalMap: A().tex(`tex/${R.tex}/nor`),
        roughnessMap: A().tex(`tex/${R.tex}/arm`), aoMap: A().tex(`tex/${R.tex}/arm`), roughness: 1, color: opts && opts.tint ? opts.tint : 0xffffff,
      });
      const items = by[v];
      const im = new THREE.InstancedMesh(g, mat, items.length);
      items.forEach((r, i) => {
        const y = terrain.heightAt(r.x, r.z);
        tmpE.set((r.tilt || 0) * (Math.sin(i * 7.1)), r.r != null ? r.r : i * 2.4, (r.tilt || 0) * Math.cos(i * 3.3));
        tmpQ.setFromEuler(tmpE);
        tmpS.set(r.s, r.s * (r.sy || 1), r.s);
        tmpM.compose(tmpP.set(r.x, y - (r.sink != null ? r.sink : 0.15) * r.s * sz.y, r.z), tmpQ, tmpS);
        im.setMatrixAt(i, tmpM);
        if (phys && r.s * Math.min(sz.x, sz.z) > 0.7 && !r.noCol) {
          const rad = Math.min(sz.x, sz.z) * 0.42 * r.s;
          phys.cyl(r.x, r.z, y - 2, sz.y * r.s * (r.sy || 1) * 0.8 + 2 - (r.sink != null ? r.sink : 0.15) * r.s * sz.y, rad, 'rock');
        }
      });
      im.castShadow = true; im.receiveShadow = true;
      im.computeBoundingSphere();
      scene.add(im);
      out.push(im);
    }
    return { objs: out, dispose() { out.forEach(o => { scene.remove(o); o.dispose(); }); } };
  }

  // ---------- 小物件：枯树枝、树桩（扫描模型） ----------
  async function makeProps(scene, terrain, phys, list) {
    const groups = {};
    for (const p of list) (groups[p.key] || (groups[p.key] = [])).push(p);
    const out = [];
    for (const key in groups) {
      const items = groups[key];
      const tex = items[0].tex;
      const mesh = await A().glbMesh(key);
      if (!mesh) continue;
      let mat = mesh.material;
      if (tex) mat = new THREE.MeshStandardMaterial({ map: A().tex(`tex/${tex}/diff`, { srgb: true }), normalMap: A().tex(`tex/${tex}/nor`), roughnessMap: A().tex(`tex/${tex}/arm`), roughness: 1, alphaTest: 0.4, side: THREE.DoubleSide });
      const im = new THREE.InstancedMesh(mesh.geometry, mat, items.length);
      items.forEach((p, i) => {
        tmpQ.setFromAxisAngle(up, p.r || 0);
        tmpS.setScalar(p.s || 1);
        tmpM.compose(tmpP.set(p.x, terrain.heightAt(p.x, p.z) + (p.y || 0), p.z), tmpQ, tmpS);
        im.setMatrixAt(i, tmpM);
        if (phys && p.col) phys.cyl(p.x, p.z, terrain.heightAt(p.x, p.z) - 1, p.col[1] + 1, p.col[0], 'prop');
      });
      im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere();
      scene.add(im); out.push(im);
    }
    return { objs: out, dispose() { out.forEach(o => { scene.remove(o); o.dispose(); }); } };
  }

  window.TSFlora = { makeCarpet, makeForest, makeRocks, makeProps, ROCKS, windUni, hash };
})();
