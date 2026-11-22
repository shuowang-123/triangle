// 碰撞：地形高度 + 盒子（可以旋转）+ 圆柱，用网格加速查询
(function () {
  'use strict';
  const CELL = 8;
  function create(size, heightAt) {
    const half = size / 2, N = Math.ceil(size / CELL);
    const grid = new Array(N * N);
    const all = [];
    let stamp = 1;
    const cellOf = v => Math.max(0, Math.min(N - 1, Math.floor((v + half) / CELL)));
    function insert(o) {
      const r = o.br;
      o.cells = [];
      const x0 = cellOf(o.x - r), x1 = cellOf(o.x + r), z0 = cellOf(o.z - r), z1 = cellOf(o.z + r);
      for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
        const k = j * N + i;
        (grid[k] || (grid[k] = [])).push(o);
        o.cells.push(k);
      }
      o._s = 0;
      all.push(o);
      return o;
    }
    // 盒子：中心 (x, z)，底 y0，高 h，半宽 hx / hz，转角 yaw
    function box(x, z, y0, h, hx, hz, yaw, kind, data) {
      yaw = yaw || 0;
      return insert(Object.assign({ type: 'box', x, z, y0, h, top: y0 + h, hx, hz, yaw, c: Math.cos(yaw), s: Math.sin(yaw), br: Math.hypot(hx, hz), kind: kind || 'box' }, data || {}));
    }
    function cyl(x, z, y0, h, r, kind, data) {
      return insert(Object.assign({ type: 'cyl', x, z, y0, h, top: y0 + h, r, br: r, kind: kind || 'cyl' }, data || {}));
    }
    function remove(o) {
      if (!o || !o.cells) return;
      for (const k of o.cells) { const a = grid[k]; const i = a ? a.indexOf(o) : -1; if (i >= 0) a.splice(i, 1); }
      o.cells = null;
      const i = all.indexOf(o); if (i >= 0) all.splice(i, 1);
      o.dead = true;
    }
    function clear() { for (let i = 0; i < grid.length; i++) grid[i] = null; all.length = 0; }
    // 附近的碰撞体（去重）
    const near = [];
    function query(x, z, r) {
      near.length = 0; stamp++;
      const x0 = cellOf(x - r), x1 = cellOf(x + r), z0 = cellOf(z - r), z1 = cellOf(z + r);
      for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
        const a = grid[j * N + i]; if (!a) continue;
        for (const o of a) if (o._s !== stamp) { o._s = stamp; near.push(o); }
      }
      return near;
    }
    // 把一个圆（人）从碰撞体里推出来；feetY / headY 决定能不能从上面走过去
    function pushOut(p, r, feetY, tall) {
      const fy = feetY == null ? -1e9 : feetY, hy = fy + (tall || 1.7);
      const list = query(p.x, p.z, r + 1);
      for (const o of list) {
        if (fy > o.top - 0.4 || hy < o.y0) continue;
        if (o.type === 'cyl') {
          const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), rr = o.r + r;
          if (d < rr) { if (d > 1e-5) { p.x = o.x + dx / d * rr; p.z = o.z + dz / d * rr; } else p.x += rr; }
          continue;
        }
        const dx = p.x - o.x, dz = p.z - o.z;
        const lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c;
        const cx = Math.max(-o.hx, Math.min(o.hx, lx)), cz = Math.max(-o.hz, Math.min(o.hz, lz));
        let ex = lx - cx, ez = lz - cz;
        const d2 = ex * ex + ez * ez;
        if (d2 >= r * r) continue;
        let nlx, nlz;
        if (d2 > 1e-10) { const d = Math.sqrt(d2); nlx = cx + ex / d * r; nlz = cz + ez / d * r; }
        else {
          const px = o.hx - Math.abs(lx), pz = o.hz - Math.abs(lz);
          if (px < pz) { nlx = (lx >= 0 ? 1 : -1) * (o.hx + r); nlz = lz; } else { nlz = (lz >= 0 ? 1 : -1) * (o.hz + r); nlx = lx; }
        }
        p.x = o.x + nlx * o.c + nlz * o.s;
        p.z = o.z - nlx * o.s + nlz * o.c;
      }
    }
    // 脚下最高的面（地形或者箱子顶）
    function groundAt(x, z, r, feetY) {
      let h = heightAt(x, z);
      const list = query(x, z, r + 0.5);
      for (const o of list) {
        if (o.noTop || feetY < o.top - 0.45 || o.top <= h) continue;
        if (o.type === 'cyl') { if (Math.hypot(x - o.x, z - o.z) < o.r + r * 0.5) h = o.top; continue; }
        const dx = x - o.x, dz = z - o.z;
        const lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c;
        if (Math.abs(lx) < o.hx + r * 0.5 && Math.abs(lz) < o.hz + r * 0.5) h = o.top;
      }
      return h;
    }
    function inside(p, pad) {
      pad = pad || 0;
      const list = query(p.x, p.z, 1);
      for (const o of list) {
        if (p.y < o.y0 - pad || p.y > o.top + pad) continue;
        if (o.type === 'cyl') { if (Math.hypot(p.x - o.x, p.z - o.z) < o.r + pad) return o; continue; }
        const dx = p.x - o.x, dz = p.z - o.z;
        const lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c;
        if (Math.abs(lx) < o.hx + pad && Math.abs(lz) < o.hz + pad) return o;
      }
      return null;
    }
    // 射线 vs 一个碰撞体，返回距离（没打到返回 -1），并写入法线
    const nrm = new THREE.Vector3();
    function rayOne(o, ox, oy, oz, dx, dy, dz, maxT, outN) {
      if (o.type === 'cyl') {
        const px = ox - o.x, pz = oz - o.z;
        const a = dx * dx + dz * dz, b = px * dx + pz * dz, c = px * px + pz * pz - o.r * o.r;
        let t = -1;
        if (c < 0) { t = 0; } else if (a > 1e-9) {
          const disc = b * b - a * c; if (disc < 0) return -1;
          t = (-b - Math.sqrt(disc)) / a;
        } else return -1;
        if (t < 0 || t > maxT) return -1;
        const y = oy + dy * t;
        if (y >= o.y0 && y <= o.top) { if (outN) outN.set(px + dx * t, 0, pz + dz * t).normalize(); return t; }
        // 打到顶面
        if (dy < 0 && oy > o.top) { const tt = (o.top - oy) / dy; const hx = px + dx * tt, hz = pz + dz * tt; if (tt <= maxT && hx * hx + hz * hz < o.r * o.r) { if (outN) outN.set(0, 1, 0); return tt; } }
        return -1;
      }
      const qx = ox - o.x, qz = oz - o.z;
      const lox = qx * o.c - qz * o.s, loz = qx * o.s + qz * o.c;
      const ldx = dx * o.c - dz * o.s, ldz = dx * o.s + dz * o.c;
      let t0 = 0, t1 = maxT, ax = 0;
      // x
      if (Math.abs(ldx) < 1e-9) { if (lox < -o.hx || lox > o.hx) return -1; }
      else { let a = (-o.hx - lox) / ldx, b = (o.hx - lox) / ldx; if (a > b) { const t = a; a = b; b = t; } if (a > t0) { t0 = a; ax = 0; } if (b < t1) t1 = b; if (t0 > t1) return -1; }
      if (Math.abs(dy) < 1e-9) { if (oy < o.y0 || oy > o.top) return -1; }
      else { let a = (o.y0 - oy) / dy, b = (o.top - oy) / dy; if (a > b) { const t = a; a = b; b = t; } if (a > t0) { t0 = a; ax = 1; } if (b < t1) t1 = b; if (t0 > t1) return -1; }
      if (Math.abs(ldz) < 1e-9) { if (loz < -o.hz || loz > o.hz) return -1; }
      else { let a = (-o.hz - loz) / ldz, b = (o.hz - loz) / ldz; if (a > b) { const t = a; a = b; b = t; } if (a > t0) { t0 = a; ax = 2; } if (b < t1) t1 = b; if (t0 > t1) return -1; }
      if (outN) {
        if (ax === 1) outN.set(0, dy > 0 ? -1 : 1, 0);
        else {
          let nlx = 0, nlz = 0;
          if (ax === 0) nlx = ldx > 0 ? -1 : 1; else nlz = ldz > 0 ? -1 : 1;
          outN.set(nlx * o.c + nlz * o.s, 0, -nlx * o.s + nlz * o.c);
        }
      }
      return t0;
    }
    // 地形：一步一步往前走，找到穿过地面的位置
    function rayTerrain(ox, oy, oz, dx, dy, dz, maxT, step) {
      step = step || 1.5;
      let prevT = 0, prevD = oy - heightAt(ox, oz);
      if (prevD < 0) return 0;
      for (let t = step; t <= maxT + step; t += step) {
        const tt = Math.min(t, maxT);
        const y = oy + dy * tt, d = y - heightAt(ox + dx * tt, oz + dz * tt);
        if (d < 0) {
          let a = prevT, b = tt;
          for (let k = 0; k < 6; k++) { const m = (a + b) / 2; if (oy + dy * m - heightAt(ox + dx * m, oz + dz * m) < 0) b = m; else a = m; }
          return (a + b) / 2;
        }
        prevT = tt; prevD = d;
        // 离地很高、又在往上走，就可以大步走
        if (d > 30 && dy > 0.2) break;
        if (tt >= maxT) break;
      }
      return -1;
    }
    const hit = { t: 0, ob: null, n: new THREE.Vector3(), terrain: false };
    const tmpN = new THREE.Vector3();
    function ray(o, d, maxT, opts) {
      let best = maxT, bestO = null, terr = false;
      const st = opts && opts.step;
      const tt = rayTerrain(o.x, o.y, o.z, d.x, d.y, d.z, maxT, st);
      if (tt >= 0 && tt < best) { best = tt; terr = true; }
      // 沿着射线经过的格子查碰撞体
      stamp++;
      const len = best;
      const steps = Math.ceil(len / (CELL * 0.5)) + 1;
      for (let k = 0; k <= steps; k++) {
        const t = Math.min(len, k * CELL * 0.5);
        if (t > best + CELL) break;
        const px = o.x + d.x * t, pz = o.z + d.z * t;
        const ci = cellOf(px), cj = cellOf(pz);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const i = ci + a, j = cj + b; if (i < 0 || j < 0 || i >= N || j >= N) continue;
          const arr = grid[j * N + i]; if (!arr) continue;
          for (const ob of arr) {
            if (ob._s === stamp) continue; ob._s = stamp;
            if (opts && opts.ignore && opts.ignore(ob)) continue;
            const t2 = rayOne(ob, o.x, o.y, o.z, d.x, d.y, d.z, best, tmpN);
            if (t2 >= 0 && t2 < best) { best = t2; bestO = ob; terr = false; hit.n.copy(tmpN); }
          }
        }
      }
      hit.t = best; hit.ob = bestO; hit.terrain = terr;
      if (terr) hit.n.set(0, 1, 0);
      return hit;
    }
    const losD = new THREE.Vector3();
    function los(a, b, step) {
      losD.copy(b).sub(a);
      const l = losD.length();
      if (l < 0.01) return true;
      losD.divideScalar(l);
      return ray(a, losD, l, { step: step || 3 }).t >= l - 0.3;
    }
    return { box, cyl, remove, clear, query, pushOut, groundAt, inside, ray, los, all, CELL };
  }
  window.TSPhysics = { create };
})();
