// src/calculator/cost.mjs
// Developer-time cost calculations for dead code impact

import { DEFAULT_COSTS, getCurrencySymbol } from '../config/defaults.mjs';

/**
 * Swynx Cost Methodology v2.0
 *
 * Calculates the developer-time cost of dead code in a codebase.
 * Dead code costs teams money through:
 * - Onboarding: New devs reading/understanding code that doesn't matter
 * - Maintenance: Time wasted updating, reviewing, and debugging dead paths
 * - Cleanup: The actual cost to remove the dead code
 *
 * All calculations show their formulas so users can verify and adjust assumptions.
 */

// ============================================
// COST FACTORS (documented constants)
// ============================================

const COST_FACTORS = {
  DEVELOPER_HOUR: {
    description: 'Average developer hourly rate (salary + benefits + overhead)',
    unit: 'currency/hour',
    defaultValue: 75,
    source: 'UK developer average (Glassdoor 2025)'
  },
  // Developer time estimates for cleanup work
  TIME_TO_REMOVE_DEAD_FILE: 5,    // minutes per file
  TIME_TO_REMOVE_DEAD_EXPORT: 2,  // minutes per export
  TIME_TO_REMOVE_UNUSED_DEP: 10,  // minutes per dependency
  TIME_TO_OPTIMIZE_ASSET: 15      // minutes per asset
};

const BYTES_TO_MB = 1024 ** 2;

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return '0 B';
  const BYTES_TO_GB = 1024 ** 3;
  if (bytes < 1024) return bytes + ' B';
  if (bytes < BYTES_TO_MB) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < BYTES_TO_GB) return (bytes / BYTES_TO_MB).toFixed(2) + ' MB';
  return (bytes / BYTES_TO_GB).toFixed(4) + ' GB';
}

/**
 * Format currency amount
 */
function formatCurrency(amount, symbol = '£') {
  if (amount < 0.01) return `${symbol}0`;
  if (amount < 1) return `${symbol}${amount.toFixed(2)}`;
  if (amount < 100) return `${symbol}${amount.toFixed(0)}`;
  if (amount < 10000) return `${symbol}${amount.toLocaleString('en', { maximumFractionDigits: 0 })}`;
  return `${symbol}${(amount / 1000).toFixed(1)}k`;
}

/**
 * Calculate costs for a scan result
 *
 * @param {Object} scanResult - The scan result object
 * @param {Object} config - Configuration with costs settings
 * @returns {Object} Detailed cost breakdown with formulas
 */
