// 厂房：环氧地坪(含 AGV 二维码地标/标线)、钢结构桁架、压型钢板墙(视角剖切)、高天棚灯、中控室、充电区、室外堆场
import * as THREE from 'three';
import {
  CELL, COLS, ROWS, WORLD_W, WORLD_D, BUILDING, ASRS, WORKCELLS, CELL_ROWS, DOCK_ROWS, RECV, SHIP,
  CHARGER_COLS, PARKING, OFFICE,
} from '../config.js';
import { cx, cz } from '../core/grid.js';
import { Batcher } from '../core/batcher.js';
import { M, lightMat, signMesh, canvasTex, textTexture } from '../core/materials.js';
import { DOOR } from './docks.js';

const HW = WORLD_W / 2, HD = WORLD_D / 2;

export function buildBuilding(scene, grid) {
  grid.blockRect(OFFICE.c0, OFFICE.r0, OFFICE.c1, OFFICE.r1);
  for (const c of CHARGER_COLS) grid.block(c, 0);

  buildFloor(scene, grid);
  buildYard(scene);
  const walls = buildWalls(scene);
  walls.roof = buildStructure(scene);
  buildOffice(scene);
  const chargers = buildChargers(scene);
  buildSafetyProps(scene);
  return { walls, chargers };
}

