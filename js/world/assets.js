// 素材管理：assets/*.js 里是 base64 的图片、模型和天空（Poly Haven CC0）
(function () {
  'use strict';
  const packs = () => (window.ASSET_PACKS = window.ASSET_PACKS || {});
  const loading = {};
  function loadPack(name) {
    if (packs()[name]) return Promise.resolve();
    if (loading[name]) return loading[name];
    loading[name] = new Promise((res) => {
      const s = document.createElement('script');
      s.src = (window.TS_ASSET_BASE || '') + 'assets/' + name + '.js';
      s.onload = () => res();
      s.onerror = () => { console.warn('素材包加载失败', name); res(); };
      document.head.appendChild(s);
    });
    return loading[name];
  }
  function uri(key) {
    const P = packs();
    for (const k in P) if (P[k][key]) return P[k][key];
    return null;
  }
  const has = key => !!uri(key);
  const imgCache = {}, texCache = {};
  function image(key) {
    if (imgCache[key]) return imgCache[key];
    const u = uri(key);
    if (!u) return null;
    const im = new Image();
    im.decoding = 'async';
    im.src = u;
    imgCache[key] = im;
    return im;
  }
  let maxAniso = 8;
  // 取一张贴图（同一个 key + 设置只建一次）
  function tex(key, o) {
    o = o || {};
    const ck = key + '|' + (o.srgb ? 1 : 0) + '|' + (o.rep || '');
    if (texCache[ck]) return texCache[ck];
    const im = image(key);
    if (!im) return null;
    const t = new THREE.Texture(im);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = o.aniso || maxAniso;
    if (o.srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (o.rep) t.repeat.set(o.rep[0], o.rep[1]);
    const up = () => { t.needsUpdate = true; };
    if (im.complete && im.naturalWidth) up(); else im.addEventListener('load', up, { once: true });
    texCache[ck] = t;
    return t;
  }
  // 等图片都解码完（开局前调用，避免第一帧是黑的）
  function ready() {
    const ims = Object.values(imgCache).filter(im => !(im.complete && im.naturalWidth));
    return Promise.all(ims.map(im => (im.decode ? im.decode().catch(() => {}) : new Promise(r => { im.onload = im.onerror = r; }))));
  }
  function bin(key) {
    const u = uri(key);
    if (!u) return null;
    const b64 = u.slice(u.indexOf(',') + 1);
    const s = atob(b64), a = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a.buffer;
  }
  function json(key) { const b = bin(key); return b ? JSON.parse(new TextDecoder().decode(b)) : null; }
  const glbCache = {};
  function glb(key) {
    if (glbCache[key]) return glbCache[key];
    const b = bin(key);
    if (!b) return Promise.resolve(null);
    glbCache[key] = new Promise((res) => {
      try { new THREE.GLTFLoader().parse(b, '', g => res(g), e => { console.warn(key, e); res(null); }); }
      catch (e) { console.warn(key, e); res(null); }
    });
    return glbCache[key];
  }
  // 取模型里的第一个网格（几何体合并成一个）
  async function glbMesh(key) {
    const g = await glb(key);
    if (!g) return null;
    let mesh = null;
    g.scene.updateMatrixWorld(true);
    g.scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
    if (!mesh) return null;
    // 把节点的位置 / 旋转 / 缩放烘进几何体
    if (!mesh.userData.baked) { mesh.geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld); mesh.userData.baked = true; }
    return mesh;
  }
  // 标准 PBR 材质：颜色 + 法线 + ARM（AO / 粗糙度 / 金属度）
  const matCache = {};
  function pbr(name, o) {
    o = o || {};
    const ck = name + JSON.stringify(o);
    if (matCache[ck]) return matCache[ck];
    const rep = o.rep || null;
    const m = new THREE.MeshStandardMaterial({
      map: tex(`tex/${name}/diff`, { srgb: true, rep }),
      normalMap: tex(`tex/${name}/nor`, { rep }),
      roughness: o.roughness != null ? o.roughness : 1,
      metalness: o.metal || 0,
      color: o.color != null ? o.color : 0xffffff,
    });
    const arm = tex(`tex/${name}/arm`, { rep });
    if (arm && o.arm !== false) { m.roughnessMap = arm; m.aoMap = arm; m.aoMapIntensity = o.ao != null ? o.ao : 1; if (o.metal) m.metalnessMap = arm; }
    if (o.ns) m.normalScale.set(o.ns, o.ns);
    if (o.side) m.side = o.side;
    matCache[ck] = m;
    return m;
  }
    // 整个模型（多个零件），复制一份用来摆放
  async function model(key) {
    const g = await glb(key);
    if (!g) return null;
    const o = g.scene.clone(true);
    o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    return o;
  }
  window.TSAssets = { loadPack, has, image, tex, ready, bin, json, glb, glbMesh, model, pbr, setAniso(a) { maxAniso = a; } };
})();
