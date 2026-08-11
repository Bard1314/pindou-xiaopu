/* app.js — 拼豆图稿生成器：状态机、事件绑定、计算调度、渲染、导出 */
(function () {
  'use strict';

  /* 页面状态：idle(上传引导) / ready(图纸预览) / exporting(导出模态) */
  const STATE = document.body ? (document.body.dataset.pageState || 'idle') : 'idle';
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  const App = {
    state: STATE,
    sourceImage: null,      // HTMLImageElement
    sourceName: '示例图片',
    result: null,           // { codes, width, height, bg, usedPalette }
    stats: null,
    paletteByCode: new Map(),
    currentPalette: [],     // 当前使用的候选色卡条目数组
    editing: { mode: 'paint', color: null, undoStack: [] },
    highlightSet: null,
    worker: null,
    processingToken: 0,
    params: {
      paletteKey: 'mard30',
      presetWidth: '29',
      customWidth: 29,
      colorCount: 0,
      dither: false,
      removeBackground: false,
      brightness: 0, contrast: 0, saturation: 0,
      ciede: true,
      showGrid: true,
      showLabels: false,
      minArea: 2
    }
  };

  /* ---------- 初始化 ---------- */
  function buildPaletteMap() {
    App.paletteByCode = new Map();
    for (const entry of window.BEAD_PALETTE.full) App.paletteByCode.set(entry.code, entry);
  }

  function getPaletteByKey(key) {
    if (key === 'all') return window.BEAD_PALETTE.full;
    const codes = window.BEAD_PALETTE.subsets[key] || window.BEAD_PALETTE.subsets.mard30;
    const arr = [];
    for (const code of codes) arr.push(App.paletteByCode.get(code));
    return arr;
  }

  function init() {
    buildPaletteMap();
    App.currentPalette = getPaletteByKey(App.params.paletteKey);
    bindCommon();
    if (STATE === 'idle') initIdle();
    else initResult();
  }

  /* ---------- 通用绑定：跨页导航按钮 ---------- */
  function bindCommon() {
    $$('[data-href]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (el.tagName === 'A') return; // 锚点默认行为
        e.preventDefault();
        window.location.href = el.dataset.href;
      });
    });
  }

  /* ---------- 初始态（index.html） ---------- */
  function initIdle() {
    const drop = $('#dropzone');
    const fileInput = $('#file-input');
    if (!drop) return;
    bindUpload(drop, fileInput);

    $$('[data-sample]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const src = btn.dataset.sample;
        window.location.href = 'result.html?sample=' + encodeURIComponent(src);
      });
    });
  }

  function bindUpload(drop, fileInput) {
    const dz = drop;
    dz.addEventListener('click', () => fileInput && fileInput.click());
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault(); dz.classList.remove('dragover');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    });
    if (fileInput) fileInput.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) handleFile(f);
    });
  }

  function handleFile(file) {
    if (!/^image\//.test(file.type)) { showToast('请选择图片文件'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      // 跳转到结果页并在会话中携带图片（页面跳转前存入 sessionStorage）
      try {
        sessionStorage.setItem('bead-upload', reader.result);
        sessionStorage.setItem('bead-name', file.name);
      } catch (err) { /* 大图超限时降级为直接处理 */ }
      window.location.href = 'result.html?uploaded=1';
    };
    reader.readAsDataURL(file);
  }

  /* ---------- 结果态（result.html / exporting.html） ---------- */
  function initResult() {
    const params = readQuery();
    wireParams();
    const loadSrc = () => {
      return new Promise((resolve) => {
        // 优先用户上传
        let dataUrl = null;
        try { dataUrl = sessionStorage.getItem('bead-upload'); } catch (e) {}
        if (dataUrl) {
          const img = new Image();
          img.onload = () => { App.sourceImage = img; App.sourceName = sessionStorage.getItem('bead-name') || '我的图片'; resolve(); };
          img.src = dataUrl;
        } else {
          const sample = params.sample || 'sample-strawberry.svg';
          const img = new Image();
          img.onload = () => { App.sourceImage = img; App.sourceName = sample.indexOf('panda') >= 0 ? '示例·熊猫' : '示例·草莓'; resolve(); };
          img.src = '../assets/' + sample;
        }
      });
    };
    loadSrc().then(() => {
      if (STATE === 'exporting') {
        renderAndExport();
      } else {
        scheduleProcess();
      }
    });
    // 色板/参数控件也允许切换后重算
    bindResultControls();
  }

  function readQuery() {
    const q = new URLSearchParams(window.location.search);
    return { sample: q.get('sample'), uploaded: q.get('uploaded') === '1' };
  }

  /* ---------- 参数面板 ---------- */
  function wireParams() {
    const p = App.params;
    bindVal('#param-palette', 'paletteKey', (v) => { p.paletteKey = v; App.currentPalette = getPaletteByKey(v); });
    bindSeg('#param-preset', 'presetWidth', (v) => { p.presetWidth = v; });
    bindVal('#param-width', 'customWidth', (v) => { p.customWidth = clampInt(v, 8, 200); });
    bindVal('#param-colors', 'colorCount', (v) => { p.colorCount = parseInt(v, 10) || 0; });
    bindSwitch('#param-dither', 'dither', (v) => { p.dither = v; });
    bindSwitch('#param-bg', 'removeBackground', (v) => { p.removeBackground = v; });
    bindVal('#param-brightness', 'brightness', (v) => { p.brightness = parseFloat(v); });
    bindVal('#param-contrast', 'contrast', (v) => { p.contrast = parseFloat(v); });
    bindVal('#param-saturation', 'saturation', (v) => { p.saturation = parseFloat(v); });
    bindSeg('#param-ciede', 'ciede', (v) => { p.ciede = v === 'true'; });
    bindSwitch('#param-grid', 'showGrid', (v) => { p.showGrid = v; rerenderPattern(); });
    bindSwitch('#param-labels', 'showLabels', (v) => { p.showLabels = v; rerenderPattern(); });
  }

  function bindSwitch(sel, key, onChange) {
    const el = $(sel);
    if (!el) return;
    const apply = () => {
      const next = el.getAttribute('aria-checked') !== 'true';
      el.setAttribute('aria-checked', String(next));
      onChange(next);
    };
    el.addEventListener('click', () => {
      apply();
      scheduleProcess();
    });
  }

  function bindSeg(sel, key, onChange) {
    const group = $(sel);
    if (!group) return;
    $$('button', group).forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('button', group).forEach((b) => b.classList.toggle('active', b === btn));
        onChange(btn.dataset.value);
        scheduleProcess();
      });
    });
  }

  function bindVal(sel, key, onChange) {
    const el = $(sel);
    if (!el) return;
    const apply = () => {
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.type === 'range' || el.type === 'number') v = el.value;
      else v = el.value;
      onChange(v);
    };
    el.addEventListener('change', () => {
      apply();
      if (el.dataset.live) scheduleProcess(); else scheduleProcess();
    });
    if (el.type === 'range') {
      const out = $('#val-' + key);
      const updateOut = () => { if (out) out.textContent = formatRange(el.value); };
      el.addEventListener('input', () => {
        out && (out.textContent = formatRange(el.value));
        // 实时预览拖拽（仅亮度/对比/饱和）
        App.params[key] = parseFloat(el.value);
        scheduleProcess();
      });
      updateOut();
    }
  }

  function formatRange(v) {
    const n = parseFloat(v);
    return (n > 0 ? '+' : '') + n.toFixed(1);
  }

  function clampInt(v, min, max) {
    const n = parseInt(v, 10);
    if (isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function bindResultControls() {
    const exp = $('#btn-export-pdf');
    if (exp) exp.addEventListener('click', (e) => {
      e.preventDefault();
      if (!App.result) { showToast('请先完成图稿生成'); return; }
      window.location.href = 'exporting.html';
    });
    const reset = $('#btn-reset');
    if (reset) reset.addEventListener('click', (e) => {
      e.preventDefault();
      try { sessionStorage.removeItem('bead-upload'); } catch (err) {}
      window.location.href = 'index.html';
    });
    const expPng = $('#btn-export-png');
    if (expPng) expPng.addEventListener('click', exportPNG);
    const expCsv = $('#btn-export-csv');
    if (expCsv) expCsv.addEventListener('click', exportCSV);
    const undo = $('#btn-undo');
    if (undo) undo.addEventListener('click', undoEdit);
    $$('#preview-canvas').forEach((cv) => {
      cv.addEventListener('click', onCanvasClick);
    });
    // 画笔颜色选择：点击色板中的色块
    $$('#stats-panel [data-pick]').forEach((el) => el.addEventListener('click', () => {
      App.editing.mode = 'paint';
      App.editing.color = el.dataset.pick;
      markActivePick(el.dataset.pick);
      showToast('已选画笔颜色 ' + el.dataset.pick);
    }));
  }

  /* ---------- 计算调度：Worker 优先，主线程兜底 ---------- */
  function scheduleProcess() {
    if (!App.sourceImage) return;
    const token = ++App.processingToken;
    setBusy(true);
    setTimeout(() => {
      if (token !== App.processingToken) return;
      if (App.worker) {
        postToWorker(token);
      } else if (typeof Worker !== 'undefined') {
        try {
          App.worker = new Worker('../js/worker.js');
          App.worker.onmessage = (e) => onWorkerDone(e.data, token);
          App.worker.onerror = () => { App.worker = null; runSync(token); };
          postToWorker(token);
        } catch (err) { runSync(token); }
      } else {
        runSync(token);
      }
    }, 160);
  }

  function postToWorker(token) {
    const imgData = imageToData();
    App.worker.postMessage({ jobId: token, imageData: imgData, params: buildParams(), palette: App.currentPalette });
  }

  function onWorkerDone(msg, token) {
    if (!msg.ok) { setBusy(false); showToast('计算失败：' + msg.error); return; }
    if (msg.jobId !== App.processingToken) return;
    App.result = msg.result;
    setBusy(false);
    renderResult();
  }

  function runSync(token) {
    const imgData = imageToData();
    setTimeout(() => {
      if (token !== App.processingToken) return;
      try {
        App.result = window.Processor.process(imgData, buildParams(), App.currentPalette);
        setBusy(false);
        renderResult();
      } catch (err) {
        setBusy(false);
        showToast('计算失败：' + String(err && err.message || err));
      }
    }, 20);
  }

  function imageToData() {
    const img = App.sourceImage;
    const maxSide = 1600;
    let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const ratio = Math.min(1, maxSide / Math.max(w, h));
    w = Math.max(1, Math.round(w * ratio)); h = Math.max(1, Math.round(h * ratio));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  function buildParams() {
    const p = App.params;
    const img = App.sourceImage;
    const srcAspect = (img.naturalWidth || 1) / (img.naturalHeight || 1);
    let width = p.presetWidth === 'custom' ? p.customWidth : parseInt(p.presetWidth, 10);
    width = clampInt(width, 8, 200);
    let height = clampInt(Math.round(width / srcAspect), 8, 200);
    // 保持总格数上限，超限时按面积回缩
    while (width * height > 40000) { width--; height = clampInt(Math.round(width / srcAspect), 8, 200); }
    return {
      width, height,
      removeBackground: p.removeBackground,
      bgThreshold: 16,
      brightness: p.brightness, contrast: p.contrast, saturation: p.saturation,
      colorCount: parseInt(p.colorCount, 10) || 0,
      dither: p.dither,
      ciede: p.ciede,
      cleanNoise: true,
      minArea: p.minArea
    };
  }

  /* ---------- 渲染结果 ---------- */
  function renderResult() {
    if (!App.result) return;
    renderPattern();
    renderStats();
    renderMeta();
    updatePickSwatches();
  }

  function renderPattern() {
    const cv = $('#preview-canvas');
    if (!cv) return;
    const p = App.params;
    const cell = pickCellSize(App.result.width, App.result.height);
    window.Render.drawPattern(cv, App.result, {
      cell,
      showGrid: p.showGrid,
      showLabels: p.showLabels,
      highlight: App.highlightSet
    });
  }

  function rerenderPattern() { if (App.result) renderPattern(); }

  function pickCellSize(w, h) {
    const host = $('#pattern-holder');
    if (!host) return 16;
    const maxW = Math.max(200, host.clientWidth - 48);
    const maxH = Math.max(200, (host.clientHeight || 480) - 48);
    return Math.max(6, Math.min(32, Math.floor(Math.min(maxW / w, maxH / h))));
  }

  function renderStats() {
    App.stats = window.Stats.compute(App.result.codes, App.paletteByCode);
    const box = $('#stats-panel');
    if (!box) return;
    const s = App.stats;
    box.innerHTML = '';
    // 汇总
    const sum = document.createElement('div');
    sum.className = 'stats-summary';
    sum.innerHTML =
      '<div class="stat-item"><span class="stat-num">' + App.result.width + '×' + App.result.height + '</span><span class="stat-label">图纸尺寸</span></div>' +
      '<div class="stat-item"><span class="stat-num">' + s.total + '</span><span class="stat-label">豆粒总数</span></div>' +
      '<div class="stat-item"><span class="stat-num">' + s.distinct + '</span><span class="stat-label">所需色号</span></div>' +
      '<div class="stat-item"><span class="stat-num">' + s.boardCount + '</span><span class="stat-label">29×29 板</span></div>';
    box.appendChild(sum);
    const list = document.createElement('div');
    list.className = 'stats-list';
    s.rows.forEach((row, i) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'stat-row' + (App.highlightSet && App.highlightSet.has(row.code) ? ' active' : '');
      item.dataset.pick = row.code;
      item.innerHTML =
        '<span class="swatch" style="background:' + row.hex + '"></span>' +
        '<span class="code">' + row.code + '</span>' +
        '<span class="name">' + row.name + '</span>' +
        '<span class="count">' + row.count + '</span>' +
        '<span class="pct">' + row.pct.toFixed(1) + '%</span>';
      item.addEventListener('click', () => {
        App.editing.mode = 'paint';
        App.editing.color = row.code;
        markActivePick(row.code);
        showToast('已选择 ' + row.code + ' ' + row.name + '，点击图纸格可填色');
      });
      list.appendChild(item);
    });
    box.appendChild(list);
  }

  function updatePickSwatches() {
    const box = $('#palette-pick');
    if (!box) return;
    box.innerHTML = '';
    for (const entry of App.currentPalette) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick-swatch' + (App.editing.color === entry.code ? ' active' : '');
      b.title = entry.code + ' ' + entry.name;
      b.style.background = entry.hex;
      b.dataset.pick = entry.code;
      b.addEventListener('click', () => {
        App.editing.mode = 'paint';
        App.editing.color = entry.code;
        markActivePick(entry.code);
        showToast('已选择画笔颜色 ' + entry.code);
      });
      box.appendChild(b);
    }
  }

  function markActivePick(code) {
    $$('.pick-swatch').forEach((el) => el.classList.toggle('active', el.dataset.pick === code));
  }

  function renderMeta() {
    const el = $('#pattern-meta');
    if (el) {
      el.textContent = App.sourceName + ' · ' + App.result.width + '×' + App.result.height + ' 格 · 色板 ' + paletteLabel(App.params.paletteKey);
    }
    const el2 = $('#source-thumb');
    if (el2 && App.sourceImage) el2.src = App.sourceImage.src;
  }

  function paletteLabel(key) {
    return { mard30: 'MARD 30色', mard72: 'MARD 72色', all: 'MARD 全 291 色' }[key] || key;
  }

  /* ---------- 手动编辑 ---------- */
  function onCanvasClick(e) {
    const cv = $('#preview-canvas');
    if (!cv || !App.result) return;
    const cell = Math.round(cv.width / App.result.width);
    if (cell < 6) { showToast('网格太小，请放大后再编辑'); return; }
    const rect = cv.getBoundingClientRect();
    const scaleX = cv.width / rect.width, scaleY = cv.height / rect.height;
    const x = Math.floor((e.clientX - rect.left) * scaleX / cell);
    const y = Math.floor((e.clientY - rect.top) * scaleY / cell);
    if (x < 0 || y < 0 || x >= App.result.width || y >= App.result.height) return;
    const idx = y * App.result.width + x;
    const before = App.result.codes[idx];
    let after;
    if (App.editing.mode === 'erase') after = null;
    else after = App.editing.color || App.result.codes[idx];
    if (before === after) return;
    App.result.codes[idx] = after;
    App.editing.undoStack.push({ idx, before, after });
    if (App.editing.undoStack.length > 100) App.editing.undoStack.shift();
    renderPattern();
    renderStats();
  }

  function undoEdit() {
    if (!App.editing.undoStack.length) { showToast('没有可撤销的操作'); return; }
    const op = App.editing.undoStack.pop();
    App.result.codes[op.idx] = op.before;
    renderPattern();
    renderStats();
  }

  /* ---------- 导出 ---------- */
  function exportPNG() {
    if (!App.result) return;
    const cv = document.createElement('canvas');
    const cell = 32;
    window.Render.drawPattern(cv, App.result, { cell, showGrid: App.params.showGrid, showLabels: App.params.showLabels });
    const a = document.createElement('a');
    a.download = '拼豆图纸.png';
    a.href = cv.toDataURL('image/png');
    a.click();
  }

  function exportCSV() {
    if (!App.result) return;
    const r = App.result;
    const pm = new Map();
    for (const e of r.usedPalette) pm.set(e.code, e);
    const lines = ['x,y,色号,色名,HEX'];
    for (let y = 0; y < r.height; y++) {
      for (let x = 0; x < r.width; x++) {
        const code = r.codes[y * r.width + x];
        const e = pm.get(code);
        lines.push([x, y, code || '', e ? e.name : '', e ? e.hex : ''].join(','));
      }
    }
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.download = '拼豆坐标.csv';
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /* exporting.html：真实导出 + 进度 */
  function renderAndExport() {
    // 先生成结果（同步快速路径），再导出 PDF
    setBusy(true);
    setTimeout(() => {
      try {
        App.result = window.Processor.process(imageToData(), buildParams(), App.currentPalette);
        renderResult();
        setBusy(false);
        runPDFExport();
      } catch (err) {
        setBusy(false);
        showToast('计算失败：' + String(err && err.message || err));
      }
    }, 30);
  }

  function runPDFExport() {
    const modal = $('#export-modal');
    const bar = $('#export-bar');
    const label = $('#export-label');
    const doneBox = $('#export-done');
    const closeBtn = $('#export-close');
    if (!window.PDFExporter || !(window.jspdf || window.jsPDF)) {
      if (label) label.textContent = 'PDF 库未加载，请检查网络后重试';
      return;
    }
    if (bar) bar.style.width = '4%';
    const opts = {
      patternName: App.sourceName,
      brandLabel: paletteLabel(App.params.paletteKey),
      dateStr: new Date().toLocaleDateString('zh-CN'),
      fileName: '拼豆图纸_' + (App.sourceName || '图稿').replace(/[\\/:*?"<>|]/g, ''),
      onProgress: (cur, total, kind) => {
        if (bar) bar.style.width = Math.round((cur / total) * 100) + '%';
        if (label) label.textContent = '正在排版 ' + kind + '（' + cur + '/' + total + '）';
      }
    };
    // 让进度条有机会先渲染
    setTimeout(() => {
      const res = window.PDFExporter.exportPDF(App.result, App.stats, opts);
      if (res.ok) {
        if (bar) bar.style.width = '100%';
        if (label) label.textContent = 'PDF 图纸已生成，共 ' + res.pages + ' 页';
        if (doneBox) doneBox.classList.remove('hidden');
      } else {
        if (label) label.textContent = res.error;
      }
    }, 60);
    if (closeBtn) closeBtn.addEventListener('click', (e) => { e.preventDefault(); window.location.href = 'result.html'; });
  }

  /* ---------- 工具 ---------- */
  function setBusy(on) {
    const bar = $('#progress-bar');
    if (bar) bar.style.opacity = on ? '1' : '0';
  }

  let toastTimer = null;
  function showToast(msg) {
    let t = $('#toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
