// src/scanner/analysers/decay.mjs
// Decay scoring engine — scores live files on how likely they are to become dead code.
// Pure computation: takes file_history arrays in, scores come out.
//
// Weights tuned against 65 repos across 7 language ecosystems (Feb 2026).
// See results/decay-validation/_analysis.json for calibration data.

const DEFAULT_WEIGHTS = {
  velocity: 25,
  importDecline: 25,
  contributorWithdrawal: 12,
  staleness: 13,
  mtimeStaleness: 10,
  importFragility: 8,
  exportUsageRatio: 7
};

const DEFAULT_THRESHOLDS = {
  stalenessModerate: 180,  // days — below this, score 0 (most healthy files go untouched for months)
  stalenessHigh: 365,      // days — 50% weight
  stalenessCritical: 730,  // days — 85% weight; above = full weight (2 years)
  importDeclineMinPrev: 2, // minimum previous importer_count to consider
  velocityMinBaseline: 3   // minimum commits_365d to consider velocity meaningful
};

// ─── Source file filter ──────────────────────────────────────────────────────
// Only source code files should be scored for decay. Config, docs, assets, and
// metadata files are expected to be stable and produce false positives.

const SOURCE_EXTENSIONS = new Set([
  'js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs',
  'py', 'pyx', 'pyi',
  'go',
  'java', 'kt', 'kts', 'scala',
  'rb', 'erb',
  'rs',
  'php',
  'cs', 'fs', 'fsx',
  'c', 'h', 'cpp', 'hpp', 'cc', 'hh',
  'swift', 'm', 'mm',
  'dart',
  'ex', 'exs',
  'hs', 'lhs',
  'lua',
  'pl', 'pm',
  'r',
  'clj', 'cljs', 'cljc',
  'ml', 'mli',
  'jl',
  'zig',
  'nim',
  'erl', 'hrl',
  'groovy', 'gradle',
  'cr',
  'v',
  'sh', 'bash', 'zsh',
  'ps1',
  'cob', 'cbl',
  'f90', 'f95', 'f03',
  'vb',
  'svelte', 'vue',
  'sol', 'move'
]);

function isSourceFile(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  return SOURCE_EXTENSIONS.has(ext);
}

// ─── Signal sub-scorers ──────────────────────────────────────────────────────

/**
 * Velocity: compares recent commit rate (30d) to historical baseline (90d/3 or 365d/12).
 * Declining commit velocity signals a file losing attention.
 *
 * Tuning note: files with very low baseline (1-2 commits/year) are maintenance-level
 * and shouldn't trigger. We require ≥3 commits/year for a meaningful velocity signal.
 */
function computeVelocityScore(file, maxWeight = 25, thresholds = DEFAULT_THRESHOLDS) {
  const c30 = file.commits_30d || 0;
  const c90 = file.commits_90d || 0;
  const c365 = file.commits_365d || 0;

  // No historical commits or too few to establish a meaningful baseline
  const minBaseline = thresholds.velocityMinBaseline || 3;
  if (c365 < minBaseline) return { score: 0, detail: 'low activity' };

  const baseline = Math.max(c90 / 3, c365 / 12);
  if (baseline === 0) {
    // Had commits in the past year but all >90d ago, and none recently
    return { score: c30 === 0 ? maxWeight : 0, detail: c30 === 0 ? 'dormant' : 'active' };
  }

  const ratio = c30 / baseline;
  if (ratio >= 1) return { score: 0, detail: 'steady' };
  if (ratio >= 0.5) {
    // Mild ramp: 0.5→1 maps to maxWeight→0
    const score = maxWeight * (1 - ratio) * 0.6;
    return { score: Math.round(score * 10) / 10, detail: 'slowing' };
  }
  // Steep ramp: 0→0.5 maps to maxWeight→partial
  if (ratio > 0) {
    const score = maxWeight * (0.7 + 0.3 * (1 - ratio / 0.5));
    return { score: Math.round(score * 10) / 10, detail: 'declining' };
  }
  // ratio === 0: no recent commits but had baseline
  return { score: maxWeight, detail: 'dormant' };
}

/**
 * Import decline: scores loss of importers between scans.
 * This is the strongest signal — a file losing importers is concrete evidence of
 * the codebase moving away from it.
 */
function computeImportDeclineScore(current, previous, maxWeight = 25, thresholds = DEFAULT_THRESHOLDS) {
  if (!previous) return { score: 0, detail: 'no previous scan' };

  const prev = previous.importer_count ?? 0;
  const curr = current.importer_count ?? 0;

  if (prev < (thresholds.importDeclineMinPrev || 2)) {
    return { score: 0, detail: 'below noise threshold' };
  }

  const lost = prev - curr;
  if (lost <= 0) return { score: 0, detail: 'stable' };

  const ratio = lost / prev;
  const score = maxWeight * ratio;
  return {
    score: Math.round(score * 10) / 10,
    detail: `lost ${lost}/${prev} importers`
  };
}

