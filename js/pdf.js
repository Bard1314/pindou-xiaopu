/* pdf.js — jsPDF A4 图纸导出：图案分页 + 图例/用量页（中文位图化） */
(function (global) {
  'use strict';

  const PDFExporter = {};
  const SCALE = 4; // 每 mm 渲染像素放大倍数
  const MM = SCALE * (96 / 25.4); // px per mm on canvas

  const PAGE_W = 210, PAGE_H = 297, MARGIN = 12;
  const CONTENT_W = PAGE_W - MARGIN * 2, CONTENT_H = PAGE_H - MARGIN * 2;

  function getJsPDF() {
    if (global.jspdf && global.jspdf.jsPDF) return global.jspdf.jsPDF;
    if (global.jsPDF) return global.jsPDF;
    return null;
  }

  /* 用系统字体在位图画布上渲染一页，再贴入 PDF */
  function renderPage(pdf, opts) {
    const cw = Math.round(PAGE_W * MM), ch = Math.round(PAGE_H * MM);
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, cw, ch);
    opts.draw(ctx, cw, ch);
    const dataUrl = canvas.toDataURL('image/png');
    pdf.addImage(dataUrl, 'PNG', 0, 0, PAGE_W, PAGE_H, undefined, 'FAST');
  }

  function drawHeader(ctx, w, h, title, subtitle, pageNo) {
    ctx.fillStyle = '#B4532F';
    ctx.font = '600 ' + Math.round(9 * MM) + 'px sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('拼豆小铺 · 图稿图纸', MARGIN * MM, (MARGIN - 3) * MM);
    ctx.fillStyle = '#3A2C21';
    ctx.font = '700 ' + Math.round(14 * MM) + 'px sans-serif';
    ctx.fillText(title, MARGIN * MM, MARGIN * MM + 8 * MM);
    ctx.fillStyle = '#8C6A4F';
    ctx.font = Math.round(7.5 * MM) + 'px sans-serif';
    ctx.fillText(subtitle, MARGIN * MM, MARGIN * MM + 15 * MM);
    ctx.strokeStyle = '#EDE0D2';
    ctx.lineWidth = MM;
    ctx.beginPath();
    ctx.moveTo(MARGIN * MM, (MARGIN + 19) * MM);
    ctx.lineTo((PAGE_W - MARGIN) * MM, (MARGIN + 19) * MM);
    ctx.stroke();
    ctx.fillStyle = '#A98C6F';
    ctx.font = Math.round(6.5 * MM) + 'px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('第 ' + pageNo + ' 页', (PAGE_W - MARGIN) * MM, (MARGIN - 3) * MM);
    ctx.textAlign = 'left';
  }

  function drawFooter(ctx, w, h, pageNo, totalPages, dateStr) {
    ctx.strokeStyle = '#EDE0D2';
    ctx.lineWidth = MM;
    ctx.beginPath();
    ctx.moveTo(MARGIN * MM, (PAGE_H - MARGIN + 5) * MM);
    ctx.lineTo((PAGE_W - MARGIN) * MM, (PAGE_H - MARGIN + 5) * MM);
    ctx.stroke();
    ctx.fillStyle = '#A98C6F';
    ctx.font = Math.round(6.5 * MM) + 'px sans-serif';
    ctx.fillText('生成日期：' + dateStr, MARGIN * MM, (PAGE_H - MARGIN + 10) * MM);
    ctx.textAlign = 'right';
    ctx.fillText('颜色为数字近似值，请以实物色号贴纸为准', (PAGE_W - MARGIN) * MM, (PAGE_H - MARGIN + 10) * MM);
    ctx.textAlign = 'left';
  }

  function paletteMap(usedPalette) {
    const m = new Map();
    for (const entry of usedPalette) m.set(entry.code, entry);
    return m;
  }

  /* 导出入口 */
  function exportPDF(result, stats, opts) {
    const JsPDF = getJsPDF();
    if (!JsPDF) return { ok: false, error: 'PDF 库加载失败' };
    const pm = paletteMap(result.usedPalette);
    const { codes, width: W, height: H } = result;
    const patternName = opts.patternName || '拼豆图稿';
    const brandLabel = opts.brandLabel || 'MARD 30色';
    const dateStr = opts.dateStr || new Date().toLocaleDateString('zh-CN');

    const pdf = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

    // ---- 图案页 ----
    let s = Math.min(CONTENT_W / W, CONTENT_H / H);
    s = Math.max(2.5, Math.min(7, s));
    const tilesX = Math.max(1, Math.floor(CONTENT_W / s));
    const tilesY = Math.max(1, Math.floor(CONTENT_H / s));
    const needTiles = s < 2.5 || W > tilesX || H > tilesY;
    const perX = needTiles ? Math.floor(CONTENT_W / s) : W;
    const perY = needTiles ? Math.floor(CONTENT_H / s) : H;

    const blocks = [];
    for (let by = 0; by < H; by += perY) {
      for (let bx = 0; bx < W; bx += perX) {
        blocks.push({ x0: bx, y0: by, x1: Math.min(W, bx + perX), y1: Math.min(H, by + perY) });
      }
    }

    blocks.forEach((block, bi) => {
      const draw = (ctx, cw, ch) => {
        drawHeader(ctx, cw, ch, patternName, '尺寸 ' + W + '×' + H + ' 格 · ' + brandLabel + ' · 区块 ' + (bi + 1) + '/' + blocks.length + '（' + block.x0 + ',' + block.y0 + ' - ' + block.x1 + ',' + block.y1 + '）', bi + 1);
        const bw = block.x1 - block.x0, bh = block.y1 - block.y0;
        const cellPx = Math.min((CONTENT_W / bw) * MM, (CONTENT_H / bh) * MM);
        const ox = MARGIN * MM + ((CONTENT_W - bw * (CONTENT_W / bw)) / 2) * MM;
        const oy = (MARGIN + 26) * MM;
        const gx = (PAGE_W - MARGIN * 2) * MM / bw; // 实际格像素
        const gy = (CONTENT_H - 26) * MM / bh;
        const cpx = Math.min(gx, gy);
        for (let y = 0; y < bh; y++) {
          for (let x = 0; x < bw; x++) {
            const code = codes[(block.y0 + y) * W + (block.x0 + x)];
            const px = ox + x * cpx, py = oy + y * cpx;
            if (code == null) {
              ctx.fillStyle = '#F1EDEA';
              ctx.fillRect(px, py, cpx, cpx);
              continue;
            }
            const entry = pm.get(code);
            ctx.fillStyle = entry ? entry.hex : '#CCCCCC';
            ctx.fillRect(px, py, cpx, cpx);
          }
        }
        // 网格线
        ctx.strokeStyle = 'rgba(58,44,33,0.35)';
        ctx.lineWidth = Math.max(1, 0.2 * MM);
        for (let x = 0; x <= bw; x++) {
          ctx.beginPath(); ctx.moveTo(ox + x * cpx, oy); ctx.lineTo(ox + x * cpx, oy + bh * cpx); ctx.stroke();
        }
        for (let y = 0; y <= bh; y++) {
          ctx.beginPath(); ctx.moveTo(ox, oy + y * cpx); ctx.lineTo(ox + bw * cpx, oy + y * cpx); ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(58,44,33,0.65)';
        ctx.lineWidth = Math.max(1.5, 0.4 * MM);
        for (let x = 0; x <= bw; x += 5) {
          ctx.beginPath(); ctx.moveTo(ox + x * cpx, oy); ctx.lineTo(ox + x * cpx, oy + bh * cpx); ctx.stroke();
        }
        for (let y = 0; y <= bh; y += 5) {
          ctx.beginPath(); ctx.moveTo(ox, oy + y * cpx); ctx.lineTo(ox + bw * cpx, oy + y * cpx); ctx.stroke();
        }
        // 坐标
        ctx.fillStyle = 'rgba(58,44,33,0.6)';
        ctx.font = Math.round(6 * MM) + 'px sans-serif';
        ctx.textAlign = 'center';
        for (let x = 0; x < bw; x += 5) {
          ctx.fillText(String(block.x0 + x), ox + x * cpx + cpx / 2, oy - 2 * MM);
        }
        ctx.textAlign = 'right';
        for (let y = 0; y < bh; y += 5) {
          ctx.fillText(String(block.y0 + y), ox - 3 * MM, oy + y * cpx + cpx / 2);
        }
        ctx.textAlign = 'left';
        // 色号标注（格 >= 4mm 时）
        if (s >= 4 && cpx >= 4 * MM * 0.9) {
          ctx.font = '600 ' + Math.round(Math.min(10, cpx / 4.5)) + 'px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          for (let y = 0; y < bh; y++) {
            for (let x = 0; x < bw; x++) {
              const code = codes[(block.y0 + y) * W + (block.x0 + x)];
              if (code == null) continue;
              const entry = pm.get(code);
              ctx.fillStyle = luminance(entry ? entry.hex : '#888') > 0.55 ? '#3A2C21' : '#FFFFFF';
              ctx.fillText(code, ox + x * cpx + cpx / 2, oy + y * cpx + cpx / 2 + 0.5);
            }
          }
          ctx.textBaseline = 'alphabetic';
        }
        drawFooter(ctx, cw, ch, bi + 1, blocks.length, dateStr);
      };
      renderPage(pdf, { draw });
      if (opts.onProgress) opts.onProgress(bi + 1, blocks.length, '图纸页');
    });

    // ---- 图例/用量页 ----
    const rowsPerPage = 24;
    const legStartPage = blocks.length + 1;
    const totalLegPages = Math.max(1, Math.ceil(stats.rows.length / rowsPerPage));
    for (let lp = 0; lp < totalLegPages; lp++) {
      const rows = stats.rows.slice(lp * rowsPerPage, (lp + 1) * rowsPerPage);
      const draw = (ctx, cw, ch) => {
        drawHeader(ctx, cw, ch, '色号用量清单', '品牌 ' + brandLabel + ' · 豆型 2.6mm 小豆 · 总格数 ' + stats.total + ' · 建议 29×29 板 ' + stats.boardCount + ' 块', legStartPage + lp);
        const colX = { swatch: 16, code: 40, name: 78, count: 132, pct: 160, boards: 185 };
        const headY = 46;
        ctx.fillStyle = '#F8EEE2';
        ctx.fillRect(MARGIN * MM, headY * MM, CONTENT_W * MM, 7 * MM);
        ctx.fillStyle = '#6E5340';
        ctx.font = '600 ' + Math.round(7 * MM) + 'px sans-serif';
        const heads = [['色块', colX.swatch], ['色号', colX.code], ['色名', colX.name], ['用量（颗）', colX.count], ['占比', colX.pct], ['建议板数', colX.boards]];
        for (const [label, x] of heads) ctx.fillText(label, x * MM, (headY + 4.6) * MM);
        ctx.fillStyle = '#3A2C21';
        ctx.font = Math.round(7.2 * MM) + 'px sans-serif';
        rows.forEach((row, i) => {
          const ry = headY + 9 + i * 8.5;
          if (i % 2 === 1) {
            ctx.fillStyle = '#FBF7F1';
            ctx.fillRect(MARGIN * MM, ry * MM, CONTENT_W * MM, 8 * MM);
          }
          // 色块
          ctx.fillStyle = row.hex;
          ctx.fillRect(colX.swatch * MM, (ry + 1.2) * MM, 5 * MM, 5 * MM);
          ctx.strokeStyle = '#EDE0D2';
          ctx.lineWidth = 0.5 * MM;
          ctx.strokeRect(colX.swatch * MM, (ry + 1.2) * MM, 5 * MM, 5 * MM);
          ctx.fillStyle = '#3A2C21';
          ctx.fillText(row.code, colX.code * MM, (ry + 5) * MM);
          ctx.fillText(row.name, colX.name * MM, (ry + 5) * MM);
          ctx.fillStyle = '#8C6A4F';
          ctx.font = Math.round(7 * MM) + 'px sans-serif';
          ctx.fillText(String(row.count), colX.count * MM, (ry + 5) * MM);
          ctx.fillText(row.pct.toFixed(1) + '%', colX.pct * MM, (ry + 5) * MM);
          ctx.fillText(String(Math.max(1, Math.ceil(row.count / 841))), colX.boards * MM, (ry + 5) * MM);
          ctx.font = Math.round(7.2 * MM) + 'px sans-serif';
        });
        // 合计
        ctx.fillStyle = '#F8EEE2';
        ctx.fillRect(MARGIN * MM, (headY + 10 + rows.length * 8.5) * MM, CONTENT_W * MM, 7 * MM);
        ctx.fillStyle = '#6E5340';
        ctx.font = '600 ' + Math.round(7 * MM) + 'px sans-serif';
        ctx.fillText('合计', colX.code * MM, (headY + 14.6 + rows.length * 8.5) * MM);
        ctx.fillText(stats.total + ' 颗', colX.count * MM, (headY + 14.6 + rows.length * 8.5) * MM);
        ctx.fillText('100%', colX.pct * MM, (headY + 14.6 + rows.length * 8.5) * MM);
        drawFooter(ctx, cw, ch, legStartPage + lp, blocks.length + totalLegPages, dateStr);
      };
      renderPage(pdf, { draw });
      if (opts.onProgress) opts.onProgress(blocks.length + lp + 1, blocks.length + totalLegPages, '清单页');
    }

    pdf.save((opts.fileName || '拼豆图纸') + '.pdf');
    return { ok: true, pages: blocks.length + totalLegPages };
  }
  PDFExporter.exportPDF = exportPDF;

  function luminance(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  global.PDFExporter = PDFExporter;
})(typeof self !== 'undefined' ? self : window);
