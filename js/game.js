// 雷霆特战队 —— 军事题材第一人称射击（Three.js）
// 大地图版：三张 1.6 公里见方的地图（地形、树林、建筑在 js/world/ 里），15 个关卡
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
  if (isTouch) document.body.classList.add('touch');

  // ================= 渲染器 / 场景 =================
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.autoClear = false;
  $('game').appendChild(renderer.domElement);
  const maxAniso = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
  TSAssets.setAniso && TSAssets.setAniso(Math.min(8, maxAniso));

  const scene = new THREE.Scene();
  const BASE_FOV = 75;
  const camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.08, 6500);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  // 太阳：方向跟着每一关的天空照片走（SUN_DIR 是天上太阳的位置，LIGHT_DIR 是投影子用的方向）
  const SUN_DIR = new THREE.Vector3(0.5, 0.5, -0.7).normalize();
  const LIGHT_DIR = SUN_DIR.clone();
  let envTex = null;
  const sun = new THREE.DirectionalLight(0xffe6c8, 3);
  scene.add(sun, sun.target);
  {
    const sc = sun.shadow.camera;
    sc.left = -64; sc.right = 64; sc.top = 64; sc.bottom = -64; sc.near = 1; sc.far = 900;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.05;
  }
  // 后期画面：体积光、泛光、雾、调色（js/fx.js）
  const fx = FX.create(renderer, { sun, sunDir: SUN_DIR, isTouch });
  window.__fx = fx;
  const flashLight = new THREE.PointLight(0xffc070, 0, 14, 2);
  scene.add(flashLight);
  // 夜里的战术手电（挂在枪上，跟着视线走）
  const torch = new THREE.SpotLight(0xfff2dc, 0, 90, 0.38, 0.55, 1.4);
  torch.position.set(0.25, -0.25, 0);
  torch.target.position.set(0, -0.6, -12);
  camera.add(torch, torch.target);
  let night = false;
  // ---------- 贴图（全部用画布现画，不需要图片文件） ----------
  function canvasTex(w, h, draw, rx, ry) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    if (rx) t.repeat.set(rx, ry || rx);
    return t;
  }
  // 真实照片材质（js/photos.js，Poly Haven CC0）：页面先把图片解码好，再启动游戏
  const PH = window.PHOTO_IMG || {};
  const hasPhoto = k => { const im = PH[k]; return !!(im && im.complete && im.naturalWidth > 0); };
  // 把照片画进画布，上面还能再画字、条纹；没有照片时退回原来的画法
  function photoTex(k, w, h, over, fallback, rx, ry) {
    return canvasTex(w, h, (g, W, H) => {
      if (hasPhoto(k)) { const tw = over && over.tile ? over.tile : 1; for (let i = 0; i < tw; i++) g.drawImage(PH[k], i * W / tw, 0, W / tw, H); }
      else fallback(g, W, H);
      if (over && over.draw) over.draw(g, W, H);
    }, rx, ry);
  }
  function photoNormal(k, rx, ry, fallback) {
    if (!hasPhoto(k + '_n')) return fallback || null;
    const t = new THREE.Texture(PH[k + '_n']);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    t.needsUpdate = true;
    if (rx) t.repeat.set(rx, ry || rx);
    return t;
  }
  function photoMap(k, rx, ry) {
    const t = new THREE.Texture(PH[k]);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    t.needsUpdate = true;
    if (rx) t.repeat.set(rx, ry || rx);
    return t;
  }
  // 用一张“高度图”算出法线贴图：让平面看起来有凹凸（木板缝、集装箱波纹、沙袋鼓包）
  function normalTex(w, h, drawHeight, strength, rx, ry) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    drawHeight(g, w, h);
    const src = g.getImageData(0, 0, w, h).data;
    const out = g.createImageData(w, h), o = out.data;
    const H = (x, y) => src[((((y + h) % h) * w) + ((x + w) % w)) * 4] / 255;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const nx = -(H(x + 1, y) - H(x - 1, y)) * strength, ny = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(nx, ny, 1), i = (y * w + x) * 4;
      o[i] = (nx / l * 0.5 + 0.5) * 255; o[i + 1] = (ny / l * 0.5 + 0.5) * 255; o[i + 2] = (1 / l * 0.5 + 0.5) * 255; o[i + 3] = 255;
    }
    g.putImageData(out, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    if (rx) t.repeat.set(rx, ry || rx);
    return t;
  }
  // 圆角盒子：边缘有一圈圆角，能接住高光，看起来不像“纸盒子”
  const rbCache = {};
  function roundBox(w, h, d, r, seg) {
    seg = seg || 2;
    const key = [w, h, d, r, seg].join('_');
    if (rbCache[key]) return rbCache[key];
    r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
    const n = seg * 2 + 1;
    const geo = new THREE.BoxGeometry(1, 1, 1, n, n, n);
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    const half = [w / 2, h / 2, d / 2];
    const p = [0, 0, 0], inner = [0, 0, 0];
    for (let i = 0; i < pos.count; i++) {
      for (let k = 0; k < 3; k++) {
        const v = pos.array[i * 3 + k], j = Math.round((v + 0.5) * n), hf = half[k];
        p[k] = j <= seg ? -hf + r * (j / seg) : hf - r * ((n - j) / seg);
        inner[k] = Math.max(-(hf - r), Math.min(hf - r, p[k]));
      }
      const dx = p[0] - inner[0], dy = p[1] - inner[1], dz = p[2] - inner[2], l = Math.hypot(dx, dy, dz);
      if (l > 1e-6) {
        pos.setXYZ(i, inner[0] + dx / l * r, inner[1] + dy / l * r, inner[2] + dz / l * r);
        nor.setXYZ(i, dx / l, dy / l, dz / l);
      } else pos.setXYZ(i, p[0], p[1], p[2]);
    }
    return (rbCache[key] = geo);
  }
  function speckle(g, w, h, n, cols, size) {
    for (let i = 0; i < n; i++) {
      g.fillStyle = cols[i % cols.length];
      const s = Math.random() * size + 1;
      g.fillRect(Math.random() * w, Math.random() * h, s, s);
    }
  }
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.8)');
    gr.addColorStop(0.55, 'rgba(255,255,255,0.25)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  // 烟雾/火焰用的云团纹理：多层噪声 + 圆形淡出，再加一点假的光照（上亮下暗）
  function cloudTex(seed, fire) {
    const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), img = g.createImageData(N, N), G = 64, grid = new Float32Array(G * G);
    for (let i = 0; i < G * G; i++) grid[i] = Math.random();
    const vn = (x, y) => {
      const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = grid[(y0 & 63) * G + (x0 & 63)], b = grid[(y0 & 63) * G + ((x0 + 1) & 63)], cc = grid[((y0 + 1) & 63) * G + (x0 & 63)], d = grid[((y0 + 1) & 63) * G + ((x0 + 1) & 63)];
      return a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy;
    };
    const fbm = (x, y) => { let v = 0, a = 0.5, f = 1; for (let o = 0; o < 5; o++) { v += vn(x * f + o * 17.3 + seed * 31, y * f + o * 9.1) * a; a *= 0.5; f *= 2.03; } return v; };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x / N * 6, v = y / N * 6, n = fbm(u, v);
      const dx = x / N - 0.5, dy = y / N - 0.5, r = Math.sqrt(dx * dx + dy * dy) * 2;
      const fall = Math.max(0, 1 - r * r) ** 1.4;
      const a = Math.max(0, Math.min(1, (n * 1.9 - 0.55 + fall * 0.55))) * fall;
      const i = (y * N + x) * 4;
      if (fire) {
        const h = Math.min(1, n * 1.3 * fall + fall * 0.5);
        img.data[i] = 255; img.data[i + 1] = 120 + h * 135 | 0; img.data[i + 2] = 40 + h * h * 200 | 0;
      } else {
        const lit = Math.max(0, Math.min(1, 0.62 + (fbm(u + 0.35, v + 0.45) - n) * 1.6 - dy * 0.55));
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 150 + lit * 105 | 0;
      }
      img.data[i + 3] = a * 255 | 0;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const smokeTexs = [0, 1, 2, 3].map(i => cloudTex(i, false));
  const fireTexs = [4, 5].map(i => cloudTex(i, true));
  // 枪口火焰：正面是星形火花，侧面是喷出去的火舌
  const flashStarTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.translate(64, 64); g.globalCompositeOperation = 'lighter';
    const n = 7;
    for (let i = 0; i < n; i++) {
      g.save(); g.rotate(i / n * Math.PI * 2 + Math.random() * 0.4);
      const l = rand(38, 62), wd = rand(5, 9), gr = g.createLinearGradient(0, 0, l, 0);
      gr.addColorStop(0, 'rgba(255,240,200,0.9)'); gr.addColorStop(0.5, 'rgba(255,170,60,0.55)'); gr.addColorStop(1, 'rgba(255,100,20,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(0, -wd); g.quadraticCurveTo(l * 0.5, -wd * 0.4, l, 0); g.quadraticCurveTo(l * 0.5, wd * 0.4, 0, wd); g.fill();
      g.restore();
    }
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 34);
    gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(0.35, 'rgba(255,200,110,0.8)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 34, 0, 7); g.fill();
    return new THREE.CanvasTexture(c);
  })();
  const flashSideTex = (() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 128;
    const g = c.getContext('2d'); g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 3; k++) {
      const top = rand(5, 40), wd = rand(10, 22), gr = g.createLinearGradient(0, 128, 0, top);
      gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.3, 'rgba(255,190,90,0.8)'); gr.addColorStop(1, 'rgba(255,90,10,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(32 - wd, 128); g.quadraticCurveTo(32 - wd * 0.7, 60, 32 + rand(-8, 8), top); g.quadraticCurveTo(32 + wd * 0.7, 60, 32 + wd, 128); g.fill();
    }
    return new THREE.CanvasTexture(c);
  })();
  const sandTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#d6b27a'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 2600, ['#c9a46c', '#e2c290', '#bf9960', '#e9cc9c'], 2.5);
    g.strokeStyle = 'rgba(160,120,70,0.18)'; g.lineWidth = 3;
    for (let i = 0; i < 6; i++) { g.beginPath(); const y = Math.random() * h; g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 14, w * 0.6, y - 14, w, y); g.stroke(); }
  }, 70);
  const roadTex = photoTex('asphalt', 512, 256, {
    tile: 2,
    draw(g, w, h) {
      // 褪色的黄线，边上有沙子盖住
      g.fillStyle = 'rgba(214,180,70,0.85)'; g.fillRect(w / 2 - 5, 0, 10, h * 0.55);
      const gr = g.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, 'rgba(196,160,110,0.75)'); gr.addColorStop(0.12, 'rgba(196,160,110,0)'); gr.addColorStop(0.88, 'rgba(196,160,110,0)'); gr.addColorStop(1, 'rgba(196,160,110,0.75)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    },
  }, (g, w, h) => {
    g.fillStyle = '#6e6658'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 900, ['#5e5749', '#7d7566', '#686052'], 2);
  }, 1, 24);
  const crateTex = hasPhoto('planks') ? photoTex('planks', 256, 256, {
    draw(g, w, h) {
      // 箱子的边框和斜撑：同一种木头，颜色深一点
      g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = 'rgb(150,120,95)';
      const b = 24;
      g.fillRect(0, 0, w, b); g.fillRect(0, h - b, w, b); g.fillRect(0, 0, b, h); g.fillRect(w - b, 0, b, h);
      g.lineWidth = b; g.strokeStyle = 'rgb(160,130,100)'; g.beginPath(); g.moveTo(16, 16); g.lineTo(w - 16, h - 16); g.stroke();
      g.restore();
      g.fillStyle = 'rgba(30,20,10,0.55)'; for (const [x, y] of [[12, 12], [w - 12, 12], [12, h - 12], [w - 12, h - 12]]) { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
      g.fillStyle = 'rgba(25,20,15,0.6)'; g.font = 'bold 22px monospace'; g.textAlign = 'center'; g.fillText('7.62 AMMO', w * 0.5, h * 0.28);
    },
  }) : canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#a5743f'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#7a5129'; g.lineWidth = 3;
    for (let y = 0; y < h; y += 21) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.fillStyle = '#6b4423';
    g.fillRect(0, 0, w, 12); g.fillRect(0, h - 12, w, 12); g.fillRect(0, 0, 12, h); g.fillRect(w - 12, 0, 12, h);
    g.lineWidth = 12; g.strokeStyle = '#6b4423';
    g.beginPath(); g.moveTo(8, 8); g.lineTo(w - 8, h - 8); g.stroke();
    speckle(g, w, h, 300, ['rgba(60,35,15,0.25)', 'rgba(255,220,170,0.15)'], 2);
  });
  function containerTex(base) {
    if (hasPhoto('container')) return canvasTex(512, 256, (g, w, h) => {
      // 真实的集装箱钢板照片染上颜色，再加锈迹、掉漆和喷字
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'multiply';
      g.drawImage(PH.container, 0, 0, w / 2, h); g.drawImage(PH.container, w / 2, 0, w / 2, h);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 0.35; g.fillStyle = base; g.fillRect(0, 0, w, h); g.globalAlpha = 1;
      for (let i = 0; i < 26; i++) {
        const x = Math.random() * w, l = rand(20, 110), gr = g.createLinearGradient(0, 0, 0, l);
        gr.addColorStop(0, 'rgba(110,55,20,0.55)'); gr.addColorStop(1, 'rgba(110,55,20,0)');
        g.fillStyle = gr; g.fillRect(x, 0, rand(2, 6), l);
      }
      for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${90 + Math.random() * 40 | 0},${50 + Math.random() * 20 | 0},25,${rand(0.2, 0.5)})`; g.beginPath(); g.ellipse(Math.random() * w, Math.random() < 0.6 ? rand(h - 40, h) : Math.random() * h, rand(2, 10), rand(1, 5), 0, 0, 7); g.fill(); }
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, w, 10); g.fillRect(0, h - 10, w, 10);
      g.fillStyle = 'rgba(240,236,225,0.7)'; g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.fillText('THUNDER CARGO', w / 2, 136);
      g.font = 'bold 15px monospace'; g.fillText('TSQU 207431 4  22G1', w / 2, 162);
    });
    return canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 12) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, 0, 4, h); g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(x + 5, 0, 2, h); }
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 0, w, 7); g.fillRect(0, h - 7, w, 7);
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = 'bold 22px sans-serif'; g.fillText('THUNDER CARGO', 26, 70);
      speckle(g, w, h, 500, ['rgba(90,50,20,0.25)', 'rgba(0,0,0,0.15)'], 3);
    });
  }
  const CONTAINER_TEX = ['#2f6b8f', '#a8432f', '#6b7a35', '#c48a2c'].map(containerTex);
  const concreteTex = hasPhoto('wall') ? photoTex('wall', 256, 256) : canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#b1aba0'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 1200, ['#a39d92', '#bdb7ac', '#979186'], 2);
    g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(0, 62, w, 3);
  });
  const barrierTex = canvasTex(256, 128, (g, w, h) => {
    if (hasPhoto('concrete')) { g.drawImage(PH.concrete, 0, 0, w / 2, h); g.drawImage(PH.concrete, w / 2, 0, w / 2, h); g.fillStyle = 'rgba(190,180,160,0.25)'; g.fillRect(0, 0, w, h); }
    else { g.fillStyle = '#b8b2a7'; g.fillRect(0, 0, w, h); speckle(g, w, h, 500, ['#a39d92', '#c6c0b5'], 2); }
    g.globalAlpha = 0.85;
    for (let x = -20; x < w; x += 24) { g.fillStyle = '#f0b429'; g.beginPath(); g.moveTo(x, h); g.lineTo(x + 12, h); g.lineTo(x + 24, h - 14); g.lineTo(x + 12, h - 14); g.fill(); }
    g.globalAlpha = 1;
    g.fillStyle = '#222'; g.fillRect(0, h - 14, w, 1);
    // 底部的泥土
    const gr = g.createLinearGradient(0, h, 0, h * 0.6); gr.addColorStop(0, 'rgba(120,95,60,0.6)'); gr.addColorStop(1, 'rgba(120,95,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const sandbagTex = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#7d6a45'; g.fillRect(0, 0, w, h);
    for (let r = 0; r < 4; r++) for (let c = -1; c < 5; c++) {
      const x = (c * 32 + (r % 2) * 16) * 2, y = r * 32;
      g.fillStyle = ['#d8c8a8', '#cdbd9a', '#e0d0b0'][(r + c + 3) % 3];
      g.beginPath(); g.ellipse(x + 32, y + 16, 30, 14, 0, 0, Math.PI * 2); g.fill();
    }
    if (hasPhoto('burlap')) {
      // 麻布的纹理
      g.globalCompositeOperation = 'multiply';
      for (let i = 0; i < 2; i++) g.drawImage(PH.burlap, i * w / 2, 0, w / 2, h);
      g.globalCompositeOperation = 'source-over';
    }
  });
  const barrelTex = canvasTex(256, 128, (g, w, h) => {
    if (hasPhoto('barrel')) { g.drawImage(PH.barrel, 0, 0, w / 2, h); g.drawImage(PH.barrel, w / 2, 0, w / 2, h); }
    else { g.fillStyle = '#c0392b'; g.fillRect(0, 0, w, h); }
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 24, w, 7); g.fillRect(0, h - 32, w, 7);
    g.fillStyle = 'rgba(255,210,63,0.85)'; g.font = 'bold 48px sans-serif'; g.fillText('⚠', 18, 86); g.fillText('⚠', 146, 86);
  });
  const helipadTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#4c4a44'; g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ffd23f'; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 108, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold 150px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('H', 128, 136);
  });
  const flagTex = canvasTex(128, 80, (g, w, h) => {
    g.fillStyle = '#2f6bd8'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffd23f';
    g.beginPath(); g.moveTo(74, 6); g.lineTo(44, 44); g.lineTo(62, 44); g.lineTo(50, 74); g.lineTo(86, 32); g.lineTo(68, 32); g.lineTo(80, 6); g.fill();
  });
  const medkitTex = canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e5484d'; g.fillRect(24, 10, 16, 44); g.fillRect(10, 24, 44, 16);
  });
  const ammoTex = canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = '#4f5d2f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffd23f'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.fillText('AMMO', 64, 43);
  });

  // ---------- 法线贴图（凹凸细节） ----------
  const fillH = (g, w, h, v) => { g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, 0, w, h); };
  const grain = (g, w, h, n, lo, hi, size) => { for (let i = 0; i < n; i++) { const v = (lo + Math.random() * (hi - lo)) | 0; g.fillStyle = `rgb(${v},${v},${v})`; const s = Math.random() * size + 1; g.fillRect(Math.random() * w, Math.random() * h, s, s); } };
  const crateN = normalTex(128, 128, (g, w, h) => {
    fillH(g, w, h, 120);
    for (let i = 0; i < 260; i++) { const v = 105 + Math.random() * 30 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * w, Math.random() * h, 10 + Math.random() * 30, 1); }
    g.fillStyle = '#202020'; for (let y = 0; y < h; y += 21) g.fillRect(0, y - 1, w, 3);
    g.fillStyle = '#e0e0e0'; g.fillRect(0, 0, w, 12); g.fillRect(0, h - 12, w, 12); g.fillRect(0, 0, 12, h); g.fillRect(w - 12, 0, 12, h);
    g.lineWidth = 12; g.strokeStyle = '#d0d0d0'; g.beginPath(); g.moveTo(8, 8); g.lineTo(w - 8, h - 8); g.stroke();
    g.fillStyle = '#fff'; for (const [x, y] of [[6, 6], [w - 6, 6], [6, h - 6], [w - 6, h - 6]]) { g.beginPath(); g.arc(x, y, 2.5, 0, 7); g.fill(); }
  }, 3.5);
  const containerN = normalTex(256, 128, (g, w, h) => {
    for (let x = 0; x < w; x++) { const ph = (x % 12) / 12, v = 128 + 90 * Math.sin(ph * Math.PI * 2) | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, h); }
    g.fillStyle = '#404040'; g.fillRect(0, 0, w, 7); g.fillRect(0, h - 7, w, 7);
    grain(g, w, h, 500, 90, 170, 2);
  }, 1.6);
  const sandbagN = normalTex(128, 64, (g, w, h) => {
    fillH(g, w, h, 0);
    for (let r = 0; r < 4; r++) for (let c = -1; c < 5; c++) {
      const x = c * 32 + (r % 2) * 16, y = r * 16;
      const gr = g.createRadialGradient(x + 16, y + 8, 1, x + 16, y + 8, 16);
      gr.addColorStop(0, '#fff'); gr.addColorStop(0.55, '#c8c8c8'); gr.addColorStop(1, '#000');
      g.save(); g.translate(x + 16, y + 8); g.scale(1, 0.5); g.translate(-x - 16, -y - 8);
      g.fillStyle = gr; g.beginPath(); g.arc(x + 16, y + 8, 15, 0, 7); g.fill(); g.restore();
    }
    grain(g, w, h, 900, 60, 200, 1.5);
  }, 2.2);
  const concreteN = normalTex(128, 128, (g, w, h) => {
    fillH(g, w, h, 140); grain(g, w, h, 1600, 80, 200, 2.2);
    g.fillStyle = '#303030'; g.fillRect(0, 62, w, 3);
  }, 1.2);
  // ================= 世界：地形、建筑、树林、碰撞（js/world/） =================
  let W = null;            // 当前地图
  const getW = () => W;    // 有些函数里 W 是“武器”，用这个拿地图
  let worldKey = '';
  let LIM = 770;           // 能走到的边界
  const gy = (x, z) => (W ? W.heightAt(x, z) : 0);
  const matCache = {};
  function stdMat(key, opts) { return matCache[key] || (matCache[key] = new THREE.MeshStandardMaterial(opts)); }
  function shadowify(o) { o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } }); return o; }
  // 碰撞：都交给 TSPhysics（地形高度 + 盒子 + 圆柱）
  function pushOut(p, r, feetY) { if (W) W.phys.pushOut(p, r, feetY == null ? p.y : feetY, 1.7); }
  function groundAt(x, z, r, feetY) { return W ? W.phys.groundAt(x, z, r, feetY) : 0; }
  function insideBox(p) { return W ? W.phys.inside(p) : null; }
  const noHit = { t: 0, ob: null, n: new THREE.Vector3(0, 1, 0), terrain: false };
  function rayObstacles(o, d, maxT) {
    if (!W) { noHit.t = maxT; return noHit; }
    return W.phys.ray(o, d, maxT);
  }
  function lineOfSight(a, b) { return W ? W.phys.los(a, b) : true; }
  function raySphere(o, d, c, r) {
    const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const cc = ox * ox + oy * oy + oz * oz - r * r;
    const disc = b * b - cc;
    if (disc < 0) return -1;
    const t = -b - Math.sqrt(disc);
    return t > 0 ? t : (cc < 0 ? 0.01 : -1);
  }
  function removeOb(o) {
    if (!o) return;
    if (W && !o.dead) W.phys.remove(o);
    o.dead = true;
    if (o.mesh && o.mesh.parent) o.mesh.parent.remove(o.mesh);
  }
  // 一个碰撞盒子（关卡里临时放的东西：笼子、炸药目标）
  function addOb(x, z, w, d, h, mesh, kind) {
    const y = gy(x, z);
    if (mesh) { mesh.position.set(x, y, z); shadowify(mesh); scene.add(mesh); }
    const o = W.phys.box(x, z, y - 0.5, h + 0.5, w / 2, d / 2, 0, kind || 'box', { mesh });
    return o;
  }

  // 画质 → 地图细节（树、草的数量，地形精度）
  function worldQuality() { return fx.tier === 'low' ? 'low' : fx.tier === 'medium' ? 'medium' : 'high'; }
  const loadEl = $('loading');
  function showLoading(on, text, k) {
    loadEl.classList.toggle('hidden', !on);
    if (text != null) $('loadText').textContent = text;
    if (k != null) $('loadFill').style.width = Math.round(k * 100) + '%';
  }
  let mapImg = null;
  async function ensureWorld(mapId, skyName) {
    const key = mapId + '|' + skyName + '|' + worldQuality();
    if (W && worldKey === key) return;
    const names = { valley: '松林山谷', town: '山间小镇', fort: '鹰巢要塞' };
    showLoading(true, `正在前往：${names[mapId]}…`, 0);
    await new Promise(r => setTimeout(r, 30));
    if (W) { W.dispose(); W = null; worldKey = ''; }
    W = await TSWorld.load(renderer, scene, mapId, {
      sky: skyName, quality: worldQuality(),
      onStep: (m, k) => showLoading(true, `正在前往：${names[mapId]}… ${m}`, k),
    });
    worldKey = key;
    LIM = W.bounds;
    const sky = W.sky;
    SUN_DIR.copy(sky.sunDir);
    LIGHT_DIR.copy(sky.lightDir);
    sun.color.copy(sky.sunColor);
    sun.intensity = sky.sunIntensity;
    fx.setAtmos({ fogColor: sky.fogColor, sunColor: sky.sunColor, fog: sky.P.fog, fall: 0.006, exposure: sky.exposure });
    envTex = sky.envTex;
    gunScene.environment = envTex;
    gunSun.color.copy(sky.sunColor);
    gunSun.intensity = clamp(sky.sunIntensity * 0.55, 0.35, 2.4);
    gunHemi.intensity = skyName === 'night' ? 0.15 : 0.5;
    night = skyName === 'night';
    torch.intensity = night ? 60 : 0;
    // 环境光贴图也给关卡里后加的东西（笼子、宝箱、敌人）用
    for (const k in matCache) matCache[k].envMapIntensity = sky.envIntensity;
    mapImg = null;
    showLoading(true, '准备出发…', 1);
  }

  // ---------- 大地图（按 M 或点 🗺 打开） ----------
  function buildMapImage() {
    const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), img = g.createImageData(N, N);
    const T = W.terrain, half = T.half;
    const L = new THREE.Vector3(-0.5, 0.75, -0.4).normalize();
    const nrm = new THREE.Vector3();
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -half + (i + 0.5) / N * T.size, z = -half + (j + 0.5) / N * T.size;
      const h = T.heightAt(x, z);
      T.normalAt(x, z, nrm);
      const s = W.terrain.splatAt(x, z);
      const shade = 0.55 + 0.6 * Math.max(0, nrm.dot(L));
      let r = 120 * s[0] + 96 * s[1] + 130 * s[2] + 70 * s[3], gg = 104 * s[0] + 124 * s[1] + 126 * s[2] + 92 * s[3], b = 80 * s[0] + 64 * s[1] + 118 * s[2] + 52 * s[3];
      if (W.map.lake && h < W.map.water) { r = 40; gg = 70; b = 92; }
      const k = (j * N + i) * 4;
      img.data[k] = r * shade; img.data[k + 1] = gg * shade; img.data[k + 2] = b * shade; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // 路
    g.strokeStyle = 'rgba(214,196,150,0.8)'; g.lineWidth = 2;
    for (const rd of W.map.roads) { g.beginPath(); rd.forEach(([x, z], i) => { const px = (x + half) / T.size * N, pz = (z + half) / T.size * N; if (i) g.lineTo(px, pz); else g.moveTo(px, pz); }); g.stroke(); }
    return c;
  }
  let mapOpen = false;
  function toggleMap(on) {
    mapOpen = on == null ? !mapOpen : on;
    $('bigmap').classList.toggle('hidden', !mapOpen);
    if (mapOpen) drawBigMap();
  }
  function drawBigMap() {
    if (!W) return;
    if (!mapImg) mapImg = buildMapImage();
    const cv = $('bigmapCanvas'), g = cv.getContext('2d');
    const S0 = cv.width, half = W.terrain.half, size = W.terrain.size;
    const P = (x, z) => [(x + half) / size * S0, (z + half) / size * S0];
    g.drawImage(mapImg, 0, 0, S0, S0);
    g.strokeStyle = 'rgba(255,80,60,0.5)'; g.lineWidth = 2; g.setLineDash([8, 6]);
    const [b0] = P(-LIM, 0), [b1] = P(LIM, 0); g.strokeRect(b0, b0, b1 - b0, b1 - b0); g.setLineDash([]);
    g.font = 'bold 22px sans-serif'; g.textAlign = 'center';
    const dot = (x, z, col, r, label) => { const [px, pz] = P(x, z); g.fillStyle = col; g.beginPath(); g.arc(px, pz, r, 0, 7); g.fill(); if (label) { g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 4; g.strokeText(label, px, pz - r - 6); g.fillText(label, px, pz - r - 6); } };
    for (const m of mapMarks()) dot(m[0], m[1], m[2], m[3], m[4]);
    // 玩家：带方向的箭头
    const [px, pz] = P(player.pos.x, player.pos.z);
    g.save(); g.translate(px, pz); g.rotate(-player.yaw);
    g.fillStyle = '#ffd23f'; g.strokeStyle = '#000'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, -16); g.lineTo(11, 12); g.lineTo(0, 6); g.lineTo(-11, 12); g.closePath(); g.stroke(); g.fill();
    g.restore();
  }
  // ================= 特效 =================
  function basicMat(color) {
    const k = 'b' + color;
    return matCache[k] || (matCache[k] = new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  }
  const spriteMatCache = {};
  function sharedGlowMat(color, op) {
    const k = color + '_' + op;
    return spriteMatCache[k] || (spriteMatCache[k] = new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: op, toneMapped: false }));
  }
  function glowSprite(color, size, opacity) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: opacity == null ? 0.9 : opacity, toneMapped: false }));
    s.scale.setScalar(size);
    return s;
  }
  const tmpC = new THREE.Color(), tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpV3 = new THREE.Vector3();

  // 火花粒子
  const P_N = 3000;
  const pPos = new Float32Array(P_N * 3), pCol = new Float32Array(P_N * 3), pVel = new Float32Array(P_N * 3);
  const pBase = new Float32Array(P_N * 3), pLife = new Float32Array(P_N), pMax = new Float32Array(P_N);
  let pIdx = 0;
  for (let i = 0; i < P_N; i++) pPos[i * 3 + 1] = -100;
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.45, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  particles.frustumCulled = false;
  scene.add(particles);
  // 空气里飘的细沙尘：朝着太阳看时会闪闪发光（像阳光里的灰尘）
  const DUST_N = isTouch ? 380 : 800;
  const dustUni = { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uSize: { value: 10 }, uSun: { value: SUN_DIR } };
  {
    const dp = new Float32Array(DUST_N * 3), ds = new Float32Array(DUST_N);
    for (let i = 0; i < DUST_N; i++) { dp[i * 3] = Math.random(); dp[i * 3 + 1] = Math.random(); dp[i * 3 + 2] = Math.random(); ds[i] = Math.random(); }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    dg.setAttribute('aSeed', new THREE.BufferAttribute(ds, 1));
    const dm = new THREE.ShaderMaterial({
      uniforms: dustUni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform vec3 uCam; uniform float uTime; uniform float uSize; uniform vec3 uSun;
        attribute float aSeed; varying float vA;
        void main() {
          vec2 xz = position.xz * 44.0 + vec2(1.4, 0.5) * uTime * (0.5 + aSeed);
          vec3 wp = vec3(uCam.x + mod(xz.x - uCam.x + 22.0, 44.0) - 22.0, position.y * position.y * 10.0 + 0.2 + sin(uTime * 0.8 + aSeed * 40.0) * 0.25, uCam.z + mod(xz.y - uCam.z + 22.0, 44.0) - 22.0);
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = -mv.z;
          vec3 vd = normalize(wp - cameraPosition);
          float fwd = pow(max(dot(vd, uSun), 0.0), 5.0);
          vA = (0.12 + fwd * 2.2) * smoothstep(22.0, 6.0, dist) * smoothstep(0.4, 1.5, dist) * (0.55 + 0.45 * sin(uTime * 2.3 + aSeed * 60.0));
          gl_PointSize = max(1.0, uSize * (0.5 + aSeed) / dist);
        }`,
      fragmentShader: `varying float vA;
        void main() { float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d) * vA; gl_FragColor = vec4(vec3(1.0, 0.82, 0.55) * a, 1.0); }`,
    });
    const dust = new THREE.Points(dg, dm);
    dust.frustumCulled = false;
    scene.add(dust);
  }
  function updateDust(dt) {
    dustUni.uTime.value += dt;
    dustUni.uCam.value.copy(camera.position);
    dustUni.uSize.value = renderer.domElement.height * 0.012;
  }
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
      const gh0 = gy(pPos[j], pPos[j + 2]) + 0.05; if (pPos[j + 1] < gh0) { pPos[j + 1] = gh0; pVel[j + 1] *= -0.4; }
      const f = pLife[i] / pMax[i];
      pCol[j] = pBase[j] * f; pCol[j + 1] = pBase[j + 1] * f; pCol[j + 2] = pBase[j + 2] * f;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
  }

  // 烟雾（普通混合）：真实一点的云团纹理，会慢慢转、慢慢变大、越飘越慢
  const smokes = [];
  for (let i = 0; i < 150; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTexs[i % 4], color: 0x8a8273, transparent: true, depthWrite: false, opacity: 0, fog: true }));
    s.visible = false; scene.add(s);
    smokes.push({ s, life: 0, max: 1, size: 1, vel: new THREE.Vector3(), op: 0.6, spin: 0, grow: 1.2, drag: 1 });
  }
  let smokeIdx = 0;
  function nextSmoke() { const p = smokes[smokeIdx]; smokeIdx = (smokeIdx + 1) % smokes.length; return p; }
  function puff(pos, n, size, color, life, spread) {
    for (let k = 0; k < n; k++) {
      const p = nextSmoke();
      const sp = spread == null ? size * 0.4 : spread;
      p.s.position.set(pos.x + rand(-sp, sp), pos.y + rand(-sp, sp) * 0.5, pos.z + rand(-sp, sp));
      p.s.material.color.set(color || 0x8a8273);
      p.vel.set(rand(-0.6, 0.6), rand(0.6, 1.6), rand(-0.6, 0.6));
      p.life = p.max = (life || 1.6) * rand(0.7, 1.2);
      p.size = size * rand(0.7, 1.2);
      p.op = color === 0xffffff ? 0.7 : 0.6;
      p.s.material.rotation = Math.random() * 6.28; p.spin = rand(-0.6, 0.6); p.grow = 1.2; p.drag = 1;
      p.s.visible = true;
    }
  }
  // 爆炸后的黑烟柱：大团、很久才散、一边往上飘一边被风吹斜
  function smokeColumn(pos, size, n) {
    for (let k = 0; k < n; k++) {
      const p = nextSmoke();
      p.s.position.set(pos.x + rand(-0.6, 0.6) * size, Math.max(gy(pos.x, pos.z) + 0.5, pos.y) + rand(0, 1) * size, pos.z + rand(-0.6, 0.6) * size);
      const c = rand(0.22, 0.36); p.s.material.color.setRGB(c * 1.05, c, c * 0.9);
      p.vel.set(rand(-0.5, 0.5) + 0.5, rand(1.5, 3.5) * Math.sqrt(size), rand(-0.5, 0.5) + 0.25);
      p.life = p.max = rand(3.2, 5.5) * Math.min(1.6, 0.7 + size * 0.3);
      p.size = rand(1.8, 3) * Math.sqrt(size);
      p.op = 0.82; p.s.material.rotation = Math.random() * 6.28; p.spin = rand(-0.3, 0.3); p.grow = 2.2; p.drag = 0.45;
      p.s.visible = true;
    }
  }
  // 地面扬起的一圈沙尘
  function dustRing(pos, size, n) {
    for (let k = 0; k < n; k++) {
      const p = nextSmoke(), a = k / n * Math.PI * 2 + rand(-0.2, 0.2), sp = rand(5, 9) * Math.sqrt(size);
      p.s.position.set(pos.x + Math.cos(a) * 0.5, gy(pos.x, pos.z) + 0.4 + Math.random() * 0.3, pos.z + Math.sin(a) * 0.5);
      p.s.material.color.set(0xb89c74);
      p.vel.set(Math.cos(a) * sp, rand(0.3, 1.2), Math.sin(a) * sp);
      p.life = p.max = rand(1.4, 2.4);
      p.size = rand(1.4, 2.2) * Math.sqrt(size);
      p.op = 0.65; p.s.material.rotation = Math.random() * 6.28; p.spin = rand(-0.5, 0.5); p.grow = 1.6; p.drag = 2.6;
      p.s.visible = true;
    }
  }
  function updateSmoke(dt) {
    for (const p of smokes) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      const t = 1 - p.life / p.max;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.s.position.addScaledVector(p.vel, dt);
      p.s.material.rotation += p.spin * dt;
      p.s.scale.setScalar(p.size * (0.5 + (1 - Math.pow(1 - t, 2)) * p.grow));
      p.s.material.opacity = p.op * Math.min(1, t * 6) * (1 - t) * (1 - t * 0.3);
    }
  }
  // 火球：叠加混合、亮度超过 1，泛光会让它发光；颜色从白黄慢慢变成暗红再消失
  const fires = [];
  for (let i = 0; i < 48; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTexs[i % 2], color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, fog: false }));
    s.visible = false; scene.add(s);
    fires.push({ s, life: 0, max: 1, size: 1, vel: new THREE.Vector3(), delay: 0 });
  }
  let fireIdx = 0;
  function fireball(pos, size) {
    const n = Math.min(14, 5 + Math.round(size * 4));
    for (let k = 0; k < n; k++) {
      const f = fires[fireIdx]; fireIdx = (fireIdx + 1) % fires.length;
      const r = size * 0.55;
      f.s.position.set(pos.x + rand(-r, r), Math.max(gy(pos.x, pos.z) + 0.4, pos.y + rand(-0.2, 1) * r), pos.z + rand(-r, r));
      f.vel.set(rand(-1, 1), rand(0.5, 2.2), rand(-1, 1)).multiplyScalar(2.2 * Math.sqrt(size));
      f.life = f.max = rand(0.35, 0.75) * (0.8 + size * 0.15);
      f.size = rand(1.2, 2.1) * Math.sqrt(size) * 1.3;
      f.delay = k < 3 ? 0 : rand(0, 0.08);
      f.s.material.rotation = Math.random() * 6.28;
      f.s.visible = false;
    }
  }
  const fireCol = new THREE.Color();
  function updateFires(dt) {
    for (const f of fires) {
      if (f.life <= 0) continue;
      if (f.delay > 0) { f.delay -= dt; continue; }
      f.life -= dt;
      if (f.life <= 0) { f.s.visible = false; continue; }
      f.s.visible = true;
      const t = 1 - f.life / f.max;
      f.vel.multiplyScalar(Math.max(0, 1 - 3 * dt));
      f.s.position.addScaledVector(f.vel, dt);
      f.s.scale.setScalar(f.size * (0.45 + 0.8 * (1 - Math.pow(1 - t, 3))));
      // 白热 → 橙 → 暗红
      if (t < 0.2) fireCol.setRGB(3, 2, 0.9).lerp(tmpC.setRGB(2.6, 0.95, 0.22), t / 0.2);
      else fireCol.setRGB(2.6, 0.95, 0.22).lerp(tmpC.setRGB(0.45, 0.08, 0.02), (t - 0.2) / 0.8);
      f.s.material.color.copy(fireCol);
      f.s.material.opacity = Math.min(1, (1 - t) * 1.6);
    }
  }

  // 碎片
  const shardGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
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
      sh.m.material = basicMat(k % 3 === 0 ? 0x3a3326 : color);
      sh.m.position.set(pos.x + rand(-0.4, 0.4) * size, pos.y + rand(-0.6, 0.6) * size, pos.z + rand(-0.4, 0.4) * size);
      sh.vel.set(rand(-1, 1), rand(0.4, 1.5), rand(-1, 1)).multiplyScalar(6 * Math.sqrt(size));
      sh.spin.set(rand(-10, 10), rand(-10, 10), rand(-10, 10));
      sh.life = sh.max = rand(0.7, 1.2);
      sh.s = rand(0.6, 1.3) * Math.sqrt(size);
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
      const sg = gy(sh.m.position.x, sh.m.position.z) + 0.12; if (sh.m.position.y < sg) { sh.m.position.y = sg; sh.vel.y *= -0.4; sh.vel.x *= 0.7; sh.vel.z *= 0.7; }
      sh.m.rotation.x += sh.spin.x * dt; sh.m.rotation.y += sh.spin.y * dt;
      sh.m.scale.setScalar(sh.s * Math.min(1, sh.life / sh.max * 2));
    }
  }

  // 冲击波光环
  const ringGeo = new THREE.RingGeometry(0.85, 1, 64);
  const rings = [];
  for (let i = 0; i < 24; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m);
    rings.push({ m, life: 0, max: 1, size: 1, delay: 0 });
  }
  let ringIdx = 0;
  function spawnRing(pos, color, size, life, delay) {
    const r = rings[ringIdx]; ringIdx = (ringIdx + 1) % rings.length;
    r.m.material.color.set(color);
    r.m.position.set(pos.x, Math.max(gy(pos.x, pos.z) + 0.1, pos.y - 0.5), pos.z);
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
      r.m.material.opacity = (1 - t) * 0.8;
    }
  }
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
  // 子弹轨迹
  const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
  const tracers = [];
  for (let i = 0; i < 60; i++) {
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
    tr.life = tr.max = life || 0.07;
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

  let shake = 0, flashLightT = 0;
  function explode(pos, size, silent) {
    fireball(pos, size);
    // 火花：飞得远、落得慢
    emit(pos, 0xffb04a, Math.round(22 * size), 13 * Math.sqrt(size), 1.1, 4);
    emit(pos, 0xffe3a0, Math.round(8 * size), 8 * Math.sqrt(size), 0.4, 2);
    spawnFlash(pos, 0xff9040, 4 * size, 0.12 + size * 0.03);
    const agl = pos.y - gy(pos.x, pos.z);
    if (agl < 2) dustRing(pos, size, Math.min(14, 6 + Math.round(size * 3)));
    smokeColumn(pos, size, Math.min(12, 4 + Math.round(size * 3)));
    spawnShards(pos, 0x5a4a3a, Math.min(16, 4 + Math.round(size * 3)), size);
    if (agl < 2 && size >= 1.5) addScorch(pos);
    flashLight.position.copy(pos).setY(pos.y + 1);
    flashLight.intensity = 80 * size; flashLightT = 0.25;
    const d = camera.position.distanceTo(pos);
    shake = Math.max(shake, Math.min(1.2, size * 2.5 / (d + 3)));
    if (!silent) Sfx.boom(size >= 2.2, d);
    if (state === 'playing') alertNear(pos, 60 + size * 25);
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
    d.style.left = '50%'; d.style.top = '36%';
    d.style.color = color; d.style.fontSize = (size || 40) + 'px';
    floatersEl.appendChild(d);
    setTimeout(() => d.remove(), 1000);
  }
  const flashEl = $('flash'), hurtEl = $('hurt');
  function screenFlash(color, strength) {
    flashEl.style.transition = 'none';
    flashEl.style.background = color;
    flashEl.style.opacity = strength;
    requestAnimationFrame(() => { flashEl.style.transition = 'opacity .45s'; flashEl.style.opacity = 0; });
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

  // ================= 手里的枪（单独一层画，不会插进墙里） =================
  const gunScene = new THREE.Scene();
  const gunCam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 10);
  const gunHemi = new THREE.HemisphereLight(0xe8eeff, 0x6a5030, 0.5); gunScene.add(gunHemi);
  gunScene.environment = envTex;
  const gunSun = new THREE.DirectionalLight(0xffe3b8, 2.2); gunSun.position.set(1, 2, 1.5); gunScene.add(gunSun);
  const gunFlashLight = new THREE.PointLight(0xffb050, 0, 3, 2); gunFlashLight.position.set(0.1, -0.05, -0.9); gunScene.add(gunFlashLight);
  // 枪身上细细的磨砂颗粒
  const gunN = normalTex(64, 64, (g, w, h) => { fillH(g, w, h, 128); grain(g, w, h, 700, 90, 170, 1.4); }, 1.4);
  const gunNS = new THREE.Vector2(0.35, 0.35);
  const M = {
    black: new THREE.MeshStandardMaterial({ color: 0x353a41, roughness: 0.48, metalness: 0.55, normalMap: gunN, normalScale: gunNS }),
    steel: new THREE.MeshStandardMaterial({ color: 0x6a7078, roughness: 0.28, metalness: 0.8 }),
    olive: new THREE.MeshStandardMaterial({ color: 0x55652f, roughness: 0.7, normalMap: gunN, normalScale: gunNS }),
    tan: new THREE.MeshStandardMaterial({ color: 0xb59a63, roughness: 0.66, normalMap: gunN, normalScale: gunNS }),
    wood: new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.6, normalMap: crateN, normalScale: new THREE.Vector2(0.3, 0.3) }),
    orange: new THREE.MeshStandardMaterial({ color: 0xff8a1f, roughness: 0.5 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x5fb4ff, emissive: 0x1a5fa0, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.5 }),
    red: new THREE.MeshBasicMaterial({ color: 0xff3030, toneMapped: false }),
    glove: new THREE.MeshStandardMaterial({ color: 0x3b3428, roughness: 0.9 }),
    sleeve: new THREE.MeshStandardMaterial({ map: Humans.CAMO.ally, normalMap: Humans.fabricNormal, roughness: 0.92 }),
  };
  function part(g, geo, mat, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx; if (ry) m.rotation.y = ry; if (rz) m.rotation.z = rz;
    g.add(m);
    return m;
  }
  const B = (w, h, d) => roundBox(w, h, d, Math.min(w, h, d) * 0.22, 2);
  const CYL = (r, l, seg) => { const g = new THREE.CylinderGeometry(r, r, l, seg || 14); g.rotateX(Math.PI / 2); return g; };
  // 9 把枪的数据和精细模型在 js/guns.js
  const ARS = Guns.build({ B, CYL, normal: gunN, wood: null, sleeve: M.sleeve, glowMat: sharedGlowMat });
  const WEAPONS = ARS.WEAPONS;
  const gunModels = ARS.models;
  const NW = WEAPONS.length;
  const RK = WEAPONS.findIndex(w => w.rocket), GL = WEAPONS.findIndex(w => w.launcher);
  const GS = 0.56; // 手里枪的大小
  const gunRoot = new THREE.Group();
  gunRoot.scale.setScalar(GS);
  gunScene.add(gunRoot);
  gunModels.forEach(m => { m.g.visible = false; gunRoot.add(m.g); });
  // 枪口火焰：一团光晕 + 正面的星形火花 + 两片交叉的侧面火舌
  const muzzleFlash = new THREE.Group();
  muzzleFlash.visible = false;
  gunRoot.add(muzzleFlash);
  const mfGlow = glowSprite(0xffb050, 0.5, 0.9); muzzleFlash.add(mfGlow);
  const mfStar = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashStarTex, color: new THREE.Color(2.2, 1.8, 1.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
  muzzleFlash.add(mfStar);
  const mfSideMat = new THREE.MeshBasicMaterial({ map: flashSideTex, color: new THREE.Color(2, 1.6, 1.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide, toneMapped: false });
  const mfSideGeo = new THREE.PlaneGeometry(0.16, 0.5); mfSideGeo.translate(0, 0.25, 0); mfSideGeo.rotateX(-Math.PI / 2);
  const mfSides = new THREE.Group(); muzzleFlash.add(mfSides);
  for (let i = 0; i < 2; i++) { const m = new THREE.Mesh(mfSideGeo, mfSideMat); m.rotation.z = i * Math.PI / 2; mfSides.add(m); }

  // ================= 士兵模型 =================
  const SG = {
    leg: B(0.26, 0.9, 0.3), boot: B(0.3, 0.18, 0.42), torso: B(0.74, 0.82, 0.44), vest: B(0.82, 0.58, 0.52), belt: B(0.78, 0.1, 0.48),
    head: B(0.5, 0.52, 0.5), helmet: new THREE.SphereGeometry(0.36, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), arm: B(0.2, 0.68, 0.22),
    gun: B(0.11, 0.15, 0.72), gunMag: B(0.07, 0.2, 0.1), eye: new THREE.SphereGeometry(0.085, 10, 8), pupil: new THREE.SphereGeometry(0.045, 8, 6),
    brow: B(0.2, 0.055, 0.05), visor: B(0.48, 0.12, 0.06), pouch: B(0.16, 0.16, 0.08), beret: new THREE.CylinderGeometry(0.33, 0.36, 0.12, 16),
    glasses: B(0.19, 0.09, 0.04), medal: new THREE.CylinderGeometry(0.055, 0.055, 0.025, 12), epaulette: B(0.24, 0.05, 0.22), stache: B(0.3, 0.06, 0.05),
    pack: B(0.5, 0.55, 0.24), band: B(0.54, 0.1, 0.54), mouth: B(0.22, 0.04, 0.03), armband: B(0.22, 0.1, 0.24),
  };
  const SM = {
    dark: new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.7 }),
    boot: new THREE.MeshStandardMaterial({ color: 0x2a2219, roughness: 0.8 }),
    gun: new THREE.MeshStandardMaterial({ color: 0x1e2023, roughness: 0.4, metalness: 0.6 }),
    white: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    pupil: new THREE.MeshBasicMaterial({ color: 0x111111 }),
    angry: new THREE.MeshStandardMaterial({ color: 0x9a1b1b, roughness: 0.6 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xf1c27d, roughness: 0.7 }),
    villainSkin: new THREE.MeshStandardMaterial({ color: 0xd59a62, roughness: 0.7 }),
    visor: new THREE.MeshBasicMaterial({ color: 0x7ef9ff, toneMapped: false }),
    hvisor: new THREE.MeshBasicMaterial({ color: 0xff8a1f, toneMapped: false }),
    gold: new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xaa7700, emissiveIntensity: 0.4, metalness: 0.8, roughness: 0.3 }),
    beret: new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.8 }),
    red: new THREE.MeshStandardMaterial({ color: 0xd93030, roughness: 0.6 }),
    olive: new THREE.MeshStandardMaterial({ color: 0x56682f, roughness: 0.8 }),
    tan: new THREE.MeshStandardMaterial({ color: 0xb89b6a, roughness: 0.85 }),
    allyPants: new THREE.MeshStandardMaterial({ color: 0x27467a, roughness: 0.85 }),
    blue: new THREE.MeshStandardMaterial({ color: 0x2f6bd8, roughness: 0.8 }),
  };
  function add(parent, geo, mat, x, y, z) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  function makeSoldier(kind) { return Humans.make(kind); }
  function makeDrone() {
    const g = new THREE.Group();
    const body = new THREE.Group(); g.add(body);
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.4, metalness: 0.6 });
    add(body, B(0.9, 0.32, 0.9), mat, 0, 0, 0);
    const a1 = add(body, B(2.0, 0.08, 0.12), SM.dark, 0, 0.05, 0); a1.rotation.y = Math.PI / 4;
    const a2 = add(body, B(2.0, 0.08, 0.12), SM.dark, 0, 0.05, 0); a2.rotation.y = -Math.PI / 4;
    const rotors = [];
    const rotGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.02, 16);
    const rotMat = new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.45 });
    for (const [x, z] of [[0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
      const r = add(body, rotGeo, rotMat, x, 0.14, z);
      add(r, B(0.8, 0.01, 0.06), SM.dark, 0, 0, 0);
      rotors.push(r);
    }
    const eye = add(body, new THREE.SphereGeometry(0.16, 12, 8), basicMat(0xff3030), 0, -0.02, 0.45);
    eye.add(glowSprite(0xff3030, 1.2, 0.7));
    add(body, B(0.1, 0.1, 0.5), SM.gun, 0, -0.24, 0.2);
    shadowify(g);
    return { g, body, rotors, uni: mat, flashMats: [mat], baseColor: 0x4a4f55, drone: true };
  }

  const ETYPES = {
    grunt:  { name: '坏蛋步兵', hp: 4, speed: 3.6, scale: 1, score: 10, xp: 1, dmg: 7, shoot: [1.8, 3.2], keep: 18, bullet: 28, view: 60, range: 60 },
    runner: { name: '坏蛋突击兵', hp: 3, speed: 6.8, scale: 1, score: 15, xp: 1, dmg: 12, view: 50 },
    drone:  { name: '侦察无人机', hp: 3, speed: 5.5, scale: 1, score: 20, xp: 2, dmg: 6, shoot: [1.8, 3], keep: 16, drone: true, bullet: 26, view: 75, range: 50 },
    heavy:  { name: '重甲兵', hp: 24, speed: 2.3, scale: 1.12, score: 50, xp: 4, dmg: 6, shoot: [2.6, 3.6], keep: 14, burst: 4, bullet: 26, view: 55, range: 50 },
    sniper: { name: '坏蛋狙击手', hp: 3, speed: 2.6, scale: 1, score: 25, xp: 2, dmg: 16, shoot: [3.8, 5.4], keep: 60, bullet: 75, view: 130, range: 140, sniper: true, model: 'grunt' },
    boss:   { name: '坏蛋司令', hp: 420, speed: 2.6, scale: 1.5, score: 1000, xp: 20, dmg: 10, shoot: [2.0, 2.6], keep: 14, boss: true, bullet: 18, view: 150, range: 70 },
  };

  // ================= 游戏数据 =================
  let S = {};
  let state = 'title'; // title | playing | paused | menu | dead | over | complete
  let gameId = 0;
  let allies = [], enemies = [], pickups = [], ebullets = [], grenades = [], rockets = [];
  let score = 0, level = 1, xp = 0, kills = 0, headshots = 0, missionKills = 0, missionTime = 0;
  let hp = 100, invuln = 0, combo = 0, comboTimer = 0, grenadeCount = 3, regenWait = 0;
  let pendingLevels = 0, revivesLeft = 2, revivesUsed = 0, boss = null, fireCool = 0, grenadeCool = 0;
  let curW = 2, ammo = [], reloadT = 0, reloadTotal = 1, reloadEmpty = false, switchT = 0, aimT = 0, aimHeld = false, aimToggle = false, autoReloadT = -1;
  // 手感：后坐力（会慢慢回正）、连射扩散、枪的惯性晃动、快跑和蹲下
  let recP = 0, recY = 0, recRoll = 0, heat = 0, swayX = 0, swayY = 0, lookDX = 0, lookDY = 0, sprintK = 0, crouchK = 0, crouch = false;
  let triggerQ = 0, boltT = 0, pumpT = 0, drumA = 0, drumTarget = 0, sprintBlock = 0, stepT = 0;
  // 打药：急救针（快）和急救包（慢但回得多）
  let meds = { shot: 2, kit: 1 }, healT = 0, healTotal = 1, healKind = null;
  // 喷气背包
  const jet = { has: false, fuel: 1, on: false, sfxT: 0, tipShown: false };
  let touchJump = false, inWater = false;
  let mission = null, missionNo = 1, tier = 1, mst = null;
  let best = 0, progress = 0, starsSaved = {};
  try {
    best = +localStorage.getItem('ts_best') || 0;
    progress = +localStorage.getItem('ts2_progress') || 0;
    starsSaved = JSON.parse(localStorage.getItem('ts2_stars') || '{}') || {};
  } catch (e) {}
  $('bestScore').textContent = best;
  let sens = 1;
  try { sens = +localStorage.getItem('ts_sens') || 1; } catch (e) {}
  $('sens').value = sens;
  $('sens').addEventListener('input', e => { sens = +e.target.value; try { localStorage.setItem('ts_sens', sens); } catch (er) {} });

  function resetRun() {
    S = { speed: 7.5, fireRate: 1, dmg: 1, magMul: 1, reloadSpd: 1, maxHp: 100, gRadius: 7, gDmg: 1, maxGrenades: 6, maxMeds: 4, jumps: 1, maxAllies: 6, regen: 0, allyCount: 1 };
    meds = { shot: 2, kit: 1 };
    score = 0; level = 1; xp = 0; kills = 0; headshots = 0; grenadeCount = 3;
    Learn.resetSession();
    ammo = WEAPONS.map(W => ({ mag: W.mag, res: W.reserve }));
  }
  resetRun();
  // 宝箱里开出来的枪永久解锁
  let found = {};
  try { found = JSON.parse(localStorage.getItem('ts_found') || '{}') || {}; } catch (e) {}
  function magSize(i) { const W = WEAPONS[i]; return W.rocket || W.launcher || W.shell || W.mode === 'bolt' ? W.mag : Math.round(W.mag * S.magMul); }
  function unlocked(i) { const W = WEAPONS[i]; return tier > 1 || progress >= W.unlock || !!found[W.id]; }
  // 弹匣式的枪没打空就换弹，枪膛里还多留一发（30+1）
  function chamber(W) { return W.mode === 'auto' || (W.mode === 'semi' && !W.rocket && !W.launcher); }
  function addReserve(i, n) { const A = ammo[i], W = WEAPONS[i]; if (A.res !== Infinity) A.res = Math.min(W.maxRes, A.res + n); }

  const player = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: true, jumpsUsed: 0, bob: 0, eyeH: 1.65 };
  const fwd = new THREE.Vector3(0, 0, -1), right = new THREE.Vector3(1, 0, 0);
  function eyePos(out) { return out.set(player.pos.x, player.pos.y + player.eyeH, player.pos.z); }

  // ---------- 队友 ----------
  const SLOTS = [[-2.2, 2.4], [2.2, 2.4], [-3.6, 4.8], [3.6, 4.8], [0, 5.2], [0, 7.6]];
  function addAlly(fromPos, silent) {
    if (allies.length >= S.maxAllies) { score += 50; return false; }
    const v = makeSoldier('ally');
    const p = fromPos ? fromPos.clone() : player.pos.clone().addScaledVector(fwd, -3);
    pushOut(p, 0.6, p.y); p.y = groundAt(p.x, p.z, 0.5, p.y + 1);
    v.g.position.copy(p);
    scene.add(v.g);
    allies.push({ v, g: v.g, hp: 40, maxHp: 40, cool: Math.random(), phase: Math.random() * 6, hurtT: 0, speed: 0 });
    if (!silent) puff(tmpV.copy(p).setY(p.y + 1), 4, 1.6, 0xffffff, 0.9);
    return true;
  }
  function removeAlly(i, retreat) {
    const a = allies[i];
    if (retreat) {
      puff(tmpV.copy(a.g.position).setY(a.g.position.y + 1), 6, 2, 0xffffff, 1);
      floatText(tmpV.copy(a.g.position).setY(a.g.position.y + 2.6), '队友撤退了，别担心！', '#7fc8ff', 20);
    }
    scene.remove(a.g);
    a.v.flashMats.forEach(m => m.dispose());
    allies.splice(i, 1);
  }
  function hurtAlly(i, dmg) {
    const a = allies[i];
    a.hp -= dmg; a.hurtT = 4;
    a.v.flash = 0.1;
    if (a.hp <= 0) removeAlly(i, true);
  }

  // ---------- 坏蛋 ----------
  // 驻守的坏蛋平时在营地附近站岗、走动；看到你、听到枪声或者被打中才会进攻（alert）
  let enemyUid = 0;
  function spawnEnemy(type, pos, o) {
    o = o || {};
    const T = ETYPES[type];
    const v = T.drone ? makeDrone() : makeSoldier(T.model || type);
    const s = T.scale;
    v.g.scale.setScalar(s);
    const gyy = o.y != null ? o.y : groundAt(pos.x, pos.z, 0.5, 999);
    v.g.position.set(pos.x, T.drone ? gyy + 5 : gyy, pos.z);
    v.g.rotation.y = Math.random() * 6.28;
    scene.add(v.g);
    if (T.sniper && v.g) {
      // 瞄准时的红色反光，提醒小朋友“有狙击手在瞄你”
      const glint = glowSprite(0xff3020, 1.2, 0); glint.position.set(0, 1.55, 0.35); v.g.add(glint); v.glint = glint;
    }
    const hpMul = o.prop ? 1 : D.hp;
    const e = {
      id: ++enemyUid, type, T, v, g: v.g, s,
      hp: Math.ceil(T.hp * hpMul), maxHp: Math.ceil(T.hp * hpMul),
      speed: T.speed * rand(0.9, 1.1),
      r: (T.drone ? 0.8 : 0.5) * s, flash: 0, kb: new THREE.Vector3(),
      shootT: T.shoot ? rand(1.2, T.shoot[1]) : 0, atk: 0, phase: Math.random() * 6, spawnIn: 0, idle: !!o.prop,
      strafe: Math.random() < 0.5 ? 1 : -1, strafeT: rand(1, 3), burst: 0, burstT: 0, summonT: 9, attackN: 0,
      target: null, targetT: 0,
      area: o.area || null, home: new THREE.Vector3(pos.x, gyy, pos.z), static: !!o.static, hy: o.y,
      alert: false, alertIn: -1, seeT: Math.random() * 0.4, lost: 0, last: new THREE.Vector3(),
      walkT: rand(1, 6), walkTo: null, aimT: 0, flyH: T.drone ? rand(4, 7) : 0,
    };
    enemies.push(e);
    return e;
  }
  // 发现玩家（delay 秒后开始进攻，头上冒一个“！”）
  function alertEnemy(e, delay) {
    if (e.alert || e.idle || e.alertIn >= 0) return;
    e.alertIn = delay == null ? rand(0.5, 1.1) * D.react : delay;
    if (e.alertIn > 0.05) floatText(tmpV.set(e.g.position.x, e.g.position.y + 2.4 * e.s, e.g.position.z), '❗', '#ff5a5a', 34);
  }
  function alertNear(pos, r) {
    for (const e of enemies) if (!e.alert && !e.idle && e.g.position.distanceTo(pos) < r) alertEnemy(e, rand(0.3, 1.4) * D.react);
  }
  function hitSpheres(e) {
    const p = e.g.position, s = e.s;
    if (e.T.drone) return [[p.x, p.y, p.z, 0.85 * s, false]];
    return [[p.x, p.y + 1.28 * s, p.z, 0.34 * s, false], [p.x, p.y + 0.62 * s, p.z, 0.3 * s, false], [p.x, p.y + 1.73 * s, p.z, 0.17 * s, true]];
  }
  function removeEnemy(e, keepMesh) {
    if (!keepMesh) { if (e.g.parent) e.g.parent.remove(e.g); e.v.flashMats.forEach(m => m.dispose()); }
    const i = enemies.indexOf(e);
    if (i >= 0) enemies.splice(i, 1);
    if (e === boss) { boss = null; $('bossbox').classList.add('hidden'); }
  }
  function poofEnemy(e) {
    const c = tmpV.copy(e.g.position); if (!e.T.drone) c.y += 1.2 * e.s;
    puff(c, 5, 2 * e.s, 0xffffff, 1);
    emit(c, 0xffe15a, 10, 5, 0.7, 3);
    removeEnemy(e);
  }
  function damageEnemy(e, dmg, at, head, fromPlayer) {
    if (e.hp <= 0 || e.idle) return;
    e.hp -= dmg;
    e.flash = 0.08;
    if (!e.alert) { alertEnemy(e, 0.15); alertNear(e.g.position, 35); }
    if (fromPlayer !== false) e.kb.add(tmpV3.set(e.g.position.x - player.pos.x, 0, e.g.position.z - player.pos.z).normalize().multiplyScalar(e.T.boss ? 0.15 : 1.2));
    if (e.hp <= 0) killEnemy(e, head, fromPlayer !== false);
  }
  function killEnemy(e, head, byPlayer) {
    const p = e.g.position.clone();
    const center = p.clone(); if (!e.T.drone) center.y += 1.2 * e.s;
    kills++;
    if (!e.minion) missionKills++;
    if (e.area && areaStats[e.area]) areaStats[e.area].dead++;
    combo++; comboTimer = 3;
    const mult = 1 + Math.floor(combo / 5);
    const pts = e.T.score * mult * (head ? 2 : 1);
    score += pts;
    if (head && byPlayer) { headshots++; centerText('爆头！+' + pts, '#ffd23f', 44); Sfx.headshot(); }
    else floatText(center, '+' + pts, '#ffd23f', 24);
    if (e.T.boss) {
      const id = gameId;
      for (let i = 0; i < 8; i++) setTimeout(() => {
        if (id !== gameId) return;
        explode(new THREE.Vector3(p.x + rand(-3, 3), p.y + rand(1, 6), p.z + rand(-3, 3)), 2.4);
      }, i * 170);
      screenFlash('#fff', 0.8);
      shake = 1.5;
    } else if (e.T.drone) {
      explode(center, 1, true);
      Sfx.boom(false);
    } else {
      emit(center, 0xffe15a, 10, 4, 0.6, 3);
      Sfx.hit();
    }
    if ([5, 10, 15, 20, 30].includes(combo)) centerText(`${combo} 连杀！`, '#ff8a1f', 52);
    for (let i = 0; i < e.T.xp; i++) spawnPickup('medal', center);
    if (!e.T.boss) {
      const roll = Math.random();
      if (roll < 0.12) spawnPickup('ammo', center);
      else if (roll < 0.17) spawnPickup('medkit', center);
      else if (roll < 0.24) spawnPickup('syringe', center);
    }
    if (e.T.drone) { removeEnemy(e); return; }
    // 不血腥：坏蛋向后倒下，然后“噗”地变成一团烟消失
    removeEnemy(e, true);
    if (e.v.glint) e.v.glint.visible = false;
    e.g.rotation.order = 'YXZ';
    corpses.push({ e, t: 0, dir: Math.random() < 0.5 ? 1 : -1 });
  }
  let corpses = [];
  function updateCorpses(dt) {
    for (let i = corpses.length - 1; i >= 0; i--) {
      const c = corpses[i], g = c.e.g;
      c.t += dt;
      const k = Math.min(1, c.t / 0.5);
      const fall = k < 1 ? k * k : 1;
      g.rotation.x = -Math.PI / 2 * 0.96 * fall;
      g.rotation.z = c.dir * 0.15 * fall;
      if (c.t > 0.5 && !c.landed) { c.landed = true; puff(tmpV.copy(g.position).setY(g.position.y + 0.3), 3, 1.2 * c.e.s, 0xd6c3a0, 0.9); }
      if (c.t > (c.e.T.boss ? 2.6 : 1.3)) {
        const back = tmpV.set(-Math.sin(g.rotation.y), 0, -Math.cos(g.rotation.y));
        const p = tmpV2.copy(g.position).addScaledVector(back, 0.9 * c.e.s); p.y += 0.5;
        puff(p, 6, 1.6 * c.e.s, 0xffffff, 1);
        emit(p, 0xffe15a, 10, 4, 0.6, 3);
        if (g.parent) g.parent.remove(g);
        c.e.v.flashMats.forEach(m => m.dispose());
        corpses.splice(i, 1);
      }
    }
  }

  // ---------- 敌人的子弹（发光的橙色曳光弹） ----------
  const ebGeo = new THREE.BoxGeometry(0.09, 0.09, 0.9);
  function fireBullet(from, to, speed, dmg, big) {
    let b = ebullets.find(x => !x.alive);
    if (!b) {
      if (ebullets.length > 140) return;
      const mesh = new THREE.Mesh(ebGeo, basicMat(0xffa040));
      const gl = new THREE.Sprite(sharedGlowMat(0xff7a1a, 0.8)); gl.scale.setScalar(1.1); mesh.add(gl);
      scene.add(mesh);
      b = { mesh, gl, vel: new THREE.Vector3(), life: 0, alive: false, dmg: 5 };
      ebullets.push(b);
    }
    b.alive = true; b.mesh.visible = true;
    b.mesh.position.copy(from);
    b.vel.copy(to).sub(from).normalize().multiplyScalar(speed);
    b.mesh.lookAt(tmpV.copy(from).add(b.vel));
    b.mesh.scale.setScalar(big ? 2.2 : 1);
    b.life = 4; b.dmg = dmg;
    Sfx.enemyShot(camera.position.distanceTo(from));
  }

  // ---------- 道具 ----------
  const medalGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.07, 20); medalGeo.rotateX(Math.PI / 2);
  const medalMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xcc8800, emissiveIntensity: 0.7, metalness: 0.8, roughness: 0.25 });
  const medalStar = new THREE.MeshBasicMaterial({ color: 0xfff5c0, toneMapped: false });
  const starShape = (() => { const s = new THREE.Shape(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.08 : 0.19, a = i / 10 * Math.PI * 2 + Math.PI / 2; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i) s.lineTo(x, y); else s.moveTo(x, y); } return new THREE.ShapeGeometry(s); })();
  const kitGeo = B(0.7, 0.45, 0.5);
  const kitMat = new THREE.MeshStandardMaterial({ map: medkitTex, roughness: 0.6 });
  const ammoMat = new THREE.MeshStandardMaterial({ map: ammoTex, roughness: 0.7 });
  function spawnPickup(kind, pos) {
    let g;
    if (kind === 'medal') {
      g = new THREE.Mesh(medalGeo, medalMat);
      const st = new THREE.Mesh(starShape, medalStar); st.position.z = 0.04; g.add(st);
      const st2 = new THREE.Mesh(starShape, medalStar); st2.position.z = -0.04; st2.rotation.y = Math.PI; g.add(st2);
      const s = new THREE.Sprite(sharedGlowMat(0xffc400, 0.45)); s.scale.setScalar(1.3); g.add(s);
    } else if (kind === 'syringe') {
      g = new THREE.Group();
      const b = new THREE.Mesh(CYL(0.07, 0.5, 12), syrMat); b.rotation.y = Math.PI / 2; g.add(b);
      const c = new THREE.Mesh(CYL(0.09, 0.08, 12), M.orange); c.rotation.y = Math.PI / 2; c.position.x = 0.28; g.add(c);
      const s = new THREE.Sprite(sharedGlowMat(0x40ff80, 0.5)); s.scale.setScalar(1.6); g.add(s);
    } else if (kind === 'jetpack') {
      g = makeJetpack();
    } else {
      g = new THREE.Mesh(kitGeo, kind === 'medkit' ? kitMat : ammoMat);
      const s = new THREE.Sprite(sharedGlowMat(kind === 'medkit' ? 0xff6060 : 0xffd23f, 0.45)); s.scale.setScalar(2); g.add(s);
    }
    const spread = kind === 'medal' ? 1.2 : kind === 'jetpack' ? 0 : 0.3;
    g.position.set(pos.x + rand(-spread, spread), Math.max(gy(pos.x, pos.z) + 0.8, pos.y), pos.z + rand(-spread, spread));
    scene.add(g);
    pickups.push({ kind, g, t: Math.random() * 6, life: kind === 'medal' ? 30 : kind === 'jetpack' ? Infinity : 40, vel: kind === 'jetpack' ? new THREE.Vector3() : new THREE.Vector3(rand(-3, 3), 5, rand(-3, 3)) });
  }
  const syrMat = new THREE.MeshStandardMaterial({ color: 0x40ff80, emissive: 0x20c050, emissiveIntensity: 0.8, roughness: 0.2 });
  // 喷气背包：背板 + 两个燃料罐 + 喷口，放在地上会转圈发光
  function makeJetpack() {
    const g = new THREE.Group();
    const inner = new THREE.Group(); inner.scale.setScalar(1.25); g.add(inner);
    const frame = stdMat('jpframe', { color: 0x3a4048, metalness: 0.7, roughness: 0.35 });
    const tank = stdMat('jptank', { color: 0xc9ccd2, metalness: 0.85, roughness: 0.25 });
    const stripe = stdMat('jpstripe', { color: 0xff8a1f, roughness: 0.5 });
    const back = new THREE.Mesh(B(0.5, 0.62, 0.12), frame); inner.add(back);
    for (const s of [-1, 1]) {
      const t = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.42, 6, 16), tank); t.position.set(s * 0.17, 0.02, -0.15); inner.add(t);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.06, 16), stripe); band.position.set(s * 0.17, 0.14, -0.15); inner.add(band);
      const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.14, 14), frame); noz.position.set(s * 0.17, -0.38, -0.15); inner.add(noz);
      const fl = glowSprite(0x6fd8ff, 0.5, 0.9); fl.position.set(s * 0.17, -0.5, -0.15); inner.add(fl);
      const strap = new THREE.Mesh(B(0.07, 0.6, 0.04), stdMat('jpstrap', { color: 0x2a2a22, roughness: 0.9 })); strap.position.set(s * 0.15, 0, 0.09); inner.add(strap);
    }
    const s = new THREE.Sprite(sharedGlowMat(0x6fd8ff, 0.4)); s.scale.setScalar(2.6); g.add(s);
    shadowify(inner);
    return g;
  }
  function removePickup(i) { scene.remove(pickups[i].g); pickups.splice(i, 1); }

  // ---------- 手榴弹 ----------
  const grenGeo = new THREE.SphereGeometry(0.14, 10, 8);
  const grenMat = new THREE.MeshStandardMaterial({ color: 0x4f5d2f, roughness: 0.6 });
  let gunKick = 0, gunDip = 0, muzzleT = 0;
  function throwGrenade() {
    if (state !== 'playing' || grenadeCool > 0) return;
    if (grenadeCount <= 0) { centerText('没有手榴弹了！捡弹药箱 📦', '#ffb347', 26); return; }
    grenadeCount--;
    grenadeCool = 0.5;
    gunDip = 1;
    Sfx.throwIt();
    let gr = grenades.find(x => !x.alive);
    if (!gr) {
      const mesh = new THREE.Mesh(grenGeo, grenMat);
      const gl = glowSprite(0xff3030, 0.7, 0.9);
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
  // 爆炸伤害（玩家自己的爆炸不会伤到自己和队友）
  function blastDamage(pos, r, dmg) {
    for (const e of enemies.slice()) {
      if (e.idle || e.spawnIn > 0) continue;
      const c = tmpV2.copy(e.g.position); if (!e.T.drone) c.y += 1.2 * e.s;
      const d = c.distanceTo(pos);
      if (d < r + e.r) {
        const f = 1 - Math.min(1, d / (r + e.r)) * 0.5;
        e.kb.add(new THREE.Vector3().copy(e.g.position).sub(pos).setY(0).normalize().multiplyScalar(e.T.boss ? 2 : 14 * f));
        damageEnemy(e, dmg * f * (e.T.boss ? 0.6 : 1), c.clone());
      }
    }
    for (const b of ebullets) if (b.alive && b.mesh.position.distanceTo(pos) < r) { b.alive = false; b.mesh.visible = false; }
    const id = gameId;
    for (const o of (W ? W.phys.query(pos.x, pos.z, r).slice() : [])) {
      if (o.kind !== 'barrel') continue;
      if (Math.hypot(o.x - pos.x, o.z - pos.z) < r * 0.8) setTimeout(() => { if (id === gameId) damageBarrel(o, 99); }, 120);
    }
  }
  function grenadeBlast(pos) {
    explode(pos, 2.8);
    spawnRing(pos, 0xffd23f, S.gRadius * 1.3, 0.6);
    emit(pos, 0xffd23f, 50, 14, 0.9, 5);
    shake = Math.max(shake, 1);
    blastDamage(pos, S.gRadius, 14 * S.gDmg);
  }
  function damageBarrel(o, dmg) {
    if (o.dead) return;
    o.hp -= dmg;
    if (o.hp > 0) { emit(tmpV.set(o.x, o.y0 + 1.3, o.z), 0xffc04a, 6, 4, 0.3, 1); return; }
    removeOb(o);
    const p = new THREE.Vector3(o.x, o.y0 + 1.3, o.z);
    explode(p, 2.6);
    emit(p, 0xff5a1a, 40, 12, 1, 6);
    blastDamage(p, 5.5, 12);
    centerText('💥 油桶爆炸！', '#ff8a1f', 34);
  }
  function updateGrenades(dt) {
    for (const gr of grenades) {
      if (!gr.alive) continue;
      gr.fuse -= dt;
      gr.vel.y -= 20 * dt;
      const p = gr.mesh.position;
      p.addScaledVector(gr.vel, dt);
      gr.mesh.rotation.x += dt * 10; gr.mesh.rotation.y += dt * 7;
      gr.gl.material.opacity = Math.floor(gr.fuse * (gr.fuse < 0.6 ? 16 : 6)) % 2 ? 1 : 0.2;
      const gh = gy(p.x, p.z) + 0.14;
      if (p.y < gh) { p.y = gh; gr.vel.y = Math.abs(gr.vel.y) * 0.45; gr.vel.x *= 0.65; gr.vel.z *= 0.65; }
      const o = insideBox(p);
      if (o) {
        if (p.y - gr.vel.y * dt >= o.top - 0.05) { p.y = o.top + 0.01; gr.vel.y = Math.abs(gr.vel.y) * 0.45; gr.vel.x *= 0.7; gr.vel.z *= 0.7; }
        else { p.addScaledVector(gr.vel, -dt); gr.vel.x *= -0.5; gr.vel.z *= -0.5; }
      }
      if (Math.random() < 0.5) puff(p, 1, 0.4, 0xbbbbbb, 0.5, 0.05);
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

  // ---------- 火箭弹 ----------
  const rocketGeo = CYL(0.07, 0.6);
  const rocketMat = new THREE.MeshStandardMaterial({ color: 0x8a9a3a, roughness: 0.6 });
  const lgGeo = new THREE.SphereGeometry(0.07, 10, 8);
  function fireRocket(from, dir, gren) {
    let r = rockets.find(x => !x.alive && !!x.gren === !!gren);
    if (!r) {
      let mesh;
      if (gren) {
        // 40 毫米榴弹：会受重力往下掉
        mesh = new THREE.Mesh(lgGeo, ARS.M.brass);
        const gl = glowSprite(0xffb060, 0.6, 0.6); mesh.add(gl);
      } else {
        mesh = new THREE.Mesh(rocketGeo, rocketMat);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 10), M.orange); tip.rotation.x = -Math.PI / 2; tip.position.z = -0.4; mesh.add(tip);
        const gl = glowSprite(0xff9a3a, 1.4, 0.9); gl.position.z = 0.35; mesh.add(gl);
      }
      scene.add(mesh);
      r = { mesh, vel: new THREE.Vector3(), life: 0, alive: false, gren: !!gren };
      rockets.push(r);
    }
    r.alive = true; r.mesh.visible = true;
    r.mesh.position.copy(from);
    r.vel.copy(dir).multiplyScalar(gren ? 30 : 36);
    if (gren) r.vel.y += 2.5;
    r.mesh.lookAt(tmpV.copy(from).sub(dir)); // 圆锥朝 -z，所以反着看
    r.life = gren ? 5 : 5;
  }
  function rocketBlast(p, gren) {
    const W = WEAPONS[gren ? GL : RK];
    explode(p, gren ? 2.4 : 3.2);
    emit(p, 0xffc060, gren ? 20 : 30, 15, 1.2, 6);
    shake = Math.max(shake, gren ? 0.7 : 1.1);
    blastDamage(p, W.blast, W.dmg * S.dmg);
  }
  function updateRockets(dt) {
    for (const r of rockets) {
      if (!r.alive) continue;
      r.life -= dt;
      const p = r.mesh.position;
      const steps = 3;
      let boom = false;
      for (let k = 0; k < steps && !boom; k++) {
        p.addScaledVector(r.vel, dt / steps);
        if (r.gren) r.vel.y -= 14 * dt / steps;
        if (p.y <= gy(p.x, p.z) + 0.05 || insideBox(p) || Math.abs(p.x) > 800 || Math.abs(p.z) > 800 || r.life <= 0) boom = true;
        for (const e of enemies) {
          if (boom) break;
          if (e.idle || e.spawnIn > 0) continue;
          for (const s of hitSpheres(e)) if ((p.x - s[0]) ** 2 + (p.y - s[1]) ** 2 + (p.z - s[2]) ** 2 < (s[3] + 0.25) ** 2) { boom = true; break; }
        }
      }
      if (r.gren) { if (Math.random() < 0.5) puff(p, 1, 0.3, 0xd8d0c0, 0.5, 0.02); r.mesh.rotation.x += dt * 20; }
      else { puff(p, 1, 0.7, 0xd8d0c0, 0.8, 0.05); emit(p, 0xff9a3a, 2, 1.5, 0.25, 0); }
      if (boom) {
        r.alive = false; r.mesh.visible = false;
        const o = insideBox(p);
        if (o && o.kind === 'barrel') damageBarrel(o, 99);
        rocketBlast(p.clone().setY(Math.max(gy(p.x, p.z) + 0.3, p.y)), r.gren);
      }
    }
  }

  // ================= 开枪 =================
  const camRightV = new THREE.Vector3(), camUpV = new THREE.Vector3();
  function muzzleWorld(out) {
    const k = aimT;
    return out.set(lerp(0.2, 0.08, k), lerp(-0.18, -0.13, k), -0.85).applyMatrix4(camera.matrixWorld);
  }
  // 打到墙/地面时算出是哪一面，用来贴弹孔
  const hitN = new THREE.Vector3();
  function surfaceNormal(p, ob) {
    if (!ob) return hitN.set(0, 1, 0);
    const dx = (p.x - ob.x) / ob.hx, dz = (p.z - ob.z) / ob.hz, dy = (p.y - ob.h) / 0.3;
    if (p.y > ob.h - 0.02) return hitN.set(0, 1, 0);
    return Math.abs(dx) > Math.abs(dz) ? hitN.set(Math.sign(dx), 0, 0) : hitN.set(0, 0, Math.sign(dz));
  }
  function tryFire() {
    const W = WEAPONS[curW], A = ammo[curW];
    if (healT > 0 || switchT > 0 || fireCool > 0) return;
    // 霰弹枪一发一发装弹时，可以随时打断开枪
    if (reloadT > 0) { if (W.shell && A.mag > 0) { reloadT = 0; } else return; }
    if (A.mag <= 0) {
      if (A.res > 0) startReload();
      else { Sfx.empty(); centerText(`${W.name}没子弹了！开宝箱 🎁 或捡弹药箱 📦，或者换枪`, '#ffb347', 24); }
      fireCool = 0.35; triggerQ = 0;
      return;
    }
    A.mag--;
    triggerQ = 0;
    sprintBlock = 0.35;
    fireCool = W.rate / (W.rocket || W.scope || W.launcher ? 1 : S.fireRate);
    if (W.mode === 'bolt') boltT = fireCool;
    if (W.mode === 'pump') pumpT = fireCool;
    if (W.launcher) drumTarget += Math.PI / 3;
    gunKick = 1;
    recRoll = rand(-1, 1);
    muzzleT = W.rocket ? 0.08 : 0.05;
    Sfx[W.sfx]();
    alertNear(player.pos, W.id === 'pistol' ? 45 : W.id === 'sniper' ? 120 : 85);
    camera.updateMatrixWorld();
    const eye = eyePos(new THREE.Vector3());
    const aim = new THREE.Vector3();
    camera.getWorldDirection(aim);
    const from = muzzleWorld(new THREE.Vector3());
    flashLight.position.copy(from); flashLight.intensity = W.rocket ? 30 : 12; flashLightT = 0.05;
    if (!W.rocket && !W.launcher && Math.random() < 0.6) puff(from, 1, W.pellets > 1 ? 0.5 : 0.3, 0xd8d2c4, 0.9, 0.02);
    const moving = Math.hypot(player.vel.x, player.vel.z) > 2 || !player.onGround;
    // 移动、跳起来、连续开火都会让子弹散得更开；蹲下更稳
    const spread = lerp(W.spread, W.adsSpread, aimT) * (moving ? 1.6 : 1) * (1 + heat * lerp(1.3, 0.5, aimT)) * (crouch ? 0.7 : 1);
    heat = Math.min(1, heat + W.heat);
    if (W.rocket || W.launcher) {
      const dir = aim.clone().add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(spread)).normalize();
      fireRocket(from, dir, W.launcher);
      puff(from, W.launcher ? 2 : 3, W.launcher ? 0.5 : 1, 0xd8d0c0, 0.8);
      if (W.rocket) gunModels[RK].head.visible = false;
    } else {
      let anyHit = false, anyHead = false;
      const assist = isTouch ? 1.3 : 1.12;
      for (let k = 0; k < W.pellets; k++) {
        const dir = aim.clone().add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(spread)).normalize();
        const rh = rayObstacles(eye, dir, 420);
        const wallT = rh.t, wallOb = rh.ob, wallTerr = rh.terrain;
        hitN.copy(rh.n);
        const hits = [];
        for (const e of enemies) {
          if (e.idle || e.spawnIn > 0) continue;
          let bt = Infinity, bh = false;
          for (const s of hitSpheres(e)) {
            const t = raySphere(eye, dir, tmpV2.set(s[0], s[1], s[2]), s[3] * assist);
            if (t > 0 && t < bt) { bt = t; bh = s[4]; }
          }
          if (bt < wallT) hits.push([bt, e, bh]);
        }
        hits.sort((a, b) => a[0] - b[0]);
        const use = W.pierce ? hits : hits.slice(0, 1);
        const endT = use.length && !W.pierce ? use[0][0] : wallT;
        const hitP = eye.clone().addScaledVector(dir, endT);
        if (k < 3) spawnTracer(from, hitP, W.color, W.scope ? 0.05 : 0.035, W.scope ? 0.15 : 0.06);
        for (const [t, e, head] of use) {
          anyHit = true; anyHead = anyHead || head;
          const hp2 = eye.clone().addScaledVector(dir, t);
          emit(hp2, 0xffe15a, 6, 5, 0.3, 1);
          // 距离越远威力越小
          const fo = W.falloff, fall = lerp(1, fo[2], clamp((t - fo[0]) / (fo[1] - fo[0]), 0, 1));
          damageEnemy(e, W.dmg * S.dmg * (head ? 2 : 1) * fall, hp2, head);
        }
        if (!use.length || W.pierce) {
          if (wallT < 420) {
            const n = wallTerr && getW() ? getW().terrain.normalAt(hitP.x, hitP.z, hitN) : hitN;
            emit(hitP, 0xffc04a, 4, 4, 0.25, 2);
            if (k % 3 === 0) puff(hitP, 1, 0.4, wallOb ? 0xb8a888 : 0xc8b08a, 0.6, 0.05);
            if (k < 4) addHole(hitP, n, !wallOb);
            if (wallOb && wallOb.kind === 'barrel') damageBarrel(wallOb, W.dmg * S.dmg);
          }
        }
      }
      if (anyHit) { hitMarker(anyHead); Sfx.hit(); }
    }
    // 后坐力：一部分枪口会慢慢回来，一部分留下（要往下压枪）
    const rk = W.recoil * (1 - aimT * 0.3) * (crouch ? 0.75 : 1);
    player.pitch = Math.min(1.45, player.pitch + rk * 0.4);
    recP += rk * 0.6;
    recY += rand(-1, 1) * W.recoilX;
    if (W.mode !== 'pump' && W.mode !== 'bolt' && gunModels[curW].eject) ejectShell(curW);
    if (A.mag <= 0 && A.res > 0) autoReloadT = 0.25;
  }
  function startReload() {
    const A = ammo[curW], W = WEAPONS[curW];
    if (healT > 0 || reloadT > 0 || switchT > 0 || A.res <= 0) return;
    const cap = magSize(curW) + (chamber(W) && A.mag > 0 ? 1 : 0);
    if (A.mag >= cap) return;
    reloadEmpty = A.mag === 0;
    reloadTotal = (W.shell ? W.reload + 0.25 : (reloadEmpty ? W.reloadEmpty : W.reload)) / S.reloadSpd;
    reloadT = reloadTotal;
    Sfx.reload();
  }
  function finishReload() {
    const A = ammo[curW], W = WEAPONS[curW];
    if (W.shell) {
      // 一发一发往里塞
      if (A.res > 0 && A.mag < magSize(curW)) { A.mag++; if (A.res !== Infinity) A.res--; Sfx.shellIn(); }
      if (A.mag < magSize(curW) && A.res > 0) { reloadTotal = W.reload / S.reloadSpd; reloadT = reloadTotal; }
      else if (reloadEmpty) pumpT = 0.5;
      return;
    }
    const cap = magSize(curW) + (chamber(W) && !reloadEmpty ? 1 : 0);
    const take = Math.min(cap - A.mag, A.res);
    A.mag += take;
    if (A.res !== Infinity) A.res -= take;
    if (W.rocket) gunModels[RK].head.visible = A.mag > 0;
  }
  function switchWeapon(i) {
    if (state !== 'playing' && state !== 'menu') return;
    if (i < 0 || i >= NW) return;
    if (i === curW || !unlocked(i)) { if (!unlocked(i) && state === 'playing') centerText(`🔒 完成第 ${WEAPONS[i].unlock} 个任务解锁${WEAPONS[i].name}（宝箱里也可能开到！）`, '#ffb347', 24); return; }
    cancelHeal();
    curW = i;
    reloadT = 0; autoReloadT = -1; boltT = 0; pumpT = 0;
    switchT = 0.4;
    Sfx.draw();
    showGun();
  }
  function showGun() {
    gunModels.forEach((m, k) => { m.g.visible = k === curW; });
    gunModels[RK].head.visible = ammo[RK].mag > 0;
  }
  function cycleWeapon(dir) {
    for (let k = 1; k <= NW; k++) {
      const i = (curW + dir * k + NW * 2) % NW;
      if (unlocked(i)) { switchWeapon(i); return; }
    }
  }

  // ---------- 弹壳：开枪时从抛壳窗飞出来 ----------
  const shellGeo = CYL(0.0055, 0.03, 8), sgShellGeo = CYL(0.011, 0.05, 10);
  const shells = [];
  const shellTmp = new THREE.Vector3();
  function ejectShell(i) {
    const gm = gunModels[i];
    let s = shells.find(x => x.life <= 0 && x.sg === !!gm.shellMat);
    if (!s) {
      if (shells.length > 24) return;
      const m = new THREE.Mesh(gm.shellMat ? sgShellGeo : shellGeo, gm.shellMat || ARS.M.brass);
      gunScene.add(m);
      s = { m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, sg: !!gm.shellMat };
      shells.push(s);
    }
    gunRoot.updateMatrixWorld();
    shellTmp.copy(gm.eject).applyMatrix4(gm.g.matrixWorld);
    s.m.position.copy(shellTmp);
    s.m.rotation.set(0, Math.random() * 0.5, 0);
    s.m.scale.setScalar(GS);
    s.vel.set(rand(0.9, 1.4), rand(0.7, 1.1), rand(0.05, 0.25));
    s.spin.set(rand(8, 16), rand(-6, 6), rand(10, 20));
    s.life = 0.7; s.m.visible = true;
  }
  function updateShells(dt) {
    for (const s of shells) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.vel.y -= 5 * dt;
      s.m.position.addScaledVector(s.vel, dt);
      s.m.rotation.x += s.spin.x * dt; s.m.rotation.y += s.spin.y * dt; s.m.rotation.z += s.spin.z * dt;
      if (s.life <= 0) s.m.visible = false;
      if (s.life < 0.45 && s.life + dt >= 0.45 && Math.random() < 0.6) Sfx.casing();
    }
  }

  // ---------- 弹孔和炸痕：打在墙上、地上会留下印子 ----------
  const holeTex = canvasTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    r.addColorStop(0, 'rgba(10,8,6,1)'); r.addColorStop(0.18, 'rgba(25,20,15,0.95)'); r.addColorStop(0.32, 'rgba(70,60,45,0.55)'); r.addColorStop(1, 'rgba(70,60,45,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(30,25,18,0.6)'; g.lineWidth = 1.2;
    for (let i = 0; i < 7; i++) { const a = Math.random() * 6.28, l = rand(10, 24); g.beginPath(); g.moveTo(32, 32); g.lineTo(32 + Math.cos(a) * l, 32 + Math.sin(a) * l); g.stroke(); }
  });
  const scorchTex = canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      const x = 64 + rand(-30, 30), y = 64 + rand(-30, 30), rr = rand(10, 34);
      const r = g.createRadialGradient(x, y, 0, x, y, rr);
      r.addColorStop(0, 'rgba(15,12,10,0.22)'); r.addColorStop(1, 'rgba(15,12,10,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    }
  });
  const decalMat = new THREE.MeshStandardMaterial({ map: holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.9 });
  const scorchMat = new THREE.MeshStandardMaterial({ map: scorchTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 1 });
  const decalGeo = new THREE.PlaneGeometry(1, 1);
  const decals = [], DECAL_N = 90; let decalI = 0;
  const scorches = []; let scorchI = 0;
  function addHole(p, n, ground) {
    let d = decals[decalI];
    if (!d) { d = new THREE.Mesh(decalGeo, decalMat); d.receiveShadow = true; scene.add(d); decals[decalI] = d; }
    decalI = (decalI + 1) % DECAL_N;
    d.position.copy(p).addScaledVector(n, 0.012);
    d.lookAt(tmpV.copy(d.position).add(n));
    d.rotateZ(Math.random() * 6.28);
    d.scale.setScalar(ground ? rand(0.12, 0.2) : rand(0.08, 0.13));
    d.visible = true;
  }
  function addScorch(p) {
    const g0 = gy(p.x, p.z);
    if (p.y - g0 > 1.5) return;
    let d = scorches[scorchI];
    if (!d) { d = new THREE.Mesh(decalGeo, scorchMat); d.receiveShadow = true; scene.add(d); scorches[scorchI] = d; }
    scorchI = (scorchI + 1) % 16;
    d.position.set(p.x, g0 + 0.06, p.z);
    if (W) d.lookAt(tmpV.copy(d.position).add(W.terrain.normalAt(p.x, p.z, tmpV2)));
    d.rotateZ(Math.random() * 6.28);
    d.scale.setScalar(rand(3.5, 5));
    d.visible = true;
  }
  function clearDecals() { decals.forEach(d => { d.visible = false; }); scorches.forEach(d => { d.visible = false; }); }

  // ================= 打药 =================
  // 手里拿着的急救针和急救包（画在枪那一层）
  const healRoot = new THREE.Group(); healRoot.visible = false; healRoot.scale.setScalar(0.5); gunScene.add(healRoot);
  const syringe = new THREE.Group(); healRoot.add(syringe);
  const plunger = new THREE.Group();
  {
    const glassM = new THREE.MeshStandardMaterial({ color: 0xd8f0ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.45 });
    const liquid = new THREE.MeshStandardMaterial({ color: 0x40ff80, emissive: 0x20c050, emissiveIntensity: 0.9, roughness: 0.2 });
    const body = new THREE.Mesh(CYL(0.016, 0.14, 16), glassM); syringe.add(body);
    const liq = new THREE.Mesh(CYL(0.013, 0.11, 14), liquid); liq.position.z = -0.012; syringe.add(liq);
    const cap = new THREE.Mesh(CYL(0.02, 0.012, 16), ARS.M.orange); cap.position.z = 0.074; syringe.add(cap);
    const tip = new THREE.Mesh(CYL(0.006, 0.02, 10), ARS.M.steel); tip.position.z = -0.08; syringe.add(tip);
    const needle = new THREE.Mesh(CYL(0.0015, 0.05, 6), ARS.M.steel); needle.position.z = -0.115; syringe.add(needle);
    syringe.add(plunger); plunger.position.z = 0.09;
    const rod = new THREE.Mesh(CYL(0.004, 0.06, 8), ARS.M.dark); rod.position.z = 0.0; plunger.add(rod);
    const thumb = new THREE.Mesh(CYL(0.016, 0.006, 16), ARS.M.dark); thumb.position.z = 0.032; plunger.add(thumb);
    const glove = new THREE.Mesh(B(0.07, 0.04, 0.09), ARS.M.glove); glove.position.set(0, -0.03, 0.03); syringe.add(glove);
    syringe.userData.liq = liq;
  }
  const kitBox = new THREE.Group(); healRoot.add(kitBox);
  const bandage = new THREE.Group();
  {
    const kt = canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#c23a2a'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(24, 10, 16, 44); g.fillRect(10, 24, 44, 16); });
    const km = new THREE.MeshStandardMaterial({ map: kt, roughness: 0.6 });
    const kb = new THREE.Mesh(B(0.2, 0.06, 0.14), km); kitBox.add(kb);
    const strap = new THREE.Mesh(B(0.205, 0.064, 0.02), ARS.M.dark); kitBox.add(strap);
    kitBox.add(bandage); bandage.position.set(0.02, 0.07, 0);
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 16), new THREE.MeshStandardMaterial({ color: 0xf2ede0, roughness: 0.95 }));
    roll.rotation.z = Math.PI / 2; bandage.add(roll);
    const g1 = new THREE.Mesh(B(0.08, 0.035, 0.1), ARS.M.glove); g1.position.set(-0.13, 0, 0.02); kitBox.add(g1);
    const g2 = new THREE.Mesh(B(0.07, 0.035, 0.09), ARS.M.glove); g2.position.set(0.02, 0.1, 0.02); bandage.add(g2);
  }
  const HEALS = {
    shot: { name: '急救针', icon: '💉', time: 1.3, amount: 35 },
    kit: { name: '急救包', icon: '🩹', time: 3.0, amount: 75 },
  };
  function useMed() {
    if (state !== 'playing' || healT > 0) return;
    if (hp >= S.maxHp) { centerText('生命是满的，不用打药 💪', '#6ee36a', 24); return; }
    // 伤得重先用急救包，伤得轻先用急救针
    const miss = S.maxHp - hp;
    let kind = miss > 45 ? (meds.kit > 0 ? 'kit' : 'shot') : (meds.shot > 0 ? 'shot' : 'kit');
    if (meds[kind] <= 0) { centerText('没有药了！开宝箱 🎁 或者捡医疗箱', '#ffb347', 26); Sfx.empty(); return; }
    meds[kind]--;
    healKind = kind; healTotal = HEALS[kind].time; healT = healTotal;
    reloadT = 0; autoReloadT = -1; aimToggle = false; $('tAim').classList.remove('on');
    syringe.visible = kind === 'shot'; kitBox.visible = kind === 'kit';
    Sfx.medStart();
  }
  function cancelHeal() {
    if (healT <= 0) return;
    meds[healKind]++;
    healT = 0; healKind = null;
    centerText('打药被打断了', '#ffb347', 22);
  }
  function updateHeal(dt) {
    if (healT <= 0) return;
    healT -= dt;
    if (healT <= 0) {
      const H = HEALS[healKind];
      hp = Math.min(S.maxHp, hp + H.amount);
      centerText(`${H.icon} ${H.name}：生命 +${H.amount}`, '#6ee36a', 32);
      emit(new THREE.Vector3(player.pos.x, player.pos.y + 1, player.pos.z), 0x6ee36a, 30, 4, 0.8, 3);
      screenFlash('#6ee36a', 0.15);
      Sfx.medDone();
      healT = 0; healKind = null;
    }
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
    if (!locked) { mouseDown = false; aimHeld = false; }
    if (!locked && state === 'playing' && !lockFallback) pause();
  });
  document.addEventListener('pointerlockerror', () => { lockFallback = true; });
  function needLock() { return !isTouch && !lockFallback && !locked; }

  addEventListener('keydown', e => {
    Sfx.init();
    keys[e.code] = true;
    if (e.code === 'Space') { e.preventDefault(); if (state === 'playing') jump(); }
    if (state === 'playing') {
      if (e.code === 'KeyG') throwGrenade();
      if (e.code === 'KeyR') startReload();
      if (e.code === 'KeyQ') cycleWeapon(1);
      if (e.code === 'KeyH') useMed();
      if (e.code === 'KeyC') crouch = !crouch;
      if (e.code === 'KeyM') toggleMap();
      const m = /^(Digit|Numpad)([1-9])$/.exec(e.code);
      if (m) switchWeapon(+m[2] - 1);
    }
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
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown = false; aimHeld = false; if (state === 'playing') pause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') pause(); });
  addEventListener('contextmenu', e => { if (state !== 'title') e.preventDefault(); });
  renderer.domElement.addEventListener('mousedown', e => {
    Sfx.init();
    if (state !== 'playing' || isTouch) return;
    if (needLock()) { requestLock(); return; }
    if (e.button === 0) { mouseDown = true; triggerQ = 0.25; }
    if (e.button === 2) aimHeld = true;
  });
  addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; if (e.button === 2) aimHeld = false; });
  addEventListener('wheel', e => { if (state === 'playing') cycleWeapon(e.deltaY > 0 ? 1 : -1); }, { passive: true });
  addEventListener('mousemove', e => {
    if (state !== 'playing' || isTouch) return;
    if (!locked && !lockFallback) return;
    look(e.movementX || 0, e.movementY || 0, 0.0022 * sens);
  });
  function look(dx, dy, k) {
    lookDX += dx; lookDY += dy;
    k *= camera.fov / BASE_FOV; // 开镜时瞄准慢一点，好瞄
    player.yaw -= dx * k;
    player.pitch = clamp(player.pitch - dy * k, -1.45, 1.45);
  }
  $('clickToPlay').addEventListener('click', () => { Sfx.init(); requestLock(); });

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
  holdBtn('tFire', () => { touchFire = true; triggerQ = 0.25; }, () => { touchFire = false; });
  holdBtn('tGrenade', () => throwGrenade());
  holdBtn('tJump', () => { touchJump = true; if (state === 'playing') jump(); }, () => { touchJump = false; });
  holdBtn('tHeal', () => useMed());
  holdBtn('tCrouch', () => { crouch = !crouch; $('tCrouch').classList.toggle('on', crouch); });
  holdBtn('tReload', () => { if (state === 'playing') startReload(); });
  holdBtn('tSwitch', () => { if (state === 'playing') cycleWeapon(1); });
  holdBtn('tAim', () => { aimToggle = !aimToggle; $('tAim').classList.toggle('on', aimToggle); });
  holdBtn('tMap', () => { if (state === 'playing') toggleMap(); });
  $('bigmap').addEventListener('click', () => toggleMap(false));

  function jump() {
    if (crouch) { crouch = false; $('tCrouch').classList.remove('on'); return; }
    if (player.onGround) { player.vel.y = 9; player.onGround = false; player.jumpsUsed = 1; Sfx.jump(); }
    else if (jet.has && jet.fuel > 0.05) { /* 有喷气背包：按住空格就是飞 */ }
    else if (player.jumpsUsed < S.jumps) { player.vel.y = 8.5; player.jumpsUsed++; Sfx.jump(); puff(player.pos, 2, 0.8, 0xffffff, 0.5); }
  }

  // ================= 关卡 =================
  const LEVELS = window.TSLevels;
  const NL = LEVELS.length;
  let objectives = [];
  let levelObjs = [];       // 这一关临时放进世界里的东西（关卡结束时拿走）
  function missionTitle() { return `第 ${missionNo} 关：${mission.name}`; }
  // 难度：一关比一关难（血更厚、打得更准、伤害更高、看得更远）
  function diffK() { return (missionNo - 1) / (NL - 1); }
  const D = {
    get hp() { return 1 + diffK() * 1.1; },
    get dmg() { return 0.75 + diffK() * 0.55; },
    get miss() { return lerp(1.7, 0.75, diffK()); },
    get rate() { return lerp(1.3, 0.8, diffK()); },
    get view() { return lerp(0.8, 1.15, diffK()); },
    get react() { return lerp(1.3, 0.55, diffK()); },
  };

  // 笼子（关着队友）
  function makeCage(x, z) {
    const g = new THREE.Group();
    const bar = new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6);
    const barMat = stdMat('cagebar', { color: 0x3a3a3a, metalness: 0.7, roughness: 0.4 });
    const bars = new THREE.Group();
    for (let i = 0; i < 16; i++) {
      const side = Math.floor(i / 4), k = (i % 4) / 4 - 0.5 + 0.125;
      const bx = [k * 2.3, 1.15, -k * 2.3, -1.15][side], bz = [1.15, k * 2.3, -1.15, -k * 2.3][side];
      const m = new THREE.Mesh(bar, barMat); m.position.set(bx, 1.2, bz); bars.add(m);
    }
    const top = new THREE.Mesh(B(2.5, 0.12, 2.5), barMat); top.position.y = 2.4; bars.add(top);
    const base = new THREE.Mesh(B(2.5, 0.12, 2.5), barMat); base.position.y = 0.06; bars.add(base);
    g.add(bars);
    const hostage = makeSoldier('hostage');
    g.add(hostage.g);
    const ob = addOb(x, z, 2.5, 2.5, 2.45, g, 'cage');
    levelObjs.push(g);
    return { kind: 'cage', x, z, y: gy(x, z), g, bars, hostage, ob, prog: 0, done: false };
  }
  // 炸药目标：雷达天线、弹药堆、防空炮（模型在 js/world/build.js）
  function makeTarget(x, z, type) {
    const T = type === 'dish' ? W.B.dish(x, z) : type === 'aa' ? W.B.aaGun(x, z) : W.B.ammoCache(x, z, Math.random() * 3);
    levelObjs.push(T.g);
    T.g.traverse(c => { if (c.isMesh && c.material && c.material.envMapIntensity !== undefined) c.material.envMapIntensity = W.sky.envIntensity; });
    const light = glowSprite(0xff2020, 1.4, 0.9); light.position.set(0, type === 'dish' ? 5.6 : 3, 0); T.g.add(light);
    T.ob.mesh = T.g;
    const name = { dish: '雷达', aa: '防空炮', ammo: '弹药堆' }[type];
    return { kind: 'target', type, name, x, z, y: T.y, g: T.g, head: T.head, light, ob: T.ob, prog: 0, planted: false, fuse: 0, done: false, beep: 0 };
  }
  // 情报：一个发光的公文包
  const intelMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.5, metalness: 0.2 });
  function makeIntel(x, z) {
    const g = new THREE.Group();
    const y = groundAt(x, z, 0.3, 999);
    const box = new THREE.Mesh(B(0.5, 0.36, 0.12), intelMat); box.position.y = 0.95; g.add(box);
    const h = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.015, 6, 12, Math.PI), ARS.M.steel); h.position.y = 1.15; g.add(h);
    const table = new THREE.Mesh(B(0.9, 0.08, 0.6), stdMat('intelTable', { color: 0x6a4a2a, roughness: 0.8 })); table.position.y = 0.74; g.add(table);
    for (const [a, b] of [[-0.38, -0.24], [0.38, -0.24], [0.38, 0.24], [-0.38, 0.24]]) { const l = new THREE.Mesh(B(0.05, 0.74, 0.05), table.material); l.position.set(a, 0.37, b); g.add(l); }
    const s = glowSprite(0xffd23f, 1.6, 0.6); s.position.y = 1.1; g.add(s);
    shadowify(g);
    g.position.set(x, y, z);
    scene.add(g); levelObjs.push(g);
    return { kind: 'intel', x, z, y, g, glow: s, box, prog: 0, done: false };
  }
  // ================= 宝箱 =================
  // 每个任务地图上藏着几个军用宝箱：走过去站一会儿，答对一个英语单词就能打开。
  // 普通（绿光）/ 稀有（蓝光）/ 传说（金光）：越稀有开出的东西越好，可能有新枪和喷气背包。
  const RARITY = [
    { name: '普通宝箱', color: 0x5fe36a, css: '#6ee36a', trim: 0x3f8a3a },
    { name: '稀有宝箱', color: 0x4fb2ff, css: '#7fc8ff', trim: 0x2f6bd8 },
    { name: '传说宝箱', color: 0xffc83a, css: '#ffd23f', trim: 0xd8a020 },
  ];
  const chestTex = canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = '#4b5530'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 600, ['rgba(30,35,15,0.35)', 'rgba(140,150,100,0.18)', 'rgba(90,60,30,0.25)'], 2);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, w, 5); g.fillRect(0, h - 5, w, 5);
    g.fillStyle = 'rgba(240,230,190,0.75)'; g.font = 'bold 15px monospace'; g.textAlign = 'center';
    g.fillText('SUPPLY  ★  T-07', 64, 38);
    // 磕碰掉漆的地方露出金属
    for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(170,165,150,0.5)'; g.fillRect(Math.random() * w, Math.random() < 0.5 ? rand(0, 6) : rand(h - 6, h), rand(1, 4), rand(1, 2)); }
  });
  const chestN = normalTex(128, 64, (g, w, h) => {
    fillH(g, w, h, 128); grain(g, w, h, 800, 100, 160, 1.5);
    g.fillStyle = '#e0e0e0'; for (let y = 10; y < h - 8; y += 12) g.fillRect(0, y, w, 2);
  }, 2);
  const beamTex = canvasTex(8, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, h, 0, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.clearRect(0, 0, w, h); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  let chests = [];
  let chestHold = null;
  function makeChest(x, z, rar) {
    const R = RARITY[rar];
    const g = new THREE.Group();
    const body = stdMat('chestbody', { map: chestTex, normalMap: chestN, roughness: 0.62, metalness: 0.25 });
    const metal = stdMat('chestmetal', { color: 0x3a3d40, roughness: 0.35, metalness: 0.85 });
    const trim = stdMat('chesttrim' + rar, { color: R.trim, roughness: 0.3, metalness: 0.9, emissive: R.color, emissiveIntensity: 0.35 });
    const base = new THREE.Mesh(roundBox(1.3, 0.62, 0.8, 0.04, 2), body); base.position.y = 0.31; g.add(base);
    for (const sx of [-1, 1]) {
      const band = new THREE.Mesh(roundBox(0.08, 0.64, 0.84, 0.02, 1), metal); band.position.set(sx * 0.5, 0.31, 0); g.add(band);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.014, 6, 14, Math.PI), metal); handle.position.set(sx * 0.665, 0.42, 0); handle.rotation.set(0, Math.PI / 2, Math.PI); g.add(handle);
      for (const sz of [-1, 1]) { const cap = new THREE.Mesh(roundBox(0.12, 0.12, 0.12, 0.03, 1), metal); cap.position.set(sx * 0.62, 0.06, sz * 0.37); g.add(cap); }
    }
    const strip = new THREE.Mesh(roundBox(1.32, 0.05, 0.82, 0.015, 1), trim); strip.position.y = 0.6; g.add(strip);
    const lidPivot = new THREE.Group(); lidPivot.position.set(0, 0.62, -0.4); g.add(lidPivot);
    const lid = new THREE.Mesh(roundBox(1.32, 0.2, 0.82, 0.05, 2), body); lid.position.set(0, 0.1, 0.41); lidPivot.add(lid);
    for (const sx of [-1, 1]) { const lb = new THREE.Mesh(roundBox(0.08, 0.22, 0.86, 0.02, 1), metal); lb.position.set(sx * 0.5, 0.1, 0.41); lidPivot.add(lb); }
    const latch = new THREE.Mesh(roundBox(0.14, 0.16, 0.05, 0.015, 1), trim); latch.position.set(0, 0.56, 0.42); g.add(latch);
    // 里面发光（打开时露出来）
    const glow = glowSprite(R.color, 1.1, 0); glow.position.y = 0.75; g.add(glow);
    // 光柱：远远就能看见
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 16, 16, 1, true),
      new THREE.MeshBasicMaterial({ map: beamTex, color: R.color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    beam.position.y = 8.3; g.add(beam);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 40), new THREE.MeshBasicMaterial({ color: R.color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; g.add(ring);
    g.traverse(c => { if (c.isMesh && c !== beam && c !== ring) { c.castShadow = true; c.receiveShadow = true; } });
    const cy = groundAt(x, z, 0.8, 999);
    g.position.set(x, cy, z);
    g.rotation.y = Math.random() * Math.PI * 2;
    scene.add(g);
    levelObjs.push(g);
    return { x, z, y: cy, rar, g, lidPivot, glow, beam, ring, prog: 0, opened: false, openT: 0, busy: false };
  }
  function setupChests() {
    const L = mission, sp = W.spots;
    const keyPts = [[player.pos.x, player.pos.z]].concat(L.stages.map(stagePoint).filter(Boolean).map(p => [p.x, p.z]));
    const near = sp.chests.filter(([x, z]) => keyPts.some(([a, b]) => Math.hypot(a - x, b - z) < 420) && Math.hypot(x - player.pos.x, z - player.pos.z) > 25);
    for (let i = near.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [near[i], near[j]] = [near[j], near[i]]; }
    const n = Math.min(near.length, 4 + (missionNo >= 6 ? 1 : 0));
    const spots = near.slice(0, n + 1);
    // 最后一个位置放喷气背包（第 2 关开始）
    const jp = missionNo >= 2 && spots.length > n ? spots.pop() : null;
    spots.slice(0, n).forEach(([x, z], i) => {
      const r = Math.random();
      let rar = r < 0.5 ? 0 : r < 0.85 ? 1 : 2;
      if (i === 0) rar = Math.max(rar, missionNo >= 5 ? 2 : 1); // 至少有一个好箱子
      chests.push(makeChest(x + rand(-2, 2), z + rand(-2, 2), rar));
    });
    if (jp && !jet.has) spawnPickup('jetpack', new THREE.Vector3(jp[0], gy(jp[0], jp[1]) + 1, jp[1]));
  }
  function clearChests() {
    chests.forEach(c => scene.remove(c.g));
    chests = [];
    chestHold = null;
  }
  function updateChests(dt, t) {
    chestHold = null;
    for (const c of chests) {
      c.ring.material.opacity = c.opened ? Math.max(0, c.ring.material.opacity - dt) : 0.35 + Math.sin(t * 3 + c.x) * 0.2;
      c.ring.scale.setScalar(1 + Math.sin(t * 2 + c.z) * 0.06);
      if (c.opened) {
        c.openT += dt;
        const k = Math.min(1, c.openT / 0.5);
        c.lidPivot.rotation.x = -k * k * (3 - 2 * k) * 1.9;
        c.glow.material.opacity = Math.max(0, 1 - c.openT / 3) * 0.55;
        c.beam.material.opacity = Math.max(0, 0.55 - c.openT * 0.3);
        if (c.beam.material.opacity <= 0) c.beam.visible = false;
        continue;
      }
      if (state !== 'playing' || c.busy) continue;
      const d = Math.hypot(player.pos.x - c.x, player.pos.z - c.z);
      if (d < 2.2 && Math.abs(player.pos.y - c.y) < 1.5) {
        c.prog += dt / 0.9;
        chestHold = { text: `🎁 正在打开${RARITY[c.rar].name}…`, v: c.prog };
        if (c.prog >= 1) openChest(c);
      } else c.prog = Math.max(0, c.prog - dt);
    }
  }
  async function openChest(c) {
    const id = gameId;
    c.busy = true;
    enterMenu();
    Sfx.chest();
    // 学习模式是必做的：答对 1 个英语单词才能打开宝箱
    await Learn.review(1, `🎁 ${RARITY[c.rar].name}`, '答对 1 个英语单词，就能打开宝箱！');
    if (id !== gameId) return;
    c.opened = true; c.openT = 0; c.busy = false;
    state = 'playing';
    const loot = rollLoot(c.rar);
    const p = new THREE.Vector3(c.x, c.y + 1, c.z);
    emit(p, RARITY[c.rar].color, 70, 7, 1.1, 5);
    spawnRing(p, RARITY[c.rar].color, 5, 0.6);
    for (let i = 0; i < 3 + c.rar * 2; i++) spawnPickup('medal', p);
    Sfx.levelUp();
    banner(`🎁 ${RARITY[c.rar].name}`, loot.join(' · '));
  }
  function rollLoot(rar) {
    const out = [];
    // 新枪
    const locked = WEAPONS.map((W, i) => i).filter(i => !unlocked(i));
    if (locked.length && Math.random() < [0.12, 0.45, 0.85][rar]) {
      const i = locked[Math.floor(Math.random() * locked.length)];
      found[WEAPONS[i].id] = true;
      try { localStorage.setItem('ts_found', JSON.stringify(found)); } catch (e) {}
      ammo[i].mag = magSize(i);
      out.push(`🔫 新武器：${WEAPONS[i].name}！（按 ${i + 1}）`);
      switchWeapon(i);
    }
    // 喷气背包
    if (!jet.has && Math.random() < [0.08, 0.3, 0.6][rar]) {
      jet.has = true; jet.fuel = 1;
      out.push('🚀 喷气背包！跳起来按住' + (isTouch ? ' ⬆ ' : '空格') + '飞');
    }
    // 药
    const nShot = [1, 1, 2][rar], nKit = [0, 1, 1][rar];
    meds.shot = Math.min(S.maxMeds, meds.shot + nShot);
    meds.kit = Math.min(S.maxMeds, meds.kit + nKit);
    out.push(`💉 急救针 +${nShot}` + (nKit ? ` · 🩹 急救包 +${nKit}` : ''));
    // 弹药
    const share = [0.35, 0.6, 1][rar];
    WEAPONS.forEach((W, k) => { if (W.reserve !== Infinity && unlocked(k)) addReserve(k, Math.ceil(W.maxRes * share * 0.5)); });
    out.push('📦 弹药补满' + (rar === 2 ? '' : '一些'));
    const g = [1, 2, 3][rar];
    grenadeCount = Math.min(S.maxGrenades, grenadeCount + g);
    out.push(`💣 手榴弹 +${g}`);
    const pts = [100, 250, 600][rar];
    score += pts;
    out.push(`⭐ +${pts} 分`);
    return out;
  }

  function clearObjectives() {
    for (const o of objectives) {
      if (o.ob) removeOb(o.ob);
      if (o.hostage) o.hostage.flashMats.forEach(m => m.dispose());
    }
    objectives = [];
    for (const g of levelObjs) if (g.parent) g.parent.remove(g);
    levelObjs = [];
  }

  // ---------- 直升机 ----------
  const padPos = new THREE.Vector3();
  const heli = (() => {
    const g = new THREE.Group();
    const olive = stdMat('heli', { color: 0x4f5d2f, roughness: 0.6, metalness: 0.2 });
    const dark = stdMat('helidark', { color: 0x2a2f22, roughness: 0.6 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x8fd0ff, roughness: 0.1, metalness: 0.4, transparent: true, opacity: 0.75 });
    const body = new THREE.Mesh(B(2.3, 2.0, 4.6), olive); body.position.set(0, 1.7, 0.2); g.add(body);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(1.15, 16, 12), olive); nose.scale.set(1, 0.88, 1.2); nose.position.set(0, 1.6, -2.1); g.add(nose);
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1.0, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass); cockpit.scale.set(1.02, 0.8, 1.15); cockpit.position.set(0, 1.85, -2.2); cockpit.rotation.x = -0.6; g.add(cockpit);
    const boom = new THREE.Mesh(B(0.55, 0.55, 5.2), olive); boom.position.set(0, 2.1, 4.9); g.add(boom);
    const fin = new THREE.Mesh(B(0.15, 1.5, 1.0), olive); fin.position.set(0, 2.9, 7.3); g.add(fin);
    const stab = new THREE.Mesh(B(2.0, 0.1, 0.6), olive); stab.position.set(0, 2.1, 6.8); g.add(stab);
    const cowl = new THREE.Mesh(B(1.3, 0.55, 2.0), dark); cowl.position.set(0, 2.95, 0.6); g.add(cowl);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 8), dark); mast.position.set(0, 3.4, 0.3); g.add(mast);
    const rotor = new THREE.Group(); rotor.position.set(0, 3.65, 0.3); g.add(rotor);
    for (let i = 0; i < 2; i++) { const bl = new THREE.Mesh(B(10.8, 0.05, 0.34), dark); bl.rotation.y = i * Math.PI / 2; rotor.add(bl); }
    const tail = new THREE.Group(); tail.position.set(0.18, 2.9, 7.4); g.add(tail);
    for (let i = 0; i < 2; i++) { const bl = new THREE.Mesh(B(0.04, 1.6, 0.16), dark); bl.rotation.x = i * Math.PI / 2; tail.add(bl); }
    for (const sx of [-1, 1]) {
      const skid = new THREE.Mesh(CYL(0.07, 4.6, 8), dark); skid.position.set(sx * 1.15, 0.08, 0); g.add(skid);
      for (const z of [-1.2, 1.2]) { const st = new THREE.Mesh(B(0.08, 0.7, 0.08), dark); st.position.set(sx * 1.05, 0.45, z); st.rotation.z = sx * 0.25; g.add(st); }
      const emb = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshStandardMaterial({ map: flagTex, roughness: 0.8 }));
      emb.position.set(sx * 1.16, 1.9, 0.9); emb.rotation.y = sx * Math.PI / 2; g.add(emb);
      const door = new THREE.Mesh(B(0.02, 1.3, 1.4), dark); door.position.set(sx * 1.16, 1.5, -0.6); g.add(door);
    }
    const beacon = glowSprite(0x6ee36a, 2.2, 0.9); beacon.position.set(0, 4.2, 0.3); beacon.visible = false; g.add(beacon);
    shadowify(g);
    scene.add(g);
    return { g, rotor, tail, beacon, mode: 'landed', t: 0, spin: 0 };
  })();
  function heliLand() { heli.mode = 'landed'; heli.g.visible = true; heli.g.position.copy(padPos); heli.g.rotation.set(0, 0, 0); heli.spin = 1; }
  function heliLeave() { heli.mode = 'leave'; heli.t = 0; heli.g.visible = true; }
  function heliArrive() { heli.mode = 'arrive'; heli.t = 0; heli.g.visible = true; heli.beacon.visible = true; Sfx.wave(); }
  function updateHeli(dt) {
    heli.t += dt;
    const g = heli.g;
    if (heli.mode === 'leave') {
      const t = heli.t;
      heli.spin = Math.min(1, heli.spin + dt);
      if (t > 1) {
        const k = t - 1;
        g.position.set(padPos.x, padPos.y + Math.min(60, k * k * 2.2), padPos.z + Math.max(0, k - 1.5) ** 2 * 6);
        g.rotation.x = Math.min(0.25, Math.max(0, k - 1.5) * 0.15);
      }
      if (t > 9) { heli.mode = 'gone'; g.visible = false; }
    } else if (heli.mode === 'arrive') {
      const T = 8, t = Math.min(1, heli.t / T);
      const e = 1 - Math.pow(1 - t, 3);
      g.position.set(padPos.x + Math.sin(t * Math.PI) * 6, padPos.y + lerp(45, 0, Math.min(1, e * 1.05)), lerp(padPos.z + 160, padPos.z, e));
      g.rotation.set(-0.2 * (1 - t), 0, Math.sin(t * Math.PI) * -0.15);
      heli.spin = 1;
      if (t >= 1) { heli.mode = 'landed'; g.position.copy(padPos); g.rotation.set(0, 0, 0); banner('直升机到了！', '快跑上直升机撤离！🚁'); }
    }
    heli.rotor.rotation.y += dt * 22 * heli.spin;
    heli.tail.rotation.x += dt * 30 * heli.spin;
    if (heli.beacon.visible) heli.beacon.material.opacity = 0.4 + Math.abs(Math.sin(heli.t * 4)) * 0.6;
  }

  // ================= 界面按钮 =================
  function refreshToggles() {
    const L = Learn.enabled;
    ['soundToggle', 'soundToggle2'].forEach(id => { $(id).textContent = `🔊 音效：${Sfx.soundOn ? '开' : '关'}`; $(id).classList.toggle('off', !Sfx.soundOn); });
    ['musicToggle', 'musicToggle2'].forEach(id => { $(id).textContent = `🎵 音乐：${Sfx.musicOn ? '开' : '关'}`; $(id).classList.toggle('off', !Sfx.musicOn); });
    const QN = { auto: '自动', high: '高', medium: '中', low: '省电' };
    ['qualityToggle', 'qualityToggle2'].forEach(id => { $(id).textContent = `🎨 画质：${QN[fx.pref]}${fx.pref === 'auto' ? '（' + QN[fx.tier] + '）' : ''}`; });
    $('learnBadge').textContent = '📚 学习模式';
    $('learnTip').textContent = L
      ? `📚 学习模式一直开着：出发、升级、开宝箱、复活前都要答对英语单词！已学会 ${Learn.seenCount()} / ${Learn.total} 个单词`
      : '学习模式已关闭';
  }
  function bind(id, fn) { $(id).addEventListener('click', () => { Sfx.init(); fn(); }); }
  // 平板：点武器栏直接换枪
  $('wSlots').addEventListener('touchstart', e => { const el = e.target.closest('.w-slot'); if (el && state === 'playing') { e.preventDefault(); switchWeapon(+el.dataset.i); } }, { passive: false });
  bind('soundToggle', () => { Sfx.setSound(!Sfx.soundOn); refreshToggles(); });
  bind('soundToggle2', () => { Sfx.setSound(!Sfx.soundOn); refreshToggles(); });
  bind('musicToggle', () => { Sfx.setMusic(!Sfx.musicOn); refreshToggles(); });
  bind('musicToggle2', () => { Sfx.setMusic(!Sfx.musicOn); refreshToggles(); });
  const nextQ = () => { const L = ['auto', 'high', 'medium', 'low']; fx.setPref(L[(L.indexOf(fx.pref) + 1) % L.length]); refreshToggles(); };
  bind('qualityToggle', nextQ);
  bind('qualityToggle2', nextQ);
  bind('startBtn', () => showMissions());
  bind('mBack', () => { $('missions').classList.add('hidden'); $('title').classList.remove('hidden'); });
  bind('brGo', () => startMission(false));
  bind('cpNext', () => nextMission());
  bind('cpHome', () => toTitle());
  bind('againBtn', () => startMission(true));
  bind('homeBtn', () => toTitle());
  bind('restartBtn', () => startMission(true));
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
    mouseDown = false; touchFire = false; aimHeld = false;
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
    mouseDown = false; touchFire = false; aimHeld = false;
    exitLock();
  }

  // ---------- 关卡选择 / 简报 ----------
  let runKeep = false; // 从“下一关”进入时保留升级
  function stars(n) { return [0, 1, 2].map(i => `<span class="${i < n ? '' : 'off'}">⭐</span>`).join(''); }
  const MAPN = { valley: '🌲 松林山谷', town: '🏘️ 山间小镇', fort: '🏰 鹰巢要塞' };
  const SKYN = { day: '白天', sunrise: '清晨', dusk: '黄昏', night: '夜晚' };
  function showMissions() {
    $('title').classList.add('hidden');
    const grid = $('mGrid');
    grid.innerHTML = '';
    let lastMap = '';
    LEVELS.forEach((m, i) => {
      if (m.map !== lastMap) {
        lastMap = m.map;
        const h = document.createElement('div'); h.className = 'm-map'; h.textContent = MAPN[m.map]; grid.appendChild(h);
      }
      const n = i + 1, open = i <= progress, st = starsSaved['L' + n] || 0;
      const d = document.createElement('div');
      d.className = 'm-card' + (open ? '' : ' locked');
      d.innerHTML = `<div class="mc-no">第 ${n} 关 · ${SKYN[m.sky]}</div><div class="mc-icon">${open ? m.icon : '🔒'}</div><div class="mc-name">${m.name}</div><div class="mc-desc">${open ? m.stages.map(s => stageName(s)).join(' → ') : '先完成前面的关卡'}</div>${st ? `<div class="mc-stars">${'⭐'.repeat(st)}</div>` : ''}`;
      if (open) d.onclick = () => { Sfx.init(); Sfx.pickup(); $('missions').classList.add('hidden'); showBriefing(n, false); };
      grid.appendChild(d);
    });
    $('missions').classList.remove('hidden');
  }
  function stageName(s) {
    if (s.label) return s.label;
    return { extract: '坐直升机撤离', goto: '前往目标' }[s.t] || s.t;
  }
  function showBriefing(n, keep) {
    missionNo = n; mission = LEVELS[n - 1]; runKeep = keep;
    $('brTitle').textContent = missionTitle();
    $('brText').textContent = mission.brief;
    $('brObj').textContent = `🗺 ${MAPN[mission.map]} · ${SKYN[mission.sky]}　🎯 ` + mission.stages.map(stageName).join(' → ');
    const ws = WEAPONS.map((Wp, i) => unlocked(i) ? (Wp.unlock === n - 1 && Wp.unlock > 0 ? `🆕${Wp.name}` : Wp.name) : null).filter(Boolean);
    $('brNew').textContent = '🔫 可用武器：' + ws.join(' · ');
    $('briefing').classList.remove('hidden');
  }
  function nextMission() {
    $('complete').classList.add('hidden');
    if (missionNo >= NL) { toTitle(); return; }
    showBriefing(missionNo + 1, true);
  }

  // ================= 游戏流程 =================
  function clearWorld() {
    while (allies.length) removeAlly(0);
    while (enemies.length) removeEnemy(enemies[0]);
    corpses.forEach(c => { if (c.e.g.parent) c.e.g.parent.remove(c.e.g); c.e.v.flashMats.forEach(m => m.dispose()); }); corpses = [];
    while (pickups.length) removePickup(0);
    for (const o of ebullets) { o.alive = false; o.mesh.visible = false; }
    for (const g of grenades) { g.alive = false; g.mesh.visible = false; }
    for (const r of rockets) { r.alive = false; r.mesh.visible = false; }
    clearObjectives();
    clearChests();
    clearDecals();
    healT = 0; healKind = null; healRoot.visible = false;
    boss = null;
    areaStats = {};
    $('bossbox').classList.add('hidden');
    $('holdBar').classList.add('hidden');
    $('reloadTip').classList.add('hidden');
    $('scope').classList.add('hidden');
    $('edgeWarn').classList.add('hidden');
    toggleMap(false);
    markersEl.innerHTML = ''; markerPool.length = 0;
  }
  function hideScreens() {
    ['title', 'missions', 'briefing', 'complete', 'pause', 'upgrade', 'over', 'book'].forEach(id => $(id).classList.add('hidden'));
  }
  async function toTitle() {
    const id = ++gameId;
    clearWorld();
    hideScreens();
    exitLock();
    $('quiz').classList.add('hidden');
    $('hud').classList.add('hidden');
    $('clickToPlay').classList.add('hidden');
    bannerEl.classList.add('hidden');
    gunRoot.visible = false;
    camera.fov = BASE_FOV; camera.updateProjectionMatrix();
    state = 'title';
    if (!W) {
      await ensureWorld('valley', 'day');
      if (id !== gameId) return;
    }
    showLoading(false);
    $('title').classList.remove('hidden');
    $('bestScore').textContent = best;
    const home = W.spots.home;
    padPos.set(home.pad.x, home.pad.y != null ? home.pad.y : gy(home.pad.x, home.pad.z), home.pad.z);
    heliLand(); heli.beacon.visible = false;
    // 开始界面：队友在直升机前面集合，远处有几个坏蛋
    S.maxAllies = 6;
    const yaw = 0;
    for (let i = 0; i < 4; i++) {
      const x = padPos.x - 3 + i * 2, z = padPos.z - 7 - Math.abs(i - 1.5) * 0.6;
      addAlly(new THREE.Vector3(x, gy(x, z), z), true);
    }
    allies.forEach(a => { a.g.rotation.y = Math.PI + yaw; a.title = true; });
    const props = [['grunt', -6, -18], ['heavy', 0, -22], ['runner', 6, -18], ['drone', 3, -20]];
    for (const [t, x, z] of props) spawnEnemy(t, new THREE.Vector3(padPos.x + x, 0, padPos.z + z), { prop: true });
    refreshToggles();
  }

  async function startMission(retry) {
    const id = ++gameId;
    clearWorld();
    hideScreens();
    $('quiz').classList.add('hidden');
    if (!retry && !runKeep) resetRun();
    runKeep = false;
    mission = LEVELS[missionNo - 1];
    state = 'loading';
    await ensureWorld(mission.map, mission.sky);
    if (id !== gameId) return;
    Learn.resetSession();
    hp = S.maxHp; invuln = 0; combo = 0; pendingLevels = 0; revivesLeft = 2; revivesUsed = 0; missionKills = 0; missionTime = 0;
    grenadeCount = Math.max(grenadeCount, 3);
    ammo.forEach((A, i) => { A.mag = magSize(i); });
    reloadT = 0; switchT = 0; aimT = 0; aimToggle = false; $('tAim').classList.remove('on'); autoReloadT = -1;
    boltT = 0; pumpT = 0; heat = 0; recP = 0; recY = 0; crouch = false; $('tCrouch').classList.remove('on');
    jet.has = false; jet.fuel = 1; jet.tipShown = false;
    meds.shot = Math.max(meds.shot, 1);
    // 每次出发至少带一些备用子弹
    WEAPONS.forEach((Wp, i) => { if (Wp.reserve !== Infinity) ammo[i].res = Math.max(ammo[i].res, Wp.reserve); });
    if (!unlocked(curW)) curW = 2;
    const fresh = WEAPONS.findIndex(Wp => Wp.unlock === missionNo - 1 && Wp.unlock > 0);
    if (fresh >= 0 && unlocked(fresh) && !retry) curW = fresh;
    showGun();
    // 出发点：直升机把我们放下来
    const [sx, sz] = mission.start;
    player.pos.set(sx, groundAt(sx, sz, 0.45, 999), sz); player.vel.set(0, 0, 0);
    const first = stagePoint(mission.stages[0]);
    player.yaw = first ? Math.atan2(-(first.x - sx), -(first.z - sz)) : 0; player.pitch = -0.03;
    fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw)); right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
    W.warm(sx, sz);
    const hx = sx + fwd.x * -9 + right.x * 6, hz = sz + fwd.z * -9 + right.z * 6;
    padPos.set(hx, gy(hx, hz), hz);
    heliLand(); heli.beacon.visible = false;
    heli.g.rotation.y = player.yaw;
    for (let i = 0; i < S.allyCount; i++) {
      const x = sx + right.x * SLOTS[i][0] - fwd.x * SLOTS[i][1], z = sz + right.z * SLOTS[i][0] - fwd.z * SLOTS[i][1];
      addAlly(new THREE.Vector3(x, gy(x, z), z), true);
    }
    setupLevel();
    gunRoot.visible = true;
    showLoading(false);
    $('hud').classList.remove('hidden');
    refreshToggles();
    enterMenu();
    await Learn.learnNew(mission.stages.some(s => s.t === 'boss') ? 3 : 2, '📚 出发前先背单词');
    if (id !== gameId) return;
    state = 'playing';
    requestLock();
    heliLeave();
    banner(missionTitle(), stageName(mission.stages[0]));
    Sfx.wave();
  }

  // ---------- 关卡里的东西 ----------
  let areaStats = {};
  function stagePoint(st) {
    if (!st || !W) return null;
    const sp = W.spots;
    if (st.t === 'clear' || st.t === 'survive' || st.t === 'boss') { const a = sp.areas[st.area]; return a ? { x: a.x, z: a.z } : null; }
    if (st.t === 'goto') return { x: st.at[0], z: st.at[1] };
    if (st.t === 'extract') return extractPoint(st);
    const list = st.t === 'rescue' ? sp.cages[st.cages] : st.t === 'demo' ? sp.targets[st.targets] : sp.intel[st.spots];
    if (!list || !list.length) return null;
    let sx = 0, sz = 0; for (const p of list) { sx += p[0]; sz += p[1]; }
    return { x: sx / list.length, z: sz / list.length };
  }
  function extractPoint(st) {
    if (typeof st.at === 'string') { const e = W.spots.extract[st.at]; return { x: e.x, z: e.z, y: e.y }; }
    return { x: st.at[0], z: st.at[1] };
  }
  function setupLevel() {
    mst = { stage: 0, phase: 'fight', timer: 0, waveT: 3, doneT: 0, bossSpawned: false, bossT: 2.5 };
    const sp = W.spots;
    // 驻守的敌人
    for (const gar of mission.garrison) spawnGarrison(gar);
    // 任务目标（所有阶段的都先摆好）
    mission.stages.forEach((st, si) => {
      let list = null;
      if (st.t === 'rescue') list = (sp.cages[st.cages] || []).map(([x, z]) => makeCage(x, z));
      if (st.t === 'demo') list = (sp.targets[st.targets] || []).map(([x, z, type]) => makeTarget(x, z, type));
      if (st.t === 'intel') list = (sp.intel[st.spots] || []).map(([x, z]) => makeIntel(x, z));
      if (list) list.forEach(o => { o.stage = si; objectives.push(o); });
    });
    setupChests();
    startStage(0);
  }
  function spawnGarrison(gar) {
    const A = W.spots.areas[gar.area];
    if (!A) return;
    const guards = A.guards.slice();
    const high = guards.filter(g => g[1] != null);
    const low = guards.filter(g => g[1] == null);
    for (let i = low.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [low[i], low[j]] = [low[j], low[i]]; }
    for (let i = high.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [high[i], high[j]] = [high[j], high[i]]; }
    const st = areaStats[gar.area] || (areaStats[gar.area] = { total: 0, dead: 0 });
    let hi = 0, lo = 0;
    const put = (type, spot, isStatic) => {
      const p = new THREE.Vector3(spot[0] + (isStatic ? 0 : rand(-1.5, 1.5)), spot[1] != null ? spot[1] : 0, spot[2] + (isStatic ? 0 : rand(-1.5, 1.5)));
      const e = spawnEnemy(type, p, { area: gar.area, static: isStatic, y: spot[1] });
      st.total++;
      return e;
    };
    // 狙击手先占塔楼和屋顶
    for (let k = 0; k < (gar.snipers || 0); k++) {
      if (hi < high.length) put('sniper', high[hi++], true);
      else if (low.length) put('sniper', low[lo++ % low.length], false);
    }
    for (let k = 0; k < gar.n; k++) {
      const type = pickType(gar.pool);
      if (type !== 'drone' && type !== 'heavy' && hi < high.length && Math.random() < 0.35) put(type, high[hi++], true);
      else if (low.length) put(type, low[lo++ % low.length], false);
      else put(type, [A.x + rand(-A.r, A.r) * 0.5, null, A.z + rand(-A.r, A.r) * 0.5], false);
    }
  }
  function pickType(pool) {
    const tot = pool.reduce((s, o) => s + o[1], 0);
    let r = Math.random() * tot;
    for (const o of pool) { r -= o[1]; if (r <= 0) return o[0]; }
    return pool[0][0];
  }
  function curStage() { return mission && mst ? mission.stages[mst.stage] : null; }
  function startStage(i) {
    mst.stage = i;
    const st = mission.stages[i];
    mst.timer = st.time || 0;
    mst.waveT = 4;
    if (st.t === 'extract') {
      const e = extractPoint(st);
      padPos.set(e.x, e.y != null ? e.y : gy(e.x, e.z), e.z);
      heliArrive();
    }
    if (st.t === 'boss') { mst.bossSpawned = false; mst.bossT = 2.5; }
    if (i > 0) { banner('下一步', stageName(st)); Sfx.wave(); }
  }
  function nextStage() {
    if (mst.stage + 1 >= mission.stages.length) { missionDone(); return; }
    startStage(mst.stage + 1);
  }
  // 增援：从远处跑过来，一来就知道你在哪
  function spawnWave(st, w) {
    const A = st.area ? W.spots.areas[st.area] : null;
    const c = A ? { x: A.x, z: A.z } : { x: player.pos.x, z: player.pos.z };
    let best = null;
    for (let k = 0; k < 8; k++) {
      let x, z;
      if (w.from) { x = w.from[0] + rand(-40, 40); z = w.from[1] + rand(-40, 40); }
      else { const a = Math.random() * Math.PI * 2, r = rand(85, 130); x = c.x + Math.cos(a) * r; z = c.z + Math.sin(a) * r; }
      x = clamp(x, -LIM + 10, LIM - 10); z = clamp(z, -LIM + 10, LIM - 10);
      const y = gy(x, z);
      if (W.map.lake && y < W.map.water + 0.5) continue;
      best = [x, z];
      if (!lineOfSight(tmpV.set(x, y + 1.6, z), tmpV2.set(player.pos.x, player.pos.y + 1.6, player.pos.z))) break;
    }
    if (!best) return;
    const n = Math.random() < 0.45 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const e = spawnEnemy(pickType(w.pool), new THREE.Vector3(best[0] + rand(-3, 3), 0, best[1] + rand(-3, 3)), { area: 'wave' });
      alertEnemy(e, 0);
    }
  }
  function wait(ms) {
    return new Promise(res => {
      let left = ms;
      const iv = setInterval(() => {
        if (state === 'playing' || state === 'menu' || state === 'dead') left -= 100;
        if (left <= 0 || state === 'title' || state === 'over' || state === 'complete') { clearInterval(iv); res(); }
      }, 100);
    });
  }
  function areaLeft(area) { return enemies.filter(e => e.area === area && !e.minion).length; }

  function updateMission(dt) {
    missionTime += dt;
    const st = curStage();
    let objText = '', holdText = null, holdVal = 0;
    // 增援
    let waves = st && st.waves;
    if (!waves && st && st.t === 'extract' && missionNo >= 3) waves = { pool: [['grunt', 3], ['runner', 1]], gap: 7, max: 3 + Math.floor(missionNo / 4) };
    if (waves && mst.phase === 'fight') {
      mst.waveT -= dt;
      const alive = enemies.filter(e => e.area === 'wave').length;
      if (mst.waveT <= 0 && alive < waves.max) {
        mst.waveT = waves.gap * rand(0.7, 1.2) * (st.t === 'survive' ? Math.max(0.6, mst.timer / st.time) : 1);
        spawnWave(st, waves);
      }
    }
    // 目标：救人、放炸药、拿情报
    for (const o of objectives) {
      if (o.done) continue;
      if (o.kind === 'target' && o.planted) {
        o.fuse -= dt; o.beep -= dt;
        o.light.material.opacity = Math.floor(o.fuse * 6) % 2 ? 1 : 0.2;
        if (o.beep <= 0) { o.beep = 1; Sfx.empty(); floatText(tmpV.set(o.x, o.y + 5.5, o.z), String(Math.ceil(o.fuse)), '#ff5a5a', 40); }
        if (o.fuse <= 0) {
          o.done = true;
          const p = new THREE.Vector3(o.x, o.y + 2.5, o.z);
          explode(p, 4.5);
          for (let k = 0; k < 4; k++) explode(new THREE.Vector3(o.x + rand(-2, 2), o.y + rand(1, 5), o.z + rand(-2, 2)), 2, true);
          blastDamage(p, 7, 20);
          removeOb(o.ob);
          screenFlash('#ffb347', 0.35);
          alertNear(p, 150);
          const left = objectives.filter(x => x.kind === 'target' && x.stage === o.stage && !x.done).length;
          banner(`${o.name}炸毁！`, left ? `还剩 ${left} 个，继续！` : '全部炸毁！');
        }
        continue;
      }
      if (!st || o.stage !== mst.stage || mst.phase !== 'fight') continue;
      const d = Math.hypot(player.pos.x - o.x, player.pos.z - o.z);
      const near = d < (o.kind === 'target' ? 3.4 : o.kind === 'intel' ? 1.8 : 3.2) && Math.abs(player.pos.y - o.y) < 3;
      const need = o.kind === 'cage' ? 2 : o.kind === 'intel' ? 0.8 : 3;
      if (near || o.force) {
        o.prog += dt / need;
        holdText = o.kind === 'cage' ? '🔓 营救队友中… 站着别动！' : o.kind === 'intel' ? '💼 拿情报…' : `💣 在${o.name}上安放炸药…`;
        holdVal = o.prog;
        if (o.prog >= 1) {
          if (o.kind === 'cage') {
            o.done = true;
            o.g.remove(o.bars);
            o.g.remove(o.hostage.g);
            o.hostage.flashMats.forEach(mm => mm.dispose());
            o.hostage = null;
            removeOb(o.ob);
            addAlly(new THREE.Vector3(o.x, o.y, o.z));
            S.allyCount = Math.min(S.maxAllies, S.allyCount + 1);
            puff(tmpV.set(o.x, o.y + 1, o.z), 6, 2, 0xffffff, 1);
            Sfx.recruit();
            centerText('🪖 队友获救，加入战斗！', '#7fc8ff', 34);
          } else if (o.kind === 'intel') {
            o.done = true;
            if (o.g.parent) o.g.parent.remove(o.g);
            emit(tmpV.set(o.x, o.y + 1, o.z), 0xffd23f, 30, 5, 0.8, 3);
            Sfx.levelUp();
            score += 150;
            centerText('💼 拿到情报！+150', '#ffd23f', 34);
          } else {
            o.planted = true; o.fuse = 5; o.beep = 0;
            Sfx.pickup();
            centerText('💣 炸药装好了！快跑开！', '#ff8a1f', 34);
          }
        }
      } else o.prog = Math.max(0, o.prog - dt * 0.15);
    }
    if (st && mst.phase === 'fight') {
      if (st.t === 'clear') {
        const a = areaStats[st.area] || { total: 0, dead: 0 };
        const need = st.need ? Math.min(st.need, a.total) : a.total;
        objText = `${stageName(st)}：消灭 ${Math.min(a.dead, need)}/${need}`;
        if (a.dead >= need) nextStage();
      } else if (st.t === 'rescue' || st.t === 'demo' || st.t === 'intel') {
        const mine = objectives.filter(o => o.stage === mst.stage);
        const done = mine.filter(o => o.done).length;
        objText = `${stageName(st)} ${done}/${mine.length}`;
        if (done >= mine.length) nextStage();
      } else if (st.t === 'survive') {
        mst.timer -= dt;
        const s = Math.max(0, Math.ceil(mst.timer));
        objText = `${stageName(st)} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        if (mst.timer <= 0) {
          enemies.filter(e => e.area === 'wave').forEach(e => poofEnemy(e));
          banner('守住了！', '干得漂亮！');
          nextStage();
        }
      } else if (st.t === 'goto') {
        const d = Math.hypot(player.pos.x - st.at[0], player.pos.z - st.at[1]);
        objText = `${stageName(st)}（还有 ${Math.round(d)} 米）`;
        if (d < (st.r || 12)) nextStage();
      } else if (st.t === 'boss') {
        if (!mst.bossSpawned) {
          const A = W.spots.areas[st.area];
          const d = Math.hypot(player.pos.x - A.x, player.pos.z - A.z);
          objText = d > 80 ? `${stageName(st)}：去要塞里面（${Math.round(d)} 米）` : '坏蛋司令要来了…';
          if (d < 80) mst.bossT -= dt;
          if (mst.bossT <= 0) {
            mst.bossSpawned = true;
            const e = spawnEnemy('boss', new THREE.Vector3(A.x, 0, A.z - 20));
            e.spawnIn = 1;
            alertEnemy(e, 0);
            boss = e;
            $('bossname').textContent = `👑 ${e.T.name}`;
            $('bossbox').classList.remove('hidden');
            banner('⚠ 坏蛋司令出现 ⚠', '他会放一圈子弹：跳起来躲开！', true);
            Sfx.warn();
            screenFlash('#ff3030', 0.3);
            shake = 1;
          }
        } else {
          objText = stageName(st);
          if (!boss) { enemies.filter(e => e.minion).forEach(e => poofEnemy(e)); nextStage(); }
        }
      } else if (st.t === 'extract') {
        objText = heli.mode === 'landed' ? '跑上直升机撤离！🚁' : '直升机马上就到…守住！';
        if (heli.mode === 'landed' && Math.hypot(player.pos.x - padPos.x, player.pos.z - padPos.z) < 7 && Math.abs(player.pos.y - padPos.y) < 4) {
          enemies.filter(e => e.alert).forEach(e => poofEnemy(e));
          missionDone();
        }
      }
    }
    if (mst.phase === 'done') objText = '✅ 任务完成！';
    setText('mObj', objText);
    if (!holdText && chestHold) { holdText = chestHold.text; holdVal = chestHold.v; }
    $('holdBar').classList.toggle('hidden', !holdText);
    if (holdText) { setText('holdLabel', holdText); setWidth('holdFill', Math.min(1, holdVal) * 100); }
    // 跑到地图边上了
    const edge = Math.max(Math.abs(player.pos.x), Math.abs(player.pos.z)) > LIM - 25;
    $('edgeWarn').classList.toggle('hidden', !edge);
  }
  async function missionDone() {
    if (mst.phase === 'done') return;
    const id = gameId;
    mst.phase = 'done';
    banner('任务完成！', '干得漂亮，特种兵！🎉');
    Sfx.complete();
    for (const p of pickups) if (p.kind === 'medal') p.forced = true;
    await wait(2600);
    if (id !== gameId) return;
    while (state !== 'playing' || pendingLevels > 0) {
      await wait(200);
      if (id !== gameId || state === 'over' || state === 'title') return;
    }
    if (id !== gameId) return;
    state = 'complete';
    exitLock();
    const st = 1 + (hp >= S.maxHp * 0.5 ? 1 : 0) + (revivesUsed === 0 ? 1 : 0);
    const key = 'L' + missionNo;
    if (!starsSaved[key] || starsSaved[key] < st) starsSaved[key] = st;
    if (missionNo > progress) progress = missionNo;
    const newBest = score > best;
    if (newBest) best = score;
    try {
      localStorage.setItem('ts2_progress', progress);
      localStorage.setItem('ts2_stars', JSON.stringify(starsSaved));
      localStorage.setItem('ts_best', best);
    } catch (e) {}
    $('cpTitle').textContent = missionNo === NL ? '🏆 基地安全了！你是英雄！' : '✅ 任务完成！';
    $('cpStars').innerHTML = stars(st);
    const newW = WEAPONS.filter(W => W.unlock === missionNo && !found[W.id]).map(W => W.name);
    const unlockMsg = tier === 1 && newW.length ? `<span class="newbest">🔓 新武器解锁：${newW.join('、')}！</span><br>` : '';
    $('cpStats').innerHTML = `
      ${unlockMsg}
      总分 <b>${score}</b> · 用时 <b>${Math.round(missionTime)}</b> 秒<br>
      打败 <b>${missionKills}</b> 个坏蛋 · 爆头 <b>${headshots}</b> 次 · 等级 <b>${level}</b><br>
      ${Learn.enabled ? `这次答对 <b>${Learn.sessionRight}</b> 个单词 📚<br>` : ''}
      ${newBest ? '<span class="newbest">🎉 新纪录！</span>' : `最高分 ${best}`}`;
    $('cpNext').textContent = missionNo === NL ? '🏠 回到主页' : '下一关 ▶';
    $('complete').classList.remove('hidden');
  }

  async function doLevelUp() {
    const id = gameId;
    enterMenu();
    Sfx.levelUp();
    emit(new THREE.Vector3(player.pos.x, player.pos.y + 1, player.pos.z), 0xffd23f, 50, 9, 1, 6);
    if (Learn.enabled) {
      await Learn.review(1, '⬆️ 升级啦！', '答对 1 个单词，解锁新能力！');
      if (id !== gameId) return;
    }
    showUpgrades();
  }
  const UPGRADES = [
    { icon: '🔥', name: '火力全开', desc: '冲锋枪、步枪、机枪、霰弹枪射速 +20%', apply() { S.fireRate *= 1.2; } },
    { icon: '💥', name: '穿甲弹', desc: '所有武器威力 +25%', apply() { S.dmg *= 1.25; } },
    { icon: '📦', name: '扩容弹匣', desc: '弹匣能多装 50% 子弹', ok: () => S.magMul < 2.5, apply() { S.magMul *= 1.5; ammo.forEach((A, i) => { A.mag = magSize(i); }); } },
    { icon: '⚡', name: '快速换弹', desc: '换弹速度快 35%', ok: () => S.reloadSpd < 2.5, apply() { S.reloadSpd *= 1.35; } },
    { icon: '💣', name: '手榴弹包', desc: '立刻拿到 4 颗手榴弹，最多能带 +2', apply() { S.maxGrenades += 2; grenadeCount = Math.min(S.maxGrenades, grenadeCount + 4); } },
    { icon: '☄️', name: '超级炸弹', desc: '手榴弹爆炸范围和威力 +30%', apply() { S.gRadius *= 1.3; S.gDmg *= 1.3; } },
    { icon: '🚀', name: '火箭补给', desc: '火箭弹 +3，榴弹 +6', ok: () => unlocked(RK) || unlocked(GL), apply() { addReserve(RK, 3); addReserve(GL, 6); } },
    { icon: '💉', name: '急救包', desc: '马上拿到 2 支急救针和 1 个急救包，最多能带 +2', apply() { S.maxMeds += 2; meds.shot += 2; meds.kit += 1; } },
    { icon: '🎒', name: '弹药兵', desc: '所有枪的备用子弹补满', apply() { WEAPONS.forEach((W, k) => addReserve(k, 9999)); } },
    { icon: '👟', name: '飞毛腿', desc: '跑得更快 +15%', ok: () => S.speed < 11, apply() { S.speed *= 1.15; } },
    { icon: '❤️', name: '钢铁之心', desc: '生命上限 +25，并且回满生命', apply() { S.maxHp += 25; hp = S.maxHp; } },
    { icon: '🪖', name: '呼叫支援', desc: '马上来 1 个特种兵队友', ok: () => allies.length < S.maxAllies, apply() { addAlly(); S.allyCount = Math.min(S.maxAllies, S.allyCount + 1); } },
    { icon: '🩹', name: '医疗兵', desc: '每秒自动回复 2 点生命', ok: () => S.regen < 6, apply() { S.regen += 2; } },
    { icon: '🦘', name: '弹簧靴', desc: '可以在空中再跳一次！', ok: () => S.jumps < 3, apply() { S.jumps++; } },
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
        centerText(u.icon + ' ' + u.name, '#ffd23f', 40);
        state = 'playing';
        requestLock();
      };
      cbox.appendChild(d);
    });
    $('upgrade').classList.remove('hidden');
  }

  function hurtPlayer(dmg) {
    if (invuln > 0 || state !== 'playing') return;
    hp -= dmg * (tier > 1 ? 1.25 : 1);
    invuln = 0.35;
    regenWait = 3;
    shake = Math.max(shake, 0.35);
    hurtFlash();
    Sfx.hurt();
    combo = 0;
    if (hp <= 0) playerDown();
  }
  async function playerDown() {
    const id = gameId;
    hp = 0;
    state = 'dead';
    mouseDown = false; touchFire = false; aimHeld = false;
    screenFlash('#ff3030', 0.6);
    Sfx.boom(true);
    await wait(1500);
    if (id !== gameId) return;
    exitLock();
    if (Learn.enabled && revivesLeft > 0) {
      state = 'menu';
      const ok = await Learn.review(2, '💖 复活机会！', `答对 2 个单词就能复活（这个任务还剩 ${revivesLeft} 次机会）`, '不复活了，任务失败');
      if (id !== gameId) return;
      if (ok) {
        revivesLeft--; revivesUsed++;
        hp = S.maxHp;
        invuln = 3;
        state = 'playing';
        if (!allies.length) addAlly();
        grenadeCount = Math.max(grenadeCount, 3);
        grenadeBlast(new THREE.Vector3(player.pos.x, player.pos.y + 1, player.pos.z));
        banner('复活！', '继续战斗！💪');
        return;
      }
    }
    missionFailed();
  }
  function missionFailed() {
    state = 'over';
    exitLock();
    const newBest = score > best;
    if (newBest) { best = score; try { localStorage.setItem('ts_best', best); } catch (e) {} }
    $('overTitle').textContent = '💥 任务失败';
    $('overStats').innerHTML = `
      ${missionTitle()}<br>
      分数 <b>${score}</b> · 打败 <b>${missionKills}</b> 个坏蛋<br>
      ${Learn.enabled ? `这次答对 <b>${Learn.sessionRight}</b> 个单词 📚<br>` : ''}
      别灰心！躲在掩体后面开枪，会更安全 💪`;
    $('over').classList.remove('hidden');
  }

  // ================= 每帧更新 =================
  function updatePlayer(dt) {
    fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
    const W = WEAPONS[curW];
    let mz = 0, mx = 0;
    if (keys.KeyW || keys.ArrowUp) mz += 1;
    if (keys.KeyS || keys.ArrowDown) mz -= 1;
    if (keys.KeyA || keys.ArrowLeft) mx -= 1;
    if (keys.KeyD || keys.ArrowRight) mx += 1;
    if (joy.id !== null) { mx += joy.x; mz -= joy.y; }
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    if (keys.ControlLeft || keys.ControlRight) crouch = true;
    sprintBlock -= dt;
    const wantSprint = ((keys.ShiftLeft || keys.ShiftRight) || (isTouch && joy.id !== null && joy.y < -0.92)) && mz > 0.5 && aimT < 0.3 && healT <= 0 && sprintBlock <= 0;
    if (wantSprint && crouch) { crouch = false; $('tCrouch').classList.remove('on'); }
    sprintK = clamp(sprintK + (wantSprint && player.onGround ? dt * 5 : -dt * 6), 0, 1);
    crouchK = clamp(crouchK + (crouch ? dt * 7 : -dt * 7), 0, 1);
    player.eyeH = lerp(1.65, 1.1, crouchK);
    const sprint = 1 + sprintK * 0.38;
    const spd = S.speed * sprint * (1 - aimT * 0.4) * lerp(1, 0.55, crouchK) * W.move * (healT > 0 ? 0.55 : 1) * (inWater ? 0.5 : 1);
    const wantX = (fwd.x * mz + right.x * mx) * spd, wantZ = (fwd.z * mz + right.z * mx) * spd;
    const acc = Math.min(1, dt * (player.onGround ? 12 : jet.on ? 7 : 4));
    player.vel.x += (wantX - player.vel.x) * acc;
    player.vel.z += (wantZ - player.vel.z) * acc;
    player.vel.y -= 24 * dt;
    // 喷气背包：在空中按住空格（平板按住 ⬆）就往上飞
    const jetHold = keys.Space || touchJump;
    jet.on = false;
    if (jet.has) {
      if (jetHold && !player.onGround && jet.fuel > 0 && state === 'playing') {
        jet.on = true;
        player.vel.y = Math.min(player.vel.y + 38 * dt, 7);
        jet.fuel = Math.max(0, jet.fuel - dt / 6);
        if (player.pos.y - gy(player.pos.x, player.pos.z) > 45) player.vel.y = Math.min(player.vel.y, 0);
        jet.sfxT -= dt;
        if (jet.sfxT <= 0) { jet.sfxT = 0.11; Sfx.jet(); }
        const fp = tmpV.set(player.pos.x - fwd.x * 0.35, player.pos.y + 0.7, player.pos.z - fwd.z * 0.35);
        emit(fp.clone().addScaledVector(right, -0.22), 0xff9a3a, 2, 2, 0.25, -6);
        emit(fp.clone().addScaledVector(right, 0.22), 0xff9a3a, 2, 2, 0.25, -6);
        if (Math.random() < 0.3) puff(fp, 1, 0.5, 0xd0c8b8, 0.7, 0.05);
        if (!jet.tipShown && player.pos.y > 4) { jet.tipShown = true; centerText('🚀 飞起来啦！在空中也能开枪', '#7fdcff', 30); }
      } else if (player.onGround) jet.fuel = Math.min(1, jet.fuel + dt * 0.28);
    }
    const p = player.pos;
    p.addScaledVector(player.vel, dt);
    pushOut(p, 0.45, p.y);
    p.x = clamp(p.x, -LIM, LIM); p.z = clamp(p.z, -LIM, LIM);
    let gh = groundAt(p.x, p.z, 0.45, p.y);
    // 湖里：水到胸口，走得慢
    const WR = getW();
    inWater = !!(WR && WR.map.lake && gh < WR.map.water - 0.9);
    if (inWater) gh = Math.max(gh, WR.map.water - 1.25);
    const wasAir = !player.onGround;
    if (p.y <= gh) {
      if (wasAir && player.vel.y < -9) { shake = Math.max(shake, 0.25); Sfx.land(); gunDip = Math.max(gunDip, 0.6); }
      p.y = gh; if (player.vel.y < 0) player.vel.y = 0; player.onGround = true; player.jumpsUsed = 0;
    }
    else player.onGround = p.y - gh < 0.05;
    const hs = Math.hypot(player.vel.x, player.vel.z);
    if (hs > 1 && player.onGround) {
      player.bob += dt * 11 * sprint * lerp(1, 0.7, crouchK);
      // 脚步声
      stepT -= dt * hs * (crouch ? 0.5 : 1);
      if (stepT <= 0) { stepT = 2.6; Sfx.step(); }
    }

    fireCool -= dt;
    grenadeCool -= dt;
    triggerQ -= dt;
    heat = Math.max(0, heat - dt * (W.mode === 'auto' ? 2.2 : 1.6));
    if (switchT > 0) switchT -= dt;
    if (boltT > 0) { const b0 = boltT; boltT -= dt; const half = W.rate * 0.45; if (b0 > half && boltT <= half) { ejectShell(curW); Sfx.bolt(); } }
    if (pumpT > 0) { const p0 = pumpT; pumpT -= dt; const half = Math.min(W.rate, 0.5) * 0.5; if (p0 > half && pumpT <= half) { if (W.mode === 'pump') ejectShell(curW); Sfx.pump(); } }
    if (reloadT > 0) { reloadT -= dt; if (reloadT <= 0) { reloadT = 0; finishReload(); } }
    if (autoReloadT > 0) { autoReloadT -= dt; if (autoReloadT <= 0) { autoReloadT = -1; startReload(); } }
    updateHeal(dt);
    const wantAim = (aimHeld || aimToggle) && reloadT <= 0 && switchT <= 0 && healT <= 0;
    aimT = clamp(aimT + (wantAim ? dt * 7 : -dt * 7), 0, 1);
    // 连发枪按住就一直打；半自动、泵动、栓动要一下一下点（平板上按住也会连着打）
    const held = mouseDown || touchFire;
    const pull = W.mode === 'auto' || isTouch ? held : triggerQ > 0;
    if (pull && fireCool <= 0) tryFire();
    if (invuln > 0) invuln -= dt;
    regenWait -= dt;
    if (S.regen > 0 && regenWait <= 0 && hp < S.maxHp) hp = Math.min(S.maxHp, hp + S.regen * dt);
  }

  const swing = x => x <= 0 ? 0 : x >= 1 ? 0 : Math.sin(x * Math.PI);
  const seg = (x, a, b) => clamp((x - a) / (b - a), 0, 1);
  function updateCamera(dt, t) {
    if (state === 'title') {
      const a = t * 0.1;
      const cx = padPos.x + Math.sin(a) * 26, cz = padPos.z - 10 + Math.cos(a) * 26;
      camera.position.set(cx, Math.max(gy(cx, cz) + 2.5, padPos.y + 6 + Math.sin(t * 0.3)), cz);
      camera.lookAt(padPos.x, padPos.y + 2, padPos.z - 10);
      return;
    }
    // 后坐力慢慢回正
    const rk = Math.min(1, dt * 9);
    recP -= recP * rk; recY -= recY * rk;
    eyePos(camera.position);
    camera.position.y += Math.sin(player.bob) * 0.05 * (1 - aimT) * (1 + sprintK * 0.6);
    camera.rotation.set(player.pitch + recP, player.yaw + recY, Math.sin(player.bob * 0.5) * 0.006 * sprintK);
    if (state === 'dead' || (state === 'menu' && hp <= 0) || state === 'over') {
      camera.position.y = player.pos.y + 0.5;
      camera.rotation.z = 0.5;
    }
    if (shake > 0) {
      camera.position.x += rand(-1, 1) * shake * 0.12;
      camera.position.y += rand(-1, 1) * shake * 0.12;
      camera.rotation.z += rand(-1, 1) * shake * 0.015;
      shake = Math.max(0, shake - dt * 2.5);
    }
    const W = WEAPONS[curW];
    const fov = lerp(BASE_FOV + sprintK * 4, W.fov, aimT);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    const scoped = W.scope && aimT > 0.9;
    $('scope').classList.toggle('hidden', !scoped);
    // 准星大小跟着子弹散布变：跑动、连发时变大，开镜时变小
    const moving = Math.hypot(player.vel.x, player.vel.z) > 2 || !player.onGround;
    const spreadNow = lerp(W.spread, W.adsSpread, aimT) * (moving ? 1.6 : 1) * (1 + heat * lerp(1.3, 0.5, aimT)) * (crouch ? 0.7 : 1);
    crossEl.classList.toggle('hidden', scoped || aimT > 0.8 || healT > 0 || sprintK > 0.6);
    const cs = clamp(spreadNow / 0.022, 0.5, 3.2);
    const ck = cs.toFixed(2);
    if (hudCache.cross !== ck) { hudCache.cross = ck; crossEl.style.setProperty('--gap', (8 * cs).toFixed(1) + 'px'); }
    // ---------- 手里的枪 ----------
    const gm = gunModels[curW];
    gunKick = Math.max(0, gunKick - dt * 10);
    gunDip = Math.max(0, gunDip - dt * 3);
    // 枪的惯性：转视角时枪会晚一点跟上
    const sk = Math.min(1, dt * 10);
    swayX += (clamp(-lookDX * 0.0005, -0.04, 0.04) - swayX) * sk;
    swayY += (clamp(lookDY * 0.0005, -0.03, 0.03) - swayY) * sk;
    lookDX = 0; lookDY = 0;
    const rlP = reloadT > 0 ? 1 - reloadT / reloadTotal : 0;
    const rl = reloadT > 0 ? (W.shell ? 0.35 + 0.15 * Math.sin(rlP * Math.PI) : swing(rlP)) : 0;
    const sw = switchT > 0 ? switchT / 0.4 : 0;
    const hl = healT > 0 ? clamp(Math.min((healTotal - healT) / 0.3, healT / 0.3), 0, 1) : 0;
    const bobK = (1 - aimT * 0.9) * (1 + sprintK * 1.5);
    const breathe = Math.sin(t * 1.7) * 0.003 * (1 - aimT * 0.6);
    const ax = -(gm.sightX || 0) * GS, ay = -gm.sightY * GS;
    const hx = lerp(W.hip[0], ax, aimT), hy = lerp(W.hip[1], ay, aimT), hz = lerp(W.hip[2], W.adsZ, aimT);
    const sx = sprintK * 0.03, sy = -sprintK * 0.05, sz = sprintK * 0.04;
    const bob1 = Math.cos(player.bob * 0.5), bob2 = Math.abs(Math.sin(player.bob * 0.5));
    const swayK = 1 - aimT * 0.7;
    gunRoot.position.set(
      hx + sx + bob1 * 0.012 * bobK + swayX * swayK - crouchK * 0.01 * (1 - aimT),
      hy + sy + bob2 * 0.014 * bobK + breathe + swayY * swayK - gunDip * 0.2 - rl * 0.1 - sw * 0.3 - hl * 0.35 - crouchK * 0.01 * (1 - aimT),
      hz + sz + gunKick * gm.kick * (aimT > 0.5 ? 0.6 : 1));
    gunRoot.rotation.set(
      gunKick * gm.kick * 1.4 - gunDip * 0.5 - rl * 0.45 - sprintK * 0.35 + swayY * 2 * swayK - hl * 0.6,
      lerp(0.05, 0, aimT) + sprintK * 0.55 + swayX * 3 * swayK,
      rl * 0.5 + recRoll * gunKick * 0.04 + sprintK * 0.25 + swayX * 2 * swayK);
    // 会动的零件：换弹时弹匣拔出来再插回去，套筒后坐，拉栓，拉泵，转弹鼓
    if (gm.mag) {
      const b = gm.mag.userData.base;
      let off = 0, vis = true;
      if (reloadT > 0 && !W.shell) {
        const out = seg(rlP, 0.15, 0.35), back = seg(rlP, 0.42, 0.65);
        off = out * 0.35 * (1 - back);
        vis = !(rlP > 0.35 && rlP < 0.42);
        if (rlP > 0.42) off = (1 - back) * 0.35;
      }
      gm.mag.position.set(b.x, b.y - off, b.z + off * 0.25);
      gm.mag.visible = vis;
    }
    if (gm.slide) {
      const empty = ammo[curW].mag === 0 && reloadT <= 0;
      gm.slide.position.z = gm.slide.userData.base.z + (empty ? 0.04 : gunKick * 0.045) + (reloadT > 0 && reloadEmpty ? 0.04 * (1 - seg(rlP, 0.8, 0.9)) : 0);
    }
    if (gm.bolt) {
      const bp = boltT > 0 ? 1 - boltT / W.rate : 0;
      const up = swing(seg(bp, 0.15, 0.9)), back = swing(seg(bp, 0.3, 0.75));
      gm.bolt.rotation.z = up * 1.1;
      gm.bolt.position.z = gm.bolt.userData.base.z + back * 0.07;
      gunRoot.rotation.z += up * 0.12;
    }
    if (gm.pump) {
      const pp = pumpT > 0 ? 1 - pumpT / Math.min(W.rate, 0.5) : 0;
      gm.pump.position.z = gm.pump.userData.base.z + swing(seg(pp, 0.1, 0.9)) * 0.08;
    }
    if (gm.drum) {
      drumA += (drumTarget - drumA) * Math.min(1, dt * 14);
      gm.drum.rotation.z = drumA + (reloadT > 0 ? rlP * Math.PI * 4 : 0);
    }
    // 打药时手里的急救针 / 急救包
    healRoot.visible = healT > 0;
    if (healT > 0) {
      const hp0 = 1 - healT / healTotal;
      const inK = clamp(Math.min((healTotal - healT) / 0.35, healT / 0.25), 0, 1);
      healRoot.position.set(0.07, -0.3 + inK * 0.16, -0.34);
      if (healKind === 'shot') {
        syringe.rotation.set(-0.2, 0.9 - seg(hp0, 0.15, 0.4) * 0.5, 0.25);
        const push = seg(hp0, 0.4, 0.85);
        plunger.position.z = 0.09 - push * 0.07;
        syringe.userData.liq.scale.z = 1 - push * 0.9;
        syringe.userData.liq.position.z = -0.012 - push * 0.05;
      } else {
        kitBox.rotation.set(0.5, -0.3, 0.05);
        bandage.position.set(0.02 + Math.sin(hp0 * 18) * 0.03, 0.07 + Math.abs(Math.sin(hp0 * 9)) * 0.05, 0);
        bandage.rotation.x = hp0 * 20;
      }
    }
    gunRoot.visible = !scoped && state !== 'dead' && hp > 0;
    muzzleT -= dt;
    muzzleFlash.visible = muzzleT > 0 && !W.scope;
    if (muzzleFlash.visible) {
      muzzleFlash.position.copy(gm.muzzle);
      const k = W.rocket ? 1.6 : W.pellets > 1 ? 1.25 : W.id === 'pistol' ? 0.6 : W.id === 'smg' ? 0.75 : 1;
      muzzleFlash.scale.setScalar(k * rand(0.85, 1.15));
      mfStar.material.rotation = Math.random() * 6.28;
      mfStar.scale.setScalar(rand(0.28, 0.4));
      mfSides.rotation.z = Math.random() * 6.28;
      mfSides.scale.set(1, 1, rand(0.6, 1.3));
      // 瞄准的时候正面火花小一点，不挡视线
      mfStar.material.opacity = aimT > 0.5 ? 0.45 : 1;
    }
    gunFlashLight.intensity = muzzleT > 0 ? 3 : 0;
    updateShells(dt);
  }

  function nearestEnemy(pos, range, needLos, alertOnly) {
    let bestE = null, bd = range * range;
    for (const e of enemies) {
      if (e.idle || e.spawnIn > 0 || (alertOnly && !e.alert)) continue;
      const dx = e.g.position.x - pos.x, dz = e.g.position.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bd) {
        if (needLos && !lineOfSight(tmpV.set(pos.x, pos.y + 1.5, pos.z), tmpV2.set(e.g.position.x, e.g.position.y + (e.T.drone ? 0 : 1.3 * e.s), e.g.position.z))) continue;
        bd = d; bestE = e;
      }
    }
    return bestE;
  }
  function faceTo(g, yaw, k) {
    let diff = yaw - g.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    g.rotation.y += diff * k;
  }
  function flashUpdate(v, dt) {
    if (v.flash > 0) { v.flash -= dt; v.flashMats.forEach(m => { m.emissive.setHex(0xffffff); m.emissiveIntensity = 0.9; }); v.flashing = true; }
    else if (v.flashing) { v.flashMats.forEach(m => { m.emissiveIntensity = 0; }); v.flashing = false; }
  }

  function updateAllies(dt, t, combat) {
    for (let i = allies.length - 1; i >= 0; i--) {
      const a = allies[i], g = a.g, v = a.v;
      if (state === 'title') {
        g.rotation.y = Math.PI + Math.sin(t * 0.7 + a.phase) * 0.25;
        Humans.animate(v, dt, 0);
        continue;
      }
      const slot = SLOTS[i % SLOTS.length];
      const tx = player.pos.x + right.x * slot[0] - fwd.x * slot[1], tz = player.pos.z + right.z * slot[0] - fwd.z * slot[1];
      const dx = tx - g.position.x, dz = tz - g.position.z;
      const dist = Math.hypot(dx, dz);
      let sp = 0;
      if (dist > 0.4 && state === 'playing') {
        sp = Math.min(dist * 2.2, S.speed * 1.25);
        g.position.x += dx / dist * sp * dt; g.position.z += dz / dist * sp * dt;
      }
      if (dist > 60 && player.onGround && state === 'playing') g.position.set(tx, player.pos.y, tz);
      pushOut(g.position, 0.5, g.position.y);
      g.position.x = clamp(g.position.x, -LIM, LIM); g.position.z = clamp(g.position.z, -LIM, LIM);
      g.position.y = groundAt(g.position.x, g.position.z, 0.4, g.position.y + 0.6);
      if (W && W.map.lake) g.position.y = Math.max(g.position.y, W.map.water - 1.25);
      a.speed = sp;
      const target = combat ? (a.tgtT > 0 && a.tgt && enemies.includes(a.tgt) ? a.tgt : null) : null;
      a.tgtT = (a.tgtT || 0) - dt;
      if (combat && a.tgtT <= 0) { a.tgtT = 0.5; a.tgt = nearestEnemy(g.position, 45, true, true); }
      const face = target ? Math.atan2(target.g.position.x - g.position.x, target.g.position.z - g.position.z) : (sp > 0.5 ? Math.atan2(dx, dz) : Math.atan2(-fwd.x, -fwd.z) + Math.PI);
      faceTo(g, face, Math.min(1, dt * 8));
      Humans.animate(v, dt, sp > 0.4 ? sp : 0);
      flashUpdate(v, dt);
      if (a.hurtT > 0) a.hurtT -= dt; else if (a.hp < a.maxHp) a.hp = Math.min(a.maxHp, a.hp + 3 * dt);
      if (!combat) continue;
      a.cool -= dt;
      if (target && a.cool <= 0) {
        a.cool = rand(0.6, 0.95);
        const from = new THREE.Vector3(g.position.x, g.position.y + 1.45, g.position.z).addScaledVector(tmpV.set(Math.sin(g.rotation.y), 0, Math.cos(g.rotation.y)), 0.9);
        const tp = new THREE.Vector3().copy(target.g.position); tp.y += target.T.drone ? 0 : 1.3 * target.s;
        tp.x += rand(-0.3, 0.3); tp.y += rand(-0.3, 0.3);
        spawnTracer(from, tp, 0x9ad8ff, 0.035, 0.06);
        spawnFlash(from, 0xffc060, 0.5, 0.06);
        emit(tp, 0xffe15a, 4, 4, 0.25, 1);
        damageEnemy(target, 0.8 * S.dmg, null, false, false);
        Sfx.shoot(camera.position.distanceTo(from));
      }
    }
  }

  // 敌人的眼睛：看得见玩家吗（距离、朝向、有没有东西挡着）
  const eyeA = new THREE.Vector3(), eyeB = new THREE.Vector3();
  function canSee(e, tgt, range) {
    const g = e.g.position;
    const dx = tgt.x - g.x, dz = tgt.z - g.z, d = Math.hypot(dx, dz);
    if (d > range) return false;
    if (!e.alert && d > 14) {
      // 没警觉的时候只看前面（120 度）
      const fx = Math.sin(e.g.rotation.y), fz = Math.cos(e.g.rotation.y);
      if ((dx * fx + dz * fz) / (d || 1) < -0.2) return false;
      // 蹲着、在草里更难被发现
      if (crouch && d > range * 0.55) return false;
      if (night && d > range * 0.6 && !torchOnHim(e)) return false;
    }
    eyeA.set(g.x, e.T.drone ? g.y : g.y + 1.55 * e.s, g.z);
    eyeB.set(tgt.x, tgt.y + (tgt === player.pos ? player.eyeH - 0.15 : 1.4), tgt.z);
    return lineOfSight(eyeA, eyeB);
  }
  function torchOnHim(e) {
    const dx = e.g.position.x - player.pos.x, dz = e.g.position.z - player.pos.z, d = Math.hypot(dx, dz) || 1;
    return (dx * fwd.x + dz * fwd.z) / d > 0.85;
  }
  function updateEnemies(dt, t) {
    const pp = player.pos;
    const cam = camera.position;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i], g = e.g, v = e.v;
      const camD = Math.hypot(g.position.x - cam.x, g.position.z - cam.z);
      g.visible = camD < 420;
      if (e.idle) {
        g.rotation.y = Math.atan2(cam.x - g.position.x, cam.z - g.position.z);
        if (e.T.drone) { g.position.y = e.home.y + 4 + Math.sin(t * 2 + e.phase) * 0.3; v.rotors.forEach(r => { r.rotation.y += dt * 30; }); }
        else Humans.animate(v, dt, 0);
        continue;
      }
      if (e.spawnIn > 0) {
        e.spawnIn -= dt;
        g.scale.setScalar(e.s * Math.max(0.01, 1 - e.spawnIn / (e.T.boss ? 1 : 0.5)));
        continue;
      }
      g.scale.setScalar(e.s);
      if (state !== 'playing') { if (camD < 160 && !e.T.drone) Humans.animate(v, dt, 0); continue; }
      const range = (e.T.view || 60) * D.view;
      // ---------- 还没发现你：站岗 / 走来走去 ----------
      if (!e.alert) {
        if (e.alertIn >= 0) {
          e.alertIn -= dt;
          faceTo(g, Math.atan2(pp.x - g.position.x, pp.z - g.position.z), Math.min(1, dt * 6));
          if (e.alertIn <= 0) { e.alert = true; e.alertIn = -1; e.last.copy(pp); e.shootT = rand(0.3, 0.9); alertNear(g.position, 30); }
        } else {
          e.seeT -= dt;
          if (e.seeT <= 0 && Math.abs(g.position.x - pp.x) < 200 && Math.abs(g.position.z - pp.z) < 200) {
            e.seeT = 0.3;
            if (canSee(e, pp, range)) alertEnemy(e);
            else for (const a of allies) if (canSee(e, a.g.position, range * 0.6)) { alertEnemy(e); break; }
          }
          let spd = 0;
          if (!e.static && camD < 260) {
            e.walkT -= dt;
            if (e.walkT <= 0) {
              e.walkT = rand(4, 9);
              e.walkTo = Math.random() < 0.6 ? new THREE.Vector3(e.home.x + rand(-10, 10), 0, e.home.z + rand(-10, 10)) : null;
            }
            if (e.walkTo) {
              const dx = e.walkTo.x - g.position.x, dz = e.walkTo.z - g.position.z, d = Math.hypot(dx, dz);
              if (d > 0.6) {
                spd = 1.3;
                g.position.x += dx / d * spd * dt; g.position.z += dz / d * spd * dt;
                faceTo(g, Math.atan2(dx, dz), Math.min(1, dt * 4));
              } else e.walkTo = null;
            }
          } else if (e.static) {
            // 塔楼上的哨兵慢慢左右看
            g.rotation.y += Math.sin(t * 0.4 + e.phase) * dt * 0.5;
          }
          if (e.T.drone) {
            g.position.y = lerp(g.position.y, groundAt(g.position.x, g.position.z, 0.5, 999) + e.flyH + Math.sin(t * 2 + e.phase) * 0.3, Math.min(1, dt * 2));
            v.rotors.forEach(r => { r.rotation.y += dt * 40; });
          } else {
            if (!e.static) { pushOut(g.position, e.r + 0.1, g.position.y); g.position.y = groundAt(g.position.x, g.position.z, e.r, g.position.y + 0.6); }
            if (camD < 160) Humans.animate(v, dt, spd);
          }
          flashUpdate(v, dt);
          continue;
        }
      }
      // ---------- 进攻 ----------
      e.targetT -= dt;
      if (e.targetT <= 0) {
        e.targetT = rand(2.5, 4);
        e.target = null;
        if (allies.length && Math.random() < 0.3) {
          const a = allies[Math.floor(Math.random() * allies.length)];
          if (a.g.position.distanceTo(g.position) < range) e.target = a;
        }
      }
      if (e.target && !allies.includes(e.target)) e.target = null;
      const tg = e.target ? e.target.g.position : pp;
      let dx = tg.x - g.position.x, dz = tg.z - g.position.z;
      const dist = Math.hypot(dx, dz) || 1;
      dx /= dist; dz /= dist;
      // 看不见目标时，走到最后看见的地方
      e.seeT -= dt;
      if (e.seeT <= 0) { e.seeT = 0.35; e.sees = canSee(e, tg, range * 1.4); if (e.sees) { e.last.copy(tg); e.lost = 0; } }
      if (!e.sees) e.lost += dt;
      const angry = e.T.boss && e.hp < e.maxHp / 2;
      let spd = e.static ? 0 : e.speed * (angry ? 1.4 : 1);
      let mvx = dx, mvz = dz;
      const keep = e.T.keep || 0;
      if (!e.sees && !e.T.boss) {
        const lx = e.last.x - g.position.x, lz = e.last.z - g.position.z, ld = Math.hypot(lx, lz);
        if (ld > 2) { mvx = lx / ld; mvz = lz / ld; } else { mvx = dx; mvz = dz; }
      } else if (keep && dist < keep) {
        e.strafeT -= dt;
        if (e.strafeT <= 0) { e.strafe *= -1; e.strafeT = rand(1, 2.5); }
        mvx = -dz * e.strafe * 0.8 - dx * 0.25; mvz = dx * e.strafe * 0.8 - dz * 0.25;
        spd *= 0.6;
      } else if (keep && dist < keep * 1.6 && e.sees && !e.T.boss) spd *= 0.75;
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
      g.position.x = clamp(g.position.x, -LIM, LIM); g.position.z = clamp(g.position.z, -LIM, LIM);
      faceTo(g, Math.atan2(dx, dz), Math.min(1, dt * 10));

      if (e.T.drone) {
        const want = Math.max(groundAt(g.position.x, g.position.z, 0.5, 999), tg.y) + e.flyH * 0.7 + Math.sin(t * 2.5 + e.phase) * 0.4;
        g.position.y = lerp(g.position.y, want, Math.min(1, dt * 2));
        v.rotors.forEach(r => { r.rotation.y += dt * 40; });
        v.body.rotation.x = mvz * 0.1 * Math.sign(spd);
      } else {
        if (!e.static) {
          pushOut(g.position, e.r + 0.1, g.position.y);
          // 掉到水里就往回走
          if (W.map.lake && gy(g.position.x, g.position.z) < W.map.water - 0.8) { g.position.x -= mvx * spd * dt * 2; g.position.z -= mvz * spd * dt * 2; }
          g.position.y = groundAt(g.position.x, g.position.z, e.r, g.position.y + 0.6);
        }
        if (camD < 180) Humans.animate(v, dt, spd > 0 ? Math.hypot(mvx, mvz) * spd : 0);
      }
      flashUpdate(v, dt);

      // 开枪（看得见目标才开枪，躲在掩体后面就安全）
      if (e.T.shoot) {
        e.shootT -= dt;
        e.burstT -= dt;
        const shootRange = (e.T.range || 55) * D.view;
        if (e.T.sniper && v.glint) {
          // 狙击手开枪前会瞄一会儿：红光越来越亮
          const aiming = e.sees && dist < shootRange && e.shootT < 1.4;
          v.glint.material.opacity = aiming ? (0.35 + 0.65 * (1 - e.shootT / 1.4)) * (0.7 + 0.3 * Math.sin(t * 20)) : 0;
          v.glint.scale.setScalar(1.2 + Math.min(4, dist / 25));
        }
        if (e.shootT <= 0 && dist < shootRange) {
          e.shootT = rand(e.T.shoot[0], e.T.shoot[1]) * D.rate * (angry ? 0.7 : 1);
          const from = tmpV.set(g.position.x, e.T.drone ? g.position.y - 0.3 : g.position.y + 1.45 * e.s, g.position.z);
          const to = tmpV2.set(tg.x, tg.y + 1.3, tg.z);
          if (e.T.boss) {
            e.attackN++;
            if (e.attackN % 3 === 0) {
              const n = angry ? 20 : 14, off = Math.random();
              const c = new THREE.Vector3(g.position.x, g.position.y + 0.8, g.position.z);
              for (let k = 0; k < n; k++) {
                const a = (k + off) / n * Math.PI * 2;
                fireBullet(c, new THREE.Vector3(c.x + Math.cos(a), c.y, c.z + Math.sin(a)), 11, e.T.dmg * D.dmg, true);
              }
              spawnRing(g.position, 0xff3030, 8, 0.5);
              centerText('⬆ 跳起来躲开！', '#ff6b6b', 34);
            } else e.burst = angry ? 5 : 3;
          } else if (e.sees) {
            e.burst = e.T.burst || 1;
          } else e.shootT *= 0.4; // 看不见就过一会儿再看
        }
        if (e.burst > 0 && e.burstT <= 0) {
          e.burst--; e.burstT = e.T.boss ? 0.15 : 0.2;
          const fx2 = Math.sin(g.rotation.y), fz2 = Math.cos(g.rotation.y);
          const from = new THREE.Vector3(g.position.x + fx2 * 0.8 * e.s + fz2 * 0.25 * e.s, e.T.drone ? g.position.y - 0.3 : g.position.y + 1.3 * e.s, g.position.z + fz2 * 0.8 * e.s - fx2 * 0.25 * e.s);
          // 离得越远越打不准；一关比一关准
          const miss = (e.T.boss ? 1.2 : e.T.sniper ? 0.5 : 0.9) * D.miss * (0.6 + dist / 40) * (crouch && !e.T.sniper ? 1.3 : 1);
          const to = new THREE.Vector3(tg.x + rand(-miss, miss), tg.y + rand(0.8, 1.6), tg.z + rand(-miss, miss));
          if (e.T.boss) {
            for (let k = -1; k <= 1; k++) fireBullet(from, to.clone().add(new THREE.Vector3(-dz * k * 2.5, 0, dx * k * 2.5)), e.T.bullet, e.T.dmg * 0.6 * D.dmg, true);
          } else fireBullet(from, to, e.T.bullet * (1 + diffK() * 0.25), e.T.dmg * D.dmg, false);
          spawnFlash(from, 0xffb050, 0.9 * e.s, 0.08);
        }
        if (e.T.boss) {
          e.summonT -= dt;
          if (e.summonT <= 0) {
            e.summonT = angry ? 8 : 11;
            for (let k = 0; k < 3; k++) {
              const a = Math.random() * Math.PI * 2;
              const m2 = spawnEnemy(Math.random() < 0.6 ? 'grunt' : 'runner', new THREE.Vector3(g.position.x + Math.cos(a) * 5, 0, g.position.z + Math.sin(a) * 5));
              m2.minion = true; m2.spawnIn = 0.5; alertEnemy(m2, 0);
              puff(tmpV.copy(m2.g.position).setY(m2.g.position.y + 1), 5, 2, 0xd6c3a0, 1.2);
            }
            centerText('坏蛋司令叫来了帮手！', '#ff6b6b', 28);
          }
        }
      }
      // 近身攻击
      e.atk -= dt;
      if (!e.T.drone && e.atk <= 0) {
        const reach = e.r + 0.8;
        const pd = Math.hypot(pp.x - g.position.x, pp.z - g.position.z);
        if (pd < reach && Math.abs(pp.y - g.position.y) < 2 * e.s) {
          e.atk = 1.1;
          hurtPlayer((e.T.boss ? 20 : e.T.dmg + (e.type === 'runner' ? 0 : 3)) * D.dmg);
          e.kb.set(-dx, 0, -dz).multiplyScalar(e.T.boss ? 3 : 10);
          const ux = (pp.x - g.position.x) / (pd || 1), uz = (pp.z - g.position.z) / (pd || 1);
          player.vel.x += ux * 9; player.vel.z += uz * 9;
        } else {
          for (let k = allies.length - 1; k >= 0; k--) {
            const ap = allies[k].g.position;
            if (Math.hypot(ap.x - g.position.x, ap.z - g.position.z) < reach) { e.atk = 1.1; hurtAlly(k, e.T.dmg); e.kb.set(-dx, 0, -dz).multiplyScalar(8); break; }
          }
        }
      }
    }
  }

  function updateBullets(dt) {
    const pp = player.pos;
    for (const b of ebullets) {
      if (!b.alive) continue;
      b.life -= dt;
      const p = b.mesh.position;
      p.addScaledVector(b.vel, dt);
      if (b.life <= 0 || Math.abs(p.x) > 800 || Math.abs(p.z) > 800 || p.y < gy(p.x, p.z)) { b.alive = false; b.mesh.visible = false; continue; }
      const ob = insideBox(p);
      if (ob) {
        emit(p, 0xffa040, 4, 3, 0.25, 1);
        if (ob.kind === 'barrel') damageBarrel(ob, 1);
        b.alive = false; b.mesh.visible = false; continue;
      }
      let hit = false;
      for (let i = allies.length - 1; i >= 0; i--) {
        const ap = allies[i].g.position;
        if ((ap.x - p.x) ** 2 + (ap.z - p.z) ** 2 < 0.3 && p.y > ap.y + 0.2 && p.y < ap.y + 2.3) { hurtAlly(i, b.dmg); hit = true; break; }
      }
      if (!hit && (pp.x - p.x) ** 2 + (pp.z - p.z) ** 2 < 0.3 && p.y > pp.y && p.y < pp.y + player.eyeH + 0.2) {
        hurtPlayer(b.dmg); hit = true;
      }
      if (hit) { b.alive = false; b.mesh.visible = false; emit(p, 0xffa040, 8, 4, 0.3, 1); }
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
        const gh = groundAt(g.position.x, g.position.z, 0.3, g.position.y) + 0.7;
        if (g.position.y < gh) { g.position.y = gh; p.vel.set(0, 0, 0); p.baseY = gh; }
        pushOut(g.position, 0.4, g.position.y - 0.7);
      } else {
        if (p.baseY == null) p.baseY = groundAt(g.position.x, g.position.z, 0.3, g.position.y) + 0.7;
        g.position.y = p.baseY + (p.kind === 'jetpack' ? 0.4 : 0.1) + Math.sin(p.t * 3) * 0.15;
      }
      g.rotation.y += dt * 2.5;
      if (p.life < 4) g.visible = Math.floor(p.life * 6) % 2 === 0;
      const dx = pp.x - g.position.x, dz = pp.z - g.position.z;
      const d = Math.hypot(dx, dz) || 0.01;
      if (p.kind === 'medal' && (d < 6 || p.forced) && state === 'playing') {
        const sp = (p.forced ? 30 : 12) + Math.max(0, 6 - d) * 2;
        g.position.x += dx / d * sp * dt; g.position.z += dz / d * sp * dt;
      }
      if (d < 1.4 && Math.abs(pp.y + 0.8 - g.position.y) < 2.2 && state === 'playing') {
        if (p.kind === 'medal') {
          xp++;
          Sfx.gem();
          const need = 4 + level * 3;
          if (xp >= need) { xp -= need; level++; pendingLevels++; }
        } else if (p.kind === 'ammo') {
          grenadeCount = Math.min(S.maxGrenades, grenadeCount + 2);
          // 每把枪都补一些子弹
          WEAPONS.forEach((W, k) => { if (W.reserve !== Infinity) addReserve(k, W.rocket ? 2 : W.launcher ? 4 : Math.ceil(W.mag * 1.5)); });
          centerText('📦 弹药补给：每把枪都补了子弹 · 手榴弹 +2', '#ffd23f', 28);
          Sfx.pickup();
        } else if (p.kind === 'jetpack') {
          jet.has = true; jet.fuel = 1;
          banner('🚀 喷气背包！', isTouch ? '跳起来以后按住 ⬆ 就能飞' : '跳起来以后按住空格就能飞');
          Sfx.levelUp();
        } else {
          const k = p.kind === 'syringe' ? 'shot' : 'kit';
          if (meds.shot + meds.kit < S.maxMeds) {
            meds[k]++;
            centerText(`${HEALS[k].icon} ${HEALS[k].name} +1（按 ${isTouch ? '💉' : 'H'} 打药）`, '#6ee36a', 28);
          } else {
            if (hp >= S.maxHp) continue;
            hp = Math.min(S.maxHp, hp + 30);
            centerText('✚ 生命 +30', '#6ee36a', 34);
          }
          Sfx.pickup();
        }
        removePickup(i);
      }
    }
  }

  // ---------- 目标标记 ----------
  const markersEl = $('markers');
  const markerPool = [];
  function getMarker(i) {
    if (!markerPool[i]) {
      const d = document.createElement('div');
      d.className = 'marker';
      d.innerHTML = '<div class="mk-icon"></div><div class="mk-txt"></div><div class="mk-arrow">▼</div>';
      markersEl.appendChild(d);
      markerPool[i] = { d, icon: d.children[0], txt: d.children[1], last: '' };
    }
    return markerPool[i];
  }
  function markerList() {
    const list = [];
    if (state === 'title' || !mission || !mst) return list;
    const st = curStage();
    for (const o of objectives) {
      if (o.done || o.stage !== mst.stage || mst.phase !== 'fight') { if (!(o.kind === 'target' && o.planted && !o.done)) continue; }
      if (o.kind === 'cage') list.push([o.x, o.y + 3.2, o.z, '🔓', '救队友']);
      else if (o.kind === 'intel') list.push([o.x, o.y + 2, o.z, '💼', '情报']);
      else list.push([o.x, o.y + 6, o.z, o.planted ? '💣' : '🎯', o.planted ? '快跑开！' : '放炸药']);
    }
    if (st && mst.phase === 'fight') {
      if ((st.t === 'clear' || st.t === 'survive' || st.t === 'boss') && W.spots.areas[st.area]) {
        const A = W.spots.areas[st.area];
        const left = st.t === 'clear' ? areaLeft(st.area) : 99;
        if (Math.hypot(A.x - player.pos.x, A.z - player.pos.z) > A.r * 0.8 || st.t === 'survive') list.push([A.x, gy(A.x, A.z) + 12, A.z, st.t === 'survive' ? '🛡️' : st.t === 'boss' ? '👑' : '⚔️', stageName(st)]);
        if (st.t === 'clear' && left <= 4) for (const e of enemies) if (e.area === st.area && !e.minion) list.push([e.g.position.x, e.g.position.y + (e.T.drone ? 1.5 : 2.25 * e.s), e.g.position.z, '🎯', '']);
      }
      if (st.t === 'goto') list.push([st.at[0], gy(st.at[0], st.at[1]) + 4, st.at[1], '📍', stageName(st)]);
      if (st.t === 'extract') list.push([padPos.x, heli.g.visible ? heli.g.position.y + 5 : padPos.y + 5, padPos.z, '🚁', '撤离点']);
    }
    if (boss) list.push([boss.g.position.x, boss.g.position.y + 2.25 * boss.s + 0.4, boss.g.position.z, '👑', '坏蛋司令']);
    for (const c of chests) if (!c.opened && Math.hypot(c.x - player.pos.x, c.z - player.pos.z) < 60) list.push([c.x, c.y + 1.6, c.z, '🎁', '']);
    for (const p of pickups) if (p.kind === 'jetpack' && Math.hypot(p.g.position.x - player.pos.x, p.g.position.z - player.pos.z) < 90) list.push([p.g.position.x, p.g.position.y + 1.2, p.g.position.z, '🚀', '喷气背包']);
    return list;
  }
  // 大地图上的点：[x, z, 颜色, 大小, 文字]
  function mapMarks() {
    const out = [];
    if (!mission || !mst) return out;
    const st = curStage();
    for (const k in W.spots.areas) {
      const A = W.spots.areas[k];
      const n = areaLeft(k);
      if (n > 0) out.push([A.x, A.z, 'rgba(255,90,90,0.85)', 10, st && st.area === k ? stageName(st) : '']);
    }
    for (const o of objectives) if (!o.done) out.push([o.x, o.z, '#ffd23f', 8, o.stage === mst.stage ? ({ cage: '救人', intel: '情报', target: '目标' })[o.kind] : '']);
    for (const c of chests) if (!c.opened) out.push([c.x, c.z, RARITY[c.rar].css, 6, '']);
    for (const p of pickups) if (p.kind === 'jetpack') out.push([p.g.position.x, p.g.position.z, '#7fdcff', 8, '喷气背包']);
    if (st && st.t === 'extract') out.push([padPos.x, padPos.z, '#6ee36a', 12, '撤离点']);
    if (st && st.t === 'goto') out.push([st.at[0], st.at[1], '#6ee36a', 12, stageName(st)]);
    for (const a of allies) out.push([a.g.position.x, a.g.position.z, '#7fc8ff', 4, '']);
    return out;
  }
  function updateMarkers() {
    const list = markerList();
    for (let i = 0; i < Math.max(list.length, markerPool.length); i++) {
      if (i >= list.length) { if (markerPool[i]) markerPool[i].d.style.display = 'none'; continue; }
      const [x, y, z, icon, label] = list[i];
      const mk = getMarker(i);
      tmpV3.set(x, y, z).project(camera);
      let sx = tmpV3.x, sy = tmpV3.y;
      const behind = tmpV3.z > 1;
      if (behind) { sx = -sx; sy = -1; }
      const edge = behind || Math.abs(sx) > 0.82 || sy > 0.72 || sy < -0.6;
      sx = clamp(sx, -0.82, 0.82); sy = clamp(sy, -0.6, 0.72);
      const dist = Math.round(Math.hypot(x - player.pos.x, z - player.pos.z));
      mk.d.style.display = '';
      mk.d.style.left = ((sx * 0.5 + 0.5) * innerWidth) + 'px';
      mk.d.style.top = ((-sy * 0.5 + 0.5) * innerHeight) + 'px';
      const key = icon + label + dist + edge;
      if (mk.last !== key) {
        mk.last = key;
        mk.icon.textContent = icon;
        mk.txt.textContent = (label ? label + ' ' : '') + dist + 'm';
        mk.d.children[2].style.visibility = edge ? 'hidden' : 'visible';
      }
    }
  }

  // ---------- HUD ----------
  const hudCache = {};
  function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
  function setWidth(id, v) { const s = v.toFixed(1) + '%'; if (hudCache[id] !== s) { hudCache[id] = s; $(id).style.width = s; } }
  function setClass(el, key, cls, on) { const k = key + cls; if (hudCache[k] !== on) { hudCache[k] = on; el.classList.toggle(cls, on); } }
  const radar = $('radar'), rctx = radar.getContext('2d');
  const crossEl = $('crosshair');
  const hpBarEl = document.querySelector('.bar.hp'), ammoEl = document.querySelector('.w-ammo');
  const aimDir = new THREE.Vector3(), aimEye = new THREE.Vector3(), aimC = new THREE.Vector3();
  function updateHUD() {
    setText('mName', mission ? missionTitle() : '');
    setText('score', score);
    setText('level', level);
    setText('troops', allies.length);
    setText('grenades', grenadeCount);
    setText('hpNum', Math.max(0, Math.ceil(hp)));
    setWidth('hpbar', Math.max(0, hp) / S.maxHp * 100);
    setClass(hpBarEl, 'hp', 'low', hp < S.maxHp * 0.3);
    setWidth('xpbar', xp / (4 + level * 3) * 100);
    if (boss) setWidth('bossbar', Math.max(0, boss.hp) / boss.maxHp * 100);
    const W = WEAPONS[curW], A = ammo[curW];
    setText('wName', W.name);
    setText('ammoMag', A.mag);
    setText('ammoRes', '/ ' + (A.res === Infinity ? '∞' : A.res));
    setClass(ammoEl, 'ammo', 'low', A.mag <= Math.max(1, magSize(curW) * 0.2));
    const slotsKey = WEAPONS.map((w, i) => (unlocked(i) ? 1 : 0) + (i === curW ? 2 : 0)).join('');
    if (hudCache.slots !== slotsKey) {
      hudCache.slots = slotsKey;
      $('wSlots').innerHTML = WEAPONS.map((w, i) => `<span class="w-slot${i === curW ? ' on' : ''}${unlocked(i) ? '' : ' lock'}" data-i="${i}">${isTouch ? '' : `<i>${i + 1}</i>`}${unlocked(i) ? w.short : '🔒'}</span>`).join('');
    }
    $('reloadTip').classList.toggle('hidden', !(reloadT > 0));
    setText('medShot', meds.shot); setText('medKit', meds.kit);
    setClass($('jetBox'), 'jet', 'hidden', !jet.has);
    if (jet.has) { setWidth('jetbar', jet.fuel * 100); setClass($('jetBox'), 'jet', 'low', jet.fuel < 0.2); }
    $('useBar').classList.toggle('hidden', !(healT > 0));
    if (healT > 0) { setText('useLabel', `${HEALS[healKind].icon} 正在用${HEALS[healKind].name}…`); setWidth('useFill', (1 - healT / healTotal) * 100); }
    setText('fireMode', { auto: '连发', semi: '单发', pump: '泵动', bolt: '栓动' }[W.mode]);
    if (state === 'playing') {
      eyePos(aimEye);
      camera.getWorldDirection(aimDir);
      let hot = false;
      for (const e of enemies) {
        if (e.idle || e.spawnIn > 0) continue;
        for (const s of hitSpheres(e)) if (raySphere(aimEye, aimDir, aimC.set(s[0], s[1], s[2]), s[3] * 1.12) > 0) { hot = true; break; }
        if (hot) break;
      }
      setClass(crossEl, 'x', 'hot', hot);
    }
    drawRadar();
  }
  function drawRadar() {
    const Wd = 300, c = Wd / 2, scale = 140 / 70;
    rctx.clearRect(0, 0, Wd, Wd);
    rctx.save();
    rctx.beginPath(); rctx.arc(c, c, 146, 0, Math.PI * 2); rctx.clip();
    const pp = player.pos;
    const local = (x, z) => {
      const dx = x - pp.x, dz = z - pp.z;
      return [(dx * right.x + dz * right.z) * scale, -(dx * fwd.x + dz * fwd.z) * scale];
    };
    // 房子、墙、掩体（旋转成小方块），树是小绿点
    if (W) {
      for (const o of W.phys.query(pp.x, pp.z, 75)) {
        const k = o.kind;
        if (k === 'rock' || k === 'prop' || k === 'post' || k === 'pad' || k === 'rail' || k === 'platform' || k === 'drum') continue;
        const [px, py] = local(o.x, o.z);
        if (Math.hypot(px, py) > 160) continue;
        if (k === 'tree') { rctx.fillStyle = 'rgba(90,140,70,0.35)'; rctx.beginPath(); rctx.arc(c + px, c + py, 3, 0, 7); rctx.fill(); continue; }
        rctx.fillStyle = k === 'house' || k === 'wall' || k === 'tower' ? 'rgba(233,211,161,0.45)' : 'rgba(233,211,161,0.28)';
        rctx.save();
        rctx.translate(c + px, c + py);
        if (o.type === 'cyl') { rctx.beginPath(); rctx.arc(0, 0, Math.max(2, o.r * scale), 0, 7); rctx.fill(); }
        else { rctx.rotate(player.yaw - o.yaw); rctx.fillRect(-o.hx * scale, -o.hz * scale, o.hx * 2 * scale, o.hz * 2 * scale); }
        rctx.restore();
      }
    }
    // 地图边界
    rctx.strokeStyle = 'rgba(255,90,60,0.6)'; rctx.lineWidth = 3;
    rctx.beginPath();
    [[-LIM, -LIM], [LIM, -LIM], [LIM, LIM], [-LIM, LIM]].forEach(([x, z], i) => { const [px, py] = local(x, z); if (i) rctx.lineTo(c + px, c + py); else rctx.moveTo(c + px, c + py); });
    rctx.closePath(); rctx.stroke();
    rctx.strokeStyle = 'rgba(116,224,106,0.3)'; rctx.lineWidth = 2;
    for (const r of [47, 94, 141]) { rctx.beginPath(); rctx.arc(c, c, r, 0, Math.PI * 2); rctx.stroke(); }
    rctx.restore();
    const plot = (x, z, color, size, clampIt) => {
      let [px, py] = local(x, z);
      const l = Math.hypot(px, py);
      if (l > 140) { if (!clampIt) return; px = px / l * 140; py = py / l * 140; }
      rctx.fillStyle = color;
      rctx.beginPath(); rctx.arc(c + px, c + py, size, 0, Math.PI * 2); rctx.fill();
    };
    for (const p of pickups) if (p.kind !== 'medal') plot(p.g.position.x, p.g.position.z, p.kind === 'jetpack' ? '#7fdcff' : p.kind === 'ammo' ? '#ffd23f' : '#6ee36a', p.kind === 'jetpack' ? 8 : 5, p.kind === 'jetpack');
    for (const ch of chests) if (!ch.opened) { const [px, py] = local(ch.x, ch.z); if (Math.hypot(px, py) < 140) { rctx.fillStyle = RARITY[ch.rar].css; rctx.fillRect(c + px - 6, c + py - 5, 12, 10); } }
    for (const o of objectives) if (!o.done && mst && o.stage === mst.stage) plot(o.x, o.z, '#ffd23f', 10, true);
    { const cs = curStage(); if (cs && cs.t === 'extract') plot(padPos.x, padPos.z, '#6ee36a', 11, true); if (cs && (cs.t === 'clear' || cs.t === 'survive' || cs.t === 'boss') && W.spots.areas[cs.area]) plot(W.spots.areas[cs.area].x, W.spots.areas[cs.area].z, 'rgba(255,90,90,0.55)', 12, true); }
    for (const a of allies) plot(a.g.position.x, a.g.position.z, '#7fc8ff', 6);
    for (const e of enemies) if (!e.idle) plot(e.g.position.x, e.g.position.z, e.alert ? '#ff5a5a' : 'rgba(255,170,90,0.8)', e.T.boss ? 14 : 7, e.T.boss);
    rctx.fillStyle = 'rgba(116,224,106,0.14)';
    rctx.beginPath(); rctx.moveTo(c, c); rctx.arc(c, c, 140, -Math.PI / 2 - 0.65, -Math.PI / 2 + 0.65); rctx.fill();
    rctx.fillStyle = '#ffd23f';
    rctx.beginPath(); rctx.moveTo(c, c - 12); rctx.lineTo(c + 9, c + 9); rctx.lineTo(c - 9, c + 9); rctx.fill();
  }

  // ---------- 手里的枪：单独渲染到多重采样的画布上，边缘不会有锯齿 ----------
  let gunRT = null;
  const gunQuadScene = new THREE.Scene(), gunQuadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const gunBlit = new THREE.ShaderMaterial({
    uniforms: { t: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D t; varying vec2 vUv;
      void main() {
        vec4 c = texture2D(t, vUv);
        if (c.a < 0.004) discard;
        gl_FragColor = vec4(max(c.rgb / c.a, vec3(0.0)), min(c.a, 1.0));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthTest: false, depthWrite: false,
  });
  { const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), gunBlit); q.frustumCulled = false; gunQuadScene.add(q); }
  const gunSize = new THREE.Vector2(), gunClear = new THREE.Color();
  function renderGun() {
    const msaa = renderer.capabilities.isWebGL2 && fx.tier !== 'low';
    if (!msaa) {
      renderer.setRenderTarget(null);
      renderer.clearDepth();
      renderer.render(gunScene, gunCam);
      return;
    }
    renderer.getDrawingBufferSize(gunSize);
    if (!gunRT || gunRT.width !== gunSize.x || gunRT.height !== gunSize.y) {
      if (gunRT) gunRT.dispose();
      gunRT = new THREE.WebGLRenderTarget(gunSize.x, gunSize.y, { type: fx.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: 4 });
    }
    renderer.getClearColor(gunClear);
    const ca = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(gunRT);
    renderer.clear();
    renderer.render(gunScene, gunCam);
    renderer.setClearColor(gunClear, ca);
    renderer.setRenderTarget(null);
    gunBlit.uniforms.t.value = gunRT.texture;
    renderer.render(gunQuadScene, gunQuadCam);
  }

  // ---------- 主循环 ----------
  let last = performance.now(), time = 0, mapT = 0;
  const ctpEl = $('clickToPlay');
  function frame(now) {
    requestAnimationFrame(frame);
    const rawDt = Math.min(0.25, Math.max(0, (now - last) / 1000));
    const dt = Math.min(0.05, rawDt);
    last = now;
    const waitingLock = state === 'playing' && needLock();
    ctpEl.classList.toggle('hidden', !waitingLock);
    const active = (state === 'playing' && !waitingLock) || state === 'dead';
    if (active || state === 'title') time += dt;
    const t = time;

    if (state === 'title') {
      updateAllies(dt, t, false);
      updateEnemies(dt, t);
      heli.rotor.rotation.y += dt * 2;
    } else if (active) {
      if (state === 'playing') {
        updatePlayer(dt);
        comboTimer -= dt;
        if (comboTimer <= 0) combo = 0;
        updateMission(dt);
      }
      updateAllies(dt, t, state === 'playing');
      updateEnemies(dt, t);
      updateBullets(dt);
      updateGrenades(dt);
      updateRockets(dt);
      updatePickups(dt);
      updateChests(dt, t);
      updateCorpses(dt);
      updateHeli(dt);
      if (state === 'playing' && pendingLevels > 0) doLevelUp();
    }
    if (active || state === 'title') {
      updateParticles(dt);
      updateSmoke(dt);
      updateFires(dt);
      updateShards(dt);
      updateRings(dt);
      updateFlashes(dt);
      updateTracers(dt);
      if (flashLightT > 0) { flashLightT -= dt; if (flashLightT <= 0) flashLight.intensity = 0; }
    }
    updateCamera(active ? dt : 0, t);
    if (state !== 'title' && state !== 'loading') { updateHUD(); updateMarkers(); }
    if (mapOpen) { mapT -= rawDt; if (mapT <= 0) { mapT = 0.3; drawBigMap(); } }
    // 阴影跟着玩家走
    const focus = state === 'title' ? padPos : player.pos;
    // 阴影贴图按像素对齐，走动时影子边缘不会闪
    const texel = 128 / fx.shadowSize();
    const fx0 = Math.round(focus.x / texel) * texel, fz0 = Math.round(focus.z / texel) * texel, fy0 = Math.round(focus.y / texel) * texel;
    sun.position.set(fx0 + LIGHT_DIR.x * 400, fy0 + LIGHT_DIR.y * 400, fz0 + LIGHT_DIR.z * 400);
    sun.target.position.set(fx0, fy0, fz0);
    if (W) W.update(camera, t);
    updateDust(dt);
    fx.render(scene, camera, rawDt);
    if (state !== 'title' && (gunRoot.visible || healRoot.visible)) renderGun();
  }

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    gunCam.aspect = innerWidth / innerHeight;
    gunCam.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    fx.resize();
  });

  // 测试用的小工具
  window.__game = {
    get state() { return state; }, get enemies() { return enemies.length; }, get allies() { return allies.length; },
    get score() { return score; }, get grenades() { return grenadeCount; }, get hp() { return hp; }, get weapon() { return WEAPONS[curW].id; },
    get ammo() { return ammo[curW].mag; }, get phase() { return mst && mst.phase; }, get heli() { return heli.mode; },
    get mission() { return missionNo; }, get kills() { return missionKills; }, get objectives() { return objectives.map(o => o.done); },
    get player() { return player.pos.clone(); }, get level() { return level; },
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
    lookAt(x, y, z) { const dx = x - player.pos.x, dz = z - player.pos.z; player.yaw = Math.atan2(-dx, -dz); player.pitch = Math.atan2(y - player.pos.y - 1.65, Math.hypot(dx, dz)); },
    fire(on) { mouseDown = on; if (on) triggerQ = 0.25; },
    aim(on) { aimHeld = on; },
    grenade() { throwGrenade(); },
    weaponTo(i) { switchWeapon(i); },
    reload() { startReload(); },
    teleport(x, z) { player.pos.set(x, groundAt(x, z, 0.45, 999), z); player.vel.set(0, 0, 0); },
    unlockAll() { progress = NL; },
    spawn(kind) { spawnPickup(kind, new THREE.Vector3().copy(player.pos).addScaledVector(fwd, 4)); },
    finishObjectives() { objectives.forEach(o => { if (!o.done) { o.prog = 1; o.force = true; } }); },
    spawnEnemy(type, x, z) { const e = spawnEnemy(type, new THREE.Vector3(x, 0, z), {}); alertEnemy(e, 0); return true; },
    freeze() { enemies.forEach(e => { e.speed = 0; e.shootT = 99; }); },
    briefing(n) { hideScreens(); showBriefing(n, false); },
    start(n) { hideScreens(); missionNo = n; mission = LEVELS[n - 1]; runKeep = false; return startMission(false); },
    get stage() { return mst ? mst.stage : -1; }, get stageType() { const s = curStage(); return s ? s.t : null; },
    get world() { return W ? W.id : null; }, get loaded() { return !!W; },
    nextStage() { nextStage(); },
    alertAll() { enemies.forEach(e => alertEnemy(e, 0)); },
    get areas() { return JSON.parse(JSON.stringify(areaStats)); },
    get alerted() { return enemies.filter(e => e.alert).length; },
    get padPos() { return padPos.clone(); },
    killArea(a) { enemies.filter(e => e.area === a).forEach(e => damageEnemy(e, 9999)); },
    god() { hp = 999; },
    areaPos(a) { const A = W.spots.areas[a]; return { x: A.x, z: A.z }; },
    get heliPos() { return heli.g.position.clone(); },
    get objPos() { return objectives.filter(o => !o.done && o.stage === mst.stage).map(o => [o.x, o.z]); },
    map(on) { toggleMap(on); },
    get chests() { return chests.map(c => ({ x: c.x, z: c.z, rar: c.rar, opened: c.opened })); },
    get meds() { return Object.assign({}, meds); }, get jet() { return Object.assign({}, jet); },
    get weapons() { return WEAPONS.map((W, i) => ({ id: W.id, unlocked: unlocked(i), mag: ammo[i].mag, res: ammo[i].res })); },
    giveJet() { jet.has = true; jet.fuel = 1; },
    useMed() { useMed(); },
    setPos(x, y, z) { player.pos.set(x, y, z); player.vel.set(0, 0, 0); },
    look(yaw, pitch) { player.yaw = yaw; player.pitch = pitch; },
    hold(code, on) { keys[code] = on; },
    crouch(on) { crouch = on; },
    boom(x, y, z, sz) { explode(new THREE.Vector3(x, y, z), sz || 2.4, true); },
    muzzle(t) { muzzleT = t; },
    fxStep(dt, n) { for (let i = 0; i < (n || 1); i++) { updateParticles(dt); updateSmoke(dt); updateFires(dt); updateShards(dt); updateFlashes(dt); } },
  };

  showLoading(true, '正在加载…', 0);
  toTitle();
  // 真人模型解码完以后，把开始界面的人物换成真人模型
  if (Humans.onReady) Humans.onReady(() => { if (state === 'title') toTitle(); });
  requestAnimationFrame(frame);
})();
