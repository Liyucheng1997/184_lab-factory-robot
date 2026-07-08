// 仓库地面网格：负责静态障碍(货架/墙)与动态格子占用(机器人互斥)

export const COLS = 42;
export const ROWS = 26;
export const CELL = 1; // 每格 1 米

export class Grid {
  constructor() {
    this.blocked = new Set(); // 静态障碍格
    this.claims = new Map();  // 动态占用: key -> robot
  }

  key(c, r) {
    return c + ',' + r;
  }

  inBounds(c, r) {
    return c >= 0 && c < COLS && r >= 0 && r < ROWS;
  }

  block(c, r) {
    this.blocked.add(this.key(c, r));
  }

  unblock(c, r) {
    this.blocked.delete(this.key(c, r));
  }

  isBlocked(c, r) {
    return !this.inBounds(c, r) || this.blocked.has(this.key(c, r));
  }

  claimedBy(c, r) {
    return this.claims.get(this.key(c, r)) || null;
  }

  // 机器人尝试占用一个格子，成功返回 true；已被其他机器人占用返回 false
  tryClaim(c, r, robot) {
    const k = this.key(c, r);
    const owner = this.claims.get(k);
    if (owner && owner !== robot) return false;
    this.claims.set(k, robot);
    return true;
  }

  release(c, r, robot) {
    const k = this.key(c, r);
    if (this.claims.get(k) === robot) this.claims.delete(k);
  }

  cellToWorld(c, r, y = 0) {
    return {
      x: (c - COLS / 2 + 0.5) * CELL,
      y,
      z: (r - ROWS / 2 + 0.5) * CELL,
    };
  }
}
