// src/scanner/parse-worker.mjs
// Worker thread for parallel file parsing
// Receives a chunk of files and a parser type, returns parsed results

import { parentPort, workerData } from 'worker_threads';

const { files, parserType } = workerData;

async function run() {
  let parseFn;

  switch (parserType) {
    case 'javascript': {
      const mod = await import('./parsers/javascript.mjs');
      parseFn = mod.parseJavaScript;
      break;
    }
    case 'css': {
      const mod = await import('./parsers/css.mjs');
      parseFn = mod.parseCSS;
      break;
    }
    case 'assets': {
      const mod = await import('./parsers/assets.mjs');
      parseFn = mod.analyseAssets;
      break;
    }
    case 'other': {
      const mod = await import('./parsers/registry.mjs');
      parseFn = mod.parseFile;
      break;
    }
    default:
      throw new Error(`Unknown parser type: ${parserType}`);
  }

  const results = [];

  for (let i = 0; i < files.length; i++) {
    try {
      const result = await parseFn(files[i]);
      if (result) results.push(result);
    } catch {
      // Skip files that fail to parse
    }

    // Report progress every 100 files
    if ((i + 1) % 100 === 0 || i === files.length - 1) {
      parentPort.postMessage({ type: 'progress', done: i + 1, total: files.length });
    }
  }

  parentPort.postMessage({ type: 'done', results });
}

run().catch(err => {
  parentPort.postMessage({ type: 'error', message: err.message });
});
