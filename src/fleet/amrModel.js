// 辊筒顶升式 AMR 外观模型（约 1050 × 820 × 620 mm，差速驱动 + 四万向轮）
// 前左/后右对角激光安全扫描仪、环形 LED 状态灯带、急停、端部挡停、充电触点、尾部状态屏
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { AMR, TRANSFER_H } from '../config.js';
import { M, makeRollerTexture, canvasTex } from '../core/materials.js';
import { Batcher } from '../core/batcher.js';

const L = AMR.length, W = AMR.width;
const ROLLER_R = 0.032;

const shared = {
  skirt: new RoundedBoxGeometry(W - 0.02, 0.14, L - 0.03, 2, 0.04),
  body: new RoundedBoxGeometry(W, 0.28, L, 3, 0.06),
  stripe: new RoundedBoxGeometry(W + 0.006, 0.05, L + 0.006, 3, 0.06),
  led: new RoundedBoxGeometry(W + 0.012, 0.02, L + 0.012, 3, 0.06),
  bodyMat: new THREE.MeshStandardMaterial({ color: 0xeceff1, roughness: 0.35, metalness: 0.15 }),
  skirtMat: new THREE.MeshStandardMaterial({ color: 0x2b2f34, roughness: 0.7, metalness: 0.2 }),
  lidarBody: new THREE.CylinderGeometry(0.06, 0.065, 0.05, 24),
  lidarWin: new THREE.CylinderGeometry(0.055, 0.055, 0.065, 24),
  lidarMat: new THREE.MeshStandardMaterial({ color: 0xf6c500, roughness: 0.4 }),
  winMat: new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.1, metalness: 0.6 }),
  wheel: new THREE.CylinderGeometry(0.09, 0.09, 0.05, 20).rotateZ(Math.PI / 2),
  caster: new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12).rotateZ(Math.PI / 2),
  rollers: (() => {
    const list = [];
    const n = 8;
    for (let i = 0; i < n; i++) {
      const g = new THREE.CylinderGeometry(ROLLER_R, ROLLER_R, W - 0.12, 14, 1, true).toNonIndexed();
      g.rotateZ(Math.PI / 2);
      g.translate(0, TRANSFER_H - ROLLER_R, -0.44 + (i * 0.88) / (n - 1));
      list.push(g);
    }
    return mergeGeometries(list, false);
  })(),
};

const FIELD_GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);

