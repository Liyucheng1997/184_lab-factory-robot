// 自动化立体仓库 AS/RS：横梁式高位货架 + 单立柱巷道堆垛机 + 出入库站台
import * as THREE from 'three';
import { ASRS, CELL, TRANSFER_H } from '../config.js';
import { cx, cz } from '../core/grid.js';
import { Batcher } from '../core/batcher.js';
import { M, lightMat, signMesh, tiledPlane } from '../core/materials.js';
import { Proc, moveAxis, all } from '../core/proc.js';
import { Conveyor, Accumulator } from './conveyor.js';
import { Load } from './load.js';

const DEPTH = 1.0;        // 货架进深(立柱前后距)
const BEAM_H = 0.12;
const FORK_EXT = CELL;    // 货叉伸出距离（巷道中心 → 货位中心）

export const levelY = (l) => ASRS.level0Y + l * ASRS.levelPitch;

export class ASRSSystem {
  constructor(scene, grid, events) {
    this.scene = scene;
    this.events = events;
    this.slots = [];
    this.cranes = [];
    this.inPorts = [];
    this.outPorts = [];
    this.retrieveQueue = [];  // 尚未分配到巷道的出库需求

    // 阻挡：货架区 + 站台
    grid.blockRect(ASRS.colMin, 0, ASRS.colMax, ASRS.portRows[1]);

    const b = new Batcher();
    this.buildRacks(b);
    this.buildRails(b);
    b.flush(scene);

    ASRS.aisles.forEach((ca, a) => {
      this.cranes.push(new StackerCrane(scene, this, a, ca));
      this.buildPorts(scene, a, ca);
    });
    this.fillInitial();
  }

  get capacity() {
    return this.slots.length;
  }

  get stock() {
    let n = 0;
    for (const s of this.slots) if (s.load && !s.reserved) n++;
    return n;
  }

  get occupied() {
    let n = 0;
    for (const s of this.slots) if (s.load || s.incoming) n++;
    return n;
  }

  // ---------------------------------------------------------------- 静态货架
  buildRacks(b) {
    const H = ASRS.rackH;
    const rackCols = [];
    ASRS.aisles.forEach((ca, a) => {
      rackCols.push({ col: ca - 1, aisle: a, side: -1 });
      rackCols.push({ col: ca + 1, aisle: a, side: 1 });
    });

    for (const rc of rackCols) {
      const X = cx(rc.col);
      // 立柱框架：每个货位边界一副
      for (let r = 0; r <= ASRS.bays; r++) {
        const z = cz(r) - CELL / 2;
        for (const sx of [-1, 1]) {
          const x = X + sx * DEPTH / 2;
          b.box(M.rackBlue, 0.09, H, 0.075, x, H / 2, z);
          b.box(M.steelDark, 0.16, 0.012, 0.14, x, 0.006, z); // 底板
        }
        // 框架斜撑（Z 字形）
        let y = 0.15, s = 1;
        while (y < H - 0.6) {
          const y2 = Math.min(y + 1.05, H - 0.15);
          b.beam(M.rackBlue,
            new THREE.Vector3(X - s * (DEPTH / 2 - 0.05), y, z),
            new THREE.Vector3(X + s * (DEPTH / 2 - 0.05), y2, z), 0.035);
          y = y2;
          s = -s;
        }
        b.box(M.rackBlue, DEPTH, 0.04, 0.04, X, 0.12, z);
        b.box(M.rackBlue, DEPTH, 0.04, 0.04, X, H - 0.1, z);
      }
      // 横梁 + 托盘支撑
      for (let r = 0; r < ASRS.bays; r++) {
        const zc = cz(r);
        for (let l = 0; l < ASRS.levels; l++) {
          const y = levelY(l) - BEAM_H / 2;
          for (const sx of [-1, 1]) {
            b.box(M.rackOrange, 0.05, BEAM_H, CELL - 0.08, X + sx * (DEPTH / 2 - 0.035), y, zc);
          }
          for (const sz of [-0.3, 0.3]) {
            b.box(M.galv, DEPTH - 0.06, 0.035, 0.05, X, levelY(l) - 0.018, zc + sz);
          }
        }
        // 货位标签（条码标签，白底）
        for (let l = 0; l < ASRS.levels; l++) {
          b.box(M.paintWhite, 0.005, 0.05, 0.12, X - rc.side * (DEPTH / 2 - 0.005), levelY(l) - 0.06, zc + 0.35,
            0, { cast: false });
        }
      }
      // 端部防撞护栏（巷道口立柱保护）
      const zEnd = cz(ASRS.bays) - CELL / 2;
      b.box(M.safetyYellow, 0.22, 0.4, 0.2, X - rc.side * DEPTH / 2, 0.2, zEnd + 0.12);
    }

    // 巷道顶部连接梁 + 喷淋主管
    ASRS.aisles.forEach((ca) => {
      const X = cx(ca);
      for (let r = 0; r <= ASRS.bays; r += 3) {
        b.box(M.rackBlue, CELL * 2 - DEPTH + 0.1, 0.1, 0.08, X, H - 0.05, cz(r) - CELL / 2);
      }
      b.cyl(M.red, 0.05, ASRS.bays * CELL, X - CELL, H + 0.25, cz(ASRS.bays / 2 - 0.5), 'z', 10, { cast: false });
    });
  }

