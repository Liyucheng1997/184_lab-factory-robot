// 收货 / 发货月台：半挂车（倒车靠台、离场）、门封、滑升门、月台灯、坡道输送线
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { WORLD_W, TRANSFER_H, TRUCK, DOCK_ROWS, RECV, SHIP } from '../config.js';
import { cx, cz } from '../core/grid.js';
import { Batcher } from '../core/batcher.js';
import { M, lightMat, canvasTex } from '../core/materials.js';
import { Proc, wait, waitUntil, tween } from '../core/proc.js';
import { Conveyor } from './conveyor.js';
import { Load } from './load.js';

export const DOOR = { w: 3.0, h: 3.3 };
const TRAILER = { L: 12.6, W: 2.55, H: 2.75, floor: TRUCK.floorH };
const CAB_COLORS = [0x1565c0, 0xc62828, 0x2e7d32, 0x37474f, 0xef6c00, 0x6a1b9a];

const trailerLogo = canvasTex(1024, 128, (ctx, w, h) => {
  ctx.fillStyle = '#e9edf0';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#0d47a1';
  ctx.fillRect(0, h - 26, w, 14);
  ctx.fillStyle = '#ff6f00';
  ctx.fillRect(0, h - 12, w, 6);
  ctx.fillStyle = '#0d47a1';
  ctx.font = 'bold 64px "Microsoft YaHei", sans-serif';
  ctx.fillText('智造物流  SMART LOGISTICS', 40, 72);
});

// ============================================================ 半挂车
class Truck {
  constructor(scene, side, z, color) {
    this.side = side; // 'W' | 'E'
    this.group = new THREE.Group();
    const xWall = side === 'W' ? -WORLD_W / 2 - 0.45 : WORLD_W / 2 + 0.45;
    this.dockPos = new THREE.Vector3(xWall, 0, z);
    this.dir = side === 'W' ? -1 : 1;
    this.group.rotation.y = side === 'W' ? Math.PI : 0;
    this.offset = 30; // 离场距离
    this.wheels = [];
    this.loads = [];
    this.build(color);
    this.setOffset(this.offset);
    this.group.visible = false;
    scene.add(this.group);
  }

