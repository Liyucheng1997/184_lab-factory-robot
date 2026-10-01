// 托盘单元（LPN）：塑料川字托盘 + 定位工装 + 4 件工件（毛坯/成品）
// 局部坐标：+z 为移载方向(长 1.0 m)，x 为宽(0.8 m)，原点在托盘底面中心
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LOAD } from '../config.js';
import { M } from '../core/materials.js';

const PALLET_H = LOAD.PALLET_H;
const FIX_H = 0.05;
export const PART_BASE_Y = PALLET_H + FIX_H;
export const PART_SLOTS = [
  [-0.19, -0.24], [0.19, -0.24], [-0.19, 0.24], [0.19, 0.24],
];
const PART = { w: 0.26, h: 0.2, d: 0.3 };

function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function boxAt(w, h, d, x, y, z, hex) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return colored(g, hex);
}

// 托盘 + 工装 合并为一个顶点色网格
const baseGeo = (() => {
  const parts = [];
  const blue = 0x23528c, dark = 0x1b3f6b, fix = 0x4b525a, pin = 0xc9ced3;
  parts.push(boxAt(LOAD.W, 0.035, LOAD.L, 0, PALLET_H - 0.0175, 0, blue));             // 面板
  for (const x of [-0.33, 0, 0.33]) {
    parts.push(boxAt(0.12, 0.022, LOAD.L, x, 0.011, 0, dark));                         // 底部川字
    for (const z of [-0.42, 0, 0.42]) parts.push(boxAt(0.12, PALLET_H - 0.057, 0.14, x, 0.022 + (PALLET_H - 0.057) / 2, z, blue));
  }
  parts.push(boxAt(0.7, FIX_H, 0.9, 0, PALLET_H + FIX_H / 2, 0, fix));                 // 工装板
  for (const [x, z] of PART_SLOTS) {
    for (const s of [-1, 1]) parts.push(boxAt(0.03, 0.04, 0.03, x + s * 0.15, PART_BASE_Y + 0.02, z + s * 0.17, pin));
  }
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return g;
})();
const baseMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.25 });

function rawPartGeo() {
  const g = new THREE.BoxGeometry(PART.w, PART.h, PART.d);
  g.translate(0, PART.h / 2, 0);
  return g;
}
function donePartGeo() {
  // 机加后：倒角外形 + 顶部凸台 + 孔位（简化为圆柱）
  const body = new THREE.BoxGeometry(PART.w - 0.02, PART.h - 0.03, PART.d - 0.02);
  body.translate(0, (PART.h - 0.03) / 2, 0);
  const boss = new THREE.CylinderGeometry(0.075, 0.075, 0.04, 24);
  boss.translate(0, PART.h - 0.03 + 0.02, 0);
  const boss2 = new THREE.CylinderGeometry(0.03, 0.03, 0.05, 16);
  boss2.translate(0, PART.h - 0.03 + 0.045, 0);
  const g = mergeGeometries([body.toNonIndexed(), boss.toNonIndexed(), boss2.toNonIndexed()], false);
  return g;
}
const PART_GEO = { raw: rawPartGeo(), done: donePartGeo() };
const PART_MAT = { raw: M.rawPart, done: M.donePart };

function mergedParts(kind) {
  const list = PART_SLOTS.map(([x, z]) => {
    const g = PART_GEO[kind].index ? PART_GEO[kind].toNonIndexed() : PART_GEO[kind].clone();
    g.translate(x, PART_BASE_Y, z);
    return g;
  });
  return mergeGeometries(list, false);
}
const MERGED = { raw: mergedParts('raw'), done: mergedParts('done') };

let SEQ = 1;

export class Load {
  constructor(kind = 'raw') {
    this.id = 'LPN' + String(100000 + SEQ++);
    this.kind = kind;
    this.group = new THREE.Group();
    this.group.name = this.id;
    this.base = new THREE.Mesh(baseGeo, baseMat);
    this.base.castShadow = true;
    this.base.receiveShadow = true;
    this.group.add(this.base);
    this.merged = new THREE.Mesh(MERGED[kind], PART_MAT[kind]);
    this.merged.castShadow = true;
    this.group.add(this.merged);
    this.parts = null;
    this.created = 0;
    this.history = [];
  }

  // 拆分为 4 个独立工件网格（供机器人逐件抓取）
  explode() {
    if (this.parts) return;
    this.group.remove(this.merged);
    this.parts = PART_SLOTS.map(([x, z]) => {
      const m = new THREE.Mesh(PART_GEO[this.kind], PART_MAT[this.kind]);
      m.position.set(x, PART_BASE_Y, z);
      m.castShadow = true;
      this.group.add(m);
      return m;
    });
  }

  // 工件加工完成：换成成品外观
  finishPart(mesh) {
    mesh.geometry = PART_GEO.done;
    mesh.material = PART_MAT.done;
  }

  implode(kind) {
    this.kind = kind;
    if (this.parts) {
      for (const p of this.parts) p.removeFromParent();
      this.parts = null;
    }
    this.merged.geometry = MERGED[kind];
    this.merged.material = PART_MAT[kind];
    this.group.add(this.merged);
  }

  partLocal(i) {
    const [x, z] = PART_SLOTS[i];
    return new THREE.Vector3(x, PART_BASE_Y, z);
  }

  dispose() {
    this.group.removeFromParent();
  }
}

export const PART_SIZE = PART;
