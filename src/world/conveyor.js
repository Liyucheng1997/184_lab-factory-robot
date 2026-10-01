// 动力辊筒输送线（可倾斜）：侧板、辊筒、支腿、驱动电机、光电开关
// 辊筒采用条纹贴图，滚动 UV 偏移即可表现转动，所有辊筒合并为单网格
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRANSFER_H } from '../config.js';
import { Batcher } from '../core/batcher.js';
import { M, makeRollerTexture } from '../core/materials.js';

const ROLLER_R = 0.032;
const PITCH = 0.125;

export class Conveyor {
  /**
   * @param parent THREE.Object3D
   * @param a,b   {x,z} 世界坐标：输送中心线起止点（载具在其间运动）
   * @param opts  { width, h0, h1, motor, sensors, legs }
   */
  constructor(parent, a, b, opts = {}) {
    const { width = 0.98, h0 = TRANSFER_H, h1 = h0, motor = true, sensors = true, legs = true, guides = false } = opts;
    this.a = new THREE.Vector3(a.x, h0, a.z);
    this.b = new THREE.Vector3(b.x, h1, b.z);
    this.speed = 0;
    const dx = b.x - a.x, dz = b.z - a.z;
    const flat = Math.hypot(dx, dz);
    const len = Math.hypot(flat, h1 - h0);
    this.length = len;

    this.group = new THREE.Group();
    this.group.position.set(a.x, 0, a.z);
    this.group.rotation.y = Math.atan2(dx, dz);
    parent.add(this.group);

    const inner = new THREE.Group();
    inner.position.y = h0;
    inner.rotation.x = -Math.atan2(h1 - h0, flat);
    this.group.add(inner);

    // ---- 辊筒 ----
    this.tex = makeRollerTexture();
    this.rollerMat = new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.35, metalness: 0.85 });
    const rollers = [];
    const proto = new THREE.CylinderGeometry(ROLLER_R, ROLLER_R, width - 0.04, 14, 1, true).toNonIndexed();
    const n = Math.max(2, Math.floor((len - 0.04) / PITCH));
    const start = (len - (n - 1) * PITCH) / 2;
    for (let i = 0; i < n; i++) {
      const g = proto.clone();
      g.rotateZ(Math.PI / 2);
      g.translate(0, -ROLLER_R, start + i * PITCH);
      rollers.push(g);
    }
    const rollerMesh = new THREE.Mesh(mergeGeometries(rollers, false), this.rollerMat);
    rollerMesh.receiveShadow = true;
    inner.add(rollerMesh);
    rollers.forEach((g) => g.dispose());

    // ---- 侧板 / 支腿 / 驱动 ----
    const bi = new Batcher();
    const half = width / 2 + 0.025;
    for (const s of [-1, 1]) {
      bi.box(M.galv, 0.04, 0.16, len, s * half, -0.07, len / 2);
      bi.box(M.galv, 0.06, 0.012, len, s * (half - 0.01), 0.004, len / 2);
      if (guides) bi.box(M.safetyYellow, 0.03, 0.05, len - 0.1, s * (half + 0.005), 0.12, len / 2);
    }
    // 横撑
    for (let z = 0.1; z < len; z += 1.0) bi.box(M.galv, width, 0.03, 0.04, 0, -0.14, z);
    if (sensors) {
      // 末端光电开关 + 反光板
      bi.box(M.safetyYellow, 0.05, 0.07, 0.05, -half - 0.03, 0.06, len - 0.2);
      bi.box(M.plasticBlack, 0.02, 0.04, 0.03, -half + 0.003, 0.06, len - 0.2);
      bi.box(M.red, 0.01, 0.05, 0.05, half + 0.02, 0.06, len - 0.2);
      bi.box(M.safetyYellow, 0.05, 0.07, 0.05, -half - 0.03, 0.06, 0.25);
    }
    bi.flush(inner);

    const bo = new Batcher();
    if (legs) {
      const nLeg = Math.max(2, Math.ceil(flat / 1.1) + 1);
      for (let i = 0; i < nLeg; i++) {
        const t = i / (nLeg - 1);
        const z = 0.08 + t * (flat - 0.16);
        const h = h0 + (h1 - h0) * (z / flat) - 0.15;
        for (const s of [-1, 1]) {
          bo.box(M.galv, 0.05, h, 0.05, s * (half - 0.03), h / 2, z);
          bo.box(M.steelDark, 0.12, 0.02, 0.12, s * (half - 0.03), 0.01, z);
        }
        bo.box(M.galv, width - 0.1, 0.03, 0.03, 0, Math.min(0.2, h * 0.4), z);
      }
    }
    if (motor) {
      // 驱动电机 + 减速机，悬挂在一端下方
      const mz = Math.min(flat - 0.3, flat * 0.85);
      const my = h0 + (h1 - h0) * (mz / flat) - 0.26;
      bo.box(M.steelGrey, 0.22, 0.16, 0.2, half - 0.18, my, mz);
      bo.cyl(M.paintGrey, 0.075, 0.24, half + 0.02, my, mz, 'x', 16);
      bo.cyl(M.steelDark, 0.08, 0.03, half + 0.15, my, mz, 'x', 16);
    }
    bo.flush(this.group);
  }

  // 沿输送线参数 t∈[0,1] 的世界坐标（托盘底面中心）
  pointAt(t, out = new THREE.Vector3()) {
    return out.lerpVectors(this.a, this.b, t);
  }

  get yaw() {
    return this.group.rotation.y;
  }

  update(dt) {
    if (this.speed !== 0) this.tex.offset.x -= (this.speed * dt) / (2 * Math.PI * ROLLER_R) * 0.25;
  }
}

