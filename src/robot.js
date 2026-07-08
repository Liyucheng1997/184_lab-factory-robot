// AGV 搬运机器人：状态机 + 格子占用式移动 + 阻塞让行/重规划
import * as THREE from 'three';
import { findPath } from './astar.js';
import { CELL } from './grid.js';
import { CARGO_SIZE } from './warehouse.js';

const SPEED = 1.9;        // 格/秒
const TURN_RATE = 9;      // 转向速率
const LOAD_TIME = 1.2;    // 装货耗时(秒)
const UNLOAD_TIME = 1.0;  // 卸货耗时(秒)
const PLATE_Y = 0.36;     // 托盘基础高度
const LIFT = 0.1;         // 托盘举升行程

export const STATE_LABEL = {
  idle: '空闲待命',
  toPickup: '前往取货',
  loading: '装货中',
  toDropoff: '搬运货物',
  unloading: '卸货中',
  toHome: '返回充电位',
};

export class Robot {
  constructor({ id, color, home, grid, scene }) {
    this.id = id;
    this.color = color;
    this.grid = grid;
    this.scene = scene;
    this.home = { ...home };

    this.cell = { ...home };  // 当前占据的格子
    this.next = null;         // 正在驶入的格子
    this.moveT = 0;
    this.path = [];
    this.goal = null;
    this.state = 'idle';
    this.task = null;
    this.carrying = false;

    this.waitTime = 0;
    this.waitLimit = 0.8 + Math.random() * 0.8;
    this.replanTimer = 0;
    this.idleTime = 0;
    this.actionTimer = 0;
    this.cargoFrom = new THREE.Vector3();
    this.cargoTo = new THREE.Vector3();

    this.yaw = Math.PI / 2;
    this.targetYaw = this.yaw;
    this.time = Math.random() * 10;

    grid.tryClaim(home.c, home.r, this);

    this.group = this.buildMesh();
    const p = grid.cellToWorld(home.c, home.r);
    this.group.position.set(p.x, 0, p.z);
    this.group.rotation.y = this.yaw;
    scene.add(this.group);

    this.pathLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75 })
    );
    this.pathLine.frustumCulled = false;
    scene.add(this.pathLine);
    this.showPath = true;
  }

  // ---------- 外观 ----------
  buildMesh() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2e3238, roughness: 0.55, metalness: 0.35 });
    const accentMat = new THREE.MeshStandardMaterial({ color: this.color, roughness: 0.45, metalness: 0.2 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.22, 0.86), bodyMat);
    body.position.y = 0.17;
    body.castShadow = true;
    g.add(body);

    const top = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.8), accentMat);
    top.position.y = 0.31;
    g.add(top);

    // 升降托盘
    this.plate = new THREE.Mesh(
      new THREE.CylinderGeometry(0.27, 0.27, 0.05, 24),
      new THREE.MeshStandardMaterial({ color: 0x53585f, roughness: 0.4, metalness: 0.5 })
    );
    this.plate.position.y = PLATE_Y;
    this.plate.castShadow = true;
    g.add(this.plate);

    // 前部感应灯条
    const frontBar = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.05, 0.03),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xcfe8ff, emissiveIntensity: 0.9 })
    );
    frontBar.position.set(0, 0.2, 0.44);
    g.add(frontBar);

    // 状态灯
    this.lightMat = new THREE.MeshStandardMaterial({
      color: 0x39d353, emissive: 0x39d353, emissiveIntensity: 1.2,
    });
    const statusLight = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 12), this.lightMat);
    statusLight.position.set(0.24, 0.36, -0.32);
    g.add(statusLight);

    // 轮子
    this.wheels = [];
    const wheelGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.06, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.8 });
    for (const [x, z] of [[-0.31, 0.28], [0.31, 0.28], [-0.31, -0.28], [0.31, -0.28]]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, 0.09, z);
      g.add(w);
      this.wheels.push(w);
    }

    // 编号标签
    const sprite = makeLabel(this.id, this.color);
    sprite.position.y = 0.95;
    g.add(sprite);

    return g;
  }

  // ---------- 调度接口 ----------
  get busy() {
    return this.task !== null;
  }

  assignTask(task) {
    this.task = task;
    this.idleTime = 0;
    this.setGoal(task.slot.accessCell, 'toPickup');
  }

  setGoal(cell, state) {
    this.goal = { ...cell };
    this.state = state;
    this.plan();
  }

  plan() {
    const p = findPath(this.grid, this.cell, this.goal, { robot: this });
    this.path = p || [];
    this.replanTimer = 0.6 + Math.random() * 0.4;
  }

  // 被挡住时：把挡路格临时视为障碍，绕路重规划
  replanAround(blockedCell) {
    const avoid = new Set([this.grid.key(blockedCell.c, blockedCell.r)]);
    const p = findPath(this.grid, this.cell, this.goal, { avoid, robot: this });
    if (p) this.path = p;
  }

  // ---------- 主循环 ----------
  update(dt) {
    this.time += dt;
    const acting = this.state === 'loading' || this.state === 'unloading';

    if (acting) {
      this.updateAction(dt);
    } else {
      this.updateMovement(dt);
    }

    // 平滑转向
    let d = this.targetYaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, TURN_RATE * dt);
    this.group.rotation.y = this.yaw;

    // 携带货物跟随托盘
    if (this.carrying && !acting && this.task) {
      const cargo = this.task.cargo;
      cargo.position.set(
        this.group.position.x,
        this.plate.position.y + 0.03 + CARGO_SIZE / 2,
        this.group.position.z
      );
      cargo.rotation.y = this.yaw;
    }

    this.updateStatusLight();
    this.updatePathLine();
  }

  updateAction(dt) {
    this.actionTimer += dt;
    const dur = this.state === 'loading' ? LOAD_TIME : UNLOAD_TIME;
    const k = Math.min(this.actionTimer / dur, 1);
    const e = k * k * (3 - 2 * k); // smoothstep

    const cargo = this.task.cargo;
    cargo.position.lerpVectors(this.cargoFrom, this.cargoTo, e);
    this.plate.position.y = PLATE_Y + LIFT * (this.state === 'loading' ? e : 1 - e);

    if (k >= 1) {
      if (this.state === 'loading') {
        this.carrying = true;
        this.task.onPicked();
        this.setGoal(this.task.drop.cell, 'toDropoff');
      } else {
        this.carrying = false;
        this.plate.position.y = PLATE_Y;
        this.task.onDelivered();
        this.task = null;
        this.goal = null;
        this.state = 'idle';
        this.idleTime = 0;
      }
    }
  }

  updateMovement(dt) {
    if (this.next) {
      // 正在两格之间行驶
      this.moveT += (dt * SPEED) / CELL;
      const a = this.grid.cellToWorld(this.cell.c, this.cell.r);
      const b = this.grid.cellToWorld(this.next.c, this.next.r);
      const t = Math.min(this.moveT, 1);
      this.group.position.set(a.x + (b.x - a.x) * t, 0, a.z + (b.z - a.z) * t);
      this.targetYaw = Math.atan2(b.x - a.x, b.z - a.z);
      const spin = (dt * SPEED) / 0.09;
      for (const w of this.wheels) w.rotateY(spin);

      if (this.moveT >= 1) {
        this.grid.release(this.cell.c, this.cell.r, this);
        this.cell = this.next;
        this.next = null;
      }
    } else if (this.path.length > 0) {
      // 申请驶入下一格
      const nxt = this.path[0];
      if (this.grid.tryClaim(nxt.c, nxt.r, this)) {
        this.path.shift();
        this.next = nxt;
        this.moveT = 0;
        this.waitTime = 0;
      } else {
        this.waitTime += dt;
        if (this.waitTime > this.waitLimit) {
          this.waitTime = 0;
          this.waitLimit = 0.8 + Math.random() * 1.2;
          this.replanAround(nxt);
        }
      }
    } else if (this.goal) {
      if (this.cell.c === this.goal.c && this.cell.r === this.goal.r) {
        this.onArrive();
      } else {
        // 没有可用路径：周期性重试
        this.replanTimer -= dt;
        if (this.replanTimer <= 0) this.plan();
      }
    } else if (this.state === 'idle') {
      this.idleTime += dt;
      if (this.idleTime > 2 && (this.cell.c !== this.home.c || this.cell.r !== this.home.r)) {
        this.setGoal(this.home, 'toHome');
      }
    }
  }

  onArrive() {
    if (this.state === 'toPickup') {
      this.state = 'loading';
      this.actionTimer = 0;
      const cargo = this.task.cargo;
      this.cargoFrom.copy(cargo.position);
      this.cargoTo.set(
        this.group.position.x,
        PLATE_Y + LIFT + 0.03 + CARGO_SIZE / 2,
        this.group.position.z
      );
      this.faceTowards(cargo.position.x, cargo.position.z);
    } else if (this.state === 'toDropoff') {
      this.state = 'unloading';
      this.actionTimer = 0;
      const w = this.grid.cellToWorld(this.task.drop.cargoCell.c, this.task.drop.cargoCell.r);
      this.cargoFrom.copy(this.task.cargo.position);
      this.cargoTo.set(w.x, CARGO_SIZE / 2, w.z);
      this.faceTowards(w.x, w.z);
    } else if (this.state === 'toHome') {
      this.state = 'idle';
      this.goal = null;
      this.idleTime = 0;
      this.targetYaw = Math.PI / 2; // 停靠时朝向通道
    } else {
      this.goal = null;
    }
  }

  faceTowards(x, z) {
    this.targetYaw = Math.atan2(x - this.group.position.x, z - this.group.position.z);
  }

  get isWaiting() {
    return this.waitTime > 0.25;
  }

  updateStatusLight() {
    let color;
    if (this.isWaiting) color = 0xff4d4d;
    else if (this.state === 'loading' || this.state === 'unloading') color = 0xffc832;
    else if (this.state === 'idle') color = 0x39d353;
    else color = 0x3fb6ff;
    this.lightMat.color.setHex(color);
    this.lightMat.emissive.setHex(color);
    this.lightMat.emissiveIntensity = 1 + 0.5 * Math.sin(this.time * 6);
  }

  updatePathLine() {
    const active = this.showPath && (this.path.length > 0 || this.next);
    this.pathLine.visible = active;
    if (!active) return;
    const pts = [new THREE.Vector3(this.group.position.x, 0.06, this.group.position.z)];
    if (this.next) {
      const p = this.grid.cellToWorld(this.next.c, this.next.r, 0.06);
      pts.push(new THREE.Vector3(p.x, p.y, p.z));
    }
    for (const cell of this.path) {
      const p = this.grid.cellToWorld(cell.c, cell.r, 0.06);
      pts.push(new THREE.Vector3(p.x, p.y, p.z));
    }
    this.pathLine.geometry.setFromPoints(pts);
  }
}

// 头顶编号标签
function makeLabel(id, color) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 96;
  const ctx = cv.getContext('2d');
  ctx.beginPath();
  ctx.arc(48, 48, 38, 0, Math.PI * 2);
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 44px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(id), 48, 51);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true }));
  sprite.scale.setScalar(0.42);
  return sprite;
}
