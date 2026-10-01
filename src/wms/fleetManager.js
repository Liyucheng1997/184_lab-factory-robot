// 车队管理系统 FMS + 仓储任务管理：任务生成 → 成本最优分配 → 执行跟踪；充电/泊车策略；让行协调；KPI
import * as THREE from 'three';
import { BATTERY, AMR, CELL, COLS, ROWS } from '../config.js';
import { DIRS } from '../core/grid.js';

export const TASK_TYPES = {
  INBOUND: { label: '入库搬运', short: '入库', priority: 1, color: '#4fc3f7' },
  FEED: { label: '产线配送', short: '配送', priority: 2, color: '#ffb74d' },
  OUTBOUND: { label: '成品下线', short: '下线', priority: 3, color: '#81c784' },
};

export class FleetManager {
  constructor({ grid, scene, robots, asrs, cells, docks, chargers, parking, events }) {
    this.grid = grid;
    this.robots = robots;
    this.asrs = asrs;
    this.cells = cells;
    this.lanes = cells.flatMap((c) => c.lanes);
    this.docks = docks;
    this.chargers = chargers;
    this.parking = parking;
    this.events = events;
    this.queue = [];
    this.active = [];
    this.history = [];
    this.seq = 1;
    this.timer = 0;
    this.leadTimes = [];
    this.autoFeed = true;

    for (const p of asrs.inPorts) p.reservedCount = 0;
    this.stationCells = new Set();
    const mark = (c) => this.stationCells.add(grid.idx(c.c, c.r));
    for (const s of [...asrs.inPorts, ...asrs.outPorts, ...this.lanes, ...docks.recv, ...docks.ship]) mark(s.dock);
    for (const ch of chargers) mark(ch.cell);

    for (const r of robots) {
      r.onYieldRequest = (req) => this.handleYield(r, req);
      r.fleet = this;
    }
    this.holds = new Map(); // robot -> 等待位格索引

    // 格预约可视化
    const geo = new THREE.PlaneGeometry(CELL * 0.92, CELL * 0.92).rotateX(-Math.PI / 2);
    this.claimMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.22, depthWrite: false,
    }), 160);
    this.claimMesh.renderOrder = 1;
    this.claimMesh.frustumCulled = false;
    this.claimMesh.count = 0;
    scene.add(this.claimMesh);
    this.showClaims = true;
  }

  // ------------------------------------------------------------ 任务
  createTask(type, from, to, load) {
    const T = TASK_TYPES[type];
    const task = {
      id: 'T' + String(this.seq++).padStart(5, '0'),
      type, label: T.label, priority: T.priority,
      from, to, load,
      created: this.events.time, assigned: null, picked: null, done: null,
      status: 'queued', robot: null,
      onDone: (t) => this.complete(t),
    };
    this.queue.push(task);
    return task;
  }

  complete(task) {
    task.done = this.events.time;
    this.active = this.active.filter((t) => t !== task);
    this.history.unshift(task);
    if (this.history.length > 60) this.history.pop();
    if (task.type === 'INBOUND') task.to.reservedCount--;
    this.leadTimes.push(task.done - task.created);
    if (this.leadTimes.length > 100) this.leadTimes.shift();
    this.events.count('tasks');
    this.events.count('task_' + task.type);
  }

  generate() {
    const { asrs, docks } = this;
    // 1) 入库：收货月台交接位有货 → 选择负载最小的立库入库口
    for (const d of docks.recv) {
      if (!d.ready() || d.pendingPick) continue;
      let best = null, bestScore = Infinity;
      for (const p of asrs.inPorts) {
        const crane = asrs.cranes[p.aisle];
        const backlog = p.reservedCount + p.acc.count;
        if (p.reservedCount >= 2 || asrs.freeSlots(p.aisle) <= backlog) continue;
        const dist = Math.abs(p.dock.c - d.dock.c) + Math.abs(p.dock.r - d.dock.r);
        const score = backlog * 6 + crane.workload * 3 + dist * 0.25;
        if (score < bestScore) {
          bestScore = score;
          best = p;
        }
      }
      if (!best) continue;
      const t = this.createTask('INBOUND', d, best, d.ready());
      d.pendingPick = t;
      best.reservedCount++;
    }
    // 2) 产线叫料：空闲工位向立库发起出库请求（拉动式）
    if (this.autoFeed) {
      for (const lane of this.lanes) {
        if (lane.state === 'empty' && asrs.stock > 0 && asrs.requestRetrieval(lane)) {
          lane.state = 'requested';
          this.events.log('wms', `${lane.name} 叫料，立库生成出库单`);
        }
      }
    }
    // 3) 配送：出库口有货 → 送往目标工位
    for (const op of asrs.outPorts) {
      const l = op.ready();
      if (!l || op.pendingPick) continue;
      op.pendingPick = this.createTask('FEED', op, l.dest, l);
    }
    // 4) 下线：工位成品待取 → 发货月台（优先装满在位车辆）
    for (const lane of this.lanes) {
      if (lane.state !== 'done' || lane.pendingPick) continue;
      let best = null, bestScore = Infinity;
      for (const d of docks.ship) {
        const left = d.capacityLeft();
        if (left <= 0) continue;
        const score = (d.docked ? 0 : 20) + left * 2 + Math.abs(d.dock.r - lane.dock.r) * 0.2;
        if (score < bestScore) {
          bestScore = score;
          best = d;
        }
      }
      if (!best) continue;
      best.reserved++;
      lane.pendingPick = this.createTask('OUTBOUND', lane, best, lane.load);
    }
  }

  // 成本：预计空驶时间 + 电量惩罚 + 打断充电惩罚
  cost(robot, task) {
    const a = robot.cell, b = task.from.dock;
    const manh = Math.abs(a.c - b.c) + Math.abs(a.r - b.r);
    let c = (manh * CELL) / AMR.vEmpty + (a.c !== b.c && a.r !== b.r ? 2 : 0);
    if (robot.mode === 'CHARGING') c += 15 + (100 - robot.soc) * 0.4;
    if (robot.soc < 40) c += (40 - robot.soc) * 1.5;
    if (robot.mode === 'YIELD') c += 3;
    return c;
  }

  assign() {
    if (!this.queue.length) return;
    this.queue.sort((a, b) => b.priority - a.priority || a.created - b.created);
    const free = this.robots.filter((r) => r.available && !r.task);
    for (const task of [...this.queue]) {
      if (!free.length) break;
      let best = null, bestC = Infinity;
      for (const r of free) {
        const c = this.cost(r, task);
        if (c < bestC) {
          bestC = c;
          best = r;
        }
      }
      // 正在充电的低电量车不轻易打断
      if (best.mode === 'CHARGING' && best.soc < 75 && free.some((r) => r.mode !== 'CHARGING')) {
        const alt = free.filter((r) => r.mode !== 'CHARGING').sort((x, y) => this.cost(x, task) - this.cost(y, task))[0];
        if (alt) best = alt;
      }
      free.splice(free.indexOf(best), 1);
      this.queue.splice(this.queue.indexOf(task), 1);
      task.robot = best;
      task.assigned = this.events.time;
      task.status = 'assigned';
      this.active.push(task);
      best.assign(task);
      this.events.log('fms', `${task.id} ${task.label} ${task.from.name} → ${task.to.name} 指派 ${best.name}`);
    }
  }

  // ------------------------------------------------------------ 能源 / 泊车
  freeCharger(robot) {
    let best = null, bd = Infinity;
    for (const ch of this.chargers) {
      if (ch.reserved && ch.reserved !== robot) continue;
      const d = Math.abs(ch.c - robot.cell.c) + Math.abs(ch.r - robot.cell.r);
      if (d < bd) {
        bd = d;
        best = ch;
      }
    }
    return best;
  }

  freeParking(robot) {
    let best = null, bd = Infinity;
    for (const p of this.parking) {
      if (p.reserved && p.reserved !== robot) continue;
      if (this.grid.claimedBy(p.c, p.r) && this.grid.claimedBy(p.c, p.r) !== robot) continue;
      const d = Math.abs(p.c - robot.cell.c) + Math.abs(p.r - robot.cell.r);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  manageIdle() {
    for (const r of this.robots) {
      if (r.task || r.fault > 0) continue;
      const atRest = !r.proc || (r.mode === 'IDLE' && r.isParked);
      if (!atRest) continue;
      const onCharger = r.charger && r.charger.reserved === r;
      const needCharge = r.soc < BATTERY.low || (r.soc < BATTERY.opportunity && !onCharger);
      if (needCharge && !onCharger) {
        let ch = this.freeCharger(r);
        if (!ch && r.soc < BATTERY.low) {
          // 抢占：让已充满、空闲在桩上的车让出充电桩
          const full = this.robots.find((o) => o !== r && o.charger && o.mode === 'IDLE' && o.soc > 90 && !o.task);
          if (full) {
            ch = full.charger;
            full.abortActivity();
          }
        }
        if (ch) {
          r.abortActivity();
          r.start(r.goCharge(ch), 'TO_CHARGE');
          if (r.soc < BATTERY.low) this.events.log('fleet', `${r.name} 电量低 (${r.soc.toFixed(0)}%)，前往 ${ch.id}`, 'warn');
          continue;
        }
      }
      if (!r.proc) {
        const p = this.freeParking(r);
        if (p) r.start(r.goPark(p), 'PARK');
      }
    }
  }

  // ------------------------------------------------------------ 排队等待位 / 脱困
  // BFS 搜索空闲格：非障碍、未预约、非站台/充电停靠点、未被他车占作等待位
  searchFree(from, minDepth, maxDepth, accept) {
    const seen = new Set([this.grid.idx(from.c, from.r)]);
    let frontier = [from];
    for (let depth = 1; depth <= maxDepth; depth++) {
      const next = [];
      for (const c of frontier) {
        for (const D of DIRS) {
          const nc = c.c + D.dc, nr = c.r + D.dr;
          if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
          const i = this.grid.idx(nc, nr);
          if (seen.has(i) || this.grid.isBlocked(nc, nr)) continue;
          seen.add(i);
          const n = { c: nc, r: nr };
          next.push(n);
          if (depth >= minDepth && !this.stationCells.has(i) && !this.grid.claimedBy(nc, nr) && accept(n, i)) return n;
        }
      }
      frontier = next;
    }
    return null;
  }

  holdingCell(dock, robot) {
    const taken = new Set(this.holds.values());
    const cell = this.searchFree(dock, 2, 6, (n, i) => !taken.has(i));
    if (cell) this.holds.set(robot, this.grid.idx(cell.c, cell.r));
    return cell;
  }

  releaseHold(robot) {
    this.holds.delete(robot);
  }

  evadeCell(robot, goal) {
    const taken = new Set(this.holds.values());
    const gi = this.grid.idx(goal.c, goal.r);
    return this.searchFree(robot.cell, 1, 3, (n, i) => i !== gi && !taken.has(i));
  }

  // ------------------------------------------------------------ 让行
  handleYield(robot, requester) {
    if (robot.task || !robot.isParked) return;
    if (this.events.time - (robot.lastYield || -99) < 3) return;
    robot.lastYield = this.events.time;
    const avoid = new Set();
    for (const c of requester.path.slice(0, 8)) avoid.add(this.grid.idx(c.c, c.r));
    if (requester.goal) avoid.add(this.grid.idx(requester.goal.c, requester.goal.r));
    // BFS 找最近的空闲格
    const start = robot.cell;
    const seen = new Set([this.grid.idx(start.c, start.r)]);
    let frontier = [start];
    let target = null;
    for (let depth = 0; depth < 6 && !target; depth++) {
      const next = [];
      for (const c of frontier) {
        for (const D of DIRS) {
          const nc = c.c + D.dc, nr = c.r + D.dr;
          const i = this.grid.idx(nc, nr);
          if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS || seen.has(i) || this.grid.isBlocked(nc, nr)) continue;
          seen.add(i);
          const n = { c: nc, r: nr };
          if (depth >= 1 && !avoid.has(i) && !this.stationCells.has(i) && !this.grid.claimedBy(nc, nr)) {
            target = n;
            break;
          }
          if (!this.grid.claimedBy(nc, nr) || this.grid.claimedBy(nc, nr) === robot) next.push(n);
        }
        if (target) break;
      }
      frontier = next;
    }
    if (!target) return;
    robot.abortActivity();
    robot.start(robot.yieldTo(target), 'YIELD');
    this.events.count('yields');
    this.events.log('fms', `${robot.name} 为 ${requester.name} 让行`);
  }

  // ------------------------------------------------------------ 主循环
  update(dt) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.25;
      this.generate();
      this.assign();
      this.manageIdle();
    }
  }

  updateClaims() {
    const mesh = this.claimMesh;
    mesh.visible = this.showClaims;
    if (!this.showClaims) return;
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    let n = 0;
    const claims = this.grid.claims;
    for (let i = 0; i < claims.length && n < mesh.instanceMatrix.count; i++) {
      const r = claims[i];
      if (!r) continue;
      const c = i % COLS, rr = (i / COLS) | 0;
      const w = this.grid.cellToWorld(c, rr);
      m.makeTranslation(w.x, 0.02, w.z);
      mesh.setMatrixAt(n, m);
      mesh.setColorAt(n, col.setHex(r.color));
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------------ KPI
  kpi() {
    const ev = this.events;
    const T = Math.max(ev.time, 1);
    let busy = 0, energy = 0, dist = 0, wait = 0;
    for (const r of this.robots) {
      busy += r.stats.busy;
      energy += r.stats.energy;
      dist += r.stats.dist;
      wait += r.stats.wait;
    }
    const lt = this.leadTimes;
    const avgLead = lt.length ? lt.reduce((a, b) => a + b, 0) / lt.length : 0;
    const cellRun = this.cells.reduce((a, c) => a + c.runTime, 0);
    return {
      shipped: this.docks.shipped,
      throughput: ev.ratePerHour('shipped'),
      parts: ev.get('parts'),
      tasks: ev.get('tasks'),
      utilization: busy / (T * this.robots.length),
      cellUtil: cellRun / (T * this.cells.length),
      energy,
      dist,
      wait,
      avgLead,
      stock: this.asrs.stock,
      occupancy: this.asrs.occupied / this.asrs.capacity,
      queue: this.queue.length,
      active: this.active.length,
      yields: ev.get('yields'),
      safetyStops: ev.get('safetyStops'),
    };
  }
}
