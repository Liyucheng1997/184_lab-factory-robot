// 构建仓库场景：地面、围墙、货架、出货区、充电区、灯光
import * as THREE from 'three';
import { Grid, COLS, ROWS, CELL } from './grid.js';

// 4 组双排货架，每组占 2 行、跨 24 列
export const RACKS = [
  { r0: 5, c0: 6, c1: 29 },
  { r0: 10, c0: 6, c1: 29 },
  { r0: 15, c0: 6, c1: 29 },
  { r0: 20, c0: 6, c1: 29 },
];
export const HOME_ROWS = [4, 7, 10, 13, 16, 19]; // 充电位所在行(列 2)
export const DROP_ROWS = [5, 8, 11, 14, 17, 20]; // 出货点所在行(停靠列 36, 放货列 37)

const SHELF_Y = 0.5;       // 下层货架横梁高度
const SHELF_TOP = 0.52;    // 下层搁板顶面
export const CARGO_SIZE = 0.55;

export function buildWarehouse(scene) {
  const grid = new Grid();

  // ---- 网格静态障碍 ----
  for (let c = 0; c < COLS; c++) { grid.block(c, 0); grid.block(c, ROWS - 1); }
  for (let r = 0; r < ROWS; r++) { grid.block(0, r); grid.block(COLS - 1, r); }
  for (const rack of RACKS) {
    for (let c = rack.c0; c <= rack.c1; c++) {
      grid.block(c, rack.r0);
      grid.block(c, rack.r0 + 1);
    }
  }
  for (const r of HOME_ROWS) grid.block(1, r); // 充电桩本体

  // ---- 地面 ----
  const floorTex = paintFloorTexture();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(COLS * CELL, ROWS * CELL),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.92, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // ---- 围墙与立柱 ----
  buildWalls(scene, grid);

  // ---- 货架 ----
  const slots = [];
  for (const rack of RACKS) {
    buildRack(scene, grid, rack);
    for (let c = rack.c0; c <= rack.c1; c += 2) {
      // 上侧取货位
      slots.push({
        accessCell: { c, r: rack.r0 - 1 },
        shelfPos: toVec3(grid.cellToWorld(c, rack.r0, SHELF_TOP + CARGO_SIZE / 2)),
        occupied: false,
      });
      // 下侧取货位
      slots.push({
        accessCell: { c, r: rack.r0 + 2 },
        shelfPos: toVec3(grid.cellToWorld(c, rack.r0 + 1, SHELF_TOP + CARGO_SIZE / 2)),
        occupied: false,
      });
    }
  }

  // ---- 出货点 ----
  const dropPoints = DROP_ROWS.map((r) => ({
    cell: { c: 36, r },
    cargoCell: { c: 37, r },
    busy: false,
  }));

  // ---- 充电位 ----
  const homes = HOME_ROWS.map((r) => ({ c: 2, r }));
  buildChargers(scene, grid);

  // ---- 装饰: 码头门 / 托盘堆 / 灯轨 ----
  buildDockDoors(scene, grid);
  buildProps(scene, grid);
  buildLightRails(scene);

  // ---- 灯光 ----
  const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x3a3f46, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.0);
  sun.position.set(18, 30, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -28;
  sun.shadow.camera.right = 28;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  return { grid, slots, dropPoints, homes };
}

function toVec3(p) {
  return new THREE.Vector3(p.x, p.y, p.z);
}

