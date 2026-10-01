// 全局布局与工艺参数（单位：米 / 秒）
// 网格坐标 (c, r)：c 沿 +x(东)，r 沿 +z(南)；格心世界坐标见 Grid.cellToWorld

export const CELL = 1.25;              // AGV 导航网格间距（二维码地标间距）
export const COLS = 48;
export const ROWS = 30;
export const WORLD_W = COLS * CELL;    // 60 m
export const WORLD_D = ROWS * CELL;    // 37.5 m

export const BUILDING = {
  eaveH: 11.5,       // 檐口高度
  ridgeH: 13.2,      // 屋脊高度
  bay: 6,            // 钢柱跨距（格）
  wallT: 0.25,
};

export const TRANSFER_H = 0.62;        // AMR 辊筒面 / 站台输送线面高度（对接高度）
export const LOAD = { L: 1.0, W: 0.8, PALLET_H: 0.14, PARTS: 4 };

// ---------------- 立体库 AS/RS ----------------
// 4 条巷道，每条巷道两侧单深位货架；巷道南端设入库口(西侧)与出库口(东侧)
export const ASRS = {
  aisles: [16, 19, 22, 25],  // 堆垛机巷道所在列
  bays: 12,                  // 每排货位列数（行 0..11）
  levels: 6,
  level0Y: 0.28,             // 第一层托盘底面高度
  levelPitch: 1.32,
  portRows: [12, 13],        // 站台输送线所占行(12=堆垛机取放位, 13=AMR 交接位)
  dockRow: 14,               // AMR 停靠行
  initialFill: 0.5,
  crane: { vTravel: 2.6, aTravel: 0.9, vLift: 0.9, aLift: 0.8, vFork: 0.7, aFork: 1.2 },
};
ASRS.colMin = ASRS.aisles[0] - 1;
ASRS.colMax = ASRS.aisles[ASRS.aisles.length - 1] + 1;
ASRS.rackH = ASRS.level0Y + ASRS.levels * ASRS.levelPitch + 0.35;

// ---------------- 加工单元 ----------------
// 每个单元：两条双向辊道(列 c0, c0+2) + 中间六轴机器人 + 南侧 CNC 加工中心
export const WORKCELLS = [5, 11, 17, 23, 29, 35];
export const CELL_ROWS = { dock: 20, portRow: 21, procR: 22.75, armR: 23.15, machineR0: 24.15, last: 28 };
export const PROCESS = { machiningTime: 18, partsPerLoad: LOAD.PARTS };

// ---------------- 收发货码头 ----------------
export const DOCK_ROWS = [14, 19, 24];
export const RECV = { portCol: 1, dockCol: 2 };      // 西墙
export const SHIP = { portCol: 46, dockCol: 45 };    // 东墙
export const TRUCK = { capacity: 6, floorH: 1.05, recvGap: [18, 40], shipGap: [10, 25] };

// ---------------- 能源 ----------------
export const CHARGER_COLS = [1, 3, 5, 7, 9, 11, 13];       // 北墙充电桩（行 0 桩体，行 1 停靠）
export const PARKING = [4, 7].flatMap((r) => [2, 4, 6, 8, 10, 12].map((c) => ({ c, r })));

// ---------------- 办公 / 中控室（东北角，阻挡区） ----------------
export const OFFICE = { c0: 33, c1: 47, r0: 0, r1: 9 };

// ---------------- AMR 参数 ----------------
export const FLEET_SIZE = 16;
export const AMR = {
  length: 1.05,
  width: 0.82,
  vEmpty: 1.8,        // 空载最高速 m/s
  vLoaded: 1.3,       // 负载最高速 m/s
  acc: 0.75,          // 加速度 m/s²
  dec: 1.0,           // 常规减速度 m/s²
  rot: 1.7,           // 原地旋转角速度 rad/s
  transferTime: 2.4,  // 辊筒移载时间
  waitReplan: [1.2, 2.4],
};

export const BATTERY = {
  capacityKWh: 2.4,
  idle: 0.006,        // %/s
  move: 0.05,         // 满速行驶 %/s
  loaded: 0.02,       // 负载额外 %/s
  transfer: 0.03,
  chargeCC: 0.85,     // 恒流段充电速率 %/s
  ccLimit: 80,
  chargeCV: 0.22,
  low: 30,            // 完成任务后去充电
  critical: 15,       // 不再接任务
  opportunity: 65,    // 空闲时机会充电阈值
  release: 55,        // 充电中可被抢占接单的最低电量
};

export const COLORS = {
  amrAccent: [0xff6a13, 0x1e88e5, 0x43a047, 0xfdd835, 0x8e24aa, 0x00acc1,
    0xe53935, 0x6d4c41, 0x3949ab, 0x7cb342, 0xf4511e, 0x00897b, 0xd81b60, 0x5e35b1, 0x00bfa5, 0xc0ca33],
};

export const SIM_START_HOUR = 8; // 仿真时钟起点 08:00
