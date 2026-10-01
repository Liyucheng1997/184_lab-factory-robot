// HMI 仪表盘：KPI、产出趋势、车队、加工单元、立体库、月台、任务队列、事件日志、机器人检查器
import { MODE_LABEL } from '../fleet/robot.js';
import { TASK_TYPES } from '../wms/fleetManager.js';
import { TRUCK, ASRS } from '../config.js';

const $ = (id) => document.getElementById(id);
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

const LANE_TXT = {
  empty: ['空', ''], requested: ['叫料', 'req'], conveyIn: ['上料', 'raw'], ready: ['待加工', 'raw'],
  processing: ['加工', 'proc'], conveyOut: ['下料', 'done'], done: ['待取', 'done'],
};
const CELL_TXT = { RUN: '加工中', LOADING: '机器人上下料', TOOL: '自动换刀', WAIT: '待料', IDLE: '就绪' };
const TOWER_COL = { RUN: '#34c759', LOADING: '#34c759', TOOL: '#ffb300', WAIT: '#ffb300', IDLE: '#8b98a7' };
const DOCK_TXT = { waiting: '等待排班', arriving: '车辆进场', unloading: '卸货中', loading: '装车中', leaving: '车辆离场', empty: '空闲' };

export class HUD {
  constructor({ events, fleet, robots, cells, asrs, docks, onSelect }) {
    Object.assign(this, { events, fleet, robots, cells, asrs, docks, onSelect });
    this.selected = null;
    this.buildFleet();
    this.spark = $('spark');
    this.sparkData = [];
    this.sampleT = 0;
    this.logEl = $('log');
    events.onLog((e) => this.appendLog(e));
  }

  buildFleet() {
    const tbody = $('fleet');
    this.rows = this.robots.map((r) => {
      const tr = document.createElement('tr');
      tr.className = 'robot';
      tr.innerHTML = `<td><i class="dot" style="background:${hex(r.color)}"></i></td>
        <td class="rname">${String(r.id).padStart(2, '0')}</td>
        <td class="mode"></td><td class="tid"></td>
        <td class="soc"><div class="socbar"><i></i></div></td><td class="socv"></td>`;
      tr.addEventListener('click', () => this.onSelect(r));
      tbody.appendChild(tr);
      return { tr, mode: tr.children[2], task: tr.children[3], bar: tr.querySelector('.socbar i'), socv: tr.children[5] };
    });
  }

  appendLog(e) {
    if (e.type === 'fms' && !/让行/.test(e.msg)) return; // 指派日志过多，只在任务队列展示
    const div = document.createElement('div');
    div.innerHTML = `<time>${e.clock}</time><span class="${e.level}"></span>`;
    div.lastChild.textContent = e.msg;
    this.logEl.prepend(div);
    while (this.logEl.childElementCount > 120) this.logEl.lastChild.remove();
  }

  update(dt) {
    const ev = this.events;
    const k = this.fleet.kpi();
    $('clock').textContent = ev.clock();
    $('kpi-span').textContent = `仿真 ${(ev.time / 60).toFixed(0)} min`;
    $('k-tph').firstChild.textContent = k.throughput.toFixed(0);
    $('k-ship').firstChild.textContent = k.shipped;
    $('k-parts').firstChild.textContent = k.parts;
    $('k-lead').firstChild.textContent = k.avgLead ? k.avgLead.toFixed(0) : '—';
    $('k-util').firstChild.textContent = (k.utilization * 100).toFixed(0);
    $('b-util').style.width = `${k.utilization * 100}%`;
    $('k-cell').firstChild.textContent = (k.cellUtil * 100).toFixed(0);
    $('b-cell').style.width = `${k.cellUtil * 100}%`;
    $('k-stock').firstChild.textContent = k.stock;
    $('b-stock').style.width = `${k.occupancy * 100}%`;
    $('k-energy').firstChild.textContent = k.energy.toFixed(2);

    // 趋势采样（仿真时间每 30 s）
    if (ev.time - this.sampleT >= 30 || !this.sparkData.length) {
      this.sampleT = ev.time;
      this.sparkData.push(k.throughput);
      if (this.sparkData.length > 120) this.sparkData.shift();
      this.drawSpark();
    }

    // 车队
    let busy = 0, charging = 0;
    this.robots.forEach((r, i) => {
      const row = this.rows[i];
      let cls = 'mode';
      let txt = MODE_LABEL[r.mode] || r.mode;
      if (r.fault > 0) { cls += ' err'; txt = MODE_LABEL.FAULT; }
      else if (r.isWaiting) { cls += ' wait'; txt += '·等待'; }
      else if (r.queued) { cls += ' wait'; txt += '·排队'; }
      else if (r.mode === 'CHARGING') { cls += ' chg'; charging++; }
      else if (r.task) cls += ' busy';
      if (r.task) busy++;
      row.mode.className = cls;
      row.mode.textContent = txt;
      row.task.textContent = r.task ? r.task.id : '';
      const soc = r.soc;
      row.bar.style.width = `calc(${soc}% - 2px)`;
      row.bar.style.background = soc > 30 ? '#3fb950' : soc > 15 ? '#f0b429' : '#f85149';
      row.socv.textContent = soc.toFixed(0) + '%';
      row.tr.classList.toggle('sel', r === this.selected);
    });
    $('fleet-sum').textContent = `作业 ${busy} · 充电 ${charging} · 共 ${this.robots.length}`;

    // 加工单元
    $('cells').innerHTML = this.cells.map((c) => `
      <div class="cellrow">
        <i class="tower" style="background:${TOWER_COL[c.state]};box-shadow:0 0 6px ${TOWER_COL[c.state]}"></i>
        <div><div class="t">${c.code} <span class="s">${CELL_TXT[c.state]}</span></div>
          <div class="s">累计 ${c.parts} 件 · ${c.pallets} 托 · 稼动 ${(c.runTime / Math.max(ev.time, 1) * 100).toFixed(0)}%</div></div>
        <div class="lanes">${c.lanes.map((l, i) => {
          const [t, cl] = LANE_TXT[l.state];
          return `<span class="lane ${cl}">${i ? 'B' : 'A'} ${t}</span>`;
        }).join('')}</div>
      </div>`).join('');

    // 立体库
    const perAisle = ASRS.bays * ASRS.levels * 2;
    $('asrs-sum').textContent = `${this.asrs.occupied}/${this.asrs.capacity} 货位`;
    $('aisles').innerHTML = this.asrs.cranes.map((cr, a) => {
      const used = perAisle - this.asrs.freeSlots(a);
      return `<div class="aisle"><span>巷道 ${a + 1}</span>
        <div class="occ"><i style="width:${(used / perAisle) * 100}%"></i></div>
        <span class="cs">${cr.state}${cr.jobs.length ? ' +' + cr.jobs.length : ''}</span></div>`;
    }).join('');

    // 月台
    const dockRow = (d, ship) => {
      const n = d.truck.loads.length;
      const slots = Array.from({ length: TRUCK.capacity }, (_, i) => `<i class="${i < n ? 'f' : ''}"></i>`).join('');
      return `<div class="dock"><span>${ship ? '发' : '收'}货 ${d.id.slice(-1)}</span>
        <div class="slots ${ship ? 'ship' : ''}">${slots}</div><span class="cs" style="color:var(--muted);font-size:11px;text-align:right">${DOCK_TXT[d.status] || ''}</span></div>`;
    };
    $('docks').innerHTML = this.docks.recv.map((d) => dockRow(d, false)).join('') + this.docks.ship.map((d) => dockRow(d, true)).join('');

    // 任务
    const list = [...this.fleet.active, ...this.fleet.queue].slice(0, 9);
    $('task-sum').textContent = `执行 ${this.fleet.active.length} · 排队 ${this.fleet.queue.length} · 完成 ${ev.get('tasks')}`;
    $('tasks').innerHTML = list.map((t) => {
      const T = TASK_TYPES[t.type];
      return `<div class="task"><span class="tid">${t.id}</span><span class="ttype" style="background:${T.color}">${T.short}</span>
        <span class="troute">${t.from.name} → ${t.to.name}</span><span class="trobot">${t.robot ? t.robot.name.slice(4) : '排队'}</span></div>`;
    }).join('') || '<div style="color:var(--dim)">暂无任务</div>';

    this.updateInspector();
  }

