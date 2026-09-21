/* server.js —— Express 后端：静态页面 + 方案 JSON 的保存 / 列表 / 读取 / 删除 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
ensureDataDir();

function safeId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

function schemePath(id) {
  return path.join(DATA_DIR, id + '.json');
}

app.get('/api/schemes', (req, res) => {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  const list = files.map(f => {
    const id = f.slice(0, -5);
    let scheme = null;
    try {
      scheme = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
    } catch { /* 忽略损坏文件 */ }
    return {
      id,
      name: scheme && scheme.name ? scheme.name : id,
      rows: scheme && scheme.rows,
      cols: scheme && scheme.cols,
      steps: scheme && Array.isArray(scheme.steps) ? scheme.steps.length : 0,
      updatedAt: fs.statSync(path.join(DATA_DIR, f)).mtime.toISOString()
    };
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  res.json(list);
});

app.get('/api/schemes/:id', (req, res) => {
  if (!safeId(req.params.id)) return res.status(400).json({ error: '非法的方案编号' });
  const file = schemePath(req.params.id);
  if (!fs.existsSync(file)) return res.status(404).json({ error: '方案不存在' });
  res.type('application/json').send(fs.readFileSync(file));
});

app.post('/api/schemes', (req, res) => {
  const scheme = req.body;
  if (!scheme || typeof scheme !== 'object' || !scheme.rows || !scheme.cols) {
    return res.status(400).json({ error: '方案缺少 rows / cols' });
  }
  const id = (req.query.id && safeId(req.query.id) && req.query.id) ||
    crypto.createHash('sha1').update(Date.now() + ':' + Math.random()).digest('hex').slice(0, 12);
  const payload = {
    ...scheme,
    id,
    savedAt: new Date().toISOString()
  };
  fs.writeFileSync(schemePath(id), JSON.stringify(payload, null, 2));
  res.status(201).json({ id });
});

app.delete('/api/schemes/:id', (req, res) => {
  if (!safeId(req.params.id)) return res.status(400).json({ error: '非法的方案编号' });
  const file = schemePath(req.params.id);
  if (!fs.existsSync(file)) return res.status(404).json({ error: '方案不存在' });
  fs.unlinkSync(file);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`折页阅读顺序校样应用已启动： http://localhost:${PORT}`);
});
