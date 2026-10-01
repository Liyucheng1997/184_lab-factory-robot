// 机加工单元：立式加工中心 + 六轴上下料机器人 + 两条双向托盘辊道 + 安全围栏
import * as THREE from 'three';
import { CELL, TRANSFER_H, CELL_ROWS, PROCESS } from '../config.js';
import { cx, cz } from '../core/grid.js';
import { Batcher } from '../core/batcher.js';
import { M, lightMat, signMesh, canvasTex, tiledPlane } from '../core/materials.js';
import { Proc, tween } from '../core/proc.js';
import { Conveyor } from './conveyor.js';
import { RobotArm } from './arm.js';

const MACH_W = 3.5;
const MACH_D = 2.6;
const MACH_H = 2.65;
const DOOR_W = 1.4;
const TABLE_Y = 1.02;    // 夹具顶面
const CHUCK_IN = 0.95;   // 夹具距机床前面板

export class Workcell {
  constructor(scene, grid, index, c0, events) {
    this.scene = scene;
    this.index = index;
    this.name = `加工单元 ${index + 1}`;
    this.code = `CNC-0${index + 1}`;
    this.events = events;
    this.state = 'IDLE';       // IDLE / LOADING / RUN / TOOL / WAIT
    this.runTime = 0;
    this.parts = 0;
    this.pallets = 0;
    this.toolLife = 18 + Math.floor(Math.random() * 10);

    grid.blockRect(c0 - 1, CELL_ROWS.portRow, c0 + 4, CELL_ROWS.last); // 含单元间隔（防止死胡同）

    this.xc = cx(c0 + 1);
    this.zFront = cz(23.75);
    this.chuck = new THREE.Vector3(this.xc, TABLE_Y, this.zFront + CHUCK_IN);

    this.buildMachine(scene);
    this.buildFence(scene, c0);
    this.lanes = [c0, c0 + 2].map((c, i) => this.buildLane(scene, c, i));
    this.arm = new RobotArm(scene, new THREE.Vector3(cx(c0 + 1), 0, cz(CELL_ROWS.armR)));
    this.arm.setGrip(1);
    this.home = new THREE.Vector3(this.xc, 1.75, cz(CELL_ROWS.armR) - 0.9);
    this.armHome();

    const sign = signMesh([this.code, { text: this.name, font: 'bold 40px "Microsoft YaHei"', color: '#9fd3ff' }],
      1.7, 0.66, { w: 256, h: 100, bg: '#1b2531' });
    sign.position.set(this.xc, MACH_H + 0.5, this.zFront - 0.04);
    sign.rotation.y = Math.PI;
    scene.add(sign);

    this.proc = new Proc(this.run());
  }

  armHome() {
    const c = this.arm.toCyl(this.home);
    this.arm.cyl = c;
    this.arm.solveCyl(c.th, c.rho, c.y, 0);
  }

