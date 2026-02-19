/**
 * SARIF v2.1.0 reporter - for CI/CD integration (GitHub Code Scanning, etc.)
 */

/**
 * @param {object} results
 * @param {object} [options]
 * @returns {string}
 */
export function report(results, options = {}) {
  const { deadFiles = [] } = results;

  const sarif = {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Swynx',
            version: '0.1.0',
            informationUri: 'https://github.com/swynx/swynx',
            rules: [
              {
                id: 'swynx/dead-file',
                shortDescription: {
                  text: 'Unreachable file detected',
                },
                fullDescription: {
                  text: 'The file is not reachable from any entry point and appears to be dead code.',
                },
                defaultConfiguration: {
                  level: 'warning',
                },
                helpUri: 'https://github.com/swynx/swynx#dead-file',
              },
              {
                id: 'swynx/possibly-live',
                shortDescription: {
                  text: 'Possibly live file detected',
                },
                fullDescription: {
                  text: 'The file is not reachable from entry points but matches a dynamic loading pattern.',
                },
                defaultConfiguration: {
                  level: 'note',
                },
                helpUri: 'https://github.com/swynx/swynx#possibly-live',
              },
            ],
          },
        },
        results: deadFiles.map((file) => {
          const verdict = file.verdict || 'unreachable';
          const confidence = file.evidence?.confidence;

          // Map verdict to SARIF rule and level
          let ruleId = 'swynx/dead-file';
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
                ? `File may be loaded dynamically (${Math.round((confidence?.score || 0.7) * 100)}% confidence)`
                : `File appears to be unreachable from any entry point (${Math.round((confidence?.score || 0.95) * 100)}% confidence)`,
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
          };

          // Include evidence in properties
          if (file.evidence) {
            result.properties = {
              verdict,
              evidence: file.evidence
            };
          }

          if (file.aiQualification && !file.aiQualification.error) {
            const ai = file.aiQualification;
            result.properties = { ...(result.properties || {}), aiQualification: ai };
            // Downgrade to note if AI thinks it's likely alive or false positive
            if (ai.category === 'false-positive' || ai.category === 'likely-alive') {
              result.level = 'note';
            } else if (ai.category === 'confirmed-dead' && ai.confidence >= 0.9) {
              result.level = 'error';
            }
          }

          return result;
        }),
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}
