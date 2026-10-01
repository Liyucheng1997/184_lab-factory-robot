// 共享 PBR 材质与程序化贴图
import * as THREE from 'three';

function canvasTex(w, h, paint, { repeat = null, srgb = true } = {}) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  paint(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

function noise(ctx, w, h, n, a) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    const s = 1 + Math.random() * 2;
    ctx.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
}

export const T = {};

// 压型钢板墙面（竖向波纹）
T.cladding = canvasTex(256, 64, (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, w, 0);
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = i / n;
    g.addColorStop(a, '#c9cfd6');
    g.addColorStop(a + 0.06 / n * 8 * 0.1, '#e4e8ec');
    g.addColorStop(a + 0.5 / n, '#bfc6cd');
    g.addColorStop(a + 0.9 / n, '#d3d8dd');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  noise(ctx, w, h, 400, 0.025);
}, { repeat: [1, 1] });

// 黄黑警示斑马纹
T.hazard = canvasTex(128, 128, (ctx, w, h) => {
  ctx.fillStyle = '#f2c230';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1c1c1c';
  for (let i = -2; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 64, 0);
    ctx.lineTo(i * 64 + 32, 0);
    ctx.lineTo(i * 64 + 32 + 128, 128);
    ctx.lineTo(i * 64 + 128, 128);
    ctx.fill();
  }
}, { repeat: [1, 1] });

// 安全围栏钢丝网（alpha）
T.mesh = canvasTex(128, 128, (ctx, w, h) => {
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 8; i++) {
    ctx.beginPath(); ctx.moveTo(i * 16, 0); ctx.lineTo(i * 16, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * 16); ctx.lineTo(w, i * 16); ctx.stroke();
  }
}, { repeat: [1, 1], srgb: false });

// 辊筒条纹（滚动 offset 即可表现转动）
export function makeRollerTexture() {
  return canvasTex(64, 8, (ctx, w, h) => {
    ctx.fillStyle = '#b9bfc6';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = '#8b9299';
      ctx.fillRect(i * 16, 0, 5, h);
      ctx.fillStyle = '#e1e5e9';
      ctx.fillRect(i * 16 + 8, 0, 3, h);
    }
  }, { repeat: [1, 1] });
}

// 沥青路面
T.asphalt = canvasTex(256, 256, (ctx, w, h) => {
  ctx.fillStyle = '#3b3e42';
  ctx.fillRect(0, 0, w, h);
  noise(ctx, w, h, 5000, 0.06);
}, { repeat: [30, 30] });