/**
 * Contributor withdrawal: flags files where contributors are walking away
 * WHILE the file still has some recent activity.
 *
 * Tuning note: if the file has NO commits in 90d, contributor withdrawal is
 * redundant with velocity/staleness — everyone "withdrew" because the file
 * simply isn't being touched. This was causing 98% of files in large repos
 * to flag. Now we only score this when commits_90d > 0 (someone IS working
 * nearby, but the contributor pool is shrinking).
 */
function computeContributorWithdrawalScore(file, maxWeight = 12) {
  const all = file.contributors_all || 0;
  const recent = file.contributors_90d || 0;
  const c90 = file.commits_90d || 0;

  // Single contributor or no historical contributors — no withdrawal possible
  if (all <= 1) return { score: 0, detail: 'single contributor' };

  // File has zero commits in 90d — contributor signal subsumed by velocity/staleness
  if (c90 === 0) return { score: 0, detail: 'inactive file' };

  // File has recent activity but contributor pool is shrinking
  if (recent === 1 && all >= 4) {
    const score = maxWeight * 0.8;
    return { score: Math.round(score * 10) / 10, detail: '1 of ' + all + ' contributors remain' };
  }

  if (recent === 1 && all >= 2) {
    const score = maxWeight * 0.5;
    return { score: Math.round(score * 10) / 10, detail: '1 of ' + all + ' contributors remain' };
  }

  // Proportional when retention < 40%
  const retention = recent / all;
  if (retention < 0.4) {
    const score = maxWeight * (1 - retention / 0.4);
    return { score: Math.round(score * 10) / 10, detail: `${recent}/${all} contributors active` };
  }

  return { score: 0, detail: 'good retention' };
}

/**
 * Staleness: how long since the file was last touched.
 *
 * Tuning note: thresholds raised significantly after validation against 65 repos.
 * The original 90d moderate / 180d high / 365d critical was flagging 96% of files.
 * Most files in healthy codebases go 6-12 months untouched. Enterprise Java codebases
 * naturally have longer cycles than frontend repos.
 * New: 180d moderate / 365d high / 730d critical.
 * Also: null lastCommitDate → score 0 (no data ≠ stale).
 */
function computeStalenessScore(file, now, maxWeight = 13, thresholds = DEFAULT_THRESHOLDS) {
  const lastCommit = file.last_commit_date;
  // No commit date means we have no git data for this file — don't penalise
  if (!lastCommit) return { score: 0, detail: 'no commit date' };

  const lastDate = new Date(lastCommit);
  if (isNaN(lastDate.getTime())) return { score: 0, detail: 'invalid date' };

  const daysSince = (now - lastDate.getTime()) / (1000 * 60 * 60 * 24);

  const tMod = thresholds.stalenessModerate || 180;
  const tHigh = thresholds.stalenessHigh || 365;
  const tCrit = thresholds.stalenessCritical || 730;

  if (daysSince <= tMod) return { score: 0, detail: `${Math.round(daysSince)}d ago` };

  let pct;
  if (daysSince <= tHigh) {
    // Linear ramp 0→50% between tMod and tHigh
    pct = 0.5 * ((daysSince - tMod) / (tHigh - tMod));
  } else if (daysSince <= tCrit) {
    // Linear ramp 50→85% between tHigh and tCrit
    pct = 0.5 + 0.35 * ((daysSince - tHigh) / (tCrit - tHigh));
  } else {
    pct = 1;
  }

  const score = maxWeight * pct;
  return {
    score: Math.round(score * 10) / 10,
    detail: `${Math.round(daysSince)}d ago`
  };
}

/**
 * mtime Staleness: filesystem-based staleness signal — works from scan 1, no git needed.
 * Uses the same thresholds as git staleness but only scores when git staleness = 0
 * (avoids double-counting).
 */
function computeMtimeStalenessScore(file, gitStalenessScore, now, maxWeight = 10, thresholds = DEFAULT_THRESHOLDS) {
  // Defer to git staleness when available — no double-counting
  if (gitStalenessScore > 0) return { score: 0, detail: 'deferred to git' };

  const mtime = file.file_mtime;
  if (!mtime) return { score: 0, detail: 'no mtime' };

  const mtimeDate = new Date(mtime);
  if (isNaN(mtimeDate.getTime())) return { score: 0, detail: 'invalid mtime' };

  const daysSince = (now - mtimeDate.getTime()) / (1000 * 60 * 60 * 24);

  const tMod = thresholds.stalenessModerate || 180;
  const tHigh = thresholds.stalenessHigh || 365;
  const tCrit = thresholds.stalenessCritical || 730;

  if (daysSince <= tMod) return { score: 0, detail: `${Math.round(daysSince)}d ago` };

  let pct;
  if (daysSince <= tHigh) {
    pct = 0.5 * ((daysSince - tMod) / (tHigh - tMod));
  } else if (daysSince <= tCrit) {
    pct = 0.5 + 0.35 * ((daysSince - tHigh) / (tCrit - tHigh));
  } else {
    pct = 1;
  }

  const score = maxWeight * pct;
  return {
    score: Math.round(score * 10) / 10,
    detail: `mtime ${Math.round(daysSince)}d ago`
  };
}

