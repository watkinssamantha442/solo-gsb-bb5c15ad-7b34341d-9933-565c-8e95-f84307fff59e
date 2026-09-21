/*
 * fold.js —— 折页阅读顺序模拟核心引擎
 *
 * 网格坐标：x 向右（列），y 向下（行），z 为层面（越大越靠上）。
 * 每个面片保存：
 *   id      面片唯一编号（按行列序）
 *   x, y    当前占据的整数格坐标
 *   front   正面页码标注（可能为 "" 空串）
 *   back    反面页码标注
 *   ux,uy   面片局部 x 轴（右方向）在世界平面中的单位向量
 *   vx,vy   面片局部 y 轴（下方向）在世界平面中的单位向量
 *   n       正面朝向：+1 正面朝上，-1 反面朝上
 *
 * 关键不变量：ux,uy,vx,vy,n 构成右手系 det = n。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Fold = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function createScheme(rows, cols, labels) {
    rows = Math.max(1, rows | 0);
    cols = Math.max(1, cols | 0);
    const scheme = {
      version: 1,
      rows,
      cols,
      // labels 为 [ { front, back }, ... ]，按行优先 y*cols+x
      labels: [],
      steps: [] // { dir: 'L'|'R'|'U'|'D', axis: 数值 }
    };
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const l = (labels && labels[y * cols + x]) || {};
        scheme.labels.push({
          front: l.front != null ? String(l.front) : '',
          back: l.back != null ? String(l.back) : ''
        });
      }
    }
    return scheme;
  }

  function initialState(scheme) {
    const cells = new Map();
    scheme.labels.forEach((l, i) => {
      const x = i % scheme.cols;
      const y = (i / scheme.cols) | 0;
      cells.set(key(x, y), [{
        id: i,
        x, y,
        front: l.front,
        back: l.back,
        ux: 1, uy: 0,
        vx: 0, vy: 1,
        n: 1
      }]);
    });
    return { stepIndex: 0, cells, lastRejection: null };
  }

  function key(x, y) { return x + ',' + y; }

  function mirrorX(x, y, axis) { return { x: 2 * axis - x, y }; }
  function mirrorY(x, y, axis) { return { x, y: 2 * axis - y }; }

  const DIR_INFO = {
    L: { orientation: 'V', axisAt: pos => pos.x, mirror: mirrorX },
    R: { orientation: 'V', axisAt: pos => pos.x, mirror: mirrorX },
    U: { orientation: 'H', axisAt: pos => pos.y, mirror: mirrorY },
    D: { orientation: 'H', axisAt: pos => pos.y, mirror: mirrorY }
  };

  /*
   * 校验并执行一次折叠，返回新的 state（不可变语义，state.cells 为新 Map）。
   * 不合法时返回 { ok:false, code, message, conflicts }，不改变原状态。
   *
   * dir:
   *   L 沿竖线向左折（轴线右侧的纸折到左边）
   *   R 沿竖线向右折（轴线左侧的纸折到右边）
   *   U 沿横线向上折（轴线下侧的纸折到上边）
   *   D 沿横线向下折（轴线上侧的纸折到下边）
   * axis: 网格线坐标（竖线为 x 值，横线为 y 值，可以是整数）
   */
  function fold(state, scheme, dir, axis) {
    const rejection = validate(state, dir, axis);
    if (!rejection.ok) return rejection;

    const info = DIR_INFO[dir];
    const flapSide = (dir === 'R' || dir === 'D') ? -1 : +1; // 移动侧相对轴线符号
    const cells = state.cells;
    const next = new Map();

    // 注意：格位的“锚点”是纸堆最底层面板——它是仍锚定在该格坐标上的基纸，
    // 承载穿过该位置的折线；上层为之前折叠落下的纸，随锚点整堆一起移动。
    for (const [k, stack] of cells) {
      const anchor = stack[stack.length - 1];
      const side = Math.sign(info.axisAt(anchor) - axis);
      if (side === flapSide) continue; // 移动侧：落点格中统一重建
      next.set(k, stack);
    }

    for (const [k, flapStack] of cells) {
      const anchor = flapStack[flapStack.length - 1];
      const side = Math.sign(info.axisAt(anchor) - axis);
      if (side !== flapSide) continue;
      const m = info.mirror(anchor.x, anchor.y, axis);
      const base = next.get(key(m.x, m.y)) || [];
      // 基侧留在桌面上保持在最上；翻片翻转 180° 后穿到基堆下方，
      // 翻片自身层级也因翻面整体反转。
      const moved = flapStack.slice().reverse().map(p => transformPanel(p, dir, axis, m.x, m.y));
      next.set(key(m.x, m.y), moved.concat(base));
    }

    return { ok: true, state: { stepIndex: state.stepIndex + 1, cells: next, lastRejection: null } };
  }

  function transformPanel(p, dir, axis, nx, ny) {
    // 绕世界竖直/水平轴翻转 180°：法向量取反，切向轴在轴向分量反向
    let { ux, uy, vx, vy, n } = p;
    if (dir === 'L' || dir === 'R') {
      ux = -ux; vx = -vx;
    } else {
      uy = -uy; vy = -vy;
    }
    n = -n;
    return { id: p.id, x: nx, y: ny, front: p.front, back: p.back, ux, uy, vx, vy, n };
  }

  function validate(state, dir, axis) {
    const fail = (code, message, conflicts) => ({
      ok: false, code, message, conflicts: conflicts || []
    });
    if (!DIR_INFO[dir]) return fail('BAD_DIR', '折叠方向必须为 L / R / U / D。');
    axis = Number(axis);
    if (!Number.isFinite(axis)) return fail('BAD_AXIS', '折线坐标必须是数字。');

    const info = DIR_INFO[dir];
    const flapSide = (dir === 'R' || dir === 'D') ? -1 : +1;
    const baseSide = -flapSide;
    const cells = state.cells;

    let flap = [], base = [];
    for (const [k, stack] of cells) {
      // 以底层锚点面板的坐标判定该纸堆属于折线哪一侧
      const p = stack[stack.length - 1];
      const d = info.axisAt(p) - axis;
      if (d === 0) {
        return fail('ON_LINE', '折线不能穿过纸格中心，请沿格线折叠。', [{ x: p.x, y: p.y }]);
      }
      if (Math.sign(d) === flapSide) flap.push({ k, stack, p });
      else base.push({ k, stack, p });
    }
    if (!flap.length) return fail('NO_FLAP', dirText(dir) + '一侧没有纸张，折线不在当前外轮廓内。');
    if (!base.length) return fail('NO_BASE', '另一侧没有纸张，折线不在当前外轮廓内。');

    // 翻片镜像落点必须落在基纸上（不悬空）；基侧可以比翻片宽（外侧内折合法）
    const dangling = [];
    const landing = new Map(); // 落点 -> 翻片堆
    for (const it of flap) {
      const m = info.mirror(it.p.x, it.p.y, axis);
      const mk = key(m.x, m.y);
      const baseStack = cells.get(mk);
      if (!baseStack) dangling.push({ x: it.p.x, y: it.p.y });
      else landing.set(mk, { flap: it.stack, base: baseStack, x: m.x, y: m.y });
    }
    if (dangling.length) {
      return fail('OUTLINE', '折线不在当前外轮廓内：翻出的部分超出纸张范围。', dangling);
    }

    // 每个落点两侧厚度（层数）必须一致
    const mismatch = [];
    for (const [, it] of landing) {
      if (it.flap.length !== it.base.length) mismatch.push({ x: it.x, y: it.y });
    }
    if (mismatch.length) {
      return fail('THICKNESS', '折线两侧纸张厚度不一致，无法齐整折叠。', mismatch);
    }

    return { ok: true };
  }

  function dirText(dir) {
    return { L: '左', R: '右', U: '上', D: '下' }[dir] || '';
  }

  /* 从初始状态重放到第 step 步（0 表示未折叠）。返回 { ok,state? ,error? } */
  function replay(scheme, step) {
    let state = initialState(scheme);
    step = step == null ? scheme.steps.length : Math.max(0, Math.min(step | 0, scheme.steps.length));
    for (let i = 0; i < step; i++) {
      const s = scheme.steps[i];
      const r = fold(state, scheme, s.dir, s.axis);
      if (!r.ok) {
        return { ok: false, error: r, failedAt: i, state };
      }
      state = r.state;
    }
    return { ok: true, state };
  }

  /* 当前面片上“朝上可见”的标注及其顺时针旋转角度（弧度） */
  function visibleFace(p) {
    // 朝上可见面的“朝下阅读方向”：正面取局部 v，反面取 -v
    const downX = p.n > 0 ? p.vx : -p.vx;
    const downY = p.n > 0 ? p.vy : -p.vy;
    let angle = Math.atan2(downX, downY); // 与世界向下方向的夹角，顺时针为正
    return {
      label: p.n > 0 ? p.front : p.back,
      side: p.n > 0 ? 'front' : 'back',
      angle
    };
  }

  /* 某一面“印刷朝下方向”的世界向量；face 为该面的外法向符号（+1 朝上 / -1 朝下） */
  function printedDown(p, faceSign) {
    // 正面外法向为 +z，印刷朝下取局部 v；反面外法向为 -z，印刷朝下取 -v
    if (faceSign > 0) return { x: p.vx, y: p.vy, face: 'front', label: p.front };
    return { x: -p.vx, y: -p.vy, face: 'back', label: p.back };
  }

  /*
   * 输出最终从封面（最上层）到封底（最底层背面）的页码序列。
   * 约定：先自上而下读各面片朝上的面（封面起的前 N 页），
   * 再模拟翻页（绕竖直书脊转 180°）自下而上读各面片朝下的面（后 N 页）。
   * 折叠结束通常只剩一个纸堆；若仍有多个纸堆（未折成一叠），按行列顺序
   * 依次读取并给出警告。
   */
  function readingOrder(state) {
    const stacks = [];
    for (const [, stack] of state.cells) stacks.push(stack);
    stacks.sort((a, b) => (a[0].y - b[0].y) || (a[0].x - b[0].x));

    const sequence = [];
    for (const stack of stacks) {
      // 前半：自上而下，朝上可见的面
      for (let i = stack.length - 1; i >= 0; i--) {
        const p = stack[i];
        const d = printedDown(p, p.n);
        sequence.push({ panel: p.id, face: d.face, label: d.label, angle: Math.atan2(d.x, d.y) });
      }
    }
    const panelCount = sequence.length;
    for (let si = stacks.length - 1; si >= 0; si--) {
      const stack = stacks[si];
      // 后半：自下而上，朝下隐藏的面，翻页旋转 180°（关于竖直轴 x -> -x）
      for (let i = 0; i < stack.length; i++) {
        const p = stack[i];
        const d = printedDown(p, -p.n);
        sequence.push({ panel: p.id, face: d.face, label: d.label, angle: Math.atan2(-d.x, d.y) });
      }
    }
    return {
      sequence,
      panelCount,
      faceCount: sequence.length,
      stackCount: stacks.length,
      singleStack: stacks.length === 1
    };
  }

  /* 当前所有可选折线（包围盒内的竖线/横线），附带是否合法及冲突格，用于画布提示 */
  function candidateLines(state, dir) {
    const info = DIR_INFO[dir];
    if (!info) return [];
    const positions = [];
    for (const [, stack] of state.cells) positions.push(stack[0]);
    if (!positions.length) return [];
    const vals = positions.map(p => info.axisAt(p));
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const lines = [];
    // 包围盒内的格线坐标为 列中心 + 0.5（a+0.5 位于 a 与 a+1 之间）
    for (let a = min; a <= max; a++) {
      const axis = a + 0.5;
      const v = validate(state, dir, axis);
      lines.push({ dir, axis, ok: v.ok, code: v.code, conflicts: v.conflicts || [] });
    }
    return lines;
  }

  /* 自动正反标页码：按行优先，正面 1,3,5... 反面 2,4,6...（基础编号，可再手工调整） */
  function autoNumber(rows, cols) {
    const labels = [];
    let n = 1;
    for (let i = 0; i < rows * cols; i++) {
      labels.push({ front: String(n++), back: String(n++) });
    }
    return labels;
  }

  function normalizeScheme(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('方案数据格式不正确。');
    const rows = Math.max(1, raw.rows | 0);
    const cols = Math.max(1, raw.cols | 0);
    const scheme = createScheme(rows, cols, raw.labels || []);
    if (Array.isArray(raw.steps)) {
      scheme.steps = raw.steps
        .filter(s => s && DIR_INFO[s.dir] && Number.isFinite(Number(s.axis)))
        .map(s => ({ dir: s.dir, axis: Number(s.axis) }));
    }
    if (raw.name) scheme.name = String(raw.name);
    return scheme;
  }

  return {
    createScheme,
    initialState,
    fold,
    validate,
    replay,
    visibleFace,
    readingOrder,
    candidateLines,
    autoNumber,
    normalizeScheme,
    dirText,
    key
  };
});
