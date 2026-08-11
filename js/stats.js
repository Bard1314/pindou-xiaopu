/* stats.js — 用量统计：色号计数、排序、占比、建议板数 */
(function (global) {
  'use strict';

  const Stats = {};

  /* codes: 数组(含 null 背景)；paletteByCode: Map(code -> palette entry) */
  function compute(codes, paletteByCode) {
    const counts = new Map();
    let total = 0;
    for (const code of codes) {
      if (code == null) continue;
      counts.set(code, (counts.get(code) || 0) + 1);
      total++;
    }
    const rows = [];
    for (const [code, count] of counts) {
      const entry = paletteByCode.get(code);
      rows.push({
        code,
        count,
        pct: total ? (count / total) * 100 : 0,
        hex: entry ? entry.hex : '#CCCCCC',
        name: entry ? entry.name : '',
        family: entry ? entry.family : ''
      });
    }
    rows.sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
    return { rows, total, distinct: rows.length, boardCount: Math.ceil(total / (29 * 29)) };
  }
  Stats.compute = compute;

  global.Stats = Stats;
})(typeof self !== 'undefined' ? self : window);
