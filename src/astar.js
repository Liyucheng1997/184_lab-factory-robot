// 网格 A* 寻路（4 邻域，曼哈顿启发）
// 被其他机器人占用的格子会加惩罚成本，让规划倾向绕开当前交通

export function findPath(grid, start, goal, { avoid = null, robot = null } = {}) {
  if (grid.isBlocked(goal.c, goal.r)) return null;

  const key = (c, r) => c + ',' + r;
  const startK = key(start.c, start.r);
  const goalK = key(goal.c, goal.r);
  if (startK === goalK) return [];

  const h = (c, r) => Math.abs(c - goal.c) + Math.abs(r - goal.r);
  const open = new Map();
  const closed = new Set();
  open.set(startK, { c: start.c, r: start.r, g: 0, f: h(start.c, start.r), parent: null });

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  while (open.size > 0) {
    let cur = null;
    for (const n of open.values()) {
      if (!cur || n.f < cur.f) cur = n;
    }
    const curK = key(cur.c, cur.r);
    if (curK === goalK) {
      const path = [];
      let n = cur;
      while (n && n.parent) {
        path.push({ c: n.c, r: n.r });
        n = n.parent;
      }
      return path.reverse();
    }
    open.delete(curK);
    closed.add(curK);

    for (const [dc, dr] of DIRS) {
      const c = cur.c + dc;
      const r = cur.r + dr;
      const k = key(c, r);
      if (closed.has(k) || grid.isBlocked(c, r)) continue;
      if (avoid && avoid.has(k) && k !== goalK) continue;

      let step = 1;
      const owner = grid.claims.get(k);
      if (owner && owner !== robot) step += 4; // 绕开当前被占用的格子

      const g = cur.g + step;
      const existing = open.get(k);
      if (!existing || g < existing.g) {
        open.set(k, { c, r, g, f: g + h(c, r), parent: cur });
      }
    }
  }
  return null;
}