  build(color) {
    const g = this.group;
    const b = new Batcher();
    const { L, W, H, floor } = TRAILER;
    const x0 = 0.15;
    // 车厢底盘 + 地板
    b.box(M.steelDark, L, 0.22, 1.1, x0 + L / 2, floor - 0.3, 0);
    b.box(M.steelGrey, L, 0.08, W, x0 + L / 2, floor - 0.04, 0);
    // 侧帘骨架（帘布收拢在车头，露出货物）+ 顶棚 + 前板
    b.box(M.trailerSide, L, 0.08, W, x0 + L / 2, floor + H, 0);
    b.box(M.trailerSide, 0.08, H, W, x0 + L - 0.04, floor + H / 2, 0);
    for (let i = 0; i <= 6; i++) {
      const x = x0 + 0.05 + (i * (L - 0.1)) / 6;
      for (const s of [-1, 1]) b.box(M.galv, 0.06, H, 0.05, x, floor + H / 2, s * (W / 2 - 0.03));
    }
    for (const s of [-1, 1]) {
      b.box(M.galv, L, 0.08, 0.06, x0 + L / 2, floor + H - 0.05, s * (W / 2 - 0.03));
      b.box(M.structBlue, 1.6, H - 0.1, 0.06, x0 + L - 0.9, floor + H / 2, s * (W / 2)); // 收拢的侧帘
      b.box(M.safetyYellow, L, 0.08, 0.02, x0 + L / 2, floor - 0.12, s * (W / 2 + 0.01)); // 反光条
    }
    // 后门（开启并贴靠两侧）
    for (const s of [-1, 1]) b.box(M.trailerSide, W / 2, H, 0.04, x0 + W / 4, floor + H / 2, s * (W / 2 + 0.06));
    // 后防撞梁 / 支腿
    b.box(M.safetyYellow, 0.1, 0.12, W - 0.2, x0 + 0.1, 0.5, 0);
    for (const s of [-1, 1]) b.box(M.steelGrey, 0.08, floor - 0.4, 0.08, x0 + L - 3.2, (floor - 0.4) / 2, s * 0.6);
    // 牵引车底盘
    const tx = x0 + L - 1.6;
    b.box(M.steelDark, 6.2, 0.28, 1.0, tx + 2.7, 0.78, 0);
    b.box(M.steelGrey, 1.2, 0.08, 1.2, tx + 0.6, 1.0, 0); // 鞍座
    for (const s of [-1, 1]) {
      b.cyl(M.galv, 0.32, 1.1, tx + 2.6, 0.75, s * 0.85, 'x', 20); // 油箱
      b.box(M.plasticBlack, 1.3, 0.05, 0.6, tx + 0.4, 1.25, s * 0.95); // 挡泥板
    }
    b.cyl(M.galv, 0.08, 2.0, tx + 3.4, 2.9, -0.95, 'y', 12); // 排气管
    b.flush(g);

    // 车厢侧面标识
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.62, 0.78), new THREE.MeshStandardMaterial({ map: trailerLogo, roughness: 0.5 }));
      p.position.set(x0 + L * 0.42, floor + H - 0.55, s * (W / 2 + 0.035));
      p.rotation.y = s > 0 ? 0 : Math.PI;
      g.add(p);
    }

    // 驾驶室
    const cabMat = new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.4 });
    const cab = new THREE.Mesh(new RoundedBoxGeometry(2.1, 2.55, 2.45, 4, 0.18), cabMat);
    cab.position.set(tx + 4.75, 2.25, 0);
    cab.castShadow = true;
    g.add(cab);
    const roof = new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.7, 2.3, 4, 0.25), cabMat);
    roof.position.set(tx + 4.6, 3.75, 0);
    roof.castShadow = true;
    g.add(roof);
    const shield = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.05), M.glassTint);
    shield.position.set(tx + 5.81, 2.85, 0);
    shield.rotation.y = Math.PI / 2;
    g.add(shield);
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.8), M.glassTint);
      w.position.set(tx + 5.15, 2.85, s * 1.231);
      w.rotation.y = s > 0 ? 0 : Math.PI;
      g.add(w);
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.2), M.plasticBlack);
      mirror.position.set(tx + 5.75, 2.9, s * 1.45);
      g.add(mirror);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.36), lightMat(0xfff8e1, 0.8));
      lamp.position.set(tx + 5.83, 1.35, s * 0.85);
      g.add(lamp);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.3), lightMat(0xff1744, 0.6));
      tail.position.set(x0 - 0.02, 0.62, s * 1.0);
      g.add(tail);
    }
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 1.4), M.steelDark);
    grille.position.set(tx + 5.82, 1.65, 0);
    g.add(grille);
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.35, 2.4), M.steelGrey);
    bumper.position.set(tx + 5.85, 0.85, 0);
    g.add(bumper);

    // 车轮：牵引车 3 轴 + 挂车 3 轴
    const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.32, 24);
    wheelGeo.rotateX(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.34, 12);
    hubGeo.rotateX(Math.PI / 2);
    const axles = [x0 + 1.5, x0 + 2.85, x0 + 4.2, tx + 0.1, tx + 1.45, tx + 4.9];
    for (const ax of axles) {
      for (const s of [-1, 1]) {
        const wg = new THREE.Group();
        const tire = new THREE.Mesh(wheelGeo, M.tire);
        tire.castShadow = true;
        wg.add(tire);
        const hub = new THREE.Mesh(hubGeo, M.galv);
        wg.add(hub);
        wg.position.set(ax, 0.5, s * 1.04);
        g.add(wg);
        this.wheels.push(wg);
      }
    }
  }

  slotLocal(k) {
    return new THREE.Vector3(0.95 + k * 1.32, TRAILER.floor, 0);
  }

  setOffset(o) {
    const d = o - (this.offset ?? o);
    this.offset = o;
    this.group.position.copy(this.dockPos).x += this.dir * o;
    for (const w of this.wheels) w.rotation.z -= d / 0.5;
  }

  *arrive() {
    this.group.visible = true;
    yield* tween(9, (k) => this.setOffset(30 * (1 - k)), (k) => 1 - Math.pow(1 - k, 3));
  }

  *depart() {
    yield* tween(8, (k) => this.setOffset(30 * k), (k) => k * k);
    this.group.visible = false;
    for (const l of this.loads) l.dispose();
    this.loads = [];
  }
}

