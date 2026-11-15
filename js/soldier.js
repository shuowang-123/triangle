// 真人士兵模型：用 models/soldier-model.js 里的骨骼动画模型（Mixamo 角色，带 Idle / Walk / Run 动作）
// 替换 humans.js 里的程序化人物。模型没加载好之前，还是用程序化人物顶上。
// 敌我靠颜色和面罩灯区分：队友沙色 + 青色面罩，坏蛋深灰 + 红色面罩。
(function () {
  const H = window.Humans;
  if (!H || !window.THREE || !THREE.GLTFLoader || !THREE.SkeletonUtils || !window.SOLDIER_GLB) return;
  const makeProc = H.make, animProc = H.animate;

  let tpl = null, clips = null;
  const waiting = [];
  const STYLE = {
    ally:    { tint: 0xffffff, visor: 0x22e0ff },
    hostage: { tint: 0xe8dcc0, visor: 0x22e0ff },
    grunt:   { tint: 0x727c8c, visor: 0xff2a1a },
    runner:  { tint: 0xa8705a, visor: 0xff6a00 },
    heavy:   { tint: 0x5c6152, visor: 0xffa000 },
    boss:    { tint: 0x4a4a55, visor: 0xffd23a },
  };

  try {
    const bin = Uint8Array.from(atob(window.SOLDIER_GLB), c => c.charCodeAt(0)).buffer;
    new THREE.GLTFLoader().parse(bin, '', g => {
      tpl = g.scene; clips = {};
      g.animations.forEach(a => { clips[a.name] = a; });
      tpl.updateMatrixWorld(true);
      const b = name => tpl.getObjectByName('mixamorig' + name);
      const p = n => b(n).getWorldPosition(new THREE.Vector3());
      const head = p('Head'), foot = p('LeftToeBase');
      tpl.userData.height = (head.y - foot.y) / 0.9; // 头部骨骼大约在身高 90% 的位置
      waiting.splice(0).forEach(f => f());
    }, e => console.warn('soldier model failed', e));
  } catch (e) { console.warn('soldier model failed', e); }

  const Y = new THREE.Vector3(0, 1, 0);
  const _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qg = new THREE.Quaternion();
  const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _t = new THREE.Vector3();

  // 让骨骼（沿自身 +Y 方向）指向世界坐标里的一个方向
  function point(bone, dir) {
    bone.parent.getWorldQuaternion(_qp);
    _q.setFromUnitVectors(Y, dir);
    bone.quaternion.copy(_qp.invert().multiply(_q));
    bone.updateMatrixWorld(true);
  }
  // 两节骨骼的简单 IK：把手放到目标点上，pole 决定手肘朝哪边
  function reach(v, upper, fore, hand, target, poleLocal) {
    upper.getWorldPosition(_s); fore.getWorldPosition(_e); hand.getWorldPosition(_t);
    const a = _s.distanceTo(_e), b = _e.distanceTo(_t);
    _d.subVectors(target, _s);
    let d = _d.length();
    d = Math.min(Math.max(d, Math.abs(a - b) + 0.01), (a + b) * 0.999);
    _d.normalize();
    const cosA = (a * a + d * d - b * b) / (2 * a * d), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    _p.copy(poleLocal).applyQuaternion(_qg);
    _p.addScaledVector(_d, -_p.dot(_d)).normalize();
    _e.copy(_s).addScaledVector(_d, a * cosA).addScaledVector(_p, a * sinA);
    point(upper, _v.subVectors(_e, _s).normalize());
    fore.getWorldPosition(_e);
    _t.copy(_s).addScaledVector(_d, d);
    point(fore, _v.subVectors(_t, _e).normalize());
    point(hand, _v);
  }

  const POLE_R = new THREE.Vector3(-0.5, -1, -0.3), POLE_L = new THREE.Vector3(0.7, -1, -0.2);

  function make(kind) {
    if (!tpl || !STYLE[kind]) return makeProc(kind);
    const st = STYLE[kind];
    const g = new THREE.Group();
    const model = THREE.SkeletonUtils.clone(tpl);
    const k = 1.8 / tpl.userData.height;
    model.scale.multiplyScalar(k);
    model.rotation.y = Math.PI; // 模型原本朝 -Z，游戏里人物朝 +Z
    g.add(model);
    const flashMats = [];
    model.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.frustumCulled = false;
      const m = o.material.clone();
      if (/visor/i.test(o.name)) { m.emissive.setHex(st.visor); m.emissiveIntensity = 0.9; m.color.setHex(0x222222); m.roughness = 0.2; m.metalness = 0.6; }
      else { m.color.setHex(st.tint); m.roughness = Math.max(m.roughness, 0.7); flashMats.push(m); }
      o.material = m;
    });
    const bone = n => model.getObjectByName('mixamorig' + n);
    const mixer = new THREE.AnimationMixer(model);
    const act = {};
    ['Idle', 'Walk', 'Run'].forEach(n => { act[n] = mixer.clipAction(clips[n]); act[n].play(); act[n].setEffectiveWeight(n === 'Idle' ? 1 : 0); act[n].time = Math.random() * clips[n].duration; });
    const v = {
      g, kind, flashMats, model, mixer, act,
      phase: 0, armed: kind !== 'runner' && kind !== 'hostage', gltf: true,
      baseColor: st.tint,
      bones: {
        spine: bone('Spine2'),
        rArm: bone('RightArm'), rFore: bone('RightForeArm'), rHand: bone('RightHand'),
        lArm: bone('LeftArm'), lFore: bone('LeftForeArm'), lHand: bone('LeftHand'),
      },
    };
    if (v.armed) {
      const rifle = H.npcRifle(kind === 'heavy' || kind === 'boss');
      g.add(rifle); v.rifle = rifle;
    }
    animate(v, 0, 0);
    return v;
  }

  function animate(v, dt, speed) {
    if (!v.gltf) return animProc(v, dt, speed);
    const w = v.act;
    const sp = v.kind === 'hostage' ? 0 : speed;
    const walk = sp > 0.3 ? Math.max(0, 1 - Math.max(0, sp - 2.2) / 1.8) : 0;
    const run = sp > 0.3 ? 1 - walk : 0;
    const idle = sp > 0.3 ? 0 : 1;
    // 平滑过渡
    const f = Math.min(1, dt * 8);
    v.wI = (v.wI ?? idle) + (idle - (v.wI ?? idle)) * f;
    v.wW = (v.wW ?? walk) + (walk - (v.wW ?? walk)) * f;
    v.wR = (v.wR ?? run) + (run - (v.wR ?? run)) * f;
    w.Idle.setEffectiveWeight(v.wI); w.Walk.setEffectiveWeight(v.wW); w.Run.setEffectiveWeight(v.wR);
    w.Walk.timeScale = Math.max(0.6, sp / 1.4);
    w.Run.timeScale = Math.max(0.8, sp / 4.2);
    v.mixer.update(dt);
    if (!v.armed) return;
    // 双手端枪：枪跟着胸口走，手用 IK 抓在枪上
    const B = v.bones, g = v.g;
    g.updateMatrixWorld(true);
    g.getWorldQuaternion(_qg);
    const chest = B.spine.getWorldPosition(new THREE.Vector3());
    g.worldToLocal(chest);
    const r = v.rifle;
    r.position.set(chest.x - 0.13, chest.y + 0.02, chest.z + 0.3);
    r.rotation.set(0, 0, 0);
    r.updateMatrixWorld(true);
    const grip = r.localToWorld(new THREE.Vector3(0, -0.07, -0.06));
    const fore = r.localToWorld(new THREE.Vector3(0, -0.03, 0.22));
    reach(v, B.rArm, B.rFore, B.rHand, grip, POLE_R);
    reach(v, B.lArm, B.lFore, B.lHand, fore, POLE_L);
  }

  H.make = make;
  H.animate = animate;
  H.modelReady = () => !!tpl;
  H.onReady = f => { if (tpl) f(); else waiting.push(f); };
})();
