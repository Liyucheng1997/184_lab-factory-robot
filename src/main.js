import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildWarehouse } from './warehouse.js';
import { Robot, STATE_LABEL } from './robot.js';
import { Dispatcher } from './dispatcher.js';

// ---------- 渲染器 / 场景 / 相机 ----------
const canvas = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1e2126);
scene.fog = new THREE.Fog(0x1e2126, 60, 130);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(24, 24, 26);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 1);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = 1.42;
controls.minDistance = 6;
controls.maxDistance = 80;

let lastW = window.innerWidth;
let lastH = window.innerHeight;
function fitViewport() {
  lastW = window.innerWidth;
  lastH = window.innerHeight;
  camera.aspect = lastW / Math.max(lastH, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(lastW, lastH);
}
window.addEventListener('resize', fitViewport);

// ---------- 场景 / 机器人 / 调度 ----------
const { grid, slots, dropPoints, homes } = buildWarehouse(scene);

const ROBOT_COLORS = [0xe4573d, 0x3d8ee4, 0x46b26b, 0xd9a53a, 0x9a6ae0, 0x2fb3c7];
const robots = homes.map(
  (home, i) => new Robot({ id: i + 1, color: ROBOT_COLORS[i % ROBOT_COLORS.length], home, grid, scene })
);

const dispatcher = new Dispatcher({ grid, scene, robots, slots, dropPoints });
// 开场先给几个任务
dispatcher.spawnTask();
dispatcher.spawnTask();
dispatcher.spawnTask();

// ---------- UI ----------
let paused = false;
let simSpeed = 1;

const statDone = document.getElementById('stat-done');
const statActive = document.getElementById('stat-active');
const statQueue = document.getElementById('stat-queue');
const btnPause = document.getElementById('btn-pause');

const robotList = document.getElementById('robot-list');
const robotRows = robots.map((r) => {
  const row = document.createElement('div');
  row.className = 'robot-row';
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = '#' + r.color.toString(16).padStart(6, '0');
  const name = document.createElement('span');
  name.className = 'rname';
  name.textContent = 'R' + r.id;
  const state = document.createElement('span');
  state.className = 'rstate';
  row.append(dot, name, state);
  robotList.appendChild(row);
  return { row, state };
});

function togglePause() {
  paused = !paused;
  btnPause.textContent = paused ? '▶ 继续' : '⏸ 暂停';
}
btnPause.addEventListener('click', togglePause);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
    e.preventDefault();
    togglePause();
  }
});

document.getElementById('btn-task').addEventListener('click', () => {
  for (let i = 0; i < 3; i++) dispatcher.spawnTask();
});

document.getElementById('chk-paths').addEventListener('change', (e) => {
  for (const r of robots) r.showPath = e.target.checked;
});

const speedVal = document.getElementById('speed-val');
document.getElementById('rng-speed').addEventListener('input', (e) => {
  simSpeed = parseFloat(e.target.value);
  speedVal.textContent = simSpeed.toFixed(1) + '×';
});

let uiTimer = 0;
function updateUI(dt) {
  uiTimer -= dt;
  if (uiTimer > 0) return;
  uiTimer = 0.15;
  statDone.textContent = dispatcher.completed;
  statActive.textContent = dispatcher.active.length;
  statQueue.textContent = dispatcher.queue.length;
  robots.forEach((r, i) => {
    const el = robotRows[i].state;
    let text = STATE_LABEL[r.state] || r.state;
    let cls = 'rstate';
    if (r.isWaiting) {
      text += ' · 避让中';
      cls += ' wait';
    } else if (r.state !== 'idle') {
      cls += ' busy';
    }
    el.textContent = text;
    el.className = cls;
  });
}

// ---------- 主循环 ----------
const clock = new THREE.Clock();
function tick() {
  // 预览面板等场景下初始尺寸可能为 0，主循环里自检兜底
  if (lastW !== window.innerWidth || lastH !== window.innerHeight) fitViewport();
  const raw = Math.min(clock.getDelta(), 0.05);
  if (!paused) {
    const dt = raw * simSpeed;
    dispatcher.update(dt);
    for (const r of robots) r.update(dt);
  }
  updateUI(raw);
  controls.update();
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(tick);
// 页面被隐藏时 rAF 会暂停，用定时器兜底让仿真继续
setInterval(() => {
  if (document.hidden) tick();
}, 100);

// 调试钩子
window.__sim = {
  renderer, scene, camera, robots, dispatcher, grid, tick,
  // 快进仿真 n 秒（仅调试用）
  step(seconds) {
    const h = 1 / 30;
    for (let t = 0; t < seconds; t += h) {
      dispatcher.update(h);
      for (const r of robots) r.update(h);
    }
    renderer.render(scene, camera);
  },
};
