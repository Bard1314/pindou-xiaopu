/* render.js — 图纸渲染：网格、坐标、色号标注、逐色高亮 */
(function (global) {
  'use strict';

  const Render = {};

  function paletteMap(usedPalette) {
    const m = new Map();
    for (const entry of usedPalette) m.set(entry.code, entry);
    return m;
  }

  /* opts: { cell, showGrid, showLabels, highlight: Set(codes) | null, labelFont } */
  function drawPattern(canvas, result, opts) {
    const { codes, width: W, height: H } = result;
    const cell = opts.cell || 16;
    const pm = paletteMap(result.usedPalette);
    const pad = opts.pad || 0;
    canvas.width = W * cell + pad * 2;
    canvas.height = H * cell + pad * 2;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 背景
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const highlight = opts.highlight || null;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const code = codes[y * W + x];
        const px = pad + x * cell, py = pad + y * cell;
        if (code == null) {
          // 背景格：浅灰棋盘提示
          ctx.fillStyle = '#F1EDEA';
          ctx.fillRect(px, py, cell, cell);
          continue;
        }
        const entry = pm.get(code);
        ctx.fillStyle = entry ? entry.hex : '#CCCCCC';
        ctx.fillRect(px, py, cell, cell);
        if (highlight && highlight.has(code)) {
          ctx.strokeStyle = '#B4532F';
          ctx.lineWidth = Math.max(2, cell / 8);
          ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
        }
      }
    }
    // 网格线：每 5 格加粗
    if (opts.showGrid !== false) {
      ctx.strokeStyle = 'rgba(58,44,33,0.25)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= W; x++) {
        ctx.beginPath();
        ctx.moveTo(pad + x * cell, pad);
        ctx.lineTo(pad + x * cell, pad + H * cell);
        ctx.stroke();
      }
      for (let y = 0; y <= H; y++) {
        ctx.beginPath();
        ctx.moveTo(pad, pad + y * cell);
        ctx.lineTo(pad + W * cell, pad + y * cell);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(58,44,33,0.55)';
      ctx.lineWidth = 2;
      for (let x = 0; x <= W; x += 5) {
        ctx.beginPath();
        ctx.moveTo(pad + x * cell, pad);
        ctx.lineTo(pad + x * cell, pad + H * cell);
        ctx.stroke();
      }
      for (let y = 0; y <= H; y += 5) {
        ctx.beginPath();
        ctx.moveTo(pad, pad + y * cell);
        ctx.lineTo(pad + W * cell, pad + y * cell);
        ctx.stroke();
      }
      // 坐标数字
      ctx.fillStyle = 'rgba(58,44,33,0.6)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      for (let x = 0; x < W; x += 5) {
        ctx.fillText(String(x), pad + x * cell + cell / 2, pad - 3);
      }
      ctx.textAlign = 'right';
      for (let y = 0; y < H; y += 5) {
        ctx.fillText(String(y), pad - 4, pad + y * cell + cell / 2 + 3);
      }
    }
    // 色号标注
    if (opts.showLabels && cell >= 12) {
      ctx.font = (opts.labelFont || 'bold 11px sans-serif');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const code = codes[y * W + x];
          if (code == null) continue;
          const entry = pm.get(code);
          ctx.fillStyle = luminance(entry ? entry.hex : '#888888') > 0.55 ? '#3A2C21' : '#FFFFFF';
          ctx.fillText(code, pad + x * cell + cell / 2, pad + y * cell + cell / 2 + 0.5);
        }
      }
      ctx.textBaseline = 'alphabetic';
    }
    return canvas;
  }
  Render.drawPattern = drawPattern;

  function luminance(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  global.Render = Render;
})(typeof self !== 'undefined' ? self : window);
