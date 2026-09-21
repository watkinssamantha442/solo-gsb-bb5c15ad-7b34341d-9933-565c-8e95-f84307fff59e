/* app.js —— 前端交互：纸格编辑、折叠模拟画布、回放、保存 / 导入 JSON */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');

  const CELL = 110;        // 画布上每格边长（像素）
  const LAYER_DX = 7;      // 层叠错位
  const LAYER_DY = 7;

  // ---------- 全局状态 ----------
  // 默认载入 2×2 / 8 页经典折手标注：向左折再向下折后，阅读顺序恰为 1..8
  const DEFAULT_LABELS = [
    { front: '5', back: '4' }, { front: '3', back: '6' },
    { front: '1', back: '8' }, { front: '7', back: '2' }
  ];
  let scheme = Fold.createScheme(2, 2, DEFAULT_LABELS);
  scheme.name = '示例：8 页折手';
  scheme.steps = [{ dir: 'L', axis: 0.5 }, { dir: 'D', axis: 0.5 }];
  let view = 'fold';           // 'edit' | 'fold'，默认展示已折好的示例
  let currentStep = scheme.steps.length; // 打开即展示最终 1..8，可用回放条回退
  let dir = 'L';               // 当前选择的折叠方向
  let selectedCell = null;     // 编辑器选中格 {x,y}
  let hover = null;            // 画布悬停折线 {orientation, value}
  let rejection = null;        // 最近一次非法折叠（用于红色冲突标记）

  const replay = step => Fold.replay(scheme, step);

  // ---------- 方案编辑 ----------
  function syncSizeInputs() {
    $('inputRows').value = scheme.rows;
    $('inputCols').value = scheme.cols;
  }

  function applySize() {
    const rows = Math.max(1, Math.min(12, parseInt($('inputRows').value, 10) || 1));
    const cols = Math.max(1, Math.min(12, parseInt($('inputCols').value, 10) || 1));
    if (rows === scheme.rows && cols === scheme.cols) return;
    scheme = Fold.createScheme(rows, cols, scheme.labels);
    scheme.name = $('schemeName').value;
    currentStep = 0;
    selectedCell = null;
    rejection = null;
    render();
  }

  function labelAt(x, y) { return scheme.labels[y * scheme.cols + x]; }

  function autoNumber() {
    const labels = Fold.autoNumber(scheme.rows, scheme.cols);
    scheme.labels = labels.map(l => ({ front: l.front, back: l.back }));
    render();
  }

  function clearLabels() {
    scheme.labels = scheme.labels.map(() => ({ front: '', back: '' }));
    render();
  }

  // ---------- 折叠操作 ----------
  function setDir(d) {
    dir = d;
    rejection = null;
    render();
  }

  function tryFold(axis) {
    const { state } = replay(currentStep);
    const v = Fold.validate(state, dir, axis);
    if (!v.ok) {
      rejection = { ...v, dir, axis };
      showMessage('拒绝折叠：' + v.message +
        (v.conflicts.length ? '（冲突纸格 ' + v.conflicts.map(c => `(${c.x + 1},${c.y + 1})`).join('、') + '）' : ''),
        'error');
      render();
      return;
    }
    // 截断回放点之后的步骤后追加
    scheme.steps = scheme.steps.slice(0, currentStep);
    scheme.steps.push({ dir, axis });
    currentStep = scheme.steps.length;
    rejection = null;
    showMessage(`已添加第 ${currentStep} 步：沿格线向${Fold.dirText(dir)}折叠。`, 'ok');
    render();
  }

  function undoStep() {
    if (!scheme.steps.length) return;
    scheme.steps.pop();
    currentStep = Math.min(currentStep, scheme.steps.length);
    rejection = null;
    render();
  }

  function showMessage(text, kind) {
    const el = $('foldMessage');
    el.textContent = text;
    el.className = 'fold-message ' + (kind || '');
  }

  // ---------- 画布几何 ----------
  function footprint(state) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [, stack] of state.cells) {
      const p = stack[stack.length - 1]; // 以锚点位置定外轮廓
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
  }

  function viewTransform(state) {
    if (view === 'edit') {
      const w = scheme.cols * CELL, h = scheme.rows * CELL;
      return { ox: (canvas.width - w) / 2, oy: (canvas.height - h) / 2, cell: CELL };
    }
    const fp = footprint(state);
    const w = (fp.maxX - fp.minX + 1) * CELL;
    const h = (fp.maxY - fp.minY + 1) * CELL;
    return {
      ox: (canvas.width - w) / 2 - fp.minX * CELL,
      oy: (canvas.height - h) / 2 - fp.minY * CELL,
      cell: CELL
    };
  }

  // ---------- 绘制 ----------
  function render() {
    const r = replay(currentStep);
    const state = r.ok ? r.state : r.state || Fold.initialState(scheme);
    const t = viewTransform(state);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (view === 'edit') drawEdit(t);
    else drawFold(state, t);

    updatePanels(state);
  }

  function drawEdit(t) {
    for (let y = 0; y < scheme.rows; y++) {
      for (let x = 0; x < scheme.cols; x++) {
        const px = t.ox + x * t.cell, py = t.oy + y * t.cell;
        const l = labelAt(x, y);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = selectedCell && selectedCell.x === x && selectedCell.y === y ? '#2f6fed' : '#9aa3af';
        ctx.lineWidth = selectedCell && selectedCell.x === x && selectedCell.y === y ? 2.5 : 1.5;
        roundRect(px, py, t.cell, t.cell, 6);
        ctx.fill(); ctx.stroke();

        // 正面（上半，蓝）/ 反面（下半，橙），沿中线分开示意正反面
        ctx.strokeStyle = '#e2e5ea';
        ctx.beginPath(); ctx.moveTo(px, py + t.cell / 2); ctx.lineTo(px + t.cell, py + t.cell / 2); ctx.stroke();
        drawLabelText(l.front || '—', px + t.cell / 2, py + t.cell / 4, t.cell * 0.3, '#2f6fed', 0);
        drawLabelText(l.back || '—', px + t.cell / 2, py + t.cell * 3 / 4, t.cell * 0.3, '#e08a1e', 0);

        // 格坐标小字
        ctx.fillStyle = '#aab1bb';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(`${x + 1},${y + 1}`, px + 5, py + 4);
      }
    }
    $('canvasTip').textContent = '编辑视图：上半部为正面（蓝），下半部为反面（橙）。点击纸格编辑页码。';
  }

  function drawFold(state, t) {
    const stacks = [...state.cells.values()];
    const maxDepth = Math.max(...stacks.map(s => s.length));

    // 冲突纸格先画红底
    if (rejection && rejection.conflicts) {
      for (const c of rejection.conflicts) {
        const px = t.ox + c.x * t.cell, py = t.oy + c.y * t.cell;
        ctx.fillStyle = 'rgba(213,67,67,0.22)';
        roundRect(px - 4, py - 4, t.cell + 8, t.cell + 8, 8);
        ctx.fill();
        ctx.strokeStyle = '#d54343';
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 2;
        roundRect(px - 4, py - 4, t.cell + 8, t.cell + 8, 8);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 自底向上画每个纸堆
    for (const [, stack] of state.cells) {
      const anchor = stack[stack.length - 1];
      for (let depth = 0; depth < stack.length; depth++) {
        const p = stack[depth];
        const off = depth;
        const px = t.ox + anchor.x * t.cell + off * LAYER_DX;
        const py = t.oy + anchor.y * t.cell + off * LAYER_DY;
        const face = Fold.visibleFace(p);
        const isTop = depth === stack.length - 1;
        ctx.fillStyle = face.side === 'front'
          ? (isTop ? '#e7f0fd' : '#dce8fb')
          : (isTop ? '#fdf0dd' : '#f8e3c5');
        ctx.strokeStyle = isTop ? '#1f2733' : '#9aa3af';
        ctx.lineWidth = isTop ? 2 : 1;
        roundRect(px, py, t.cell - 8, t.cell - 8, 6);
        ctx.fill(); ctx.stroke();

        const color = face.side === 'front' ? '#2f6fed' : '#b96a08';
        drawLabelText(face.label || '·', px + (t.cell - 8) / 2, py + (t.cell - 8) / 2,
          t.cell * (isTop ? 0.34 : 0.24), color, face.angle);

        if (!isTop) {
          ctx.fillStyle = '#aab1bb';
          ctx.font = '9px sans-serif';
          ctx.textAlign = 'left'; ctx.textBaseline = 'top';
          ctx.fillText('#' + (p.id + 1), px + 4, py + 3);
        }
      }
      // 厚度徽标
      const px0 = t.ox + anchor.x * t.cell - 6;
      const py0 = t.oy + anchor.y * t.cell - 6;
      badge(px0 + t.cell - 18, py0 + 6, stack.length + ' 层');
    }

    drawFoldLines(state, t);
    $('canvasTip').textContent =
      `折叠视图（${currentStep}/${scheme.steps.length} 步）：蓝面=正面，橙面=反面；点击${dirHint()}方向的格线折叠。`;
  }

  function dirHint() {
    return { L: '竖直（向左折）', R: '竖直（向右折）', U: '水平（向上折）', D: '水平（向下折）' }[dir];
  }

  function drawFoldLines(state, t) {
    const orientation = (dir === 'L' || dir === 'R') ? 'V' : 'H';
    const lines = Fold.candidateLines(state, dir);
    const fp = footprint(state);

    for (const line of lines) {
      const hovered = hover && hover.orientation === orientation && Math.abs(hover.axis - line.axis) < 1e-9;
      const isRejected = rejection && rejection.dir === dir && Math.abs(rejection.axis - line.axis) < 1e-9;
      let color, width;
      if (isRejected || (!line.ok && hovered)) color = '#d54343';
      else if (line.ok) color = hovered ? '#1f7a45' : 'rgba(46,155,87,0.55)';
      else color = 'rgba(213,67,67,0.30)';
      width = hovered ? 4 : 2.5;

      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      if (orientation === 'V') {
        const x = t.ox + line.axis * t.cell;
        ctx.moveTo(x, t.oy + fp.minY * t.cell - 8);
        ctx.lineTo(x, t.oy + (fp.maxY + 1) * t.cell + 8);
      } else {
        const y = t.oy + line.axis * t.cell;
        ctx.moveTo(t.ox + fp.minX * t.cell - 8, y);
        ctx.lineTo(t.ox + (fp.maxX + 1) * t.cell + 8, y);
      }
      ctx.stroke();

      if (hovered) drawFoldArrow(line, t, fp);
    }
  }

  function drawFoldArrow(line, t, fp) {
    const V = line.dir === 'L' || line.dir === 'R';
    ctx.fillStyle = '#1f7a45';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const arrow = { L: '◀', R: '▶', U: '▲', D: '▼' }[line.dir];
    if (V) {
      const x = t.ox + line.axis * t.cell + (line.dir === 'L' ? -26 : 26);
      const y = t.oy + fp.minY * t.cell - 18;
      ctx.fillText(arrow, x, y);
    } else {
      const x = t.ox + (line.dir === 'U' ? fp.minX * t.cell - 14 : (fp.maxX + 1) * t.cell + 14);
      const y = t.oy + line.axis * t.cell;
      ctx.fillText(arrow, x, y);
    }
  }

  function drawLabelText(text, cx, cy, size, color, angle) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.font = `bold ${size}px "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(text), 0, 0);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function badge(x, y, text) {
    ctx.font = 'bold 10px sans-serif';
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = '#1f2733';
    roundRect(x - w / 2, y - 8, w, 16, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 1);
  }

  // ---------- 鼠标交互 ----------
  canvas.addEventListener('mousemove', e => {
    if (view !== 'fold') return;
    const { state } = replay(currentStep);
    const t = viewTransform(state);
    const pos = mousePos(e, t);
    hover = nearestLine(state, pos, t);
    render();
  });

  canvas.addEventListener('mouseleave', () => { hover = null; render(); });

  canvas.addEventListener('click', e => {
    if (view === 'edit') {
      const t = viewTransform(null);
      const { mx, my } = mousePos(e, t);
      const x = Math.floor(mx / t.cell), y = Math.floor(my / t.cell);
      if (x >= 0 && x < scheme.cols && y >= 0 && y < scheme.rows) selectCell(x, y);
      return;
    }
    const { state } = replay(currentStep);
    const t = viewTransform(state);
    const pos = mousePos(e, t);
    const near = nearestLine(state, pos, t);
    if (near) tryFold(near.axis);
  });

  function mousePos(e, t) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width, sy = canvas.height / rect.height;
    return { mx: (e.clientX - rect.left) * sx - t.ox, my: (e.clientY - rect.top) * sy - t.oy };
  }

  function nearestLine(state, pos, t) {
    const orientation = (dir === 'L' || dir === 'R') ? 'V' : 'H';
    const tolerance = 12;
    const fp = footprint(state);
    const lines = Fold.candidateLines(state, dir);

    let best = null;
    for (const line of lines) {
      if (orientation === 'V') {
        const linePx = line.axis * t.cell;
        const inRange = pos.my >= fp.minY * t.cell - 10 && pos.my <= (fp.maxY + 1) * t.cell + 10;
        if (inRange && Math.abs(pos.mx - linePx) <= tolerance &&
          (!best || Math.abs(pos.mx - linePx) < Math.abs(pos.mx - best.axis * t.cell))) {
          best = { orientation, axis: line.axis };
        }
      } else {
        const linePx = line.axis * t.cell;
        const inRange = pos.mx >= fp.minX * t.cell - 10 && pos.mx <= (fp.maxX + 1) * t.cell + 10;
        if (inRange && Math.abs(pos.my - linePx) <= tolerance &&
          (!best || Math.abs(pos.my - linePx) < Math.abs(pos.my - best.axis * t.cell))) {
          best = { orientation, axis: line.axis };
        }
      }
    }
    return best;
  }

  function selectCell(x, y) {
    selectedCell = { x, y };
    const l = labelAt(x, y);
    $('editCellName').textContent = `第 ${y + 1} 行、第 ${x + 1} 列`;
    $('inputFront').value = l.front;
    $('inputBack').value = l.back;
    $('inputFront').focus();
    render();
  }

  $('inputFront').addEventListener('input', e => {
    if (!selectedCell) return;
    labelAt(selectedCell.x, selectedCell.y).front = e.target.value;
    render();
  });
  $('inputBack').addEventListener('input', e => {
    if (!selectedCell) return;
    labelAt(selectedCell.x, selectedCell.y).back = e.target.value;
    render();
  });

  // ---------- 侧栏信息 ----------
  function updatePanels(state) {
    // 步骤列表
    const ol = $('stepList');
    ol.innerHTML = '';
    scheme.steps.forEach((s, i) => {
      const li = document.createElement('li');
      if (i === currentStep - 1) li.className = 'current';
      li.textContent = `第 ${i + 1} 步：沿格线向${Fold.dirText(s.dir)}折（${s.dir === 'L' || s.dir === 'R' ? '竖线' : '横线'} ${s.axis}）`;
      li.addEventListener('click', () => { currentStep = i + 1; rejection = null; render(); });
      ol.appendChild(li);
    });
    $('stepIndicator').textContent = `${currentStep} / ${scheme.steps.length}`;

    // 方向按钮高亮
    document.querySelectorAll('.dir').forEach(b => b.classList.toggle('active', b.dataset.dir === dir));

    // 阅读顺序
    const order = Fold.readingOrder(state);
    const chips = $('orderChips');
    chips.innerHTML = '';
    order.sequence.forEach((f, i) => {
      const span = document.createElement('span');
      span.className = 'chip ' +
        (f.face === 'back' ? 'back-side' : '') +
        (!f.label ? ' empty' : '') +
        (i === 0 ? ' cover' : '');
      span.title = `面片 #${f.panel + 1} · ${f.face === 'front' ? '正面' : '反面'}` +
        (Math.abs(f.angle) > 0.01 ? ` · 旋转 ${Math.round(f.angle * 180 / Math.PI)}°` : '');
      span.textContent = f.label || '空';
      if (i === order.panelCount) {
        const tag = document.createElement('span');
        tag.className = 'turn';
        tag.textContent = '翻页 ↩';
        span.appendChild(tag);
      }
      chips.appendChild(span);
    });
    const meta = $('orderMeta');
    meta.textContent = `共 ${order.panelCount} 个面片 / ${order.faceCount} 个页码面` +
      (order.singleStack ? '，已折成完整一叠。' : '。');
    meta.className = 'order-meta' + (order.singleStack ? '' : ' warn');
    if (!order.singleStack) {
      meta.textContent += ` 当前仍有 ${order.stackCount} 个分离纸堆，继续折叠直至一叠后序列才对应一本完整册子。`;
    }
  }

  // ---------- 视图切换 ----------
  function switchView(v) {
    view = v;
    rejection = null;
    $('tabEdit').classList.toggle('active', v === 'edit');
    $('tabFold').classList.toggle('active', v === 'fold');
    $('viewEdit').classList.toggle('hidden', v !== 'edit');
    $('viewFold').classList.toggle('hidden', v !== 'fold');
    render();
  }
  $('tabEdit').addEventListener('click', () => switchView('edit'));
  $('tabFold').addEventListener('click', () => switchView('fold'));

  // ---------- 按钮 ----------
  $('btnApplySize').addEventListener('click', applySize);
  $('btnAuto').addEventListener('click', autoNumber);
  $('btnClearLabels').addEventListener('click', clearLabels);
  document.querySelectorAll('.dir').forEach(b => b.addEventListener('click', () => setDir(b.dataset.dir)));
  $('btnUndo').addEventListener('click', undoStep);
  $('btnFirst').addEventListener('click', () => { currentStep = 0; rejection = null; render(); });
  $('btnPrev').addEventListener('click', () => { currentStep = Math.max(0, currentStep - 1); rejection = null; render(); });
  $('btnNext').addEventListener('click', () => { currentStep = Math.min(scheme.steps.length, currentStep + 1); rejection = null; render(); });
  $('btnLast').addEventListener('click', () => { currentStep = scheme.steps.length; rejection = null; render(); });

  $('btnNew').addEventListener('click', () => {
    if (!confirm('新建空白方案？当前未保存的内容将丢失。')) return;
    const rows = parseInt($('inputRows').value, 10) || 2;
    const cols = parseInt($('inputCols').value, 10) || 2;
    scheme = Fold.createScheme(rows, cols);
    currentStep = 0; selectedCell = null; rejection = null;
    $('schemeName').value = '';
    syncSizeInputs();
    render();
  });

  // ---------- 保存 / 读取 / 导入 / 导出 ----------
  function collectScheme() {
    return {
      version: 1,
      name: $('schemeName').value || '未命名折页方案',
      rows: scheme.rows,
      cols: scheme.cols,
      labels: scheme.labels,
      steps: scheme.steps
    };
  }

  $('btnExport').addEventListener('click', () => {
    const data = JSON.stringify(collectScheme(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (collectScheme().name || 'fold-scheme') + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('fileImport').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        loadScheme(JSON.parse(reader.result));
      } catch (err) {
        alert('导入失败：' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  function loadScheme(raw) {
    scheme = Fold.normalizeScheme(raw);
    $('schemeName').value = scheme.name || raw.name || '';
    currentStep = scheme.steps.length;
    selectedCell = null;
    rejection = null;
    syncSizeInputs();
    render();
    refreshSchemeList();
  }

  $('btnSave').addEventListener('click', async () => {
    try {
      const resp = await fetch('/api/schemes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collectScheme())
      });
      if (!resp.ok) throw new Error((await resp.json()).error || '保存失败');
      const { id } = await resp.json();
      showMessage(`方案已保存（编号 ${id}），可随时从左下方案列表载入。`, 'ok');
      refreshSchemeList();
    } catch (err) {
      alert(err.message);
    }
  });

  async function refreshSchemeList() {
    const ul = $('schemeList');
    ul.innerHTML = '';
    let list = [];
    try { list = await (await fetch('/api/schemes')).json(); } catch { return; }
    if (!list.length) {
      const li = document.createElement('li');
      li.textContent = '暂无已保存方案';
      li.style.color = '#aab1bb';
      ul.appendChild(li);
      return;
    }
    for (const item of list) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = item.name;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = `${item.rows}×${item.cols} · ${item.steps}步`;
      const btnLoad = document.createElement('button');
      btnLoad.textContent = '载入';
      btnLoad.addEventListener('click', async () => {
        const raw = await (await fetch('/api/schemes/' + item.id)).json();
        loadScheme(raw);
      });
      const btnDel = document.createElement('button');
      btnDel.textContent = '删除';
      btnDel.addEventListener('click', async () => {
        if (!confirm(`删除方案「${item.name}」？`)) return;
        await fetch('/api/schemes/' + item.id, { method: 'DELETE' });
        refreshSchemeList();
      });
      li.append(name, meta, btnLoad, btnDel);
      ul.appendChild(li);
    }
  }

  // ---------- 初始化 ----------
  syncSizeInputs();
  render();
  refreshSchemeList();
})();
