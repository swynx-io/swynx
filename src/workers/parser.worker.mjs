// src/workers/parser.worker.mjs
// Runs inside a worker thread — parses files and posts results back

import { parentPort } from 'worker_threads';
import { parseFile } from '../languages/index.mjs';

parentPort.on('message', async ({ filePath, content, id }) => {
  try {
    const result = await parseFile(filePath, content);
    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({ id, error: error.message });
  }
});