  // ---------------------------------------------------------------- 机床
  buildMachine(scene) {
    const g = new THREE.Group();
    g.position.set(this.xc, 0, this.zFront);
    scene.add(g);
    const b = new Batcher();
    const W = MACH_W, D = MACH_D, H = MACH_H;
    const body = M.paintWhite;
    // 底座 / 侧板 / 背板 / 顶板（前侧留门洞）
    b.box(M.steelDark, W + 0.06, 0.32, D + 0.06, 0, 0.16, D / 2);
    b.box(body, 0.06, H - 0.32, D, -W / 2 + 0.03, 0.32 + (H - 0.32) / 2, D / 2);
    b.box(body, 0.06, H - 0.32, D, W / 2 - 0.03, 0.32 + (H - 0.32) / 2, D / 2);
    b.box(body, W, H - 0.32, 0.06, 0, 0.32 + (H - 0.32) / 2, D - 0.03);
    b.box(body, W, 0.06, D, 0, H - 0.03, D / 2);
    const side = (W - DOOR_W) / 2;
    b.box(body, side, H - 0.32, 0.08, -W / 2 + side / 2, 0.32 + (H - 0.32) / 2, 0.04);
    b.box(body, side, H - 0.32, 0.08, W / 2 - side / 2, 0.32 + (H - 0.32) / 2, 0.04);
    b.box(body, DOOR_W, 0.55, 0.08, 0, 0.32 + 0.275, 0.04);     // 门下裙板
    b.box(body, DOOR_W, 0.35, 0.08, 0, H - 0.175, 0.04);       // 门上楣
    // 装饰色带
    b.box(M.structBlue, W + 0.02, 0.12, 0.09, 0, H - 0.5, 0.04);
    b.box(M.structBlue, 0.07, 0.12, D, -W / 2 + 0.02, H - 0.5, D / 2);
    b.box(M.structBlue, 0.07, 0.12, D, W / 2 - 0.02, H - 0.5, D / 2);
    // 内部：工作台 + 虎钳 + 立柱 + 主轴箱导轨
    b.box(M.steelGrey, 1.6, 0.55, 1.0, 0, 0.32 + 0.275, CHUCK_IN);
    b.box(M.galv, 1.4, 0.06, 0.8, 0, TABLE_Y - 0.12, CHUCK_IN);
    b.box(M.steelDark, 0.42, 0.09, 0.36, 0, TABLE_Y - 0.045, CHUCK_IN);
    b.box(M.steelGrey, 0.9, H - 0.7, 0.5, 0, 0.32 + (H - 0.7) / 2, D - 0.4);
    // 排屑机（侧面伸出） + 切屑车
    b.box(M.steelGrey, 0.5, 0.45, 1.6, W / 2 + 0.25, 0.4, D * 0.55);
    b.beam(M.steelGrey, new THREE.Vector3(W / 2 + 0.25, 0.6, D * 0.55 + 0.8), new THREE.Vector3(W / 2 + 0.25, 1.1, D + 0.25), 0.45, 0.3);
    b.box(M.structBlue, 0.6, 0.55, 0.6, W / 2 + 0.3, 0.3, D + 0.6);
    // 冷却液箱 + 电柜
    b.box(M.paintGrey, 0.8, 0.6, 0.5, -W / 2 + 0.6, 0.3, D + 0.3);
    b.box(M.paintGrey, 1.1, 2.0, 0.55, -W / 2 + 0.7, 1.0, D + 0.32);
    b.flush(g);

    // 观察窗玻璃
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(side - 0.25, 1.1), M.glassTint);
    for (const s of [-1, 1]) {
      const w = glass.clone();
      w.position.set(s * (W / 2 - side / 2), 1.55, -0.005);
      w.rotation.y = Math.PI;
      g.add(w);
    }