export function calculateCosts(scanResult, config = {}) {
  const costs = config.costs || {};

  // Extract configuration with defaults
  const {
    developerHourlyRate = DEFAULT_COSTS.developerHourlyRate,
    teamSize = DEFAULT_COSTS.teamSize,
    newHiresPerYear = DEFAULT_COSTS.newHiresPerYear,
    onboardingHoursWasted = DEFAULT_COSTS.onboardingHoursWasted,
    maintenanceOverheadPercent = DEFAULT_COSTS.maintenanceOverheadPercent,
    currency = DEFAULT_COSTS.currency,
    currencySymbol = getCurrencySymbol(currency)
  } = costs;

  // Extract scan data
  const summary = scanResult.summary || {};
  const details = scanResult.details || {};
  const deadCode = details.deadCode || {};
  const unusedDeps = details.unusedDeps || [];
  const wastePercent = summary.wastePercent || 0;

  const fullyDeadFiles = deadCode.fullyDeadFiles?.length || 0;
  const partiallyDeadFiles = deadCode.partiallyDeadFiles?.length || 0;
  const deadExports = deadCode.summary?.totalDeadExports || 0;
  const unusedDepsCount = unusedDeps.length;
  const totalDeadFiles = fullyDeadFiles + partiallyDeadFiles;

  // ============================================
  // 1. ONBOARDING COST
  // New devs waste time reading dead code
  // ============================================
  const onboardingCostPerHire = onboardingHoursWasted * developerHourlyRate;
  const onboardingCostAnnual = onboardingCostPerHire * newHiresPerYear;

  // ============================================
  // 2. MAINTENANCE OVERHEAD
  // Existing team wastes X% of time on dead code
  // (reviewing PRs that touch it, debugging dead paths,
  // updating dead code during refactors, slower CI)
  // ============================================
  const annualDevHoursPerPerson = 52 * 40; // ~2080 hrs/year
  const totalTeamHoursPerYear = teamSize * annualDevHoursPerPerson;
  // Scale overhead by actual waste percentage (if codebase is 5% dead, overhead is half of 10% setting)
  const effectiveOverheadPercent = (maintenanceOverheadPercent / 100) * Math.min(wastePercent / 10, 1);
  const maintenanceHoursWasted = totalTeamHoursPerYear * effectiveOverheadPercent;
  const maintenanceCostAnnual = maintenanceHoursWasted * developerHourlyRate;

  // ============================================
  // 3. CLEANUP COST (one-time to fix it)
  // ============================================
  const cleanupMinutes =
    (fullyDeadFiles * COST_FACTORS.TIME_TO_REMOVE_DEAD_FILE) +
    (deadExports * COST_FACTORS.TIME_TO_REMOVE_DEAD_EXPORT) +
    (unusedDepsCount * COST_FACTORS.TIME_TO_REMOVE_UNUSED_DEP);

  const cleanupHours = cleanupMinutes / 60;
  const cleanupCost = cleanupHours * developerHourlyRate;

  // ============================================
  // TOTALS
  // ============================================
  const annualCost = onboardingCostAnnual + maintenanceCostAnnual;
  const monthlyCost = annualCost / 12;

  // ROI: how many months until cleanup pays for itself
  const roiMonths = monthlyCost > 0 ? cleanupCost / monthlyCost : null;

  // ============================================
  // FORMULAS (transparent calculations)
  // ============================================
  const formulas = {
    onboarding: {
      formula: `${newHiresPerYear} new hires × ${onboardingHoursWasted} hrs wasted × ${currencySymbol}${developerHourlyRate}/hr`,
      breakdown: [
        `New hires per year: ${newHiresPerYear}`,
        `Hours each new dev wastes on dead code: ${onboardingHoursWasted}`,
        `Developer hourly rate: ${currencySymbol}${developerHourlyRate}`,
        `Cost per hire: ${formatCurrency(onboardingCostPerHire, currencySymbol)}`,
        `Annual onboarding cost: ${formatCurrency(onboardingCostAnnual, currencySymbol)}`
      ],
      result: onboardingCostAnnual,
      resultFormatted: formatCurrency(onboardingCostAnnual, currencySymbol)
    },

    maintenance: {
      formula: `${teamSize} devs × ${annualDevHoursPerPerson} hrs/yr × ${(effectiveOverheadPercent * 100).toFixed(1)}% overhead × ${currencySymbol}${developerHourlyRate}/hr`,
      breakdown: [
        `Team size: ${teamSize} developers`,
        `Annual dev hours per person: ${annualDevHoursPerPerson.toLocaleString()}`,
        `Maintenance overhead: ${maintenanceOverheadPercent}% (scaled to ${(effectiveOverheadPercent * 100).toFixed(1)}% for ${wastePercent.toFixed(1)}% waste)`,
        `Hours wasted annually: ${maintenanceHoursWasted.toFixed(0)}`,
        `Annual maintenance cost: ${formatCurrency(maintenanceCostAnnual, currencySymbol)}`
      ],
      result: maintenanceCostAnnual,
      resultFormatted: formatCurrency(maintenanceCostAnnual, currencySymbol)
    },

    cleanup: {
      formula: `(${fullyDeadFiles} files × ${COST_FACTORS.TIME_TO_REMOVE_DEAD_FILE}min) + (${deadExports} exports × ${COST_FACTORS.TIME_TO_REMOVE_DEAD_EXPORT}min) + (${unusedDepsCount} deps × ${COST_FACTORS.TIME_TO_REMOVE_UNUSED_DEP}min)`,
      breakdown: [
        `Dead files to remove: ${fullyDeadFiles} × ${COST_FACTORS.TIME_TO_REMOVE_DEAD_FILE} min = ${fullyDeadFiles * COST_FACTORS.TIME_TO_REMOVE_DEAD_FILE} min`,
        `Dead exports to remove: ${deadExports} × ${COST_FACTORS.TIME_TO_REMOVE_DEAD_EXPORT} min = ${deadExports * COST_FACTORS.TIME_TO_REMOVE_DEAD_EXPORT} min`,
        `Unused deps to remove: ${unusedDepsCount} × ${COST_FACTORS.TIME_TO_REMOVE_UNUSED_DEP} min = ${unusedDepsCount * COST_FACTORS.TIME_TO_REMOVE_UNUSED_DEP} min`,
        `Total: ${cleanupMinutes} minutes (${cleanupHours.toFixed(1)} hours)`,
        `Developer rate: ${currencySymbol}${developerHourlyRate}/hour`,
        `One-time cleanup cost: ${formatCurrency(cleanupCost, currencySymbol)}`
      ],
      result: cleanupCost,
      resultFormatted: formatCurrency(cleanupCost, currencySymbol),
      timeMinutes: cleanupMinutes,
      timeHours: cleanupHours
    }
  };

  // ============================================
  // RETURN FULL COST ANALYSIS
  // ============================================
  return {
    enabled: true,
    methodology: 'Swynx Cost Methodology',
    version: '2.0.0',
    currency,
    currencySymbol,

    // Input configuration (for display/editing)
    config: {
      developerHourlyRate,
      teamSize,
      newHiresPerYear,
      onboardingHoursWasted,
      maintenanceOverheadPercent,
      currency
    },

    // Ongoing annual cost of keeping dead code
    annualCost: {
      onboarding: onboardingCostAnnual,
      maintenance: maintenanceCostAnnual,
      total: annualCost,
      formatted: {
        onboarding: formatCurrency(onboardingCostAnnual, currencySymbol),
        maintenance: formatCurrency(maintenanceCostAnnual, currencySymbol),
        total: formatCurrency(annualCost, currencySymbol)
      }
    },

    monthlyCost: {
      total: monthlyCost,
      formatted: formatCurrency(monthlyCost, currencySymbol)
    },

    // One-time cost to clean up
    cleanup: {
      minutes: cleanupMinutes,
      hours: cleanupHours,
      cost: cleanupCost,
      formatted: formatCurrency(cleanupCost, currencySymbol)
    },

    // ROI
    roi: {
      months: roiMonths,
      formatted: roiMonths !== null ? `${roiMonths.toFixed(1)} months` : 'N/A'
    },

    // Transparent calculation formulas
    formulas,

    // Legacy compatibility fields
    waste: {
      bytes: summary.wasteSizeBytes || 0,
      bytesFormatted: formatBytes(summary.wasteSizeBytes || 0),
      percent: wastePercent
    },
    potentialSavings: {
      annual: annualCost,
      formatted: {
        annual: formatCurrency(annualCost, currencySymbol)
      },
      developerTime: {
        minutes: cleanupMinutes,
        hours: cleanupHours,
        cost: cleanupCost,
        costFormatted: formatCurrency(cleanupCost, currencySymbol)
      },
      roiMonths
    }
  };
}

/**
 * Get methodology information
 */
export function getCostMethodologyInfo() {
  return {
    name: 'Swynx Cost Methodology',
    version: '2.0.0',
    releaseDate: '2026-02-18',
    status: 'active',
    principles: [
      'Transparency - All calculations show formulas',
      'Configurability - All assumptions can be changed',
      'Developer-focused - Costs measured in developer time, not bandwidth',
      'Conservativeness - Default estimates are conservative'
    ],
    factors: COST_FACTORS,
    categories: {
      onboarding: 'Cost of new developers wasting time understanding dead code',
      maintenance: 'Ongoing cost of team maintaining, reviewing, and debugging dead code',
      cleanup: 'One-time cost to remove all dead code'
    }
  };
}

export default { calculateCosts, getCostMethodologyInfo };
