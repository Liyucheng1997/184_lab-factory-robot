// 协程式流程控制：用 generator 描述设备/机器人的时序动作
// 每帧 proc.step(dt)，generator 内 `const dt = yield;` 取得本帧时长

export class Proc {
  constructor(gen) {
    this.gen = gen;
    this.done = false;
    this.gen.next(); // 运行到第一个 yield
  }
  step(dt) {
    if (this.done) return true;
    const r = this.gen.next(dt);
    if (r.done) {
      this.done = true;
      this.value = r.value;
    }
    return this.done;
  }
}

export function* wait(t) {
  while (t > 0) t -= yield;
}

export function* waitUntil(pred) {
  while (!pred()) yield;
}

export const smooth = (k) => k * k * (3 - 2 * k);
export const clamp01 = (k) => (k < 0 ? 0 : k > 1 ? 1 : k);

// 时长固定的插值动作
export function* tween(duration, fn, ease = smooth) {
  let t = 0;
  fn(0);
  while (t < duration) {
    t += yield;
    fn(ease(clamp01(t / duration)));
  }
}

/**
 * 单轴梯形速度曲线运动（带加减速），用于堆垛机行走/升降/货叉等
 * axis: { pos, vel } 对象，target 目标位置
 */
export function* moveAxis(axis, target, vmax, acc) {
  while (true) {
    const dt = yield;
    const d = target - axis.pos;
    const dist = Math.abs(d);
    if (dist < 1e-3 && Math.abs(axis.vel) < 0.05) {
      axis.pos = target;
      axis.vel = 0;
      return;
    }
    const dirn = Math.sign(d);
    const vStop = Math.sqrt(2 * acc * dist);
    const vTarget = dirn * Math.max(Math.min(vmax, vStop), 0.03);
    if (axis.vel < vTarget) axis.vel = Math.min(vTarget, axis.vel + acc * dt);
    else axis.vel = Math.max(vTarget, axis.vel - acc * dt);
    const step = axis.vel * dt;
    if (Math.abs(step) >= dist && Math.sign(step) === dirn) {
      axis.pos = target;
      axis.vel = 0;
      return;
    }
    axis.pos += step;
  }
}

// 并行运行多个子 generator，全部完成后返回
export function* all(...gens) {
  const procs = gens.map((g) => new Proc(g));
  while (true) {
    const dt = yield;
    let done = true;
    for (const p of procs) if (!p.step(dt)) done = false;
    if (done) return;
  }
}
