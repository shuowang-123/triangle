// 画面后期：体积光（光柱）、泛光、高度雾、环境光遮蔽、电影调色
// 全部用着色器实时计算，不需要任何图片文件。
// 用法：const fx = FX.create(renderer, { sunDir, sun, isTouch })；每帧 fx.render(scene, camera)
(function () {
  'use strict';

  // 天空和雾共用的颜色（线性空间，HDR）
  const SKY_GLSL = `
    uniform vec3 uSunDir;
    vec3 skyBase(vec3 d) {
      float h = d.y;
      vec3 zen = vec3(0.075, 0.21, 0.55);
      vec3 mid = vec3(0.32, 0.46, 0.68);
      vec3 hor = vec3(0.98, 0.70, 0.43);
      vec3 c = h > 0.0
        ? mix(mix(hor, mid, smoothstep(0.0, 0.18, h)), zen, smoothstep(0.12, 0.85, h))
        : mix(hor, vec3(0.72, 0.52, 0.33), smoothstep(0.0, -0.25, h));
      float s = max(dot(d, uSunDir), 0.0);
      c += vec3(1.0, 0.60, 0.28) * (pow(s, 6.0) * 0.35 + pow(s, 48.0) * 0.8);
      return c;
    }`;

  const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const RAY_VS = `
    uniform mat4 uProjInv; uniform mat4 uCamWorld;
    varying vec2 vUv; varying vec3 vRay;
    void main(){
      vUv = uv;
      vec4 p = uProjInv * vec4(position.xy, 1.0, 1.0);
      vec3 vr = p.xyz / p.w; vr /= -vr.z;
      vRay = (uCamWorld * vec4(vr, 0.0)).xyz;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }`;
  const COMMON = `
    #include <packing>
    uniform float uNear; uniform float uFar;
    float viewDepth(float d) { return -perspectiveDepthToViewZ(d, uNear, uFar); }
    float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`;

  const QUALITY = {
    //          渲染比例  抗锯齿 阴影   阴影图  AO     光柱步数 光柱分辨率 泛光层数
    high:   { scale: 1.0,  msaa: 4, shadow: 4096, soft: true,  ao: 12,    vol: 32, volDiv: 2, bloom: 5, sharp: 0.45 },
    medium: { scale: 0.85, msaa: 4, shadow: 2048, soft: false, ao: 6,     vol: 16, volDiv: 3, bloom: 4, sharp: 0.4 },
    low:    { scale: 0.7,  msaa: 0, shadow: 0,    soft: false, ao: false, vol: 0,  volDiv: 4, bloom: 3, sharp: 0 },
  };
  const ORDER = ['low', 'medium', 'high'];

  function create(renderer, opts) {
    const gl2 = renderer.capabilities.isWebGL2;
    const floatOK = gl2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
    const HDR = floatOK ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const sun = opts.sun;
    const sunDir = opts.sunDir;
    const EXPOSURE = 1.0;
    // 无痕模式下 localStorage 可能不能用
    let pref = 'auto';
    try { pref = localStorage.getItem('ts_quality') || 'auto'; } catch (e) {}
    const urlQ = (location.search.match(/[?&]q=(low|medium|high|auto)/) || [])[1];
    if (urlQ) pref = urlQ;
    const autoTier = opts.isTouch ? 'medium' : 'high';
    let tierName = pref === 'auto' ? autoTier : pref;
    let Q = QUALITY[tierName];
    let scale = Q.scale;
    let frameN = 0;

    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    quad.frustumCulled = false;
    const quadScene = new THREE.Scene();
    quadScene.add(quad);
    function pass(mat, target) {
      quad.material = mat;
      renderer.setRenderTarget(target);
      renderer.render(quadScene, quadCam);
    }
    function mkRT(w, h, type) {
      const t = new THREE.WebGLRenderTarget(w, h, { type: type || HDR, depthBuffer: false });
      t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter;
      t.texture.generateMipmaps = false;
      return t;
    }
    function mat(frag, uniforms, vs, defines) {
      return new THREE.ShaderMaterial({ vertexShader: vs || QUAD_VS, fragmentShader: frag, uniforms, defines: defines || {}, depthTest: false, depthWrite: false });
    }

    // ---------- 渲染目标 ----------
    let W = 1, H = 1, sceneRT = null, aoRT = null, volRT = null, godRT = null;
    let bloomDown = [], bloomUp = [];
    function disposeAll() {
      [sceneRT, aoRT, volRT, godRT].concat(bloomDown, bloomUp).forEach(t => t && t.dispose());
      bloomDown = []; bloomUp = [];
      sceneRT = aoRT = volRT = godRT = null;
    }
    function build() {
      disposeAll();
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      W = Math.max(2, Math.round(size.x * scale)); H = Math.max(2, Math.round(size.y * scale));
      const dt = new THREE.DepthTexture(W, H);
      dt.type = THREE.UnsignedIntType;
      sceneRT = new THREE.WebGLRenderTarget(W, H, { type: HDR, samples: gl2 ? Q.msaa : 0, depthTexture: dt, depthBuffer: true });
      sceneRT.texture.minFilter = sceneRT.texture.magFilter = THREE.LinearFilter;
      sceneRT.texture.generateMipmaps = false;
      if (Q.ao) aoRT = mkRT(W >> 1, H >> 1, THREE.UnsignedByteType);
      godRT = mkRT(Math.ceil(W / 4), Math.ceil(H / 4));
      if (Q.vol && Q.shadow) volRT = mkRT(Math.ceil(W / Q.volDiv), Math.ceil(H / Q.volDiv), THREE.UnsignedByteType);
      let w = W >> 1, h = H >> 1;
      for (let i = 0; i < Q.bloom; i++) {
        bloomDown.push(mkRT(Math.max(1, w), Math.max(1, h)));
        if (i < Q.bloom - 1) bloomUp.push(mkRT(Math.max(1, w), Math.max(1, h)));
        w >>= 1; h >>= 1;
      }
      U.uTexel.value.set(1 / W, 1 / H);
      volMat.defines.STEPS = Q.vol || 1; volMat.needsUpdate = true;
      if (Q.ao) { aoMat.defines.AO_N = Q.ao; aoMat.needsUpdate = true; }
      compMat.defines.USE_AO = Q.ao ? 1 : 0;
      compMat.defines.USE_VOL = volRT ? 1 : 0;
      compMat.defines.USE_GOD = godRT ? 1 : 0;
      compMat.defines.USE_SHARP = Q.sharp > 0 ? 1 : 0;
      // 渲染分辨率越低，锐化越多一点
      compMat.uniforms.uSharp.value = Q.sharp * (1 + (1 - scale) * 1.5);
      compMat.needsUpdate = true;
    }

    // ---------- 共享 uniform ----------
    const U = {
      uNear: { value: 0.05 }, uFar: { value: 700 },
      uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() }, uSunDir: { value: sunDir },
      uTexel: { value: new THREE.Vector2() }, uTime: { value: 0 },
      uProj: { value: new THREE.Matrix4() },
    };

    // ---------- 环境光遮蔽（角落和物体底部变暗） ----------
    const aoMat = mat(COMMON + `
      uniform sampler2D tDepth; uniform mat4 uProjInv; uniform mat4 uProj; uniform vec2 uTexel;
      varying vec2 vUv;
      vec3 viewPos(vec2 uv) {
        float d = texture2D(tDepth, uv).x;
        vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
        return p.xyz / p.w;
      }
      void main() {
        float d = texture2D(tDepth, vUv).x;
        if (d >= 0.99999) { gl_FragColor = vec4(1.0); return; }
        vec3 P = viewPos(vUv);
        vec3 N = normalize(cross(dFdx(P), dFdy(P)));
        float R = 0.9;
        float rUv = R * uProj[1][1] * 0.5 / -P.z;
        float n0 = ign(gl_FragCoord.xy) * 6.2831;
        float occ = 0.0;
        for (int i = 0; i < AO_N; i++) {
          float fi = (float(i) + 0.5) / float(AO_N);
          float a = n0 + float(i) * 2.39996;
          vec2 off = vec2(cos(a), sin(a)) * rUv * fi;
          off.x *= uTexel.x / uTexel.y;
          vec3 v = viewPos(vUv + off) - P;
          float vv = dot(v, v);
          float vn = dot(v, N);
          occ += max(0.0, vn - 0.02 * -P.z) / (vv + 0.05) * step(vv, R * R * 4.0);
        }
        float ao = clamp(1.0 - occ * 2.4 / float(AO_N), 0.0, 1.0);
        gl_FragColor = vec4(vec3(ao), 1.0);
      }`, { tDepth: { value: null }, uProjInv: U.uProjInv, uProj: U.uProj, uTexel: U.uTexel, uNear: U.uNear, uFar: U.uFar }, null, { AO_N: 10 });
    aoMat.extensions = { derivatives: true };

    // ---------- 体积光：沿视线在阴影图里走几步，算出空气里亮的地方 ----------
    const VOL_MAX = 75.0;
    const volMat = mat(COMMON + `
      uniform sampler2D tDepth; uniform sampler2D tShadow; uniform mat4 uShadowMat; uniform vec3 uCamPos;
      varying vec2 vUv; varying vec3 vRay;
      void main() {
        float vz = viewDepth(texture2D(tDepth, vUv).x);
        float rl = length(vRay);
        vec3 dir = vRay / rl;
        float dist = min(vz * rl, ${VOL_MAX.toFixed(1)});
        float stepL = dist / float(STEPS);
        float t = stepL * ign(gl_FragCoord.xy);
        float acc = 0.0;
        for (int i = 0; i < STEPS; i++) {
          vec3 p = uCamPos + dir * t;
          vec4 sc = uShadowMat * vec4(p, 1.0);
          float lit = 1.0;
          if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0)
            lit = step(sc.z - 0.002, unpackRGBAToDepth(texture2D(tShadow, sc.xy)));
          float dens = 0.3 + 1.3 * exp(-max(p.y, 0.0) * 0.22);
          acc += lit * dens * stepL;
          t += stepL;
        }
        gl_FragColor = vec4(acc / (${VOL_MAX.toFixed(1)} * 1.35), 0.0, 0.0, 1.0);
      }`, { tDepth: { value: null }, tShadow: { value: null }, uShadowMat: { value: new THREE.Matrix4() }, uCamPos: U.uCamPos, uNear: U.uNear, uFar: U.uFar, uProjInv: U.uProjInv, uCamWorld: U.uCamWorld }, RAY_VS, { STEPS: 16 });

    // ---------- 泛光：亮的地方发出柔和的光晕 ----------
    // ---------- 太阳光芒：太阳躲在网、塔、集装箱后面时，从缝隙里射出一道道光线 ----------
    const godMat = mat(COMMON + `
      uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uSunUv; uniform float uAspect;
      varying vec2 vUv;
      void main() {
        vec2 stepv = (vUv - uSunUv) / 48.0;
        vec2 uv = vUv - stepv * ign(gl_FragCoord.xy);
        float decay = 1.0; vec3 acc = vec3(0.0);
        for (int i = 0; i < 48; i++) {
          uv -= stepv;
          float sky = step(0.99999, texture2D(tDepth, uv).x);
          vec2 dv = (uv - uSunUv) * vec2(uAspect, 1.0);
          float nearSun = exp(-dot(dv, dv) * 24.0);
          acc += min(texture2D(tColor, uv).rgb, vec3(3.0)) * sky * nearSun * decay;
          decay *= 0.972;
        }
        gl_FragColor = vec4(acc / 48.0, 1.0);
      }`, { tColor: { value: null }, tDepth: { value: null }, uSunUv: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uNear: U.uNear, uFar: U.uFar });
    const _sp = new THREE.Vector3(), _fw = new THREE.Vector3();

    const prefilterMat = mat(`
      uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
               + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
        c *= 0.25;
        c = min(c, vec3(40.0));
        float l = max(c.r, max(c.g, c.b));
        float k = 1.1, knee = 0.6;
        float s = clamp(l - k + knee, 0.0, 2.0 * knee);
        s = s * s / (4.0 * knee + 1e-4);
        float w = max(s, l - k) / max(l, 1e-4);
        gl_FragColor = vec4(c * w, 1.0);
      }`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    const downMat = mat(`
      uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
        c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
        c += texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
        c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
        c += texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
        gl_FragColor = vec4(c / 8.0, 1.0);
      }`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    const upMat = mat(`
      uniform sampler2D tSrc; uniform sampler2D tAdd; uniform vec2 uTexel; varying vec2 vUv;
      void main() {
        vec3 c = vec3(0.0);
        c += texture2D(tSrc, vUv + uTexel * vec2(-2.0, 0.0)).rgb;
        c += texture2D(tSrc, vUv + uTexel * vec2(2.0, 0.0)).rgb;
        c += texture2D(tSrc, vUv + uTexel * vec2(0.0, -2.0)).rgb;
        c += texture2D(tSrc, vUv + uTexel * vec2(0.0, 2.0)).rgb;
        c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 2.0;
        c += texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb * 2.0;
        c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb * 2.0;
        c += texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb * 2.0;
        gl_FragColor = vec4(c / 12.0 + texture2D(tAdd, vUv).rgb, 1.0);
      }`, { tSrc: { value: null }, tAdd: { value: null }, uTexel: { value: new THREE.Vector2() } });

    // ---------- 合成：雾、光柱、泛光、色调、暗角、胶片颗粒 ----------
    const compMat = mat(COMMON + SKY_GLSL + `
      uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tBloom; uniform sampler2D tAO; uniform sampler2D tVol;
      uniform vec3 uCamPos; uniform vec2 uTexel; uniform vec2 uAOTexel; uniform vec2 uVolTexel;
      uniform float uExposure; uniform float uTime; uniform float uBloom; uniform float uHit;
      uniform sampler2D tGod; uniform float uGod; uniform float uSharp;
      varying vec2 vUv; varying vec3 vRay;
      vec3 fxFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
      vec3 aces(vec3 c) {
        const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
        const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
        c *= uExposure / 0.6;
        return clamp(O * fxFit(I * c), 0.0, 1.0);
      }
      vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
      float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        vec2 uv = vUv;
        float d = texture2D(tDepth, uv).x;
        // 远处地面上的热浪：画面轻轻抖动
        float far0 = d < 0.99999 ? viewDepth(d) : 999.0;
        float haze = smoothstep(45.0, 140.0, far0);
        if (haze > 0.0) {
          vec2 hp = vec2(vUv.x * 60.0, vUv.y * 140.0 - uTime * 3.0);
          uv += (vec2(vn(hp), vn(hp + 7.3)) - 0.5) * vec2(0.0012, 0.0022) * haze;
          d = texture2D(tDepth, uv).x;
        }
        vec3 col = texture2D(tColor, uv).rgb;
        #if USE_SHARP
          // 锐化：把边缘和纹理细节变清楚（在压缩过的亮度里做，太阳边上不会出白边）
          vec3 nb = texture2D(tColor, uv + vec2(uTexel.x, 0.0)).rgb + texture2D(tColor, uv - vec2(uTexel.x, 0.0)).rgb
                  + texture2D(tColor, uv + vec2(0.0, uTexel.y)).rgb + texture2D(tColor, uv - vec2(0.0, uTexel.y)).rgb;
          nb *= 0.25;
          vec3 ca = col / (1.0 + col), na = nb / (1.0 + nb);
          vec3 sa = clamp(ca + (ca - na) * uSharp, 0.0, 0.995);
          col = sa / (1.0 - sa);
        #endif
        float rl = length(vRay);
        vec3 dir = vRay / rl;
        float sunAmt = max(dot(dir, uSunDir), 0.0);
        if (d < 0.99999) {
          float dist = viewDepth(d) * rl;
          #if USE_AO
            float ao = texture2D(tAO, vUv + uAOTexel * vec2(-0.5, -0.5)).r + texture2D(tAO, vUv + uAOTexel * vec2(0.5, -0.5)).r
                     + texture2D(tAO, vUv + uAOTexel * vec2(-0.5, 0.5)).r + texture2D(tAO, vUv + uAOTexel * vec2(0.5, 0.5)).r;
            col *= mix(1.0, ao * 0.25, 0.85);
          #endif
          // 高度雾：贴着地面的沙尘更浓，远山被空气染成暖色
          float a = 0.006, b = 0.05;
          float dy = dir.y * dist;
          float fogI = a * exp(-b * max(uCamPos.y, 0.0)) * dist * (abs(dy) > 0.01 ? (1.0 - exp(-b * dy)) / (b * dy) : 1.0);
          // 一团一团慢慢飘的沙尘，雾不是均匀的
          vec3 wp = uCamPos + dir * dist;
          fogI *= 0.6 + 0.9 * vn(wp.xz * 0.025 + vec2(uTime * 0.03, uTime * 0.012)) * (0.6 + 0.4 * vn(wp.xz * 0.09 - uTime * 0.05));
          float fog = 1.0 - exp(-fogI);
          vec3 fogCol = skyBase(normalize(vec3(dir.x, max(dir.y, 0.0) * 0.35, dir.z))) * 0.95;
          col = mix(col, fogCol, clamp(fog, 0.0, 1.0));
        }
        #if USE_VOL
          float v = texture2D(tVol, vUv + uVolTexel * vec2(-0.6, -0.6)).r + texture2D(tVol, vUv + uVolTexel * vec2(0.6, -0.6)).r
                  + texture2D(tVol, vUv + uVolTexel * vec2(-0.6, 0.6)).r + texture2D(tVol, vUv + uVolTexel * vec2(0.6, 0.6)).r;
          v *= 0.25 * ${(VOL_MAX * 1.35).toFixed(2)};
          // 向着太阳看时光柱最明显（米氏散射）
          float g = 0.6;
          float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * sunAmt, 1.5);
          col += vec3(1.0, 0.70, 0.40) * v * 0.0105 * (hg * 0.075 + 0.025) * (d < 0.99999 ? 1.0 : 0.3);
        #endif
        col += texture2D(tBloom, vUv).rgb * uBloom;
        #if USE_GOD
          col += texture2D(tGod, vUv).rgb * vec3(1.0, 0.8, 0.55) * uGod * 0.9;
        #endif
        // 镜头光斑：太阳在画面里时，沿着画面中心对面出现几个淡淡的彩色光圈
        vec2 fl = vec2(1.0) - vUv;
        vec2 fd = (vec2(0.5) - fl) ;
        vec3 ghosts = texture2D(tBloom, fl + fd * 0.45).rgb * vec3(0.9, 0.6, 0.3)
                    + texture2D(tBloom, fl - fd * 0.35).rgb * vec3(0.4, 0.7, 1.0)
                    + texture2D(tBloom, fl + fd * 1.25).rgb * vec3(0.6, 1.0, 0.6) * 0.6;
        col += ghosts * uBloom * 0.035;
        col = aces(col);
        // 调色：暗部偏青、亮部偏暖，轻微提高饱和度和对比度
        float L = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(L), col, 1.12);
        col += vec3(-0.012, 0.004, 0.018) * (1.0 - smoothstep(0.0, 0.45, L)) + vec3(0.02, 0.008, -0.02) * smoothstep(0.45, 1.0, L);
        col = clamp(col, 0.0, 1.0);
        col = col * col * (3.0 - 2.0 * col) * 0.22 + col * 0.78;
        vec2 q = vUv - 0.5;
        col *= 1.0 - dot(q, q) * 0.55;
        col = mix(col, vec3(0.75, 0.05, 0.03), uHit * smoothstep(0.15, 0.6, length(q)));
        col = toSRGB(clamp(col, 0.0, 1.0));
        col += (ign(gl_FragCoord.xy + fract(uTime * 7.0) * 113.0) - 0.5) * 0.018;
        gl_FragColor = vec4(col, 1.0);
      }`, {
      tColor: { value: null }, tDepth: { value: null }, tBloom: { value: null }, tAO: { value: null }, tVol: { value: null },
      uCamPos: U.uCamPos, uSunDir: U.uSunDir, uTexel: U.uTexel, uAOTexel: { value: new THREE.Vector2() }, uVolTexel: { value: new THREE.Vector2() },
      uExposure: { value: EXPOSURE }, uTime: U.uTime, tGod: { value: null }, uGod: { value: 0 }, uBloom: { value: 0.11 }, uHit: { value: 0 }, uSharp: { value: 0.4 },
      uNear: U.uNear, uFar: U.uFar, uProjInv: U.uProjInv, uCamWorld: U.uCamWorld,
    }, RAY_VS, { USE_AO: 0, USE_VOL: 0, USE_GOD: 0, USE_SHARP: 0 });
    renderer.toneMappingExposure = EXPOSURE;

    // ---------- 阴影设置 ----------
    function applyShadows(scene) {
      const on = Q.shadow > 0;
      const changed = renderer.shadowMap.enabled !== on || (on && renderer.shadowMap.type !== (Q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap));
      renderer.shadowMap.enabled = on;
      renderer.shadowMap.type = Q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      sun.castShadow = on;
      if (on && sun.shadow.mapSize.x !== Q.shadow) {
        sun.shadow.mapSize.set(Q.shadow, Q.shadow);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      }
      if (changed && scene) scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); });
    }

    let lastScene = null;
    function setTier(name, keepScale) {
      tierName = name; Q = QUALITY[name];
      if (!keepScale) scale = Q.scale;
      applyShadows(lastScene);
      build();
    }

    // ---------- 自动画质：卡了就降，流畅很久就慢慢升 ----------
    let ema = 1 / 60, slowT = 0, fastT = 0, warm = 0;
    function adapt(dt) {
      if (pref !== 'auto' || dt <= 0) return;
      warm += dt;
      if (warm < 3) return; // 刚开始加载时不算
      ema += (dt - ema) * 0.05;
      if (ema > 1 / 42) { slowT += dt; fastT = 0; } else if (ema < 1 / 57) { fastT += dt; slowT = 0; } else { slowT = Math.max(0, slowT - dt); fastT = 0; }
      if (slowT > 2) {
        slowT = 0; ema = 1 / 50;
        if (scale > 0.62) { scale = Math.max(0.6, scale * 0.85); build(); }
        else {
          const i = ORDER.indexOf(tierName);
          if (i > 0) setTier(ORDER[i - 1]); else if (scale > 0.5) { scale = 0.5; build(); }
        }
      } else if (fastT > 6 && scale < Q.scale) {
        fastT = 0; scale = Math.min(Q.scale, scale / 0.85); build();
      }
    }

    function render(scene, camera, dt) {
      if (lastScene !== scene) { lastScene = scene; applyShadows(scene); }
      if (!sceneRT) build();
      adapt(dt || 0);
      frameN++;
      U.uTime.value += dt || 0;
      U.uNear.value = camera.near; U.uFar.value = camera.far;
      U.uProjInv.value.copy(camera.projectionMatrixInverse);
      U.uProj.value.copy(camera.projectionMatrix);
      U.uCamWorld.value.copy(camera.matrixWorld);
      U.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);

      renderer.setRenderTarget(sceneRT);
      renderer.clear();
      renderer.render(scene, camera);

      if (aoRT) {
        aoMat.uniforms.tDepth.value = sceneRT.depthTexture;
        pass(aoMat, aoRT);
        compMat.uniforms.uAOTexel.value.set(1 / aoRT.width, 1 / aoRT.height);
      }
      compMat.uniforms.uGod.value = 0;
      if (godRT) {
        camera.getWorldDirection(_fw);
        const facing = _fw.dot(sunDir);
        _sp.copy(sunDir).multiplyScalar(400).add(U.uCamPos.value).project(camera);
        if (facing > 0.15 && Math.abs(_sp.x) < 1.6 && Math.abs(_sp.y) < 1.6) {
          godMat.uniforms.tColor.value = sceneRT.texture;
          godMat.uniforms.tDepth.value = sceneRT.depthTexture;
          godMat.uniforms.uSunUv.value.set(_sp.x * 0.5 + 0.5, _sp.y * 0.5 + 0.5);
          godMat.uniforms.uAspect.value = W / H;
          pass(godMat, godRT);
          compMat.uniforms.tGod.value = godRT.texture;
          compMat.uniforms.uGod.value = Math.min(1, (facing - 0.15) * 2.5) * (1 - Math.max(0, Math.max(Math.abs(_sp.x), Math.abs(_sp.y)) - 1) / 0.6);
        }
      }
      if (volRT && sun.shadow.map) {
        volMat.uniforms.tDepth.value = sceneRT.depthTexture;
        volMat.uniforms.tShadow.value = sun.shadow.map.texture;
        volMat.uniforms.uShadowMat.value.copy(sun.shadow.matrix);
        pass(volMat, volRT);
        compMat.uniforms.uVolTexel.value.set(1 / volRT.width, 1 / volRT.height);
      }
      // 泛光
      prefilterMat.uniforms.tSrc.value = sceneRT.texture;
      prefilterMat.uniforms.uTexel.value.set(0.5 / W, 0.5 / H);
      pass(prefilterMat, bloomDown[0]);
      for (let i = 1; i < bloomDown.length; i++) {
        downMat.uniforms.tSrc.value = bloomDown[i - 1].texture;
        downMat.uniforms.uTexel.value.set(1 / bloomDown[i - 1].width, 1 / bloomDown[i - 1].height);
        pass(downMat, bloomDown[i]);
      }
      let src = bloomDown[bloomDown.length - 1];
      for (let i = bloomDown.length - 2; i >= 0; i--) {
        upMat.uniforms.tSrc.value = src.texture;
        upMat.uniforms.tAdd.value = bloomDown[i].texture;
        upMat.uniforms.uTexel.value.set(0.5 / src.width, 0.5 / src.height);
        pass(upMat, bloomUp[i]);
        src = bloomUp[i];
      }
      compMat.uniforms.tColor.value = sceneRT.texture;
      compMat.uniforms.tDepth.value = sceneRT.depthTexture;
      compMat.uniforms.tBloom.value = src.texture;
      compMat.uniforms.tAO.value = aoRT ? aoRT.texture : null;
      compMat.uniforms.tVol.value = volRT ? volRT.texture : null;
      compMat.uniforms.uBloom.value = 0.5 / bloomDown.length;
      pass(compMat, null);
    }

    return {
      enabled: true,
      SKY_GLSL,
      render,
      resize() { if (sceneRT) build(); },
      get tier() { return tierName; },
      get pref() { return pref; },
      setPref(p) {
        pref = p;
        try { localStorage.setItem('ts_quality', p); } catch (e) {}
        setTier(p === 'auto' ? autoTier : p);
        ema = 1 / 60; slowT = fastT = 0;
      },
      setHit(v) { compMat.uniforms.uHit.value = v; },
      shadowsOn() { return Q.shadow > 0; },
      shadowSize() { return Q.shadow || 1024; },
      get isTouch() { return !!opts.isTouch; },
      get hdr() { return HDR === THREE.HalfFloatType; },
      info() { return { tier: tierName, pref, scale: +scale.toFixed(2), W, H, hdr: HDR === THREE.HalfFloatType, msaa: gl2 ? Q.msaa : 0, ao: !!aoRT, vol: !!volRT, god: !!godRT, frames: frameN, ms: +(ema * 1000).toFixed(1) }; },
    };
  }

  window.FX = { create, QUALITY };
})();
