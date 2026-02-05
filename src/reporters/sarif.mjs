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
                  text: 'Dead file detected',
                },
                fullDescription: {
                  text: 'The file is not reachable from any entry point and appears to be dead code.',
                },
                defaultConfiguration: {
                  level: 'warning',
                },
                helpUri: 'https://github.com/swynx/swynx#dead-file',
              },
            ],
          },
        },
        results: deadFiles.map((file) => {
          const result = {
            ruleId: 'swynx/dead-file',
            level: 'warning',
            message: {
              text: 'File appears to be dead code (not reachable from any entry point)',
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

          if (file.aiQualification && !file.aiQualification.error) {
            const ai = file.aiQualification;
            result.properties = { aiQualification: ai };
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
