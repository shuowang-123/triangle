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
  const sandTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#d6b27a'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 2600, ['#c9a46c', '#e2c290', '#bf9960', '#e9cc9c'], 2.5);
    g.strokeStyle = 'rgba(160,120,70,0.18)'; g.lineWidth = 3;
    for (let i = 0; i < 6; i++) { g.beginPath(); const y = Math.random() * h; g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 14, w * 0.6, y - 14, w, y); g.stroke(); }
  }, 70);
  const roadTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#6e6658'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 900, ['#5e5749', '#7d7566', '#686052'], 2);
    g.fillStyle = '#e8c547'; g.fillRect(w / 2 - 3, 0, 6, h * 0.55);
  }, 1, 12);
  const crateTex = canvasTex(128, 128, (g, w, h) => {
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
    return canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 12) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, 0, 4, h); g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(x + 5, 0, 2, h); }
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 0, w, 7); g.fillRect(0, h - 7, w, 7);
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = 'bold 22px sans-serif'; g.fillText('THUNDER CARGO', 26, 70);
      speckle(g, w, h, 500, ['rgba(90,50,20,0.25)', 'rgba(0,0,0,0.15)'], 3);
    });
  }
  const CONTAINER_TEX = ['#2f6b8f', '#a8432f', '#6b7a35', '#c48a2c'].map(containerTex);
  const concreteTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#b1aba0'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 1200, ['#a39d92', '#bdb7ac', '#979186'], 2);
    g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(0, 62, w, 3);
  });
  const barrierTex = canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = '#b8b2a7'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 500, ['#a39d92', '#c6c0b5'], 2);
    for (let x = -20; x < w; x += 24) { g.fillStyle = '#f0b429'; g.beginPath(); g.moveTo(x, h); g.lineTo(x + 12, h); g.lineTo(x + 24, h - 14); g.lineTo(x + 12, h - 14); g.fill(); }
    g.fillStyle = '#222'; g.fillRect(0, h - 14, w, 1);
  });
  const sandbagTex = canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = '#7d6a45'; g.fillRect(0, 0, w, h);
    for (let r = 0; r < 4; r++) for (let c = -1; c < 5; c++) {
      const x = c * 32 + (r % 2) * 16, y = r * 16;
      g.fillStyle = ['#bda57a', '#b39b6f', '#c4ad83'][(r + c + 3) % 3];
      g.beginPath(); g.ellipse(x + 16, y + 8, 15, 7, 0, 0, Math.PI * 2); g.fill();
    }
  });
  const barrelTex = canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = '#c0392b'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 12, w, 4); g.fillRect(0, h - 16, w, 4);
    g.fillStyle = '#ffd23f'; g.font = 'bold 26px sans-serif'; g.fillText('⚠', 8, 44); g.fillText('⚠', 72, 44);
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
    const t = sandTex.clone(); t.needsUpdate = true; t.repeat.set(88, 88);
    const gm = new THREE.MeshStandardMaterial({ map: t, vertexColors: true, roughness: 1 });
    // 着色器里加上风吹出来的沙纹（低角度阳光下能看到明暗起伏）和大片的颜色深浅变化，地面就不会一眼看出重复贴图
    gm.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWPos;
          float gh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
          float gn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(gh(i), gh(i + vec2(1, 0)), f.x), mix(gh(i + vec2(0, 1)), gh(i + vec2(1, 1)), f.x), f.y); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
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
    const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.95 });
    const r1 = new THREE.Mesh(new THREE.PlaneGeometry(6, 90), roadMat);
    r1.rotation.x = -Math.PI / 2; r1.position.set(0, 0.01, 0); r1.receiveShadow = true; scene.add(r1);
    const t2 = roadTex.clone(); t2.needsUpdate = true;
    const r2 = new THREE.Mesh(new THREE.PlaneGeometry(6, 90), new THREE.MeshStandardMaterial({ map: t2, roughness: 0.95 }));
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
    addOb(x, z, w, d, 1.4, new THREE.Mesh(roundBox(w, 1.4, d, 0.07, 2), stdMat('bar', { map: barrierTex, normalMap: concreteN, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.9 })));
  }
  const barrelGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.25, 16);
  function barrel(x, z) {
    const o = addOb(x, z, 0.9, 0.9, 1.25, new THREE.Mesh(barrelGeo, stdMat('barrel', { map: barrelTex, roughness: 0.5, metalness: 0.3 })), 'barrel');
    o.hp = 3;
    return o;
  }
  // 外墙 + 角上的瞭望塔
  {
    const wallMat = new THREE.MeshStandardMaterial({ map: (() => { const t = concreteTex.clone(); t.needsUpdate = true; t.repeat.set(24, 1); return t; })(), normalMap: (() => { const t = concreteN.clone(); t.needsUpdate = true; t.repeat.set(24, 1); return t; })(), roughness: 0.95 });
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
    const tankMat = stdMat('tank', { color: 0xd9d4c7, roughness: 0.5, metalness: 0.4 });
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
    const rockMat = new THREE.MeshStandardMaterial({ color: 0xa3896a, roughness: 0.95, normalMap: concreteN, normalScale: new THREE.Vector2(1.2, 1.2) });
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

  // 烟雾（普通混合，灰色的）
  const smokes = [];
  for (let i = 0; i < 90; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x8a8273, transparent: true, depthWrite: false, opacity: 0 }));
    s.visible = false; scene.add(s);
    smokes.push({ s, life: 0, max: 1, size: 1, vel: new THREE.Vector3(), op: 0.6 });
  }
  let smokeIdx = 0;
  function puff(pos, n, size, color, life, spread) {
    for (let k = 0; k < n; k++) {
      const p = smokes[smokeIdx]; smokeIdx = (smokeIdx + 1) % smokes.length;
      const sp = spread == null ? size * 0.4 : spread;
      p.s.position.set(pos.x + rand(-sp, sp), pos.y + rand(-sp, sp) * 0.5, pos.z + rand(-sp, sp));
      p.s.material.color.set(color || 0x8a8273);
      p.vel.set(rand(-0.6, 0.6), rand(0.6, 1.6), rand(-0.6, 0.6));
      p.life = p.max = (life || 1.6) * rand(0.7, 1.2);
      p.size = size * rand(0.7, 1.2);
      p.op = color === 0xffffff ? 0.75 : 0.6;
      p.s.visible = true;
    }
  }
  function updateSmoke(dt) {
    for (const p of smokes) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      const t = 1 - p.life / p.max;
      p.s.position.addScaledVector(p.vel, dt);
      p.s.scale.setScalar(p.size * (0.5 + t * 1.2));
      p.s.material.opacity = p.op * Math.min(1, t * 6) * (1 - t);
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
    emit(pos, 0xff7a1a, Math.round(26 * size), 9 * Math.sqrt(size), 0.8, 3);
    emit(pos, 0xffd23f, Math.round(14 * size), 7 * Math.sqrt(size), 0.6, 2);
    emit(pos, 0xffffff, Math.round(6 * size), 5 * Math.sqrt(size), 0.35, 1);
    if (pos.y < 2) spawnRing(pos, 0xff9a3a, 3 * size, 0.45 + size * 0.1);
    spawnFlash(pos, 0xffb347, 5 * size, 0.3 + size * 0.05);
    puff(tmpV.copy(pos).setY(Math.max(0.6, pos.y)), Math.min(10, 3 + Math.round(size * 2)), 2.5 * Math.sqrt(size), 0x6f675a, 2.2, size * 0.8);
    spawnShards(pos, 0x5a4a3a, Math.min(14, 3 + Math.round(size * 3)), size);
    flashLight.position.copy(pos).setY(pos.y + 1);
    flashLight.intensity = 60 * size; flashLightT = 0.2;
    const d = camera.position.distanceTo(pos);
    shake = Math.max(shake, Math.min(1.2, size * 2.5 / (d + 3)));
    if (!silent) Sfx.boom(size >= 2.2);
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
  const SLV = (() => { const g = new THREE.CapsuleGeometry(0.048, 0.36, 4, 12); g.rotateX(Math.PI / 2); return g; })();
  function addHands(g, gripZ, foreZ, foreY) {
    part(g, B(0.075, 0.075, 0.1), M.glove, 0.0, -0.1, gripZ);
    part(g, SLV, M.sleeve, 0.02, -0.17, gripZ + 0.22, -0.35);
    part(g, B(0.08, 0.06, 0.12), M.glove, -0.03, foreY, foreZ);
  }
  function makeRifle() {
    const g = new THREE.Group();
    part(g, B(0.07, 0.09, 0.42), M.black, 0, 0, 0);
    part(g, B(0.078, 0.078, 0.27), M.olive, 0, 0.004, -0.33);
    part(g, CYL(0.013, 0.24), M.steel, 0, 0.012, -0.56);
    part(g, CYL(0.021, 0.05), M.black, 0, 0.012, -0.69);
    part(g, B(0.05, 0.17, 0.085), M.black, 0, -0.12, -0.07, 0.25);
    part(g, B(0.05, 0.12, 0.06), M.black, 0, -0.1, 0.1, -0.35);
    part(g, B(0.06, 0.1, 0.22), M.olive, 0, -0.012, 0.3);
    part(g, B(0.03, 0.02, 0.34), M.black, 0, 0.055, -0.08);
    part(g, B(0.055, 0.05, 0.075), M.black, 0, 0.09, -0.03);
    part(g, B(0.04, 0.034, 0.005), M.lens, 0, 0.093, -0.067);
    const dot = new THREE.Sprite(sharedGlowMat(0xff3030, 1)); dot.scale.setScalar(0.012); dot.position.set(0, 0.093, -0.07); g.add(dot);
    addHands(g, 0.1, -0.33, -0.05);
    return { g, muzzle: new THREE.Vector3(0, 0.012, -0.73), sightY: 0.093, kick: 0.05 };
  }
  function makeShotgun() {
    const g = new THREE.Group();
    part(g, B(0.075, 0.095, 0.26), M.black, 0, 0, 0);
    part(g, CYL(0.019, 0.62), M.steel, 0, 0.022, -0.42);
    part(g, CYL(0.017, 0.48), M.black, 0, -0.022, -0.36);
    part(g, B(0.07, 0.065, 0.2), M.wood, 0, -0.025, -0.32);
    part(g, B(0.064, 0.115, 0.3), M.wood, 0, -0.035, 0.26, 0.12);
    part(g, B(0.05, 0.11, 0.06), M.black, 0, -0.09, 0.08, -0.35);
    part(g, B(0.012, 0.016, 0.012), M.red, 0, 0.047, -0.7);
    addHands(g, 0.08, -0.32, -0.065);
    return { g, muzzle: new THREE.Vector3(0, 0.022, -0.74), sightY: 0.05, kick: 0.12 };
  }
  function makeSniper() {
    const g = new THREE.Group();
    part(g, B(0.07, 0.085, 0.42), M.tan, 0, 0, 0);
    part(g, CYL(0.014, 0.6), M.black, 0, 0.012, -0.5);
    part(g, CYL(0.024, 0.06), M.black, 0, 0.012, -0.8);
    part(g, CYL(0.032, 0.3), M.black, 0, 0.095, -0.03);
    part(g, CYL(0.04, 0.06), M.black, 0, 0.095, -0.2);
    part(g, CYL(0.038, 0.05), M.black, 0, 0.095, 0.13);
    part(g, B(0.05, 0.005, 0.05), M.lens, 0, 0.095, -0.232, Math.PI / 2);
    part(g, B(0.066, 0.125, 0.32), M.tan, 0, -0.02, 0.34);
    part(g, B(0.05, 0.11, 0.06), M.black, 0, -0.1, 0.1, -0.35);
    part(g, B(0.05, 0.09, 0.09), M.black, 0, -0.08, -0.08);
    addHands(g, 0.1, -0.3, -0.05);
    return { g, muzzle: new THREE.Vector3(0, 0.012, -0.84), sightY: 0.095, kick: 0.1 };
  }
  function makeRocket() {
    const g = new THREE.Group();
    part(g, CYL(0.075, 0.95, 18), M.olive, 0, 0, -0.1);
    part(g, CYL(0.085, 0.07, 18), M.black, 0, 0, -0.58);
    part(g, CYL(0.088, 0.1, 18), M.black, 0, 0, 0.38);
    const head = new THREE.Group(); head.position.set(0, 0, -0.66); g.add(head);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.24, 14), M.orange); cone.rotation.x = -Math.PI / 2; cone.position.z = -0.1; head.add(cone);
    part(head, CYL(0.06, 0.08), M.olive, 0, 0, 0.03);
    part(g, B(0.05, 0.13, 0.06), M.black, 0, -0.13, 0.02, -0.25);
    part(g, B(0.05, 0.12, 0.06), M.black, 0, -0.12, -0.3, -0.2);
    part(g, B(0.03, 0.08, 0.06), M.black, -0.09, 0.07, -0.18);
    part(g, B(0.025, 0.02, 0.025), M.red, -0.09, 0.115, -0.18);
    part(g, B(0.075, 0.075, 0.1), M.glove, 0, -0.18, 0.02);
    part(g, SLV, M.sleeve, 0.02, -0.24, 0.24, -0.35);
    return { g, muzzle: new THREE.Vector3(0, 0, -0.8), sightY: 0.115, kick: 0.15, head };
  }
  const WEAPONS = [
    { id: 'rifle', name: '突击步枪', short: '步枪', mag: 30, reserve: Infinity, rate: 0.1, dmg: 1, pellets: 1, spread: 0.02, adsSpread: 0.004, reload: 1.4, fov: 55, recoil: 0.007, sfx: 'rifle', color: 0xffd27a, hip: [0.15, -0.15, -0.4], ads: [0.05, -0.1, -0.44] },
    { id: 'shotgun', name: '霰弹枪', short: '霰弹', mag: 6, reserve: Infinity, rate: 0.7, dmg: 0.9, pellets: 8, spread: 0.075, adsSpread: 0.05, reload: 1.7, fov: 62, recoil: 0.035, sfx: 'shotgun', color: 0xffc04a, hip: [0.15, -0.15, -0.4], ads: [0.05, -0.11, -0.44] },
    { id: 'sniper', name: '狙击枪', short: '狙击', mag: 5, reserve: Infinity, rate: 1.0, dmg: 9, pellets: 1, spread: 0.035, adsSpread: 0, reload: 2.0, fov: 20, recoil: 0.05, sfx: 'sniper', pierce: true, scope: true, color: 0xfff0b0, hip: [0.15, -0.15, -0.42], ads: [0.05, -0.1, -0.44] },
    { id: 'rocket', name: '火箭筒', short: '火箭', mag: 1, reserve: 4, rate: 0.9, dmg: 14, pellets: 1, spread: 0.01, adsSpread: 0, reload: 1.6, fov: 60, recoil: 0.05, sfx: 'rocketFire', rocket: true, color: 0xff8a1f, hip: [0.17, -0.12, -0.4], ads: [0.1, -0.1, -0.44] },
  ];
  const gunModels = [makeRifle(), makeShotgun(), makeSniper(), makeRocket()];
  const GS = 0.5; // 手里枪的大小
  const gunRoot = new THREE.Group();
  gunRoot.scale.setScalar(GS);
  gunScene.add(gunRoot);
  gunModels.forEach(m => { m.g.visible = false; gunRoot.add(m.g); });
  const muzzleFlash = glowSprite(0xffc060, 0.35, 1);
  muzzleFlash.visible = false;
  gunRoot.add(muzzleFlash);

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
  let curW = 0, ammo = [], reloadT = 0, switchT = 0, aimT = 0, aimHeld = false, aimToggle = false, autoReloadT = -1;
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
    S = { speed: 7.5, fireRate: 1, dmg: 1, magMul: 1, reloadSpd: 1, maxHp: 100, gRadius: 7, gDmg: 1, maxGrenades: 6, maxRockets: 8, jumps: 1, maxAllies: 6, regen: 0, allyCount: 1 };
    score = 0; level = 1; xp = 0; kills = 0; headshots = 0; grenadeCount = 3;
    Learn.resetSession();
    ammo = WEAPONS.map(W => ({ mag: W.mag, res: W.reserve }));
  }
  resetRun();
  function magSize(i) { const W = WEAPONS[i]; return W.rocket ? W.mag : Math.round(W.mag * S.magMul); }
  function unlocked(i) { return tier > 1 || i === 0 || progress >= i; }

  const player = { pos: new THREE.Vector3().copy(SPAWN), vel: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: true, jumpsUsed: 0, bob: 0 };
  const fwd = new THREE.Vector3(0, 0, -1), right = new THREE.Vector3(1, 0, 0);
  function eyePos(out) { return out.set(player.pos.x, player.pos.y + 1.65, player.pos.z); }

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
      if (roll < 0.08) spawnPickup('ammo', center);
      else if (roll < 0.15) spawnPickup('medkit', center);
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
    Sfx.enemyShot();
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
    } else {
      g = new THREE.Mesh(kitGeo, kind === 'medkit' ? kitMat : ammoMat);
      const s = new THREE.Sprite(sharedGlowMat(kind === 'medkit' ? 0xff6060 : 0xffd23f, 0.45)); s.scale.setScalar(2); g.add(s);
    }
    const spread = kind === 'medal' ? 1.2 : 0.3;
    g.position.set(pos.x + rand(-spread, spread), Math.max(0.8, pos.y), pos.z + rand(-spread, spread));
    scene.add(g);
    pickups.push({ kind, g, t: Math.random() * 6, life: kind === 'medal' ? 30 : 40, vel: new THREE.Vector3(rand(-3, 3), 5, rand(-3, 3)) });
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
  function fireRocket(from, dir) {
    let r = rockets.find(x => !x.alive);
    if (!r) {
      const mesh = new THREE.Mesh(rocketGeo, rocketMat);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 10), M.orange); tip.rotation.x = -Math.PI / 2; tip.position.z = -0.4; mesh.add(tip);
      const gl = glowSprite(0xff9a3a, 1.4, 0.9); gl.position.z = 0.35; mesh.add(gl);
      scene.add(mesh);
      r = { mesh, vel: new THREE.Vector3(), life: 0, alive: false };
      rockets.push(r);
    }
    r.alive = true; r.mesh.visible = true;
    r.mesh.position.copy(from);
    r.vel.copy(dir).multiplyScalar(36);
    r.mesh.lookAt(tmpV.copy(from).sub(dir)); // 圆锥朝 -z，所以反着看
    r.life = 3;
  }
  function rocketBlast(p) {
    explode(p, 3.2);
    spawnRing(p, 0xffd23f, 9, 0.6);
    emit(p, 0xffd23f, 60, 15, 1, 6);
    shake = Math.max(shake, 1.1);
    blastDamage(p, 6, WEAPONS[3].dmg * S.dmg);
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
        if (p.y <= 0.05 || insideBox(p) || Math.abs(p.x) > HALF || Math.abs(p.z) > HALF || r.life <= 0) boom = true;
        for (const e of enemies) {
          if (boom) break;
          if (e.idle || e.spawnIn > 0) continue;
          for (const s of hitSpheres(e)) if ((p.x - s[0]) ** 2 + (p.y - s[1]) ** 2 + (p.z - s[2]) ** 2 < (s[3] + 0.25) ** 2) { boom = true; break; }
        }
      }
      puff(p, 1, 0.7, 0xd8d0c0, 0.8, 0.05);
      emit(p, 0xff9a3a, 2, 1.5, 0.25, 0);
      if (boom) {
        r.alive = false; r.mesh.visible = false;
        const o = insideBox(p);
        if (o && o.kind === 'barrel') damageBarrel(o, 99);
        rocketBlast(p.clone().setY(Math.max(0.3, p.y)));
      }
    }
  }

  // ================= 开枪 =================
  const camRightV = new THREE.Vector3(), camUpV = new THREE.Vector3();
  function muzzleWorld(out) {
    const k = aimT;
    return out.set(lerp(0.2, 0.08, k), lerp(-0.18, -0.13, k), -0.85).applyMatrix4(camera.matrixWorld);
  }
  function tryFire() {
    if (switchT > 0 || reloadT > 0 || fireCool > 0) return;
    const W = WEAPONS[curW], A = ammo[curW];
    if (A.mag <= 0) {
      if (A.res > 0) startReload();
      else { Sfx.empty(); centerText('没有火箭弹了！捡弹药箱 📦 或者换枪', '#ffb347', 24); }
      fireCool = 0.35;
      return;
    }
    A.mag--;
    fireCool = W.rate / (W.rocket || W.scope ? 1 : S.fireRate);
    gunKick = 1;
    muzzleT = W.rocket ? 0.08 : 0.05;
    Sfx[W.sfx]();
    camera.updateMatrixWorld();
    const eye = eyePos(new THREE.Vector3());
    const aim = new THREE.Vector3();
    camera.getWorldDirection(aim);
    const from = muzzleWorld(new THREE.Vector3());
    flashLight.position.copy(from); flashLight.intensity = W.rocket ? 30 : 12; flashLightT = 0.05;
    const moving = Math.hypot(player.vel.x, player.vel.z) > 2 || !player.onGround;
    const spread = lerp(W.spread, W.adsSpread, aimT) * (moving ? 1.6 : 1);
    if (W.rocket) {
      const dir = aim.clone().add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(spread)).normalize();
      fireRocket(from, dir);
      puff(from, 3, 1, 0xd8d0c0, 0.8);
      gunModels[3].head.visible = false;
    } else {
      let anyHit = false, anyHead = false;
      const assist = isTouch ? 1.3 : 1.12;
      for (let k = 0; k < W.pellets; k++) {
        const dir = aim.clone().add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(spread)).normalize();
        const rh = rayObstacles(eye, dir, 120);
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
          damageEnemy(e, W.dmg * S.dmg * (head ? 2 : 1), hp2, head);
        }
        if (!use.length || W.pierce) {
          if (wallT < 120) {
            emit(hitP, 0xffc04a, 4, 4, 0.25, 2);
            if (k % 3 === 0) puff(hitP, 1, 0.4, 0xc8b08a, 0.5, 0.05);
            if (wallOb && wallOb.kind === 'barrel') damageBarrel(wallOb, W.dmg * S.dmg);
          }
        }
      }
      if (anyHit) { hitMarker(anyHead); Sfx.hit(); }
    }
    player.pitch = Math.min(1.45, player.pitch + W.recoil * (1 - aimT * 0.5));
    player.yaw += rand(-1, 1) * W.recoil * 0.3;
    if (A.mag <= 0 && A.res > 0) autoReloadT = 0.25;
  }
  function startReload() {
    const A = ammo[curW], W = WEAPONS[curW];
    if (reloadT > 0 || switchT > 0 || A.mag >= magSize(curW) || A.res <= 0) return;
    reloadT = W.reload / S.reloadSpd;
    Sfx.reload();
  }
  function finishReload() {
    const A = ammo[curW];
    const need = magSize(curW) - A.mag;
    const take = Math.min(need, A.res);
    A.mag += take;
    if (A.res !== Infinity) A.res -= take;
    if (WEAPONS[curW].rocket) gunModels[3].head.visible = A.mag > 0;
  }
  function switchWeapon(i) {
    if (state !== 'playing' && state !== 'menu') return;
    if (i === curW || !unlocked(i)) { if (!unlocked(i) && state === 'playing') centerText(`🔒 完成第 ${i} 个任务解锁 ${WEAPONS[i].name}`, '#ffb347', 24); return; }
    curW = i;
    reloadT = 0; autoReloadT = -1;
    switchT = 0.35;
    Sfx.reload();
    gunModels.forEach((m, k) => { m.g.visible = k === i; });
    gunModels[3].head.visible = ammo[3].mag > 0;
  }
  function cycleWeapon(dir) {
    for (let k = 1; k <= 4; k++) {
      const i = (curW + dir * k + 8) % 4;
      if (unlocked(i)) { switchWeapon(i); return; }
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
      const n = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 }[e.code];
      if (n != null) switchWeapon(n);
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
    if (e.button === 0) mouseDown = true;
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
  holdBtn('tFire', () => { touchFire = true; }, () => { touchFire = false; });
  holdBtn('tGrenade', () => throwGrenade());
  holdBtn('tJump', () => { if (state === 'playing') jump(); });
  holdBtn('tReload', () => { if (state === 'playing') startReload(); });
  holdBtn('tSwitch', () => { if (state === 'playing') cycleWeapon(1); });
  holdBtn('tAim', () => { aimToggle = !aimToggle; $('tAim').classList.toggle('on', aimToggle); });

  function jump() {
    if (player.onGround) { player.vel.y = 9; player.onGround = false; player.jumpsUsed = 1; Sfx.jump(); }
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
    ['learnToggle', 'learnToggle2'].forEach(id => { $(id).textContent = `📚 学习模式：${L ? '开' : '关'}`; $(id).classList.toggle('off', !L); });
    ['soundToggle', 'soundToggle2'].forEach(id => { $(id).textContent = `🔊 音效：${Sfx.soundOn ? '开' : '关'}`; $(id).classList.toggle('off', !Sfx.soundOn); });
    ['musicToggle', 'musicToggle2'].forEach(id => { $(id).textContent = `🎵 音乐：${Sfx.musicOn ? '开' : '关'}`; $(id).classList.toggle('off', !Sfx.musicOn); });
    const QN = { auto: '自动', high: '高', medium: '中', low: '省电' };
    ['qualityToggle', 'qualityToggle2'].forEach(id => { $(id).textContent = `🎨 画质：${QN[fx.pref]}${fx.pref === 'auto' ? '（' + QN[fx.tier] + '）' : ''}`; });
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
    const ws = WEAPONS.map((W, i) => unlocked(i) ? (i === n - 1 && t === 1 && i > 0 ? `🆕${W.name}` : W.name) : null).filter(Boolean);
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
    ammo.forEach((A, i) => { A.mag = magSize(i); if (WEAPONS[i].rocket) A.res = Math.max(A.res, 2); });
    reloadT = 0; switchT = 0; aimT = 0; aimToggle = false; $('tAim').classList.remove('on'); autoReloadT = -1;
    if (!unlocked(curW)) curW = 0;
    // 新解锁的武器直接拿在手上
    if (tier === 1 && missionNo >= 2 && missionNo <= 4 && unlocked(missionNo - 1) && !retry) curW = missionNo - 1;
    gunModels.forEach((m, k) => { m.g.visible = k === curW; });
    gunModels[3].head.visible = ammo[3].mag > 0;
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
    const unlockMsg = tier === 1 && missionNo <= 3 ? `<span class="newbest">🔓 新武器解锁：${WEAPONS[missionNo].name}！</span><br>` : '';
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
    { icon: '🔥', name: '火力全开', desc: '步枪和霰弹枪射速 +20%', apply() { S.fireRate *= 1.2; } },
    { icon: '💥', name: '穿甲弹', desc: '所有武器威力 +25%', apply() { S.dmg *= 1.25; } },
    { icon: '📦', name: '扩容弹匣', desc: '弹匣能多装 50% 子弹', ok: () => S.magMul < 2.5, apply() { S.magMul *= 1.5; ammo.forEach((A, i) => { A.mag = magSize(i); }); } },
    { icon: '⚡', name: '快速换弹', desc: '换弹速度快 35%', ok: () => S.reloadSpd < 2.5, apply() { S.reloadSpd *= 1.35; } },
    { icon: '💣', name: '手榴弹包', desc: '立刻拿到 4 颗手榴弹，最多能带 +2', apply() { S.maxGrenades += 2; grenadeCount = Math.min(S.maxGrenades, grenadeCount + 4); } },
    { icon: '☄️', name: '超级炸弹', desc: '手榴弹爆炸范围和威力 +30%', apply() { S.gRadius *= 1.3; S.gDmg *= 1.3; } },
    { icon: '🚀', name: '火箭补给', desc: '火箭弹 +3', ok: () => unlocked(3), apply() { ammo[3].res = Math.min(S.maxRockets, ammo[3].res + 3); } },
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
    let mz = 0, mx = 0;
    if (keys.KeyW || keys.ArrowUp) mz += 1;
    if (keys.KeyS || keys.ArrowDown) mz -= 1;
    if (keys.KeyA || keys.ArrowLeft) mx -= 1;
    if (keys.KeyD || keys.ArrowRight) mx += 1;
    if (joy.id !== null) { mx += joy.x; mz -= joy.y; }
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const sprint = (keys.ShiftLeft || keys.ShiftRight) && mz > 0 ? 1.35 : 1;
    const spd = S.speed * sprint * (1 - aimT * 0.4);
    const wantX = (fwd.x * mz + right.x * mx) * spd, wantZ = (fwd.z * mz + right.z * mx) * spd;
    const acc = Math.min(1, dt * (player.onGround ? 12 : 4));
    player.vel.x += (wantX - player.vel.x) * acc;
    player.vel.z += (wantZ - player.vel.z) * acc;
    player.vel.y -= 24 * dt;
    const p = player.pos;
    p.addScaledVector(player.vel, dt);
    pushOut(p, 0.45, p.y);
    p.x = clamp(p.x, -LIM, LIM); p.z = clamp(p.z, -LIM, LIM);
    const gh = groundAt(p.x, p.z, 0.45, p.y);
    if (p.y <= gh) { p.y = gh; if (player.vel.y < 0) player.vel.y = 0; player.onGround = true; player.jumpsUsed = 0; }
    else player.onGround = p.y - gh < 0.05;
    if (Math.hypot(player.vel.x, player.vel.z) > 1 && player.onGround) player.bob += dt * 11 * sprint;

    fireCool -= dt;
    grenadeCool -= dt;
    if (switchT > 0) switchT -= dt;
    if (reloadT > 0) { reloadT -= dt; if (reloadT <= 0) { reloadT = 0; finishReload(); } }
    if (autoReloadT > 0) { autoReloadT -= dt; if (autoReloadT <= 0) { autoReloadT = -1; startReload(); } }
    const wantAim = (aimHeld || aimToggle) && reloadT <= 0 && switchT <= 0;
    aimT = clamp(aimT + (wantAim ? dt * 7 : -dt * 7), 0, 1);
    if ((mouseDown || touchFire) && fireCool <= 0) tryFire();
    if (invuln > 0) invuln -= dt;
    regenWait -= dt;
    if (S.regen > 0 && regenWait <= 0 && hp < S.maxHp) hp = Math.min(S.maxHp, hp + S.regen * dt);
  }

  function updateCamera(dt, t) {
    if (state === 'title') {
      const a = t * 0.1;
      camera.position.set(Math.sin(a) * 20, 7 + Math.sin(t * 0.3), PAD.z - 6 + Math.cos(a) * 20);
      camera.lookAt(0, 2, PAD.z - 6);
      return;
    }
    eyePos(camera.position);
    camera.position.y += Math.sin(player.bob) * 0.05 * (1 - aimT);
    camera.rotation.set(player.pitch, player.yaw, 0);
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
    const fov = lerp(BASE_FOV, W.fov, aimT);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    const scoped = W.scope && aimT > 0.9;
    $('scope').classList.toggle('hidden', !scoped);
    crossEl.classList.toggle('hidden', scoped);
    crossEl.classList.toggle('ads', aimT > 0.5);
    // 手里的枪：晃动、后坐力、换弹、换枪
    const gm = gunModels[curW];
    gunKick = Math.max(0, gunKick - dt * 10);
    gunDip = Math.max(0, gunDip - dt * 3);
    const rl = reloadT > 0 ? Math.sin(Math.min(1, 1 - reloadT / (W.reload / S.reloadSpd)) * Math.PI) : 0;
    const sw = switchT > 0 ? switchT / 0.35 : 0;
    const bobK = 1 - aimT * 0.85;
    const hx = lerp(W.hip[0], W.ads[0], aimT), hy = lerp(W.hip[1], W.ads[1], aimT), hz = lerp(W.hip[2], W.ads[2], aimT);
    gunRoot.position.set(
      hx + Math.cos(player.bob * 0.5) * 0.012 * bobK,
      hy + Math.abs(Math.sin(player.bob * 0.5)) * 0.014 * bobK - gunDip * 0.2 - rl * 0.12 - sw * 0.3,
      hz + gunKick * gm.kick);
    gunRoot.rotation.set(gunKick * gm.kick * 1.6 - gunDip * 0.5 - rl * 0.5, lerp(0.05, 0, aimT), rl * 0.4);
    gunRoot.visible = !scoped && state !== 'dead' && hp > 0;
    muzzleT -= dt;
    muzzleFlash.visible = muzzleT > 0 && !W.scope;
    if (muzzleFlash.visible) {
      muzzleFlash.position.copy(gm.muzzle);
      muzzleFlash.material.rotation = Math.random() * 6;
      muzzleFlash.scale.setScalar(W.rocket ? 1.1 : W.pellets > 1 ? 0.8 : 0.55);
    }
    gunFlashLight.intensity = muzzleT > 0 ? 3 : 0;
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
        Sfx.shoot();
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
      if (!hit && (pp.x - p.x) ** 2 + (pp.z - p.z) ** 2 < 0.3 && p.y > pp.y && p.y < pp.y + 1.85) {
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
      } else g.position.y = 0.8 + Math.sin(p.t * 3) * 0.15;
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
          ammo[3].res = Math.min(S.maxRockets, ammo[3].res + 2);
          centerText(unlocked(3) ? '📦 手榴弹 +2 · 火箭弹 +2' : '📦 手榴弹 +2', '#ffd23f', 30);
          Sfx.pickup();
        } else {
          if (hp >= S.maxHp) continue;
          hp = Math.min(S.maxHp, hp + 30);
          centerText('✚ 生命 +30', '#6ee36a', 34);
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
      $('wSlots').innerHTML = WEAPONS.map((w, i) => `<span class="w-slot${i === curW ? ' on' : ''}${unlocked(i) ? '' : ' lock'}">${isTouch ? '' : (i + 1) + ' '}${unlocked(i) ? w.short : '🔒'}</span>`).join('');
    }
    $('reloadTip').classList.toggle('hidden', !(reloadT > 0));
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
    for (const p of pickups) if (p.kind !== 'medal') plot(p.g.position.x, p.g.position.z, p.kind === 'medkit' ? '#6ee36a' : '#ffd23f', 5);
    for (const o of objectives) if (!o.done) plot(o.x, o.z, '#ffd23f', 10, true);
    if (mst && mst.phase === 'extract') plot(PAD.x, PAD.z, '#6ee36a', 11, true);
    for (const a of allies) plot(a.g.position.x, a.g.position.z, '#7fc8ff', 6);
    for (const e of enemies) if (!e.idle) plot(e.g.position.x, e.g.position.z, '#ff5a5a', e.T.boss ? 14 : 7, e.T.boss);
    rctx.fillStyle = 'rgba(116,224,106,0.14)';
    rctx.beginPath(); rctx.moveTo(c, c); rctx.arc(c, c, 140, -Math.PI / 2 - 0.65, -Math.PI / 2 + 0.65); rctx.fill();
    rctx.fillStyle = '#ffd23f';
    rctx.beginPath(); rctx.moveTo(c, c - 12); rctx.lineTo(c + 9, c + 9); rctx.lineTo(c - 9, c + 9); rctx.fill();
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
      updateCorpses(dt);
      updateHeli(dt);
      if (state === 'playing' && pendingLevels > 0) doLevelUp();
    }
    if (active || state === 'title') {
      updateParticles(dt);
      updateSmoke(dt);
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
    if (state !== 'title' && gunRoot.visible) {
      renderer.setRenderTarget(null);
      renderer.clearDepth();
      renderer.render(gunScene, gunCam);
    }
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
    fire(on) { mouseDown = on; },
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
  };

  toTitle();
  // 真人模型解码完以后，把开始界面的人物换成真人模型
  if (Humans.onReady) Humans.onReady(() => { if (state === 'title') toTitle(); });
  requestAnimationFrame(frame);
})();
