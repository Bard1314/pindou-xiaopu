/* processor.js — 拼豆图稿核心管线：网格取色、背景移除、色卡匹配、Lab 抖动、杂色清理 */
(function (global) {
  'use strict';

  const Processor = {};
  const CM = global.ColorMath;

  /* ---- 网格化：每格主导色（按量化色桶取众数） ---- */
  function sampleGrid(imgData, gridW, gridH) {
    const { data, width: srcW, height: srcH } = imgData;
    const cells = new Array(gridW * gridH);
    for (let gy = 0; gy < gridH; gy++) {
      const y0 = Math.floor((gy * srcH) / gridH), y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * srcH) / gridH));
      for (let gx = 0; gx < gridW; gx++) {
        const x0 = Math.floor((gx * srcW) / gridW), x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * srcW) / gridW));
        const buckets = new Map();
        let rSum = 0, gSum = 0, bSum = 0, n = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * srcW + x) * 4;
            const a = data[i + 3];
            if (a < 40) continue; // 透明像素跳过
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
            buckets.set(key, (buckets.get(key) || 0) + 1);
            rSum += r; gSum += g; bSum += b; n++;
          }
        }
        let idx = gy * gridW + gx;
        if (n === 0) { cells[idx] = null; continue; } // 全透明格
        let bestKey = null, bestCount = -1;
        for (const [key, count] of buckets) { if (count > bestCount) { bestCount = count; bestKey = key; } }
        cells[idx] = [rSum / n, gSum / n, bSum / n];
      }
    }
    return cells; // null 表示透明/外部
  }

  /* ---- 背景移除：边界洪水填充（ΔE 阈值内与边界均色接近的格标记为背景） ---- */
  function removeBackground(cells, gridW, gridH, threshold) {
    threshold = threshold == null ? 16 : threshold;
    const n = gridW * gridH;
    const bg = new Uint8Array(n);
    // 边界均色（采样四条边所有非 null 格）
    let r = 0, g = 0, b = 0, cnt = 0;
    const edge = [];
    for (let x = 0; x < gridW; x++) { edge.push(x, (gridH - 1) * gridW + x); }
    for (let y = 0; y < gridH; y++) { edge.push(y * gridW, y * gridW + gridW - 1); }
    for (const idx of edge) {
      const c = cells[idx];
      if (!c) continue;
      r += c[0]; g += c[1]; b += c[2]; cnt++;
    }
    if (cnt === 0) return bg;
    r /= cnt; g /= cnt; b /= cnt;
    const edgeLab = CM.rgbToLab([r, g, b]);
    const queue = [];
    for (const idx of edge) {
      const c = cells[idx];
      if (c && CM.ciede2000(CM.rgbToLab(c), edgeLab) < threshold) { bg[idx] = 1; queue.push(idx); }
    }
    while (queue.length) {
      const idx = queue.pop();
      const x = idx % gridW, y = (idx / gridW) | 0;
      const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
        const ni = ny * gridW + nx;
        if (bg[ni] || !cells[ni]) continue;
        if (CM.ciede2000(CM.rgbToLab(cells[ni]), edgeLab) < threshold) { bg[ni] = 1; queue.push(ni); }
      }
    }
    return bg;
  }

  /* ---- 颜色映射：RGB 格 → 候选色卡最近色，返回代码数组 ---- */
  function mapToPalette(cells, bg, gridW, gridH, candidates, useCiede) {
    const labCands = candidates.map((c) => c.lab);
    const out = new Array(gridW * gridH);
    for (let i = 0; i < cells.length; i++) {
      if (!cells[i] || bg[i]) { out[i] = null; continue; }
      const lab = CM.rgbToLab(cells[i]);
      out[i] = candidates[CM.nearestLabIndex(lab, labCands, useCiede)].code;
    }
    return out;
  }

  /* ---- Lab 空间 Floyd-Steinberg 抖动 ---- */
  function ditherMap(cells, bg, gridW, gridH, candidates, useCiede) {
    const n = gridW * gridH;
    const labCands = candidates.map((c) => c.lab);
    const labGrid = new Array(n);
    for (let i = 0; i < n; i++) labGrid[i] = cells[i] ? CM.rgbToLab(cells[i]) : null;
    const out = new Array(n);
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const i = y * gridW + x;
        if (!labGrid[i] || bg[i]) { out[i] = null; continue; }
        const best = CM.nearestLabIndex(labGrid[i], labCands, useCiede);
        out[i] = candidates[best].code;
        const err = [labGrid[i][0] - labCands[best][0], labGrid[i][1] - labCands[best][1], labGrid[i][2] - labCands[best][2]];
        const dist = [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]];
        for (const [dx, dy, w] of dist) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= gridW || ny >= gridH) continue;
          const ni = ny * gridW + nx;
          if (!labGrid[ni]) continue;
          labGrid[ni] = [labGrid[ni][0] + err[0] * w, labGrid[ni][1] + err[1] * w, labGrid[ni][2] + err[2] * w];
        }
      }
    }
    return out;
  }

  /* ---- 杂色清理：小连通域并入相邻主色 ---- */
  function cleanNoise(codes, gridW, gridH, minArea) {
    minArea = minArea == null ? 2 : minArea;
    const n = gridW * gridH;
    const compId = new Int32Array(n).fill(-1);
    const comps = [];
    const order = [];
    for (let i = 0; i < n; i++) {
      if (codes[i] == null || compId[i] !== -1) continue;
      const code = codes[i];
      const stack = [i]; compId[i] = comps.length;
      let area = 0;
      order.length = 0;
      while (stack.length) {
        const idx = stack.pop(); area++; order.push(idx);
        const x = idx % gridW, y = (idx / gridW) | 0;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
          const ni = ny * gridW + nx;
          if (codes[ni] === code && compId[ni] === -1) { compId[ni] = comps.length; stack.push(ni); }
        }
      }
      comps.push({ code, area, cells: order.slice(), small: area <= minArea });
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (let ci = 0; ci < comps.length; ci++) {
        const comp = comps[ci];
        if (!comp.small || comp.merged) continue;
        const neighborCount = new Map();
        for (const idx of comp.cells) {
          const x = idx % gridW, y = (idx / gridW) | 0;
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
            const ni = ny * gridW + nx;
            if (codes[ni] == null) continue;
            const nci = compId[ni];
            if (nci === ci) continue;
            const nc = comps[nci].code;
            neighborCount.set(nc, (neighborCount.get(nc) || 0) + 1);
          }
        }
        let bestCode = null, bestCount = 0;
        for (const [code, count] of neighborCount) { if (count > bestCount) { bestCount = count; bestCode = code; } }
        if (bestCode) {
          for (const idx of comp.cells) { codes[idx] = bestCode; }
          comp.merged = true;
          changed = true;
        }
      }
    }
    return codes;
  }

  /* ---- 主流程 ---- */
  function process(imgData, params, palette) {
    const gridW = params.width, gridH = params.height;
    let cells = sampleGrid(imgData, gridW, gridH);
    let bg = new Uint8Array(gridW * gridH);
    if (params.removeBackground) bg = removeBackground(cells, gridW, gridH, params.bgThreshold);

    // 预处理：亮度/对比度/饱和度（对单元格 RGB 做线性调整）
    if (params.brightness !== 0 || params.contrast !== 0 || params.saturation !== 0) {
      for (let i = 0; i < cells.length; i++) {
        if (!cells[i]) continue;
        cells[i] = adjustColor(cells[i], params);
      }
    }

    // K-means 预量化（限制颜色数）
    if (params.colorCount && params.colorCount > 0 && params.colorCount < palette.length) {
      const pts = [];
      for (let i = 0; i < cells.length; i++) if (cells[i] && !bg[i]) pts.push(cells[i]);
      if (pts.length > 0) {
        const clusters = CM.kmeans(pts, params.colorCount);
        const centers = clusters.map((c) => c.center);
        for (let i = 0; i < cells.length; i++) {
          if (!cells[i] || bg[i]) continue;
          let best = 0, bestD = Infinity;
          for (let c = 0; c < centers.length; c++) {
            const dx = cells[i][0] - centers[c][0], dy = cells[i][1] - centers[c][1], dz = cells[i][2] - centers[c][2];
            const d = dx * dx + dy * dy + dz * dz;
            if (d < bestD) { bestD = d; best = c; }
          }
          cells[i] = centers[best].slice();
        }
      }
    }

    const codes = params.dither ? ditherMap(cells, bg, gridW, gridH, palette, params.ciede) : mapToPalette(cells, bg, gridW, gridH, palette, params.ciede);
    if (params.cleanNoise !== false) cleanNoise(codes, gridW, gridH, params.minArea == null ? 2 : params.minArea);
    return { codes, width: gridW, height: gridH, bg, usedPalette: palette };
  }
  Processor.process = process;

  function adjustColor(rgb, params) {
    let r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    // 亮度
    const bright = params.brightness || 0;
    if (bright !== 0) {
      const f = bright > 0 ? 1 + bright : 1 + bright; // -1..1 → 乘性+加性混合
      r = r * f; g = g * f; b = b * f;
    }
    // 对比度
    const cont = params.contrast || 0;
    if (cont !== 0) {
      const f = 1 + cont;
      r = (r - 0.5) * f + 0.5; g = (g - 0.5) * f + 0.5; b = (b - 0.5) * f + 0.5;
    }
    // 饱和度
    const sat = params.saturation || 0;
    if (sat !== 0) {
      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const f = 1 + sat;
      r = gray + (r - gray) * f; g = gray + (g - gray) * f; b = gray + (b - gray) * f;
    }
    return [Math.max(0, Math.min(1, r)) * 255, Math.max(0, Math.min(1, g)) * 255, Math.max(0, Math.min(1, b)) * 255];
  }

  global.Processor = Processor;
})(typeof self !== 'undefined' ? self : window);