/**
 * 积放式站台：输送线上若干停位(参数 t)，载具从入口逐位前移到出口
 * 用于立体库出入库口、收发货口等
 */
export class Accumulator {
  constructor(conveyor, stops, { speed = 0.45, loadYaw = null } = {}) {
    this.conv = conveyor;
    this.stops = stops;               // t 值数组：stops[0] 入口，末位出口
    this.slots = new Array(stops.length).fill(null);
    this.moving = null;               // { load, i, k }
    this.speed = speed;
    this.loadYaw = loadYaw ?? conveyor.yaw;
    this._p = new THREE.Vector3();
  }

  get count() {
    return this.slots.filter(Boolean).length + (this.moving ? 1 : 0);
  }

  canEnter() {
    return !this.slots[0] && !(this.moving && this.moving.i === 0);
  }

  put(load) {
    this.slots[0] = load;
    this.place(load, this.stops[0]);
  }

  place(load, t) {
    this.conv.pointAt(t, this._p);
    load.group.position.copy(this._p);
    load.group.rotation.set(0, this.loadYaw, 0);
  }

  head() {
    const n = this.slots.length - 1;
    return this.slots[n];
  }

  takeHead() {
    const n = this.slots.length - 1;
    const l = this.slots[n];
    this.slots[n] = null;
    return l;
  }

  update(dt) {
    if (this.moving) {
      const m = this.moving;
      const span = Math.abs(this.stops[m.i + 1] - this.stops[m.i]) * this.conv.length;
      m.k = Math.min(1, m.k + (this.speed * dt) / Math.max(span, 0.01));
      const t = this.stops[m.i] + (this.stops[m.i + 1] - this.stops[m.i]) * m.k;
      this.place(m.load, t);
      if (m.k >= 1) {
        this.slots[m.i + 1] = m.load;
        this.moving = null;
      }
    }
    if (!this.moving) {
      for (let i = this.slots.length - 2; i >= 0; i--) {
        if (this.slots[i] && !this.slots[i + 1]) {
          this.moving = { load: this.slots[i], i, k: 0 };
          this.slots[i] = null;
          break;
        }
      }
    }
    this.conv.speed = this.moving || this.roll ? this.speed : 0;
    this.conv.update(dt);
  }
}