export function buildAMR(id, accent) {
  const g = new THREE.Group();
  g.name = `AMR-${id}`;
  const add = (geo, mat, x, y, z, parent = g) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const accentMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.35, metalness: 0.2 });
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x3fb6ff, emissive: 0x3fb6ff, emissiveIntensity: 2 });

  // 静态外壳件合批（每台车按材质合并，减少 draw call）
  const sb = new Batcher();
  const st = (geo, mat, x, y, z, shadow = true) => sb.place(geo, mat, x, y, z, 0, 0, 0, 1, 1, 1, { cast: shadow, receive: true });
  st(shared.skirt, shared.skirtMat, 0, 0.115, 0);
  st(shared.body, shared.bodyMat, 0, 0.32, 0);
  st(shared.stripe, accentMat, 0, 0.385, 0);
  const led = add(shared.led, ledMat, 0, 0.215, 0);
  led.castShadow = false;

  // 前后防撞条
  for (const s of [-1, 1]) {
    st(new THREE.BoxGeometry(W - 0.2, 0.08, 0.04), M.rubber, 0, 0.12, s * (L / 2 + 0.005));
  }
  // 充电触点（尾部）
  for (const s of [-1, 1]) st(new THREE.BoxGeometry(0.1, 0.05, 0.012), M.copper, s * 0.13, 0.22, -L / 2 - 0.012, false);

  // 激光安全扫描仪（对角布置，360° 覆盖）
  for (const [x, z] of [[W / 2 - 0.07, L / 2 - 0.07], [-W / 2 + 0.07, -L / 2 + 0.07]]) {
    st(shared.lidarBody, shared.lidarMat, x, 0.12, z);
    st(shared.lidarWin, shared.winMat, x, 0.175, z);
    st(shared.lidarBody, shared.lidarMat, x, 0.235, z);
  }

  // 辊筒台面：底板 + 侧框 + 导向条 + 辊筒
  st(new THREE.BoxGeometry(W - 0.06, 0.04, L - 0.06), M.steelDark, 0, 0.48, 0);
  for (const s of [-1, 1]) {
    st(new THREE.BoxGeometry(0.04, 0.12, L - 0.04), M.galv, s * (W / 2 - 0.03), 0.55, 0);
    st(new THREE.BoxGeometry(0.025, 0.05, L - 0.2), M.safetyYellow, s * (W / 2 - 0.0), 0.645, 0);
  }
  const rollerTex = makeRollerTexture();
  const rollerMat = new THREE.MeshStandardMaterial({ map: rollerTex, roughness: 0.3, metalness: 0.9 });
  const rollers = new THREE.Mesh(shared.rollers, rollerMat);
  g.add(rollers);
  // 驱动电机罩（台面端部）
  for (const s of [-1, 1]) st(new THREE.BoxGeometry(W - 0.14, 0.07, 0.06), M.steelGrey, 0, 0.53, s * (L / 2 - 0.05));

  // 端部挡停（移载时放倒）
  const stoppers = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.6, s * (L / 2 - 0.02));
    add(new THREE.BoxGeometry(0.42, 0.09, 0.025), M.safetyYellow, 0, 0.045, 0, pivot);
    g.add(pivot);
    pivot.userData.s = s;
    stoppers.push(pivot);
  }

  // 急停按钮（两侧）
  for (const s of [-1, 1]) {
    st(new THREE.BoxGeometry(0.012, 0.07, 0.07), M.safetyYellow, s * (W / 2 + 0.004), 0.32, L / 2 - 0.16, false);
    st(new THREE.CylinderGeometry(0.022, 0.022, 0.025, 14).rotateZ(Math.PI / 2), M.red, s * (W / 2 + 0.018), 0.32, L / 2 - 0.16, false);
  }

  // 驱动轮 + 万向轮
  const wheels = [];
  for (const s of [-1, 1]) wheels.push(add(shared.wheel, M.rubber, s * 0.3, 0.09, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) st(shared.caster, M.rubber, sx * 0.31, 0.035, sz * 0.4, false);
  sb.flush(g);

  // 警示灯
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0xffa000, emissive: 0xffa000, emissiveIntensity: 0.2 });
  add(new THREE.SphereGeometry(0.032, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), beaconMat, -W / 2 + 0.08, 0.46, L / 2 - 0.12);

  // 侧面编号贴
  const idTex = canvasTex(256, 64, (ctx) => {
    ctx.fillStyle = '#eceff1';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#' + accent.toString(16).padStart(6, '0');
    ctx.fillRect(0, 0, 14, 64);
    ctx.fillStyle = '#263238';
    ctx.font = 'bold 40px "Segoe UI", sans-serif';
    ctx.fillText(`AMR-${String(id).padStart(2, '0')}`, 26, 46);
  });
  const idMat = new THREE.MeshStandardMaterial({ map: idTex, roughness: 0.4, transparent: false });
  for (const s of [-1, 1]) {
    const p = add(new THREE.PlaneGeometry(0.36, 0.09), idMat, s * (W / 2 + 0.002), 0.29, -0.12);
    p.rotation.y = s * Math.PI / 2;
    p.castShadow = false;
  }

  // 尾部状态屏
  const screenCv = document.createElement('canvas');
  screenCv.width = 128;
  screenCv.height = 48;
  const screenTex = new THREE.CanvasTexture(screenCv);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  const screen = add(new THREE.PlaneGeometry(0.22, 0.083),
    new THREE.MeshStandardMaterial({ map: screenTex, emissive: 0xffffff, emissiveMap: screenTex, emissiveIntensity: 0.8 }),
    0, 0.33, -L / 2 - 0.002);
  screen.rotation.y = Math.PI;
  screen.castShadow = false;

  // 安全防护场（地面投影：黄=警告区，红=保护区）
  const warnField = new THREE.Mesh(FIELD_GEO, new THREE.MeshBasicMaterial({
    color: 0xffc107, transparent: true, opacity: 0.16, depthWrite: false,
  }));
  const protField = new THREE.Mesh(FIELD_GEO, new THREE.MeshBasicMaterial({
    color: 0xff3d00, transparent: true, opacity: 0.26, depthWrite: false,
  }));
  warnField.position.set(0, 0.012, L / 2);
  protField.position.set(0, 0.014, L / 2);
  warnField.renderOrder = protField.renderOrder = 2;
  g.add(warnField, protField);

  // 选中光圈
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 0.9, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.85, depthWrite: false }));
  ring.position.y = 0.015;
  ring.visible = false;
  g.add(ring);

  return {
    group: g, ledMat, rollerTex, stoppers, wheels, beaconMat, ring,
    warnField, protField, screenCv, screenTex,
  };
}

export function drawAMRScreen(parts, id, soc, text) {
  const ctx = parts.screenCv.getContext('2d');
  ctx.fillStyle = '#06121c';
  ctx.fillRect(0, 0, 128, 48);
  ctx.fillStyle = '#7fd4ff';
  ctx.font = 'bold 16px Consolas, monospace';
  ctx.fillText(`#${String(id).padStart(2, '0')} ${text}`, 6, 18);
  ctx.strokeStyle = '#7fd4ff';
  ctx.strokeRect(6, 26, 96, 14);
  ctx.fillStyle = soc > 30 ? '#4cd964' : soc > 15 ? '#ffcc00' : '#ff3b30';
  ctx.fillRect(8, 28, 92 * soc / 100, 10);
  ctx.fillRect(103, 30, 3, 6);
  parts.screenTex.needsUpdate = true;
}