// ================================================================ 地坪
function buildFloor(scene, grid) {
  const S = 48; // px / 格
  const W = COLS * S, H = ROWS * S;
  const tex = canvasTex(W, H, (ctx) => {
    const X = (c) => c * S; // 格边界 → 像素
    // 环氧地坪底色 + 污渍
    ctx.fillStyle = '#8e959c';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '0,0,0'},0.025)`;
      ctx.beginPath();
      ctx.arc(Math.random() * W, Math.random() * H, 30 + Math.random() * 120, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 26000; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.045)';
      ctx.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
    }
    // 伸缩缝（每 6 m）
    ctx.strokeStyle = 'rgba(40,44,48,0.35)';
    ctx.lineWidth = 1.5;
    for (let x = 0; x < W; x += (6 / CELL) * S) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += (6 / CELL) * S) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    // AMR 作业区：浅色涂层
    ctx.fillStyle = 'rgba(205,212,218,0.22)';
    ctx.fillRect(X(2), X(ASRS.dockRow), X(44), X(CELL_ROWS.dock - ASRS.dockRow + 1));

    // 黄黑斑马危险区：立体库站台前、加工单元围栏外沿
    const hatch = (x, y, w, h) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.fillStyle = '#e8b923';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#1d1d1d';
      ctx.lineWidth = 7;
      for (let k = -h; k < w + h; k += 22) {
        ctx.beginPath(); ctx.moveTo(x + k, y + h); ctx.lineTo(x + k + h, y); ctx.stroke();
      }
      ctx.restore();
    };
    hatch(X(ASRS.colMin), X(ASRS.portRows[1] + 1) - 8, X(ASRS.colMax - ASRS.colMin + 1), 8);
    for (const c0 of WORKCELLS) hatch(X(c0 - 1) + 6, X(CELL_ROWS.portRow) - 6, X(5) - 12, 6);

    // 人行通道（绿色，白边）+ 斑马线
    ctx.fillStyle = '#3f8f57';
    ctx.fillRect(0, X(ROWS - 1) + 6, W, S - 6);
    ctx.fillRect(X(40) + 4, X(OFFICE.r1 + 1), S * 1.6, X(ROWS - OFFICE.r1 - 2));
    ctx.strokeStyle = '#f3f3f3';
    ctx.lineWidth = 3;
    ctx.strokeRect(-4, X(ROWS - 1) + 6, W + 8, S);
    ctx.strokeRect(X(40) + 4, X(OFFICE.r1 + 1), S * 1.6, X(ROWS - OFFICE.r1 - 2));
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let r = ASRS.dockRow; r <= CELL_ROWS.dock; r++) {
      for (let k = 0; k < 4; k++) ctx.fillRect(X(40) + 8 + k * 18, X(r) + 4, 10, S - 8);
    }
    // 人行图标
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = `bold ${S * 0.7}px "Segoe UI Symbol", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let c = 3; c < COLS; c += 8) ctx.fillText('🚶', X(c), X(ROWS - 1) + S * 0.55);

    // 二维码地标（每个可通行格中心）
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid.isBlocked(c, r)) continue;
        const px = X(c) + S / 2, py = X(r) + S / 2;
        ctx.fillStyle = '#f7f7f7';
        ctx.fillRect(px - 5, py - 5, 10, 10);
        ctx.fillStyle = '#111';
        for (let i = 0; i < 9; i++) {
          if ((c * 7 + r * 13 + i * 5) % 3 === 0) ctx.fillRect(px - 4 + (i % 3) * 3, py - 4 + ((i / 3) | 0) * 3, 2.5, 2.5);
        }
        ctx.fillRect(px - 4, py - 4, 2, 2);
      }
    }

    // 停靠位：黄色角标 + 编号
    const corner = (c, r, color, label) => {
      const x = X(c) + 5, y = X(r) + 5, w = S - 10, l = 11;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y + l); ctx.lineTo(x, y); ctx.lineTo(x + l, y);
      ctx.moveTo(x + w - l, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + l);
      ctx.moveTo(x + w, y + w - l); ctx.lineTo(x + w, y + w); ctx.lineTo(x + w - l, y + w);
      ctx.moveTo(x + l, y + w); ctx.lineTo(x, y + w); ctx.lineTo(x, y + w - l);
      ctx.stroke();
      if (label) {
        ctx.fillStyle = color;
        ctx.font = 'bold 10px Consolas, monospace';
        ctx.fillText(label, X(c) + S / 2, X(r) + S - 10);
      }
    };
    ASRS.aisles.forEach((ca, a) => {
      corner(ca - 1, ASRS.dockRow, '#ffd54f', `I${a + 1}`);
      corner(ca + 1, ASRS.dockRow, '#ffd54f', `O${a + 1}`);
    });
    WORKCELLS.forEach((c0, i) => {
      corner(c0, CELL_ROWS.dock, '#ffd54f', `C${i + 1}A`);
      corner(c0 + 2, CELL_ROWS.dock, '#ffd54f', `C${i + 1}B`);
    });
    DOCK_ROWS.forEach((r, i) => {
      corner(RECV.dockCol, r, '#ffd54f', `R${i + 1}`);
      corner(SHIP.dockCol, r, '#ffd54f', `S${i + 1}`);
    });
    // 充电位、停车位
    ctx.fillStyle = 'rgba(30,136,229,0.28)';
    ctx.fillRect(0, 0, X(CHARGER_COLS[CHARGER_COLS.length - 1] + 1) + 6, X(2) + 4);
    for (const c of CHARGER_COLS) {
      corner(c, 1, '#64b5f6', `CH${(c + 1) / 2}`);
      ctx.fillStyle = '#64b5f6';
      ctx.font = `bold ${S * 0.42}px sans-serif`;
      ctx.fillText('⚡', X(c) + S / 2, X(1) + S / 2 - 6);
    }
    for (const p of PARKING) {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(X(p.c) + 4, X(p.r) + 4, S - 8, S - 8);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText('P', X(p.c) + S / 2, X(p.r) + S / 2);
    }

    // 区域文字
    const label = (text, x, y, size, color = 'rgba(255,255,255,0.55)', rot = 0) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.fillStyle = color;
      ctx.font = `bold ${size}px "Microsoft YaHei", sans-serif`;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };
    label('收货区  RECEIVING', X(4.2), X(19.5), 26, 'rgba(255,255,255,0.5)', -Math.PI / 2);
    label('发货区  SHIPPING', X(43.8), X(19.5), 26, 'rgba(255,255,255,0.5)', Math.PI / 2);
    label('充电区 CHARGING', X(7.5), X(2.6), 22, 'rgba(144,202,249,0.75)');
    label('AMR 主通道  ·  限速 1.8 m/s', X(24), X(17.5), 30, 'rgba(255,255,255,0.38)');
    // 主通道中心虚线
    ctx.strokeStyle = 'rgba(255,214,79,0.6)';
    ctx.lineWidth = 3;
    ctx.setLineDash([22, 18]);
    for (const r of [16.5, 18.5]) {
      ctx.beginPath(); ctx.moveTo(X(3), X(r)); ctx.lineTo(X(44), X(r)); ctx.stroke();
    }
    ctx.setLineDash([]);
  });
  tex.anisotropy = 16;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_W, WORLD_D),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
}