  buildRails(b) {
    const H = ASRS.rackH;
    for (const ca of ASRS.aisles) {
      const X = cx(ca);
      const z0 = cz(0) - CELL / 2 + 0.05, z1 = cz(ASRS.portRows[0]) + CELL / 2;
      const L = z1 - z0, zc = (z0 + z1) / 2;
      // 地轨 + 轨道基座
      b.box(M.steelDark, 0.3, 0.04, L, X, 0.02, zc);
      b.box(M.galv, 0.07, 0.09, L, X, 0.085, zc);
      // 天轨
      b.box(M.galv, 0.1, 0.12, L, X, H + 0.06, zc);
      // 端部缓冲器
      b.box(M.safetyYellow, 0.32, 0.3, 0.12, X, 0.25, z0 + 0.06);
      b.box(M.safetyYellow, 0.32, 0.3, 0.12, X, 0.25, z1 - 0.06);
      // 巷道口安全门（网片）
      const zf = cz(ASRS.portRows[1]) + CELL / 2 - 0.05;
      b.box(M.safetyYellow, 0.06, 2.0, 0.06, X - CELL / 2 + 0.06, 1.0, zf);
      b.box(M.safetyYellow, 0.06, 2.0, 0.06, X + CELL / 2 - 0.06, 1.0, zf);
      b.box(M.safetyYellow, CELL - 0.12, 0.05, 0.05, X, 2.0, zf);
      b.box(M.safetyYellow, CELL - 0.12, 0.05, 0.05, X, 0.15, zf);
      b.add(tiledPlane(CELL - 0.18, 1.8), M.fenceMesh,
        new THREE.Matrix4().makeTranslation(X, 1.07, zf), { cast: false });
      // 巷道口与站台之间的通道两侧也用网片封闭
      for (const s of [-1, 1]) {
        const xs = X + s * (CELL / 2 - 0.03);
        b.box(M.safetyYellow, 0.05, 2.0, 0.05, xs, 1.0, cz(ASRS.portRows[0]) - CELL / 2);
      }
    }
  }

  // ---------------------------------------------------------------- 站台
  buildPorts(scene, a, ca) {
    const [rCrane, rHand] = ASRS.portRows;
    const zA = cz(rHand) + CELL / 2 - 0.02, zB = cz(rCrane) - CELL / 2 + 0.06;
    const tHand = (zA - cz(rHand)) / (zA - zB);
    const tCrane = (zA - cz(rCrane)) / (zA - zB);

    // 入库口（西侧）：AMR → 站台 → 堆垛机取货位
    const cin = new Conveyor(scene, { x: cx(ca - 1), z: zA }, { x: cx(ca - 1), z: zB }, { guides: true });
    const accIn = new Accumulator(cin, [tHand, tCrane], { loadYaw: 0 });
    // 出库口（东侧）：堆垛机放货位 → 站台 → AMR
    const cout = new Conveyor(scene, { x: cx(ca + 1), z: zB }, { x: cx(ca + 1), z: zA }, { guides: true });
    const accOut = new Accumulator(cout, [1 - tCrane, 1 - tHand], { loadYaw: 0 });

    const inPort = {
      id: `IN-${a + 1}`, name: `立库${a + 1}#入库口`, kind: 'asrsIn', aisle: a,
      dock: { c: ca - 1, r: ASRS.dockRow }, yaw: Math.PI,
      handoff: new THREE.Vector3(cx(ca - 1), TRANSFER_H, cz(rHand)), loadYaw: 0,
      acc: accIn, reservedIn: null,
      canAccept: () => accIn.canEnter(),
      accept: (load) => {
        accIn.put(load);
        this.events.log('asrs', `${load.id} 到达 ${inPort.name}`);
      },
      setRoll: (on) => { accIn.roll = on; },
    };
    const outPort = {
      id: `OUT-${a + 1}`, name: `立库${a + 1}#出库口`, kind: 'asrsOut', aisle: a,
      dock: { c: ca + 1, r: ASRS.dockRow }, yaw: Math.PI,
      handoff: new THREE.Vector3(cx(ca + 1), TRANSFER_H, cz(rHand)), loadYaw: 0,
      acc: accOut, pendingPick: null,
      ready: () => (accOut.moving ? null : accOut.head()),
      take: () => accOut.takeHead(),
      setRoll: (on) => { accOut.roll = on; },
    };
    this.inPorts.push(inPort);
    this.outPorts.push(outPort);

    // 站台信号灯与巷道标牌
    const sign = signMesh([`AISLE ${a + 1}`, { text: `巷道 ${a + 1}`, font: 'bold 44px "Microsoft YaHei"', color: '#ffd54f' }],
      1.1, 0.5, { w: 256, h: 116, bg: '#14304f' });
    sign.position.set(cx(ca), 2.3, cz(ASRS.portRows[1]) + CELL / 2 - 0.02);
    scene.add(sign);
  }