// ============ 地面贴图（画在 canvas 上的标线/分区） ============
function paintFloorTexture() {
  const S = 24; // 每格像素
  const cv = document.createElement('canvas');
  cv.width = COLS * S;
  cv.height = ROWS * S;
  const ctx = cv.getContext('2d');

  // 混凝土底色 + 噪点
  ctx.fillStyle = '#7f858d';
  ctx.fillRect(0, 0, cv.width, cv.height);
  for (let i = 0; i < 6000; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)';
    ctx.fillRect(Math.random() * cv.width, Math.random() * cv.height, 2, 2);
  }

  // 细网格线
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 1;
  for (let c = 0; c <= COLS; c++) {
    ctx.beginPath(); ctx.moveTo(c * S, 0); ctx.lineTo(c * S, cv.height); ctx.stroke();
  }
  for (let r = 0; r <= ROWS; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * S); ctx.lineTo(cv.width, r * S); ctx.stroke();
  }

  // 货架脚印 + 黄色警示边框
  for (const rack of RACKS) {
    const x = rack.c0 * S, y = rack.r0 * S;
    const w = (rack.c1 - rack.c0 + 1) * S, h = 2 * S;
    ctx.fillStyle = 'rgba(40,44,50,0.35)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#d8b93f';
    ctx.lineWidth = 3;
    ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
  }

  // 出货区(绿色)
  ctx.fillStyle = 'rgba(46,125,68,0.22)';
  ctx.fillRect(33 * S, 3 * S, 7 * S, 20 * S);
  ctx.setLineDash([10, 8]);
  ctx.strokeStyle = 'rgba(86,211,100,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(33 * S, 3 * S, 7 * S, 20 * S);
  ctx.setLineDash([]);
  drawVerticalText(ctx, '出货区', 38.7 * S, 11.2 * S, S * 0.9, 'rgba(200,255,210,0.5)');

  // 充电区(蓝色)
  ctx.fillStyle = 'rgba(52,101,164,0.22)';
  ctx.fillRect(1 * S, 3 * S, 3 * S, 18 * S);
  ctx.setLineDash([10, 8]);
  ctx.strokeStyle = 'rgba(124,196,255,0.5)';
  ctx.strokeRect(1 * S, 3 * S, 3 * S, 18 * S);
  ctx.setLineDash([]);
  drawVerticalText(ctx, '充电区', 2.5 * S - S * 0.45, 21.4 * S, S * 0.9, 'rgba(190,225,255,0.55)');

  // 出货点标记
  for (const r of DROP_ROWS) {
    // 放货格：绿色方框 + 十字
    const x = 37 * S, y = r * S;
    ctx.strokeStyle = 'rgba(120,230,140,0.85)';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x + 3, y + 3, S - 6, S - 6);
    ctx.beginPath();
    ctx.moveTo(x + S / 2, y + 7); ctx.lineTo(x + S / 2, y + S - 7);
    ctx.moveTo(x + 7, y + S / 2); ctx.lineTo(x + S - 7, y + S / 2);
    ctx.stroke();
    // 停靠格：白色角标
    const x2 = 36 * S;
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    drawCorners(ctx, x2 + 3, y + 3, S - 6, S - 6, 6);
  }

  // 充电位标记
  for (const r of HOME_ROWS) {
    const x = 2 * S, y = r * S;
    ctx.strokeStyle = 'rgba(124,196,255,0.8)';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x + 3, y + 3, S - 6, S - 6);
    ctx.fillStyle = 'rgba(124,196,255,0.8)';
    ctx.font = `bold ${S * 0.55}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚡', x + S / 2, y + S / 2 + 1);
  }

  // 通道中线(白色虚线)
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 2;
  ctx.setLineDash([14, 12]);
  for (const rCenter of [2.5, 8.5, 13.5, 18.5, 23.5]) {
    ctx.beginPath();
    ctx.moveTo(1.2 * S, rCenter * S);
    ctx.lineTo(32.5 * S, rCenter * S);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function drawVerticalText(ctx, text, x, y, size, color) {
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < text.length; i++) {
    ctx.fillText(text[i], x, y + i * size * 1.15);
  }
}

function drawCorners(ctx, x, y, w, h, len) {
  ctx.beginPath();
  ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
  ctx.moveTo(x + w - len, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + len);
  ctx.moveTo(x + w, y + h - len); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - len, y + h);
  ctx.moveTo(x + len, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - len);
  ctx.stroke();
}

// ============ 围墙 ============
function buildWalls(scene, grid) {
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xaeb4bb, roughness: 0.9 });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.8 });
  const H = 2.8, T = 0.5;
  const halfW = COLS / 2, halfH = ROWS / 2;

  const walls = [
    { size: [COLS, H, T], pos: [0, H / 2, -halfH + 0.5] },
    { size: [COLS, H, T], pos: [0, H / 2, halfH - 0.5] },
    { size: [T, H, ROWS - 2], pos: [-halfW + 0.5, H / 2, 0] },
    { size: [T, H, ROWS - 2], pos: [halfW - 0.5, H / 2, 0] },
  ];
  for (const w of walls) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...w.size), wallMat);
    mesh.position.set(...w.pos);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    // 底部深色踢脚带
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(w.size[0] + 0.04, 0.5, w.size[2] + 0.04),
      bandMat
    );
    band.position.set(w.pos[0], 0.25, w.pos[2]);
    scene.add(band);
  }

  // 内侧立柱
  const colMat = new THREE.MeshStandardMaterial({ color: 0x565d66, roughness: 0.7, metalness: 0.3 });
  const colGeo = new THREE.BoxGeometry(0.36, 3.1, 0.36);
  for (let c = 6; c < COLS - 2; c += 9) {
    for (const r of [0, ROWS - 1]) {
      const p = grid.cellToWorld(c, r);
      const col = new THREE.Mesh(colGeo, colMat);
      col.position.set(p.x, 1.55, p.z);
      col.castShadow = true;
      scene.add(col);
    }
  }
}

// ============ 货架（蓝色立柱 + 橙色横梁 + 搁板） ============
const postMat = new THREE.MeshStandardMaterial({ color: 0x2f5d9e, roughness: 0.5, metalness: 0.4 });
const beamMat = new THREE.MeshStandardMaterial({ color: 0xd97a2b, roughness: 0.55, metalness: 0.3 });
const boardMat = new THREE.MeshStandardMaterial({ color: 0x878d95, roughness: 0.8 });
const decorColors = [0xc98d4e, 0xb0b6bd, 0x8aa3b8, 0xa38b6b];

function buildRack(scene, grid, rack) {
  const group = new THREE.Group();
  const len = (rack.c1 - rack.c0 + 1) * CELL;
  const cx = ((rack.c0 + rack.c1 + 1) / 2 - COLS / 2) * CELL;
  const z0 = (rack.r0 - ROWS / 2) * CELL;       // 货架前边
  const z1 = (rack.r0 + 2 - ROWS / 2) * CELL;   // 货架后边
  const H = 2.3;

  // 立柱：每 4 格一副框架
  const postGeo = new THREE.BoxGeometry(0.09, H, 0.09);
  for (let c = rack.c0; c <= rack.c1 + 1; c += 4) {
    const x = (c - COLS / 2) * CELL;
    for (const z of [z0 + 0.07, z1 - 0.07]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(x, H / 2, z);
      post.castShadow = true;
      group.add(post);
    }
    // 框架横撑
    const braceGeo = new THREE.BoxGeometry(0.05, 0.05, z1 - z0 - 0.14);
    for (const y of [0.45, 1.4]) {
      const brace = new THREE.Mesh(braceGeo, postMat);
      brace.position.set(x, y, (z0 + z1) / 2);
      group.add(brace);
    }
  }

  // 橙色横梁：两个层高、前后两面
  const beamGeo = new THREE.BoxGeometry(len, 0.1, 0.07);
  for (const y of [SHELF_Y, 1.45]) {
    for (const z of [z0 + 0.05, z1 - 0.05]) {
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.set(cx, y, (z0 + z1) / 2 + (z < (z0 + z1) / 2 ? -(z1 - z0) / 2 + 0.05 : (z1 - z0) / 2 - 0.05));
      beam.position.z = z;
      beam.castShadow = true;
      group.add(beam);
    }
  }

  // 搁板
  const boardGeo = new THREE.BoxGeometry(len - 0.06, 0.04, z1 - z0 - 0.12);
  for (const y of [SHELF_Y, 1.45]) {
    const board = new THREE.Mesh(boardGeo, boardMat);
    board.position.set(cx, y + 0.05, (z0 + z1) / 2);
    board.receiveShadow = true;
    group.add(board);
  }

  // 上层装饰货物
  for (let i = 0; i < 10; i++) {
    const s = 0.35 + Math.random() * 0.35;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(s, s * (0.7 + Math.random() * 0.5), s),
      new THREE.MeshStandardMaterial({
        color: decorColors[Math.floor(Math.random() * decorColors.length)],
        roughness: 0.85,
      })
    );
    const x = cx - len / 2 + 0.6 + Math.random() * (len - 1.2);
    box.position.set(x, 1.5 + box.geometry.parameters.height / 2, (z0 + z1) / 2 + (Math.random() - 0.5) * 0.8);
    box.rotation.y = (Math.random() - 0.5) * 0.4;
    box.castShadow = true;
    group.add(box);
  }

  scene.add(group);
}

// ============ 充电桩 ============
function buildChargers(scene, grid) {
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x33383f, roughness: 0.6, metalness: 0.3 });
  const stripeMat = new THREE.MeshStandardMaterial({
    color: 0xffc832, emissive: 0xffc832, emissiveIntensity: 0.35, roughness: 0.5,
  });
  for (const r of HOME_ROWS) {
    const p = grid.cellToWorld(1, r);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.75, 0.55), bodyMat);
    body.position.set(p.x, 0.375, p.z);
    body.castShadow = true;
    scene.add(body);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.3), stripeMat);
    stripe.position.set(p.x + 0.18, 0.42, p.z);
    scene.add(stripe);
  }
}

// ============ 码头卷帘门 ============
function buildDockDoors(scene, grid) {
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x51575f, roughness: 0.65, metalness: 0.45 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xd8b93f, roughness: 0.6 });
  const x = (COLS / 2 - 0.5) * CELL - 0.26;
  for (const rCenter of [7, 13, 19]) {
    const z = (rCenter - ROWS / 2 + 0.5) * CELL;
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.2, 3), doorMat);
    door.position.set(x, 1.15, z);
    scene.add(door);
    for (const dz of [-1.6, 1.6]) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 0.14), frameMat);
      frame.position.set(x, 1.2, z + dz);
      scene.add(frame);
    }
  }
}

// ============ 杂物道具（托盘堆） ============
function buildProps(scene, grid) {
  const palletMat = new THREE.MeshStandardMaterial({ color: 0x9c7b52, roughness: 0.9 });
  const spots = [
    { c: 38, r: 2 }, { c: 39, r: 2 }, { c: 38, r: 23 },
  ];
  for (const s of spots) {
    grid.block(s.c, s.r);
    const p = grid.cellToWorld(s.c, s.r);
    const n = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const pallet = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.09, 0.85), palletMat);
      pallet.position.set(p.x, 0.05 + i * 0.11, p.z);
      pallet.rotation.y = (Math.random() - 0.5) * 0.25;
      pallet.castShadow = true;
      scene.add(pallet);
    }
  }
}

// ============ 顶部灯轨 ============
function buildLightRails(scene) {
  const railMat = new THREE.MeshStandardMaterial({ color: 0x6a7078, roughness: 0.6, metalness: 0.4 });
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xfff7e0, emissive: 0xfff3d0, emissiveIntensity: 1.3,
  });
  for (const rCenter of [2.5, 8.5, 13.5, 18.5, 23.5]) {
    const z = (rCenter - ROWS / 2) * CELL;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(24, 0.07, 0.16), railMat);
    rail.position.set(-2, 4.1, z);
    scene.add(rail);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(23.6, 0.03, 0.12), lampMat);
    lamp.position.set(-2, 4.05, z);
    scene.add(lamp);
    // 吊杆
    for (const x of [-13, -2, 9]) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 6), railMat);
      rod.position.set(x, 4.9, z);
      scene.add(rod);
    }
  }
}