// ================================================================ 室外堆场
function buildYard(scene) {
  const yard = new THREE.Mesh(new THREE.PlaneGeometry(220, 160), M.asphalt);
  yard.rotation.x = -Math.PI / 2;
  yard.position.y = -0.02;
  yard.receiveShadow = true;
  scene.add(yard);
  // 车位线 / 车道箭头
  const lines = new THREE.MeshBasicMaterial({ color: 0xe8e8e8 });
  const yellow = new THREE.MeshBasicMaterial({ color: 0xf2c230 });
  const b = new Batcher();
  for (const side of [-1, 1]) {
    for (const r of DOCK_ROWS) {
      for (const dz of [-1.75, 1.75]) b.box(lines, 18, 0.01, 0.15, side * (HW + 10), 0.0, cz(r) + dz, 0, { cast: false });
    }
    b.box(yellow, 0.2, 0.01, 60, side * (HW + 26), 0, 0, 0, { cast: false });
    // 外墙散水
    b.box(M.concrete, 1.2, 0.04, WORLD_D + 2.4, side * (HW + 0.6), 0, 0, 0, { cast: false });
  }
  b.box(M.concrete, WORLD_W + 2.4, 0.04, 1.2, 0, 0, -HD - 0.6, 0, { cast: false });
  b.box(M.concrete, WORLD_W + 2.4, 0.04, 1.2, 0, 0, HD + 0.6, 0, { cast: false });
  b.flush(scene);
}

// ================================================================ 墙体（可剖切）
function wallBox(group, mat, w, h, d, x, y, z, uvScale = 1.2) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const long = Math.max(w, d);
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (long / uvScale));
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

