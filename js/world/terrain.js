// 大地形：1.6 公里见方的高度图，分成 100 米一块，近处细、远处粗（LOD）
// 材质：4 层真实照片 PBR（颜色 + 法线），按混合图、坡度和“高度”自然过渡，悬崖用三向投影不拉伸
(function () {
  'use strict';
  const S = THREE.MathUtils.smoothstep;

  function create(opts) {
    const size = opts.size, half = size / 2, res = opts.res;     // res 个格子
    const cell = size / res, V = res + 1;
    const H = new Float32Array(V * V);
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) H[j * V + i] = opts.height(-half + i * cell, -half + j * cell);
    if (opts.post) opts.post(H, V, cell, half);

    function heightAt(x, z) {
      let fx = (x + half) / cell, fz = (z + half) / cell;
      if (fx < 0 || fz < 0 || fx > res || fz > res) return opts.far ? opts.far(x, z) : 0;
      let i = Math.floor(fx), j = Math.floor(fz);
      if (i >= res) i = res - 1; if (j >= res) j = res - 1;
      const u = fx - i, v = fz - j, k = j * V + i;
      const a = H[k], b = H[k + 1], c = H[k + V], d = H[k + V + 1];
      // 两个三角形插值（和画出来的网格完全一致）
      return u + v < 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
    }
    function hIdx(i, j) { i = i < 0 ? 0 : i > res ? res : i; j = j < 0 ? 0 : j > res ? res : j; return H[j * V + i]; }
    function normalAt(x, z, out) {
      const e = cell;
      const hl = heightAt(x - e, z), hr = heightAt(x + e, z), hd = heightAt(x, z - e), hu = heightAt(x, z + e);
      return out.set(hl - hr, 2 * e, hd - hu).normalize();
    }

    // ---------- 混合图（每个像素 4 层的权重）和光照图（远处的山影 + 角落变暗） ----------
    const TS = opts.texRes || 512, tcell = size / TS;
    const splat = new Uint8Array(TS * TS * 4), light = new Uint8Array(TS * TS * 4);
    const sd = opts.sunDir;
    const sl = Math.hypot(sd.x, sd.z), sx = sd.x / sl, sz = sd.z / sl, sTan = sd.y / sl;
    const nTmp = new THREE.Vector3();
    for (let j = 0; j < TS; j++) for (let i = 0; i < TS; i++) {
      const x = -half + (i + 0.5) * tcell, z = -half + (j + 0.5) * tcell;
      const h = heightAt(x, z);
      normalAt(x, z, nTmp);
      const w = opts.splat(x, z, h, 1 - nTmp.y);
      const k = (j * TS + i) * 4;
      splat[k] = w[0] * 255; splat[k + 1] = w[1] * 255; splat[k + 2] = w[2] * 255; splat[k + 3] = w[3] * 255;
      // 太阳方向上有没有山挡住
      let sun = 1, t = 3;
      for (let s = 0; s < 64 && t < 900; s++) {
        const hh = heightAt(x + sx * t, z + sz * t) - (h + 0.5 + t * sTan);
        if (hh > 0) { sun = Math.max(0, 1 - hh / 3) * sun; if (sun <= 0) break; }
        t *= 1.09; t += 1.5;
      }
      // 凹进去的地方环境光少一点
      let cav = 0;
      for (const r of [6, 18, 45]) {
        const avg = (heightAt(x + r, z) + heightAt(x - r, z) + heightAt(x, z + r) + heightAt(x, z - r) + heightAt(x + r * 0.7, z + r * 0.7) + heightAt(x - r * 0.7, z - r * 0.7) + heightAt(x + r * 0.7, z - r * 0.7) + heightAt(x - r * 0.7, z + r * 0.7)) / 8;
        cav += Math.max(-1, Math.min(1, (h - avg) / (r * 0.35))) * (r === 6 ? 0.45 : r === 18 ? 0.35 : 0.2);
      }
      const ao = Math.max(0.45, Math.min(1, 0.86 + cav * 0.35));
      light[k] = sun * 255; light[k + 1] = ao * 255; light[k + 2] = (opts.wet ? opts.wet(x, z, h) : 0) * 255; light[k + 3] = 255;
    }
    function dataTex(arr) {
      const t = new THREE.DataTexture(arr, TS, TS, THREE.RGBAFormat);
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
      return t;
    }
    const tSplat = dataTex(splat), tLight = dataTex(light);
    function splatAt(x, z) {
      const i = Math.max(0, Math.min(TS - 1, Math.floor((x + half) / tcell))), j = Math.max(0, Math.min(TS - 1, Math.floor((z + half) / tcell)));
      const k = (j * TS + i) * 4;
      return [splat[k] / 255, splat[k + 1] / 255, splat[k + 2] / 255, splat[k + 3] / 255, light[k] / 255];
    }

    // ---------- 材质 ----------
    const L = opts.layers; // [{name, scale, rough, ns}] x4，第 3 层（下标 2）是岩石
    const A = TSAssets;
    const uni = {
      tSplat: { value: tSplat }, tLight: { value: tLight },
      uSize: { value: size }, uHalf: { value: half },
      uScale: { value: new THREE.Vector4(L[0].scale, L[1].scale, L[2].scale, L[3].scale) },
      uRough: { value: new THREE.Vector4(L[0].rough, L[1].rough, L[2].rough, L[3].rough) },
      uNs: { value: new THREE.Vector4(L[0].ns || 1, L[1].ns || 1, L[2].ns || 1, L[3].ns || 1) },
      uTint0: { value: new THREE.Color(L[0].tint || 0xffffff) }, uTint1: { value: new THREE.Color(L[1].tint || 0xffffff) },
      uTint2: { value: new THREE.Color(L[2].tint || 0xffffff) }, uTint3: { value: new THREE.Color(L[3].tint || 0xffffff) },
      uWet: { value: opts.wetColor || new THREE.Color(0x6b6250) },
    };
    for (let i = 0; i < 4; i++) {
      uni['tD' + i] = { value: A.tex(`tex/${L[i].name}/diff`, { srgb: true }) };
      uni['tN' + i] = { value: A.tex(`tex/${L[i].name}/nor`) };
    }
    const quality = opts.quality || 'high';
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    mat.defines = { TQ: quality === 'high' ? 2 : quality === 'medium' ? 1 : 0 };
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vW; varying vec3 vWN;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vW; varying vec3 vWN;
          uniform sampler2D tSplat, tLight, tD0, tD1, tD2, tD3, tN0, tN1, tN2, tN3;
          uniform float uSize, uHalf; uniform vec4 uScale, uRough, uNs;
          uniform vec3 uTint0, uTint1, uTint2, uTint3, uWet;
          float th(vec2 p) { p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
          float tn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(th(i), th(i + vec2(1, 0)), f.x), mix(th(i + vec2(0, 1)), th(i + vec2(1, 1)), f.x), f.y); }
          const mat2 ROT = mat2(0.7986, 0.6018, -0.6018, 0.7986);
          // 一层材质：同一张照片按两种大小、转个角度铺两遍，用噪声混起来，看不出重复
          void layerXZ(sampler2D d, sampler2D n, vec2 p, float s, float k, float far, out vec4 col, out vec2 bump) {
            vec2 u1 = p / s;
            vec4 c1 = texture2D(d, u1); vec3 n1 = texture2D(n, u1).xyz * 2.0 - 1.0;
            #if TQ > 0
              vec2 u2 = ROT * p / (s * 3.1) + 0.37;
              vec4 c2 = texture2D(d, u2); vec3 n2 = texture2D(n, u2).xyz * 2.0 - 1.0;
              n2.xy = n2.xy * ROT;
              float m = clamp(k + far, 0.0, 1.0);
              col = mix(c1, c2, m); bump = mix(n1.xy, n2.xy * 0.7, m);
            #else
              col = c1; bump = n1.xy;
            #endif
          }`)
        .replace('#include <map_fragment>', `
          vec2 suv = (vW.xz + uHalf) / uSize;
          vec4 sp = texture2D(tSplat, suv);
          vec4 lm = texture2D(tLight, suv);
          vec3 N = normalize(vWN);
          float slope = 1.0 - N.y;
          float outside = 1.0 - step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
          if (outside > 0.5) { sp = vec4(0.35, 0.65, 0.0, 0.0); lm = vec4(1.0, 0.9, 0.0, 1.0); }
          float dist = length(vW - cameraPosition);
          float far = smoothstep(25.0, 90.0, dist);
          float k = smoothstep(0.35, 0.65, tn(vW.xz * 0.045) * 0.65 + tn(vW.xz * 0.21) * 0.35);
          vec4 c0, c1, c2, c3; vec2 b0, b1, b2, b3;
          layerXZ(tD0, tN0, vW.xz, uScale.x, k, far, c0, b0);
          layerXZ(tD1, tN1, vW.xz, uScale.y, k, far, c1, b1);
          layerXZ(tD3, tN3, vW.xz, uScale.w, k, far, c3, b3);
          // 岩石：坡越陡越多，三向投影（悬崖上不会拉伸）
          vec3 tw = pow(abs(N), vec3(4.0)); tw /= (tw.x + tw.y + tw.z);
          #if TQ > 1
            vec2 ua = vW.zy / uScale.z, ub = vW.xy / uScale.z, uc = vW.xz / uScale.z;
            c2 = texture2D(tD2, ua) * tw.x + texture2D(tD2, ub) * tw.z + texture2D(tD2, uc) * tw.y;
            vec3 na = texture2D(tN2, ua).xyz * 2.0 - 1.0, nb = texture2D(tN2, ub).xyz * 2.0 - 1.0, nc = texture2D(tN2, uc).xyz * 2.0 - 1.0;
            vec3 rockN = vec3(0.0, na.y, na.x) * tw.x + vec3(nb.x, nb.y, 0.0) * tw.z + vec3(nc.x, 0.0, nc.y) * tw.y;
          #else
            layerXZ(tD2, tN2, vW.xz, uScale.z, k, far, c2, b2);
            vec3 rockN = vec3(b2.x, 0.0, b2.y);
          #endif
          float rockS = smoothstep(0.22, 0.42, slope + (tn(vW.xz * 0.15) - 0.5) * 0.12);
          vec4 w = vec4(sp.r, sp.g, max(sp.b, rockS), sp.a);
          w.xyw *= 1.0 - rockS;
          w = max(w, vec4(0.0)) + 0.001;
          // 按照片的明暗当作“高度”来混：石缝里先露出泥土，边缘不会糊成一片
          vec4 hgt = vec4(dot(c0.rgb, vec3(0.33)), dot(c1.rgb, vec3(0.33)), dot(c2.rgb, vec3(0.33)), dot(c3.rgb, vec3(0.33)));
          vec4 hw = w + hgt * 0.35;
          float hm = max(max(hw.x, hw.y), max(hw.z, hw.w)) - 0.18;
          w = max(hw - hm, vec4(0.0)) * w;
          w /= (w.x + w.y + w.z + w.w + 1e-5);
          vec3 col = c0.rgb * uTint0 * w.x + c1.rgb * uTint1 * w.y + c2.rgb * uTint2 * w.z + c3.rgb * uTint3 * w.w;
          // 大片的颜色深浅变化（远处看不出格子）
          float macro = tn(vW.xz * 0.011) * 0.6 + tn(vW.xz * 0.037) * 0.4;
          col *= mix(0.78, 1.14, macro);
          // 湿的地方（河边、路上的水坑）更暗
          col = mix(col, col * uWet * 1.6, lm.b * 0.6);
          diffuseColor.rgb *= col;
          vec2 bump = b0 * uNs.x * w.x + b1 * uNs.y * w.y + b3 * uNs.w * w.w;
          vec3 nW = normalize(N + vec3(bump.x, 0.0, bump.y) * (1.0 - far * 0.5) + rockN * uNs.z * w.z);
          float tRough = clamp(dot(w, uRough) * mix(1.12, 0.88, dot(col, vec3(0.5))) - lm.b * 0.45, 0.05, 1.0);
          float tAO = lm.g * mix(1.0, 0.75 + 0.25 * smoothstep(0.0, 0.45, dot(col, vec3(0.6))), 1.0 - far);
          float tSun = mix(1.0, lm.r, 1.0);`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);')
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
          reflectedLight.indirectDiffuse *= tAO; reflectedLight.indirectSpecular *= tAO;
          reflectedLight.directDiffuse *= tSun; reflectedLight.directSpecular *= tSun;`);
    };
    mat.customProgramCacheKey = () => 'terrain' + quality;

    // ---------- 分块网格 ----------
    const CH = opts.chunk || 100, NC = Math.round(size / CH), SEG = [64, 32, 16, 8];
    const group = new THREE.Group();
    group.name = 'terrain';
    const chunks = [];
    const nrm = new THREE.Vector3();
    function buildGeo(ci, cj, lod) {
      const n = SEG[lod], st = CH / n;
      const x0 = -half + ci * CH, z0 = -half + cj * CH;
      const nv = (n + 1) * (n + 1) + 4 * (n + 1);
      const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
      let v = 0;
      const put = (x, y, z) => {
        pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
        normalAt(x, z, nrm);
        nor[v * 3] = nrm.x; nor[v * 3 + 1] = nrm.y; nor[v * 3 + 2] = nrm.z;
        return v++;
      };
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const x = x0 + i * st, z = z0 + j * st; put(x, heightAt(x, z), z); }
      const idx = [];
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      // 裙边：每块四周往下垂 4 米，相邻块精度不一样时也看不到缝
      const top = [], bot = [], lef = [], rig = [];
      for (let i = 0; i <= n; i++) { top.push(i); rig.push(i * (n + 1) + n); bot.push(n * (n + 1) + n - i); lef.push((n - i) * (n + 1)); }
      for (const s of [top, rig, bot, lef]) {
        const b = v;
        for (const k of s) put(pos[k * 3], pos[k * 3 + 1] - 4, pos[k * 3 + 2]);
        for (let q = 0; q < n; q++) { const a0 = s[q], a1 = s[q + 1], s0 = b + q, s1 = b + q + 1; idx.push(a0, s0, a1, a1, s0, s1, a0, a1, s0, a1, s1, s0); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos.slice(0, v * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor.slice(0, v * 3), 3));
      g.setIndex(idx);
      g.computeBoundingSphere(); g.computeBoundingBox();
      return g;
    }
    for (let cj = 0; cj < NC; cj++) for (let ci = 0; ci < NC; ci++) {
      const c = { ci, cj, cx: -half + (ci + 0.5) * CH, cz: -half + (cj + 0.5) * CH, geos: [], lod: -1, mesh: new THREE.Mesh(undefined, mat) };
      c.mesh.receiveShadow = true;
      c.mesh.castShadow = false;
      c.mesh.matrixAutoUpdate = false;
      c.geos[3] = buildGeo(ci, cj, 3);
      c.mesh.geometry = c.geos[3]; c.lod = 3;
      group.add(c.mesh);
      chunks.push(c);
    }
    let lodD = opts.lodDist || [150, 330, 650];
    let budget = 0;
    function update(cam) {
      budget = 3; // 每帧最多新建 3 块，避免卡顿
      for (const c of chunks) {
        const d = Math.hypot(cam.x - c.cx, cam.z - c.cz) - CH * 0.5;
        const want = d < lodD[0] ? 0 : d < lodD[1] ? 1 : d < lodD[2] ? 2 : 3;
        if (want === c.lod) continue;
        if (!c.geos[want]) { if (budget <= 0) continue; budget--; c.geos[want] = buildGeo(c.ci, c.cj, want); }
        c.mesh.geometry = c.geos[want]; c.lod = want;
      }
    }
    // 先把出生点附近的块建好
    function warm(x, z) { for (let k = 0; k < 40; k++) update({ x, z }); }

    // ---------- 远处的山（地图外面，一圈低精度的网格） ----------
    if (opts.far) {
      const R = opts.farRadius || 6000, nr = 40, na = 96;
      const pos = [], nor = [], idx = [];
      const rings = [];
      for (let r = 0; r <= nr; r++) rings.push(half * 0.98 + (R - half) * Math.pow(r / nr, 1.6));
      for (let r = 0; r <= nr; r++) for (let a = 0; a < na; a++) {
        const ang = a / na * Math.PI * 2;
        // 方形到圆形：内圈贴着地图的方形边
        const cx = Math.cos(ang), cz = Math.sin(ang);
        const sq = 1 / Math.max(Math.abs(cx), Math.abs(cz));
        const k = r / nr, rr = rings[r];
        const m = THREE.MathUtils.lerp(sq * rr, rr * 1.0, Math.min(1, k * 3));
        const x = cx * m, z = cz * m;
        pos.push(x, opts.far(x, z) - (r === 0 ? 6 : 0), z);
      }
      for (let r = 0; r < nr; r++) for (let a = 0; a < na; a++) {
        const i0 = r * na + a, i1 = r * na + (a + 1) % na, i2 = i0 + na, i3 = i1 + na;
        idx.push(i0, i2, i1, i1, i2, i3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const fm = new THREE.Mesh(g, mat);
      fm.receiveShadow = false;
      group.add(fm);
    }

    return { size, half, res, cell, H, heightAt, normalAt, splatAt, group, material: mat, update, warm, uniforms: uni, setLod(d) { lodD = d; } };
  }
  window.TSTerrain = { create };
})();