  // ---------------------------------------------------------------- 库存
  fillInitial() {
    ASRS.aisles.forEach((ca, a) => {
      for (const side of [-1, 1]) {
        for (let bay = 0; bay < ASRS.bays; bay++) {
          for (let l = 0; l < ASRS.levels; l++) {
            const slot = {
              aisle: a, side, bay, level: l, load: null, reserved: false, incoming: false,
              pos: new THREE.Vector3(cx(ca + side), levelY(l), cz(bay)),
              code: `${a + 1}-${side < 0 ? 'L' : 'R'}-${String(bay + 1).padStart(2, '0')}-${l + 1}`,
            };
            this.slots.push(slot);
          }
        }
      }
    });
    for (const s of this.slots) {
      if (Math.random() < ASRS.initialFill) {
        const load = new Load('raw');
        load.created = -Math.random() * 3600;
        load.group.position.copy(s.pos);
        this.scene.add(load.group);
        s.load = load;
      }
    }
  }

  // 为出库需求选择货位：先进先出，兼顾堆垛机负载
  requestRetrieval(dest) {
    let best = null, bestScore = Infinity;
    for (const s of this.slots) {
      if (!s.load || s.reserved) continue;
      const crane = this.cranes[s.aisle];
      const score = s.load.created + crane.workload * 60;
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (!best) return false;
    best.reserved = true;
    best.load.dest = dest;
    this.cranes[best.aisle].jobs.push({ type: 'retrieve', slot: best });
    return true;
  }

  // 为入库选择货位：靠近站台、低层优先（行程时间最短）
  chooseSlot(aisle) {
    let best = null, bestT = Infinity;
    const zPort = cz(ASRS.portRows[0]);
    for (const s of this.slots) {
      if (s.aisle !== aisle || s.load || s.incoming) continue;
      const tz = Math.abs(s.pos.z - zPort) / ASRS.crane.vTravel;
      const ty = Math.abs(s.pos.y - TRANSFER_H) / ASRS.crane.vLift;
      const t = Math.max(tz, ty) + Math.random() * 0.4;
      if (t < bestT) {
        bestT = t;
        best = s;
      }
    }
    return best;
  }

  freeSlots(aisle) {
    let n = 0;
    for (const s of this.slots) if (s.aisle === aisle && !s.load && !s.incoming) n++;
    return n;
  }

  update(dt) {
    for (const p of this.inPorts) p.acc.update(dt);
    for (const p of this.outPorts) p.acc.update(dt);
    for (const c of this.cranes) c.update(dt);
  }
}

// ==================================================================== 堆垛机
class StackerCrane {
  constructor(scene, asrs, aisle, col) {
    this.asrs = asrs;
    this.aisle = aisle;
    this.x = cx(col);
    this.jobs = [];
    this.state = '空闲';
    this.busyTime = 0;
    this.cycles = 0;
    this.lastType = 'retrieve';
    this.travel = { pos: cz(ASRS.portRows[0]), vel: 0 };
    this.lift = { pos: TRANSFER_H - 0.06, vel: 0 };
    this.fork = { pos: 0, vel: 0 };
    this.proc = null;
    this.build(scene);
    this.sync();
  }

  get workload() {
    return this.jobs.length + (this.proc ? 1 : 0);
  }