function buildWalls(scene) {
  const T = BUILDING.wallT, Hh = BUILDING.eaveH;
  const PL = 1.4; // 混凝土墙裙高度
  const walls = {};
  const mk = (name) => {
    const low = new THREE.Group();
    const high = new THREE.Group();
    scene.add(low, high);
    walls[name] = { low, high };
    return walls[name];
  };

  // 南北墙（沿 x）
  for (const [name, z] of [['north', -HD - T / 2], ['south', HD + T / 2]]) {
    const w = mk(name);
    wallBox(w.low, M.plinth, WORLD_W + 2 * T, PL, T, 0, PL / 2, z);
    wallBox(w.high, M.cladding, WORLD_W + 2 * T, 6.0 - PL, T, 0, (PL + 6.0) / 2, z);
    wallBox(w.high, M.glassTint, WORLD_W + 2 * T, 1.2, T * 0.6, 0, 6.6, z); // 采光带
    wallBox(w.high, M.cladding, WORLD_W + 2 * T, Hh - 7.2, T, 0, (7.2 + Hh) / 2, z);
    for (let x = -HW; x <= HW; x += 7.5) wallBox(w.high, M.steelGrey, 0.12, 1.2, T * 0.8, x, 6.6, z);
  }
  // 东西墙（沿 z）含月台门洞
  for (const [name, x] of [['west', -HW - T / 2], ['east', HW + T / 2]]) {
    const w = mk(name);
    const cuts = DOCK_ROWS.map((r) => [cz(r) - DOOR.w / 2, cz(r) + DOOR.w / 2]);
    let z0 = -HD;
    const segs = [];
    for (const [a, bnd] of cuts) {
      segs.push([z0, a]);
      z0 = bnd;
    }
    segs.push([z0, HD]);
    for (const [a, bnd] of segs) {
      const L = bnd - a, zc = (a + bnd) / 2;
      wallBox(w.low, M.plinth, T, PL, L, x, PL / 2, zc);
      wallBox(w.high, M.cladding, T, 6.0 - PL, L, x, (PL + 6.0) / 2, zc);
    }
    for (const [a, bnd] of cuts) {
      wallBox(w.high, M.cladding, T, 6.0 - DOOR.h, bnd - a, x, (DOOR.h + 6.0) / 2, (a + bnd) / 2);
      // 门框（黄黑）
      for (const zz of [a, bnd]) wallBox(w.low, M.hazard, T + 0.08, DOOR.h, 0.12, x, DOOR.h / 2, zz, 0.6);
      wallBox(w.low, M.hazard, T + 0.08, 0.12, bnd - a, x, DOOR.h, (a + bnd) / 2, 0.6);
    }
    wallBox(w.high, M.glassTint, T * 0.6, 1.2, WORLD_D, x, 6.6, 0);
    wallBox(w.high, M.cladding, T, Hh - 7.2, WORLD_D, x, (7.2 + Hh) / 2, 0);
    // 山墙三角部分
    const shape = new THREE.Shape();
    shape.moveTo(-HD, 0);
    shape.lineTo(HD, 0);
    shape.lineTo(0, BUILDING.ridgeH - Hh);
    shape.closePath();
    const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false }), M.cladding);
    gable.rotation.y = Math.PI / 2;
    gable.position.set(x - T / 2, Hh, 0);
    gable.castShadow = true;
    w.high.add(gable);
    // 月台雨棚
    for (const r of DOCK_ROWS) {
      const s = Math.sign(x);
      wallBox(w.high, M.steelGrey, 2.4, 0.12, DOOR.w + 2.6, x + s * 1.2, DOOR.h + 1.3, cz(r));
    }
  }
  return walls;
}

// 根据相机位置隐藏面向相机的墙体上部（剖切视图）
export function updateWallCutaway(walls, camera) {
  const p = camera.position;
  const m = 2;
  walls.north.high.visible = p.z > -HD - m;
  walls.south.high.visible = p.z < HD + m;
  walls.west.high.visible = p.x > -HW - m;
  walls.east.high.visible = p.x < HW + m;
  walls.roof.visible = p.y < BUILDING.eaveH - 1;
}

