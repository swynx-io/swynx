// src/scanner/analysers/dependencies.mjs
// Full-depth dependency analysis with evidence-backed data

import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// Get directory for loading data files
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Bandwidth cost assumptions (documented for transparency)
const COST_ASSUMPTIONS = {
  monthlyPageViews: 10000,
  avgPagesPerSession: 3,
  cacheMissRate: 0.3,
  cdnCostPerGB: 0.085,
  co2PerGB: 0.2,
  compressionRatio: 0.3,
};

/**
 * Load package alternatives from JSON file
 */
function loadPackageAlternatives() {
  const paths = [
    join(__dirname, '../../data/package-alternatives.json'),
    join(process.cwd(), 'src/data/package-alternatives.json'),
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, 'utf-8'));
      } catch (e) {
        // Continue to next path
      }
    }
  }

  return {};
}

const PACKAGE_ALTERNATIVES = loadPackageAlternatives();

/**
 * Analyse project dependencies with deep data
 */
export async function analyseDependencies(projectPath) {
  const packageJsonPath = join(projectPath, 'package.json');
  const nodeModulesPath = join(projectPath, 'node_modules');

  if (!existsSync(packageJsonPath)) {
    return [];
  }

  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const deps = [];

    // Get actual sizes from node_modules
    const packageSizes = getPackageSizes(nodeModulesPath);

    // Get total node_modules size
    const nodeModulesSize = getTotalNodeModulesSize(nodeModulesPath);

    // Get dependency tree
    const depTree = getDependencyTree(projectPath);

    // Production dependencies
    for (const [name, version] of Object.entries(pkg.dependencies || {})) {
      const actualSize = packageSizes[name] || estimatePackageSize(name);
      const dependents = findDependents(name, depTree);
      const altInfo = PACKAGE_ALTERNATIVES[name];

      deps.push({
        name,
        version,
        declaredIn: 'dependencies',
        sizeBytes: actualSize,
        sizeFormatted: formatBytes(actualSize),
        percentOfNodeModules: nodeModulesSize > 0 ? ((actualSize / nodeModulesSize) * 100).toFixed(2) : '0.00',
        dependents,
        dependentCount: dependents.length,
        alternative: altInfo ? {
          package: altInfo.alternatives[0]?.name || 'native',
          savingsPercent: altInfo.alternatives[0]?.size
            ? Math.round((1 - altInfo.alternatives[0].size / actualSize) * 100)
            : 100,
          reason: altInfo.reason,
          potentialSavingsBytes: altInfo.alternatives[0]?.size
            ? actualSize - altInfo.alternatives[0].size
            : actualSize
        } : null
      });
    }

    // Dev dependencies
    for (const [name, version] of Object.entries(pkg.devDependencies || {})) {
      deps.push({
        name,
        version,
        declaredIn: 'devDependencies',
        sizeBytes: packageSizes[name] || 0,
        sizeFormatted: formatBytes(packageSizes[name] || 0)
      });
    }

    return deps;
  } catch (error) {
    return [];
  }
}

/**
 * Get actual package sizes from node_modules
 */
function getPackageSizes(nodeModulesPath) {
  const sizes = {};

  if (!existsSync(nodeModulesPath)) {
    return sizes;
  }

  try {
    const result = execSync(`du -sb ${nodeModulesPath}/*/ 2>/dev/null | head -200`, {
      encoding: 'utf-8',
      timeout: 15000
    });

    for (const line of result.split('\n')) {
      const [size, path] = line.split('\t');
      if (path) {
        const name = path.split('/').pop();
        sizes[name] = parseInt(size, 10) || 0;
      }
    }

    // Also get scoped packages
    try {
      const scopedResult = execSync(`du -sb ${nodeModulesPath}/@*/*/ 2>/dev/null | head -100`, {
        encoding: 'utf-8',
        timeout: 15000
      });

      for (const line of scopedResult.split('\n')) {
        const [size, path] = line.split('\t');
        if (path) {
          const parts = path.split('/');
          const name = parts.slice(-2).join('/').replace(/\/$/, '');
          if (name.startsWith('@')) {
            sizes[name] = parseInt(size, 10) || 0;
          }
        }
      }
    } catch (e) {
      // No scoped packages
    }
  } catch (e) {
    // Fallback: no sizes
  }

  return sizes;
}