// ============================================================ 月台
export class Docks {
  constructor(scene, grid, asrs, events) {
    this.scene = scene;
    this.asrs = asrs;
    this.events = events;
    this.recv = [];
    this.ship = [];
    this.shipped = 0;
    this.received = 0;
    const b = new Batcher();
    DOCK_ROWS.forEach((r, i) => {
      this.recv.push(this.buildDock(scene, grid, b, 'W', r, i));
      this.ship.push(this.buildDock(scene, grid, b, 'E', r, i));
    });
    b.flush(scene);
  }

  buildDock(scene, grid, b, side, r, i) {
    const west = side === 'W';
    const z = cz(r);
    const xw = west ? -WORLD_W / 2 : WORLD_W / 2;
    const s = west ? -1 : 1; // 指向室外
    const portCol = west ? RECV.portCol : SHIP.portCol;
    const dockCol = west ? RECV.dockCol : SHIP.dockCol;
    const outerCol = west ? 0 : 47;
    grid.block(portCol, r);
    grid.block(outerCol, r);

    // 门封（室外三边黑色海绵）+ 防撞块 + 月台灯
    const xo = xw + s * 0.42;
    b.box(M.dockFoam, 0.6, DOOR.h + 0.5, 0.35, xo, (DOOR.h + 0.5) / 2, z - DOOR.w / 2 - 0.17);
    b.box(M.dockFoam, 0.6, DOOR.h + 0.5, 0.35, xo, (DOOR.h + 0.5) / 2, z + DOOR.w / 2 + 0.17);
    b.box(M.dockFoam, 0.6, 0.45, DOOR.w + 0.7, xo, DOOR.h + 0.28, z);
    b.box(M.hazard, 0.05, 0.18, DOOR.w + 0.7, xo + s * 0.31, DOOR.h + 0.42, z);
    for (const dz of [-0.8, 0.8]) b.box(M.rubber, 0.14, 0.3, 0.3, xw + s * 0.2, 0.95, z + dz);
    b.box(M.steelGrey, 0.9, 0.05, DOOR.w - 0.2, xw + s * 0.45, TRUCK.floorH - 0.03, z); // 过桥板
    // 室内：月台导向护栏
    for (const dz of [-0.75, 0.75]) b.box(M.safetyYellow, 1.6, 0.12, 0.08, xw - s * 0.8, 0.5, z + dz * 1.6);

    // 坡道输送（车厢地板 → 交接高度）+ 水平输送
    const xIn = xw + s * 0.42;
    const x0c = cx(outerCol) - s * 0.08;
    const xEnd = cx(portCol) - s * 0.58;
    const incl = new Conveyor(scene, { x: xIn, z }, { x: x0c, z }, { h0: TRUCK.floorH, h1: TRANSFER_H, motor: false, sensors: false });
    const flat = new Conveyor(scene, { x: x0c, z }, { x: xEnd, z }, { guides: true });

    // 滑升门
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.08, DOOR.h, DOOR.w), new THREE.MeshStandardMaterial({
      color: 0x8c96a0, roughness: 0.5, metalness: 0.5,
    }));
    door.position.set(xw - s * 0.05, DOOR.h / 2, z);
    door.castShadow = true;
    scene.add(door);
    const ribs = new THREE.Group();
    for (let k = 1; k < 7; k++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, DOOR.w), M.steelGrey);
      rib.position.y = -DOOR.h / 2 + (k * DOOR.h) / 7;
      ribs.add(rib);
    }
    door.add(ribs);

    // 室外红绿灯
    const tl = new THREE.Group();
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.25), M.steelDark);
    tl.add(housing);
    const red = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), lightMat(0xff1744, 2));
    red.position.set(s * 0.06, 0.12, 0);
    const green = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), lightMat(0x00e676, 0.1));
    green.position.set(s * 0.06, -0.12, 0);
    tl.add(red, green);
    tl.position.set(xw + s * 0.2, 2.6, z + DOOR.w / 2 + 0.75);
    scene.add(tl);

    const truck = new Truck(scene, side, z, CAB_COLORS[(i * 2 + (west ? 0 : 1)) % CAB_COLORS.length]);

    const dock = {
      id: `${west ? 'RCV' : 'SHP'}-${i + 1}`,
      name: `${west ? '收货' : '发货'}月台 ${i + 1}`,
      kind: west ? 'recv' : 'ship',
      dock: { c: dockCol, r }, yaw: west ? -Math.PI / 2 : Math.PI / 2,
      handoff: new THREE.Vector3(cx(portCol), TRANSFER_H, z), loadYaw: Math.PI / 2,
      truck, door, red, green, incl, flat,
      status: 'empty', docked: false, handLoad: null, moving: null, pendingPick: null,
      reserved: 0, transit: 0, timer: 0,
      path: [new THREE.Vector3(xIn, TRUCK.floorH, z), new THREE.Vector3(x0c, TRANSFER_H, z), new THREE.Vector3(cx(portCol), TRANSFER_H, z)],
    };
    if (west) {
      dock.ready = () => (dock.moving ? null : dock.handLoad);
      dock.take = () => {
        const l = dock.handLoad;
        dock.handLoad = null;
        return l;
      };
      dock.setRoll = (on) => { flat.speed = on ? 0.5 : 0; };
    } else {
      dock.canAccept = () => dock.docked && !dock.handLoad && !dock.moving;
      dock.accept = (load) => {
        dock.handLoad = load;
        dock.reserved--;
        load.group.position.copy(dock.handoff);
        load.group.rotation.set(0, Math.PI / 2, 0);
      };
      dock.setRoll = (on) => { flat.speed = on ? 0.5 : 0; };
      // 发货：可接受新订单 = 车辆在位/即将到位 且 未满
      dock.capacityLeft = () => TRUCK.capacity - truck.loads.length - dock.reserved - (dock.handLoad ? 1 : 0) - (dock.moving ? 1 : 0);
    }
    dock.proc = new Proc(west ? this.recvLoop(dock) : this.shipLoop(dock));
    return dock;
  }

  setDoor(dock, k) {
    // 卷起：门帘收拢到门楣
    const h = DOOR.h * (1 - 0.88 * k);
    dock.door.scale.y = h / DOOR.h;
    dock.door.position.y = DOOR.h - h / 2;
  }

  setSignal(dock, go) {
    dock.red.material.emissiveIntensity = go ? 0.1 : 2.2;
    dock.green.material.emissiveIntensity = go ? 2.2 : 0.1;
  }

  // 沿折线移动托盘（世界坐标），驱动沿途输送线
  *conveyPath(dock, load, pts, speed = 0.55) {
    dock.moving = load;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const T = a.distanceTo(b) / speed;
      dock.incl.speed = dock.flat.speed = speed;
      yield* tween(T, (k) => load.group.position.lerpVectors(a, b, k), (k) => k);
    }
    dock.incl.speed = dock.flat.speed = 0;
    dock.moving = null;
  }

  *recvLoop(dock) {
    const truck = dock.truck;
    let first = true;
    while (true) {
      // 等待库容：在库 + 在途 + 本车 不超过 85%
      dock.status = 'waiting';
      if (!first) yield* wait(TRUCK.recvGap[0] + Math.random() * (TRUCK.recvGap[1] - TRUCK.recvGap[0]));
      yield* waitUntil(() => this.asrs.occupied + this.inboundPending() + TRUCK.capacity < this.asrs.capacity * 0.85);
      first = false;
      for (let k = 0; k < TRUCK.capacity; k++) {
        const l = new Load('raw');
        l.created = this.events.time;
        l.group.position.copy(truck.slotLocal(k));
        l.group.rotation.y = Math.PI / 2;
        truck.group.add(l.group);
        truck.loads.push(l);
      }
      dock.status = 'arriving';
      this.events.log('dock', `${dock.name}：来料车辆到达（${TRUCK.capacity} 托）`);
      yield* truck.arrive();
      yield* tween(2.2, (k) => this.setDoor(dock, k));
      dock.docked = true;
      dock.status = 'unloading';
      this.setSignal(dock, false);
      // 卸货：车厢 → 坡道 → 交接位
      while (truck.loads.length) {
        yield* waitUntil(() => !dock.handLoad);
        const load = truck.loads.shift();
        const start = load.group.getWorldPosition(new THREE.Vector3());
        this.scene.attach(load.group);
        const doorPt = dock.path[0].clone();
        yield* this.conveyPath(dock, load, [start, doorPt, dock.path[1], dock.path[2]]);
        dock.handLoad = load;
        this.received++;
        this.events.count('received');
      }
      yield* waitUntil(() => !dock.handLoad);
      dock.docked = false;
      dock.status = 'leaving';
      yield* tween(2.2, (k) => this.setDoor(dock, 1 - k));
      this.setSignal(dock, true);
      yield* truck.depart();
      this.setSignal(dock, false);
    }
  }

  *shipLoop(dock) {
    const truck = dock.truck;
    while (true) {
      dock.status = 'arriving';
      yield* truck.arrive();
      yield* tween(2.2, (k) => this.setDoor(dock, k));
      dock.docked = true;
      dock.status = 'loading';
      this.setSignal(dock, false);
      this.events.log('dock', `${dock.name}：空车靠台，等待装车`);
      while (truck.loads.length < TRUCK.capacity) {
        yield* waitUntil(() => dock.handLoad && !dock.moving);
        const load = dock.handLoad;
        const k = truck.loads.length;
        const slotW = truck.group.localToWorld(truck.slotLocal(TRUCK.capacity - 1 - k));
        yield* this.conveyPath(dock, load, [dock.path[2], dock.path[1], dock.path[0], slotW]);
        dock.handLoad = null;
        truck.group.attach(load.group);
        truck.loads.push(load);
        this.shipped++;
        this.events.count('shipped');
        load.history.push('shipped');
      }
      dock.docked = false;
      dock.status = 'leaving';
      this.events.log('dock', `${dock.name}：满载 ${TRUCK.capacity} 托发车`, 'ok');
      yield* tween(2.2, (k) => this.setDoor(dock, 1 - k));
      this.setSignal(dock, true);
      yield* truck.depart();
      this.setSignal(dock, false);
      dock.status = 'empty';
      yield* wait(TRUCK.shipGap[0] + Math.random() * (TRUCK.shipGap[1] - TRUCK.shipGap[0]));
    }
  }

  inboundPending() {
    let n = 0;
    for (const d of this.recv) n += d.truck.loads.length + (d.handLoad ? 1 : 0) + (d.moving ? 1 : 0);
    return n;
  }

  update(dt) {
    for (const d of this.recv) {
      d.proc.step(dt);
      d.incl.update(dt);
      d.flat.update(dt);
    }
    for (const d of this.ship) {
      d.proc.step(dt);
      d.incl.update(dt);
      d.flat.update(dt);
    }
  }
}
