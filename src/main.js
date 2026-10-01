import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FLEET_SIZE, COLORS, CHARGER_COLS, PARKING, WORKCELLS } from './config.js';
import { Grid } from './core/grid.js';
import { Events } from './wms/events.js';
import { buildBuilding, updateWallCutaway } from './world/building.js';
import { ASRSSystem } from './world/asrs.js';
import { Workcell } from './world/workcell.js';
import { Docks } from './world/docks.js';
import { Robot } from './fleet/robot.js';
import { FleetManager } from './wms/fleetManager.js';
import { Heatmap } from './ui/heatmap.js';
import { HUD } from './ui/hud.js';

// ---------------------------------------------------------------- 渲染
const canvas = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f141a);
scene.fog = new THREE.Fog(0x0f141a, 110, 220);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = 1.48;
controls.minDistance = 3;
controls.maxDistance = 140;

// 灯光：天空漫射 + 主光（阴影）+ 室内补光
scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x30363d, 0.9));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
sun.position.set(28, 48, 22);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 36, bottom: -36, near: 5, far: 140 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.02;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xbfd8ff, 0.5);
fill.position.set(-30, 25, -20);
scene.add(fill);

// ---------------------------------------------------------------- 仿真世界
const events = new Events();
const grid = new Grid();
const { walls, chargers } = buildBuilding(scene, grid);
const asrs = new ASRSSystem(scene, grid, events);
const cells = WORKCELLS.map((c0, i) => new Workcell(scene, grid, i, c0, events));
const docks = new Docks(scene, grid, asrs, events);

const parking = PARKING.map((p) => ({ ...p, reserved: null }));
const spawn = [...CHARGER_COLS.map((c) => ({ c, r: 1 })), ...parking];
const robots = [];
for (let i = 0; i < FLEET_SIZE; i++) {
  robots.push(new Robot({ id: i + 1, color: COLORS.amrAccent[i % COLORS.amrAccent.length], cell: spawn[i], grid, scene, events }));
}
const fleet = new FleetManager({ grid, scene, robots, asrs, cells, docks, chargers, parking, events });
const heatmap = new Heatmap(scene, grid);
events.log('sys', `系统启动：${FLEET_SIZE} 台 AMR，${asrs.capacity} 个货位，${cells.length} 个加工单元`, 'ok');

// ---------------------------------------------------------------- 视角
const VIEWS = {
  overview: { pos: [34, 40, 46], target: [0, 0, 2] },
  asrs: { pos: [10, 16, 6], target: [-1, 3, -10] },
  cells: { pos: [4, 13, 30], target: [-4, 0, 9] },
  docks: { pos: [-50, 24, 26], target: [-26, 0, 5] },
  top: { pos: [0, 70, 0.01], target: [0, 0, 0] },
};
let camAnim = null;
let follow = null;
function setView(name) {
  const v = VIEWS[name];
  if (hud && hud.selected) select(null);
  follow = null;
  camAnim = {
    t: 0, p0: camera.position.clone(), t0: controls.target.clone(),
    p1: new THREE.Vector3(...v.pos), t1: new THREE.Vector3(...v.target),
  };
  document.querySelectorAll('#views button').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
}
camera.position.set(...VIEWS.overview.pos);
controls.target.set(...VIEWS.overview.target);
if (window.innerWidth < 900) camera.position.set(44, 62, 70);

// ---------------------------------------------------------------- UI
let paused = false;
let simSpeed = 1;
let cutaway = true;
const hud = new HUD({ events, fleet, robots, cells, asrs, docks, onSelect: select });

function select(r) {
  if (hud.selected) hud.selected.parts.ring.visible = false;
  hud.selected = r;
  if (r) {
    r.parts.ring.visible = true;
    follow = r;
    // 飞到机器人附近：保持当前观察方位，距离约 10 m
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target).setY(0);
    if (dir.lengthSq() < 1e-3) dir.set(1, 0, 1);
    dir.normalize().multiplyScalar(8).setY(6.5);
    const tgt = new THREE.Vector3(r.group.position.x, 0.6, r.group.position.z);
    camAnim = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: tgt.clone().add(dir), t1: tgt, follow: r };
  } else follow = null;
  hud.update(0);
}

