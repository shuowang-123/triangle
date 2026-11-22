// 把一张地图整个搭起来：地形、天空、树、草、石头、建筑、湖水、碰撞
// TSWorld.load(renderer, scene, mapId, {sky, quality, onStep}) -> world
(function () {
  'use strict';
  const QUAL = {
    high: { res: 1024, texRes: 512, trees: 1, grass: 1, rocks: 1, tq: 'high', lod: [150, 330, 650], treeDist: 900, a2c: true },
    medium: { res: 1024, texRes: 512, trees: 0.7, grass: 0.7, rocks: 0.8, tq: 'medium', lod: [120, 260, 520], treeDist: 650, a2c: true },
    low: { res: 512, texRes: 256, trees: 0.45, grass: 0.45, rocks: 0.6, tq: 'low', lod: [90, 200, 420], treeDist: 420, a2c: false },
  };
  const tick = () => new Promise(r => setTimeout(r, 0));

  // 湖水：很光滑，反射天空，表面有慢慢流动的小波纹
  function makeWater(map, sky) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x1b3238, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.9, envMapIntensity: 1.2 });
    const uT = { value: 0 };
    mat.onBeforeCompile = sh => {
      sh.uniforms.uT = uT;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vWP; uniform float uT;
        vec2 wv(vec2 p, float t) {
          vec2 g = vec2(0.0);
          g += vec2(cos(p.x * 0.9 + t * 1.1), cos(p.y * 0.7 + t * 0.9)) * 0.10;
          g += vec2(cos(dot(p, vec2(1.7, 1.1)) + t * 1.7)) * vec2(1.7, 1.1) * 0.05;
          g += vec2(cos(dot(p, vec2(-2.3, 3.1)) + t * 2.3)) * vec2(-2.3, 3.1) * 0.025;
          g += vec2(cos(dot(p, vec2(5.1, -4.3)) + t * 3.1)) * vec2(5.1, -4.3) * 0.010;
          return g;
        }`).replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 g = wv(vWP.xz * 0.8, uT) + wv(vWP.xz * 2.3 + 7.0, uT * 1.3) * 0.5;
          float fade = 1.0 - smoothstep(30.0, 250.0, length(vViewPosition));
          vec3 nW = normalize(vec3(-g.x * fade, 1.0, -g.y * fade));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }`).replace('#include <dithering_fragment>', `#include <dithering_fragment>
        {
          float fres = pow(1.0 - clamp(dot(normalize(vViewPosition), -normal) * -1.0, 0.0, 1.0), 4.0);
          gl_FragColor.a = mix(0.82, 1.0, fres);
        }`);
    };
    const r = map.lake.r * 2.6;
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 64), mat);
    m.rotation.x = -Math.PI / 2; m.position.set(map.lake.x, map.water, map.lake.z);
    m.receiveShadow = true;
    m.userData.tick = t => { uT.value = t; };
    return m;
  }

  async function load(renderer, scene, mapId, o) {
    o = o || {};
    const Q = QUAL[o.quality] || QUAL.high;
    const step = async (msg, k) => { if (o.onStep) o.onStep(msg, k); await tick(); };
    const map = TSMaps.get(mapId);
    await step('素材', 0.05);
    for (const p of map.packs) await TSAssets.loadPack(p);
    const root = new THREE.Group(); root.name = 'world';
    scene.add(root);
    await step('天空', 0.2);
    const sky = TSSky.create(renderer, scene, o.sky || 'day');
    await step('地形', 0.25);
    const terrain = TSTerrain.create({ size: map.size, res: Q.res, texRes: Q.texRes, height: map.height, post: map.post, far: map.far, splat: map.splat, wet: map.wet, sunDir: sky.lightDir, layers: map.layers, quality: Q.tq, lodDist: Q.lod });
    root.add(terrain.group);
    const phys = TSPhysics.create(map.size, terrain.heightAt);
    await step('建筑', 0.5);
    const B = TSBuild.create(root, terrain, phys, { envK: sky.envIntensity });
    const spots = map.layout(B, terrain);
    await step('树林', 0.65);
    const rnd = TSNoise.mulberry(5);
    const sct = map.scatter(terrain, rnd, Q.trees);
    if (Q.rocks < 1) sct.rocks = sct.rocks.filter((_, i) => (i % 10) < Q.rocks * 10);
    const forest = TSFlora.makeForest(root, terrain, sct.trees, { a2c: Q.a2c });
    await step('石头', 0.75);
    const rocks = await TSFlora.makeRocks(root, terrain, phys, sct.rocks);
    // 树干也要挡人、挡子弹
    for (const t of sct.trees) phys.cyl(t.x, t.z, terrain.heightAt(t.x, t.z) - 1, 14, 0.32 * t.s, 'tree');
    await TSFlora.makeProps(root, terrain, phys, sct.props);
    await step('草地', 0.85);
    const carpetDefs = map.carpet.map(d => Object.assign({}, d, { max: Math.round(d.max * Q.grass) }));
    const carpet = await TSFlora.makeCarpet(root, terrain, carpetDefs, { a2c: Q.a2c, radiusK: Math.sqrt(Q.grass) });
    let water = null;
    if (map.lake) { water = makeWater(map, sky); root.add(water); }
    B.finish();
    await B.finishProps();
    await step('贴图', 0.95);
    await TSAssets.ready();
    root.traverse(c => { if (c.material && !c.material.isShaderMaterial && c.material.envMapIntensity !== undefined && c !== water) c.material.envMapIntensity = sky.envIntensity; });
    void rocks;
    const W = {
      id: mapId, map, root, sky, terrain, phys, B, spots, forest, carpet, water, Q,
      heightAt: terrain.heightAt,
      bounds: map.bounds,
      update(cam, t) {
        terrain.update(cam.position);
        sky.update(cam);
        carpet.update(cam.position, t);
        forest.update(cam.position, Q.treeDist);
        if (water) water.userData.tick(t);
        TSFlora.windUni.uTime.value = t;
      },
      warm(x, z) { terrain.warm(x, z); carpet.force(); },
      dispose() {
        scene.remove(root);
        sky.dispose();
        root.traverse(c => { if (c.geometry && !c.isSkinnedMesh) c.geometry.dispose(); if (c.isInstancedMesh) c.dispose(); });
      },
    };
    return W;
  }
  window.TSWorld = { load, QUAL };
})();
