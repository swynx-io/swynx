/**
 * JSON reporter - machine-readable output.
 * Adds a top-level security summary with CWE-561 as the headline.
 */

/**
 * @param {object} results
 * @param {object} [options]
 * @returns {string}
 */
export function report(results, options = {}) {
  const deadFiles = results.deadFiles || [];
  const deadFunctions = results.deadFunctions || [];
  const cweCount = deadFiles.length + deadFunctions.length;

  const output = {
    security: {
      cwe561: {
        id: 'CWE-561',
        name: 'Dead Code',
        url: 'https://cwe.mitre.org/data/definitions/561.html',
        instances: cweCount,
        unreachableFiles: deadFiles.length,
        unreachableFunctions: deadFunctions.length,
        severity: cweCount > 0 ? 'warning' : 'none',
      },
    },
    ...results,
  };

  return JSON.stringify(output, null, 2);
}
