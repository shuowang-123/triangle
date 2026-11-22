// 武器库：9 把枪的数据和第一人称手里的精细模型。
// 每把枪都是用很多小零件拼出来的：导轨齿、弹匣、拉机柄、抛壳窗、瞄具镜片、手套手指……
// 用法：const G = Guns.build({ B, CYL, normal, wood, sleeve, glowMat }); → { WEAPONS, models }
window.Guns = (function () {
  'use strict';

  // ---------- 武器数据 ----------
  // mode: auto 连发 / semi 半自动（点一下打一发） / pump 泵动（一发发装弹） / bolt 栓动
  // unlock: 完成第几个任务后解锁（宝箱里也能提前开出来）
  // falloff: [开始衰减距离, 最远距离, 最远时剩下的威力]
  const WEAPONS = [
    { id: 'pistol', name: '手枪', short: '手枪', mode: 'semi', mag: 15, reserve: Infinity, maxRes: Infinity, rate: 0.15, dmg: 1.5, pellets: 1, spread: 0.022, adsSpread: 0.006, reload: 1.15, reloadEmpty: 1.45, fov: 62, recoil: 0.024, recoilX: 0.008, sfx: 'pistol', color: 0xffd27a, hip: [0.13, -0.135, -0.34], adsZ: -0.3, move: 1.06, unlock: 0, falloff: [18, 45, 0.6], heat: 0.18, desc: '永远有子弹，点一下打一发' },
    { id: 'smg', name: '冲锋枪', short: '冲锋', mode: 'auto', mag: 32, reserve: 192, maxRes: 320, rate: 0.066, dmg: 0.72, pellets: 1, spread: 0.03, adsSpread: 0.009, reload: 1.5, reloadEmpty: 1.95, fov: 62, recoil: 0.0055, recoilX: 0.0055, sfx: 'smg', color: 0xffd27a, hip: [0.14, -0.14, -0.36], adsZ: -0.32, move: 1.04, unlock: 0, falloff: [16, 40, 0.5], heat: 0.06, desc: '射速最快，近距离很猛' },
    { id: 'rifle', name: '突击步枪', short: '步枪', mode: 'auto', mag: 30, reserve: 210, maxRes: 360, rate: 0.095, dmg: 1.05, pellets: 1, spread: 0.022, adsSpread: 0.004, reload: 1.6, reloadEmpty: 2.1, fov: 52, recoil: 0.0085, recoilX: 0.004, sfx: 'rifle', color: 0xffd27a, hip: [0.15, -0.15, -0.4], adsZ: -0.36, move: 1, unlock: 0, falloff: [35, 90, 0.7], heat: 0.07, desc: '什么距离都好用' },
    { id: 'shotgun', name: '霰弹枪', short: '霰弹', mode: 'pump', mag: 7, reserve: 42, maxRes: 64, rate: 0.8, dmg: 0.95, pellets: 9, spread: 0.075, adsSpread: 0.05, reload: 0.42, reloadEmpty: 0.42, shell: true, fov: 62, recoil: 0.045, recoilX: 0.012, sfx: 'shotgun', color: 0xffc04a, hip: [0.15, -0.15, -0.4], adsZ: -0.36, move: 0.98, unlock: 1, falloff: [9, 28, 0.3], heat: 0.3, desc: '一枪 9 颗弹丸，贴脸无敌' },
    { id: 'dmr', name: '射手步枪', short: '射手', mode: 'semi', mag: 10, reserve: 60, maxRes: 100, rate: 0.27, dmg: 3.6, pellets: 1, spread: 0.03, adsSpread: 0.0015, reload: 1.9, reloadEmpty: 2.4, fov: 30, recoil: 0.03, recoilX: 0.008, sfx: 'dmr', color: 0xfff0b0, hip: [0.15, -0.15, -0.42], adsZ: -0.36, move: 0.96, unlock: 2, falloff: [60, 140, 0.85], heat: 0.22, desc: '带 4 倍镜，中远距离两枪一个' },
    { id: 'sniper', name: '狙击枪', short: '狙击', mode: 'bolt', mag: 5, reserve: 30, maxRes: 50, rate: 1.1, dmg: 9, pellets: 1, spread: 0.04, adsSpread: 0, reload: 2.4, reloadEmpty: 2.9, fov: 18, recoil: 0.06, recoilX: 0.01, sfx: 'sniper', color: 0xfff0b0, hip: [0.15, -0.15, -0.42], adsZ: -0.4, move: 0.92, unlock: 2, pierce: true, scope: true, falloff: [200, 300, 1], heat: 0.5, desc: '一枪能穿过好几个坏蛋' },
    { id: 'lmg', name: '轻机枪', short: '机枪', mode: 'auto', mag: 100, reserve: 200, maxRes: 400, rate: 0.08, dmg: 1.15, pellets: 1, spread: 0.035, adsSpread: 0.008, reload: 3.4, reloadEmpty: 3.8, fov: 55, recoil: 0.007, recoilX: 0.006, sfx: 'lmg', color: 0xffd27a, hip: [0.16, -0.16, -0.42], adsZ: -0.4, move: 0.84, unlock: 3, falloff: [40, 100, 0.7], heat: 0.05, desc: '100 发大弹箱，压住坏蛋打' },
    { id: 'launcher', name: '榴弹发射器', short: '榴弹', mode: 'semi', mag: 6, reserve: 12, maxRes: 24, rate: 0.55, dmg: 8, pellets: 1, spread: 0.01, adsSpread: 0, reload: 3.0, reloadEmpty: 3.0, fov: 58, recoil: 0.05, recoilX: 0.01, sfx: 'launcher', color: 0xff8a1f, hip: [0.16, -0.14, -0.4], adsZ: -0.36, move: 0.92, unlock: 4, launcher: true, blast: 4.5, heat: 0.3, desc: '弹会划一道弧线，落地就炸' },
    { id: 'rocket', name: '火箭筒', short: '火箭', mode: 'semi', mag: 1, reserve: 4, maxRes: 8, rate: 0.9, dmg: 14, pellets: 1, spread: 0.01, adsSpread: 0, reload: 1.8, reloadEmpty: 1.8, fov: 58, recoil: 0.05, recoilX: 0.01, sfx: 'rocketFire', color: 0xff8a1f, hip: [0.17, -0.12, -0.4], adsZ: -0.36, move: 0.9, unlock: 3, rocket: true, blast: 6, heat: 0.4, desc: '专打重甲兵和坏蛋司令' },
  ];

  function build(ctx) {
    const { B, CYL, normal, glowMat } = ctx;
    const nS = new THREE.Vector2(0.35, 0.35);
    const std = o => new THREE.MeshStandardMaterial(Object.assign({ normalMap: normal, normalScale: nS }, o));
    const M = {
      poly: std({ color: 0x25282c, roughness: 0.66, metalness: 0.12 }),
      metal: std({ color: 0x3b3f45, roughness: 0.36, metalness: 0.85 }),
      dark: std({ color: 0x17181a, roughness: 0.45, metalness: 0.7 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x8d939b, roughness: 0.2, metalness: 0.95 }),
      fde: std({ color: 0xa88b5c, roughness: 0.7, metalness: 0.08 }),
      od: std({ color: 0x505b35, roughness: 0.72, metalness: 0.08 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x7a4a24, roughness: 0.55, normalMap: ctx.wood || normal, normalScale: new THREE.Vector2(0.3, 0.3) }),
      brass: new THREE.MeshStandardMaterial({ color: 0xd9a84a, roughness: 0.28, metalness: 1 }),
      shellRed: new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.5 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x3a6a8c, roughness: 0.04, metalness: 0.6, emissive: 0x0b2a48, emissiveIntensity: 0.3, transparent: true, opacity: 0.22, depthWrite: false }),
      lensFront: new THREE.MeshStandardMaterial({ color: 0x264a66, roughness: 0.02, metalness: 1, emissive: 0x18486e, emissiveIntensity: 0.35 }),
      orange: new THREE.MeshStandardMaterial({ color: 0xff8a1f, roughness: 0.5 }),
      warhead: std({ color: 0x5d6638, roughness: 0.6, metalness: 0.2 }),
      glove: std({ color: 0x3a3226, roughness: 0.92, metalness: 0 }),
      knuckle: std({ color: 0x24211c, roughness: 0.8, metalness: 0 }),
      sleeve: ctx.sleeve,
      tritium: new THREE.MeshBasicMaterial({ color: 0x7dff6a, toneMapped: false }),
      red: new THREE.MeshBasicMaterial({ color: 0xff3030, toneMapped: false }),
    };

    // ---------- 拼零件的小工具 ----------
    function P(g, geo, mat, x, y, z, rx, ry, rz) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (rx) m.rotation.x = rx; if (ry) m.rotation.y = ry; if (rz) m.rotation.z = rz;
      g.add(m);
      return m;
    }
    const box = (g, w, h, d, mat, x, y, z, rx, ry, rz) => P(g, B(w, h, d), mat, x, y, z, rx, ry, rz);
    const cyl = (g, r, l, mat, x, y, z, seg) => P(g, CYL(r, l, seg), mat, x, y, z);
    const vcyl = (g, r, l, mat, x, y, z, seg) => P(g, new THREE.CylinderGeometry(r, r, l, seg || 12), mat, x, y, z);
    const xcyl = (g, r, l, mat, x, y, z, seg) => P(g, new THREE.CylinderGeometry(r, r, l, seg || 12), mat, x, y, z, 0, 0, Math.PI / 2);
    function grp(parent, x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }
    function dot(g, color, size, x, y, z) {
      const s = new THREE.Sprite(glowMat(color, 1)); s.scale.setScalar(size); s.position.set(x, y, z); g.add(s); return s;
    }
    // 皮卡汀尼导轨：底座 + 一排小齿
    function rail(g, len, x, y, z, w) {
      w = w || 0.034;
      box(g, w, 0.012, len, M.dark, x, y, z);
      const n = Math.floor(len / 0.019);
      const tooth = B(w + 0.006, 0.008, 0.009);
      for (let i = 0; i < n; i++) P(g, tooth, M.dark, x, y + 0.009, z - len / 2 + 0.01 + i * (len - 0.02) / Math.max(1, n - 1));
    }
    // 两边的散热孔
    function vents(g, n, x, y, z, step, w) {
      const geo = B(0.004, 0.013, w || 0.026);
      for (let i = 0; i < n; i++) for (const s of [-1, 1]) P(g, geo, M.dark, x * s, y, z - i * step);
    }
    // 弯弹匣：一节一节往前弯
    function curvedMag(parent, x, y, z, n, w, segH, d, mat, curve) {
      const g = grp(parent, x, y, z);
      let yy = 0, zz = 0, a = 0;
      for (let i = 0; i < n; i++) {
        box(g, w, segH * 1.18, d, mat, 0, yy - Math.cos(a) * segH / 2, zz - Math.sin(a) * segH / 2, a);
        // 弹匣侧面的加强筋
        box(g, w + 0.004, segH * 0.3, d * 0.6, M.dark, 0, yy - Math.cos(a) * segH * 0.5, zz - Math.sin(a) * segH * 0.5, a);
        yy -= Math.cos(a) * segH; zz -= Math.sin(a) * segH; a += curve;
      }
      box(g, w + 0.008, 0.012, d + 0.01, M.dark, 0, yy - 0.004, zz, a - curve);
      // 最上面露出的子弹
      cyl(g, 0.006, 0.03, M.brass, 0, 0.004, -0.004);
      return g;
    }
    // 一只戴战术手套的手：手掌 + 四根手指 + 大拇指 + 护腕 + 袖子
    const FING = (() => { const g = new THREE.CapsuleGeometry(0.0125, 0.045, 3, 8); return g; })();
    const THUMB = new THREE.CapsuleGeometry(0.013, 0.04, 3, 8);
    const SLV = (() => { const g = new THREE.CapsuleGeometry(0.047, 0.4, 4, 14); g.rotateX(Math.PI / 2); return g; })();
    const CUFF = (() => { const g = new THREE.CylinderGeometry(0.04, 0.043, 0.05, 14); g.rotateX(Math.PI / 2); return g; })();
    function gripHand(g, x, y, z, tilt) {
      const h = grp(g, x, y, z); h.rotation.x = tilt || -0.3;
      box(h, 0.03, 0.085, 0.075, M.glove, 0.03, 0, 0.012);
      for (let i = 0; i < 4; i++) {
        const f = P(h, FING, M.glove, 0.005, 0.03 - i * 0.022, -0.035, Math.PI / 2, 0, 0);
        f.rotation.z = 0.0;
        box(h, 0.022, 0.016, 0.014, M.knuckle, 0.022, 0.03 - i * 0.022, -0.02);
      }
      P(h, THUMB, M.glove, -0.026, 0.045, -0.01, 0.9, 0, 0.2);
      P(h, CUFF, M.knuckle, 0.035, -0.03, 0.065, 0.45, 0.25);
      P(h, SLV, M.sleeve, 0.08, -0.13, 0.24, 0.5, 0.3);
      return h;
    }
    function foreHand(g, x, y, z, side) {
      const h = grp(g, x, y, z);
      box(h, 0.075, 0.03, 0.1, M.glove, 0, -0.012, 0);
      for (let i = 0; i < 4; i++) P(h, FING, M.glove, -0.04 * (side || 1), 0.012, -0.04 + i * 0.024, 0, 0, 0.15);
      P(h, THUMB, M.glove, 0.036 * (side || 1), 0.01, 0.0, 0.3, 0, -0.3);
      P(h, CUFF, M.knuckle, -0.02, -0.045, 0.06, 0.75, -0.45);
      P(h, SLV, M.sleeve, -0.1, -0.17, 0.19, 0.75, -0.45);
      return h;
    }
    function triggerGuard(g, z, y, len) {
      box(g, 0.012, 0.006, len, M.poly, 0, y - 0.035, z);
      box(g, 0.012, 0.035, 0.008, M.poly, 0, y - 0.018, z - len / 2);
      box(g, 0.006, 0.022, 0.006, M.dark, 0, y - 0.016, z + 0.004, 0.25);
    }
    // 红点镜（筒形）
    function tubeDot(g, y, z) {
      box(g, 0.036, 0.022, 0.05, M.dark, 0, y - 0.03, z);
      cyl(g, 0.022, 0.085, M.dark, 0, y, z, 20);
      cyl(g, 0.025, 0.014, M.metal, 0, y, z - 0.042, 20);
      cyl(g, 0.024, 0.012, M.metal, 0, y, z + 0.042, 20);
      vcyl(g, 0.009, 0.014, M.metal, 0, y + 0.024, z, 12);
      xcyl(g, 0.009, 0.014, M.metal, 0.024, y, z, 12);
      P(g, new THREE.CircleGeometry(0.019, 20), M.lensFront, 0, y, z - 0.0495, 0, Math.PI);
      P(g, new THREE.CircleGeometry(0.019, 20), M.glass, 0, y, z + 0.049);
      dot(g, 0xff2a2a, 0.016, 0, y, z - 0.03);
      return y;
    }
    // 全息镜（方框）
    function holo(g, y, z) {
      box(g, 0.05, 0.016, 0.085, M.dark, 0, y - 0.028, z);
      box(g, 0.006, 0.05, 0.05, M.dark, -0.024, y, z - 0.012);
      box(g, 0.006, 0.05, 0.05, M.dark, 0.024, y, z - 0.012);
      box(g, 0.054, 0.008, 0.05, M.dark, 0, y + 0.026, z - 0.012);
      box(g, 0.016, 0.02, 0.03, M.metal, 0.02, y - 0.014, z + 0.03);
      P(g, new THREE.PlaneGeometry(0.042, 0.042), M.glass, 0, y, z - 0.03);
      dot(g, 0xff2a2a, 0.012, 0, y, z - 0.03);
      // 一圈红色光环
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.0085, 0.0095, 32), M.red); ring.position.set(0, y, z - 0.031); g.add(ring);
      return y;
    }
    // 4 倍棱镜
    function prism(g, y, z) {
      box(g, 0.03, 0.02, 0.06, M.dark, 0, y - 0.035, z);
      box(g, 0.048, 0.05, 0.12, M.fde, 0, y, z);
      cyl(g, 0.026, 0.04, M.fde, 0, y, z - 0.075, 20);
      cyl(g, 0.02, 0.03, M.dark, 0, y, z + 0.07, 20);
      box(g, 0.02, 0.012, 0.03, M.dark, 0, y + 0.03, z - 0.01);
      P(g, new THREE.CircleGeometry(0.023, 20), M.lensFront, 0, y, z - 0.0955, 0, Math.PI);
      P(g, new THREE.CircleGeometry(0.017, 20), M.glass, 0, y, z + 0.0855);
      const chev = new THREE.Mesh(new THREE.ConeGeometry(0.0022, 0.004, 3), M.red); chev.position.set(0, y - 0.001, z + 0.082); g.add(chev);
      return y;
    }

    // ================= 9 把枪 =================
    function makePistol() {
      const g = new THREE.Group();
      const slide = grp(g, 0, 0.032, -0.055);
      box(slide, 0.034, 0.033, 0.19, M.metal, 0, 0, 0);
      for (let i = 0; i < 6; i++) box(slide, 0.036, 0.022, 0.003, M.dark, 0, -0.002, 0.055 + i * 0.007);
      box(slide, 0.004, 0.012, 0.042, M.dark, 0.016, 0.01, -0.03);
      cyl(slide, 0.008, 0.02, M.steel, 0, 0.002, -0.096);
      box(slide, 0.03, 0.01, 0.01, M.dark, 0, 0.021, 0.085);
      P(slide, new THREE.SphereGeometry(0.0022, 6, 4), M.tritium, -0.008, 0.023, 0.08);
      P(slide, new THREE.SphereGeometry(0.0022, 6, 4), M.tritium, 0.008, 0.023, 0.08);
      box(slide, 0.006, 0.011, 0.007, M.dark, 0, 0.021, -0.088);
      P(slide, new THREE.SphereGeometry(0.0022, 6, 4), M.tritium, 0, 0.024, -0.091);
      box(g, 0.032, 0.026, 0.17, M.poly, 0, 0.002, -0.05);
      box(g, 0.026, 0.01, 0.05, M.poly, 0, -0.013, -0.1);
      triggerGuard(g, -0.03, 0.002, 0.05);
      box(g, 0.032, 0.11, 0.048, M.poly, 0, -0.056, 0.012, -0.22);
      for (let i = 0; i < 4; i++) box(g, 0.034, 0.004, 0.03, M.dark, 0, -0.03 - i * 0.02, 0.016 - i * 0.004, -0.22);
      const mag = grp(g, 0, -0.105, 0.024); mag.rotation.x = -0.22;
      box(mag, 0.03, 0.012, 0.05, M.dark, 0, 0, 0);
      box(g, 0.02, 0.012, 0.01, M.dark, -0.016, 0.004, -0.0);
      gripHand(g, 0.0, -0.05, 0.02, -0.22);
      const fh = foreHand(g, -0.025, -0.07, 0.0, 1); fh.rotation.z = -0.5;
      return { g, slide, mag, muzzle: new THREE.Vector3(0, 0.034, -0.16), eject: new THREE.Vector3(0.02, 0.05, -0.08), sightY: 0.056, kick: 0.06 };
    }
    function makeSMG() {
      const g = new THREE.Group();
      box(g, 0.05, 0.065, 0.3, M.poly, 0, 0, -0.05);
      box(g, 0.048, 0.032, 0.3, M.metal, 0, 0.046, -0.05);
      rail(g, 0.26, 0, 0.068, -0.05);
      box(g, 0.004, 0.016, 0.05, M.dark, 0.026, 0.045, -0.02);
      box(g, 0.012, 0.01, 0.03, M.metal, -0.03, 0.05, 0.05);
      cyl(g, 0.019, 0.08, M.metal, 0, 0.03, -0.24);
      cyl(g, 0.025, 0.17, M.dark, 0, 0.03, -0.36, 20);
      for (let i = 0; i < 3; i++) cyl(g, 0.0262, 0.006, M.metal, 0, 0.03, -0.3 - i * 0.06, 20);
      const mag = grp(g, 0, -0.03, -0.12); mag.rotation.x = 0.08;
      box(mag, 0.028, 0.17, 0.05, M.dark, 0, -0.085, 0);
      box(mag, 0.032, 0.014, 0.056, M.poly, 0, -0.172, 0);
      cyl(mag, 0.005, 0.026, M.brass, 0, 0.002, 0);
      box(g, 0.036, 0.1, 0.05, M.poly, 0, -0.07, 0.07, -0.3);
      triggerGuard(g, 0.02, -0.0, 0.05);
      box(g, 0.03, 0.08, 0.03, M.poly, 0, -0.07, -0.2);
      box(g, 0.034, 0.012, 0.034, M.rubber, 0, -0.112, -0.2);
      // 折叠枪托
      box(g, 0.012, 0.012, 0.2, M.metal, -0.018, 0.02, 0.2);
      box(g, 0.012, 0.012, 0.2, M.metal, 0.018, 0.02, 0.2);
      box(g, 0.05, 0.075, 0.018, M.rubber, 0, -0.004, 0.305);
      holo(g, 0.1, -0.06);
      gripHand(g, 0, -0.065, 0.075);
      foreHand(g, 0, -0.06, -0.2).rotation.x = 0.6;
      return { g, mag, muzzle: new THREE.Vector3(0, 0.03, -0.45), eject: new THREE.Vector3(0.03, 0.045, -0.02), sightY: 0.1, kick: 0.045 };
    }
    function makeRifle() {
      const g = new THREE.Group();
      box(g, 0.05, 0.058, 0.22, M.metal, 0, -0.01, 0);
      box(g, 0.054, 0.05, 0.27, M.metal, 0, 0.04, -0.01);
      box(g, 0.003, 0.02, 0.06, M.dark, 0.028, 0.038, -0.01);
      xcyl(g, 0.008, 0.012, M.metal, 0.03, 0.05, 0.04);
      box(g, 0.012, 0.012, 0.03, M.metal, 0, 0.062, 0.115);
      box(g, 0.06, 0.058, 0.34, M.poly, 0, 0.036, -0.31);
      vents(g, 6, 0.031, 0.03, -0.18, 0.045);
      rail(g, 0.58, 0, 0.069, -0.2);
      box(g, 0.012, 0.03, 0.1, M.dark, -0.034, 0.03, -0.32);
      cyl(g, 0.012, 0.075, M.dark, -0.044, 0.03, -0.38, 14);
      P(g, new THREE.CircleGeometry(0.0115, 14), M.glass, -0.044, 0.03, -0.418, 0, Math.PI);
      cyl(g, 0.011, 0.2, M.steel, 0, 0.035, -0.55);
      box(g, 0.026, 0.03, 0.03, M.dark, 0, 0.04, -0.49);
      cyl(g, 0.018, 0.065, M.dark, 0, 0.035, -0.67, 16);
      for (let i = 0; i < 3; i++) box(g, 0.038, 0.004, 0.008, M.poly, 0, 0.035, -0.65 - i * 0.017);
      box(g, 0.044, 0.05, 0.06, M.metal, 0, -0.042, -0.06);
      const mag = curvedMag(g, 0, -0.066, -0.06, 5, 0.03, 0.036, 0.064, M.metal, 0.08);
      box(g, 0.034, 0.11, 0.05, M.poly, 0, -0.08, 0.1, -0.35);
      triggerGuard(g, 0.04, -0.01, 0.06);
      cyl(g, 0.016, 0.17, M.metal, 0, 0.03, 0.2);
      box(g, 0.046, 0.07, 0.17, M.poly, 0, 0.012, 0.28);
      box(g, 0.04, 0.02, 0.12, M.poly, 0, 0.055, 0.27);
      box(g, 0.05, 0.085, 0.02, M.rubber, 0, 0.008, 0.37);
      tubeDot(g, 0.108, -0.04);
      gripHand(g, 0, -0.07, 0.1);
      foreHand(g, -0.004, 0.0, -0.33);
      return { g, mag, muzzle: new THREE.Vector3(0, 0.035, -0.71), eject: new THREE.Vector3(0.03, 0.04, -0.02), sightY: 0.108, kick: 0.05 };
    }
    function makeShotgun() {
      const g = new THREE.Group();
      box(g, 0.052, 0.072, 0.2, M.metal, 0, 0, 0);
      box(g, 0.003, 0.022, 0.07, M.dark, 0.027, 0.012, -0.02);
      cyl(g, 0.017, 0.56, M.steel, 0, 0.024, -0.37, 16);
      box(g, 0.006, 0.006, 0.5, M.dark, 0, 0.044, -0.36);
      cyl(g, 0.014, 0.46, M.metal, 0, -0.014, -0.32, 14);
      cyl(g, 0.016, 0.02, M.dark, 0, -0.014, -0.555, 14);
      box(g, 0.012, 0.04, 0.012, M.dark, 0, 0.005, -0.54);
      const pump = grp(g, 0, -0.014, -0.29);
      box(pump, 0.062, 0.056, 0.17, M.wood, 0, 0, 0);
      for (let i = 0; i < 7; i++) box(pump, 0.066, 0.05, 0.006, M.dark, 0, -0.002, -0.06 + i * 0.02);
      box(g, 0.05, 0.086, 0.32, M.wood, 0, -0.038, 0.25, 0.12);
      box(g, 0.054, 0.09, 0.024, M.rubber, 0, -0.058, 0.41, 0.12);
      box(g, 0.036, 0.1, 0.05, M.wood, 0, -0.08, 0.08, -0.4);
      triggerGuard(g, 0.04, -0.01, 0.06);
      P(g, new THREE.SphereGeometry(0.005, 8, 6), M.red, 0, 0.047, -0.64);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0025, 6, 18), M.dark); ring.position.set(0, 0.058, 0.07); g.add(ring);
      box(g, 0.008, 0.02, 0.01, M.dark, 0, 0.045, 0.07);
      // 侧面挂的 4 发备用弹
      for (let i = 0; i < 4; i++) {
        cyl(g, 0.009, 0.05, M.shellRed, -0.034, 0.0, -0.06 + i * 0.022, 12).rotation.set(0, 0, 0);
        const s = g.children[g.children.length - 1]; s.rotation.x = Math.PI / 2; s.rotation.z = 0;
        vcyl(g, 0.0095, 0.012, M.brass, -0.034, -0.026, -0.06 + i * 0.022);
      }
      gripHand(g, 0, -0.075, 0.085, -0.4);
      foreHand(pump, 0, -0.03, 0.0);
      return { g, pump, muzzle: new THREE.Vector3(0, 0.024, -0.66), eject: new THREE.Vector3(0.03, 0.02, -0.02), sightY: 0.06, kick: 0.12, shellMat: M.shellRed };
    }
    function makeDMR() {
      const g = new THREE.Group();
      box(g, 0.05, 0.06, 0.24, M.metal, 0, -0.01, 0);
      box(g, 0.054, 0.052, 0.29, M.fde, 0, 0.04, -0.01);
      box(g, 0.003, 0.02, 0.06, M.dark, 0.028, 0.038, -0.01);
      box(g, 0.062, 0.06, 0.42, M.fde, 0, 0.036, -0.36);
      vents(g, 8, 0.032, 0.03, -0.18, 0.045);
      rail(g, 0.66, 0, 0.071, -0.22);
      cyl(g, 0.012, 0.3, M.dark, 0, 0.035, -0.7);
      cyl(g, 0.022, 0.12, M.dark, 0, 0.035, -0.9, 18);
      for (let i = 0; i < 4; i++) cyl(g, 0.0232, 0.005, M.metal, 0, 0.035, -0.86 - i * 0.025, 18);
      // 收起来的两脚架
      box(g, 0.03, 0.02, 0.04, M.dark, 0, -0.005, -0.52);
      box(g, 0.008, 0.008, 0.2, M.metal, -0.012, -0.018, -0.42);
      box(g, 0.008, 0.008, 0.2, M.metal, 0.012, -0.018, -0.42);
      box(g, 0.044, 0.05, 0.06, M.metal, 0, -0.042, -0.06);
      const mag = grp(g, 0, -0.066, -0.06);
      box(mag, 0.03, 0.085, 0.068, M.dark, 0, -0.042, 0);
      box(mag, 0.036, 0.012, 0.074, M.poly, 0, -0.088, 0);
      box(g, 0.034, 0.11, 0.05, M.poly, 0, -0.08, 0.1, -0.35);
      triggerGuard(g, 0.04, -0.01, 0.06);
      cyl(g, 0.016, 0.17, M.metal, 0, 0.03, 0.2);
      box(g, 0.05, 0.08, 0.19, M.fde, 0, 0.008, 0.29);
      box(g, 0.042, 0.025, 0.13, M.fde, 0, 0.06, 0.28);
      box(g, 0.054, 0.09, 0.02, M.rubber, 0, 0.004, 0.39);
      prism(g, 0.118, -0.03);
      gripHand(g, 0, -0.07, 0.1);
      foreHand(g, -0.004, -0.002, -0.36);
      return { g, mag, muzzle: new THREE.Vector3(0, 0.035, -0.97), eject: new THREE.Vector3(0.03, 0.04, -0.02), sightY: 0.118, kick: 0.08 };
    }
    function makeSniper() {
      const g = new THREE.Group();
      cyl(g, 0.022, 0.22, M.metal, 0, 0.03, -0.02, 18);
      box(g, 0.004, 0.02, 0.07, M.dark, 0.022, 0.035, -0.0);
      const bolt = grp(g, 0.022, 0.03, 0.065);
      xcyl(bolt, 0.005, 0.05, M.steel, 0.025, 0, 0);
      P(bolt, new THREE.SphereGeometry(0.012, 12, 10), M.dark, 0.05, -0.006, 0);
      cyl(bolt, 0.012, 0.04, M.steel, -0.022, 0, 0.0, 14);
      cyl(g, 0.016, 0.68, M.dark, 0, 0.03, -0.46, 18);
      for (let i = 0; i < 6; i++) for (const s of [-1, 1]) box(g, 0.003, 0.004, 0.38, M.metal, s * 0.015, 0.03 + (i % 3 - 1) * 0.008, -0.44);
      box(g, 0.05, 0.03, 0.09, M.dark, 0, 0.03, -0.84);
      for (let i = 0; i < 3; i++) for (const s of [-1, 1]) box(g, 0.004, 0.018, 0.012, M.metal, s * 0.026, 0.03, -0.81 - i * 0.025);
      box(g, 0.064, 0.064, 0.42, M.fde, 0, -0.012, -0.24);
      box(g, 0.06, 0.06, 0.2, M.fde, 0, -0.02, 0.06);
      box(g, 0.036, 0.11, 0.05, M.fde, 0, -0.09, 0.1, -0.35);
      box(g, 0.056, 0.1, 0.06, M.fde, 0, -0.04, 0.3);
      box(g, 0.05, 0.06, 0.14, M.fde, 0, 0.0, 0.25);
      box(g, 0.046, 0.03, 0.12, M.od, 0, 0.044, 0.25);
      box(g, 0.058, 0.11, 0.022, M.rubber, 0, -0.03, 0.385);
      box(g, 0.054, 0.012, 0.16, M.fde, 0, -0.075, 0.2);
      triggerGuard(g, 0.04, -0.03, 0.06);
      const mag = grp(g, 0, -0.045, -0.05);
      box(mag, 0.034, 0.05, 0.08, M.dark, 0, -0.02, 0);
      // 瞄准镜
      const sy = 0.105;
      box(g, 0.03, 0.04, 0.02, M.dark, 0, 0.07, -0.1);
      box(g, 0.03, 0.04, 0.02, M.dark, 0, 0.07, 0.06);
      cyl(g, 0.024, 0.34, M.dark, 0, sy, -0.03, 22);
      P(g, new THREE.CylinderGeometry(0.038, 0.024, 0.06, 22), M.dark, 0, sy, -0.23, -Math.PI / 2);
      cyl(g, 0.038, 0.05, M.dark, 0, sy, -0.28, 22);
      P(g, new THREE.CylinderGeometry(0.024, 0.033, 0.05, 22), M.dark, 0, sy, 0.16, -Math.PI / 2);
      cyl(g, 0.033, 0.05, M.rubber, 0, sy, 0.21, 22);
      vcyl(g, 0.014, 0.03, M.metal, 0, sy + 0.035, -0.02, 16);
      xcyl(g, 0.014, 0.03, M.metal, 0.035, sy, -0.02, 16);
      xcyl(g, 0.011, 0.02, M.metal, -0.03, sy, -0.02, 16);
      P(g, new THREE.CircleGeometry(0.035, 24), M.lensFront, 0, sy, -0.306, 0, Math.PI);
      P(g, new THREE.CircleGeometry(0.03, 24), M.glass, 0, sy, 0.236);
      // 两脚架
      box(g, 0.03, 0.02, 0.04, M.dark, 0, -0.045, -0.42);
      box(g, 0.009, 0.009, 0.22, M.metal, -0.012, -0.058, -0.31);
      box(g, 0.009, 0.009, 0.22, M.metal, 0.012, -0.058, -0.31);
      gripHand(g, 0, -0.08, 0.1);
      foreHand(g, -0.004, -0.05, -0.3);
      return { g, bolt, mag, muzzle: new THREE.Vector3(0, 0.03, -0.9), eject: new THREE.Vector3(0.03, 0.04, 0.0), sightY: sy, kick: 0.1 };
    }
    function makeLMG() {
      const g = new THREE.Group();
      box(g, 0.07, 0.09, 0.32, M.metal, 0, 0.01, 0);
      box(g, 0.074, 0.03, 0.2, M.dark, 0, 0.07, -0.0);
      box(g, 0.004, 0.024, 0.08, M.dark, 0.037, 0.0, -0.02);
      // 提把
      box(g, 0.016, 0.012, 0.12, M.dark, 0, 0.12, -0.2);
      box(g, 0.016, 0.04, 0.014, M.dark, 0, 0.1, -0.25);
      box(g, 0.016, 0.04, 0.014, M.dark, 0, 0.1, -0.15);
      box(g, 0.064, 0.064, 0.24, M.poly, 0, 0.012, -0.28);
      vents(g, 5, 0.034, 0.012, -0.18, 0.045);
      cyl(g, 0.017, 0.44, M.dark, 0, 0.02, -0.46, 16);
      // 枪管上面的带孔隔热罩
      const shield = grp(g, 0, 0.05, -0.5);
      box(shield, 0.044, 0.008, 0.28, M.metal, 0, 0, 0);
      for (let i = 0; i < 9; i++) box(shield, 0.03, 0.009, 0.012, M.dark, 0, 0.001, -0.12 + i * 0.03);
      cyl(g, 0.024, 0.07, M.dark, 0, 0.02, -0.7, 16);
      for (let i = 0; i < 3; i++) box(g, 0.05, 0.005, 0.01, M.poly, 0, 0.02, -0.68 - i * 0.02);
      box(g, 0.012, 0.045, 0.012, M.dark, 0, 0.055, -0.64);
      // 弹箱和弹链
      const mag = grp(g, -0.03, -0.085, -0.05);
      box(mag, 0.1, 0.12, 0.13, M.od, 0, -0.03, 0);
      box(mag, 0.104, 0.012, 0.134, M.dark, 0, 0.03, 0);
      box(mag, 0.012, 0.03, 0.05, M.dark, -0.055, -0.02, 0);
      for (let i = 0; i < 7; i++) {
        const b = P(mag, new THREE.CylinderGeometry(0.0055, 0.0055, 0.045, 8), M.brass, 0.055 + i * 0.006, 0.04 + i * 0.008, 0, Math.PI / 2, 0, 0);
        b.rotation.z = 0.3;
      }
      box(g, 0.036, 0.11, 0.05, M.poly, 0, -0.08, 0.1, -0.35);
      triggerGuard(g, 0.04, -0.03, 0.06);
      box(g, 0.05, 0.05, 0.2, M.poly, 0, 0.0, 0.25);
      box(g, 0.02, 0.06, 0.07, M.poly, 0, -0.05, 0.3);
      box(g, 0.054, 0.1, 0.02, M.rubber, 0, -0.01, 0.36);
      // 两脚架（收着）
      box(g, 0.036, 0.022, 0.04, M.dark, 0, -0.01, -0.55);
      box(g, 0.009, 0.009, 0.24, M.metal, -0.014, -0.024, -0.44);
      box(g, 0.009, 0.009, 0.24, M.metal, 0.014, -0.024, -0.44);
      holo(g, 0.135, 0.02);
      box(g, 0.034, 0.03, 0.08, M.dark, 0, 0.098, 0.02);
      gripHand(g, 0, -0.07, 0.1);
      foreHand(g, -0.004, -0.024, -0.3);
      return { g, mag, muzzle: new THREE.Vector3(0, 0.02, -0.74), eject: new THREE.Vector3(0.04, 0.0, -0.02), sightY: 0.135, kick: 0.05 };
    }
    function makeLauncher() {
      const g = new THREE.Group();
      const drum = grp(g, 0, -0.01, -0.08);
      cyl(drum, 0.072, 0.12, M.od, 0, 0, 0, 24);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        cyl(drum, 0.019, 0.122, M.dark, Math.cos(a) * 0.045, Math.sin(a) * 0.045, 0, 14);
        box(drum, 0.01, 0.01, 0.1, M.metal, Math.cos(a + 0.52) * 0.072, Math.sin(a + 0.52) * 0.072, 0);
      }
      cyl(drum, 0.016, 0.13, M.metal, 0, 0, 0, 12);
      box(g, 0.03, 0.02, 0.32, M.metal, 0, 0.072, -0.12);
      box(g, 0.03, 0.02, 0.24, M.metal, 0, -0.085, -0.06);
      cyl(g, 0.032, 0.25, M.od, 0, 0.018, -0.3, 22);
      cyl(g, 0.036, 0.03, M.dark, 0, 0.018, -0.43, 22);
      P(g, new THREE.CircleGeometry(0.026, 18), M.dark, 0, 0.018, -0.446, 0, Math.PI);
      box(g, 0.03, 0.09, 0.034, M.poly, 0, -0.04, -0.3);
      box(g, 0.036, 0.11, 0.05, M.poly, 0, -0.1, 0.06, -0.3);
      triggerGuard(g, 0.02, -0.05, 0.06);
      box(g, 0.06, 0.06, 0.07, M.metal, 0, 0.0, 0.03);
      box(g, 0.012, 0.012, 0.22, M.metal, 0, 0.02, 0.17);
      box(g, 0.012, 0.012, 0.22, M.metal, 0, -0.04, 0.17);
      box(g, 0.05, 0.09, 0.02, M.rubber, 0, -0.01, 0.28);
      // 梯形表尺
      box(g, 0.04, 0.006, 0.006, M.dark, 0, 0.11, -0.02);
      box(g, 0.004, 0.04, 0.006, M.dark, -0.018, 0.092, -0.02);
      box(g, 0.004, 0.04, 0.006, M.dark, 0.018, 0.092, -0.02);
      box(g, 0.02, 0.004, 0.006, M.dark, 0, 0.082, -0.02);
      P(g, new THREE.SphereGeometry(0.004, 8, 6), M.tritium, 0, 0.094, -0.02);
      gripHand(g, 0, -0.09, 0.065);
      foreHand(g, 0, -0.06, -0.3).rotation.x = 0.6;
      return { g, drum, muzzle: new THREE.Vector3(0, 0.018, -0.45), eject: null, sightY: 0.094, kick: 0.13 };
    }
    function makeRocket() {
      const g = new THREE.Group();
      cyl(g, 0.072, 0.95, M.od, 0, 0, -0.1, 24);
      for (let i = 0; i < 3; i++) cyl(g, 0.075, 0.025, M.dark, 0, 0, -0.45 + i * 0.3, 24);
      cyl(g, 0.083, 0.07, M.dark, 0, 0, -0.58, 24);
      P(g, new THREE.CylinderGeometry(0.1, 0.075, 0.12, 24, 1, true), M.dark, 0, 0, 0.42, Math.PI / 2);
      cyl(g, 0.074, 0.12, M.rubber, 0, -0.01, 0.12, 24);
      const head = grp(g, 0, 0, -0.66);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 18), M.warhead); cone.rotation.x = -Math.PI / 2; cone.position.z = -0.1; head.add(cone);
      cyl(head, 0.062, 0.08, M.warhead, 0, 0, 0.03, 18);
      cyl(head, 0.012, 0.05, M.steel, 0, 0, -0.23, 8);
      for (let i = 0; i < 4; i++) box(head, 0.004, 0.04, 0.04, M.dark, 0, 0, 0.05).rotation.z = i * Math.PI / 2;
      box(g, 0.036, 0.13, 0.055, M.poly, 0, -0.13, 0.02, -0.25);
      triggerGuard(g, 0.0, -0.06, 0.07);
      box(g, 0.036, 0.12, 0.05, M.poly, 0, -0.12, -0.3, -0.2);
      // 左边的瞄准具
      box(g, 0.03, 0.03, 0.06, M.dark, -0.09, 0.05, -0.18);
      box(g, 0.04, 0.05, 0.1, M.poly, -0.09, 0.09, -0.18);
      P(g, new THREE.CircleGeometry(0.016, 18), M.glass, -0.09, 0.095, -0.129);
      P(g, new THREE.CircleGeometry(0.018, 18), M.lensFront, -0.09, 0.095, -0.231, 0, Math.PI);
      dot(g, 0xff3030, 0.01, -0.09, 0.095, -0.2);
      gripHand(g, 0, -0.14, 0.03, -0.25);
      foreHand(g, 0, -0.1, -0.3).rotation.x = 0.6;
      return { g, head, muzzle: new THREE.Vector3(0, 0, -0.8), eject: null, sightY: 0.095, sightX: -0.09, kick: 0.15 };
    }

    const makers = { pistol: makePistol, smg: makeSMG, rifle: makeRifle, shotgun: makeShotgun, dmr: makeDMR, sniper: makeSniper, lmg: makeLMG, launcher: makeLauncher, rocket: makeRocket };
    const models = WEAPONS.map(W => {
      const m = makers[W.id]();
      // 记住会动的零件原来的位置，换弹/拉栓动画从这里出发
      for (const k of ['mag', 'slide', 'bolt', 'pump', 'drum']) if (m[k]) m[k].userData.base = m[k].position.clone();
      m.g.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
      return m;
    });
    return { WEAPONS, models, M };
  }

  return { WEAPONS, build };
})();
