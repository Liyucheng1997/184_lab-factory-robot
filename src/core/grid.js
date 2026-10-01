// 导航网格：静态障碍 + 动态格子预约（机器人互斥） + 交通统计（热力图）
import { COLS, ROWS, CELL } from '../config.js';

export const DIRS = [
  { dc: 0, dr: 1, yaw: 0 },              // 0 南 +z
  { dc: 1, dr: 0, yaw: Math.PI / 2 },    // 1 东 +x
  { dc: 0, dr: -1, yaw: Math.PI },       // 2 北 -z
  { dc: -1, dr: 0, yaw: -Math.PI / 2 },  // 3 西 -x
];

export function yawToDir(yaw) {
  const a = Math.atan2(Math.sin(yaw), Math.cos(yaw));
  const i = Math.round(a / (Math.PI / 2));
  // i: 0 南, 1 东, ±2 北, -1 西
  return [2, 3, 0, 1, 2][i + 2];
}

export function dirBetween(a, b) {
  if (b.c > a.c) return 1;
  if (b.c < a.c) return 3;
  if (b.r > a.r) return 0;
  return 2;
}

export class Grid {
  constructor() {
    this.n = COLS * ROWS;
    this.blocked = new Uint8Array(this.n);
    this.claims = new Array(this.n).fill(null);
    this.traffic = new Float32Array(this.n);   // 通过次数
    this.waiting = new Float32Array(this.n);   // 累计等待秒数
  }

  idx(c, r) {
    return r * COLS + c;
  }

  key(c, r) {
    return r * COLS + c;
  }

  inBounds(c, r) {
    return c >= 0 && c < COLS && r >= 0 && r < ROWS;
  }

  block(c, r) {
    if (this.inBounds(c, r)) this.blocked[this.idx(c, r)] = 1;
  }

  blockRect(c0, r0, c1, r1) {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.block(c, r);
  }

  unblock(c, r) {
    if (this.inBounds(c, r)) this.blocked[this.idx(c, r)] = 0;
  }

  isBlocked(c, r) {
    return !this.inBounds(c, r) || this.blocked[this.idx(c, r)] === 1;
  }

  claimedBy(c, r) {
    if (!this.inBounds(c, r)) return null;
    return this.claims[this.idx(c, r)];
  }

  // 预约格子：成功返回 true；已被其他机器人预约返回 false
  tryClaim(c, r, robot) {
    if (this.isBlocked(c, r)) return false;
    const i = this.idx(c, r);
    const owner = this.claims[i];
    if (owner && owner !== robot) return false;
    if (!owner) this.traffic[i] += 1;
    this.claims[i] = robot;
    return true;
  }

  release(c, r, robot) {
    if (!this.inBounds(c, r)) return;
    const i = this.idx(c, r);
    if (this.claims[i] === robot) this.claims[i] = null;
  }

  addWait(c, r, dt) {
    if (this.inBounds(c, r)) this.waiting[this.idx(c, r)] += dt;
  }

  cellToWorld(c, r, y = 0) {
    return {
      x: (c - COLS / 2 + 0.5) * CELL,
      y,
      z: (r - ROWS / 2 + 0.5) * CELL,
    };
  }

  worldToCell(x, z) {
    return {
      c: Math.round(x / CELL + COLS / 2 - 0.5),
      r: Math.round(z / CELL + ROWS / 2 - 0.5),
    };
  }
}

// 连续格坐标 → 世界坐标（允许小数格，用于设备摆放）
export function cx(c) {
  return (c - COLS / 2 + 0.5) * CELL;
}
export function cz(r) {
  return (r - ROWS / 2 + 0.5) * CELL;
}
