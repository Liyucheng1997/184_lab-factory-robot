// 交通热力图：按格统计通行次数 / 等待时长，叠加在地面
import * as THREE from 'three';
import { COLS, ROWS, WORLD_W, WORLD_D } from '../config.js';

const RAMP = [
  [0.0, [20, 40, 120, 0]],
  [0.15, [30, 110, 220, 120]],
  [0.4, [40, 200, 120, 160]],
  [0.65, [250, 220, 60, 190]],
  [1.0, [240, 50, 40, 220]],
];

function ramp(v) {
  for (let i = 1; i < RAMP.length; i++) {
    if (v <= RAMP[i][0]) {
      const [a, ca] = RAMP[i - 1], [b, cb] = RAMP[i];
      const k = (v - a) / (b - a);
      return ca.map((x, j) => x + (cb[j] - x) * k);
    }
  }
  return RAMP[RAMP.length - 1][1];
}

export class Heatmap {
  constructor(scene, grid) {
    this.grid = grid;
    this.mode = 'traffic';
    this.cv = document.createElement('canvas');
    this.cv.width = COLS;
    this.cv.height = ROWS;
    this.ctx = this.cv.getContext('2d');
    this.img = this.ctx.createImageData(COLS, ROWS);
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_W, WORLD_D),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false })
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.03;
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.timer = 0;
  }

  set visible(v) {
    this.mesh.visible = v;
    if (v) this.redraw();
  }

  get visible() {
    return this.mesh.visible;
  }

  redraw() {
    const src = this.mode === 'traffic' ? this.grid.traffic : this.grid.waiting;
    let max = 1e-6;
    for (let i = 0; i < src.length; i++) max = Math.max(max, src[i]);
    const d = this.img.data;
    for (let i = 0; i < src.length; i++) {
      const v = src[i] > 0 ? Math.pow(src[i] / max, 0.55) : 0;
      const [r, g, b, a] = src[i] > 0 ? ramp(v) : [0, 0, 0, 0];
      d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = this.grid.blocked[i] ? 0 : a;
    }
    this.ctx.putImageData(this.img, 0, 0);
    this.tex.needsUpdate = true;
  }

  update(dt) {
    if (!this.mesh.visible) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 1;
      this.redraw();
    }
  }
}
