/**
 * SARIF v2.1.0 reporter - for CI/CD integration (GitHub Code Scanning, etc.)
 * Maps all dead code findings to CWE-561 using the SARIF taxonomy system.
 */

/**
 * @param {object} results
 * @param {object} [options]
 * @returns {string}
 */
export function report(results, options = {}) {
  const { deadFiles = [], deadFunctions = [] } = results;

  const sarif = {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Swynx',
            version: '0.1.0',
            informationUri: 'https://swynx.io',
            rules: [
              {
                id: 'swynx/unreachable-file',
                shortDescription: {
                  text: 'CWE-561: Unreachable file detected',
                },
                fullDescription: {
                  text: 'The file is not reachable from any entry point via import graph analysis. This is a CWE-561 (Dead Code) security weakness — unreachable code increases attack surface and may contain unmonitored vulnerabilities.',
                },
                defaultConfiguration: {
                  level: 'warning',
                },
                relationships: [
                  {
                    target: {
                      id: '561',
                      guid: 'cwe-561',
                      toolComponent: { name: 'CWE' },
                    },
                    kinds: ['superset'],
                  },
                ],
                helpUri: 'https://cwe.mitre.org/data/definitions/561.html',
                properties: {
                  tags: ['security', 'CWE-561', 'dead-code'],
                },
              },
              {
                id: 'swynx/possibly-live',
                shortDescription: {
                  text: 'CWE-561: Possibly live file — review required',
                },
                fullDescription: {
                  text: 'The file is not reachable from entry points but matches a dynamic loading pattern. May be loaded via plugins, middleware, or dependency injection. Manual review recommended.',
                },
                defaultConfiguration: {
                  level: 'note',
                },
                relationships: [
                  {
                    target: {
                      id: '561',
                      guid: 'cwe-561',
                      toolComponent: { name: 'CWE' },
                    },
                    kinds: ['superset'],
                  },
                ],
                helpUri: 'https://cwe.mitre.org/data/definitions/561.html',
                properties: {
                  tags: ['security', 'CWE-561', 'dead-code', 'review-required'],
                },
              },
              {
                id: 'swynx/unreachable-function',
                shortDescription: {
                  text: 'CWE-561: Unreachable function detected',
                },
                fullDescription: {
                  text: 'A private or unexported function that is never called within its scope. This is a CWE-561 (Dead Code) security weakness.',
                },
                defaultConfiguration: {
                  level: 'note',
                },
                relationships: [
                  {
                    target: {
                      id: '561',
                      guid: 'cwe-561',
                      toolComponent: { name: 'CWE' },
                    },
                    kinds: ['superset'],
                  },
                ],
                helpUri: 'https://cwe.mitre.org/data/definitions/561.html',
                properties: {
                  tags: ['security', 'CWE-561', 'dead-code'],
                },
              },
            ],
          },
        },
        taxonomies: [
          {
            name: 'CWE',
            version: '4.14',
            informationUri: 'https://cwe.mitre.org/data/published/cwe_v4.14.pdf',
            organization: 'MITRE',
            shortDescription: { text: 'The MITRE Common Weakness Enumeration' },
            taxa: [
              {
                id: '561',
                guid: 'cwe-561',
                name: 'Dead Code',
                shortDescription: { text: 'The product contains dead code, which can never be executed.' },
                helpUri: 'https://cwe.mitre.org/data/definitions/561.html',
              },
            ],
          },
        ],
        results: [
          ...deadFiles.map((file) => {
            const verdict = file.verdict || 'unreachable';
            const confidence = file.evidence?.confidence;

            let ruleId = 'swynx/unreachable-file';
            let level = 'warning';

            if (verdict === 'possibly-live') {
              ruleId = 'swynx/possibly-live';
              level = 'note';
            } else if (confidence && confidence.score >= 0.85) {
              level = 'warning';
            } else if (confidence && confidence.score < 0.6) {
              level = 'note';
            }

            const result = {
              ruleId,
              level,
              message: {
                text: verdict === 'possibly-live'
                  ? `CWE-561: File may be loaded dynamically (${Math.round((confidence?.score || 0.7) * 100)}% confidence). Review required.`
                  : `CWE-561: File is unreachable from all entry points (${Math.round((confidence?.score || 0.95) * 100)}% confidence).`,
              },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: {
                      uri: file.path,
                      uriBaseId: '%SRCROOT%',
                    },
                  },
                },
              ],
              taxa: [
                {
                  id: '561',
                  guid: 'cwe-561',
                  toolComponent: { name: 'CWE' },
                },
              ],
            };

            if (file.evidence || file.cwe) {
              result.properties = {
                verdict,
                cwe: file.cwe || 'CWE-561',
                evidence: file.evidence,
              };
            }

            if (file.aiQualification && !file.aiQualification.error) {
              const ai = file.aiQualification;
              result.properties = { ...(result.properties || {}), aiQualification: ai };
              if (ai.category === 'false-positive' || ai.category === 'likely-alive') {
                result.level = 'note';
              } else if (ai.category === 'confirmed-dead' && ai.confidence >= 0.9) {
                result.level = 'error';
              }
            }

            return result;
          }),
          ...deadFunctions.map((fn) => ({
            ruleId: 'swynx/unreachable-function',
            level: 'note',
            message: {
              text: `CWE-561: ${fn.language} function "${fn.name}" is ${fn.reason === 'unexported-never-called' ? 'unexported and' : 'private and'} never called.`,
            },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: {
                    uri: fn.file,
                    uriBaseId: '%SRCROOT%',
                  },
                  region: {
                    startLine: fn.line || 1,
                    ...(fn.endLine ? { endLine: fn.endLine } : {}),
                  },
                },
              },
            ],
            taxa: [
              {
                id: '561',
                guid: 'cwe-561',
                toolComponent: { name: 'CWE' },
              },
            ],
            properties: {
              verdict: fn.verdict || 'unreachable',
              cwe: fn.cwe || 'CWE-561',
              evidence: fn.evidence,
            },
          })),
        ],
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}