  build(scene) {
    const H = ASRS.rackH;
    const g = new THREE.Group();
    this.group = g;
    const b = new Batcher();
    // 下横梁（行走机构）
    b.box(M.craneOrange, 0.42, 0.34, 1.9, 0, 0.32, 0.25);
    for (const z of [-0.55, 1.05]) {
      b.box(M.steelDark, 0.3, 0.28, 0.32, 0, 0.2, z);    // 轮箱
      b.cyl(M.steelGrey, 0.13, 0.12, 0, 0.16, z, 'x', 18);
    }
    b.box(M.rubber, 0.25, 0.18, 0.08, 0, 0.3, -0.72);   // 缓冲块
    b.box(M.rubber, 0.25, 0.18, 0.08, 0, 0.3, 1.22);
    b.box(M.steelGrey, 0.2, 0.22, 0.32, 0.22, 0.38, 1.05); // 行走电机
    b.cyl(M.steelGrey, 0.09, 0.3, 0.25, 0.38, 0.8, 'z', 14);
    // 立柱（箱形截面 + 齿条/导轨）
    const mH = H - 0.45;
    b.box(M.craneOrange, 0.34, mH, 0.4, 0, 0.45 + mH / 2, 0.62);
    b.box(M.galv, 0.05, mH - 0.3, 0.05, 0, 0.6 + mH / 2, 0.4);
    b.box(M.steelDark, 0.36, 0.02, 0.42, 0, 0.45 + mH * 0.33, 0.62);
    b.box(M.steelDark, 0.36, 0.02, 0.42, 0, 0.45 + mH * 0.66, 0.62);
    // 维修爬梯
    for (const sx of [-1, 1]) b.box(M.safetyYellow, 0.025, mH - 0.4, 0.025, sx * 0.17, 0.65 + mH / 2, 0.86);
    for (let y = 0.8; y < mH; y += 0.3) b.box(M.safetyYellow, 0.32, 0.02, 0.02, 0, y, 0.86);
    // 上横梁 + 导向轮
    b.box(M.craneOrange, 0.28, 0.18, 0.9, 0, H - 0.1, 0.45);
    for (const sx of [-1, 1]) b.cyl(M.rubber, 0.06, 0.05, sx * 0.09, H + 0.02, 0.45, 'y', 12);
    // 电控柜
    b.box(M.paintGrey, 0.4, 1.3, 0.38, 0, 1.25, 1.12);
    b.box(M.steelDark, 0.41, 0.03, 0.39, 0, 1.92, 1.12);
    b.box(M.plasticBlack, 0.02, 0.18, 0.12, 0.21, 1.4, 1.12);
    // 激光测距反射 + 数据光通讯
    b.box(M.paintWhite, 0.18, 0.18, 0.06, 0, 0.62, -0.7);
    b.flush(g);

    const warn = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 12), lightMat(0xffa000, 1.2));
    warn.position.set(0, H + 0.2, 0.62);
    g.add(warn);
    this.beacon = warn;

    // 载货台（升降）
    const car = new THREE.Group();
    this.carriage = car;
    const cb = new Batcher();
    cb.box(M.craneOrange, 0.5, 0.75, 0.16, 0, 0.3, 0.46);        // 立柱滑架
    cb.box(M.craneOrange, 1.05, 0.08, 1.15, 0, -0.08, -0.05);    // 载货台
    cb.box(M.steelDark, 1.05, 0.1, 0.05, 0, -0.03, -0.62);
    for (const sx of [-1, 1]) {
      cb.box(M.safetyYellow, 0.04, 0.2, 1.1, sx * 0.53, 0.05, -0.05); // 侧挡
      cb.box(M.plasticBlack, 0.06, 0.05, 0.05, sx * 0.53, 0.18, 0.4); // 超宽检测光电
    }
    cb.flush(car);
    g.add(car);

    // 伸缩货叉（两级）
    this.forkStages = [];
    for (let i = 0; i < 2; i++) {
      const st = new THREE.Group();
      const fb = new Batcher();
      for (const sz of [-0.25, 0.25]) {
        fb.box(i === 0 ? M.steelGrey : M.galv, 0.98, 0.045, i === 0 ? 0.14 : 0.11, 0, -0.012 - i * 0.004, sz - 0.05);
      }
      fb.flush(st);
      car.add(st);
      this.forkStages.push(st);
    }
    this.forkTip = this.forkStages[1];

