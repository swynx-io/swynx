// src/workers/pool.mjs
// Worker thread pool for parallel file parsing

import { Worker } from 'worker_threads';
import { cpus } from 'os';
import { fileURLToPath } from 'url';

export class WorkerPool {
  /**
   * @param {string} workerPath       - Absolute path to the worker script.
   * @param {object} [options]
   * @param {number} [options.size]   - Number of workers (defaults to CPU count - 1, min 1).
   */
  constructor(workerPath, options = {}) {
    this.size = Math.max(1, options.size ?? cpus().length - 1);
    this.workerPath = workerPath;
    this.workers = [];
    this.nextId = 0;
    this.pending = new Map();   // id -> { resolve, reject }
    this.robin = 0;             // round-robin index

    for (let i = 0; i < this.size; i++) {
      this._spawnWorker();
    }
  }

  /**
   * Spawn a single worker and wire up its message/error handlers.
   */
  _spawnWorker() {
    const worker = new Worker(this.workerPath);

    worker.on('message', ({ id, result, error }) => {
      const pending = this.pending.get(id);
      if (!pending) return;

      this.pending.delete(id);

      if (error) {
        pending.reject(new Error(error));
      } else {
        pending.resolve(result);
      }
    });

    worker.on('error', (err) => {
      // Reject all tasks assigned to this worker that are still pending.
      // In practice each message carries its own id so we can't tell which
      // belong to this worker, but the worker crashing is fatal for those tasks.
      // We replace the dead worker immediately.
      const idx = this.workers.indexOf(worker);
      if (idx !== -1) {
        this.workers[idx] = null;
        this._replaceWorker(idx);
      }
    });

    this.workers.push(worker);
  }

  /**
   * Replace a dead worker at the given index.
   */
  _replaceWorker(idx) {
    const worker = new Worker(this.workerPath);

    worker.on('message', ({ id, result, error }) => {
      const pending = this.pending.get(id);
      if (!pending) return;

      this.pending.delete(id);

      if (error) {
        pending.reject(new Error(error));
      } else {
        pending.resolve(result);
      }
    });

    worker.on('error', () => {
      const i = this.workers.indexOf(worker);
      if (i !== -1) {
        this.workers[i] = null;
        this._replaceWorker(i);
      }
    });

    this.workers[idx] = worker;
  }

  /**
   * Send a single file to the next available worker and return the parse result.
   * @param {string} filePath - Path to the file.
   * @param {string} content  - File contents.
   * @returns {Promise<object>} Parsed result from the worker.
   */
  async parseFile(filePath, content) {
    const id = this.nextId++;
    const worker = this.workers[this.robin % this.size];
    this.robin++;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, filePath, content });
    });
  }

  /**
   * Parse multiple files in parallel using the pool.
   * @param {Array<{filePath: string, content: string}>} files
   * @returns {Promise<object[]>} Array of parse results (same order as input).
   */
  async parseFiles(files) {
    return Promise.all(
      files.map(({ filePath, content }) => this.parseFile(filePath, content))
    );
  }

  /**
   * Shut down all workers. Pending tasks will never resolve.
   */
  terminate() {
    for (const worker of this.workers) {
      if (worker) {
        worker.terminate();
      }
    }

    this.workers = [];
    this.pending.clear();
  }
}
