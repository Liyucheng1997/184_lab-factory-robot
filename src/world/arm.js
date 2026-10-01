// 六轴工业机器人：正向运动学层级 + 解析逆解（腕部竖直向下的上下料姿态）
// J1 绕竖直轴回转；J2/J3 俯仰构成平面二连杆；J5 保证工具垂直向下；J6 对齐夹爪
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { M } from '../core/materials.js';
import { smooth, clamp01 } from '../core/proc.js';

const PED = 0.45;      // 底座高度
const H0 = 1.18;       // 肩部轴心高度（相对地面）
const A1 = 0.28;       // 肩部前偏
const L2 = 1.1;        // 大臂
const L3 = 1.2;        // 小臂（肘 → 腕心）
const LT = 0.34;       // 腕心 → TCP（夹爪指尖中心）

const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class RobotArm {
  constructor(parent, base, { color = M.robotOrange } = {}) {
    this.base = base.clone();
    this.group = new THREE.Group();
    this.group.position.copy(base);
    parent.add(this.group);
    this.j = [0, 0, 0, 0, 0, 0];
    this.cyl = { th: 0, rho: 1.2, y: 1.6 };   // 当前 TCP（柱坐标）
    this.toolYaw = 0;
    this.grip = 1;
    this.build(color);
    this.solveCyl(this.cyl.th, this.cyl.rho, this.cyl.y, 0);
  }

  build(mat) {
    const dark = M.steelDark;
    const rb = (w, h, d, r = 0.04) => new RoundedBoxGeometry(w, h, d, 3, r);
    const add = (parent, geo, material, x = 0, y = 0, z = 0, rx = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, material);
      m.position.set(x, y, z);
      m.rotation.set(rx, 0, rz);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // 底座
    add(this.group, rb(0.72, PED, 0.72, 0.03), M.steelGrey, 0, PED / 2, 0);
    add(this.group, new THREE.BoxGeometry(0.9, 0.03, 0.9), dark, 0, 0.015, 0);
    add(this.group, new THREE.CylinderGeometry(0.32, 0.36, 0.22, 32), mat, 0, PED + 0.11, 0);

    // J1 回转座
    this.turret = new THREE.Group();
    this.turret.position.y = PED + 0.22;
    this.group.add(this.turret);
    add(this.turret, new THREE.CylinderGeometry(0.3, 0.32, 0.18, 32), mat, 0, 0.09, 0);
    add(this.turret, rb(0.5, 0.42, 0.56, 0.06), mat, 0, 0.36, 0.1);
    add(this.turret, new THREE.CylinderGeometry(0.11, 0.11, 0.26, 20), dark, -0.2, 0.3, -0.22); // J1 电机
    add(this.turret, new THREE.CylinderGeometry(0.1, 0.1, 0.2, 20), dark, 0.32, H0 - this.turret.position.y, A1, 0, Math.PI / 2); // J2 电机

    // J2 肩
    this.shoulder = new THREE.Group();
    this.shoulder.position.set(0, H0 - this.turret.position.y, A1);
    this.turret.add(this.shoulder);
    add(this.shoulder, new THREE.CylinderGeometry(0.2, 0.2, 0.42, 28), mat, 0, 0, 0, 0, Math.PI / 2);
    add(this.shoulder, rb(0.24, L2, 0.3, 0.07), mat, -0.06, L2 / 2, 0);
    add(this.shoulder, new THREE.CylinderGeometry(0.16, 0.16, 0.36, 28), mat, -0.02, L2, 0, 0, Math.PI / 2);
    // 平衡缸
    add(this.shoulder, new THREE.CylinderGeometry(0.045, 0.045, L2 * 0.75, 12), M.galv, 0.17, L2 * 0.42, -0.12);

    // J3 肘
    this.elbow = new THREE.Group();
    this.elbow.position.set(0, L2, 0);
    this.shoulder.add(this.elbow);
    add(this.elbow, rb(0.34, 0.34, 0.5, 0.07), mat, 0, 0, 0.02);
    add(this.elbow, new THREE.CylinderGeometry(0.1, 0.1, 0.3, 20), dark, 0, 0, -0.32, Math.PI / 2); // J4 电机
    const fore = new THREE.CylinderGeometry(0.085, 0.11, L3 - 0.3, 24);
    add(this.elbow, fore, mat, 0, 0, 0.25 + (L3 - 0.3) / 2, Math.PI / 2);

    // J5 腕
    this.wrist = new THREE.Group();
    this.wrist.position.set(0, 0, L3);
    this.elbow.add(this.wrist);
    add(this.wrist, new THREE.CylinderGeometry(0.09, 0.09, 0.22, 20), mat, 0, 0, 0, 0, Math.PI / 2);

    // J6 法兰 + 气动夹爪
    this.tool = new THREE.Group();
    this.wrist.add(this.tool);
    add(this.tool, new THREE.CylinderGeometry(0.07, 0.07, 0.06, 20), dark, 0, 0, 0.1, Math.PI / 2);
    add(this.tool, rb(0.2, 0.12, 0.12, 0.02), M.steelGrey, 0, 0, 0.18);
    add(this.tool, new THREE.BoxGeometry(0.04, 0.03, 0.03), M.galv, 0.11, 0.04, 0.16); // 气管接头
    this.fingers = [];
    for (const s of [-1, 1]) {
      const f = add(this.tool, new THREE.BoxGeometry(0.03, 0.08, 0.12), M.galv, s * 0.12, 0, LT - 0.04);
      this.fingers.push(f);
    }
    this.tcpAnchor = new THREE.Group();
    this.tcpAnchor.position.set(0, 0, LT - 0.02);
    this.tool.add(this.tcpAnchor);
  }

  setGrip(open) {
    this.grip = open;
    const w = 0.07 + open * 0.07;
    this.fingers[0].position.x = -w;
    this.fingers[1].position.x = w;
  }

  // 柱坐标逆解：th 方位角(世界 yaw)，rho 水平半径，y TCP 高度
  solveCyl(th, rho, y, toolYaw) {
    const wx = rho - A1;
    const wy = y + LT - H0;
    let d = Math.hypot(wx, wy);
    d = Math.min(Math.max(d, Math.abs(L2 - L3) + 0.02), L2 + L3 - 0.01);
    const phi = Math.atan2(wy, wx);
    const psi = Math.acos(clamp(((L2 * L2) + d * d - L3 * L3) / (2 * L2 * d)));
    const ua = phi + psi;                       // 大臂与水平夹角（肘上解）
    const alpha = Math.PI / 2 - ua;             // J2：自竖直向前倾
    const ux = L2 * Math.cos(ua), uy = L2 * Math.sin(ua);
    const delta = Math.atan2(wy * (d / Math.hypot(wx, wy) || 1) - uy, wx * (d / Math.hypot(wx, wy) || 1) - ux);
    const gamma = -delta;
    const j3 = gamma - alpha;
    const j5 = delta + Math.PI / 2;
    const j1 = th - this.yawOffset();
    this.j = [j1, alpha, j3, 0, j5, wrapPi(j1 - toolYaw)];
    this.turret.rotation.y = j1;
    this.shoulder.rotation.x = alpha;
    this.elbow.rotation.x = j3;
    this.wrist.rotation.x = j5;
    this.tool.rotation.z = this.j[5];
  }

  yawOffset() {
    return 0;
  }

  // 世界坐标 → 柱坐标
  toCyl(p) {
    const dx = p.x - this.base.x, dz = p.z - this.base.z;
    return { th: Math.atan2(dx, dz), rho: Math.hypot(dx, dz), y: p.y - this.base.y };
  }

  // 柱坐标插值运动（关节空间感的圆弧轨迹）
  *moveTo(p, { speed = 2.0, minT = 0.4, yaw = this.toolYaw } = {}) {
    const from = { ...this.cyl };
    const to = this.toCyl(p);
    let dth = wrapPi(to.th - from.th);
    const arc = Math.abs(dth) * Math.max(from.rho, to.rho);
    const dist = Math.hypot(arc, to.rho - from.rho, to.y - from.y);
    const T = Math.max(minT, dist / speed);
    const yaw0 = this.toolYaw;
    const dyaw = wrapPi(yaw - yaw0);
    let t = 0;
    while (t < T) {
      t += yield;
      const k = smooth(clamp01(t / T));
      this.cyl.th = from.th + dth * k;
      this.cyl.rho = from.rho + (to.rho - from.rho) * k;
      this.cyl.y = from.y + (to.y - from.y) * k;
      this.toolYaw = yaw0 + dyaw * k;
      this.solveCyl(this.cyl.th, this.cyl.rho, this.cyl.y, this.toolYaw);
    }
  }

  // 直线插补（进出机床门、下探抓取）
  *moveLinear(p, { speed = 0.9, minT = 0.3 } = {}) {
    const start = this.tcpWorld();
    const dist = start.distanceTo(p);
    const T = Math.max(minT, dist / speed);
    const cur = new THREE.Vector3();
    let t = 0;
    while (t < T) {
      t += yield;
      cur.lerpVectors(start, p, smooth(clamp01(t / T)));
      const c = this.toCyl(cur);
      this.cyl.th = c.th; this.cyl.rho = c.rho; this.cyl.y = c.y;
      this.solveCyl(c.th, c.rho, c.y, this.toolYaw);
    }
  }

  *gripTo(open, T = 0.35) {
    const g0 = this.grip;
    let t = 0;
    while (t < T) {
      t += yield;
      this.setGrip(g0 + (open - g0) * smooth(clamp01(t / T)));
    }
  }

  tcpWorld(out = new THREE.Vector3()) {
    const th = this.cyl.th;
    return out.set(
      this.base.x + Math.sin(th) * this.cyl.rho,
      this.base.y + this.cyl.y,
      this.base.z + Math.cos(th) * this.cyl.rho,
    );
  }
}

function clamp(v) {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}
