// 静态几何合批：把成千上万个静态构件（货架立柱、横梁、钢结构…）按材质合并成少量网格
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

const geoCache = new Map();
function cached(key, make) {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    if (g.index) g = g.toNonIndexed();
    // 统一属性集合（合并要求一致）
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    geoCache.set(key, g);
  }
  return g;
}

export class Batcher {
  constructor() {
    this.buckets = new Map(); // key -> { material, cast, receive, geos: [] }
  }

  add(geometry, material, matrix, { cast = true, receive = true } = {}) {
    const key = material.uuid + (cast ? 'c' : '') + (receive ? 'r' : '');
    let b = this.buckets.get(key);
    if (!b) {
      b = { material, cast, receive, geos: [] };
      this.buckets.set(key, b);
    }
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    g.morphAttributes = {};
    g.applyMatrix4(matrix);
    b.geos.push(g);
  }

  // 便捷：按 位置/欧拉角/缩放 放置一个几何体
  place(geometry, material, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, opts) {
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    this.add(geometry, material, _m, opts);
  }

  // 尺寸为 w×h×d、中心在 (x,y,z) 的盒子，可绕 y 旋转
  box(material, w, h, d, x, y, z, ry = 0, opts) {
    const g = cached('box', () => new THREE.BoxGeometry(1, 1, 1));
    this.place(g, material, x, y, z, 0, ry, 0, w, h, d, opts);
  }

  // 两点之间的方截面杆件（斜撑、桁架腹杆等）
  beam(material, a, b, w, h = w, opts) {
    const g = cached('box', () => new THREE.BoxGeometry(1, 1, 1));
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
    _s.set(w, h, len);
    _m.compose(mid, _q, _s);
    this.add(g, material, _m, opts);
  }

  // 竖直圆柱；axis: 'y' | 'x' | 'z'
  cyl(material, radius, length, x, y, z, axis = 'y', seg = 16, opts) {
    const g = cached('cyl' + seg, () => new THREE.CylinderGeometry(1, 1, 1, seg));
    const rx = axis === 'z' ? Math.PI / 2 : 0;
    const rz = axis === 'x' ? Math.PI / 2 : 0;
    this.place(g, material, x, y, z, rx, 0, rz, radius, length, radius, opts);
  }

  // 工字钢立柱（H 型截面），沿 y
  hColumn(material, x, y0, y1, z, size = 0.36, ry = 0, opts) {
    const h = y1 - y0, y = (y0 + y1) / 2;
    const tf = 0.03, tw = 0.02;
    const c = Math.cos(ry), s = Math.sin(ry);
    // 两块翼缘 + 腹板
    for (const side of [-1, 1]) {
      const ox = side * (size / 2 - tf / 2);
      this.box(material, tf, h, size, x + ox * c, y, z - ox * s, ry, opts);
    }
    this.box(material, size - 2 * tf, h, tw, x, y, z, ry, opts);
  }

  flush(parent) {
    const meshes = [];
    for (const b of this.buckets.values()) {
      if (!b.geos.length) continue;
      const merged = mergeGeometries(b.geos, false);
      for (const g of b.geos) g.dispose();
      const mesh = new THREE.Mesh(merged, b.material);
      mesh.castShadow = b.cast;
      mesh.receiveShadow = b.receive;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.buckets.clear();
    return meshes;
  }
}

export function cachedGeometry(key, make) {
  return cached(key, make);
}
