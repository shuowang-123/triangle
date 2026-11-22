// 雷霆特战队 —— 军事题材第一人称射击（Three.js）
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const HALF = 45;            // 基地是一个 90 x 90 的方形
  const LIM = HALF - 1;       // 能走到的边界
  const PAD = new THREE.Vector3(0, 0, 34); // 直升机停机坪
  const SPAWN = new THREE.Vector3(0, 0, 26);
  const isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
  if (isTouch) document.body.classList.add('touch');

  // ================= 渲染器 / 场景 =================
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.75 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.autoClear = false;
  $('game').appendChild(renderer.domElement);
  const maxAniso = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;

  const scene = new THREE.Scene();
  const BASE_FOV = 75;
  const camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.05, 700);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  // 太阳在偏低的位置（傍晚的金色阳光），天空里的太阳和真正的光照方向一致
  const SUN_DIR = new THREE.Vector3(0.55, 0.40, -0.74).normalize();
  scene.add(new THREE.HemisphereLight(0xbcd4ff, 0xa07850, 0.62));
  // 从太阳对面打过来的一点冷色补光，背光的一面不会死黑
  const fill = new THREE.DirectionalLight(0x8fb0ff, 0.35); fill.position.set(-SUN_DIR.x, 0.6, -SUN_DIR.z); scene.add(fill);
  let envTex = null;
  const sun = new THREE.DirectionalLight(0xffd9a8, 3.1);
  sun.position.copy(SUN_DIR).multiplyScalar(90);
  scene.add(sun, sun.target);
  {
    const sc = sun.shadow.camera;
    sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48; sc.near = 5; sc.far = 220;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.04;
  }
  // 后期画面：体积光、泛光、雾、调色（js/fx.js）
  const fx = FX.create(renderer, { sun, sunDir: SUN_DIR, isTouch });
  const FX_SKY = fx.SKY_GLSL;
  window.__fx = fx;
  const flashLight = new THREE.PointLight(0xffc070, 0, 14, 2);
  scene.add(flashLight);

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
  // ---------- 天空：着色器实时画的天空、太阳和会飘的云 ----------
  const skyUniforms = { uSunDir: { value: SUN_DIR }, uTime: { value: 0 }, uClouds: { value: 1 } };
  {
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: skyUniforms,
      vertexShader: 'varying vec3 vD; void main(){ vD = (modelMatrix * vec4(position, 0.0)).xyz; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
      fragmentShader: FX_SKY + `
        uniform float uTime; uniform float uClouds; varying vec3 vD;
        float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
        float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
        void main(){
          vec3 d = normalize(vD);
          vec3 c = skyBase(d);
          float s = max(dot(d, uSunDir), 0.0);
          // 太阳本体（很亮，后期会给它加上光晕）
          c += vec3(1.0, 0.82, 0.6) * smoothstep(0.9993, 0.9997, s) * 40.0;
          // 云：投影到天上的一块平面上
          if (d.y > 0.0 && uClouds > 0.5) {
            vec2 uv = d.xz / (d.y + 0.08) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
            float n = fbm(uv);
            float cov = smoothstep(0.52, 0.82, n);
            float n2 = fbm(uv + uSunDir.xz * 0.12);
            float lit = clamp(0.55 + (n - n2) * 3.0, 0.15, 1.2);
            vec3 cc = mix(vec3(0.55, 0.47, 0.45), vec3(1.25, 1.0, 0.78), lit);
            cc += vec3(1.4, 0.9, 0.5) * pow(s, 10.0) * (1.0 - cov) * 1.5;
            float fade = smoothstep(0.02, 0.22, d.y);
            c = mix(c, cc, cov * fade * 0.85);
          }
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), skyMat);
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    camera.add(sky); // 天空跟着相机走
    // 用天空生成环境光照，让金属和布料看起来更真实（不带云，避免反光里有噪点）
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    skyUniforms.uClouds.value = 0;
    envScene.add(new THREE.Mesh(sky.geometry, skyMat));
    const ground2 = new THREE.Mesh(new THREE.CircleGeometry(400, 24), new THREE.MeshBasicMaterial({ color: 0x8a6a45 })); ground2.rotation.x = -Math.PI / 2; ground2.position.y = -2; envScene.add(ground2);
    envTex = pmrem.fromScene(envScene, 0.03).texture;
    skyUniforms.uClouds.value = 1;
    scene.environment = envTex;
  }
  // 地面 + 远处起伏的沙丘和石头山（同一块地形）
  const ground = (() => {
    const hash = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
    const noise = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    const fbm = (x, y) => { let s = 0, a = 0.5, f = 1; for (let k = 0; k < 5; k++) { s += a * noise(x * f, y * f); a *= 0.5; f *= 2.03; } return s; };
    const geo = new THREE.PlaneGeometry(760, 760, 190, 190);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3);
    const sand = new THREE.Color(0xffffff), rock = new THREE.Color(0x9a7a5c), dark = new THREE.Color(0x7d644c);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const r = Math.max(Math.abs(x), Math.abs(z)) * 0.55 + Math.hypot(x, z) * 0.45;
      const dune = THREE.MathUtils.smoothstep(r, 62, 110) * (fbm(x * 0.02, z * 0.02) * 9);
      const mount = THREE.MathUtils.smoothstep(r, 130, 240) * (Math.pow(fbm(x * 0.008 + 5, z * 0.008), 1.6) * 150 + 8);
      const h = dune + mount;
      pos.setY(i, h);
      const rk = THREE.MathUtils.smoothstep(h, 18, 55);
      c.copy(sand).lerp(rock, rk).lerp(dark, rk * fbm(x * 0.05, z * 0.05) * 0.6);
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    const photoGround = hasPhoto('ground');
    const t = photoGround ? photoMap('ground', 250, 250) : (() => { const c = sandTex.clone(); c.needsUpdate = true; c.repeat.set(88, 88); return c; })();
    const gm = new THREE.MeshStandardMaterial({ map: t, vertexColors: true, roughness: 1, normalMap: photoGround ? photoNormal('ground', 250, 250) : null, normalScale: new THREE.Vector2(1.3, 1.3) });
    const sandB = { value: photoGround && hasPhoto('sand') ? photoMap('sand') : null };
    // 着色器里加上风吹出来的沙纹（低角度阳光下能看到明暗起伏）和大片的颜色深浅变化，地面就不会一眼看出重复贴图
    gm.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      if (sandB.value) sh.uniforms.tSandB = sandB;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWPos;
          uniform sampler2D tSandB;
          float gh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
          float gn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(gh(i), gh(i + vec2(1, 0)), f.x), mix(gh(i + vec2(0, 1)), gh(i + vec2(1, 1)), f.x), f.y); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          ${sandB.value ? `{
            // 第二张沙地照片按不同大小铺，用噪声混在一起，就看不出重复的格子
            vec3 sb = texture2D(tSandB, vWPos.xz / 6.7).rgb;
            float bl = smoothstep(0.38, 0.68, gn(vWPos.xz * 0.045) * 0.7 + gn(vWPos.xz * 0.19) * 0.3);
            diffuseColor.rgb = mix(diffuseColor.rgb, sb * 1.05, bl);
          }` : ''}
          float macro = gn(vWPos.xz * 0.035) * 0.6 + gn(vWPos.xz * 0.11) * 0.4;
          diffuseColor.rgb *= mix(0.82, 1.12, macro) * mix(0.94, 1.04, gn(vWPos.xz * 0.9));`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            vec2 wp = vWPos.xz;
            vec2 rd = normalize(vec2(0.8, 0.6));
            float k = 2.4;
            float ph = dot(wp, rd) * k + gn(wp * 0.09) * 7.0 + gn(wp * 0.4) * 1.2;
            float amp = 0.16 * (0.45 + 0.55 * gn(wp * 0.13 + 3.0));
            float fade = 1.0 - smoothstep(14.0, 55.0, length(vViewPosition));
            float sl = cos(ph) + 0.35 * cos(ph * 2.0 + 1.0);
            vec2 grad = rd * k * sl * amp * fade;
            vec3 dW = vec3(-grad.x, 0.0, -grad.y);
            normal = normalize(normal + (viewMatrix * vec4(dW, 0.0)).xyz);
          }`);
    };
    const m = new THREE.Mesh(geo, gm);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  })();
  {
    const roadN = photoNormal('asphalt', 2, 24);
    const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, normalMap: roadN, roughness: 0.92 });
    const r1 = new THREE.Mesh(new THREE.PlaneGeometry(6, 90), roadMat);
    r1.rotation.x = -Math.PI / 2; r1.position.set(0, 0.01, 0); r1.receiveShadow = true; scene.add(r1);
    const t2 = roadTex.clone(); t2.needsUpdate = true;
    const r2 = new THREE.Mesh(new THREE.PlaneGeometry(6, 90), new THREE.MeshStandardMaterial({ map: t2, normalMap: roadN, roughness: 0.92 }));
    r2.rotation.x = -Math.PI / 2; r2.rotation.z = Math.PI / 2; r2.position.set(0, 0.012, -4); r2.receiveShadow = true; scene.add(r2);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(6, 48), new THREE.MeshStandardMaterial({ map: helipadTex, roughness: 0.9 }));
    pad.rotation.x = -Math.PI / 2; pad.position.set(PAD.x, 0.02, PAD.z); pad.receiveShadow = true; scene.add(pad);
  }

  // ---------- 掩体 ----------
  const obstacles = [];
  const matCache = {};
  function stdMat(key, opts) { return matCache[key] || (matCache[key] = new THREE.MeshStandardMaterial(opts)); }
  function shadowify(o) { o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } }); return o; }
  function addOb(x, z, w, d, h, mesh, kind) {
    if (mesh) { mesh.position.set(x, mesh.isGroup ? 0 : h / 2, z); shadowify(mesh); scene.add(mesh); }
    const o = { x, z, hx: w / 2, hz: d / 2, h, mesh, kind: kind || 'box' };
    obstacles.push(o);
    return o;
  }
  function removeOb(o) {
    const i = obstacles.indexOf(o);
    if (i >= 0) obstacles.splice(i, 1);
    if (o.mesh) scene.remove(o.mesh);
  }
  function crate(x, z, s) { addOb(x, z, s, s, s, new THREE.Mesh(roundBox(s, s, s, 0.05, 2), stdMat('crate', { map: crateTex, normalMap: crateN, roughness: 0.82 }))); }
  function container(x, z, alongX, ci) {
    const w = alongX ? 6 : 2.6, d = alongX ? 2.6 : 6;
    addOb(x, z, w, d, 2.6, new THREE.Mesh(roundBox(w, 2.6, d, 0.06, 1), stdMat('cont' + ci, { map: CONTAINER_TEX[ci % 4], normalMap: containerN, normalScale: new THREE.Vector2(1, 1), roughness: 0.55, metalness: 0.35 })));
  }
  // 沙袋墙：一个一个鼓鼓的沙袋错缝堆起来（一次画完，很省性能）
  const bagList = [];
  function sandbags(x, z, alongX) {
    const w = alongX ? 4 : 1.1, d = alongX ? 1.1 : 4;
    addOb(x, z, w, d, 1.15, null);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 2; col++) for (let i = 0; i < 5 - row % 2; i++) {
      const along = (row % 2 ? -1.2 : -1.6) + i * 0.8;
      const across = col ? 0.27 : -0.27;
      bagList.push({ x: x + (alongX ? along : across), z: z + (alongX ? across : along), y: 0.2 + row * 0.37, ry: (alongX ? 0 : Math.PI / 2) + rand(-0.08, 0.08) });
    }
  }
  function buildBags() {
    const geo = roundBox(0.8, 0.4, 0.52, 0.17, 3).clone();
    // 中间鼓一点，两头收一点，像装满沙子的袋子
    const pp = geo.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
      const k = 1 - Math.pow(Math.abs(x) / 0.4, 4) * 0.25;
      pp.setXYZ(i, x, y * k * (1 + 0.15 * (1 - Math.abs(z) / 0.26)), z * k);
    }
    geo.computeVertexNormals();
    const bm = new THREE.MeshStandardMaterial({ color: 0xc8b083, roughness: 1, normalMap: Humans.fabricNormal, normalScale: new THREE.Vector2(0.9, 0.9) });
    const im = new THREE.InstancedMesh(geo, bm, bagList.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), v = new THREE.Vector3(), c = new THREE.Color();
    bagList.forEach((b, i) => {
      e.set(rand(-0.04, 0.04), b.ry, rand(-0.05, 0.05)); q.setFromEuler(e);
      sc.set(rand(0.95, 1.04), rand(0.92, 1.05), rand(0.95, 1.05));
      m4.compose(v.set(b.x, b.y, b.z), q, sc); im.setMatrixAt(i, m4);
      im.setColorAt(i, c.setHSL(0.11 + rand(-0.015, 0.015), rand(0.28, 0.4), rand(0.5, 0.62)));
    });
    im.castShadow = im.receiveShadow = true;
    scene.add(im);
  }
  function barrier(x, z, alongX) {
    const w = alongX ? 3 : 0.8, d = alongX ? 0.8 : 3;
    addOb(x, z, w, d, 1.4, new THREE.Mesh(roundBox(w, 1.4, d, 0.07, 2), stdMat('bar', { map: barrierTex, normalMap: photoNormal('concrete', 2, 1, concreteN), normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.9 })));
  }
  const barrelGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.25, 16);
  function barrel(x, z) {
    const o = addOb(x, z, 0.9, 0.9, 1.25, new THREE.Mesh(barrelGeo, stdMat('barrel', { map: barrelTex, normalMap: photoNormal('barrel', 2, 1), roughness: 0.55, metalness: 0.45 })), 'barrel');
    o.hp = 3;
    return o;
  }
  // 外墙 + 角上的瞭望塔
  {
    const wallMat = new THREE.MeshStandardMaterial({ map: (() => { const t = concreteTex.clone(); t.needsUpdate = true; t.repeat.set(24, 1); return t; })(), normalMap: photoNormal('wall', 24, 1) || (() => { const t = concreteN.clone(); t.needsUpdate = true; t.repeat.set(24, 1); return t; })(), normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.95 });
    for (const [x, z, w, d] of [[0, -HALF - 0.5, 2 * HALF + 2, 1], [0, HALF + 0.5, 2 * HALF + 2, 1], [-HALF - 0.5, 0, 1, 2 * HALF + 2], [HALF + 0.5, 0, 1, 2 * HALF + 2]]) {
      addOb(x, z, w, d, 4, new THREE.Mesh(new THREE.BoxGeometry(w, 4, d), wallMat), 'wall');
    }
    const woodMat = stdMat('wood', { color: 0x7a5530, roughness: 0.9 });
    const roofMat = stdMat('roof', { color: 0x56682f, roughness: 0.9, flatShading: true });
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const tw = new THREE.Group();
      for (const [lx, lz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 8, 0.3), woodMat); leg.position.set(lx, 4, lz); tw.add(leg);
      }
      const plat = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.2, 3.6), woodMat); plat.position.y = 8.2; tw.add(plat);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(3.2, 1.6, 4), roofMat); roof.position.y = 10.4; roof.rotation.y = Math.PI / 4; tw.add(roof);
      tw.position.set(x * (HALF + 2.5), 0, z * (HALF + 2.5));
      scene.add(shadowify(tw));
    }
    // 墙外的帐篷
    const tentMat = stdMat('tent', { color: 0x6b7a35, roughness: 1, flatShading: true });
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2 + 0.2, r = rand(56, 75);
      const t = new THREE.Mesh(new THREE.ConeGeometry(3.5, 3.2, 4), tentMat);
      t.position.set(Math.cos(a) * r, 1.6, Math.sin(a) * r); t.rotation.y = Math.random();
      scene.add(t);
    }
  }
  // 基地里的东西
  [[-20, -8, 1, 0], [-20, -2.2, 1, 1], [22, -12, 0, 2], [14, -28, 1, 3], [-12, -30, 0, 0], [30, 18, 0, 1], [-30, 16, 1, 2], [33, -5, 0, 3]]
    .forEach(([x, z, ax, ci]) => container(x, z, !!ax, ci));
  [[8, 8], [9.7, 8], [-8, 14], [-6, -14], [12, -4], [-14, 6], [26, -30], [-26, -26], [18, 24], [0, -20], [-2, -40], [38, 30], [-38, 30]]
    .forEach(([x, z], i) => crate(x, z, i % 3 === 2 ? 1.2 : 1.6));
  [[0, 21, 1], [-10, 23, 1], [10, 23, 1], [0, -8, 1], [16, 6, 0], [-16, -16, 1], [24, 0, 0], [-24, 8, 0], [8, -36, 1], [-8, -36, 1], [-34, -30, 0], [34, -24, 0]]
    .forEach(([x, z, ax]) => sandbags(x, z, !!ax));
  buildBags();

  [[5, 1, 1], [-5, 1, 1], [28, -20, 0], [-28, -14, 0], [14, 15, 1], [-14, 30, 1], [20, 36, 0]]
    .forEach(([x, z, ax]) => barrier(x, z, !!ax));
  const BARREL_SPOTS = [[9, 10.2], [-8, 16.2], [-20, -11.8], [22, -8.4], [1.4, -21.6], [13, -30.2], [-28, 18.2], [30, 6], [-4, -12], [17.4, 22], [-36, -6], [36, 12]];
  // 油罐（第二关的“油库”）
  {
    const tankMat = hasPhoto('metal')
      ? stdMat('tank', { map: (() => { const t = photoMap('metal', 3, 1); return t; })(), normalMap: photoNormal('metal', 3, 1), color: 0xbfc4b0, roughness: 0.55, metalness: 0.5 })
      : stdMat('tank', { color: 0xd9d4c7, roughness: 0.5, metalness: 0.4 });
    for (const [x, z] of [[-37, -14], [-37, -20.5]]) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 4.2, 24), tankMat); body.position.y = 2.1; g.add(body);
      const top = new THREE.Mesh(new THREE.SphereGeometry(2.6, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), tankMat); top.scale.y = 0.35; top.position.y = 4.2; g.add(top);
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(2.62, 2.62, 0.5, 24), stdMat('tankStripe', { color: 0xc0392b, roughness: 0.6 })); stripe.position.y = 3; g.add(stripe);
      g.position.y = 0;
      addOb(x, z, 5.2, 5.2, 4.6, g, 'tank');
    }
  }
  // ================= 场景细节：伪装网、铁丝网、石头、枯草、轮胎、油渍 =================
  const groundH = (x, z) => {
    const pa = ground.geometry.attributes.position.array;
    const fx = (x + 380) / 4, fz = (z + 380) / 4, ix = Math.max(0, Math.min(189, Math.floor(fx))), iz = Math.max(0, Math.min(189, Math.floor(fz)));
    const tx = fx - ix, tz = fz - iz, H = (i, j) => pa[(j * 191 + i) * 3 + 1];
    return lerp(lerp(H(ix, iz), H(ix + 1, iz), tx), lerp(H(ix, iz + 1), H(ix + 1, iz + 1), tx), tz);
  };
  const freeAt = (x, z, r) => {
    if (Math.abs(x) < 3.6 + r || Math.abs(z + 4) < 3.6 + r) return false; // 公路
    if (Math.hypot(x - PAD.x, z - PAD.z) < 7 + r) return false; // 停机坪
    for (const o of obstacles) if (Math.abs(x - o.x) < o.hx + r && Math.abs(z - o.z) < o.hz + r) return false;
    return true;
  };
  {
    // 伪装网：阳光从网眼里漏下来，地上是斑驳的光影，空气里能看到一束束光
    const netTex = canvasTex(256, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = 'rgba(70,60,40,1)'; g.lineWidth = 1.2;
      for (let i = 0; i <= w; i += 10) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
      const cols = ['#a8956a', '#8c8456', '#b8a274', '#7a7048', '#9a8460', '#6e6842'];
      const holes = Array.from({ length: 14 }, () => [Math.random() * w, Math.random() * h, 5 + Math.random() * 10]);
      for (let i = 0; i < 1500; i++) {
        const x = Math.random() * w, y = Math.random() * h, r = 3 + Math.random() * 7;
        if (holes.some(([hx, hy, hr]) => Math.hypot(x - hx, y - hy) < hr)) continue; // 留一些洞，阳光从这里漏下来
        g.fillStyle = cols[i % cols.length];
        g.beginPath();
        for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2 + Math.random(), rr = r * (0.5 + Math.random() * 0.6); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
        g.fill();
      }
    });
    const netMat = new THREE.MeshStandardMaterial({ map: netTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
    const poleMat = stdMat('netPole', { color: 0x5a4a32, roughness: 0.9 });
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.07, 3.9, 6);
    for (const [cx, cz, w, d, rot] of [[9, 10, 10, 8, 0.1], [-11, 10, 9, 8, -0.15], [22, -9, 9, 11, 0.05], [-22, -26, 10, 8, 0.2], [26, 20, 8, 9, -0.1]]) {
      const geo = new THREE.PlaneGeometry(w, d, 14, 14);
      geo.rotateX(-Math.PI / 2);
      const pa = geo.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const u = pa.getX(i) / (w / 2), v = pa.getZ(i) / (d / 2);
        pa.setY(i, -0.45 * (1 - u * u) * (1 - v * v) + Math.sin(u * 7 + v * 5) * 0.05);
      }
      geo.computeVertexNormals();
      const g = new THREE.Group();
      const net = new THREE.Mesh(geo, netMat); net.position.y = 3.85; g.add(net);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const pole = new THREE.Mesh(poleGeo, poleMat); pole.position.set(sx * w / 2, 1.95, sz * d / 2); g.add(pole);
      }
      g.position.set(cx, 0, cz); g.rotation.y = rot;
      scene.add(shadowify(g));
    }
    // 外墙顶上的铁丝网
    const coil = new THREE.TorusGeometry(0.26, 0.012, 3, 12);
    const wirePts = [];
    for (const [x0, z0, x1, z1] of [[-HALF, -HALF - 0.5, HALF, -HALF - 0.5], [-HALF, HALF + 0.5, HALF, HALF + 0.5], [-HALF - 0.5, -HALF, -HALF - 0.5, HALF], [HALF + 0.5, -HALF, HALF + 0.5, HALF]]) {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.floor(len / 0.22);
      for (let i = 0; i < n; i++) wirePts.push([lerp(x0, x1, i / n), lerp(z0, z1, i / n), Math.atan2(x1 - x0, z1 - z0)]);
    }
    const wire = new THREE.InstancedMesh(coil, stdMat('wire', { color: 0x4a4640, metalness: 0.8, roughness: 0.45 }), wirePts.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    wirePts.forEach(([x, z, a], i) => { e.set(rand(-0.25, 0.25), a, rand(-0.2, 0.2)); m4.compose(v.set(x, 4.27, z), q.setFromEuler(e), sc); wire.setMatrixAt(i, m4); });
    wire.castShadow = true;
    scene.add(wire);

    // 石头：大大小小，基地里零星几块，墙外满地都是
    const rockGeo = new THREE.IcosahedronGeometry(1, 2);
    {
      const pa = rockGeo.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        v.fromBufferAttribute(pa, i);
        const n = 1 + 0.22 * Math.sin(v.x * 3.1 + v.y * 1.7) * Math.cos(v.z * 2.3 - v.x) + 0.1 * Math.sin(v.y * 7 + v.z * 5);
        v.multiplyScalar(n); v.y *= 0.62; pa.setXYZ(i, v.x, v.y, v.z);
      }
      rockGeo.computeVertexNormals();
    }
    const rocks = [];
    for (let i = 0; i < 70; i++) { const x = rand(-LIM, LIM), z = rand(-LIM, LIM); if (freeAt(x, z, 1)) rocks.push([x, z, rand(0.12, 0.35)]); }
    for (let i = 0; i < (isTouch ? 140 : 260); i++) {
      const a = Math.random() * Math.PI * 2, r = rand(49, 150), x = Math.cos(a) * r, z = Math.sin(a) * r;
      rocks.push([x, z, rand(0.4, 1) ** 2 * (r > 90 ? 4 : 2.2) + 0.3]);
    }
    const rockMat = hasPhoto('rock')
      ? new THREE.MeshStandardMaterial({ map: photoMap('rock', 0.5, 0.5), normalMap: photoNormal('rock', 0.5, 0.5), color: 0xd8c8b0, roughness: 0.95, normalScale: new THREE.Vector2(1.5, 1.5) })
      : new THREE.MeshStandardMaterial({ color: 0xa3896a, roughness: 0.95, normalMap: concreteN, normalScale: new THREE.Vector2(1.2, 1.2) });
    const rockIM = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length);
    const col = new THREE.Color();
    rocks.forEach(([x, z, s], i) => {
      e.set(rand(-0.3, 0.3), Math.random() * 7, rand(-0.3, 0.3));
      m4.compose(v.set(x, groundH(x, z) - s * 0.15, z), q.setFromEuler(e), sc.set(s * rand(0.8, 1.4), s * rand(0.7, 1.2), s * rand(0.8, 1.3)));
      rockIM.setMatrixAt(i, m4);
      rockIM.setColorAt(i, col.setHSL(0.08 + rand(-0.02, 0.02), rand(0.15, 0.3), rand(0.42, 0.6)));
    });
    rockIM.castShadow = rockIM.receiveShadow = true;
    scene.add(rockIM);
    sc.set(1, 1, 1);

    // 枯草：风一吹会轻轻摆
    const grassTex = canvasTex(128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      for (let i = 0; i < 60; i++) {
        const x0 = w / 2 + rand(-30, 30), lean = rand(-34, 34), top = rand(10, 60);
        g.strokeStyle = ['#b9a466', '#9f8f52', '#c8b57a', '#8a8048', '#a89a5e'][i % 5];
        g.lineWidth = rand(1.5, 3);
        g.beginPath(); g.moveTo(x0, h); g.quadraticCurveTo(x0 + lean * 0.3, (h + top) / 2, x0 + lean, top); g.stroke();
      }
    });
    grassTex.wrapS = grassTex.wrapT = THREE.ClampToEdgeWrapping;
    const gGeo = (() => {
      const parts = [];
      for (let k = 0; k < 3; k++) { const p = new THREE.PlaneGeometry(0.9, 0.6); p.translate(0, 0.3, 0); p.rotateY(k * Math.PI / 3); parts.push(p); }
      const pos = [], uv = [], idx = []; let off = 0;
      parts.forEach(p => { pos.push(...p.attributes.position.array); uv.push(...p.attributes.uv.array); idx.push(...Array.from(p.index.array, i => i + off)); off += p.attributes.position.count; });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill(0).flatMap(() => [0, 1, 0]), 3));
      g.setIndex(idx);
      return g;
    })();
    const grassMat = new THREE.MeshStandardMaterial({ map: grassTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1 });
    grassMat.onBeforeCompile = sh => {
      sh.uniforms.uTime = skyUniforms.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 ip = instanceMatrix[3];
          float sw = (sin(uTime * 1.8 + ip.x * 0.6 + ip.z * 0.4) + 0.4 * sin(uTime * 4.3 + ip.x)) * 0.09 * max(position.y, 0.0) / 0.6;
          transformed.x += sw; transformed.z += sw * 0.4;`);
    };
    const tufts = [];
    for (let i = 0; i < (isTouch ? 260 : 520); i++) {
      const inside = i % 3 !== 0;
      const x = inside ? rand(-LIM, LIM) : rand(-110, 110), z = inside ? rand(-LIM, LIM) : rand(-110, 110);
      if (inside ? !freeAt(x, z, 0.5) : Math.max(Math.abs(x), Math.abs(z)) < 47) continue;
      tufts.push([x, z]);
    }
    const grassIM = new THREE.InstancedMesh(gGeo, grassMat, tufts.length);
    tufts.forEach(([x, z], i) => {
      const s = rand(0.6, 1.3);
      m4.compose(v.set(x, groundH(x, z) - 0.03, z), q.setFromEuler(e.set(0, Math.random() * 7, 0)), sc.set(s, s * rand(0.7, 1.2), s));
      grassIM.setMatrixAt(i, m4);
      grassIM.setColorAt(i, col.setHSL(0.12 + rand(-0.02, 0.03), rand(0.25, 0.45), rand(0.55, 0.75)));
    });
    grassIM.receiveShadow = true;
    scene.add(grassIM);
    sc.set(1, 1, 1);

    // 一摞摞旧轮胎（也能当掩体）
    const tireGeo = new THREE.TorusGeometry(0.36, 0.15, 8, 18); tireGeo.rotateX(Math.PI / 2);
    const tireMat = stdMat('tire', { color: 0x1d1c1b, roughness: 0.85 });
    let placed = 0;
    for (let tries = 0; tries < 200 && placed < 7; tries++) {
      const x = rand(-LIM + 3, LIM - 3), z = rand(-LIM + 3, LIM - 3);
      if (!freeAt(x, z, 1.5) || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 6 || BARREL_SPOTS.some(([bx, bz]) => Math.hypot(x - bx, z - bz) < 2.5)) continue;
      const g = new THREE.Group(), n = 2 + (placed % 3);
      for (let k = 0; k < n; k++) { const t = new THREE.Mesh(tireGeo, tireMat); t.position.set(rand(-0.05, 0.05), 0.15 + k * 0.29, rand(-0.05, 0.05)); t.rotation.y = Math.random(); g.add(t); }
      addOb(x, z, 1, 1, 0.3 + n * 0.29, g);
      placed++;
    }

    // 地上的油渍和车辙
    const stainTex = canvasTex(128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      for (let i = 0; i < 6; i++) {
        const x = 64 + rand(-22, 22), y = 64 + rand(-22, 22), r = rand(14, 40);
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(30,22,14,0.55)'); gr.addColorStop(1, 'rgba(30,22,14,0)');
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
      }
    });
    stainTex.wrapS = stainTex.wrapT = THREE.ClampToEdgeWrapping;
    const stainMat = new THREE.MeshStandardMaterial({ map: stainTex, transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    const stainGeo = new THREE.PlaneGeometry(1, 1); stainGeo.rotateX(-Math.PI / 2);
    for (const [bx, bz] of BARREL_SPOTS.concat([[-20, -5], [22, -12], [30, 18], [-30, 16], [33, -5], [0, 30], [-5, -18]])) {
      const st = new THREE.Mesh(stainGeo, stainMat);
      const s = rand(2, 4.5);
      st.scale.set(s, 1, s * rand(0.6, 1)); st.rotation.y = Math.random() * 6;
      st.position.set(bx + rand(-1, 1), 0.015, bz + rand(-1, 1)); st.receiveShadow = true;
      scene.add(st);
    }
  }
  // 旗杆
  {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 9, 8), stdMat('pole', { color: 0xdddddd, metalness: 0.6, roughness: 0.3 }));
    pole.position.set(8, 4.5, 34); scene.add(shadowify(pole));
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5, 8, 1), new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.9 }));
    flag.position.set(9.25, 8, 34); scene.add(flag);
    var flagMesh = flag;
  }

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
  // 射线打到掩体 / 地面：返回距离和打到的东西
  const rayHit = { t: 0, ob: null };
  function rayObstacles(o, d, maxT) {
    let best = maxT, bestO = null;
    if (d.y < -1e-4) { const t = -o.y / d.y; if (t > 0 && t < best) best = t; }
    for (const b of obstacles) {
      let t0 = 0, t1 = best, hit = true;
      const mins = [b.x - b.hx, 0, b.z - b.hz], maxs = [b.x + b.hx, b.h, b.z + b.hz];
      const oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
      for (let k = 0; k < 3; k++) {
        if (Math.abs(dd[k]) < 1e-8) { if (oo[k] < mins[k] || oo[k] > maxs[k]) { hit = false; break; } continue; }
        let ta = (mins[k] - oo[k]) / dd[k], tb = (maxs[k] - oo[k]) / dd[k];
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) { hit = false; break; }
      }
      if (hit && t0 > 0 && t0 < best) { best = t0; bestO = b; }
    }
    rayHit.t = best; rayHit.ob = bestO;
    return rayHit;
  }
  const losDir = new THREE.Vector3();
  function lineOfSight(a, b) {
    losDir.copy(b).sub(a);
    const len = losDir.length();
    if (len < 0.01) return true;
    losDir.divideScalar(len);
    return rayObstacles(a, losDir, len).t >= len - 0.2;
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
      if (pPos[j + 1] < 0.05) { pPos[j + 1] = 0.05; pVel[j + 1] *= -0.4; }
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
      p.s.position.set(pos.x + rand(-0.6, 0.6) * size, Math.max(0.5, pos.y) + rand(0, 1) * size, pos.z + rand(-0.6, 0.6) * size);
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
      p.s.position.set(pos.x + Math.cos(a) * 0.5, 0.4 + Math.random() * 0.3, pos.z + Math.sin(a) * 0.5);
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
      f.s.position.set(pos.x + rand(-r, r), Math.max(0.4, pos.y + rand(-0.2, 1) * r), pos.z + rand(-r, r));
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
      if (sh.m.position.y < 0.12) { sh.m.position.y = 0.12; sh.vel.y *= -0.4; sh.vel.x *= 0.7; sh.vel.z *= 0.7; }
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
    if (pos.y < 2) dustRing(pos, size, Math.min(14, 6 + Math.round(size * 3)));
    smokeColumn(pos, size, Math.min(12, 4 + Math.round(size * 3)));
    spawnShards(pos, 0x5a4a3a, Math.min(16, 4 + Math.round(size * 3)), size);
    if (pos.y < 2 && size >= 1.5) addScorch(pos);
    flashLight.position.copy(pos).setY(pos.y + 1);
    flashLight.intensity = 80 * size; flashLightT = 0.25;
    const d = camera.position.distanceTo(pos);
    shake = Math.max(shake, Math.min(1.2, size * 2.5 / (d + 3)));
    if (!silent) Sfx.boom(size >= 2.2, d);
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
  gunScene.add(new THREE.HemisphereLight(0xe8eeff, 0x6a5030, 0.8));
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
    grunt:  { name: '坏蛋步兵', hp: 4, speed: 3.4, scale: 1, score: 10, xp: 1, dmg: 7, shoot: [1.8, 3.2], keep: 14, bullet: 21 },
    runner: { name: '坏蛋突击兵', hp: 3, speed: 6.8, scale: 1, score: 15, xp: 1, dmg: 12 },
    drone:  { name: '侦察无人机', hp: 3, speed: 5, scale: 1, score: 20, xp: 2, dmg: 6, shoot: [1.8, 3], keep: 13, drone: true, bullet: 20 },
    heavy:  { name: '重甲兵', hp: 24, speed: 2.2, scale: 1.12, score: 50, xp: 4, dmg: 6, shoot: [2.6, 3.6], keep: 11, burst: 4, bullet: 20 },
    boss:   { name: '坏蛋司令', hp: 420, speed: 2.4, scale: 1.5, score: 1000, xp: 20, dmg: 10, shoot: [2.0, 2.6], keep: 12, boss: true, bullet: 16 },
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
  let touchJump = false;
  let mission = null, missionNo = 1, tier = 1, mst = null;
  let best = 0, progress = 0, starsSaved = {};
  try {
    best = +localStorage.getItem('ts_best') || 0;
    progress = +localStorage.getItem('ts_progress') || 0;
    starsSaved = JSON.parse(localStorage.getItem('ts_stars') || '{}') || {};
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

  const player = { pos: new THREE.Vector3().copy(SPAWN), vel: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: true, jumpsUsed: 0, bob: 0, eyeH: 1.65 };
  const fwd = new THREE.Vector3(0, 0, -1), right = new THREE.Vector3(1, 0, 0);
  function eyePos(out) { return out.set(player.pos.x, player.pos.y + player.eyeH, player.pos.z); }

  // ---------- 队友 ----------
  const SLOTS = [[-2.2, 2.4], [2.2, 2.4], [-3.6, 4.8], [3.6, 4.8], [0, 5.2], [0, 7.6]];
  function addAlly(fromPos, silent) {
    if (allies.length >= S.maxAllies) { score += 50; return false; }
    const v = makeSoldier('ally');
    const p = fromPos ? fromPos.clone() : player.pos.clone().addScaledVector(fwd, -3);
    p.y = 0; pushOut(p, 0.6);
    v.g.position.copy(p);
    scene.add(v.g);
    allies.push({ v, g: v.g, hp: 40, maxHp: 40, cool: Math.random(), phase: Math.random() * 6, hurtT: 0, speed: 0 });
    if (!silent) puff(tmpV.copy(p).setY(1), 4, 1.6, 0xffffff, 0.9);
    return true;
  }
  function removeAlly(i, retreat) {
    const a = allies[i];
    if (retreat) {
      puff(tmpV.copy(a.g.position).setY(1), 6, 2, 0xffffff, 1);
      floatText(tmpV.copy(a.g.position).setY(2.6), '队友撤退了，别担心！', '#7fc8ff', 20);
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
  let enemyUid = 0;
  function spawnEnemy(type, pos, idle) {
    const T = ETYPES[type];
    const v = T.drone ? makeDrone() : makeSoldier(type);
    const s = T.scale;
    v.g.scale.setScalar(s);
    v.g.position.set(pos.x, T.drone ? 4.2 : 0, pos.z);
    scene.add(v.g);
    const hpMul = tier > 1 ? 1.6 : 1;
    const e = {
      id: ++enemyUid, type, T, v, g: v.g, s,
      hp: Math.ceil(T.hp * hpMul), maxHp: Math.ceil(T.hp * hpMul),
      speed: T.speed * (tier > 1 ? 1.15 : 1) * rand(0.9, 1.1),
      r: (T.drone ? 0.8 : 0.5) * s, flash: 0, kb: new THREE.Vector3(),
      shootT: T.shoot ? rand(1.2, T.shoot[1]) : 0, atk: 0, phase: Math.random() * 6, spawnIn: idle ? 0 : 0.5, idle: !!idle,
      strafe: Math.random() < 0.5 ? 1 : -1, strafeT: rand(1, 3), burst: 0, burstT: 0, summonT: 9, attackN: 0,
      target: null, targetT: 0,
    };
    if (!idle) puff(tmpV.copy(v.g.position).setY(1), 5, 2, 0xd6c3a0, 1.2);
    enemies.push(e);
    return e;
  }
  function hitSpheres(e) {
    const p = e.g.position, s = e.s;
    if (e.T.drone) return [[p.x, p.y, p.z, 0.85 * s, false]];
    return [[p.x, p.y + 1.28 * s, p.z, 0.34 * s, false], [p.x, p.y + 0.62 * s, p.z, 0.3 * s, false], [p.x, p.y + 1.73 * s, p.z, 0.17 * s, true]];
  }
  function removeEnemy(e, keepMesh) {
    if (!keepMesh) { scene.remove(e.g); e.v.flashMats.forEach(m => m.dispose()); }
    const i = enemies.indexOf(e);
    if (i >= 0) enemies.splice(i, 1);
    if (e === boss) { boss = null; $('bossbox').classList.add('hidden'); }
  }
  function poofEnemy(e) {
    const c = tmpV.copy(e.g.position).setY(e.T.drone ? e.g.position.y : 1.2 * e.s);
    puff(c, 5, 2 * e.s, 0xffffff, 1);
    emit(c, 0xffe15a, 10, 5, 0.7, 3);
    removeEnemy(e);
  }
  function damageEnemy(e, dmg, at, head, fromPlayer) {
    if (e.hp <= 0 || e.idle) return;
    e.hp -= dmg;
    e.flash = 0.08;
    if (fromPlayer !== false) e.kb.add(tmpV3.set(e.g.position.x - player.pos.x, 0, e.g.position.z - player.pos.z).normalize().multiplyScalar(e.T.boss ? 0.15 : 1.2));
    if (e.hp <= 0) killEnemy(e, head, fromPlayer !== false);
  }
  function killEnemy(e, head, byPlayer) {
    const p = e.g.position.clone();
    const center = p.clone().setY(e.T.drone ? p.y : p.y + 1.2 * e.s);
    kills++;
    if (!e.minion) missionKills++;
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
        explode(new THREE.Vector3(p.x + rand(-3, 3), rand(1, 6), p.z + rand(-3, 3)), 2.4);
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
      if (roll < 0.1) spawnPickup('ammo', center);
      else if (roll < 0.15) spawnPickup('medkit', center);
      else if (roll < 0.21) spawnPickup('syringe', center);
    }
    if (e.T.drone) { removeEnemy(e); return; }
    // 不血腥：坏蛋向后倒下，然后“噗”地变成一团烟消失
    removeEnemy(e, true);
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
      if (c.t > 0.5 && !c.landed) { c.landed = true; puff(tmpV.copy(g.position).setY(0.3), 3, 1.2 * c.e.s, 0xd6c3a0, 0.9); }
      if (c.t > (c.e.T.boss ? 2.6 : 1.3)) {
        const back = tmpV.set(-Math.sin(g.rotation.y), 0, -Math.cos(g.rotation.y));
        const p = tmpV2.copy(g.position).addScaledVector(back, 0.9 * c.e.s).setY(0.5);
        puff(p, 6, 1.6 * c.e.s, 0xffffff, 1);
        emit(p, 0xffe15a, 10, 4, 0.6, 3);
        scene.remove(g);
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
    g.position.set(pos.x + rand(-spread, spread), Math.max(0.8, pos.y), pos.z + rand(-spread, spread));
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
    for (const o of obstacles.slice()) {
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
    if (obstacles.indexOf(o) < 0) return;
    o.hp -= dmg;
    if (o.hp > 0) { emit(tmpV.set(o.x, 0.8, o.z), 0xffc04a, 6, 4, 0.3, 1); return; }
    removeOb(o);
    const p = new THREE.Vector3(o.x, 0.8, o.z);
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
      if (p.y < 0.14) { p.y = 0.14; gr.vel.y *= -0.45; gr.vel.x *= 0.65; gr.vel.z *= 0.65; }
      const o = insideBox(p);
      if (o) {
        const px = o.hx - Math.abs(p.x - o.x), pz = o.hz - Math.abs(p.z - o.z), py = o.h - p.y;
        if (py < px && py < pz) { p.y = o.h + 0.01; gr.vel.y = Math.abs(gr.vel.y) * 0.45; gr.vel.x *= 0.7; gr.vel.z *= 0.7; }
        else if (px < pz) { p.x = o.x + Math.sign(p.x - o.x || 1) * (o.hx + 0.01); gr.vel.x *= -0.5; }
        else { p.z = o.z + Math.sign(p.z - o.z || 1) * (o.hz + 0.01); gr.vel.z *= -0.5; }
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
    r.life = gren ? 4 : 3;
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
        if (p.y <= 0.05 || insideBox(p) || Math.abs(p.x) > HALF || Math.abs(p.z) > HALF || r.life <= 0) boom = true;
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
        rocketBlast(p.clone().setY(Math.max(0.3, p.y)), r.gren);
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
        const rh = rayObstacles(eye, dir, 160);
        const wallT = rh.t, wallOb = rh.ob;
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
          if (wallT < 160) {
            const n = surfaceNormal(hitP, wallOb);
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
    if (p.y > 1.5) return;
    let d = scorches[scorchI];
    if (!d) { d = new THREE.Mesh(decalGeo, scorchMat); d.receiveShadow = true; d.rotation.x = -Math.PI / 2; scene.add(d); scorches[scorchI] = d; }
    scorchI = (scorchI + 1) % 16;
    d.position.set(p.x, 0.03, p.z);
    d.rotation.z = Math.random() * 6.28;
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

  function jump() {
    if (crouch) { crouch = false; $('tCrouch').classList.remove('on'); return; }
    if (player.onGround) { player.vel.y = 9; player.onGround = false; player.jumpsUsed = 1; Sfx.jump(); }
    else if (jet.has && jet.fuel > 0.05) { /* 有喷气背包：按住空格就是飞 */ }
    else if (player.jumpsUsed < S.jumps) { player.vel.y = 8.5; player.jumpsUsed++; Sfx.jump(); puff(player.pos, 2, 0.8, 0xffffff, 0.5); }
  }

  // ================= 任务 =================
  const MISSIONS = [
    { name: '新兵训练', icon: '🎯', type: 'kill', total: 8, pool: [['grunt', 1]], maxAlive: 4, gap: 2.2,
      desc: '消灭 8 个坏蛋步兵', brief: '欢迎加入雷霆特战队！坏蛋军团闯进了我们的沙漠基地。先熟悉你的突击步枪，躲在箱子和沙袋后面，把他们赶出去！' },
    { name: '夺回油库', icon: '🛢️', type: 'kill', total: 14, pool: [['grunt', 3], ['runner', 2]], maxAlive: 6, gap: 1.8,
      desc: '消灭 14 个坏蛋', brief: '坏蛋想偷走基地的油！小心那些红色油桶：打中会爆炸，可以用它们一下子炸飞一群坏蛋。突击兵会冲过来，用霰弹枪对付他们！' },
    { name: '营救队友', icon: '🔓', type: 'rescue', pool: [['grunt', 3], ['runner', 2], ['drone', 1]], maxAlive: 6, gap: 2.4,
      desc: '救出 3 名队友，坐直升机撤离', brief: '我们的 3 名队友被关进了笼子！跑到笼子旁边站一会儿就能救出他们。救出来的队友会和你并肩作战。新拿到的狙击枪按右键开镜，能远远地打坏蛋。最后跑回直升机撤离！' },
    { name: '摧毁雷达', icon: '📡', type: 'demo', pool: [['grunt', 3], ['runner', 2], ['drone', 2], ['heavy', 1]], maxAlive: 7, gap: 2.2,
      desc: '炸掉 2 座雷达，然后撤离', brief: '坏蛋用雷达偷看我们的行动。站在雷达旁边安放炸药，倒数结束就会“轰”的一声炸掉！新拿到的火箭筒专门对付穿厚盔甲的重甲兵。' },
    { name: '坚守阵地', icon: '🛡️', type: 'survive', time: 75, pool: [['grunt', 4], ['runner', 3], ['drone', 2], ['heavy', 1]], maxAlive: 9, gap: 1.5,
      desc: '守住基地 75 秒', brief: '坏蛋军团从四面八方冲过来了！守住基地 75 秒，援军就到。看准坏蛋扎堆的地方，用火箭筒和手榴弹！' },
    { name: '击败坏蛋司令', icon: '👑', type: 'boss', pool: [['grunt', 2], ['runner', 1]], maxAlive: 5, gap: 4,
      desc: '打败坏蛋司令', brief: '坏蛋军团的司令亲自来了！他会放出一圈子弹，记得跳起来躲开。打败他，基地就安全了！' },
  ];
  const CAGE_SPOTS = [[-32, -33], [32, -30], [-26, 2]];
  const DISH_SPOTS = [[-28, -38], [28, -38]];
  let objectives = [];

  function missionTitle() { return `${tier > 1 ? '困难 · ' : ''}任务 ${missionNo}：${mission.name}`; }

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
    shadowify(g);
    const ob = addOb(x, z, 2.5, 2.5, 2.45, g, 'cage');
    g.position.y = 0;
    return { kind: 'cage', x, z, g, bars, hostage, ob, prog: 0, done: false };
  }
  function makeDish(x, z) {
    const g = new THREE.Group();
    const mat = stdMat('dish', { color: 0xd8d8d0, metalness: 0.5, roughness: 0.4 });
    const base = new THREE.Mesh(B(2.2, 2.6, 2.2), stdMat('dishbase', { map: concreteTex, roughness: 0.9 })); base.position.y = 1.3; g.add(base);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.6, 8), mat); mast.position.y = 3.4; g.add(mast);
    const head = new THREE.Group(); head.position.y = 4.2; g.add(head);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.6, 20, 10, 0, Math.PI * 2, 0, Math.PI / 3), new THREE.MeshStandardMaterial({ color: 0xe8e8e0, metalness: 0.4, roughness: 0.4, side: THREE.DoubleSide }));
    dish.rotation.x = -Math.PI / 2 - 0.5; head.add(dish);
    const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6), mat); horn.rotation.x = -0.5 + Math.PI / 2; horn.position.set(0, 0.35, 0.6); head.add(horn);
    const light = glowSprite(0xff2020, 1.4, 0.9); light.position.y = 5.2; g.add(light);
    shadowify(g);
    const ob = addOb(x, z, 2.2, 2.2, 2.6, g, 'dish');
    g.position.y = 0;
    return { kind: 'dish', x, z, g, head, light, ob, prog: 0, planted: false, fuse: 0, done: false, beep: 0 };
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
    g.position.set(x, 0, z);
    g.rotation.y = Math.random() * Math.PI * 2;
    scene.add(g);
    return { x, z, rar, g, lidPivot, glow, beam, ring, prog: 0, opened: false, openT: 0, busy: false };
  }
  function setupChests() {
    const n = 3 + (missionNo >= 3 ? 1 : 0) + (tier > 1 ? 1 : 0);
    const spots = [];
    for (let tries = 0; spots.length < n + 1 && tries < 400; tries++) {
      const x = rand(-38, 38), z = rand(-38, 30);
      if (!freeAt(x, z, 1.3)) continue;
      if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 12) continue;
      if (spots.some(([a, b]) => Math.hypot(a - x, b - z) < 14)) continue;
      if (objectives.some(o => Math.hypot(o.x - x, o.z - z) < 5)) continue;
      spots.push([x, z]);
    }
    // 最后一个位置放喷气背包
    const jp = spots.pop();
    spots.forEach(([x, z], i) => {
      const r = Math.random();
      let rar = r < 0.5 ? 0 : r < 0.85 ? 1 : 2;
      if (i === 0) rar = Math.max(rar, missionNo >= 4 || tier > 1 ? 2 : 1); // 至少有一个好箱子
      chests.push(makeChest(x, z, rar));
    });
    if (jp && !jet.has) spawnPickup('jetpack', new THREE.Vector3(jp[0], 1, jp[1]));
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
      if (d < 2.2 && player.pos.y < 1.5) {
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
    const p = new THREE.Vector3(c.x, 1, c.z);
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
      removeOb(o.ob);
      if (o.hostage) o.hostage.flashMats.forEach(m => m.dispose());
    }
    objectives = [];
  }
  function resetBarrels() {
    for (const o of obstacles.slice()) if (o.kind === 'barrel') removeOb(o);
    BARREL_SPOTS.forEach(([x, z]) => barrel(x, z));
  }

  // ---------- 直升机 ----------
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
  function heliLand() { heli.mode = 'landed'; heli.g.visible = true; heli.g.position.copy(PAD); heli.g.rotation.set(0, 0, 0); heli.spin = 1; }
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
        g.position.set(PAD.x, Math.min(18, k * k * 2.2), PAD.z + Math.max(0, k - 1.5) ** 2 * 6);
        g.rotation.x = Math.min(0.25, Math.max(0, k - 1.5) * 0.15);
      }
      if (t > 9) { heli.mode = 'gone'; g.visible = false; }
    } else if (heli.mode === 'arrive') {
      const T = 6, t = Math.min(1, heli.t / T);
      const e = 1 - Math.pow(1 - t, 3);
      g.position.set(PAD.x + Math.sin(t * Math.PI) * 6, lerp(22, 0, Math.min(1, e * 1.05)), lerp(PAD.z + 120, PAD.z, e));
      g.rotation.set(-0.2 * (1 - t), 0, Math.sin(t * Math.PI) * -0.15);
      heli.spin = 1;
      if (t >= 1) { heli.mode = 'landed'; g.position.copy(PAD); g.rotation.set(0, 0, 0); banner('直升机到了！', '快跑上直升机撤离！🚁'); }
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

  // ---------- 任务选择 / 简报 ----------
  let runKeep = false; // 从“下一个任务”进入时保留升级
  function stars(n) { return [0, 1, 2].map(i => `<span class="${i < n ? '' : 'off'}">⭐</span>`).join(''); }
  function showMissions() {
    $('title').classList.add('hidden');
    const grid = $('mGrid');
    grid.innerHTML = '';
    const cards = MISSIONS.map((m, i) => ({ n: i + 1, t: 1, icon: m.icon, name: m.name, desc: m.desc, open: i <= progress, st: starsSaved['1_' + (i + 1)] || 0 }));
    cards.push({ n: 1, t: 2, icon: '🔥', name: '困难挑战', desc: '6 个任务再来一遍，坏蛋更强！所有武器都能用', open: progress >= 6, st: 0 });
    for (const c of cards) {
      const d = document.createElement('div');
      d.className = 'm-card' + (c.open ? '' : ' locked');
      d.innerHTML = `<div class="mc-no">${c.t > 1 ? 'HARD' : 'MISSION ' + c.n}</div><div class="mc-icon">${c.open ? c.icon : '🔒'}</div><div class="mc-name">${c.name}</div><div class="mc-desc">${c.open ? c.desc : '先完成前面的任务'}</div>${c.st ? `<div class="mc-stars">${'⭐'.repeat(c.st)}</div>` : ''}`;
      if (c.open) d.onclick = () => { Sfx.init(); Sfx.pickup(); $('missions').classList.add('hidden'); showBriefing(c.n, c.t, false); };
      grid.appendChild(d);
    }
    $('missions').classList.remove('hidden');
  }
  function showBriefing(n, t, keep) {
    missionNo = n; tier = t; mission = MISSIONS[n - 1]; runKeep = keep;
    $('brTitle').textContent = missionTitle();
    $('brText').textContent = mission.brief;
    $('brObj').textContent = '🎯 目标：' + mission.desc;
    const ws = WEAPONS.map((W, i) => unlocked(i) ? (W.unlock === n - 1 && t === 1 && W.unlock > 0 ? `🆕${W.name}` : W.name) : null).filter(Boolean);
    $('brNew').textContent = '🔫 可用武器：' + ws.join(' · ');
    $('briefing').classList.remove('hidden');
  }
  function nextMission() {
    let n = missionNo + 1, t = tier;
    if (n > MISSIONS.length) { n = 1; t = tier + 1; }
    $('complete').classList.add('hidden');
    showBriefing(n, t, true);
  }

  // ================= 游戏流程 =================
  function clearWorld() {
    while (allies.length) removeAlly(0);
    while (enemies.length) removeEnemy(enemies[0]);
    corpses.forEach(c => { scene.remove(c.e.g); c.e.v.flashMats.forEach(m => m.dispose()); }); corpses = [];
    while (pickups.length) removePickup(0);
    for (const o of ebullets) { o.alive = false; o.mesh.visible = false; }
    for (const g of grenades) { g.alive = false; g.mesh.visible = false; }
    for (const r of rockets) { r.alive = false; r.mesh.visible = false; }
    clearObjectives();
    clearChests();
    clearDecals();
    healT = 0; healKind = null; healRoot.visible = false;
    boss = null;
    $('bossbox').classList.add('hidden');
    $('holdBar').classList.add('hidden');
    $('reloadTip').classList.add('hidden');
    $('scope').classList.add('hidden');
    markersEl.innerHTML = ''; markerPool.length = 0;
  }
  function hideScreens() {
    ['title', 'missions', 'briefing', 'complete', 'pause', 'upgrade', 'over', 'book'].forEach(id => $(id).classList.add('hidden'));
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
    gunRoot.visible = false;
    camera.fov = BASE_FOV; camera.updateProjectionMatrix();
    resetBarrels();
    heliLand(); heli.beacon.visible = false;
    tier = 1;
    // 开始界面：队友在直升机前面集合，远处有几个坏蛋
    S.maxAllies = 6;
    const spots = [[-3, 28], [-1, 27.4], [1, 27.4], [3, 28]];
    for (const [x, z] of spots) { addAlly(new THREE.Vector3(x, 0, z), true); }
    allies.forEach(a => { a.g.rotation.y = Math.PI; a.title = true; });
    const props = [['grunt', -6, 8], ['heavy', 0, 4], ['runner', 6, 8], ['drone', 3, 6]];
    for (const [t, x, z] of props) spawnEnemy(t, new THREE.Vector3(x, 0, z), true);
    state = 'title';
    refreshToggles();
  }

  async function startMission(retry) {
    const id = ++gameId;
    clearWorld();
    hideScreens();
    $('quiz').classList.add('hidden');
    if (!retry && !runKeep) resetRun();
    runKeep = false;
    mission = MISSIONS[missionNo - 1];
    Learn.resetSession();
    hp = S.maxHp; invuln = 0; combo = 0; pendingLevels = 0; revivesLeft = 2; revivesUsed = 0; missionKills = 0; missionTime = 0;
    grenadeCount = Math.max(grenadeCount, 3);
    ammo.forEach((A, i) => { A.mag = magSize(i); });
    reloadT = 0; switchT = 0; aimT = 0; aimToggle = false; $('tAim').classList.remove('on'); autoReloadT = -1;
    boltT = 0; pumpT = 0; heat = 0; recP = 0; recY = 0; crouch = false; $('tCrouch').classList.remove('on');
    jet.has = false; jet.fuel = 1; jet.tipShown = false;
    meds.shot = Math.max(meds.shot, 1);
    // 每次出发至少带一些备用子弹
    WEAPONS.forEach((W, i) => { if (W.reserve !== Infinity) ammo[i].res = Math.max(ammo[i].res, W.reserve); });
    if (!unlocked(curW)) curW = 2;
    // 新解锁的武器直接拿在手上
    const fresh = WEAPONS.findIndex(W => W.unlock === missionNo - 1 && W.unlock > 0);
    if (tier === 1 && fresh >= 0 && unlocked(fresh) && !retry) curW = fresh;
    showGun();
    player.pos.copy(SPAWN); player.vel.set(0, 0, 0); player.yaw = 0; player.pitch = -0.03;
    fwd.set(0, 0, -1); right.set(1, 0, 0);
    resetBarrels();
    heliLand(); heli.beacon.visible = false;
    for (let i = 0; i < S.allyCount; i++) addAlly(new THREE.Vector3(SLOTS[i][0], 0, SPAWN.z + SLOTS[i][1]), true);
    setupObjectives();
    gunRoot.visible = true;
    $('hud').classList.remove('hidden');
    refreshToggles();
    enterMenu();
    if (Learn.enabled) {
      await Learn.learnNew(mission.type === 'boss' ? 3 : 2, '📚 出发前先背单词');
      if (id !== gameId) return;
    } else requestLock();
    state = 'playing';
    heliLeave();
    banner(missionTitle(), mission.desc);
    Sfx.wave();
  }

  function setupObjectives() {
    mst = { phase: 'fight', spawned: 0, spawnT: 2, timer: mission.time || 0, bossT: 2.5, doneT: 0, extractCalled: false };
    if (mission.type === 'rescue') CAGE_SPOTS.forEach(([x, z]) => objectives.push(makeCage(x, z)));
    if (mission.type === 'demo') DISH_SPOTS.forEach(([x, z]) => objectives.push(makeDish(x, z)));
    setupChests();
  }

  function spawnPoint(anySide) {
    let bestP = null, bestD = -1;
    for (let i = 0; i < 10; i++) {
      const side = anySide ? Math.floor(Math.random() * 4) : [0, 0, 1, 3][Math.floor(Math.random() * 4)];
      const u = rand(-LIM + 3, LIM - 3), e = LIM - 1.5;
      const p = side === 0 ? new THREE.Vector3(u, 0, -e) : side === 1 ? new THREE.Vector3(e, 0, u * 0.6 - 10) : side === 2 ? new THREE.Vector3(u, 0, e) : new THREE.Vector3(-e, 0, u * 0.6 - 10);
      pushOut(p, 1.2);
      const d = p.distanceTo(player.pos);
      if (d > bestD) { bestD = d; bestP = p; }
      if (d > 26) break;
    }
    return bestP;
  }
  function pickType(pool) {
    const tot = pool.reduce((s, o) => s + o[1], 0);
    let r = Math.random() * tot;
    for (const o of pool) { r -= o[1]; if (r <= 0) return o[0]; }
    return pool[0][0];
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

  function updateMission(dt) {
    const m = mission;
    missionTime += dt;
    // 刷坏蛋
    const fighting = mst.phase === 'fight' || mst.phase === 'extract';
    const limitedTotal = m.type === 'kill' ? m.total : Infinity;
    let maxAlive = m.maxAlive + (tier > 1 ? 2 : 0);
    if (mst.phase === 'extract') maxAlive = Math.ceil(maxAlive * 0.6);
    if (m.type === 'survive') maxAlive += Math.floor((m.time - mst.timer) / 25);
    mst.spawnT -= dt;
    const nonMinion = enemies.filter(e => !e.minion && !e.T.boss).length;
    if (fighting && mst.spawnT <= 0 && mst.spawned < limitedTotal && nonMinion < maxAlive) {
      mst.spawnT = m.gap * rand(0.7, 1.2) * (m.type === 'survive' ? Math.max(0.55, mst.timer / m.time) : 1);
      const n = Math.min(limitedTotal - mst.spawned, maxAlive - nonMinion, Math.random() < 0.4 ? 2 : 1);
      const p = spawnPoint(m.type === 'survive');
      for (let i = 0; i < n; i++) {
        spawnEnemy(pickType(m.pool), new THREE.Vector3(p.x + rand(-2, 2), 0, p.z + rand(-2, 2)));
        mst.spawned++;
      }
    }
    let objText = '', holdText = null, holdVal = 0;
    if (m.type === 'kill') {
      objText = `消灭坏蛋 ${Math.min(missionKills, m.total)}/${m.total}`;
      if (missionKills >= m.total && mst.phase === 'fight') missionDone();
    } else if (m.type === 'rescue' || m.type === 'demo') {
      let left = 0;
      for (const o of objectives) {
        if (o.done) continue;
        if (o.kind === 'dish' && o.planted) {
          o.fuse -= dt; o.beep -= dt;
          o.light.material.opacity = Math.floor(o.fuse * 6) % 2 ? 1 : 0.2;
          if (o.beep <= 0) { o.beep = 1; Sfx.empty(); floatText(tmpV.set(o.x, 5.5, o.z), String(Math.ceil(o.fuse)), '#ff5a5a', 40); }
          if (o.fuse <= 0) {
            o.done = true;
            const p = new THREE.Vector3(o.x, 3, o.z);
            explode(p, 4.5);
            for (let k = 0; k < 4; k++) explode(new THREE.Vector3(o.x + rand(-2, 2), rand(1, 5), o.z + rand(-2, 2)), 2, true);
            blastDamage(p, 7, 20);
            removeOb(o.ob);
            screenFlash('#ffb347', 0.35);
            banner('雷达炸毁！', objectives.filter(x => x.kind === 'dish' && !x.done).length ? '还有一座，继续！' : '全部炸毁！');
          }
          continue;
        }
        left++;
        const d = Math.hypot(player.pos.x - o.x, player.pos.z - o.z);
        const need = o.kind === 'cage' ? 2 : 3;
        if (d < 3.2 || o.force) {
          o.prog += dt / need;
          holdText = o.kind === 'cage' ? '🔓 营救队友中… 站着别动！' : '💣 安放炸药中…';
          holdVal = o.prog;
          if (o.prog >= 1) {
            if (o.kind === 'cage') {
              o.done = true;
              o.g.remove(o.bars);
              o.g.remove(o.hostage.g);
              o.hostage.flashMats.forEach(mm => mm.dispose());
              o.hostage = null;
              removeOb(o.ob);
              addAlly(new THREE.Vector3(o.x, 0, o.z));
              S.allyCount = Math.min(S.maxAllies, S.allyCount + 1);
              puff(tmpV.set(o.x, 1, o.z), 6, 2, 0xffffff, 1);
              Sfx.recruit();
              centerText('🪖 队友获救，加入战斗！', '#7fc8ff', 34);
            } else {
              o.planted = true; o.fuse = 4; o.beep = 0;
              Sfx.pickup();
              centerText('💣 炸药装好了！快跑开！', '#ff8a1f', 34);
            }
          }
        } else o.prog = Math.max(0, o.prog - dt * 0.15);
      }
      const total = objectives.length, done = objectives.filter(o => o.done).length;
      if (mst.phase === 'fight') {
        objText = m.type === 'rescue' ? `救出队友 ${done}/${total}` : `炸掉雷达 ${done}/${total}`;
        if (done >= total) { mst.phase = 'extract'; heliArrive(); banner('目标完成！', '直升机马上就到，回到停机坪！'); }
      }
    } else if (m.type === 'survive') {
      if (mst.phase === 'fight') {
        mst.timer -= dt;
        const s = Math.max(0, Math.ceil(mst.timer));
        objText = `坚守阵地 ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        if (mst.timer <= 0) { enemies.slice().forEach(e => poofEnemy(e)); missionDone(); }
      }
    } else if (m.type === 'boss') {
      if (!mst.bossSpawned) {
        mst.bossT -= dt;
        objText = '坏蛋司令要来了…';
        if (mst.bossT <= 0) {
          mst.bossSpawned = true;
          const e = spawnEnemy('boss', new THREE.Vector3(0, 0, -32));
          e.spawnIn = 1;
          boss = e;
          $('bossname').textContent = `👑 ${e.T.name}`;
          $('bossbox').classList.remove('hidden');
          banner('⚠ 坏蛋司令出现 ⚠', '他会放一圈子弹：跳起来躲开！', true);
          Sfx.warn();
          screenFlash('#ff3030', 0.3);
          shake = 1;
        }
      } else if (mst.phase === 'fight') {
        objText = '击败坏蛋司令';
        if (!boss) { enemies.slice().forEach(e => poofEnemy(e)); missionDone(); }
      }
    }
    if (mst.phase === 'extract') {
      objText = heli.mode === 'landed' ? '跑上直升机撤离！🚁' : '等待直升机…守住！';
      if (heli.mode === 'landed' && Math.hypot(player.pos.x - PAD.x, player.pos.z - PAD.z) < 6) {
        enemies.slice().forEach(e => poofEnemy(e));
        missionDone();
      }
    }
    if (mst.phase === 'done') objText = '✅ 任务完成！';
    setText('mObj', objText);
    if (!holdText && chestHold) { holdText = chestHold.text; holdVal = chestHold.v; }
    $('holdBar').classList.toggle('hidden', !holdText);
    if (holdText) { setText('holdLabel', holdText); setWidth('holdFill', Math.min(1, holdVal) * 100); }
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
    const key = tier + '_' + missionNo;
    if (!starsSaved[key] || starsSaved[key] < st) starsSaved[key] = st;
    if (tier === 1 && missionNo > progress) progress = missionNo;
    const newBest = score > best;
    if (newBest) best = score;
    try {
      localStorage.setItem('ts_progress', progress);
      localStorage.setItem('ts_stars', JSON.stringify(starsSaved));
      localStorage.setItem('ts_best', best);
    } catch (e) {}
    $('cpTitle').textContent = missionNo === 6 ? '🏆 基地安全了！你是英雄！' : '✅ 任务完成！';
    $('cpStars').innerHTML = stars(st);
    const newW = WEAPONS.filter(W => W.unlock === missionNo && !found[W.id]).map(W => W.name);
    const unlockMsg = tier === 1 && newW.length ? `<span class="newbest">🔓 新武器解锁：${newW.join('、')}！</span><br>` : '';
    $('cpStats').innerHTML = `
      ${unlockMsg}
      总分 <b>${score}</b> · 用时 <b>${Math.round(missionTime)}</b> 秒<br>
      打败 <b>${missionKills}</b> 个坏蛋 · 爆头 <b>${headshots}</b> 次 · 等级 <b>${level}</b><br>
      ${Learn.enabled ? `这次答对 <b>${Learn.sessionRight}</b> 个单词 📚<br>` : ''}
      ${newBest ? '<span class="newbest">🎉 新纪录！</span>' : `最高分 ${best}`}`;
    $('cpNext').textContent = missionNo === 6 ? '🔥 挑战困难模式 ▶' : '下一个任务 ▶';
    $('complete').classList.remove('hidden');
  }

  async function doLevelUp() {
    const id = gameId;
    enterMenu();
    Sfx.levelUp();
    emit(new THREE.Vector3(player.pos.x, 1, player.pos.z), 0xffd23f, 50, 9, 1, 6);
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
        grenadeBlast(new THREE.Vector3(player.pos.x, 1, player.pos.z));
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
    const spd = S.speed * sprint * (1 - aimT * 0.4) * lerp(1, 0.55, crouchK) * W.move * (healT > 0 ? 0.55 : 1);
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
        if (player.pos.y > 30) player.vel.y = Math.min(player.vel.y, 0);
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
    const gh = groundAt(p.x, p.z, 0.45, p.y);
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
      camera.position.set(Math.sin(a) * 20, 7 + Math.sin(t * 0.3), PAD.z - 6 + Math.cos(a) * 20);
      camera.lookAt(0, 2, PAD.z - 6);
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

  function nearestEnemy(pos, range, needLos) {
    let bestE = null, bd = range * range;
    for (const e of enemies) {
      if (e.idle || e.spawnIn > 0) continue;
      const dx = e.g.position.x - pos.x, dz = e.g.position.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bd) {
        if (needLos && !lineOfSight(tmpV.set(pos.x, 1.5, pos.z), tmpV2.set(e.g.position.x, e.T.drone ? e.g.position.y : 1.3 * e.s, e.g.position.z))) continue;
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
      pushOut(g.position, 0.5);
      g.position.x = clamp(g.position.x, -LIM, LIM); g.position.z = clamp(g.position.z, -LIM, LIM);
      g.position.y = 0;
      a.speed = sp;
      const target = combat ? (a.tgtT > 0 && a.tgt && enemies.includes(a.tgt) ? a.tgt : null) : null;
      a.tgtT = (a.tgtT || 0) - dt;
      if (combat && a.tgtT <= 0) { a.tgtT = 0.5; a.tgt = nearestEnemy(g.position, 30, true); }
      const face = target ? Math.atan2(target.g.position.x - g.position.x, target.g.position.z - g.position.z) : (sp > 0.5 ? Math.atan2(dx, dz) : Math.atan2(-fwd.x, -fwd.z) + Math.PI);
      faceTo(g, face, Math.min(1, dt * 8));
      Humans.animate(v, dt, sp > 0.4 ? sp : 0);
      flashUpdate(v, dt);
      if (a.hurtT > 0) a.hurtT -= dt; else if (a.hp < a.maxHp) a.hp = Math.min(a.maxHp, a.hp + 3 * dt);
      if (!combat) continue;
      a.cool -= dt;
      if (target && a.cool <= 0) {
        a.cool = rand(0.6, 0.95);
        const from = new THREE.Vector3(g.position.x, 1.45, g.position.z).addScaledVector(tmpV.set(Math.sin(g.rotation.y), 0, Math.cos(g.rotation.y)), 0.9);
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

  function updateEnemies(dt, t) {
    const pp = player.pos;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i], g = e.g, v = e.v;
      if (e.idle) {
        g.rotation.y = Math.atan2(camera.position.x - g.position.x, camera.position.z - g.position.z);
        if (e.T.drone) { g.position.y = 4 + Math.sin(t * 2 + e.phase) * 0.3; v.rotors.forEach(r => { r.rotation.y += dt * 30; }); }
        else Humans.animate(v, dt, 0);
        continue;
      }
      if (e.spawnIn > 0) {
        e.spawnIn -= dt;
        g.scale.setScalar(e.s * Math.max(0.01, 1 - e.spawnIn / (e.T.boss ? 1 : 0.5)));
        continue;
      }
      g.scale.setScalar(e.s);
      // 选目标：大多数时候打玩家，有时打队友
      e.targetT -= dt;
      if (e.targetT <= 0) {
        e.targetT = rand(2.5, 4);
        e.target = null;
        if (allies.length && Math.random() < 0.3) e.target = allies[Math.floor(Math.random() * allies.length)];
      }
      if (e.target && !allies.includes(e.target)) e.target = null;
      const tg = e.target ? e.target.g.position : pp;
      let dx = tg.x - g.position.x, dz = tg.z - g.position.z;
      const dist = Math.hypot(dx, dz) || 1;
      dx /= dist; dz /= dist;
      const angry = e.T.boss && e.hp < e.maxHp / 2;
      let spd = e.speed * (angry ? 1.4 : 1);
      let mvx = dx, mvz = dz;
      if (e.T.keep && dist < e.T.keep) {
        e.strafeT -= dt;
        if (e.strafeT <= 0) { e.strafe *= -1; e.strafeT = rand(1, 2.5); }
        mvx = -dz * e.strafe * 0.8 - dx * 0.25; mvz = dx * e.strafe * 0.8 - dz * 0.25;
        spd *= 0.6;
      }
      if (state !== 'playing') spd = 0;
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
      g.position.x = clamp(g.position.x, -LIM, LIM); g.position.z = clamp(g.position.z, -LIM, LIM);
      faceTo(g, Math.atan2(dx, dz), Math.min(1, dt * 10));

      if (e.T.drone) {
        g.position.y = 4.2 + Math.sin(t * 2.5 + e.phase) * 0.4;
        v.rotors.forEach(r => { r.rotation.y += dt * 40; });
        v.body.rotation.x = mvz * 0.1 * Math.sign(spd);
      } else {
        Humans.animate(v, dt, spd > 0 ? Math.hypot(mvx, mvz) * spd : 0);
      }
      flashUpdate(v, dt);

      // 开枪（看得见目标才开枪，躲在掩体后面就安全）
      if (e.T.shoot && state === 'playing') {
        e.shootT -= dt;
        e.burstT -= dt;
        if (e.shootT <= 0 && dist < 36) {
          e.shootT = rand(e.T.shoot[0], e.T.shoot[1]) * (angry ? 0.7 : 1);
          const from = tmpV.set(g.position.x, e.T.drone ? g.position.y - 0.3 : 1.45 * e.s, g.position.z);
          const to = tmpV2.set(tg.x, (e.target ? 0 : pp.y) + 1.3, tg.z);
          if (e.T.boss) {
            e.attackN++;
            if (e.attackN % 3 === 0) {
              const n = angry ? 20 : 14, off = Math.random();
              const c = new THREE.Vector3(g.position.x, 0.8, g.position.z);
              for (let k = 0; k < n; k++) {
                const a = (k + off) / n * Math.PI * 2;
                fireBullet(c, new THREE.Vector3(c.x + Math.cos(a), 0.8, c.z + Math.sin(a)), 11, e.T.dmg, true);
              }
              spawnRing(g.position, 0xff3030, 8, 0.5);
              centerText('⬆ 跳起来躲开！', '#ff6b6b', 34);
            } else {
              e.burst = angry ? 5 : 3;
            }
          } else if (lineOfSight(from, to)) {
            e.burst = e.T.burst || 1;
          } else e.shootT *= 0.4; // 看不见就过一会儿再看
        }
        if (e.burst > 0 && e.burstT <= 0) {
          e.burst--; e.burstT = e.T.boss ? 0.15 : 0.2;
          const fx = Math.sin(g.rotation.y), fz = Math.cos(g.rotation.y);
          const from = new THREE.Vector3(g.position.x + fx * 0.8 * e.s + fz * 0.25 * e.s, e.T.drone ? g.position.y - 0.3 : 1.3 * e.s, g.position.z + fz * 0.8 * e.s - fx * 0.25 * e.s);
          const miss = e.T.boss ? 1.2 : 0.9;
          const to = new THREE.Vector3(tg.x + rand(-miss, miss), (e.target ? 0 : pp.y) + rand(0.8, 1.6), tg.z + rand(-miss, miss));
          if (e.T.boss) { // 扇形
            for (let k = -1; k <= 1; k++) fireBullet(from, to.clone().add(new THREE.Vector3(-dz * k * 2.5, 0, dx * k * 2.5)), e.T.bullet, e.T.dmg * 0.6, true);
          } else fireBullet(from, to, e.T.bullet * (tier > 1 ? 1.15 : 1), e.T.dmg, false);
          spawnFlash(from, 0xffb050, 0.9 * e.s, 0.08);
        }
        if (e.T.boss) {
          e.summonT -= dt;
          if (e.summonT <= 0) {
            e.summonT = angry ? 8 : 11;
            for (let k = 0; k < 3; k++) {
              const a = Math.random() * Math.PI * 2;
              const m2 = spawnEnemy(Math.random() < 0.6 ? 'grunt' : 'runner', new THREE.Vector3(g.position.x + Math.cos(a) * 5, 0, g.position.z + Math.sin(a) * 5));
              m2.minion = true;
            }
            centerText('坏蛋司令叫来了帮手！', '#ff6b6b', 28);
          }
        }
      }
      // 近身攻击
      e.atk -= dt;
      if (!e.T.drone && state === 'playing' && e.atk <= 0) {
        const reach = e.r + 0.8;
        const pd = Math.hypot(pp.x - g.position.x, pp.z - g.position.z);
        if (pd < reach && pp.y < 2 * e.s) {
          e.atk = 1.1;
          hurtPlayer(e.T.boss ? 20 : e.T.dmg + (e.type === 'runner' ? 0 : 3));
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
      if (b.life <= 0 || Math.abs(p.x) > HALF + 2 || Math.abs(p.z) > HALF + 2 || p.y < 0) { b.alive = false; b.mesh.visible = false; continue; }
      const ob = insideBox(p);
      if (ob) {
        emit(p, 0xffa040, 4, 3, 0.25, 1);
        if (ob.kind === 'barrel') damageBarrel(ob, 1);
        b.alive = false; b.mesh.visible = false; continue;
      }
      let hit = false;
      for (let i = allies.length - 1; i >= 0; i--) {
        const ap = allies[i].g.position;
        if ((ap.x - p.x) ** 2 + (ap.z - p.z) ** 2 < 0.3 && p.y > 0.2 && p.y < 2.3) { hurtAlly(i, b.dmg); hit = true; break; }
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
        if (g.position.y < 0.7) { g.position.y = 0.7; p.vel.set(0, 0, 0); }
        pushOut(g.position, 0.4);
      } else g.position.y = (p.kind === 'jetpack' ? 1.1 : 0.8) + Math.sin(p.t * 3) * 0.15;
      g.rotation.y += dt * 2.5;
      if (p.life < 4) g.visible = Math.floor(p.life * 6) % 2 === 0;
      const dx = pp.x - g.position.x, dz = pp.z - g.position.z;
      const d = Math.hypot(dx, dz) || 0.01;
      if (p.kind === 'medal' && (d < 6 || p.forced) && state === 'playing') {
        const sp = (p.forced ? 30 : 12) + Math.max(0, 6 - d) * 2;
        g.position.x += dx / d * sp * dt; g.position.z += dz / d * sp * dt;
      }
      if (d < 1.4 && state === 'playing') {
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
  function updateMarkers() {
    const list = [];
    if (state !== 'title' && mission && mst) {
      for (const o of objectives) {
        if (o.done) continue;
        if (o.kind === 'cage') list.push([o.x, 3.2, o.z, '🔓', '救队友']);
        else list.push([o.x, 6, o.z, o.planted ? '💣' : '📡', o.planted ? '快跑开！' : '安放炸药']);
      }
      if (mst.phase === 'extract') list.push([PAD.x, heli.g.visible ? heli.g.position.y + 5 : 5, PAD.z, '🚁', '撤离点']);
      if (boss) list.push([boss.g.position.x, boss.g.position.y + 2.25 * boss.s + 0.4, boss.g.position.z, '👑', '坏蛋司令']);
      for (const c of chests) if (!c.opened && Math.hypot(c.x - player.pos.x, c.z - player.pos.z) < 45) list.push([c.x, 1.6, c.z, '🎁', '']);
      for (const p of pickups) if (p.kind === 'jetpack' && Math.hypot(p.g.position.x - player.pos.x, p.g.position.z - player.pos.z) < 60) list.push([p.g.position.x, 2.2, p.g.position.z, '🚀', '喷气背包']);
      if (mission.type === 'kill' && mst.phase === 'fight' && mission.total - missionKills <= 3) {
        for (const e of enemies) if (!e.idle && e.spawnIn <= 0) list.push([e.g.position.x, e.g.position.y + (e.T.drone ? 1.5 : 2.25 * e.s), e.g.position.z, '🎯', '']);
      }
    }
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
    const Wd = 300, c = Wd / 2, scale = 140 / 40;
    rctx.clearRect(0, 0, Wd, Wd);
    rctx.save();
    rctx.beginPath(); rctx.arc(c, c, 146, 0, Math.PI * 2); rctx.clip();
    const pp = player.pos;
    const local = (x, z) => {
      const dx = x - pp.x, dz = z - pp.z;
      return [(dx * right.x + dz * right.z) * scale, -(dx * fwd.x + dz * fwd.z) * scale];
    };
    // 掩体（旋转成小方块）
    rctx.fillStyle = 'rgba(233,211,161,0.28)';
    for (const o of obstacles) {
      if (o.kind === 'wall') continue;
      const [px, py] = local(o.x, o.z);
      if (Math.hypot(px, py) > 170) continue;
      rctx.save();
      rctx.translate(c + px, c + py);
      rctx.rotate(player.yaw);
      rctx.fillRect(-o.hx * scale, -o.hz * scale, o.hx * 2 * scale, o.hz * 2 * scale);
      rctx.restore();
    }
    // 外墙
    rctx.strokeStyle = 'rgba(233,211,161,0.6)'; rctx.lineWidth = 3;
    rctx.beginPath();
    [[-HALF, -HALF], [HALF, -HALF], [HALF, HALF], [-HALF, HALF]].forEach(([x, z], i) => { const [px, py] = local(x, z); if (i) rctx.lineTo(c + px, c + py); else rctx.moveTo(c + px, c + py); });
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
    for (const o of objectives) if (!o.done) plot(o.x, o.z, '#ffd23f', 10, true);
    if (mst && mst.phase === 'extract') plot(PAD.x, PAD.z, '#6ee36a', 11, true);
    for (const a of allies) plot(a.g.position.x, a.g.position.z, '#7fc8ff', 6);
    for (const e of enemies) if (!e.idle) plot(e.g.position.x, e.g.position.z, '#ff5a5a', e.T.boss ? 14 : 7, e.T.boss);
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
  let last = performance.now(), time = 0;
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
    // 旗子飘
    const fp = flagMesh.geometry.attributes.position;
    for (let i = 0; i < fp.count; i++) { const x = fp.getX(i); fp.setZ(i, Math.sin(x * 3 - t * 5) * 0.12 * (x + 1.2)); }
    fp.needsUpdate = true;

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
    if (state !== 'title') { updateHUD(); updateMarkers(); }
    // 阴影跟着玩家走
    const focus = state === 'title' ? tmpV.set(0, 0, PAD.z - 6) : player.pos;
    // 阴影贴图按像素对齐，走动时影子边缘不会闪
    const texel = 96 / fx.shadowSize();
    const fx0 = Math.round(focus.x / texel) * texel, fz0 = Math.round(focus.z / texel) * texel;
    sun.position.set(fx0 + SUN_DIR.x * 90, SUN_DIR.y * 90, fz0 + SUN_DIR.z * 90);
    sun.target.position.set(fx0, 0, fz0);
    skyUniforms.uTime.value = t;
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
    teleport(x, z) { player.pos.set(x, 0, z); },
    unlockAll() { progress = 6; },
    spawn(kind) { spawnPickup(kind, new THREE.Vector3().copy(player.pos).addScaledVector(fwd, 4)); },
    finishObjectives() { objectives.forEach(o => { if (!o.done) { o.prog = 1; o.force = true; } }); },
    spawnEnemy(type, x, z) { const e = spawnEnemy(type, new THREE.Vector3(x, 0, z)); e.spawnIn = 0; return true; },
    freeze() { enemies.forEach(e => { e.speed = 0; e.shootT = 99; }); },
    briefing(n, t) { hideScreens(); showBriefing(n, t || 1, false); },
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

  toTitle();
  // 真人模型解码完以后，把开始界面的人物换成真人模型
  if (Humans.onReady) Humans.onReady(() => { if (state === 'title') toTitle(); });
  requestAnimationFrame(frame);
})();