/**
 * Get total node_modules size
 */
function getTotalNodeModulesSize(nodeModulesPath) {
  if (!existsSync(nodeModulesPath)) return 0;

  try {
    const result = execSync(`du -sb ${nodeModulesPath} 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 30000
    });
    return parseInt(result.split('\t')[0], 10) || 0;
  } catch (e) {
    return 0;
  }
}

/**
 * Get dependency tree using npm
 */
function getDependencyTree(projectPath) {
  try {
    const result = execSync('npm ls --json --depth=1 2>/dev/null', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 30000
    });
    return JSON.parse(result);
  } catch (e) {
    return { dependencies: {} };
  }
}

/**
 * Find what packages depend on a given package
 */
function findDependents(packageName, depTree) {
  const dependents = [];

  function searchDeps(deps, parent = 'root') {
    for (const [name, info] of Object.entries(deps || {})) {
      if (info.dependencies) {
        if (info.dependencies[packageName]) {
          dependents.push(name);
        }
        searchDeps(info.dependencies, name);
      }
    }
  }

  searchDeps(depTree.dependencies);
  return dependents;
}

/**
 * Estimate package size if not in node_modules
 */
function estimatePackageSize(name) {
  const knownSizes = {
    'moment': 290000,
    'lodash': 530000,
    'jquery': 87000,
    'react': 130000,
    'react-dom': 1200000,
    'vue': 230000,
    'angular': 500000,
    'express': 210000,
    'axios': 55000,
    'webpack': 2500000,
    'typescript': 45000000,
    'prettier': 8000000,
    'eslint': 3000000,
    'uuid': 12000,
    'chalk': 9000,
  };
  return knownSizes[name] || 50000;
}

/**
 * FULL-DEPTH: Collect search evidence with patterns and results
 */
function collectSearchEvidence(packageName, projectPath, jsAnalysis) {
  const filePatterns = ['**/*.js', '**/*.ts', '**/*.mjs', '**/*.jsx', '**/*.tsx'];
  const importPatterns = [
    `import.*from\\s+['"]${packageName}['"]`,
    `import\\s+['"]${packageName}['"]`,
    `require\\s*\\(\\s*['"]${packageName}['"]\\s*\\)`,
    `import.*from\\s+['"]${packageName}/`,
    `require\\s*\\(\\s*['"]${packageName}/`,
  ];

  const matches = [];

  // Search through all parsed JS files
  for (const file of jsAnalysis) {
    const filePath = file.file?.relativePath || file.file || '';
    const imports = file.imports || [];

    for (const imp of imports) {
      const source = imp.source || imp.from || '';
      if (source === packageName || source.startsWith(`${packageName}/`)) {
        matches.push({
          file: filePath,
          line: imp.line || 1,
          code: imp.raw || `import from '${source}'`,
          type: imp.type || 'import',
        });
      }
    }
  }

  // Also do grep-based search for thoroughness
  try {
    const grepResult = execSync(
      `grep -rn --include="*.js" --include="*.ts" --include="*.mjs" --include="*.jsx" --include="*.tsx" -E "(import.*['\"]${packageName}['\"]|require.*['\"]${packageName}['\"])" . 2>/dev/null | head -20`,
      { cwd: projectPath, encoding: 'utf-8', timeout: 10000 }
    );

    for (const line of grepResult.split('\n').filter(Boolean)) {
      const match = line.match(/^\.\/(.+):(\d+):(.+)$/);
      if (match) {
        const [, file, lineNum, code] = match;
        // Avoid duplicates
        if (!matches.find(m => m.file === file && m.line === parseInt(lineNum))) {
          matches.push({
            file,
            line: parseInt(lineNum),
            code: code.trim().substring(0, 100),
            type: 'grep',
          });
        }
      }
    }
  } catch (e) {
    // Grep found nothing or errored
  }

  return {
    filesSearched: jsAnalysis.length,
    filePatterns,
    importPatterns,
    matchesFound: matches.length,
    matches,
  };
}

/**
 * FULL-DEPTH: Get detailed git history
 */
function getGitHistory(packageName, projectPath) {
  const result = {
    available: true,
    everUsed: false,
    lastImport: null,
    addedIn: null,
  };

  try {
    // Check if ever used (any commit that added an import)
    const everUsedResult = execSync(
      `git log --all --oneline -S "${packageName}" -- "*.js" "*.ts" "*.mjs" "*.jsx" "*.tsx" 2>/dev/null | head -1`,
      { cwd: projectPath, encoding: 'utf-8', timeout: 10000 }
    );
    result.everUsed = everUsedResult.trim().length > 0;

    // Get last import commit with details
    const lastImportResult = execSync(
      `git log -1 --format='%H|%an|%ai|%s' -S "${packageName}" -- "*.js" "*.ts" "*.mjs" "*.jsx" "*.tsx" 2>/dev/null`,
      { cwd: projectPath, encoding: 'utf-8', timeout: 10000 }
    );

    if (lastImportResult.trim()) {
      const [hash, author, date, message] = lastImportResult.trim().split('|');

      // Try to find the specific file and line
      let file = null;
      let line = null;
      let code = null;

      try {
        const diffResult = execSync(
          `git show ${hash} --name-only --pretty=format: 2>/dev/null | grep -E "\\.(js|ts|mjs|jsx|tsx)$" | head -1`,
          { cwd: projectPath, encoding: 'utf-8', timeout: 5000 }
        );
        file = diffResult.trim() || null;

        if (file) {
          const grepResult = execSync(
            `git show ${hash}:${file} 2>/dev/null | grep -n "${packageName}" | head -1`,
            { cwd: projectPath, encoding: 'utf-8', timeout: 5000 }
          );
          const lineMatch = grepResult.match(/^(\d+):(.+)$/);
          if (lineMatch) {
            line = parseInt(lineMatch[1]);
            code = lineMatch[2].trim().substring(0, 100);
          }
        }
      } catch (e) {
        // Couldn't get details
      }

      // Check if this import was later removed
      let removedIn = null;
      try {
        const removeResult = execSync(
          `git log --oneline --diff-filter=D -S "${packageName}" -- "*.js" "*.ts" "*.mjs" 2>/dev/null | head -1`,
          { cwd: projectPath, encoding: 'utf-8', timeout: 5000 }
        );
        if (removeResult.trim()) {
          const [removeHash, ...removeMsg] = removeResult.trim().split(' ');
          removedIn = {
            commit: removeHash,
            message: removeMsg.join(' '),
          };
        }
      } catch (e) {
        // No removal found
      }

      result.lastImport = {
        file,
        line,
        code,
        commit: hash,
        author,
        date,
        message,
        removedIn,
      };
    }

    // Get when package was added to package.json
    const addedResult = execSync(
      `git log --reverse --oneline -S '"${packageName}"' -- package.json 2>/dev/null | head -1`,
      { cwd: projectPath, encoding: 'utf-8', timeout: 10000 }
    );

    if (addedResult.trim()) {
      const [addHash, ...addMsg] = addedResult.trim().split(' ');

      // Get full commit details
      try {
        const addDetails = execSync(
          `git log -1 --format='%an|%ai' ${addHash} 2>/dev/null`,
          { cwd: projectPath, encoding: 'utf-8', timeout: 5000 }
        );
        const [addAuthor, addDate] = addDetails.trim().split('|');

        result.addedIn = {
          commit: addHash,
          author: addAuthor,
          date: addDate,
          message: addMsg.join(' '),
        };
      } catch (e) {
        result.addedIn = {
          commit: addHash,
          message: addMsg.join(' '),
        };
      }
    }
  } catch (e) {
    result.available = false;
    result.error = e.message;
  }

  return result;
}

/**
 * FULL-DEPTH: Get size analysis including bundle status
 */
function getSizeAnalysis(dep, projectPath, nodeModulesPath) {
  const packageBytes = dep.sizeBytes || 0;

  // Get total node_modules size
  let nodeModulesBytes = 0;
  try {
    const result = execSync(`du -sb ${nodeModulesPath} 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 30000
    });
    nodeModulesBytes = parseInt(result.split('\t')[0], 10) || 0;
  } catch (e) {
    nodeModulesBytes = 0;
  }

  const percentOfNodeModules = nodeModulesBytes > 0
    ? ((packageBytes / nodeModulesBytes) * 100).toFixed(2)
    : '0.00';

  // Check if in bundle
  let inBundle = false;
  let bundleContribution = null;

  const buildDirs = ['dist', 'build', '.next', 'out'];
  for (const dir of buildDirs) {
    const buildPath = join(projectPath, dir);
    if (existsSync(buildPath)) {
      try {
        const grepResult = execSync(
          `grep -r "${dep.name}" ${buildPath} 2>/dev/null | head -1`,
          { encoding: 'utf-8', timeout: 10000 }
        );
        if (grepResult.trim()) {
          inBundle = true;

          // Estimate bundle contribution
          try {
            const bundleSize = execSync(`du -sb ${buildPath} 2>/dev/null`, {
              encoding: 'utf-8', timeout: 10000
            });
            const bundleSizeBytes = parseInt(bundleSize.split('\t')[0], 10) || 0;

            if (bundleSizeBytes > 0) {
              // Assume package contributes proportionally after tree-shaking (30% estimate)
              const estimatedContribution = packageBytes * 0.3;
              bundleContribution = {
                estimatedBytes: Math.round(estimatedContribution),
                percentOfBundle: ((estimatedContribution / bundleSizeBytes) * 100).toFixed(2),
              };
            }
          } catch (e) {
            // Couldn't get bundle size
          }
        }
        break;
      } catch (e) {
        // Not in this build dir
      }
    }
  }

  return {
    packageBytes,
    packageFormatted: formatBytes(packageBytes),
    nodeModulesBytes,
    percentOfNodeModules,
    inBundle,
    bundleContribution,
  };
}

/**
 * FULL-DEPTH: Calculate bandwidth and CO2 costs
 */
function calculateCost(sizeBytes) {
  const compressedBytes = Math.floor(sizeBytes * COST_ASSUMPTIONS.compressionRatio);
  const transfersPerMonth = COST_ASSUMPTIONS.monthlyPageViews * COST_ASSUMPTIONS.cacheMissRate;
  const monthlyBandwidthBytes = compressedBytes * transfersPerMonth;
  const monthlyBandwidthGB = monthlyBandwidthBytes / (1024 * 1024 * 1024);

  return {
    monthlyBandwidthGB: parseFloat(monthlyBandwidthGB.toFixed(6)),
    monthlyBandwidthCost: parseFloat((monthlyBandwidthGB * COST_ASSUMPTIONS.cdnCostPerGB).toFixed(4)),
    annualBandwidthCost: parseFloat((monthlyBandwidthGB * COST_ASSUMPTIONS.cdnCostPerGB * 12).toFixed(2)),
    co2PerMonthKg: parseFloat((monthlyBandwidthGB * COST_ASSUMPTIONS.co2PerGB).toFixed(6)),
    co2PerYearKg: parseFloat((monthlyBandwidthGB * COST_ASSUMPTIONS.co2PerGB * 12).toFixed(4)),
    assumptions: {
      monthlyPageViews: COST_ASSUMPTIONS.monthlyPageViews,
      cacheMissRate: COST_ASSUMPTIONS.cacheMissRate,
      compressionRatio: COST_ASSUMPTIONS.compressionRatio,
      cdnCostPerGB: COST_ASSUMPTIONS.cdnCostPerGB,
      co2PerGB: COST_ASSUMPTIONS.co2PerGB,
    },
  };
}

/**
 * FULL-DEPTH: Get alternatives from data file
 */
function getAlternatives(packageName, currentSize) {
  const altInfo = PACKAGE_ALTERNATIVES[packageName];
  if (!altInfo) return [];

  return altInfo.alternatives.map(alt => ({
    name: alt.name,
    size: alt.size,
    sizeFormatted: formatBytes(alt.size),
    savingsPercent: currentSize > 0 && alt.size !== null
      ? Math.round((1 - alt.size / currentSize) * 100)
      : 100,
    savingsBytes: currentSize - (alt.size || 0),
    weeklyDownloads: alt.weeklyDownloads,
    description: alt.description,
  }));
}

/**
 * FULL-DEPTH: Check dependents from package-lock.json
 */
function checkDependents(packageName, projectPath) {
  const result = {
    inProject: [],
    wouldBreak: [],
  };

  // Check package-lock.json for dependency tree
  const lockPath = join(projectPath, 'package-lock.json');
  if (existsSync(lockPath)) {
    try {
      const lockFile = JSON.parse(readFileSync(lockPath, 'utf-8'));
      const packages = lockFile.packages || {};
      const rootPkg = JSON.parse(readFileSync(join(projectPath, 'package.json'), 'utf-8'));

      for (const [pkgPath, pkgInfo] of Object.entries(packages)) {
        if (pkgPath === '' || pkgPath === `node_modules/${packageName}`) continue;

        const deps = {
          ...pkgInfo.dependencies,
          ...pkgInfo.peerDependencies,
        };

        if (deps && deps[packageName]) {
          const depName = pkgPath.replace('node_modules/', '').replace(/^.*node_modules\//, '');
          if (depName && !result.inProject.includes(depName)) {
            result.inProject.push(depName);

            // Check if this dependent is in root dependencies (would break the project)
            if (rootPkg.dependencies?.[depName] || rootPkg.devDependencies?.[depName]) {
              result.wouldBreak.push({
                package: depName,
                requires: packageName,
                version: deps[packageName],
              });
            }
          }
        }
      }
    } catch (e) {
      // Couldn't parse package-lock
    }
  }

  // Also use npm ls output
  try {
    const lsResult = execSync(`npm ls ${packageName} --json 2>/dev/null`, {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 15000
    });
    const lsData = JSON.parse(lsResult);

    function findDependentsNpm(deps, path = '') {
      for (const [name, info] of Object.entries(deps || {})) {
        if (info.dependencies?.[packageName]) {
          if (!result.inProject.includes(name)) {
            result.inProject.push(name);
          }
        }
        if (info.dependencies) {
          findDependentsNpm(info.dependencies, `${path}/${name}`);
        }
      }
    }

    findDependentsNpm(lsData.dependencies);
  } catch (e) {
    // npm ls failed
  }

  return result;
}

/**
 * FULL-DEPTH: Build human-readable reasoning - analyst style
 */
function buildReasoning(packageName, evidence, gitHistory, size, cost, alternatives, dependents) {
  const parts = [];

  // 1. Search evidence - punchy opener
  parts.push(`Searched ${evidence.filesSearched} files.`);
  parts.push(evidence.matchesFound === 0 ? 'Zero imports found.' : `${evidence.matchesFound} stale/commented references.`);

  // 2. Git history - human-readable time
  if (gitHistory.everUsed && gitHistory.lastImport) {
    const timeAgo = getTimeAgo(gitHistory.lastImport.date);
    const file = gitHistory.lastImport.file || 'unknown file';
    const author = gitHistory.lastImport.author || 'unknown';
    const commitMsg = gitHistory.lastImport.removedIn?.message || gitHistory.lastImport.message || '';

    let historyPart = `Last imported in ${file}`;
    if (gitHistory.lastImport.removedIn) {
      historyPart += `, removed by ${author} ${timeAgo}`;
      if (commitMsg) historyPart += ` (commit: '${commitMsg.slice(0, 40)}')`;
    } else {
      historyPart += ` by ${author} ${timeAgo}`;
    }
    parts.push(historyPart + '.');
  } else if (!gitHistory.everUsed) {
    parts.push('Never imported in git history.');
  }

  // 3. Cost impact - GBP and CO₂ with proper symbol
  const annualGBP = cost.annualBandwidthCost * 0.79; // USD to GBP
  if (annualGBP > 0.01 || cost.co2PerYearKg > 0.01) {
    parts.push(`Costs £${annualGBP.toFixed(2)}/year, ${cost.co2PerYearKg.toFixed(2)}kg CO₂/year.`);
  }

  // 4. Alternative - concise recommendation
  if (alternatives.length > 0) {
    const best = alternatives[0];
    parts.push(`Consider replacing with ${best.name} (${best.savingsPercent}% smaller).`);
  }

  // 5. Bundle warning if applicable
  if (size.inBundle) {
    parts.push('WARNING: Found in build output.');
  }

  // 6. Safety verdict
  if (dependents.wouldBreak.length === 0) {
    parts.push('No dependents. Safe to remove.');
  } else {
    const depList = dependents.wouldBreak.slice(0, 3).map(d => d.package).join(', ');
    const more = dependents.wouldBreak.length > 3 ? '...' : '';
    parts.push(`CAUTION: ${dependents.wouldBreak.length} packages depend on this (${depList}${more}). Verify before removing.`);
  }

  return parts.join(' ');
}

/**
 * Convert date to human-readable "X ago" format
 */
function getTimeAgo(dateStr) {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 1) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) > 1 ? 's' : ''} ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} month${Math.floor(diffDays / 30) > 1 ? 's' : ''} ago`;
    return `${Math.floor(diffDays / 365)} year${Math.floor(diffDays / 365) > 1 ? 's' : ''} ago`;
  } catch {
    return 'unknown time ago';
  }
}

/**
 * FULL-DEPTH: Enrich unused dependency with complete analysis
 */
export function enrichUnusedDependency(dep, projectPath, importGraph, jsAnalysis) {
  const nodeModulesPath = join(projectPath, 'node_modules');

  // Collect all evidence
  const evidence = collectSearchEvidence(dep.name, projectPath, jsAnalysis);
  const gitHistory = getGitHistory(dep.name, projectPath);
  const size = getSizeAnalysis(dep, projectPath, nodeModulesPath);
  const cost = calculateCost(dep.sizeBytes || 0);
  const alternatives = getAlternatives(dep.name, dep.sizeBytes);
  const dependents = checkDependents(dep.name, projectPath);

  // Determine confidence
  let confidence = 'high';
  if (evidence.matchesFound > 0) confidence = 'medium';
  if (size.inBundle) confidence = 'low';
  if (dependents.wouldBreak.length > 0) confidence = 'low';

  // Determine if safe to remove
  const safeToRemove = evidence.matchesFound === 0 &&
    !size.inBundle &&
    dependents.wouldBreak.length === 0;

  // Build reasoning
  const reasoning = buildReasoning(
    dep.name, evidence, gitHistory, size, cost, alternatives, dependents
  );

  return {
    ...dep,
    evidence,
    gitHistory,
    size,
    cost,
    alternatives,
    dependents,
    recommendation: {
      action: safeToRemove ? 'remove' : 'investigate',
      confidence,
      safeToRemove,
      command: `npm uninstall ${dep.name}`,
      reasoning,
    },
  };
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

/**
 * Check for heavy dependencies with alternatives
 */
export function checkHeavyDependencies(dependencies) {
  const heavy = [];

  for (const dep of dependencies) {
    const altInfo = PACKAGE_ALTERNATIVES[dep.name];
    if (altInfo || dep.sizeBytes > 500000) {
      const alternatives = altInfo ? altInfo.alternatives : [];
      heavy.push({
        name: dep.name,
        version: dep.version,
        sizeBytes: dep.sizeBytes,
        sizeFormatted: formatBytes(dep.sizeBytes),
        alternative: alternatives[0]?.name || null,
        reason: altInfo?.reason || 'Package is over 500KB',
        potentialSavingsPercent: alternatives[0]?.size !== undefined
          ? Math.round((1 - alternatives[0].size / dep.sizeBytes) * 100)
          : 50,
        alternatives: alternatives.map(a => ({
          name: a.name,
          size: a.size,
          sizeFormatted: formatBytes(a.size),
          description: a.description,
        })),
      });
    }
  }

  return heavy;
}

export default { analyseDependencies, checkHeavyDependencies, enrichUnusedDependency };
