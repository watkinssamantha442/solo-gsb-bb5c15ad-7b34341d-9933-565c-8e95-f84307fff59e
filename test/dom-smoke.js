/* dom-smoke.js —— 最小 DOM/Canvas 桩，在 Node 中驱动真实 app.js 冒烟 */
const fs = require('fs');
const path = require('path');

const noop = () => {};
const ctxStub = new Proxy({}, {
  get(t, prop) {
    if (prop === 'measureText') return () => ({ width: 40 });
    if (prop === 'canvas') return { width: 900, height: 640 };
    return typeof prop === 'string' ? noop : undefined;
  },
  set() { return true; }
});

function makeEl(id) {
  const el = {
    id, value: '', textContent: '', innerHTML: '', className: '', hidden: false,
    style: {}, dataset: {}, width: 900, height: 640,
    files: [],
    listeners: {},
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, on) { on ? this._set.add(c) : this._set.delete(c); },
      contains(c) { return this._set.has(c); }
    },
    appendChild(c) { (this.children = this.children || []).push(c); },
    append(...cs) { cs.forEach(c => this.appendChild(c)); },
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    dispatch(ev, payload) { (this.listeners[ev] || []).forEach(fn => fn(payload || { target: el, preventDefault: noop })); },
    focus: noop, click() { this.dispatch('click'); },
    getContext() { return ctxStub; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 640 }; }
  };
  return el;
}

const IDS = [
  'canvas', 'canvasTip', 'schemeName', 'btnNew', 'btnExport', 'fileImport', 'btnSave',
  'tabEdit', 'tabFold', 'viewEdit', 'viewFold',
  'inputRows', 'inputCols', 'btnApplySize', 'btnAuto', 'btnClearLabels',
  'editCellName', 'inputFront', 'inputBack', 'schemeList',
  'foldMessage', 'stepList', 'btnFirst', 'btnPrev', 'btnNext', 'btnLast', 'btnUndo',
  'stepIndicator', 'orderChips', 'orderMeta'
];
const els = {};
IDS.forEach(id => els[id] = makeEl(id));

// querySelectorAll：返回 4 个方向按钮
const dirBtns = ['U', 'L', 'R', 'D'].map(d => {
  const b = makeEl('dir-' + d);
  b.dataset.dir = d;
  return b;
});

const documentStub = {
  getElementById: id => els[id] || makeEl(id),
  querySelectorAll: sel => sel === '.dir' ? dirBtns : [],
  createElement: tag => makeEl('el-' + Math.random())
};
const URLStub = { createObjectURL: () => 'blob:x', revokeObjectURL: noop };
const BlobStub = function () {};

const sandbox = {
  document: documentStub,
  window: {}, self: {},
  fetch: async (u, opts) => {
    // 记录调用但不真正请求
    sandbox.__fetchCalls.push({ u, opts });
    if (u === '/api/schemes' && (!opts || opts.method !== 'POST')) {
      return { json: async () => [], ok: true };
    }
    if (opts && opts.method === 'POST') return { json: async () => ({ id: 'stub12' }), ok: true };
    return { json: async () => ({}), ok: true };
  },
  Blob: BlobStub,
  URL: URLStub,
  FileReader: function () {
    this.readAsText = noop;
  },
  confirm: () => true,
  alert: msg => { sandbox.__alerts.push(msg); },
  console
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.__fetchCalls = [];
sandbox.__alerts = [];

// 加载 fold.js（UMD 挂到 self）
new Function('module', 'exports', 'self', 'window', 'globalThis',
  fs.readFileSync(path.join(__dirname, '..', 'public', 'fold.js'), 'utf8')
)(undefined, undefined, sandbox, sandbox, sandbox);

// 加载 app.js
const appCode = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
new Function(...Object.keys(sandbox), appCode)(...Object.values(sandbox));

console.log('✓ app.js 初始化无异常，默认方案行数/列数:', els.inputRows.value, els.inputCols.value);
console.log('✓ 初始阅读顺序块数:', (els.orderChips.children || []).length);
if (els.orderChips.textContent) console.log('  order text:', els.orderChips.textContent);

// 模拟切到折叠视图
els.tabFold.dispatch('click');
console.log('✓ 切换到折叠视图');

// 模拟一次非法折叠点击：canvas click 事件内部计算坐标，stub 的 rect 固定，
// 这里主要验证事件处理器不抛异常
els.canvas.dispatch('click', { clientX: 300, clientY: 300, target: els.canvas, preventDefault: noop });
els.canvas.dispatch('mousemove', { clientX: 400, clientY: 300, target: els.canvas, preventDefault: noop });
console.log('✓ canvas 点击/悬停处理器无异常');

// 编辑视图：改尺寸、自动编号、格子点击
els.tabEdit.dispatch('click');
els.inputRows.value = '1';
els.inputCols.value = '4';
els.btnApplySize.dispatch('click');
els.btnAuto.dispatch('click');
console.log('✓ 改尺寸 + 自动编号无异常');

// 回到折叠视图做合法折叠：1×4 默认编号，L@1.5（直接驱动引擎已在单元测试覆盖，
// 这里通过点击方向按钮后触发 canvas click，坐标取中线附近）
els.tabFold.dispatch('click');
dirBtns.find(b => b.dataset.dir === 'L').dispatch('click');
// 1×4 纸格在画布上居中，点击 x=1.5 格线位置（需与真实坐标换算一致，stub 下允许失败但不应抛错）
els.canvas.dispatch('click', { clientX: 450, clientY: 320, target: els.canvas, preventDefault: noop });
console.log('✓ 方向选择 + 折叠点击无异常');

// 回放按钮
els.btnFirst.dispatch('click');
els.btnNext.dispatch('click');
els.btnPrev.dispatch('click');
els.btnLast.dispatch('click');
els.btnUndo.dispatch('click');
console.log('✓ 回放/撤销无异常');

// 保存（fetch 被桩拦截）
els.btnSave.dispatch('click');
setTimeout(() => {
  console.log('✓ 保存按钮无异常，fetch 调用数:', sandbox.__fetchCalls.length);
  console.log('\nDOM 冒烟测试通过');
}, 50);