  drawSpark() {
    const cv = this.spark;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w) return;
    const dpr = Math.min(devicePixelRatio, 2);
    cv.width = w * dpr;
    cv.height = h * dpr;
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    const data = this.sparkData;
    const max = Math.max(10, ...data) * 1.15;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(0, (h * i) / 4); ctx.lineTo(w, (h * i) / 4); ctx.stroke();
    }
    if (data.length < 2) return;
    const x = (i) => (i / (data.length - 1)) * (w - 2) + 1;
    const y = (v) => h - 4 - (v / max) * (h - 10);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(54,197,240,0.35)');
    grad.addColorStop(1, 'rgba(54,197,240,0)');
    ctx.beginPath();
    data.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.lineTo(x(data.length - 1), h);
    ctx.lineTo(x(0), h);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    data.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.strokeStyle = '#36c5f0';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.fillStyle = '#8b98a7';
    ctx.font = '10px Consolas, monospace';
    ctx.fillText(`${data[data.length - 1].toFixed(0)} 托/h`, w - 56, 12);
  }

  updateInspector() {
    const el = $('inspector');
    const r = this.selected;
    if (!r) {
      el.classList.remove('show');
      return;
    }
    el.classList.add('show');
    const t = r.task;
    const T = Math.max(this.events.time, 1);
    const status = r.fault > 0 ? '安全停车' : MODE_LABEL[r.mode] + (r.isWaiting ? ' · 等待通行' : '');
    el.innerHTML = `
      <div class="head"><i class="dot" style="background:${hex(r.color)}"></i><b>${r.name}</b>
        <span style="color:var(--muted)">${status}</span><span class="close" id="insp-close">✕</span></div>
      <div class="grid">
        <div><label>速度</label><span>${r.v.toFixed(2)} m/s</span></div>
        <div><label>电量 SOC</label><span>${r.soc.toFixed(1)} %</span></div>
        <div><label>位置 (c,r)</label><span>${r.cell.c},${r.cell.r}</span></div>
        <div><label>里程</label><span>${(r.stats.dist / 1000).toFixed(2)} km</span></div>
        <div><label>完成任务</label><span>${r.stats.tasks}</span></div>
        <div><label>利用率</label><span>${((r.stats.busy / T) * 100).toFixed(0)} %</span></div>
        <div><label>累计等待</label><span>${r.stats.wait.toFixed(0)} s</span></div>
        <div><label>重规划</label><span>${r.stats.replans}</span></div>
        <div><label>能耗</label><span>${r.stats.energy.toFixed(3)} kWh</span></div>
      </div>
      <div class="route">${t ? `任务 <b>${t.id}</b> ${t.label}：<b>${t.from.name}</b> → <b>${t.to.name}</b><br>托盘 <b>${t.load ? t.load.id : '-'}</b> · 剩余路径 ${r.path.length} 格`
        : r.blockedBy ? `等待 ${r.blockedBy.name} 让出通道` : '当前无任务'}</div>`;
    $('insp-close').onclick = () => this.onSelect(null);
  }
}