/**
 * Import Fragility: files with only 1-2 importers are structurally fragile —
 * one import change away from dead.
 * 1 importer = full score, 2 importers = half score, 0 or 3+ = 0.
 * Zero importers excluded (likely entry points or config).
 */
function computeImportFragilityScore(file, maxWeight = 8) {
  const importers = file.importer_count ?? 0;

  if (importers === 1) return { score: maxWeight, detail: '1 importer' };
  if (importers === 2) return { score: Math.round(maxWeight * 0.5 * 10) / 10, detail: '2 importers' };
  return { score: 0, detail: importers === 0 ? 'entry point' : `${importers} importers` };
}

/**
 * Export Usage Ratio: scores files where most exports are dead — decaying in place
 * even if someone still edits the file.
 * Requires ≥3 total exports to avoid noise from small utility files.
 */
function computeExportUsageRatioScore(file, maxWeight = 7) {
  const total = file.export_total || 0;
  const dead = file.export_dead || 0;

  if (total < 3) return { score: 0, detail: total === 0 ? 'no exports' : `${total} exports (below threshold)` };
  if (dead === 0) return { score: 0, detail: 'all exports live' };

  const ratio = dead / total;
  const score = maxWeight * ratio;
  return {
    score: Math.round(score * 10) / 10,
    detail: `${dead}/${total} exports dead`
  };
}

// ─── Risk levels ─────────────────────────────────────────────────────────────

function getRiskLevel(score) {
  if (score >= 75) return 'high';
  if (score >= 50) return 'medium';
  if (score >= 25) return 'low';
  return 'none';
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Calculate decay scores for all live files.
 *
 * @param {Array} currentFileHistory — file_history rows for the current scan
 * @param {Array|null} previousFileHistory — file_history rows for the previous scan
 * @param {object} options — weights, thresholds, now timestamp
 * @returns {{ candidates: Array, summary: object }}
 */
export function calculateDecayScores(currentFileHistory, previousFileHistory, options = {}) {
  const now = options.now || Date.now();
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };

  // Index previous scan by file_path for O(1) lookup
  const prevMap = new Map();
  const hasPrevious = Array.isArray(previousFileHistory) && previousFileHistory.length > 0;
  if (hasPrevious) {
    for (const row of previousFileHistory) {
      prevMap.set(row.file_path, row);
    }
  }

  const candidates = [];
  let highRisk = 0;
  let mediumRisk = 0;
  let lowRisk = 0;
  let noRisk = 0;

  for (const file of currentFileHistory) {
    // Skip dead files — they're already flagged by dead code detection
    if (file.is_dead) continue;

    // Skip non-source files — config, docs, assets are expected to be stable
    if (!isSourceFile(file.file_path)) {
      noRisk++;
      continue;
    }

    const prev = prevMap.get(file.file_path) || null;

    const velocity = computeVelocityScore(file, weights.velocity, thresholds);
    const importDecline = computeImportDeclineScore(file, prev, weights.importDecline, thresholds);
    const contributorWithdrawal = computeContributorWithdrawalScore(file, weights.contributorWithdrawal);
    const staleness = computeStalenessScore(file, now, weights.staleness, thresholds);
    const mtimeStaleness = computeMtimeStalenessScore(file, staleness.score, now, weights.mtimeStaleness, thresholds);
    const importFragility = computeImportFragilityScore(file, weights.importFragility);
    const exportUsageRatio = computeExportUsageRatioScore(file, weights.exportUsageRatio);

    const decayScore = Math.round(
      (velocity.score + importDecline.score + contributorWithdrawal.score +
       staleness.score + mtimeStaleness.score + importFragility.score + exportUsageRatio.score) * 10
    ) / 10;

    const riskLevel = getRiskLevel(decayScore);

    if (riskLevel === 'none') {
      noRisk++;
      continue;
    }

    if (riskLevel === 'high') highRisk++;
    else if (riskLevel === 'medium') mediumRisk++;
    else lowRisk++;

    candidates.push({
      filePath: file.file_path,
      decayScore,
      riskLevel,
      signals: {
        velocity,
        importDecline,
        contributorWithdrawal,
        staleness,
        mtimeStaleness,
        importFragility,
        exportUsageRatio
      },
      commits30d: file.commits_30d || 0,
      commits90d: file.commits_90d || 0,
      commits365d: file.commits_365d || 0,
      importerCount: file.importer_count ?? 0,
      importerCountPrevious: prev ? (prev.importer_count ?? 0) : null,
      contributors90d: file.contributors_90d || 0,
      lastCommitDate: file.last_commit_date || null,
      fileSizeBytes: file.file_size_bytes || 0
    });
  }

  // Sort candidates by score descending
  candidates.sort((a, b) => b.decayScore - a.decayScore);

  return {
    candidates,
    summary: {
      total: highRisk + mediumRisk + lowRisk + noRisk,
      highRisk,
      mediumRisk,
      lowRisk,
      noRisk,
      hasPreviousScan: hasPrevious
    }
  };
}

export { isSourceFile };
export default calculateDecayScores;