const btnPause = document.getElementById('btn-pause');
function togglePause() {
  paused = !paused;
  btnPause.textContent = paused ? '▶ 继续' : '⏸ 暂停';
  const chip = document.getElementById('run-chip');
  chip.textContent = paused ? '已暂停' : '运行中';
  chip.classList.toggle('paused', paused);
}
btnPause.addEventListener('click', togglePause);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
    e.preventDefault();
    togglePause();
  } else if (e.code === 'Escape') select(null);
});
document.querySelectorAll('#speeds button').forEach((b) => b.addEventListener('click', () => {
  simSpeed = Number(b.dataset.speed);
  document.querySelectorAll('#speeds button').forEach((x) => x.classList.toggle('on', x === b));
}));
document.querySelectorAll('#views button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
// 窄屏：面板按 隐藏 → KPI/车队 → 产线/仓储 循环切换
document.getElementById('panels-toggle').addEventListener('click', () => {
  const cl = document.body.classList;
  if (cl.contains('show-left')) {
    cl.remove('show-left');
    cl.add('show-right');
  } else if (cl.contains('show-right')) cl.remove('show-right');
  else cl.add('show-left');
});
const bind = (id, fn) => document.getElementById(id).addEventListener('change', (e) => fn(e.target.checked));
bind('t-path', (v) => robots.forEach((r) => { r.showPath = v; }));
bind('t-claim', (v) => { fleet.showClaims = v; });
bind('t-field', (v) => robots.forEach((r) => { r.showField = v; }));
bind('t-heat', (v) => { heatmap.visible = v; });
bind('t-cut', (v) => {
  cutaway = v;
  if (!v) {
    for (const k of ['north', 'south', 'west', 'east']) walls[k].high.visible = true;
    walls.roof.visible = true;
  }
});

// 点选机器人
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(robots.map((r) => r.group), true);
  if (hits.length) {
    let o = hits[0].object;
    while (o && !o.userData.robot) o = o.parent;
    if (o) select(o.userData.robot);
  }
});
controls.addEventListener('start', () => { camAnim = null; });

function fitViewport() {
  camera.aspect = window.innerWidth / Math.max(window.innerHeight, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', fitViewport);

// ---------------------------------------------------------------- 主循环
const H = 1 / 30;
function stepSim(dt) {
  events.time += dt;
  docks.update(dt);
  asrs.update(dt);
  for (const c of cells) c.update(dt);
  fleet.update(dt);
  for (const r of robots) r.update(dt);
}

const clock = new THREE.Clock();
let acc = 0;
let uiTimer = 0;
let lastW = 0, lastH = 0;
const followOffset = new THREE.Vector3();
function tick() {
  if (lastW !== window.innerWidth || lastH !== window.innerHeight) {
    lastW = window.innerWidth;
    lastH = window.innerHeight;
    fitViewport();
  }
  const raw = Math.min(clock.getDelta(), 0.1);
  if (!paused) {
    acc += raw * simSpeed;
    let n = 0;
    while (acc >= H && n < 24) {
      stepSim(H);
      acc -= H;
      n++;
    }
    if (n >= 24) acc = 0;
  }
  fleet.updateClaims();
  heatmap.update(raw);

  // 相机：预设过渡 / 跟随
  if (camAnim) {
    camAnim.t = Math.min(1, camAnim.t + raw / 1.2);
    const k = 1 - Math.pow(1 - camAnim.t, 3);
    if (camAnim.follow) {
      // 目标随机器人移动
      const p = camAnim.follow.group.position;
      camAnim.p1.add(new THREE.Vector3(p.x - camAnim.t1.x, 0, p.z - camAnim.t1.z));
      camAnim.t1.set(p.x, 0.6, p.z);
    }
    camera.position.lerpVectors(camAnim.p0, camAnim.p1, k);
    controls.target.lerpVectors(camAnim.t0, camAnim.t1, k);
    if (camAnim.t >= 1) camAnim = null;
  } else if (follow) {
    followOffset.subVectors(camera.position, controls.target);
    const goal = new THREE.Vector3(follow.group.position.x, 0.6, follow.group.position.z);
    controls.target.lerp(goal, Math.min(1, raw * 4));
    camera.position.copy(controls.target).add(followOffset);
  }
  controls.update();
  if (cutaway) updateWallCutaway(walls, camera);

  uiTimer -= raw;
  if (uiTimer <= 0) {
    uiTimer = 0.25;
    hud.update(raw);
  }
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(tick);
document.getElementById('loading').style.opacity = 0;
setTimeout(() => document.getElementById('loading').remove(), 500);
// 页面隐藏时 rAF 暂停，用定时器兜底推进仿真
setInterval(() => { if (document.hidden) tick(); }, 100);

// 调试钩子
window.__sim = {
  THREE, renderer, scene, camera, controls, grid, events, robots, fleet, asrs, cells, docks, heatmap,
  setView, select,
  step(seconds) {
    for (let t = 0; t < seconds; t += H) stepSim(H);
    fleet.updateClaims();
    hud.update(0);
    renderer.render(scene, camera);
  },
};
