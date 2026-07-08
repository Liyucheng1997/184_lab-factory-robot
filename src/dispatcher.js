// 任务调度中心：生成搬运任务、分配给最近的空闲机器人、管理送达货物
import * as THREE from 'three';
import { CARGO_SIZE } from './warehouse.js';

const CARGO_COLORS = [0xc98d4e, 0x3f7fbf, 0x4f9e58, 0xd4b33f, 0xb5651d, 0x7a6fbe];
const FADE_DELAY = 4;   // 送达后停留时间(秒)
const FADE_TIME = 1.5;  // 淡出时长(秒)

export class Dispatcher {
  constructor({ grid, scene, robots, slots, dropPoints }) {
    this.grid = grid;
    this.scene = scene;
    this.robots = robots;
    this.slots = slots;
    this.dropPoints = dropPoints;

    this.queue = [];      // 未分配任务
    this.active = [];     // 执行中任务
    this.delivered = [];  // 送达待淡出的货物
    this.completed = 0;
    this.autoSpawn = true;
    this.spawnTimer = 1.5;
  }

  spawnTask() {
    const freeSlots = this.slots.filter((s) => !s.occupied);
    const freeDrops = this.dropPoints.filter((d) => !d.busy);
    if (freeSlots.length === 0 || freeDrops.length === 0) return false;

    const slot = freeSlots[Math.floor(Math.random() * freeSlots.length)];
    const drop = freeDrops[Math.floor(Math.random() * freeDrops.length)];
    slot.occupied = true;
    drop.busy = true;

    const cargo = makeCargo();
    cargo.position.copy(slot.shelfPos);
    this.scene.add(cargo);

    const task = { slot, drop, cargo, robot: null };
    task.onPicked = () => {
      slot.occupied = false; // 货物离开货架，货位可再次生成任务
    };
    task.onDelivered = () => {
      this.completed++;
      this.active = this.active.filter((t) => t !== task);
      // 放货格临时设为障碍，避免机器人碾过刚卸下的货物
      this.grid.block(drop.cargoCell.c, drop.cargoCell.r);
      this.delivered.push({ mesh: cargo, drop, t: 0 });
    };

    this.queue.push(task);
    return true;
  }

  update(dt) {
    // 自动生成任务
    if (this.autoSpawn) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        if (this.queue.length + this.active.length < 6) this.spawnTask();
        this.spawnTimer = 2.5 + Math.random() * 3;
      }
    }

    // 把排队任务分配给最近的空闲机器人
    for (const task of [...this.queue]) {
      const robot = this.pickRobot(task);
      if (!robot) break;
      task.robot = robot;
      robot.assignTask(task);
      this.queue = this.queue.filter((t) => t !== task);
      this.active.push(task);
    }

    // 送达货物：停留 -> 淡出 -> 移除
    for (const item of [...this.delivered]) {
      item.t += dt;
      if (item.t > FADE_DELAY) {
        const k = Math.min((item.t - FADE_DELAY) / FADE_TIME, 1);
        item.mesh.material.transparent = true;
        item.mesh.material.opacity = 1 - k;
        if (k >= 1) {
          this.scene.remove(item.mesh);
          item.mesh.geometry.dispose();
          item.mesh.material.dispose();
          this.grid.unblock(item.drop.cargoCell.c, item.drop.cargoCell.r);
          item.drop.busy = false;
          this.delivered = this.delivered.filter((d) => d !== item);
        }
      }
    }
  }

  pickRobot(task) {
    let best = null;
    let bestDist = Infinity;
    for (const r of this.robots) {
      if (r.busy) continue;
      const d =
        Math.abs(r.cell.c - task.slot.accessCell.c) +
        Math.abs(r.cell.r - task.slot.accessCell.r);
      if (d < bestDist) {
        bestDist = d;
        best = r;
      }
    }
    return best;
  }
}

function makeCargo() {
  const color = CARGO_COLORS[Math.floor(Math.random() * CARGO_COLORS.length)];
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(CARGO_SIZE, CARGO_SIZE, CARGO_SIZE),
    new THREE.MeshStandardMaterial({ color, roughness: 0.85 })
  );
  mesh.castShadow = true;
  return mesh;
}
