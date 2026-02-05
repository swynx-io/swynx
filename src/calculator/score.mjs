// src/calculator/score.mjs
// Health score calculation

/**
 * Calculate overall health score (0-100)
 */
export function calculateHealthScore(scanResult) {
  let score = 100;
  const deductions = [];

  // Waste deduction (up to 30 points)
  const wastePercent = scanResult.summary?.wastePercent || 0;
  if (wastePercent > 0) {
    const wasteDeduction = Math.min(30, wastePercent * 1.5);
    score -= wasteDeduction;
    deductions.push({ reason: 'Code waste', points: wasteDeduction });
  }

  // Security deduction (up to 40 points)
  const security = scanResult.security || {};
  if (security.summary?.critical > 0) {
    const deduction = Math.min(40, security.summary.critical * 20);
    score -= deduction;
    deductions.push({ reason: 'Critical vulnerabilities', points: deduction });
  } else if (security.summary?.high > 0) {
    const deduction = Math.min(20, security.summary.high * 10);
    score -= deduction;
    deductions.push({ reason: 'High vulnerabilities', points: deduction });
  }

  // License deduction (up to 15 points)
  const licenses = scanResult.licenses || {};
  if (licenses.summary?.restrictive > 0) {
    const deduction = Math.min(15, licenses.summary.restrictive * 10);
    score -= deduction;
    deductions.push({ reason: 'Restrictive licenses', points: deduction });
  } else if (licenses.summary?.copyleft > 0) {
    const deduction = Math.min(5, licenses.summary.copyleft * 2);
    score -= deduction;
    deductions.push({ reason: 'Copyleft licenses', points: deduction });
  }

  // Outdated deps deduction (up to 15 points)
  const outdatedRaw = scanResult.outdated || {};
  // Handle both old array format and new object format
  const outdatedPackages = Array.isArray(outdatedRaw) ? outdatedRaw : (outdatedRaw.packages || []);
  const majorUpdates = outdatedRaw.summary?.major || outdatedPackages.filter(d => d.updateType === 'major').length;
  const minorUpdates = outdatedRaw.summary?.minor || outdatedPackages.filter(d => d.updateType === 'minor').length;

  if (majorUpdates > 0) {
    const deduction = Math.min(10, majorUpdates * 2);
    score -= deduction;
    deductions.push({ reason: 'Major version updates available', points: deduction });
  }
  if (minorUpdates > 0) {
    const deduction = Math.min(5, minorUpdates);
    score -= deduction;
    deductions.push({ reason: 'Minor updates available', points: deduction });
  }

  // Ensure score is between 0 and 100
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Determine grade
  let grade;
  if (score >= 90) grade = 'A';
  else if (score >= 80) grade = 'B';
  else if (score >= 70) grade = 'C';
  else if (score >= 60) grade = 'D';
  else grade = 'F';

  return {
    score,
    grade,
    deductions,
    maxScore: 100
  };
}

export default { calculateHealthScore };
