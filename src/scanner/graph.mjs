// src/scanner/graph.mjs
// Dependency graph builder and reachability analysis
// Core algorithm extracted from swynx's buildReachableFiles (820 lines)

import { readFileSync } from 'fs';
import { join, dirname, basename } from 'path';
import { extractPathAliases, matchGlobPattern } from './resolver.mjs';
import { getFrameworkFilter } from '../knowledge/loader.mjs';

/**
 * Build the set of files reachable from entry points via import chains
 * This is the core dead code detection algorithm
 */
export function buildReachableFiles(entryPointFiles, parsedFiles, projectPath = null) {
  const reachable = new Set();
  const visited = new Set();

  const { aliases: pathAliases, packageAliases, packageBaseUrls, workspacePackages, goModulePath, javaSourceRoots } = extractPathAliases(projectPath);

  // Build Java FQN map
  const javaFqnMap = new Map();
  const javaPackageDirMap = new Map();

  // Detect source roots from file paths
  const detectedSourceRoots = new Set(javaSourceRoots);
  const srcRootPatterns = ['src/main/java/', 'src/test/java/', 'src/main/kotlin/', 'src/test/kotlin/'];

  // Build lookup maps
  const fileImports = new Map();
  const fileExports = new Map();
  const fileMetadata = new Map();

  for (const file of parsedFiles) {
    const filePath = file.relativePath;
    fileImports.set(filePath, file.imports || []);
    fileExports.set(filePath, file.exports || []);
    if (file.metadata) fileMetadata.set(filePath, file.metadata);

    // Detect Java source roots
    if (filePath.endsWith('.java') || filePath.endsWith('.kt')) {
      for (const pattern of srcRootPatterns) {
        const idx = filePath.indexOf(pattern);
        if (idx >= 0) {
          detectedSourceRoots.add(filePath.substring(0, idx + pattern.length - 1));
          break;
        }
      }
    }
  }

  const allJavaSourceRoots = [...detectedSourceRoots];

  // Build Java FQN → file path mapping
  for (const file of parsedFiles) {
    const filePath = file.relativePath;
    if (!filePath.endsWith('.java') && !filePath.endsWith('.kt')) continue;

    const packageName = file.metadata?.packageName;
    if (packageName) {
      const fileName = basename(filePath).replace(/\.(java|kt)$/, '');
      const fqn = packageName + '.' + fileName;
      javaFqnMap.set(fqn, filePath);

      const packageDir = packageName.replace(/\./g, '/');
      if (!javaPackageDirMap.has(packageDir)) javaPackageDirMap.set(packageDir, []);
      javaPackageDirMap.get(packageDir).push(filePath);
    } else {
      for (const root of allJavaSourceRoots) {
        if (filePath.startsWith(root + '/')) {
          const relativePart = filePath.slice(root.length + 1);
          const fqn = relativePart.replace(/\.(java|kt)$/, '').replace(/\//g, '.');
          javaFqnMap.set(fqn, filePath);

          const packageDir = dirname(relativePart);
          if (packageDir !== '.') {
            if (!javaPackageDirMap.has(packageDir)) javaPackageDirMap.set(packageDir, []);
            javaPackageDirMap.get(packageDir).push(filePath);
          }
          break;
        }
      }
    }
  }

  // Extension-less lookup map
  const filePathsNoExt = new Map();
  for (const file of parsedFiles) {
    const filePath = file.relativePath;
    const noExt = filePath.replace(/\.([mc]?[jt]s|[jt]sx|vue|py|pyi|java|kt|kts|go)$/, '');
    if (!filePathsNoExt.has(noExt)) filePathsNoExt.set(noExt, []);
    filePathsNoExt.get(noExt).push(filePath);
  }

  // All file paths
  const allFilePaths = [...fileImports.keys()];

  // Mark glob-imported files as reachable
  for (const file of parsedFiles) {
    const fileDir = dirname(file.relativePath || '');
    for (const imp of file.imports || []) {
      if (imp.isGlob && imp.module) {
        for (const match of matchGlobPattern(imp.module, allFilePaths, fileDir)) {
          reachable.add(match);
        }
      }
    }
  }

  // Detect directory-scanning auto-loaders
  if (projectPath) {
    const dirScanPatterns = /requireDirectory\s*[(<]|readdirSync\s*\(\s*__dirname|glob\.sync\s*\(|globSync\s*\(/;
    for (const file of parsedFiles) {
      const filePath = file.relativePath;
      const fileName = basename(filePath).replace(/\.[^.]+$/, '');
      if (fileName !== 'index') continue;
      const fileDir = dirname(filePath);
      try {
        const source = readFileSync(join(projectPath, filePath), 'utf-8');
        if (dirScanPatterns.test(source)) {
          for (const otherFile of allFilePaths) {
            if (otherFile !== filePath && dirname(otherFile) === fileDir) {
              reachable.add(otherFile);
            }
          }
        }
      } catch {}
    }
  }

  // Get aliases for a specific file (monorepo-aware)
  function getAliasesForFile(filePath) {
    let bestMatch = null;
    let bestMatchLen = 0;
    for (const [pkgDir, pkgAliases] of packageAliases) {
      if (filePath.startsWith(pkgDir + '/') && pkgDir.length > bestMatchLen) {
        bestMatch = pkgAliases;
        bestMatchLen = pkgDir.length;
      }
    }
    if (bestMatch) {
      const merged = new Map(pathAliases);
      for (const [alias, target] of bestMatch) merged.set(alias, target);
      return merged;
    }
    return pathAliases;
  }

  function getBaseUrlForFile(filePath) {
    let bestMatch = null;
    let bestMatchLen = -1;
    for (const [pkgDir, baseUrlPrefix] of packageBaseUrls) {
      if (pkgDir === '' && bestMatchLen < 0) { bestMatch = baseUrlPrefix; bestMatchLen = 0; }
      else if (filePath.startsWith(pkgDir + '/') && pkgDir.length > bestMatchLen) {
        bestMatch = baseUrlPrefix;
        bestMatchLen = pkgDir.length;
      }
    }
    return bestMatch;
  }

  function findMatchingFiles(modulePath, extensions) {
    const matches = [];
    for (const ext of extensions) {
      const fullPath = modulePath + ext;
      if (fileImports.has(fullPath)) matches.push(fullPath);
      for (const prefix of ['', 'src/', 'app/', 'lib/']) {
        const prefixed = prefix + fullPath;
        if (fileImports.has(prefixed) && !matches.includes(prefixed)) matches.push(prefixed);
      }
      for (const fp of fileImports.keys()) {
        if (fp.endsWith('/' + fullPath) && !matches.includes(fp)) matches.push(fp);
      }
    }
    return matches;
  }

  // Resolve an import to file path(s)
  function resolveImport(fromFile, importPath) {
    const fromDir = dirname(fromFile);
    let resolved = importPath;

    const isPython = fromFile.endsWith('.py') || fromFile.endsWith('.pyi');
    const isJava = fromFile.endsWith('.java');
    const isKotlin = fromFile.endsWith('.kt') || fromFile.endsWith('.kts');
    const isGo = fromFile.endsWith('.go');

    // Python absolute imports
    if (isPython && importPath.includes('.') && !importPath.startsWith('.')) {
      const modulePath = importPath.replace(/\./g, '/');
      let matches = findMatchingFiles(modulePath, ['.py', '/__init__.py']);
      if (matches.length === 0) {
        const parts = importPath.split('.');
        for (let i = parts.length - 1; i >= 1; i--) {
          const shorter = parts.slice(0, i).join('/');
          const shorter_matches = findMatchingFiles(shorter, ['.py', '/__init__.py']);
          if (shorter_matches.length > 0) { matches = shorter_matches; break; }
        }
      }
      return matches;
    }

    // Python relative imports
    if (isPython && /^\.+/.test(importPath)) {
      const dotMatch = importPath.match(/^(\.+)(.*)/);
      const dots = dotMatch[1].length;
      const moduleName = dotMatch[2];
      let baseDir = fromDir;
      for (let i = 1; i < dots; i++) baseDir = dirname(baseDir);
      if (moduleName) {
        const modulePath = moduleName.replace(/\./g, '/');
        return findMatchingFiles(baseDir ? join(baseDir, modulePath) : modulePath, ['.py', '/__init__.py']);
      }
      return findMatchingFiles(baseDir, ['/__init__.py']);
    }

    // Java/Kotlin imports - 6-strategy pipeline
    if ((isJava || isKotlin) && importPath.includes('.') && !importPath.startsWith('.')) {
      const ext = isJava ? '.java' : '.kt';

      // Strategy 1: FQN map lookup (BEFORE framework filter!)
      if (javaFqnMap.has(importPath)) return [javaFqnMap.get(importPath)];

      // Strategy 2: Wildcard imports
      if (importPath.endsWith('.*')) {
        const pkgFqn = importPath.slice(0, -2);
        const pkgDir = pkgFqn.replace(/\./g, '/');
        const pkgFiles = javaPackageDirMap.get(pkgDir);
        if (pkgFiles?.length > 0) return [...pkgFiles];
        const matches = [];
        for (const fp of fileImports.keys()) {
          if ((fp.endsWith('.java') || fp.endsWith('.kt')) && fp.includes(pkgDir + '/')) {
            const after = fp.slice(fp.indexOf(pkgDir + '/') + pkgDir.length + 1);
            if (!after.includes('/')) matches.push(fp);
          }
        }
        return matches;
      }

      // Strategy 3: Static imports
      const parts = importPath.split('.');
      if (parts.length > 2) {
        const classCandidate = parts.slice(0, -1).join('.');
        if (javaFqnMap.has(classCandidate)) return [javaFqnMap.get(classCandidate)];
      }

      // Strategy 4: Framework filter (skip known external packages)
      const frameworkPrefixes = getFrameworkFilter('java') || [
        'java.', 'javax.', 'jakarta.', 'org.springframework.', 'io.quarkus.',
        'org.hibernate.', 'org.apache.', 'com.google.', 'org.junit.', 'org.mockito.',
        'org.slf4j.', 'org.eclipse.', 'com.fasterxml.', 'io.netty.', 'kotlin.', 'android.'
      ];
      if (frameworkPrefixes.some(pkg => importPath.startsWith(pkg))) return [];

      // Strategy 5: Source root path resolution
      const packagePath = importPath.replace(/\./g, '/');
      const matches = [];
      for (const root of allJavaSourceRoots) {
        const candidate = root + '/' + packagePath + ext;
        if (fileImports.has(candidate)) matches.push(candidate);
      }
      if (matches.length > 0) return matches;

      // Strategy 6: Class name fallback
      const className = parts[parts.length - 1];
      if (className && className[0] === className[0].toUpperCase()) {
        const deadPattern = /(^|\/)(dead[-_]?|deprecated[-_]?|legacy[-_]?|old[-_]?|unused[-_]?)/i;
        for (const fp of fileImports.keys()) {
          if ((fp.endsWith('/' + className + ext) || fp.endsWith(className + ext)) && !deadPattern.test(fp)) {
            if (!matches.includes(fp)) matches.push(fp);
          }
        }
      }
      return matches;
    }

    // Go imports
    if (isGo && !importPath.startsWith('.') && !importPath.startsWith('/')) {
      const deadGoPattern = /(^|\/)(dead[-_]?|deprecated[-_]?|legacy[-_]?|old[-_]?|unused[-_]?)[^/]*\.go$/i;
      const matches = [];

      // Strategy 1: Module-path-aware
      if (goModulePath && importPath.startsWith(goModulePath)) {
        let localPath = importPath.slice(goModulePath.length);
        if (localPath.startsWith('/')) localPath = localPath.slice(1);
        const pkgDir = localPath ? localPath + '/' : '';
        for (const fp of fileImports.keys()) {
          if (!fp.endsWith('.go') || fp.endsWith('_test.go')) continue;
          if (fp.startsWith(pkgDir) || (!localPath && !fp.includes('/'))) {
            const after = localPath ? fp.slice(pkgDir.length) : fp;
            if (!after.includes('/') && !deadGoPattern.test(fp)) matches.push(fp);
          }
        }
        if (matches.length > 0) return matches;
      }

      // Strategy 2: Directory segment matching
      const segments = importPath.split('/');
      for (let i = 0; i < segments.length; i++) {
        const candidateDir = segments.slice(i).join('/') + '/';
        for (const fp of fileImports.keys()) {
          if (!fp.endsWith('.go') || fp.endsWith('_test.go')) continue;
          if (fp.startsWith(candidateDir)) {
            const after = fp.slice(candidateDir.length);
            if (!after.includes('/') && !deadGoPattern.test(fp) && !matches.includes(fp)) matches.push(fp);
          }
        }
        if (matches.length > 0) return matches;
      }

      return matches;
    }

    // JS/TS import resolution
    if (importPath === '.') {
      resolved = fromDir || '.';
    } else if (importPath.startsWith('./')) {
      resolved = fromDir ? join(fromDir, importPath.slice(2)) : importPath.slice(2);
    } else if (importPath.startsWith('../')) {
      resolved = join(fromDir, importPath);
    } else if (importPath.startsWith('/')) {
      resolved = importPath.slice(1);
    } else {
      // Path alias resolution
      const fileAliases = getAliasesForFile(fromFile);
      let aliasResolved = false;
      const sorted = [...fileAliases.entries()].sort((a, b) => b[0].length - a[0].length);

      for (const [alias, target] of sorted) {
        if (importPath.startsWith(alias)) {
          resolved = importPath.replace(alias, target).replace(/\/+/g, '/');
          aliasResolved = true;
          break;
        }
        const aliasNoSlash = alias.replace(/\/$/, '');
        if (importPath === aliasNoSlash || importPath.startsWith(aliasNoSlash + '/')) {
          resolved = importPath.replace(aliasNoSlash, target.replace(/\/$/, '')).replace(/\/+/g, '/');
          aliasResolved = true;
          break;
        }
      }

      if (!aliasResolved) {
        // Workspace package resolution
        let packageName = importPath;
        let subPath = '';
        if (importPath.startsWith('@')) {
          const parts = importPath.split('/');
          if (parts.length >= 2) { packageName = parts.slice(0, 2).join('/'); subPath = parts.slice(2).join('/'); }
        } else {
          const slashIndex = importPath.indexOf('/');
          if (slashIndex > 0) { packageName = importPath.slice(0, slashIndex); subPath = importPath.slice(slashIndex + 1); }
        }

        const workspacePkg = workspacePackages.get(packageName);
        if (workspacePkg) {
          if (subPath) {
            const exportRaw = workspacePkg.exportsMap?.get(subPath);
            if (exportRaw) {
              // Try multiple resolution strategies for export targets
              const candidates = [
                `${workspacePkg.dir}/${exportRaw.replace(/^dist\//, 'src/')}`,
                `${workspacePkg.dir}/${exportRaw.replace(/^dist\//, '')}`,
                `${workspacePkg.dir}/${exportRaw}`,
              ];
              resolved = candidates[0]; // default
              for (const c of candidates) {
                const cNoExt = c.replace(/\.([mc]?[jt]s|[jt]sx|vue)$/, '');
                if (fileImports.has(c) || filePathsNoExt.has(cNoExt)) {
                  resolved = c;
                  break;
                }
              }
            } else {
              const withSrc = `${workspacePkg.dir}/src/${subPath}`;
              const withoutSrc = `${workspacePkg.dir}/${subPath}`;
              const wsNoExt = withoutSrc.replace(/\.([mc]?[jt]s|[jt]sx|vue)$/, '');
              if (fileImports.has(withoutSrc) || filePathsNoExt.has(wsNoExt)) resolved = withoutSrc;
              else resolved = withSrc;
            }
          } else {
            resolved = `${workspacePkg.dir}/${workspacePkg.entryPoint}`;
            // If the resolved entry doesn't match any file, try scanning the package's src/ for the real entry
            const entryNoExt = resolved.replace(/\.([mc]?[jt]s|[jt]sx|vue)$/, '');
            if (!fileImports.has(resolved) && !filePathsNoExt.has(entryNoExt)) {
              // Try common fallback entries
              const fallbacks = ['src/main', 'src/app', 'src/server', 'index', 'src/entry'];
              for (const fb of fallbacks) {
                const fbPath = `${workspacePkg.dir}/${fb}`;
                if (filePathsNoExt.has(fbPath)) {
                  resolved = fbPath;
                  break;
                }
              }
            }
          }
        } else {
          // Try baseUrl
          const baseUrlPrefix = getBaseUrlForFile(fromFile);
          if (baseUrlPrefix) {
            const baseUrlResolved = baseUrlPrefix + importPath;
            const noExt = baseUrlResolved.replace(/\.([mc]?[jt]s|[jt]sx)$/, '');
            if (fileImports.has(baseUrlResolved) || filePathsNoExt.has(noExt) ||
                filePathsNoExt.has(baseUrlResolved + '/index') || filePathsNoExt.has(noExt + '/index')) {
              resolved = baseUrlResolved;
            } else {
              return []; // External package
            }
          } else {
            return []; // External package
          }
        }
      }
    }

    // Normalize and find matching files
    resolved = resolved.replace(/\\/g, '/').replace(/^\.\//, '');
    const resolvedNoExt = resolved.replace(/\.([mc]?[jt]s|[jt]sx|vue|py|pyi|java|kt|kts|go)$/, '');

    const matches = [];
    if (fileImports.has(resolved)) matches.push(resolved);

    const variants = filePathsNoExt.get(resolvedNoExt) || [];
    for (const v of variants) { if (!matches.includes(v)) matches.push(v); }

    const indexVariants = filePathsNoExt.get(resolved + '/index') || [];
    for (const v of indexVariants) { if (!matches.includes(v)) matches.push(v); }

    // Platform-specific extensions (React Native)
    for (const suffix of ['.ios', '.android', '.web', '.native']) {
      const pv = filePathsNoExt.get(resolvedNoExt + suffix) || [];
      for (const v of pv) { if (!matches.includes(v)) matches.push(v); }
    }

    return matches;
  }

  // BFS walk
  function walkFromFile(startFile) {
    const queue = [startFile];

    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      reachable.add(current);

      // Go same-package linking
      if (current.endsWith('.go')) {
        const currentDir = dirname(current);
        const deadGoPattern = /(^|\/)(dead[-_]?|deprecated[-_]?|legacy[-_]?|old[-_]?|unused[-_]?)[^/]*\.go$/i;
        for (const fp of fileImports.keys()) {
          if (fp.endsWith('.go') && !visited.has(fp) && !deadGoPattern.test(fp) && dirname(fp) === currentDir) {
            queue.push(fp);
          }
        }
      }

      // Java/Kotlin same-package linking
      if (current.endsWith('.java') || current.endsWith('.kt')) {
        const currentPkg = fileMetadata.get(current)?.packageName;
        if (currentPkg) {
          const pkgDir = currentPkg.replace(/\./g, '/');
          const pkgFiles = javaPackageDirMap.get(pkgDir);
          if (pkgFiles) {
            const deadPattern = /(^|\/)(dead[-_]?|deprecated[-_]?|legacy[-_]?|old[-_]?|unused[-_]?)[^/]*\.(java|kt)$|\/(Dead|Deprecated|Legacy|Old|Unused)[A-Z][^/]*\.(java|kt)$/;
            for (const fp of pkgFiles) {
              if (!visited.has(fp) && !deadPattern.test(fp)) queue.push(fp);
            }
          }
        }
      }

      // Follow imports
      const isPythonFile = current.endsWith('.py') || current.endsWith('.pyi');
      for (const imp of fileImports.get(current) || []) {
        const module = imp.module || imp;
        if (typeof module !== 'string') continue;

        for (const resolved of resolveImport(current, module)) {
          if (!visited.has(resolved)) queue.push(resolved);
        }

        // Python submodule check
        if (isPythonFile && imp.name && imp.type === 'from') {
          const subPath = module + '.' + imp.name;
          for (const resolved of resolveImport(current, subPath)) {
            if (!visited.has(resolved)) queue.push(resolved);
          }
        }
      }

      // Follow re-export chains (barrel files)
      for (const exp of fileExports.get(current) || []) {
        if (exp.sourceModule) {
          for (const source of resolveImport(current, exp.sourceModule)) {
            if (!visited.has(source)) queue.push(source);
          }
        }
      }
    }
  }

  // Walk from each entry point
  for (const ep of entryPointFiles) {
    for (const file of parsedFiles) {
      const fp = file.relativePath;
      const fpNoExt = fp.replace(/\.([mc]?[jt]s|[jt]sx|vue|py|pyi|java|kt|kts|go)$/, '');
      const epNoExt = ep.replace(/\.([mc]?[jt]s|[jt]sx|vue|py|pyi|java|kt|kts|go)$/, '');

      if (fp === ep || fpNoExt === epNoExt ||
          fp.endsWith('/' + ep) || fp.endsWith('/' + epNoExt + '.tsx') ||
          fp.endsWith('/' + epNoExt + '.ts') || fp.endsWith('/' + epNoExt + '.js')) {
        walkFromFile(fp);
      }
    }
  }

  // Walk files from glob/directory scanning
  for (const file of reachable) {
    if (!visited.has(file)) walkFromFile(file);
  }

  return reachable;
}