// ================================================================ 钢结构
function buildStructure(scene) {
  const b = new Batcher();
  const rb = new Batcher(); // 屋面层：桁架、檩条、灯具、桥架（俯视时隐藏）
  const Hh = BUILDING.eaveH, Hr = BUILDING.ridgeH;
  const roofY = (z) => Hh + (Hr - Hh) * (1 - Math.abs(z) / HD);
  const frames = [];
  for (let x = -HW; x <= HW + 0.01; x += 7.5) frames.push(x);

  for (const x of frames) {
    const xi = Math.max(-HW + 0.25, Math.min(HW - 0.25, x));
    // 南北墙 H 型钢柱
    for (const s of [-1, 1]) b.hColumn(M.structBlue, xi, 0, Hh, s * (HD - 0.2), 0.4, 0);
    // 屋面桁架：上弦（坡）、下弦（平）、腹杆
    const n = 12;
    for (let i = 0; i < n; i++) {
      const za = -HD + (i * WORLD_D) / n, zb = -HD + ((i + 1) * WORLD_D) / n;
      rb.beam(M.structBlue, new THREE.Vector3(xi, roofY(za), za), new THREE.Vector3(xi, roofY(zb), zb), 0.2, 0.25);
      rb.beam(M.structBlue, new THREE.Vector3(xi, Hh - 0.6, za), new THREE.Vector3(xi, Hh - 0.6, zb), 0.16, 0.16);
      rb.beam(M.structBlue, new THREE.Vector3(xi, Hh - 0.6, za), new THREE.Vector3(xi, roofY(zb), zb), 0.08);
      rb.beam(M.structBlue, new THREE.Vector3(xi, Hh - 0.6, zb), new THREE.Vector3(xi, roofY(zb), zb), 0.08);
    }
  }
  // 东西山墙抗风柱
  for (const s of [-1, 1]) {
    for (let z = -HD + 7.5; z < HD; z += 7.5) {
      if (DOCK_ROWS.some((r) => Math.abs(cz(r) - z) < DOOR.w / 2 + 0.4)) continue;
      b.hColumn(M.structBlue, s * (HW - 0.2), 0, Hh, z, 0.32, Math.PI / 2);
    }
  }
  // 檩条（沿 x）
  for (let z = -HD; z <= HD + 0.01; z += WORLD_D / 12) {
    rb.box(M.galv, WORLD_W, 0.18, 0.08, 0, roofY(z) + 0.2, z, 0, { cast: false });
  }
  // 水平支撑 / 屋脊
  rb.box(M.structBlue, WORLD_W, 0.3, 0.2, 0, Hr + 0.1, 0);
  // 电缆桥架（沿 x）
  for (const z of [-8, 8]) {
    rb.box(M.galv, WORLD_W - 1, 0.1, 0.4, 0, 9.6, z, 0, { cast: false });
    for (let x = -HW + 3.75; x < HW; x += 7.5) rb.box(M.galv, 0.04, Hh - 0.6 - 9.6, 0.04, x, (Hh - 0.6 + 9.6) / 2, z, 0, { cast: false });
  }
  // 高天棚 LED 灯
  const lampMat = M.lamp;
  for (let x = -HW + 3.75; x < HW; x += 7.5) {
    for (let z = -HD + 3.2; z < HD; z += 6.25) {
      rb.cyl(M.steelGrey, 0.28, 0.25, x, Hh - 1.4, z, 'y', 20, { cast: false });
      rb.cyl(lampMat, 0.25, 0.03, x, Hh - 1.54, z, 'y', 20, { cast: false, receive: false });
      rb.cyl(M.galv, 0.01, 0.8, x, Hh - 0.9, z, 'y', 4, { cast: false });
    }
  }
  b.flush(scene);
  const roof = new THREE.Group();
  rb.flush(roof);
  scene.add(roof);
  return roof;
}

