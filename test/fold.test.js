/* fold.test.js —— 纯 Node 断言测试，不依赖测试框架 */
const assert = require('assert');
const Fold = require('../public/fold.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name); console.error('    ' + e.stack.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; }
}

function labels2x2() {
  // 2 行 2 列，8 页折手（先沿竖线 x=0.5 向左折，再沿横线 y=0.5 向下折）
  //  A(0,0) front=5 back=4   B(1,0) front=3 back=6
  //  C(0,1) front=1 back=8   D(1,1) front=7 back=2
  return [
    { front: '5', back: '4' }, { front: '3', back: '6' },
    { front: '1', back: '8' }, { front: '7', back: '2' }
  ];
}
const STEPS_2X2 = [{ dir: 'L', axis: 0.5 }, { dir: 'D', axis: 0.5 }];

console.log('8 页折手（2×2：左折后下折）');
test('最终应为单纸堆 4 层', () => {
  const s = Fold.createScheme(2, 2, labels2x2());
  s.steps = STEPS_2X2.slice();
  const r = Fold.replay(s);
  assert.ok(r.ok, r.error && r.error.message);
  assert.strictEqual(r.state.cells.size, 1);
  const stack = [...r.state.cells.values()][0];
  assert.strictEqual(stack.length, 4);
});

test('封面到封底序列为 1..8', () => {
  const s = Fold.createScheme(2, 2, labels2x2());
  s.steps = STEPS_2X2.slice();
  const { state } = Fold.replay(s);
  const order = Fold.readingOrder(state);
  assert.deepStrictEqual(order.sequence.map(f => f.label), ['1', '2', '3', '4', '5', '6', '7', '8']);
});

test('页码朝向由几何精确给出（封面正立、正反叶片头脚相对）', () => {
  const s = Fold.createScheme(2, 2, labels2x2());
  s.steps = STEPS_2X2.slice();
  const { state } = Fold.replay(s);
  const { sequence } = Fold.readingOrder(state);
  const isUpright = f => Math.abs(f.angle) < 1e-9;
  const isDown = f => Math.abs(Math.abs(f.angle) - Math.PI) < 1e-9;
  const byLabel = Object.fromEntries(sequence.map(f => [f.label, f]));
  // 两次折叠后的精确朝向：1,4,6,7 正立；2,3,5,8 倒置
  for (const n of ['1', '4', '6', '7']) assert.ok(isUpright(byLabel[n]), `第 ${n} 页应正立`);
  for (const n of ['2', '3', '5', '8']) assert.ok(isDown(byLabel[n]), `第 ${n} 页应倒置`);
});

console.log('层级翻转（1×4 长条风琴折：左折后右折）');
test('层级顺序与正反面翻转正确', () => {
  const labels = [];
  for (let i = 0; i < 4; i++) labels.push({ front: 'F' + i, back: 'B' + i });
  const s = Fold.createScheme(1, 4, labels);
  s.steps = [{ dir: 'L', axis: 1.5 }, { dir: 'R', axis: 0.5 }];
  const { state } = Fold.replay(s);
  assert.strictEqual(state.cells.size, 1);
  const stack = [...state.cells.values()][0];
  assert.strictEqual(stack.length, 4);
  const order = Fold.readingOrder(state);
  assert.deepStrictEqual(order.sequence.map(f => f.label),
    ['F1', 'B2', 'F3', 'B0', 'F0', 'B3', 'F2', 'B1']);
});

console.log('回放任一步');
test('replay(step=1) 得到中间状态', () => {
  const s = Fold.createScheme(2, 2, labels2x2());
  s.steps = STEPS_2X2.slice();
  const r = Fold.replay(s, 1);
  assert.ok(r.ok);
  assert.strictEqual(r.state.cells.size, 2);
  // 第一步后右列应翻到左列下方
  for (const [, stack] of r.state.cells) assert.strictEqual(stack.length, 2);
});

