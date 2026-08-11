/* color.js — 颜色数学：sRGB↔Lab、CIEDE2000、Lab 欧氏距离、K-means 预量化 */
(function (global) {
  'use strict';

  const ColorMath = {};

  /* ---- sRGB 线性化与 Lab (D65) ---- */
  function srgbLin(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function rgbToLab(rgb) {
    const [r, g, b] = [srgbLin(rgb[0]), srgbLin(rgb[1]), srgbLin(rgb[2])];
    let x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
    let y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
    let z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b;
    x /= 0.95047; z /= 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  ColorMath.rgbToLab = rgbToLab;

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  ColorMath.hexToRgb = hexToRgb;

  function rgbToHex(rgb) {
    return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }
  ColorMath.rgbToHex = rgbToHex;

  function labToRgb(lab) {
    const [l, a, b] = lab;
    const fy = (l + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    const finv = (t) => {
      const t3 = t * t * t;
      return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787;
    };
    let x = finv(fx) * 0.95047, y = finv(fy), z = finv(fz) * 1.08883;
    const lin2srgb = (c) => {
      c = Math.max(0, Math.min(1, c));
      return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    };
    return [lin2srgb(x * 3.2404542 - y * 1.5371385 - z * 0.4985314) * 255,
            lin2srgb(-x * 0.9692660 + y * 1.8760108 + z * 0.0415560) * 255,
            lin2srgb(x * 0.0556434 - y * 0.2040259 + z * 1.0572252) * 255];
  }
  ColorMath.labToRgb = labToRgb;

  /* ---- Lab 欧氏距离 ---- */
  function labDist(l1, l2) {
    const dl = l1[0] - l2[0], da = l1[1] - l2[1], db = l1[2] - l2[2];
    return dl * dl + da * da + db * db;
  }
  ColorMath.labDist = labDist;

  /* ---- CIEDE2000 (ΔE00, Sharma 标准实现) ---- */
  function ciede2000(lab1, lab2) {
    const [L1, a1, b1] = lab1, [L2, a2, b2] = lab2;
    const C1 = Math.sqrt(a1 * a1 + b1 * b1);
    const C2 = Math.sqrt(a2 * a2 + b2 * b2);
    const Cb = (C1 + C2) / 2;
    const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))));
    const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    const C1p = Math.sqrt(a1p * a1p + b1 * b1);
    const C2p = Math.sqrt(a2p * a2p + b2 * b2);
    const h1p = C1p === 0 ? 0 : ((Math.atan2(b1, a1p) * 180 / Math.PI) + 360) % 360;
    const h2p = C2p === 0 ? 0 : ((Math.atan2(b2, a2p) * 180 / Math.PI) + 360) % 360;
    const dLp = L2 - L1;
    const dCp = C2p - C1p;
    let dhp = 0;
    if (C1p * C2p !== 0) {
      dhp = h2p - h1p;
      if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
    }
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * Math.PI / 360);
    const Lbp = (L1 + L2) / 2;
    const Cbp = (C1p + C2p) / 2;
    let hbp = h1p + h2p;
    if (C1p * C2p !== 0) {
      if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
      else if (h1p + h2p < 360) hbp = (h1p + h2p + 360) / 2;
      else hbp = (h1p + h2p - 360) / 2;
    }
    const T = 1 - 0.17 * Math.cos((hbp - 30) * Math.PI / 180)
              + 0.24 * Math.cos(2 * hbp * Math.PI / 180)
              + 0.32 * Math.cos((3 * hbp + 6) * Math.PI / 180)
              - 0.20 * Math.cos((4 * hbp - 63) * Math.PI / 180);
    const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
    const RC = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));
    const SL = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
    const SC = 1 + 0.045 * Cbp;
    const SH = 1 + 0.015 * Cbp * T;
    const RT = -Math.sin(2 * dTheta * Math.PI / 180) * RC;
    const dL = dLp / SL, dC = dCp / SC, dH = dHp / SH;
    return Math.sqrt(dL * dL + dC * dC + dH * dH + RT * dC * dH);
  }
  ColorMath.ciede2000 = ciede2000;

  /* ---- 最近色匹配：候选 { lab } 数组，返回最近项索引 ---- */
  function nearestLabIndex(lab, candidates, useCiede) {
    let best = -1, bestD = Infinity;
    if (useCiede) {
      for (let i = 0; i < candidates.length; i++) {
        const d = ciede2000(lab, candidates[i]);
        if (d < bestD) { bestD = d; best = i; }
      }
    } else {
      for (let i = 0; i < candidates.length; i++) {
        const d = labDist(lab, candidates[i]);
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    return best;
  }
  ColorMath.nearestLabIndex = nearestLabIndex;

  /* ---- K-means 预量化（RGB 空间，K 个中心，迭代 12 次） ---- */
  function kmeans(points, k, maxIter) {
    maxIter = maxIter || 12;
    const n = points.length;
    if (n === 0) return [];
    if (k >= n) return points.map((p) => ({ center: p.slice(), size: 1 }));
    // 用均匀抽样初始化中心
    const centers = [];
    const step = Math.max(1, Math.floor(n / k));
    for (let i = 0; i < k; i++) centers.push(points[Math.min(i * step, n - 1)].slice());
    const assign = new Int32Array(n);
    for (let iter = 0; iter < maxIter; iter++) {
      let moved = 0;
      for (let i = 0; i < n; i++) {
        let best = 0, bestD = Infinity;
        for (let c = 0; c < k; c++) {
          const dx = points[i][0] - centers[c][0], dy = points[i][1] - centers[c][1], dz = points[i][2] - centers[c][2];
          const d = dx * dx + dy * dy + dz * dz;
          if (d < bestD) { bestD = d; best = c; }
        }
        if (assign[i] !== best) { assign[i] = best; moved++; }
      }
      // 重算中心
      const sums = Array.from({ length: k }, () => [0, 0, 0, 0]);
      for (let i = 0; i < n; i++) {
        const c = assign[i];
        sums[c][0] += points[i][0]; sums[c][1] += points[i][1]; sums[c][2] += points[i][2]; sums[c][3]++;
      }
      for (let c = 0; c < k; c++) {
        if (sums[c][3] > 0) {
          centers[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
        }
      }
      if (moved === 0) break;
    }
    const out = [];
    for (let c = 0; c < k; c++) out.push({ center: centers[c], size: 0 });
    for (let i = 0; i < n; i++) out[assign[i]].size++;
    return out;
  }
  ColorMath.kmeans = kmeans;

  global.ColorMath = ColorMath;
})(typeof self !== 'undefined' ? self : window);