// 拉伸缠绕膜的高光条纹
T.wrap = canvasTex(64, 128, (ctx, w, h) => {
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.35})`;
    ctx.fillRect(0, Math.random() * h, w, 1 + Math.random() * 3);
  }
}, { repeat: [1, 1] });

// 纸箱
T.carton = canvasTex(128, 128, (ctx, w, h) => {
  ctx.fillStyle = '#b98a55';
  ctx.fillRect(0, 0, w, h);
  noise(ctx, w, h, 600, 0.04);
  ctx.fillStyle = '#c9a77a';
  ctx.fillRect(0, h * 0.45, w, h * 0.1); // 封箱胶带
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(w * 0.12, h * 0.68, w * 0.4, h * 0.2); // 物流标签
  ctx.fillStyle = '#222';
  for (let i = 0; i < 12; i++) ctx.fillRect(w * 0.15 + i * 3.6, h * 0.71, 1.5 + (i % 3), h * 0.1);
});

export const M = {
  concrete: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.9 }),
  cladding: new THREE.MeshStandardMaterial({ map: T.cladding, roughness: 0.6, metalness: 0.35, side: THREE.DoubleSide }),
  plinth: new THREE.MeshStandardMaterial({ color: 0x8b9096, roughness: 0.95 }),
  steelGrey: new THREE.MeshStandardMaterial({ color: 0x5d6670, roughness: 0.45, metalness: 0.7 }),
  steelDark: new THREE.MeshStandardMaterial({ color: 0x2f3439, roughness: 0.5, metalness: 0.6 }),
  galv: new THREE.MeshStandardMaterial({ color: 0xb8bfc6, roughness: 0.35, metalness: 0.85 }),
  structBlue: new THREE.MeshStandardMaterial({ color: 0x35506b, roughness: 0.55, metalness: 0.45 }),
  rackBlue: new THREE.MeshStandardMaterial({ color: 0x1f5fae, roughness: 0.45, metalness: 0.35 }),
  rackOrange: new THREE.MeshStandardMaterial({ color: 0xf07a1a, roughness: 0.45, metalness: 0.3 }),
  wireDeck: new THREE.MeshStandardMaterial({
    color: 0x9ea6ae, roughness: 0.5, metalness: 0.7, alphaMap: T.mesh, transparent: false, alphaTest: 0.5,
    side: THREE.DoubleSide,
  }),
  safetyYellow: new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5, metalness: 0.2 }),
  hazard: new THREE.MeshStandardMaterial({ map: T.hazard, roughness: 0.6 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 0.9 }),
  plasticBlack: new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.6 }),
  paintWhite: new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.42, metalness: 0.1 }),
  paintGrey: new THREE.MeshStandardMaterial({ color: 0x8d949b, roughness: 0.5, metalness: 0.2 }),
  craneOrange: new THREE.MeshStandardMaterial({ color: 0xf28a1e, roughness: 0.45, metalness: 0.3 }),
  robotOrange: new THREE.MeshStandardMaterial({ color: 0xf39a1c, roughness: 0.38, metalness: 0.15 }),
  fenceMesh: new THREE.MeshStandardMaterial({
    color: 0x3a4047, roughness: 0.6, metalness: 0.5, alphaMap: T.mesh, alphaTest: 0.5, side: THREE.DoubleSide,
  }),
  glass: new THREE.MeshPhysicalMaterial({
    color: 0xbfd8e8, roughness: 0.05, metalness: 0, transmission: 0, transparent: true, opacity: 0.22,
    side: THREE.DoubleSide, depthWrite: false,
  }),
  glassTint: new THREE.MeshStandardMaterial({
    color: 0x3c5a72, roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.55,
  }),
  lamp: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e5, emissiveIntensity: 2.2 }),
  copper: new THREE.MeshStandardMaterial({ color: 0xc87533, roughness: 0.3, metalness: 0.9 }),
  red: new THREE.MeshStandardMaterial({ color: 0xd32f2f, roughness: 0.4 }),
  green: new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.5 }),
  asphalt: new THREE.MeshStandardMaterial({ map: T.asphalt, roughness: 0.95 }),
  palletBlue: new THREE.MeshStandardMaterial({ color: 0x24548f, roughness: 0.65 }),
  fixture: new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.5, metalness: 0.6 }),
  rawPart: new THREE.MeshStandardMaterial({ color: 0x6f747a, roughness: 0.75, metalness: 0.55 }),
  donePart: new THREE.MeshStandardMaterial({ color: 0xd5dde4, roughness: 0.18, metalness: 1.0 }),
  doneAnod: new THREE.MeshStandardMaterial({ color: 0x2f7fd8, roughness: 0.3, metalness: 0.7 }),
  carton: new THREE.MeshStandardMaterial({ map: T.carton, roughness: 0.85 }),
  wrap: new THREE.MeshStandardMaterial({
    map: T.wrap, transparent: true, opacity: 0.55, roughness: 0.15, metalness: 0, depthWrite: false,
  }),
  truckWhite: new THREE.MeshStandardMaterial({ color: 0xf1f3f4, roughness: 0.4, metalness: 0.2 }),
  trailerSide: new THREE.MeshStandardMaterial({ color: 0xdfe3e6, roughness: 0.5, metalness: 0.3 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 }),
  dockFoam: new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.95 }),
};

// 发光指示灯材质（每个实例独立，便于单独改色）
export function lightMat(color = 0x39d353, intensity = 1.6) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
}

// 文本贴图（标牌、编号）
export function textTexture(lines, {
  w = 256, h = 128, bg = '#1d2733', fg = '#ffffff', font = 'bold 54px "Segoe UI", "Microsoft YaHei", sans-serif',
  border = null, align = 'center',
} = {}) {
  return canvasTex(w, h, (ctx) => {
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
    }
    if (border) {
      ctx.strokeStyle = border;
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, w - 8, h - 8);
    }
    ctx.fillStyle = fg;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    const arr = Array.isArray(lines) ? lines : [lines];
    arr.forEach((ln, i) => {
      const f = typeof ln === 'object' ? ln.font : font;
      const t = typeof ln === 'object' ? ln.text : ln;
      ctx.font = f;
      if (typeof ln === 'object' && ln.color) ctx.fillStyle = ln.color;
      else ctx.fillStyle = fg;
      ctx.fillText(t, align === 'center' ? w / 2 : 16, (h / (arr.length + 1)) * (i + 1));
    });
  });
}

export function signMesh(lines, width, height, opts) {
  const tex = textTexture(lines, opts);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 })
  );
  return m;
}

// UV 按世界尺寸平铺的平面（钢丝网等细密纹理）
export function tiledPlane(w, h, tile = 0.4) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / tile), uv.getY(i) * (h / tile));
  return g;
}

export { canvasTex };