    scene.add(g);
  }

  sync() {
    this.group.position.set(this.x, 0, this.travel.pos);
    this.carriage.position.y = this.lift.pos;
    this.forkStages[0].position.x = this.fork.pos * 0.5;
    this.forkStages[1].position.x = this.fork.pos;
  }

  *pick(z, y, side, take) {
    const C = ASRS.crane;
    yield* all(
      moveAxis(this.travel, z, C.vTravel, C.aTravel),
      moveAxis(this.lift, y - 0.05, C.vLift, C.aLift),
    );
    yield* moveAxis(this.fork, side * FORK_EXT, C.vFork, C.aFork);
    const load = take();
    yield* moveAxis(this.lift, y + 0.07, 0.25, 0.6);
    this.forkTip.attach(load.group);
    yield* moveAxis(this.fork, 0, C.vFork, C.aFork);
    return load;
  }

  *place(load, z, y, side) {
    const C = ASRS.crane;
    yield* all(
      moveAxis(this.travel, z, C.vTravel, C.aTravel),
      moveAxis(this.lift, y + 0.07, C.vLift, C.aLift),
    );
    yield* moveAxis(this.fork, side * FORK_EXT, C.vFork, C.aFork);
    yield* moveAxis(this.lift, y - 0.05, 0.25, 0.6);
    this.asrs.scene.attach(load.group);
    load.group.position.y = y;
    yield* moveAxis(this.fork, 0, C.vFork, C.aFork);
  }

  *storeJob(port) {
    this.state = '入库作业';
    const load = port.acc.head();
    const slot = this.asrs.chooseSlot(this.aisle);
    if (!slot) return;
    slot.incoming = true;
    const zp = cz(ASRS.portRows[0]);
    yield* this.pick(zp, TRANSFER_H, -1, () => port.acc.takeHead());
    yield* this.place(load, slot.pos.z, slot.pos.y, slot.side);
    slot.incoming = false;
    slot.load = load;
    load.history.push('stored');
    this.asrs.events.log('asrs', `堆垛机${this.aisle + 1} 入库 ${load.id} → 货位 ${slot.code}`);
    this.asrs.events.count('stored');
  }

  *retrieveJob(job) {
    this.state = '出库作业';
    const slot = job.slot;
    const port = this.asrs.outPorts[this.aisle];
    const load = yield* this.pick(slot.pos.z, slot.pos.y, slot.side, () => slot.load);
    slot.load = null;
    slot.reserved = false;
    // 等待出库口空位
    while (!port.acc.canEnter()) yield;
    const zp = cz(ASRS.portRows[0]);
    yield* this.place(load, zp, TRANSFER_H, 1);
    port.acc.put(load);
    this.asrs.events.log('asrs', `堆垛机${this.aisle + 1} 出库 ${load.id} ← 货位 ${slot.code}`);
    this.asrs.events.count('retrieved');
  }

  *idleHome() {
    this.state = '待机';
    const C = ASRS.crane;
    yield* all(
      moveAxis(this.travel, cz(ASRS.portRows[0]) - CELL * 0.5, C.vTravel, C.aTravel),
      moveAxis(this.lift, TRANSFER_H + 0.3, C.vLift, C.aLift),
    );
  }

  nextJob() {
    const inPort = this.asrs.inPorts[this.aisle];
    const outPort = this.asrs.outPorts[this.aisle];
    const storeReady = inPort.acc.head() && !inPort.acc.moving && this.asrs.freeSlots(this.aisle) > 0;
    const retrieve = this.jobs.length > 0 && outPort.acc.count < 2 ? this.jobs[0] : null;
    // 出入库交替（复合作业），避免任一方向饥饿
    let pick = null;
    if (storeReady && retrieve) pick = this.lastType === 'store' ? 'retrieve' : 'store';
    else if (storeReady) pick = 'store';
    else if (retrieve) pick = 'retrieve';
    if (pick === 'store') {
      this.lastType = 'store';
      return this.storeJob(inPort);
    }
    if (pick === 'retrieve') {
      this.lastType = 'retrieve';
      this.jobs.shift();
      return this.retrieveJob(retrieve);
    }
    return null;
  }

  update(dt) {
    if (this.proc && this.proc.step(dt)) {
      if (this.state !== '待机') this.cycles++;
      this.proc = null;
    }
    if (!this.proc) {
      const job = this.nextJob();
      if (job) this.proc = new Proc(job);
      else if (this.state !== '待机' && this.state !== '空闲') this.proc = new Proc(this.idleHome());
      else this.state = '空闲';
    }
    if (this.state !== '空闲' && this.state !== '待机') this.busyTime += dt;
    this.sync();
    const moving = Math.abs(this.travel.vel) + Math.abs(this.lift.vel) + Math.abs(this.fork.vel) > 0.01;
    this.beacon.material.emissiveIntensity = moving ? (Math.sin(performance.now() / 120) > 0 ? 2.2 : 0.2) : 0.3;
  }
}
