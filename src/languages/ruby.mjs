// src/languages/ruby.mjs
// Ruby parser with Rails, Sinatra, RSpec support

let languagePatterns = null;

export function initialize(patterns) {
  languagePatterns = patterns;
}

export function parse(filePath, content) {
  if (!content) return createEmptyResult(filePath);

  try {
    const imports = [];
    const exports = [];
    const classes = [];
    const modules = [];
    const functions = [];

    // Require statements
    const requirePatterns = [
      /require\s+['"]([^'"]+)['"]/g,
      /require_relative\s+['"]([^'"]+)['"]/g,
      /load\s+['"]([^'"]+)['"]/g,
      /autoload\s+:\w+,\s*['"]([^'"]+)['"]/g
    ];

    for (const pattern of requirePatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const type = pattern.source.includes('require_relative') ? 'require_relative' :
                     pattern.source.includes('autoload') ? 'autoload' :
                     pattern.source.includes('load') ? 'load' : 'require';
        imports.push({
          module: match[1],
          type,
          line: content.slice(0, match.index).split('\n').length
        });
      }
    }

    // Module declarations
    const modulePattern = /module\s+(\w+(?:::\w+)*)/g;
    let match;
    while ((match = modulePattern.exec(content)) !== null) {
      modules.push({
        name: match[1],
        line: content.slice(0, match.index).split('\n').length
      });
      exports.push({ name: match[1], type: 'module', line: content.slice(0, match.index).split('\n').length });
    }

    // Class declarations
    const classPattern = /class\s+(\w+(?:::\w+)*)(?:\s*<\s*([\w:]+))?\s*$/gm;
    while ((match = classPattern.exec(content)) !== null) {
      const classInfo = {
        name: match[1],
        type: 'class',
        extends: match[2] || null,
        line: content.slice(0, match.index).split('\n').length,
        exported: true
      };
      classes.push(classInfo);
      exports.push({ name: match[1], type: 'class', line: classInfo.line });
    }

    // Method definitions (def)
    const defPattern = /^\s*def\s+(self\.)?(\w+[?!=]?)/gm;
    while ((match = defPattern.exec(content)) !== null) {
      const methodName = match[2];
      const isClassMethod = !!match[1];
      const line = content.slice(0, match.index).split('\n').length;
      functions.push({
        name: methodName,
        type: isClassMethod ? 'class_method' : 'method',
        line,
        exported: !methodName.startsWith('_')
      });
    }

    // Detect framework patterns
    const isRails = content.includes('ApplicationController') ||
                    content.includes('ApplicationRecord') ||
                    content.includes('ActiveRecord::') ||
                    content.includes('ActionController::') ||
                    /class\s+\w+\s*<\s*ApplicationController/.test(content);

    const isRSpec = content.includes('RSpec.describe') ||
                    content.includes('describe ') && content.includes(' do') ||
                    /it\s+['"]/.test(content);

    const isSinatra = content.includes('Sinatra::') ||
                      /get\s+['"]\//.test(content) ||
                      /post\s+['"]\//.test(content);

    const isRake = /task\s+:\w+/.test(content) ||
                   /namespace\s+:\w+/.test(content);

    const isMigration = content.includes('ActiveRecord::Migration') ||
                        /def\s+(up|down|change)/.test(content);

    const isModel = classes.some(c => c.extends &&
      (c.extends.includes('ApplicationRecord') || c.extends.includes('ActiveRecord::Base')));

    const isController = classes.some(c => c.extends &&
      (c.extends.includes('ApplicationController') || c.extends.includes('ActionController')));

    return {
      imports,
      exports,
      classes,
      modules,
      functions,
      annotations: [],
      metadata: {
        parseMethod: 'ruby-regex',
        isRails,
        isRSpec,
        isSinatra,
        isRake,
        isMigration,
        isModel,
        isController,
        isTest: isRSpec || filePath.includes('_test.rb') || filePath.includes('_spec.rb')
      }
    };
  } catch (error) {
    return createEmptyResult(filePath, `Parse error: ${error.message}`);
  }
}

function createEmptyResult(filePath, error = null) {
  return {
    imports: [],
    exports: [],
    classes: [],
    modules: [],
    functions: [],
    annotations: [],
    metadata: { parseMethod: 'none', error }
  };
}

export default { parse, initialize };
