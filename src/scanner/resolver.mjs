// src/scanner/resolver.mjs
// Import resolution coordinator
// This is the core of dead code detection - resolving import paths to actual files
// Extracted from the 820-line buildReachableFiles in peer-audit/deadcode.mjs

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, basename, normalize, relative } from 'path';
import { globSync } from 'glob';
import { getLanguagePatterns, getFrameworkFilter } from '../knowledge/loader.mjs';

/**
 * Extract path aliases from tsconfig.json, vite.config, and workspace configs
 */
export function extractPathAliases(projectPath) {
  const aliases = new Map();
  const packageAliases = new Map();
  const packageBaseUrls = new Map();
  const workspacePackages = new Map();
  let goModulePath = null;
  const javaSourceRoots = [];

  if (!projectPath) return { aliases, packageAliases, packageBaseUrls, workspacePackages, goModulePath, javaSourceRoots };

  // Discover workspace directories from monorepo configs
  const workspaceDirs = new Set();

  const resolveWorkspaceGlob = (pattern) => {
    const segments = pattern.split('/');
    const walk = (currentPath, segIndex) => {
      if (segIndex >= segments.length) {
        if (currentPath) workspaceDirs.add(currentPath);
        return;
      }
      const seg = segments[segIndex];
      if (seg === '**') {
        if (currentPath) workspaceDirs.add(currentPath);
        const addRecursive = (dir, depth) => {
          if (depth > 5) return;
          const fullPath = join(projectPath, dir);
          try {
            for (const entry of readdirSync(fullPath, { withFileTypes: true })) {
              if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                const subDir = `${dir}/${entry.name}`;
                workspaceDirs.add(subDir);
                addRecursive(subDir, depth + 1);
              }
            }
          } catch {}
        };
        addRecursive(currentPath || '.', 0);
      } else if (seg === '*') {
        const dirToRead = currentPath || '.';
        try {
          for (const entry of readdirSync(join(projectPath, dirToRead), { withFileTypes: true })) {
            if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
              const subDir = currentPath ? `${currentPath}/${entry.name}` : entry.name;
              walk(subDir, segIndex + 1);
            }
          }
        } catch {}
      } else {
        const next = currentPath ? `${currentPath}/${seg}` : seg;
        walk(next, segIndex + 1);
      }
    };
    walk('', 0);
  };

  // 1. npm/yarn workspaces
  const rootPkgPath = join(projectPath, 'package.json');
  if (existsSync(rootPkgPath)) {
    try {
      const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8'));
      const workspaces = rootPkg.workspaces;
      if (workspaces) {
        const patterns = Array.isArray(workspaces) ? workspaces : (workspaces.packages || []);
        for (const pattern of patterns) {
          if (pattern.includes('*')) resolveWorkspaceGlob(pattern);
          else { const dir = pattern.replace(/\/$/, ''); if (dir) workspaceDirs.add(dir); }
        }
      }
    } catch {}
  }

  // 2. pnpm workspaces
  const pnpmPath = join(projectPath, 'pnpm-workspace.yaml');
  if (existsSync(pnpmPath)) {
    try {
      const content = readFileSync(pnpmPath, 'utf-8');
      const packagesMatch = content.match(/packages:\s*\n((?:\s+-\s+[^\n]+\n?)*)/);
      if (packagesMatch) {
        for (const line of packagesMatch[1].split('\n')) {
          const match = line.match(/^\s*-\s+['"]?([^'"#\n]+)['"]?/);
          if (match) {
            const pattern = match[1].trim();
            if (pattern.includes('*')) resolveWorkspaceGlob(pattern);
            else { const dir = pattern.replace(/\/$/, ''); if (dir) workspaceDirs.add(dir); }
          }
        }
      }
    } catch {}
  }

  // 3. Lerna
  const lernaPath = join(projectPath, 'lerna.json');
  if (existsSync(lernaPath)) {
    try {
      const lerna = JSON.parse(readFileSync(lernaPath, 'utf-8'));
      for (const pattern of lerna.packages || ['packages/*']) {
        if (pattern.includes('*')) resolveWorkspaceGlob(pattern);
        else { const dir = pattern.replace(/\/$/, ''); if (dir) workspaceDirs.add(dir); }
      }
    } catch {}
  }

  // 4. Nx
  if (existsSync(join(projectPath, 'nx.json')) || existsSync(join(projectPath, 'workspace.json'))) {
    for (const dir of ['apps', 'libs', 'packages', 'tools', 'services']) {
      resolveWorkspaceGlob(dir + '/*');
    }
  }

  // 5. Common dirs fallback
  for (const dir of ['packages', 'libs', 'apps', 'modules', 'services', 'tools', 'plugins', 'extensions']) {
    resolveWorkspaceGlob(dir + '/*');
  }

  // 6. Auto-detect sub-projects with their own tsconfig/package.json
  try {
    for (const entry of readdirSync(projectPath, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        if (workspaceDirs.has(entry.name)) continue;
        const hasTsconfig = existsSync(join(projectPath, entry.name, 'tsconfig.json'));
        const hasPkgJson = existsSync(join(projectPath, entry.name, 'package.json'));
        if (hasTsconfig || hasPkgJson) workspaceDirs.add(entry.name);
      }
    }
  } catch {}

  // Build config dirs list
  const configDirs = [{ dir: '', prefix: '' }];
  for (const wsDir of workspaceDirs) {
    configDirs.push({ dir: wsDir, prefix: `${wsDir}/` });
  }

  // Build workspace package map
  for (const wsDir of workspaceDirs) {
    const pkgJsonPath = join(projectPath, wsDir, 'package.json');
    if (existsSync(pkgJsonPath)) {
      try {
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
        if (pkgJson.name) {
          let entryPoint = 'src/index';

          // Check source field first (explicit source entry)
          if (pkgJson.source) {
            entryPoint = pkgJson.source.replace(/^\.\//, '').replace(/\.(c|m)?[jt]sx?$/, '');
          } else if (pkgJson.exports?.['.']) {
            const exportPath = resolveExportTarget(pkgJson.exports['.']);
            if (exportPath) {
              entryPoint = exportPath.replace(/^\.\//, '').replace(/^dist\//, 'src/')
                .replace(/\.(c|m)?js$/, '').replace(/\.d\.(c|m)?ts$/, '');
            }
          } else if (pkgJson.module) {
            entryPoint = pkgJson.module.replace(/^\.\//, '').replace(/^dist\//, 'src/').replace(/\.(c|m)?js$/, '');
          } else if (pkgJson.main) {
            entryPoint = pkgJson.main.replace(/^\.\//, '').replace(/^dist\//, 'src/').replace(/\.(c|m)?js$/, '');
          }

          // Verify the entry point exists; if not, try build script source or fallback
          const srcExts = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx'];
          const entryNoExt = entryPoint.replace(/\.[mc]?[jt]sx?$/, '');
          const entryExists = srcExts.some(ext => existsSync(join(projectPath, wsDir, entryNoExt + ext))) ||
                              existsSync(join(projectPath, wsDir, entryPoint));

          if (!entryExists) {
            // Try to find the actual source from build script (e.g., "cm-buildhelper src/html.ts")
            const buildScript = pkgJson.scripts?.build || '';
            const srcMatch = buildScript.match(/\b(src\/[^\s"']+\.[mc]?[jt]sx?)\b/);
            if (srcMatch) {
              entryPoint = srcMatch[1].replace(/\.[mc]?[jt]sx?$/, '');
            } else {
              // Fallback: map dist entry to src with extension trying
              const buildDirRe = /^(lib|dist|build|out)\//;
              for (const field of [pkgJson.main, pkgJson.module].filter(Boolean)) {
                const fieldPath = field.replace(/^\.\//, '');
                if (buildDirRe.test(fieldPath)) {
                  const stem = fieldPath.replace(buildDirRe, 'src/').replace(/\.[mc]?[jt]sx?$/, '');
                  for (const ext of srcExts) {
                    if (existsSync(join(projectPath, wsDir, stem + ext))) {
                      entryPoint = stem;
                      break;
                    }
                  }
                }
              }
            }
          }

          const exportsMap = new Map();
          if (pkgJson.exports && typeof pkgJson.exports === 'object') {
            for (const [subpath, target] of Object.entries(pkgJson.exports)) {
              if (subpath === '.' || subpath === './package.json') continue;
              const exportTarget = resolveExportTarget(target);
              if (typeof exportTarget === 'string') {
                const rawPath = exportTarget.replace(/^\.\//, '').replace(/\.(c|m)?js$/, '').replace(/\.d\.(c|m)?ts$/, '');
                exportsMap.set(subpath.replace(/^\.\//, ''), rawPath);
              }
            }
          }

          // Collect bin files for workspace packages
          const binFiles = [];
          if (pkgJson.bin) {
            const binPaths = typeof pkgJson.bin === 'string' ? [pkgJson.bin] : Object.values(pkgJson.bin);
            for (const bp of binPaths) {
              if (bp) binFiles.push(bp.replace(/^\.\//, ''));
            }
          }

          workspacePackages.set(pkgJson.name, { dir: wsDir, entryPoint, exportsMap, binFiles });
        }
      } catch {}
    }
  }

  // Read tsconfig.json paths from each config dir
  for (const { dir, prefix } of configDirs) {
    const configDir = dir ? join(projectPath, dir) : projectPath;
    if (dir && !existsSync(configDir)) continue;

    const dirAliases = new Map();
    const tsconfigFiles = ['tsconfig.json', 'tsconfig.base.json', 'tsconfig.app.json', 'jsconfig.json'];

    for (const tsconfigFile of tsconfigFiles) {
      const tsconfigPath = join(configDir, tsconfigFile);
      if (!existsSync(tsconfigPath)) continue;

      try {
        const { resolvedPaths, baseUrl } = readTsconfigWithExtends(tsconfigPath, projectPath);
        for (const [aliasPrefix, targetPath] of resolvedPaths) {
          dirAliases.set(aliasPrefix, targetPath);
          if (!aliases.has(aliasPrefix)) aliases.set(aliasPrefix, targetPath);
        }
        if (baseUrl) {
          const baseUrlPrefix = baseUrl === '.' ? prefix : prefix + baseUrl.replace(/^\.\//, '').replace(/\/$/, '') + '/';
          packageBaseUrls.set(dir || '', baseUrlPrefix);
        }
      } catch {}
    }

    // Vite aliases
    for (const viteFile of ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs']) {
      const vitePath = join(configDir, viteFile);
      if (!existsSync(vitePath)) continue;
      try {
        const content = readFileSync(vitePath, 'utf-8');
        const aliasPatterns = [
          /['"](@[^'"]*)['"]\s*:\s*(?:path\.resolve\s*\([^)]*,\s*)?['"]\.?\/?(src[^'"]*)['"]/g,
          /['"](@\/?)['"].*?['"]\.?\/?([^'"]+)['"]/g
        ];
        for (const pattern of aliasPatterns) {
          let match;
          while ((match = pattern.exec(content)) !== null) {
            let alias = match[1];
            let target = match[2];
            if (!alias.endsWith('/')) alias += '/';
            target = prefix + target.replace(/^\.\//, '').replace(/\/$/, '') + '/';
            if (!dirAliases.has(alias)) dirAliases.set(alias, target);
            if (!aliases.has(alias)) aliases.set(alias, target);
          }
        }
      } catch {}
    }

    if (dirAliases.size > 0 && dir) packageAliases.set(dir, dirAliases);
  }

  // Default aliases
  if (aliases.size === 0) {
    if (existsSync(join(projectPath, 'client', 'src'))) aliases.set('@/', 'client/src/');
    else if (existsSync(join(projectPath, 'src'))) aliases.set('@/', 'src/');
  }

  // Docusaurus @site alias
  const docusaurusFiles = ['docusaurus.config.js', 'docusaurus.config.ts', 'docusaurus.config.mjs'];
  for (const { dir } of configDirs) {
    const configDir = dir ? join(projectPath, dir) : projectPath;
    if (docusaurusFiles.some(f => existsSync(join(configDir, f)))) {
      const prefix = dir ? dir + '/' : '';
      if (dir) {
        if (!packageAliases.has(dir)) packageAliases.set(dir, new Map());
        packageAliases.get(dir).set('@site/', prefix);
      } else {
        aliases.set('@site/', '');
      }
    }
  }

  // Go module path
  const goModPath = join(projectPath, 'go.mod');
  if (existsSync(goModPath)) {
    try {
      const goModContent = readFileSync(goModPath, 'utf8');
      const moduleMatch = goModContent.match(/^module\s+(\S+)/m);
      if (moduleMatch) goModulePath = moduleMatch[1];
    } catch {}
  }

  // Java source roots
  const javaSourceRootCandidates = ['src/main/java', 'src/test/java', 'src/main/kotlin', 'src/test/kotlin'];
  const checkJavaDir = (baseDir, prefix) => {
    for (const candidate of javaSourceRootCandidates) {
      try {
        if (statSync(join(baseDir, candidate)).isDirectory()) {
          javaSourceRoots.push(prefix ? prefix + '/' + candidate : candidate);
        }
      } catch {}
    }
  };
  checkJavaDir(projectPath, '');
  try {
    for (const entry of readdirSync(projectPath, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      checkJavaDir(join(projectPath, entry.name), entry.name);
      try {
        for (const sub of readdirSync(join(projectPath, entry.name), { withFileTypes: true })) {
          if (!sub.isDirectory() || sub.name.startsWith('.')) continue;
          checkJavaDir(join(projectPath, entry.name, sub.name), entry.name + '/' + sub.name);
          try {
            for (const sub2 of readdirSync(join(projectPath, entry.name, sub.name), { withFileTypes: true })) {
              if (!sub2.isDirectory() || sub2.name.startsWith('.')) continue;
              checkJavaDir(join(projectPath, entry.name, sub.name, sub2.name),
                entry.name + '/' + sub.name + '/' + sub2.name);
            }
          } catch {}
        }
      } catch {}
    }
  } catch {}

  return { aliases, packageAliases, packageBaseUrls, workspacePackages, goModulePath, javaSourceRoots };
}

function resolveExportTarget(target) {
  if (typeof target === 'string') return target;
  if (typeof target !== 'object' || target === null) return null;
  for (const key of ['code', 'source', 'import', 'require', 'module', 'default']) {
    const val = target[key];
    if (typeof val === 'string') return val;
    if (typeof val === 'object' && val !== null) {
      const resolved = resolveExportTarget(val);
      if (resolved) return resolved;
    }
  }
  for (const [key, val] of Object.entries(target)) {
    if (key === 'types') continue;
    const resolved = resolveExportTarget(val);
    if (resolved) return resolved;
  }
  return null;
}

function readTsconfigWithExtends(tsconfigPath, projectPath, visited = new Set()) {
  if (visited.has(tsconfigPath) || !existsSync(tsconfigPath)) {
    return { resolvedPaths: new Map(), rawPaths: {}, baseUrl: '.' };
  }
  visited.add(tsconfigPath);

  try {
    const content = readFileSync(tsconfigPath, 'utf-8');
    const stringPlaceholders = [];
    const withPlaceholders = content.replace(/"(?:[^"\\]|\\.)*"/g, (match) => {
      stringPlaceholders.push(match);
      return `"__STRING_${stringPlaceholders.length - 1}__"`;
    });
    const withoutComments = withPlaceholders.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
    const cleaned = withoutComments.replace(/"__STRING_(\d+)__"/g, (_, idx) => stringPlaceholders[parseInt(idx)]);
    const tsconfig = JSON.parse(cleaned);

    const tsconfigDir = dirname(tsconfigPath);
    let relDir = relative(projectPath, tsconfigDir).replace(/\\/g, '/');
    const tsconfigPrefix = relDir ? relDir + '/' : '';

    let inheritedResolvedPaths = new Map();

    if (tsconfig.extends) {
      const extendsArray = Array.isArray(tsconfig.extends) ? tsconfig.extends : [tsconfig.extends];
      for (const extendsValue of extendsArray) {
        if (typeof extendsValue !== 'string') continue;
        let extendsPath;
        if (extendsValue.startsWith('.')) {
          extendsPath = join(dirname(tsconfigPath), extendsValue);
          if (!extendsPath.endsWith('.json')) extendsPath += '.json';
        } else if (extendsValue.startsWith('@') || !extendsValue.includes('/')) {
          const nmPath = join(projectPath, 'node_modules', extendsValue);
          if (existsSync(nmPath)) {
            extendsPath = existsSync(join(nmPath, 'tsconfig.json')) ? join(nmPath, 'tsconfig.json') : nmPath;
          }
        } else {
          extendsPath = join(dirname(tsconfigPath), extendsValue);
          if (!extendsPath.endsWith('.json')) extendsPath += '.json';
        }
        if (extendsPath && existsSync(extendsPath)) {
          const inherited = readTsconfigWithExtends(extendsPath, projectPath, visited);
          for (const [alias, target] of inherited.resolvedPaths) {
            inheritedResolvedPaths.set(alias, target);
          }
        }
      }
    }

    const currentPaths = tsconfig.compilerOptions?.paths || {};
    const currentBaseUrl = tsconfig.compilerOptions?.baseUrl;

    for (const [alias, targets] of Object.entries(currentPaths)) {
      if (targets && targets.length > 0) {
        const aliasPrefix = alias.replace(/\*$/, '');
        let targetPath = targets[0].replace(/\*$/, '').replace(/^\.\//, '');
        if (currentBaseUrl && currentBaseUrl !== '.') {
          targetPath = join(currentBaseUrl.replace(/^\.\//, ''), targetPath);
        }
        targetPath = tsconfigPrefix + targetPath;
        if (targetPath.includes('..')) targetPath = normalize(targetPath).replace(/\\/g, '/');
        const isDirectoryAlias = alias.endsWith('*') || targets[0].endsWith('*');
        if (isDirectoryAlias && !targetPath.endsWith('/')) targetPath += '/';
        inheritedResolvedPaths.set(aliasPrefix, targetPath);
      }
    }

    return { resolvedPaths: inheritedResolvedPaths, baseUrl: currentBaseUrl || '.' };
  } catch {
    return { resolvedPaths: new Map(), baseUrl: '.' };
  }
}

/**
 * Convert a glob pattern to a regex and match against file paths
 */
export function matchGlobPattern(pattern, filePaths, baseDir = '') {
  let resolved = pattern;
  if (resolved.startsWith('./') || resolved.startsWith('../')) {
    if (baseDir) {
      const parts = baseDir.split('/');
      let rel = resolved;
      while (rel.startsWith('../')) { parts.pop(); rel = rel.slice(3); }
      if (rel.startsWith('./')) rel = rel.slice(2);
      resolved = parts.length > 0 ? parts.join('/') + '/' + rel : rel;
    } else {
      resolved = resolved.replace(/^\.\//, '');
    }
  }

  let regexStr = resolved
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<GLOBSTAR>>>/g, '.*')
    .replace(/\?/g, '.')
    .replace(/\{([^}]+)\}/g, (_, content) => {
      const parts = content.split(',').map(p => p.trim());
      return `(?:${parts.join('|')})`;
    });

  try {
    const regex = new RegExp(regexStr);
    return filePaths.filter(fp => regex.test(fp));
  } catch {
    return [];
  }
}
