// AMR 控制器：运动学（梯形速度、原地转向）、前瞻格预约与制动距离、阻塞重规划/让行、
// 辊筒移载、电池模型（放电/恒流-恒压充电）、安全停车故障注入
import * as THREE from 'three';
import { AMR, BATTERY, CELL, TRANSFER_H } from '../config.js';
import { DIRS, dirBetween, yawToDir } from '../core/grid.js';
import { findPath } from '../core/astar.js';
import { Proc, wait, tween, smooth } from '../core/proc.js';
import { buildAMR, drawAMRScreen } from './amrModel.js';

const HALF = AMR.length / 2 + 0.03;
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export const MODE_LABEL = {
  IDLE: '空闲',
  PARK: '前往停车位',
  TO_PICK: '前往取货',
  PICKING: '取货移载',
  TO_DROP: '负载运输',
  DROPPING: '卸货移载',
  TO_CHARGE: '前往充电',
  CHARGING: '充电中',
  YIELD: '避让',
  FAULT: '安全停车',
};

export class Robot {
  constructor({ id, color, cell, grid, scene, events }) {
    this.id = id;
    this.name = `AMR-${String(id).padStart(2, '0')}`;
    this.color = color;
    this.grid = grid;
    this.scene = scene;
    this.events = events;

    this.cell = { ...cell };
    this.dir = 0;
    this.yaw = 0;
    this.v = 0;
    this.omega = 0;
    this.pos = new THREE.Vector3();
    this.path = [];
    this.goal = null;
    this.load = null;
    this.task = null;
    this.mode = 'IDLE';
    this.proc = null;
    this.waiting = 0;
    this.blockedBy = null;
    this.fault = 0;
    this.soc = 55 + Math.random() * 45;
    this.charger = null;
    this.parking = null;
    this.stats = { dist: 0, busy: 0, idle: 0, wait: 0, charge: 0, energy: 0, tasks: 0, replans: 0 };
    this.showPath = true;
    this.showField = true;
    this.atCenter = true;

    grid.tryClaim(cell.c, cell.r, this);
    const p = grid.cellToWorld(cell.c, cell.r);
    this.pos.set(p.x, 0, p.z);

    this.parts = buildAMR(id, color);
    this.group = this.parts.group;
    this.group.userData.robot = this;
    scene.add(this.group);

    this.pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0.9, depthWrite: false,
    }));
    this.pathLine.frustumCulled = false;
    this.pathLine.renderOrder = 3;
    scene.add(this.pathLine);
    this.goalMarker = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 4, 1).rotateX(-Math.PI / 2).rotateY(Math.PI / 4),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
    this.goalMarker.renderOrder = 3;
    scene.add(this.goalMarker);

    this.screenTimer = Math.random();
    this.sync();
  }

  // ------------------------------------------------------------ 状态查询
  // 静止且无任务（可被请求让行）
  get isParked() {
    return this.v === 0 && !this.task && this.fault <= 0 &&
      (this.mode === 'IDLE' || (this.mode === 'PARK' && this.path.length === 0));
  }

  get available() {
    if (this.fault > 0 || this.soc < BATTERY.critical) return false;
    if (!this.proc) return true;
    if (this.v > 0 || !this.atCenter) return false; // 只在格心安全点打断当前活动
    if (this.mode === 'PARK' || this.mode === 'IDLE' || this.mode === 'YIELD') return true;
    if (this.mode === 'CHARGING' && this.soc >= BATTERY.release) return true;
    return false;
  }

  get isWaiting() {
    return this.waiting > 0.3;
  }

  // ------------------------------------------------------------ 活动入口
  start(gen, mode) {
    this.mode = mode;
    this.proc = new Proc(gen);
  }

  abortActivity() {
    // 中断停车/充电/避让（仅在静止或安全点调用）
    if (this.charger) {
      this.charger.robot = null;
      this.charger.reserved = null;
      this.charger = null;
    }
    if (this.parking) {
      this.parking.reserved = null;
      this.parking = null;
    }
    this.proc = null;
    this.path = [];
    this.goal = null;
    this.contactOffset = 0;
    // 释放除当前格外的全部预约，防止残留"幽灵占用"
    const claims = this.grid.claims;
    const keep = this.grid.idx(this.cell.c, this.cell.r);
    for (let i = 0; i < claims.length; i++) if (claims[i] === this && i !== keep) claims[i] = null;
    claims[keep] = this;
  }

  assign(task) {
    this.abortActivity();
    this.task = task;
    this.start(this.runTask(task), 'TO_PICK');
  }

  // ------------------------------------------------------------ 任务流程
  *runTask(task) {
    task.status = 'toPick';
    this.mode = 'TO_PICK';
    yield* this.approach(task.from);
    this.mode = 'PICKING';
    task.status = 'picking';
    yield* this.transferIn(task.from);
    task.from.dockLock = null;
    task.picked = this.events.time;
    task.status = 'toDrop';
    this.mode = 'TO_DROP';
    yield* this.approach(task.to);
    this.mode = 'DROPPING';
    task.status = 'dropping';
    yield* this.transferOut(task.to);
    task.to.dockLock = null;
    task.status = 'done';
    this.stats.tasks++;
    this.task = null;
    this.mode = 'IDLE';
    task.onDone(task);
  }

  *goCharge(charger) {
    this.charger = charger;
    charger.reserved = this;
    this.mode = 'TO_CHARGE';
    yield* this.goTo(charger.cell);
    yield* this.rotateTo(0); // 车尾朝向充电刷块
    // 微量后退压紧充电刷
    yield* tween(0.8, (k) => { this.contactOffset = -0.06 * k; });
    charger.robot = this;
    this.mode = 'CHARGING';
    this.events.log('fleet', `${this.name} 开始充电 @${charger.id}（SOC ${this.soc.toFixed(0)}%）`);
    while (this.soc < 99.5) {
      const dt = yield;
      const rate = this.soc < BATTERY.ccLimit ? BATTERY.chargeCC : BATTERY.chargeCV * (1 - (this.soc - BATTERY.ccLimit) / 22);
      this.soc = Math.min(100, this.soc + Math.max(rate, 0.05) * dt);
      this.stats.charge += dt;
    }
    this.events.log('fleet', `${this.name} 充电完成（SOC ${this.soc.toFixed(0)}%）`, 'ok');
    yield* tween(0.6, (k) => { this.contactOffset = -0.06 * (1 - k); });
    charger.robot = null;
    // 充满后保持在桩上待命
    this.mode = 'IDLE';
    while (true) yield;
  }

  *goPark(spot) {
    this.parking = spot;
    spot.reserved = this;
    this.mode = 'PARK';
    yield* this.goTo(spot);
    yield* this.rotateTo(0);
    this.mode = 'IDLE';
    while (true) yield;
  }

  *yieldTo(cell) {
    this.mode = 'YIELD';
    yield* this.goTo(cell);
    this.mode = 'IDLE';
  }

  // 站台停靠点互斥：停靠点被占用时先到附近等待位排队，避免围堵死锁
  *approach(station) {
    if (station.dockLock && station.dockLock !== this) {
      const hold = this.fleet.holdingCell(station.dock, this);
      if (hold) yield* this.goTo(hold, false);
      this.queued = station;
      while (station.dockLock && station.dockLock !== this) {
        this.waiting = 0.01;
        yield;
      }
      this.queued = null;
      this.fleet.releaseHold(this);
    }
    station.dockLock = this;
    yield* this.goTo(station.dock);
  }

  // ------------------------------------------------------------ 导航
  *goTo(goal, canEvade = true) {
    this.goal = { ...goal };
    let avoid = null;
    let fails = 0;
    let stuck = 0;
    while (this.cell.c !== goal.c || this.cell.r !== goal.r) {
      // 连续受阻：侧向避让脱困（打破对称僵局）
      if (canEvade && stuck >= 2 && this.fleet) {
        stuck = 0;
        const side = this.fleet.evadeCell(this, goal);
        if (side) {
          this.stats.evades = (this.stats.evades || 0) + 1;
          this.events.count('evades');
          yield* this.goTo(side, false);
          yield* wait(0.8 + Math.random() * 2.2);
          this.goal = { ...goal };
          continue;
        }
      }
      const path = findPath(this.grid, this.cell, this.dir, goal, { robot: this, avoid, loaded: !!this.load });
      avoid = null;
      if (!path) {
        this.path = [];
        fails++;
        this.waiting += 0.01;
        yield* wait(0.5 + Math.random() * 0.5);
        continue;
      }
      this.path = path;
      let res = true;
      while (this.path.length) {
        const d = dirBetween(this.cell, this.path[0]);
        if (d !== this.dir) yield* this.rotateTo(DIRS[d].yaw);
        let n = 1;
        while (n < this.path.length && dirBetween(this.path[n - 1], this.path[n]) === d) n++;
        res = yield* this.drive(n);
        if (res !== true) break;
      }
      if (res !== true) {
        avoid = new Set([this.grid.idx(res.c, res.r)]);
        this.stats.replans++;
        stuck++;
        if (!canEvade && stuck >= 3) break; // 避让移动本身受阻：放弃，交回上层
      } else stuck = 0;
    }
    this.path = [];
    this.goal = null;
  }

  *rotateTo(yaw) {
    let d = wrapPi(yaw - this.yaw);
    while (Math.abs(d) > 0.004) {
      const dt = yield;
      if (this.fault > 0) continue;
      const maxW = AMR.rot;
      const target = Math.sign(d) * Math.min(maxW, Math.sqrt(2 * 3.0 * Math.abs(d)));
      this.omega += Math.max(-4 * dt, Math.min(4 * dt, target - this.omega));
      const step = this.omega * dt;
      if (Math.abs(step) >= Math.abs(d)) {
        this.yaw = yaw;
        break;
      }
      this.yaw += step;
      d = wrapPi(yaw - this.yaw);
      for (const w of this.parts.wheels) w.rotation.x += step * 1.5 * (w.position.x > 0 ? 1 : -1);
    }
    this.yaw = wrapPi(yaw);
    this.omega = 0;
    this.dir = yawToDir(this.yaw);
  }

  // 沿当前朝向直行 n 格（this.path 前 n 个）；返回 true 或 阻塞格
  *drive(n) {
    const D = DIRS[this.dir];
    const seg = this.path.slice(0, n);
    const start = this.grid.cellToWorld(this.cell.c, this.cell.r);
    const cells = [{ ...this.cell }, ...seg];
    let s = 0;
    let claimed = 0;          // 已预约 seg 格数
    let released = 0;         // cells 中已释放的索引上限
    let idx = 0;              // 当前车体中心所在 cells 索引
    let waitT = 0;
    const waitLimit = AMR.waitReplan[0] + Math.random() * (AMR.waitReplan[1] - AMR.waitReplan[0]);
    const vmax = this.load ? AMR.vLoaded : AMR.vEmpty;

    while (true) {
      const dt = yield;
      let blocker = null;
      // 前瞻预约：覆盖制动距离 + 车身半长 + 余量
      const brake = (this.v * this.v) / (2 * AMR.dec);
      const need = Math.min(n, Math.ceil((s + brake + HALF + 0.15) / CELL));
      while (claimed < need) {
        const c = seg[claimed];
        if (this.grid.tryClaim(c.c, c.r, this)) claimed++;
        else {
          blocker = c;
          break;
        }
      }
      const sLim = claimed * CELL;
      if (sLim - s <= 0.003) s = sLim; // 吸附到格心，避免低速爬行
      const dist = sLim - s;

      if (this.fault > 0) {
        this.v = Math.max(0, this.v - 2.5 * dt); // 安全停车：急减速
      } else {
        let vT = Math.min(vmax, Math.sqrt(2 * AMR.dec * Math.max(dist, 0)));
        vT = dist > 0 ? Math.max(vT, 0.05) : 0;
        if (this.v < vT) this.v = Math.min(vT, this.v + AMR.acc * dt);
        else this.v = Math.max(vT, this.v - AMR.dec * 1.8 * dt);
      }
      let ds = this.v * dt;
      if (s + ds >= sLim) {
        // 到达预约边界（终点或前方受阻）：停在格心
        ds = sLim - s;
        this.v = 0;
      }
      s += ds;
      if (Math.abs(sLim - s) < 1e-4) s = sLim;
      this.atCenter = Math.abs(s - Math.round(s / CELL) * CELL) < 1e-3;
      this.stats.dist += ds;
      this.pos.set(start.x + D.dc * s, 0, start.z + D.dr * s);
      for (const w of this.parts.wheels) w.rotation.x += ds / 0.09;

      // 车体中心所在格 / 尾部已离开的格 → 释放
      const ci = Math.min(n, Math.round(s / CELL));
      while (idx < ci) {
        idx++;
        this.cell = { ...cells[idx] };
        this.path.shift();
      }
      while (released < idx && (released * CELL + CELL / 2) < s - HALF) {
        this.grid.release(cells[released].c, cells[released].r, this);
        released++;
      }

      if (s >= n * CELL - 1e-4) {
        this.v = 0;
        this.atCenter = true;
        for (let i = released; i < n; i++) this.grid.release(cells[i].c, cells[i].r, this);
        this.waiting = 0;
        this.blockedBy = null;
        return true;
      }

      // 阻塞等待
      if (this.v === 0 && blocker && s === sLim) {
        waitT += dt;
        this.waiting = waitT;
        this.stats.wait += dt;
        this.grid.addWait(blocker.c, blocker.r, dt);
        const owner = this.grid.claimedBy(blocker.c, blocker.r);
        this.blockedBy = owner;
        if (owner && owner.isParked && owner.onYieldRequest) owner.onYieldRequest(this);
        if (waitT > waitLimit) {
          // 释放已越过的格，仅保留当前格，交由上层绕行重规划
          for (let i = released; i < idx; i++) this.grid.release(cells[i].c, cells[i].r, this);
          this.waiting = 0;
          return blocker;
        }
      } else if (this.v > 0) {
        waitT = 0;
        this.waiting = 0;
        this.blockedBy = null;
      }
    }
  }

  // ------------------------------------------------------------ 辊筒移载
  *transferIn(station) {
    yield* this.rotateTo(station.yaw);
    while (!station.ready()) {
      this.waiting = 0.01;
      yield;
    }
    const load = station.take();
    station.pendingPick = null;
    this.events.log('fleet', `${this.name} 从 ${station.name} 取货 ${load.id}`);
    yield* this.roll(station, load, true);
    this.load = load;
    load.history.push('onAMR');
  }

  *transferOut(station) {
    yield* this.rotateTo(station.yaw);
    while (!station.canAccept()) {
      this.waiting = 0.01;
      yield;
    }
    const load = this.load;
    yield* this.roll(station, load, false);
    this.load = null;
    station.accept(load);
    this.events.log('fleet', `${this.name} 卸货 ${load.id} → ${station.name}`);
  }

  *roll(station, load, inbound) {
    this.waiting = 0;
    const p = this.parts;
    this.scene.attach(load.group);
    const robotPt = new THREE.Vector3(this.pos.x, TRANSFER_H, this.pos.z);
    const from = inbound ? load.group.position.clone() : robotPt;
    const to = inbound ? robotPt : station.handoff.clone();
    const yaw0 = load.group.rotation.y;
    const yaw1 = inbound ? this.yaw : station.loadYaw;
    const dy = wrapPi(yaw1 - yaw0);
    // 挡停放倒 → 辊筒转动 → 挡停复位
    yield* tween(0.35, (k) => p.stoppers.forEach((s) => { s.rotation.x = s.userData.s * k * 1.4; }));
    station.setRoll(true);
    this.rolling = true;
    yield* tween(AMR.transferTime, (k) => {
      load.group.position.lerpVectors(from, to, k);
      load.group.rotation.y = yaw0 + dy * k;
    }, (k) => smooth(k));
    this.rolling = false;
    station.setRoll(false);
    yield* tween(0.35, (k) => p.stoppers.forEach((s) => { s.rotation.x = s.userData.s * (1 - k) * 1.4; }));
    if (inbound) {
      this.group.attach(load.group);
      load.group.position.set(0, TRANSFER_H, 0);
      load.group.rotation.set(0, 0, 0);
    }
  }

  // ------------------------------------------------------------ 每帧
  update(dt) {
    // 安全扫描故障注入：运行中偶发障碍物入侵保护区
    if (this.fault > 0) {
      this.fault -= dt;
      if (this.fault <= 0) this.events.log('fleet', `${this.name} 障碍物清除，恢复运行`, 'ok');
    } else if (this.v > 0.6 && Math.random() < dt / 900) {
      this.fault = 3 + Math.random() * 4;
      this.events.log('fleet', `${this.name} 激光扫描保护区入侵，安全停车`, 'warn');
      this.events.count('safetyStops');
    }

    if (this.proc && this.proc.step(dt)) {
      this.proc = null;
      if (this.mode !== 'IDLE') this.mode = 'IDLE';
    }

    // 电池
    const busy = this.mode !== 'IDLE' && this.mode !== 'CHARGING' && this.mode !== 'PARK';
    let drain = BATTERY.idle + BATTERY.move * (this.v / AMR.vEmpty) + (this.load ? BATTERY.loaded * (this.v > 0 ? 1 : 0.3) : 0);
    if (this.rolling) drain += BATTERY.transfer;
    if (Math.abs(this.omega) > 0) drain += BATTERY.move * 0.4;
    if (this.mode !== 'CHARGING') {
      this.soc = Math.max(0, this.soc - drain * dt);
      this.stats.energy += (drain * dt) / 100 * BATTERY.capacityKWh;
    }
    if (busy) this.stats.busy += dt;
    else if (this.mode !== 'CHARGING') this.stats.idle += dt;

    this.sync(dt);
  }

  sync(dt = 0) {
    const g = this.group;
    const off = this.contactOffset || 0;
    g.position.set(this.pos.x + Math.sin(this.yaw) * off, 0, this.pos.z + Math.cos(this.yaw) * off);
    g.rotation.y = this.yaw;
    const p = this.parts;
    if (this.rolling) p.rollerTex.offset.x -= dt * 3;

    // LED 灯带：状态色
    let col = 0x3fb6ff;
    let pulse = 0.4;
    if (this.fault > 0) { col = 0xff1744; pulse = 1; }
    else if (this.isWaiting) { col = 0xffc400; pulse = 0.6; }
    else if (this.mode === 'CHARGING') { col = 0x00e676; pulse = 0.3; }
    else if (this.mode === 'PICKING' || this.mode === 'DROPPING') { col = 0xffd740; }
    else if (this.mode === 'IDLE' || this.mode === 'PARK') { col = 0x80cbc4; pulse = 0.15; }
    else if (this.load) col = 0x2979ff;
    const t = this.events.time;
    p.ledMat.color.setHex(col);
    p.ledMat.emissive.setHex(col);
    p.ledMat.emissiveIntensity = 1.6 + pulse * Math.sin(t * (this.fault > 0 ? 14 : 5));
    p.beaconMat.emissiveIntensity = this.v > 0.05 || this.rolling ? (Math.sin(t * 9) > 0 ? 2.5 : 0.1) : 0.15;

    // 安全防护场随速度伸缩
    const show = this.showField && this.mode !== 'CHARGING';
    p.warnField.visible = p.protField.visible = show;
    if (show) {
      const v = this.v;
      const prot = 0.25 + v * 0.55;
      const warn = prot + 0.35 + v * 0.8;
      p.protField.scale.set(AMR.width + 0.1, 1, prot);
      p.warnField.scale.set(AMR.width + 0.3, 1, warn);
      p.protField.material.opacity = this.fault > 0 ? 0.55 : 0.26;
    }

    // 尾屏刷新
    this.screenTimer -= dt;
    if (this.screenTimer <= 0) {
      this.screenTimer = 1;
      drawAMRScreen(p, this.id, this.soc, this.fault > 0 ? 'E-STOP' : this.mode.slice(0, 7));
    }

    // 路径线
    const active = this.showPath && (this.path.length > 0);
    this.pathLine.visible = active;
    this.goalMarker.visible = active && !!this.goal;
    if (active) {
      const pts = [new THREE.Vector3(this.pos.x, 0.05, this.pos.z)];
      for (const c of this.path) {
        const w = this.grid.cellToWorld(c.c, c.r, 0.05);
        pts.push(new THREE.Vector3(w.x, w.y, w.z));
      }
      this.pathLine.geometry.setFromPoints(pts);
      if (this.goal) {
        const w = this.grid.cellToWorld(this.goal.c, this.goal.r);
        this.goalMarker.position.set(w.x, 0.04, w.z);
        this.goalMarker.rotation.y = t * 1.5;
      }
    }
  }
}
