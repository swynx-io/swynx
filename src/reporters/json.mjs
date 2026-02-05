/**
 * JSON reporter - machine-readable output.
 */

/**
 * @param {object} results
 * @param {object} [options]
 * @returns {string}
 */
export function report(results, options = {}) {
  return JSON.stringify(results, null, 2);
}