// ================================================================ 中控室 / 办公楼
function buildOffice(scene) {
  const x0 = cx(OFFICE.c0) - CELL / 2 + 0.1, x1 = HW - 0.1;
  const z0 = -HD + 0.1, z1 = cz(OFFICE.r1) + CELL / 2 - 0.1;
  const W = x1 - x0, D = z1 - z0, xc = (x0 + x1) / 2, zc = (z0 + z1) / 2;
  const F = 3.6;
  const b = new Batcher();
  // 一层：实墙 + 窗
  b.box(M.paintWhite, W, F, 0.2, xc, F / 2, z1);
  b.box(M.paintWhite, 0.2, F, D, x0, F / 2, zc);
  for (let x = x0 + 1.5; x < x1 - 1; x += 3) b.box(M.glassTint, 1.8, 1.2, 0.22, x, 1.7, z1);
  for (let z = z0 + 2; z < z1 - 1; z += 3) b.box(M.glassTint, 0.22, 1.2, 1.8, x0, 1.7, z);
  b.box(M.structBlue, 1.4, 2.4, 0.24, x0 + 2.2, 1.2, z1); // 门
  // 楼板 + 二层中控室（玻璃幕墙）
  b.box(M.paintGrey, W + 0.6, 0.3, D + 0.6, xc - 0.3, F + 0.15, zc + 0.3);
  b.box(M.paintGrey, W + 0.6, 0.3, D + 0.6, xc - 0.3, 2 * F + 0.15, zc + 0.3);
  for (let x = x0; x <= x1; x += 2.2) b.box(M.steelDark, 0.1, F, 0.1, x, F * 1.5 + 0.15, z1 + 0.25);
  for (let z = z0; z <= z1; z += 2.2) b.box(M.steelDark, 0.1, F, 0.1, x0 - 0.25, F * 1.5 + 0.15, z);
  // 二层护栏
  b.box(M.galv, W + 0.6, 0.05, 0.05, xc - 0.3, 2 * F + 1.25, z1 + 0.55);
  // 室内控制台 + 大屏
  for (let k = 0; k < 3; k++) b.box(M.steelDark, 6, 0.8, 0.8, xc - 2 + k * 0.0, F + 0.7, z1 - 1.6 - k * 1.7);
  b.flush(scene);

  const glassS = new THREE.Mesh(new THREE.PlaneGeometry(W, F - 0.3), M.glass);
  glassS.position.set(xc, F * 1.5 + 0.15, z1 + 0.25);
  scene.add(glassS);
  const glassW = new THREE.Mesh(new THREE.PlaneGeometry(D, F - 0.3), M.glass);
  glassW.position.set(x0 - 0.25, F * 1.5 + 0.15, zc);
  glassW.rotation.y = -Math.PI / 2;
  scene.add(glassW);

  // 大屏（发光）
  const wallTex = canvasTex(1024, 256, (ctx, w, h) => {
    ctx.fillStyle = '#04121f';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#0e3550';
    for (let i = 0; i < 4; i++) ctx.strokeRect(8 + i * 254, 8, 246, h - 16);
    ctx.fillStyle = '#4fc3f7';
    ctx.font = 'bold 26px "Microsoft YaHei"';
    ['产线看板', 'AMR 车队', '立体库', '能耗监控'].forEach((t, i) => ctx.fillText(t, 22 + i * 254, 44));
    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = ['#66bb6a', '#29b6f6', '#ffca28', '#ef5350'][i];
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let k = 0; k < 20; k++) ctx.lineTo(22 + i * 254 + k * 11, 200 - Math.random() * 110);
      ctx.stroke();
    }
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25),
    new THREE.MeshStandardMaterial({ map: wallTex, emissive: 0xffffff, emissiveMap: wallTex, emissiveIntensity: 0.9 }));
  screen.position.set(xc, F * 1.5 + 0.5, z0 + 0.15);
  scene.add(screen);

  const sign = signMesh([{ text: '中央控制室', font: 'bold 64px "Microsoft YaHei"', color: '#ffffff' },
    { text: 'FLEET CONTROL CENTER', font: 'bold 34px "Segoe UI"', color: '#80d8ff' }], 6.4, 1.2, { w: 640, h: 120, bg: '#0d2a45' });
  sign.position.set(xc, 2 * F + 0.95, z1 + 0.56);
  scene.add(sign);

  // 楼梯
  const sb = new Batcher();
  const sx = x0 - 1.0;
  for (let i = 0; i < 18; i++) {
    sb.box(M.galv, 1.1, 0.05, 0.32, sx, 0.2 * (i + 1), z1 - 0.3 - i * 0.3);
  }
  sb.beam(M.safetyYellow, new THREE.Vector3(sx - 0.55, 1.0, z1 - 0.2), new THREE.Vector3(sx - 0.55, F + 1.0, z1 - 5.6), 0.05);
  sb.beam(M.steelGrey, new THREE.Vector3(sx, 0, z1 - 0.2), new THREE.Vector3(sx, F, z1 - 5.6), 0.12, 0.3);
  sb.flush(scene);
}

