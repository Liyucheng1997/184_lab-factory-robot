// 事件总线：仿真时钟、事件日志、计数器、KPI 时序采样
import { SIM_START_HOUR } from '../config.js';

export class Events {
  constructor() {
    this.time = 0;
    this.logs = [];
    this.counters = {};
    this.stamps = {};       // key -> [时间戳]（用于滑动窗口速率）
    this.listeners = [];
    this.series = { shipped: [], stock: [], util: [], wip: [] };
    this.sampleT = 0;
  }

  clock() {
    const t = SIM_START_HOUR * 3600 + this.time;
    const h = Math.floor(t / 3600) % 24, m = Math.floor(t / 60) % 60, s = Math.floor(t) % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  log(type, msg, level = 'info') {
    const e = { t: this.time, clock: this.clock(), type, msg, level };
    this.logs.push(e);
    if (this.logs.length > 300) this.logs.shift();
    for (const fn of this.listeners) fn(e);
  }

  count(key, n = 1) {
    this.counters[key] = (this.counters[key] || 0) + n;
    (this.stamps[key] ||= []).push(this.time);
  }

  get(key) {
    return this.counters[key] || 0;
  }

  // 滑动窗口内的速率（每小时）
  ratePerHour(key, window = 900) {
    const arr = this.stamps[key] || [];
    const t0 = this.time - window;
    while (arr.length && arr[0] < this.time - 3600) arr.shift();
    let n = 0;
    for (let i = arr.length - 1; i >= 0 && arr[i] >= t0; i--) n++;
    const span = Math.min(window, Math.max(this.time, 60));
    return (n / span) * 3600;
  }

  onLog(fn) {
    this.listeners.push(fn);
  }
}
