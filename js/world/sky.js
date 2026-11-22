// 天空：真实拍摄的天空照片（Poly Haven HDR，CC0）当背景，同一张 HDR 算出环境光照，太阳位置和照片里一致
(function () {
  'use strict';
  const SKIES = {
    day:     { key: 'kloofendal_48d',   exposure: 1.0, sunTint: 0xfff1dc, sunK: 1.0, envK: 1.0, fog: 0.00055, fogTint: [1.0, 1.0, 1.0] },
    sunrise: { key: 'qwantani_sunrise', exposure: 1.15, sunTint: 0xffc890, sunK: 1.0, envK: 1.1, fog: 0.0009, fogTint: [1.05, 0.95, 0.85] },
    dusk:    { key: 'kloppenheim_06',   exposure: 1.35, sunTint: 0xff9a5a, sunK: 1.0, envK: 1.2, fog: 0.0009, fogTint: [1.1, 0.85, 0.75] },
    night:   { key: 'kloppenheim_02',   exposure: 2.4, sunTint: 0x9ab8ff, sunK: 0.45, envK: 1.6, fog: 0.0008, fogTint: [0.8, 0.9, 1.1] },
  };
  function half2float(h) {
    const s = (h & 0x8000) >> 15, e = (h & 0x7C00) >> 10, f = h & 0x03FF;
    if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
    if (e === 0x1F) return f ? NaN : (s ? -1 : 1) * Infinity;
    return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
  }
  function create(renderer, scene, name) {
    const P = SKIES[name] || SKIES.day;
    const A = TSAssets;
    const J = A.json(`sky/${P.key}/json`) || { sunU: 0.6, sunV: 0.25, skyScale: 1, horizonLinear: [0.4, 0.5, 0.7], sunIrradiance: 4, skyIrradiance: 1.3, sunColor: [1, 1, 1] };
    const elev = (0.5 - J.sunV) * Math.PI, phi = (J.sunU - 0.5) * Math.PI * 2;
    const sunDir = new THREE.Vector3(Math.cos(elev) * Math.cos(phi), Math.sin(elev), Math.cos(elev) * Math.sin(phi)).normalize();
    // 太阳太低时，光照方向稍微抬高一点（不然地上全是长影子，看不清）
    const lightDir = sunDir.clone();
    if (lightDir.y < 0.22) { lightDir.y = 0.22; lightDir.normalize(); }

    // ---------- 环境光照（128x64 的半精度 HDR） ----------
    let envTex = null;
    const lb = A.bin(`sky/${P.key}/light`);
    if (lb) {
      const w = J.lightSize ? J.lightSize[0] : 128, h = J.lightSize ? J.lightSize[1] : 64;
      const src = new Uint16Array(lb);
      const data = new Float32Array(w * h * 4);
      const ch = src.length / (w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const si = ((h - 1 - y) * w + x) * ch, di = (y * w + x) * 4;
        data[di] = half2float(src[si]); data[di + 1] = half2float(src[si + 1]); data[di + 2] = half2float(src[si + 2]); data[di + 3] = 1;
      }
      const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
      t.mapping = THREE.EquirectangularReflectionMapping;
      t.magFilter = t.minFilter = THREE.LinearFilter;
      t.needsUpdate = true;
      const pm = new THREE.PMREMGenerator(renderer);
      envTex = pm.fromEquirectangular(t).texture;
      pm.dispose(); t.dispose();
    }
    // ---------- 背景天空 ----------
    const img = A.tex(`sky/${P.key}/img`, { srgb: true });
    if (img) { img.wrapS = THREE.RepeatWrapping; img.wrapT = THREE.ClampToEdgeWrapping; img.generateMipmaps = false; img.minFilter = THREE.LinearFilter; }
    const hor = new THREE.Vector3().fromArray(J.horizonLinear || [0.4, 0.5, 0.7]);
    const uni = {
      tSky: { value: img }, uSun: { value: sunDir }, uScale: { value: (J.skyScale || 1) }, uHor: { value: hor },
      uSunCol: { value: new THREE.Color(P.sunTint) }, uNight: { value: name === 'night' ? 1 : 0 }, uTime: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, uniforms: uni,
      vertexShader: 'varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
      fragmentShader: `
        uniform sampler2D tSky; uniform vec3 uSun; uniform float uScale; uniform vec3 uHor; uniform vec3 uSunCol; uniform float uNight; uniform float uTime;
        varying vec3 vD;
        float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        void main() {
          vec3 d = normalize(vD);
          vec2 uv = vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
          vec3 c = texture2D(tSky, vec2(uv.x, max(uv.y, 0.512))).rgb;
          c = pow(c, vec3(1.0)) * uScale;
          // 地平线以下用雾的颜色（远处的山会挡住）
          c = mix(c, uHor * 1.05, smoothstep(0.07, -0.01, d.y));
          float s = max(dot(d, uSun), 0.0);
          c += uSunCol * smoothstep(0.99965, 0.99985, s) * (uNight > 0.5 ? 6.0 : 30.0);
          c += uSunCol * pow(s, 400.0) * 1.5;
          // 晚上加一点星星
          if (uNight > 0.5 && d.y > 0.05) { vec3 q = floor(d * 380.0); float st = step(0.9975, h3(q)); c += vec3(st) * 0.9 * smoothstep(0.05, 0.3, d.y); }
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(5000, 64, 32), mat);
    dome.frustumCulled = false;
    dome.renderOrder = -10;
    dome.name = 'sky';
    scene.environment = envTex;
    scene.add(dome);
    const fogColor = new THREE.Color(hor.x * P.fogTint[0], hor.y * P.fogTint[1], hor.z * P.fogTint[2]);
    return {
      name, P, J, sunDir, lightDir, dome, envTex, fogColor, exposure: P.exposure,
      sunIntensity: Math.min(5, (J.sunIrradiance || 4) * 0.9) * P.sunK,
      sunColor: new THREE.Color(P.sunTint),
      envIntensity: P.envK,
      update(cam) { dome.position.copy(cam.position); },
      dispose() { scene.remove(dome); mat.dispose(); dome.geometry.dispose(); if (envTex) envTex.dispose(); },
    };
  }
  window.TSSky = { create, SKIES };
})();
