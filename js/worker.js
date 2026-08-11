/* worker.js — Web Worker 计算主循环（主线程兜底时由 app.js 直接调用 Processor） */
'use strict';

importScripts('color.js', 'palette.js', 'processor.js');

self.onmessage = function (e) {
  const { jobId, imageData, params, palette } = e.data;
  try {
    const result = self.Processor.process(imageData, params, palette);
    self.postMessage({ jobId, ok: true, result });
  } catch (err) {
    self.postMessage({ jobId, ok: false, error: String(err && err.message || err) });
  }
};