// ================================================================ 充电桩
function buildChargers(scene) {
  const chargers = [];
  const b = new Batcher();
  for (const c of CHARGER_COLS) {
    const x = cx(c), z = cz(0);
    b.box(M.paintWhite, 0.7, 1.25, 0.38, x, 0.625, z - 0.35);
    b.box(M.structBlue, 0.72, 0.12, 0.4, x, 1.1, z - 0.35);
    b.box(M.steelDark, 0.7, 0.03, 1.0, x, 0.015, z + 0.2);           // 地面导向板
    b.box(M.steelGrey, 0.32, 0.12, 0.75, x, 0.2, z + 0.2);           // 充电臂
    b.box(M.plasticBlack, 0.52, 0.16, 0.16, x, 0.22, z + 0.6);       // 充电刷块
    for (const s of [-1, 1]) b.box(M.copper, 0.1, 0.06, 0.03, x + s * 0.13, 0.22, z + 0.69);
    b.box(M.galv, 0.1, 6.0, 0.08, x + 0.25, 1.25 + 3.0, z - 0.5);    // 电缆管
    b.box(M.hazard, 0.9, 0.02, 0.1, x, 0.01, z + 0.74, 0, { cast: false });
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.02), lightMat(0x42a5f5, 1.2));
    led.position.set(x, 0.92, z - 0.155);
    scene.add(led);
    const tag = signMesh(`CH-${String((c + 1) / 2).padStart(2, '0')}`, 0.5, 0.18, { w: 200, h: 72, bg: '#0d2a45', font: 'bold 44px Consolas' });
    tag.position.set(x, 0.72, z - 0.155);
    scene.add(tag);
    chargers.push({ c, r: 1, cell: { c, r: 1 }, led, robot: null, reserved: null, id: `CH-${(c + 1) / 2}` });
  }
  b.flush(scene);
  return chargers;
}

// ================================================================ 安全设施 / 杂项
function buildSafetyProps(scene) {
  const b = new Batcher();
  // 灭火器箱（贴墙）
  const ext = [[-HW + 0.25, cz(8)], [-HW + 0.25, cz(28)], [HW - 0.25, cz(28)], [cx(4), HD - 0.25], [cx(20), HD - 0.25], [cx(38), HD - 0.25]];
  for (const [x, z] of ext) {
    b.box(M.red, 0.45, 0.8, 0.25, x, 0.9, z);
    b.cyl(M.red, 0.08, 0.5, x + (Math.abs(x) > HW - 1 ? -Math.sign(x) * 0.25 : 0), 0.25, z + (Math.abs(z) > HD - 1 ? -Math.sign(z) * 0.25 : 0), 'y', 12);
  }
  // 南墙下：维修区工作台、零件架
  for (let k = 0; k < 3; k++) {
    const x = cx(38 + k * 3);
    b.box(M.steelGrey, 2.0, 0.06, 0.8, x, 0.9, HD - 0.7);
    for (const s of [-1, 1]) b.box(M.steelDark, 0.06, 0.9, 0.7, x + s * 0.95, 0.45, HD - 0.7);
    b.box(M.structBlue, 2.0, 1.4, 0.05, x, 1.65, HD - 0.3);
  }
  b.flush(scene);
  // 安全出口标识
  for (const [x, z, ry] of [[-HW + 0.15, cz(10), Math.PI / 2], [HW - 0.15, cz(28), -Math.PI / 2], [cx(10), -HD + 0.15, 0]]) {
    const s = signMesh('🏃 安全出口 EXIT', 1.4, 0.4, { w: 360, h: 100, bg: '#1b8f3a', font: 'bold 40px "Microsoft YaHei"' });
    s.position.set(x, 3.0, z);
    s.rotation.y = ry;
    scene.add(s);
  }
}

export { textTexture };