console.log('非法折叠拒绝');
test('折线超出当前外轮廓（翻出悬空）被拒绝并标出冲突格', () => {
  const s = Fold.createScheme(2, 3);
  const { state } = Fold.replay(s, 0);
  const v = Fold.validate(state, 'L', 0.5); // 右侧两列左折，仅列1 能落到列0，列2 悬空
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.code, 'OUTLINE');
  const cells = v.conflicts.map(c => c.x + ',' + c.y).sort();
  assert.deepStrictEqual(cells, ['2,0', '2,1']);
});

test('移动侧无纸被拒绝', () => {
  const s = Fold.createScheme(2, 2);
  const { state } = Fold.replay(s, 0);
  const v = Fold.validate(state, 'R', -0.5); // 左侧无纸
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.code, 'NO_FLAP');
  const v2 = Fold.validate(state, 'L', -0.5); // 右侧有纸、左侧无纸
  assert.strictEqual(v2.ok, false);
  assert.strictEqual(v2.code, 'NO_BASE');
});

test('折线穿过格中心被拒绝', () => {
  const s = Fold.createScheme(2, 2);
  const { state } = Fold.replay(s, 0);
  const v = Fold.validate(state, 'L', 1);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.code, 'ON_LINE');
});

test('厚度不一致被拒绝并标出冲突格（1×3 折后）', () => {
  // 1×3：先沿 x=0.5 右折（列0 折到列1 下方，列2 单层留下）
  const s = Fold.createScheme(1, 3);
  s.steps = [{ dir: 'R', axis: 0.5 }];
  const { state } = Fold.replay(s);
  // 当前 x=1 为两层、x=2 为单层。
  // 沿 x=1.5 左折：x=2 的单层翻到两层堆上，厚度不一致。
  const v = Fold.validate(state, 'L', 1.5);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.code, 'THICKNESS');
  assert.deepStrictEqual(v.conflicts, [{ x: 1, y: 0 }]);
});

test('越过当前外轮廓折叠被拒绝（1×3 折后右侧已无纸）', () => {
  const s = Fold.createScheme(1, 3);
  s.steps = [{ dir: 'R', axis: 0.5 }];
  const { state } = Fold.replay(s);
  // 轴线 x=2.5 位于残留格 x=2 右边缘，向右折时右侧已无纸张
  const v = Fold.validate(state, 'R', 2.5);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.code, 'NO_BASE');
});

test('外侧单页内折（基侧宽于翻片）合法', () => {
  // 1×4 卷心折：右侧两列先向左折（L@2.5），左侧单列再向右包折（R@0.5），
  // 最后剩余的单列向左合拢（L@1.5）成一叠
  const s = Fold.createScheme(1, 4);
  s.steps = [{ dir: 'L', axis: 2.5 }, { dir: 'R', axis: 0.5 }, { dir: 'L', axis: 1.5 }];
  const r = Fold.replay(s);
  assert.ok(r.ok, r.error && r.error.message);
  assert.strictEqual(r.state.cells.size, 1);
  assert.strictEqual([...r.state.cells.values()][0].length, 4);
});

console.log('方案规整化');
test('normalizeScheme 过滤非法步骤并截断标签', () => {
  const s = Fold.normalizeScheme({
    rows: 1, cols: 2,
    labels: [{ front: 1, back: 2 }, { front: 3, back: 4 }],
    steps: [{ dir: 'L', axis: 0.5 }, { dir: 'X', axis: 1 }, { axis: 1 }]
  });
  assert.strictEqual(s.steps.length, 1);
  assert.strictEqual(s.labels[0].front, '1');
});

console.log('候选折线提示');
test('candidateLines 给出包围盒内格线及合法性', () => {
  const s = Fold.createScheme(2, 2);
  const { state } = Fold.replay(s, 0);
  const lines = Fold.candidateLines(state, 'L');
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines.find(l => l.axis === 0.5).ok, true);
  assert.strictEqual(lines.find(l => l.axis === 1.5).ok, false);
});

console.log(`\n${passed} 项通过` + (process.exitCode ? '，存在失败！' : ''));