    // 推拉门（两扇，带视窗）
    this.doors = [];
    for (const s of [-1, 1]) {
      const d = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W / 2, H - 0.32 - 0.9, 0.05), M.paintGrey);
      frame.castShadow = true;
      d.add(frame);
      const win = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W / 2 - 0.16, 0.75), M.glassTint);
      win.position.set(0, 0.1, -0.03);
      win.rotation.y = Math.PI;
      d.add(win);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.05), M.steelDark);
      handle.position.set(-s * (DOOR_W / 4 - 0.07), 0, -0.05);
      d.add(handle);
      d.position.set(s * DOOR_W / 4, 0.32 + 0.55 + (H - 0.32 - 0.9) / 2, -0.03);
      d.userData.closedX = s * DOOR_W / 4;
      d.userData.s = s;
      g.add(d);
      this.doors.push(d);
    }
    this.doorOpen = 1;
    this.setDoor(1);

    // 主轴箱（可升降）+ 主轴
    this.spindle = new THREE.Group();
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.6), M.steelGrey);
    head.position.set(0, 0, 0.15);
    head.castShadow = true;
    this.spindle.add(head);
    this.spindleTool = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.3, 14), M.galv);
    this.spindleTool.position.set(0, -0.42, 0);
    this.spindle.add(this.spindleTool);
    this.spindleY = { up: 2.1, down: TABLE_Y + 0.62 };
    this.spindle.position.set(0, this.spindleY.up, CHUCK_IN);
    g.add(this.spindle);

    // 机内照明
    this.workLight = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.08), lightMat(0xeaf4ff, 0.6));
    this.workLight.position.set(0, H - 0.12, 0.5);
    g.add(this.workLight);

    // 三色灯塔
    this.tower = {};
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 8), M.steelDark);
    pole.position.set(W / 2 - 0.2, H + 0.15, 0.25);
    g.add(pole);
    ['red', 'amber', 'green'].forEach((k, i) => {
      const col = { red: 0xff3b30, amber: 0xffb300, green: 0x34c759 }[k];
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.1, 16), lightMat(col, 0.05));
      m.position.set(W / 2 - 0.2, H + 0.62 - i * 0.105, 0.25);
      g.add(m);
      this.tower[k] = m;
    });
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.03, 16), M.steelDark);
    cap.position.set(W / 2 - 0.2, H + 0.69, 0.25);
    g.add(cap);

    // 操作面板（悬臂式）带屏幕
    this.screenTex = canvasTex(256, 160, () => {});
    this.screenCtx = this.screenTex.image.getContext('2d');
    const panel = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.8, 0.14), M.steelDark);
    panel.add(box);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.31),
      new THREE.MeshStandardMaterial({ map: this.screenTex, emissive: 0xffffff, emissiveMap: this.screenTex, emissiveIntensity: 0.9 }));
    screen.position.set(0, 0.14, -0.075);
    screen.rotation.y = Math.PI;
    panel.add(screen);
    const estop = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 16), M.red);
    estop.rotation.x = Math.PI / 2;
    estop.position.set(0.2, -0.27, -0.09);
    panel.add(estop);
    panel.position.set(W / 2 + 0.05, 1.55, -0.25);
    panel.rotation.y = -0.35;
    g.add(panel);
    this.drawScreen();
    this.machineGroup = g;
  }

  setDoor(k) {
    this.doorOpen = k;
    for (const d of this.doors) {
      d.position.x = d.userData.closedX + d.userData.s * k * (DOOR_W / 2 - 0.05);
      d.position.z = -0.03 - 0.07 * Math.min(1, k * 4);
    }
  }

  setTower(state) {
    const blink = Math.sin(performance.now() / 180) > 0;
    const on = { red: 0.05, amber: 0.05, green: 0.05 };
    if (state === 'RUN') on.green = 2.4;
    else if (state === 'LOADING') on.green = blink ? 2.0 : 0.3;
    else if (state === 'TOOL') on.amber = blink ? 2.4 : 0.2;
    else if (state === 'WAIT') on.amber = 2.0;
    else on.amber = 0.9;
    for (const k in on) this.tower[k].material.emissiveIntensity = on[k];
  }

  drawScreen(progress = 0) {
    const c = this.screenCtx;
    c.fillStyle = '#071a2b';
    c.fillRect(0, 0, 256, 160);
    c.fillStyle = '#5ad1ff';
    c.font = 'bold 22px Consolas, monospace';
    c.fillText(this.code + '  O1024', 12, 30);
    const color = { RUN: '#34c759', LOADING: '#5ad1ff', TOOL: '#ffb300', WAIT: '#ffb300', IDLE: '#9aa4ad' }[this.state];
    c.fillStyle = color;
    c.font = 'bold 26px Consolas, monospace';
    c.fillText({ RUN: 'CYCLE RUN', LOADING: 'ROBOT LOAD', TOOL: 'TOOL CHG', WAIT: 'NO MATERIAL', IDLE: 'READY' }[this.state], 12, 70);
    c.fillStyle = '#1f3b53';
    c.fillRect(12, 92, 232, 14);
    c.fillStyle = color;
    c.fillRect(12, 92, 232 * progress, 14);
    c.fillStyle = '#cfe7f7';
    c.font = '18px Consolas, monospace';
    c.fillText(`PARTS ${String(this.parts).padStart(5, '0')}`, 12, 135);
    this.screenTex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- 围栏
  buildFence(scene, c0) {
    const b = new Batcher();
    const x0 = cx(c0 - 0.72), x1 = cx(c0 + 2.72);
    const zN = cz(CELL_ROWS.portRow) - CELL / 2 + 0.08, zS = this.zFront - 0.02;
    const H = 2.0;
    const panel = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az);
      const yaw = Math.atan2(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / 1.3));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
        b.box(M.safetyYellow, 0.06, H, 0.06, px, H / 2, pz);
        b.box(M.steelDark, 0.16, 0.01, 0.16, px, 0.005, pz);
      }
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(mx, 0.12 + (H - 0.2) / 2, mz),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw + Math.PI / 2, 0)),
        new THREE.Vector3(1, 1, 1),
      );
      b.add(tiledPlane(len - 0.06, H - 0.2), M.fenceMesh, m, { cast: false });
      b.box(M.safetyYellow, 0.04, 0.04, len, mx, H - 0.02, mz, yaw);
    };
    panel(x0, zN, x0, zS);
    panel(x1, zN, x1, zS);
    // 北侧：分三段，给两条辊道留口（口部装安全光幕）
    const lanesX = [cx(c0), cx(c0 + 2)];
    const gap = 0.58;
    panel(x0, zN, lanesX[0] - gap, zN);
    panel(lanesX[0] + gap, zN, lanesX[1] - gap, zN);
    panel(lanesX[1] + gap, zN, x1, zN);
    for (const lx of lanesX) {
      for (const s of [-1, 1]) {
        b.box(M.safetyYellow, 0.07, 1.6, 0.07, lx + s * gap, 0.8, zN);
        b.box(M.plasticBlack, 0.03, 1.3, 0.03, lx + s * (gap - 0.05), 0.95, zN);
      }
    }
    b.flush(scene);
  }

  // ---------------------------------------------------------------- 辊道（站台）
  buildLane(scene, c, i) {
    const zA = cz(CELL_ROWS.portRow) - CELL / 2 + 0.03;
    const zB = cz(CELL_ROWS.procR) + 0.52;
    const conv = new Conveyor(scene, { x: cx(c), z: zA }, { x: cx(c), z: zB }, { guides: true });
    const tHand = (cz(CELL_ROWS.portRow) - zA) / (zB - zA);
    const tProc = (cz(CELL_ROWS.procR) - zA) / (zB - zA);
    const lane = {
      id: `${this.code}-${i === 0 ? 'A' : 'B'}`,
      name: `${this.name}${i === 0 ? 'A' : 'B'}位`,
      kind: 'lane', cell: this, conv,
      dock: { c, r: CELL_ROWS.dock }, yaw: 0,
      handoff: new THREE.Vector3(cx(c), TRANSFER_H, cz(CELL_ROWS.portRow)), loadYaw: 0,
      state: 'empty', load: null, pendingPick: null, reservedIn: null,
      tHand, tProc, move: null,
      canAccept: () => lane.state === 'requested' && !lane.load,
      accept: (load) => {
        lane.load = load;
        load.group.position.copy(lane.handoff);
        load.group.rotation.set(0, 0, 0);
        lane.state = 'conveyIn';
        lane.move = { from: tHand, to: tProc, k: 0 };
        this.events.log('cell', `${load.id} 上料到 ${lane.name}`);
      },
      ready: () => (lane.state === 'done' ? lane.load : null),
      take: () => {
        const l = lane.load;
        lane.load = null;
        lane.state = 'empty';
        return l;
      },
      setRoll: (on) => { lane.roll = on; },
    };
    return lane;
  }

  updateLane(lane, dt) {
    const conv = lane.conv;
    if (lane.move) {
      const m = lane.move;
      const span = Math.abs(m.to - m.from) * conv.length;
      m.k = Math.min(1, m.k + (0.4 * dt) / span);
      conv.pointAt(m.from + (m.to - m.from) * m.k, lane.load.group.position);
      conv.speed = 0.4 * Math.sign(m.to - m.from);
      if (m.k >= 1) {
        lane.move = null;
        if (lane.state === 'conveyIn') lane.state = 'ready';
        else if (lane.state === 'conveyOut') {
          lane.state = 'done';
          this.events.log('cell', `${lane.name} 成品 ${lane.load.id} 待下线`);
        }
      }
    } else {
      conv.speed = lane.roll ? 0.4 : 0;
    }
    conv.update(dt);
  }

  // ---------------------------------------------------------------- 工艺流程
  *run() {
    const arm = this.arm;
    while (true) {
      const lane = this.lanes.find((l) => l.state === 'ready');
      if (!lane) {
        this.state = this.lanes.some((l) => l.state !== 'empty' && l.state !== 'requested') ? 'IDLE' : 'WAIT';
        yield;
        continue;
      }
      lane.state = 'processing';
      const load = lane.load;
      load.explode();
      for (let i = 0; i < load.parts.length; i++) {
        const part = load.parts[i];
        const slot = load.group.localToWorld(load.partLocal(i));
        const grasp = slot.clone().setY(slot.y + 0.17);
        const above = grasp.clone().setY(grasp.y + 0.35);

        this.state = 'LOADING';
        yield* arm.moveTo(above);
        yield* arm.moveLinear(grasp);
        yield* arm.gripTo(0);
        arm.tcpAnchor.attach(part);
        yield* arm.moveLinear(above);

        // 送入机床
        const doorPt = new THREE.Vector3(this.xc, 1.55, this.zFront - 0.25);
        const inPt = new THREE.Vector3(this.xc, TABLE_Y + 0.2 + 0.25, this.chuck.z);
        const placePt = new THREE.Vector3(this.xc, TABLE_Y + 0.17, this.chuck.z);
        if (this.doorOpen < 1) yield* tween(0.8, (k) => this.setDoor(k));
        yield* arm.moveTo(doorPt, { yaw: 0 });
        yield* arm.moveLinear(inPt, { speed: 1.2 });
        yield* arm.moveLinear(placePt, { speed: 0.6 });
        yield* arm.gripTo(1);
        this.machineGroup.attach(part);
        yield* arm.moveLinear(inPt, { speed: 0.9 });
        yield* arm.moveLinear(doorPt, { speed: 1.2 });

        // 关门加工（机器人在门外待命）
        yield* tween(0.8, (k) => this.setDoor(1 - k));
        this.state = 'RUN';
        yield* this.machining(part, load);

        // 取出成品
        this.state = 'LOADING';
        yield* tween(0.8, (k) => this.setDoor(k));
        yield* arm.moveTo(doorPt, { yaw: 0 });
        yield* arm.moveLinear(inPt, { speed: 1.2 });
        yield* arm.moveLinear(placePt, { speed: 0.6 });
        yield* arm.gripTo(0);
        arm.tcpAnchor.attach(part);
        yield* arm.moveLinear(inPt, { speed: 0.6 });
        yield* arm.moveLinear(doorPt, { speed: 1.2 });
        yield* arm.moveTo(above);
        yield* arm.moveLinear(grasp, { speed: 0.4 });
        yield* arm.gripTo(1);
        load.group.attach(part);
        part.position.copy(load.partLocal(i));
        part.rotation.set(0, 0, 0);
        yield* arm.moveLinear(above);
        this.parts++;
        this.events.count('parts');

        // 刀具寿命管理：到寿命自动换刀
        if (--this.toolLife <= 0) {
          this.state = 'TOOL';
          this.events.log('cell', `${this.code} 刀具寿命到期，自动换刀`, 'warn');
          yield* arm.moveTo(this.home);
          yield* this.toolChange();
          this.toolLife = 18 + Math.floor(Math.random() * 10);
        }
      }
      yield* arm.moveTo(this.home);
      load.implode('done');
      load.history.push('machined');
      this.pallets++;
      lane.state = 'conveyOut';
      lane.move = { from: lane.tProc, to: lane.tHand, k: 0 };
    }
  }

  *machining(part, load) {
    const T = PROCESS.machiningTime * (0.92 + Math.random() * 0.16);
    let t = 0;
    while (t < T) {
      const dt = yield;
      t += dt;
      this.runTime += dt;
      const k = t / T;
      // 主轴下探 → 往复走刀 → 抬起
      const dip = k < 0.12 ? k / 0.12 : k > 0.88 ? (1 - k) / 0.12 : 1;
      this.spindle.position.y = this.spindleY.up + (this.spindleY.down - this.spindleY.up) * dip;
      this.spindle.position.x = dip >= 1 ? Math.sin(t * 1.7) * 0.08 : 0;
      this.spindleTool.rotation.y += dt * 60;
      this.workLight.material.emissiveIntensity = 1.4;
      if (Math.random() < dt * 4) this.drawScreen(k);
    }
    load.finishPart(part);
    this.spindle.position.set(0, this.spindleY.up, CHUCK_IN);
    this.workLight.material.emissiveIntensity = 0.6;
  }

  *toolChange() {
    let t = 0;
    while (t < 9) {
      const dt = yield;
      t += dt;
      this.spindleTool.visible = t < 3 || t > 6;
      this.spindle.position.y = this.spindleY.up + 0.15 * Math.sin(Math.min(t / 9, 1) * Math.PI);
    }
    this.spindleTool.visible = true;
  }

  update(dt) {
    for (const lane of this.lanes) this.updateLane(lane, dt);
    this.proc.step(dt);
    this.setTower(this.state);
    if (this.state !== this._lastScreen) {
      this._lastScreen = this.state;
      this.drawScreen(0);
    }
  }
}
