// 时间最优 A*：状态 = (格子, 朝向)，代价 = 行驶时间 + 原地转向时间 + 交通惩罚
// 差速 AGV 在二维码网格上只能直行，转弯须停车原地旋转，因此转向代价显著。
import { COLS, ROWS, CELL, AMR } from '../config.js';
import { DIRS } from './grid.js';

const N = COLS * ROWS;
const g = new Float32Array(N * 4);
const closed = new Uint8Array(N * 4);
const parent = new Int32Array(N * 4);
const stamp = new Uint32Array(N * 4);
let epoch = 1;

class Heap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p];
      i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop(), lv = v.pop();
    const n = k.length;
    if (n > 0) {
      let i = 0;
      while (true) {
        let l = 2 * i + 1;
        if (l >= n) break;
        if (l + 1 < n && k[l + 1] < k[l]) l++;
        if (k[l] >= lk) break;
        k[i] = k[l]; v[i] = v[l];
        i = l;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
  get size() {
    return this.k.length;
  }
}

/**
 * @param grid    Grid
 * @param start   {c, r}
 * @param startDir 0..3 当前朝向
 * @param goal    {c, r}
 * @param opts    { robot, avoid:Set<number>, loaded:boolean, heat:boolean }
 * @returns 路径格子数组（不含起点），或 null
 */
export function findPath(grid, start, startDir, goal, opts = {}) {
  const { robot = null, avoid = null, loaded = false } = opts;
  if (grid.isBlocked(goal.c, goal.r)) return null;
  if (start.c === goal.c && start.r === goal.r) return [];

  epoch++;
  const v = loaded ? AMR.vLoaded : AMR.vEmpty;
  const stepT = CELL / v;                       // 单格行驶时间
  const turnT = Math.PI / 2 / AMR.rot + 0.9;    // 90°转向 + 减速/再加速损失
  const goalI = grid.idx(goal.c, goal.r);
  const h = (c, r) => (Math.abs(c - goal.c) + Math.abs(r - goal.r)) * stepT;

  const heap = new Heap();
  const s0 = grid.idx(start.c, start.r) * 4 + startDir;
  stamp[s0] = epoch;
  g[s0] = 0;
  parent[s0] = -1;
  closed[s0] = 0;
  heap.push(h(start.c, start.r), s0);

  let found = -1;
  while (heap.size > 0) {
    const s = heap.pop();
    if (closed[s] && stamp[s] === epoch) continue;
    closed[s] = 1;
    const cell = s >> 2;
    const dir = s & 3;
    if (cell === goalI) {
      found = s;
      break;
    }
    const c = cell % COLS;
    const r = (cell / COLS) | 0;

    for (let nd = 0; nd < 4; nd++) {
      const D = DIRS[nd];
      const nc = c + D.dc, nr = r + D.dr;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
      const ni = nr * COLS + nc;
      if (grid.blocked[ni]) continue;
      if (avoid && avoid.has(ni) && ni !== goalI) continue;

      let cost = stepT;
      const turns = nd === dir ? 0 : nd === ((dir + 2) & 3) ? 2 : 1;
      cost += turns * turnT;
      const owner = grid.claims[ni];
      if (owner && owner !== robot) cost += owner.isParked ? 6 : 2.5;
      cost += Math.min(grid.waiting[ni] * 0.002, 0.6); // 历史拥堵软惩罚

      const ns = ni * 4 + nd;
      const ng = g[s] + cost;
      if (stamp[ns] === epoch && (closed[ns] || g[ns] <= ng)) continue;
      stamp[ns] = epoch;
      closed[ns] = 0;
      g[ns] = ng;
      parent[ns] = s;
      heap.push(ng + h(nc, nr), ns);
    }
  }
  if (found < 0) return null;

  const path = [];
  let s = found;
  while (parent[s] !== -1) {
    const cell = s >> 2;
    path.push({ c: cell % COLS, r: (cell / COLS) | 0 });
    s = parent[s];
  }
  return path.reverse();
}
