// src/calculator/cost.mjs
// Transparent cost calculations for Swynx

import { DEFAULT_COSTS, getCurrencySymbol } from '../config/defaults.mjs';

/**
 * Swynx Cost Methodology v1.0
 *
 * This calculator provides transparent, configurable cost estimates for digital waste.
 * Every calculation shows its formula so users can verify and adjust assumptions.
 *
 * Cost categories:
 * - Bandwidth: Cost of serving data to users
 * - Storage: Cost of storing data in cloud/CDN
 * - Developer time: Opportunity cost of maintaining unnecessary code
 *
 * Modes:
 * - 'served': Full cost (bandwidth + storage) for web-served assets
 * - 'storage': Storage only for archived/non-served files
 */

// ============================================
// COST FACTORS (documented constants)
// ============================================

const COST_FACTORS = {
  BANDWIDTH: {
    description: 'Cost per GB of data transfer',
    unit: 'currency/GB',
    defaultValue: 0.08,
    source: 'AWS CloudFront pricing (Jan 2026)'
  },
  STORAGE: {
    description: 'Cost per GB per month for storage',
    unit: 'currency/GB/month',
    defaultValue: 0.023,
    source: 'AWS S3 Standard pricing (Jan 2026)'
  },
  DEVELOPER_HOUR: {
    description: 'Average developer hourly rate',
    unit: 'currency/hour',
    defaultValue: 75,
    source: 'UK developer average (Glassdoor 2025)'
  },
  CO2_PER_GB: {
    description: 'CO2 emissions per GB transferred',
    unit: 'kg/GB',
    defaultValue: 0.5,
    source: 'The Shift Project (2023)'
  },
  // Developer time estimates for fixing waste
  TIME_TO_REMOVE_DEAD_FILE: 5, // minutes per file
  TIME_TO_REMOVE_DEAD_EXPORT: 2, // minutes per export
  TIME_TO_REMOVE_UNUSED_DEP: 10, // minutes per dependency
  TIME_TO_OPTIMIZE_ASSET: 15 // minutes per asset
};

// Bytes conversion
const BYTES_TO_GB = 1024 ** 3;
const BYTES_TO_MB = 1024 ** 2;

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < BYTES_TO_MB) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < BYTES_TO_GB) return (bytes / BYTES_TO_MB).toFixed(2) + ' MB';
  return (bytes / BYTES_TO_GB).toFixed(4) + ' GB';
}

/**
 * Format currency amount
 */
function formatCurrency(amount, symbol = '£') {
  if (amount < 0.01) return `${symbol}0.00`;
  if (amount < 1) return `${symbol}${amount.toFixed(2)}`;
  if (amount < 100) return `${symbol}${amount.toFixed(2)}`;
  return `${symbol}${amount.toFixed(0)}`;
}

/**
 * Calculate transfer amounts considering cache
 * Same methodology as emissions calculator
 */
function calculateTransfer(totalBytes, monthlyPageLoads, cacheHitRate) {
  const totalGB = totalBytes / BYTES_TO_GB;
  const freshLoads = monthlyPageLoads * (1 - cacheHitRate);
  const cachedLoads = monthlyPageLoads * cacheHitRate;

  // Fresh transfer = full page load
  const freshTransferGB = freshLoads * totalGB;
  // Cached transfer = ~10% of full load (validation, dynamic content)
  const cachedTransferGB = cachedLoads * totalGB * 0.1;
  const monthlyTransferGB = freshTransferGB + cachedTransferGB;

  return {
    totalGB,
    freshLoads,
    cachedLoads,
    freshTransferGB,
    cachedTransferGB,
    monthlyTransferGB
  };
}

/**
 * Build formula string for bandwidth calculation
 */
function buildBandwidthFormula(monthlyPageLoads, cacheHitRate, totalBytes, monthlyTransferGB, bandwidthPerGb, currencySymbol) {
  const missRate = ((1 - cacheHitRate) * 100).toFixed(0);
  const totalMB = (totalBytes / BYTES_TO_MB).toFixed(2);

  return {
    formula: `${monthlyPageLoads.toLocaleString()} loads × ${missRate}% miss rate × ${totalMB} MB = ${monthlyTransferGB.toFixed(4)} GB × ${currencySymbol}${bandwidthPerGb}/GB`,
    breakdown: [
      `Monthly page loads: ${monthlyPageLoads.toLocaleString()}`,
      `Cache miss rate: ${missRate}% (${(1 - cacheHitRate).toFixed(2)})`,
      `Asset size: ${formatBytes(totalBytes)}`,
      `Effective monthly transfer: ${monthlyTransferGB.toFixed(4)} GB`,
      `Bandwidth cost: ${currencySymbol}${bandwidthPerGb}/GB`
    ]
  };
}

/**
 * Build formula string for storage calculation
 */
function buildStorageFormula(totalBytes, storagePerGbMonth, currencySymbol) {
  const totalGB = totalBytes / BYTES_TO_GB;

  return {
    formula: `${formatBytes(totalBytes)} × ${currencySymbol}${storagePerGbMonth}/GB/month`,
    breakdown: [
      `Total size: ${formatBytes(totalBytes)} (${totalGB.toFixed(6)} GB)`,
      `Storage cost: ${currencySymbol}${storagePerGbMonth}/GB/month`
    ]
  };
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
    monthlyPageLoads = DEFAULT_COSTS.monthlyPageLoads,
    cacheHitRate = DEFAULT_COSTS.cacheHitRate,
    bandwidthPerGb = DEFAULT_COSTS.bandwidthPerGb,
    bandwidthSource = DEFAULT_COSTS.bandwidthSource,
    storagePerGbMonth = DEFAULT_COSTS.storagePerGbMonth,
    storageSource = DEFAULT_COSTS.storageSource,
    developerHourlyRate = DEFAULT_COSTS.developerHourlyRate,
    developerSource = DEFAULT_COSTS.developerSource,
    co2PerGb = DEFAULT_COSTS.co2PerGb,
    co2Source = DEFAULT_COSTS.co2Source,
    currency = DEFAULT_COSTS.currency,
    currencySymbol = getCurrencySymbol(currency),
    mode = DEFAULT_COSTS.mode
  } = costs;

  // Extract scan data
  const summary = scanResult.summary || {};
  const totalBytes = summary.totalSizeBytes || 0;
  const wasteBytes = summary.wasteSizeBytes || 0;
  const wastePercent = summary.wastePercent || 0;

  // Calculate transfer amounts
  const transfer = calculateTransfer(totalBytes, monthlyPageLoads, cacheHitRate);
  const wasteTransfer = calculateTransfer(wasteBytes, monthlyPageLoads, cacheHitRate);

  // ============================================
  // BANDWIDTH COSTS (mode: served)
  // ============================================
  const bandwidthMonthly = mode === 'served' ? transfer.monthlyTransferGB * bandwidthPerGb : 0;
  const bandwidthAnnual = bandwidthMonthly * 12;
  const wasteBandwidthMonthly = mode === 'served' ? wasteTransfer.monthlyTransferGB * bandwidthPerGb : 0;
  const wasteBandwidthAnnual = wasteBandwidthMonthly * 12;

  // ============================================
  // STORAGE COSTS
  // ============================================
  const totalGB = totalBytes / BYTES_TO_GB;
  const wasteGB = wasteBytes / BYTES_TO_GB;
  const storageMonthly = totalGB * storagePerGbMonth;
  const storageAnnual = storageMonthly * 12;
  const wasteStorageMonthly = wasteGB * storagePerGbMonth;
  const wasteStorageAnnual = wasteStorageMonthly * 12;

  // ============================================
  // TOTAL COSTS
  // ============================================
  const totalMonthly = bandwidthMonthly + storageMonthly;
  const totalAnnual = totalMonthly * 12;
  const wasteTotalMonthly = wasteBandwidthMonthly + wasteStorageMonthly;
  const wasteTotalAnnual = wasteTotalMonthly * 12;

  // ============================================
  // CO2 IMPACT OF WASTE
  // ============================================
  const wasteCo2Monthly = wasteTransfer.monthlyTransferGB * co2PerGb;
  const wasteCo2Annual = wasteCo2Monthly * 12;

  // ============================================
  // DEVELOPER TIME TO FIX
  // ============================================
  const details = scanResult.details || {};
  const deadCode = details.deadCode || {};
  const unusedDeps = details.unusedDeps || [];

  const fullyDeadFiles = deadCode.fullyDeadFiles?.length || 0;
  const partiallyDeadFiles = deadCode.partiallyDeadFiles?.length || 0;
  const deadExports = deadCode.summary?.totalDeadExports || 0;
  const unusedDepsCount = unusedDeps.length;

  const timeToFixMinutes =
    (fullyDeadFiles * COST_FACTORS.TIME_TO_REMOVE_DEAD_FILE) +
    (deadExports * COST_FACTORS.TIME_TO_REMOVE_DEAD_EXPORT) +
    (unusedDepsCount * COST_FACTORS.TIME_TO_REMOVE_UNUSED_DEP);

  const timeToFixHours = timeToFixMinutes / 60;
  const developerCostToFix = timeToFixHours * developerHourlyRate;

  // ============================================
  // BUILD FORMULA OBJECTS
  // ============================================
  const formulas = {
    bandwidth: mode === 'served' ? {
      ...buildBandwidthFormula(monthlyPageLoads, cacheHitRate, totalBytes, transfer.monthlyTransferGB, bandwidthPerGb, currencySymbol),
      result: bandwidthMonthly,
      resultFormatted: formatCurrency(bandwidthMonthly, currencySymbol)
    } : null,

    storage: {
      ...buildStorageFormula(totalBytes, storagePerGbMonth, currencySymbol),
      result: storageMonthly,
      resultFormatted: formatCurrency(storageMonthly, currencySymbol)
    },

    wasteBandwidth: mode === 'served' && wasteBytes > 0 ? {
      ...buildBandwidthFormula(monthlyPageLoads, cacheHitRate, wasteBytes, wasteTransfer.monthlyTransferGB, bandwidthPerGb, currencySymbol),
      result: wasteBandwidthMonthly,
      resultFormatted: formatCurrency(wasteBandwidthMonthly, currencySymbol)
    } : null,

    wasteStorage: wasteBytes > 0 ? {
      ...buildStorageFormula(wasteBytes, storagePerGbMonth, currencySymbol),
      result: wasteStorageMonthly,
      resultFormatted: formatCurrency(wasteStorageMonthly, currencySymbol)
    } : null,

    developerTime: {
      formula: `(${fullyDeadFiles} files × ${COST_FACTORS.TIME_TO_REMOVE_DEAD_FILE}min) + (${deadExports} exports × ${COST_FACTORS.TIME_TO_REMOVE_DEAD_EXPORT}min) + (${unusedDepsCount} deps × ${COST_FACTORS.TIME_TO_REMOVE_UNUSED_DEP}min)`,
      breakdown: [
        `Dead files to remove: ${fullyDeadFiles} × ${COST_FACTORS.TIME_TO_REMOVE_DEAD_FILE} min = ${fullyDeadFiles * COST_FACTORS.TIME_TO_REMOVE_DEAD_FILE} min`,
        `Dead exports to remove: ${deadExports} × ${COST_FACTORS.TIME_TO_REMOVE_DEAD_EXPORT} min = ${deadExports * COST_FACTORS.TIME_TO_REMOVE_DEAD_EXPORT} min`,
        `Unused deps to remove: ${unusedDepsCount} × ${COST_FACTORS.TIME_TO_REMOVE_UNUSED_DEP} min = ${unusedDepsCount * COST_FACTORS.TIME_TO_REMOVE_UNUSED_DEP} min`,
        `Total: ${timeToFixMinutes} minutes (${timeToFixHours.toFixed(1)} hours)`,
        `Developer rate: ${currencySymbol}${developerHourlyRate}/hour`
      ],
      result: developerCostToFix,
      resultFormatted: formatCurrency(developerCostToFix, currencySymbol),
      timeMinutes: timeToFixMinutes,
      timeHours: timeToFixHours
    },

    co2: {
      formula: `${wasteTransfer.monthlyTransferGB.toFixed(4)} GB × ${co2PerGb} kg/GB`,
      breakdown: [
        `Waste transfer: ${wasteTransfer.monthlyTransferGB.toFixed(4)} GB/month`,
        `CO2 per GB: ${co2PerGb} kg (source: ${co2Source})`
      ],
      result: wasteCo2Monthly,
      resultFormatted: `${wasteCo2Monthly.toFixed(3)} kg`
    }
  };

  // ============================================
  // RETURN FULL COST ANALYSIS
  // ============================================
  return {
    enabled: true,
    methodology: 'Swynx Cost Methodology',
    version: '1.0.0',
    currency,
    currencySymbol,
    mode,

    // Input configuration (for display/editing)
    config: {
      monthlyPageLoads,
      cacheHitRate,
      bandwidthPerGb,
      bandwidthSource,
      storagePerGbMonth,
      storageSource,
      developerHourlyRate,
      developerSource,
      co2PerGb,
      co2Source,
      mode
    },

    // Current costs (all assets)
    current: {
      monthly: {
        bandwidth: bandwidthMonthly,
        storage: storageMonthly,
        total: totalMonthly
      },
      annual: {
        bandwidth: bandwidthAnnual,
        storage: storageAnnual,
        total: totalAnnual
      },
      formatted: {
        monthly: {
          bandwidth: formatCurrency(bandwidthMonthly, currencySymbol),
          storage: formatCurrency(storageMonthly, currencySymbol),
          total: formatCurrency(totalMonthly, currencySymbol)
        },
        annual: {
          bandwidth: formatCurrency(bandwidthAnnual, currencySymbol),
          storage: formatCurrency(storageAnnual, currencySymbol),
          total: formatCurrency(totalAnnual, currencySymbol)
        }
      }
    },

    // Waste costs (unnecessary spending)
    waste: {
      bytes: wasteBytes,
      bytesFormatted: formatBytes(wasteBytes),
      percent: wastePercent,
      monthly: {
        bandwidth: wasteBandwidthMonthly,
        storage: wasteStorageMonthly,
        total: wasteTotalMonthly
      },
      annual: {
        bandwidth: wasteBandwidthAnnual,
        storage: wasteStorageAnnual,
        total: wasteTotalAnnual
      },
      formatted: {
        monthly: {
          bandwidth: formatCurrency(wasteBandwidthMonthly, currencySymbol),
          storage: formatCurrency(wasteStorageMonthly, currencySymbol),
          total: formatCurrency(wasteTotalMonthly, currencySymbol)
        },
        annual: {
          bandwidth: formatCurrency(wasteBandwidthAnnual, currencySymbol),
          storage: formatCurrency(wasteStorageAnnual, currencySymbol),
          total: formatCurrency(wasteTotalAnnual, currencySymbol)
        }
      },
      co2: {
        monthly: wasteCo2Monthly,
        annual: wasteCo2Annual,
        monthlyFormatted: `${wasteCo2Monthly.toFixed(3)} kg`,
        annualFormatted: `${wasteCo2Annual.toFixed(3)} kg`
      }
    },

    // Potential savings if waste is removed
    potentialSavings: {
      monthly: wasteTotalMonthly,
      annual: wasteTotalAnnual,
      formatted: {
        monthly: formatCurrency(wasteTotalMonthly, currencySymbol),
        annual: formatCurrency(wasteTotalAnnual, currencySymbol)
      },
      developerTime: {
        minutes: timeToFixMinutes,
        hours: timeToFixHours,
        cost: developerCostToFix,
        costFormatted: formatCurrency(developerCostToFix, currencySymbol)
      },
      // ROI: time to recoup developer time investment
      roiMonths: wasteTotalMonthly > 0 ? developerCostToFix / wasteTotalMonthly : null
    },

    // Transparent calculation formulas
    formulas,

    // Per-finding cost breakdown
    perFinding: calculatePerFindingCosts(scanResult, {
      monthlyPageLoads,
      cacheHitRate,
      bandwidthPerGb,
      storagePerGbMonth,
      developerHourlyRate,
      currency,
      currencySymbol,
      mode
    })
  };
}

/**
 * Calculate costs attributed to each finding type
 */
function calculatePerFindingCosts(scanResult, costConfig) {
  const {
    monthlyPageLoads,
    cacheHitRate,
    bandwidthPerGb,
    storagePerGbMonth,
    developerHourlyRate,
    currencySymbol,
    mode
  } = costConfig;

  const details = scanResult.details || {};
  const results = {};

  // Dead code costs
  const deadCode = details.deadCode || {};
  const deadCodeBytes = deadCode.totalSizeBytes || (
    (deadCode.fullyDeadFiles || []).reduce((s, f) => s + (f.sizeBytes || 0), 0) +
    (deadCode.partiallyDeadFiles || []).reduce((s, f) => s + (f.summary?.deadBytes || 0), 0)
  );

  if (deadCodeBytes > 0) {
    const transfer = calculateTransfer(deadCodeBytes, monthlyPageLoads, cacheHitRate);
    const bandwidth = mode === 'served' ? transfer.monthlyTransferGB * bandwidthPerGb : 0;
    const storage = (deadCodeBytes / BYTES_TO_GB) * storagePerGbMonth;

    results.deadCode = {
      bytes: deadCodeBytes,
      bytesFormatted: formatBytes(deadCodeBytes),
      monthlyBandwidth: bandwidth,
      monthlyStorage: storage,
      monthlyTotal: bandwidth + storage,
      annualTotal: (bandwidth + storage) * 12,
      formatted: {
        monthly: formatCurrency(bandwidth + storage, currencySymbol),
        annual: formatCurrency((bandwidth + storage) * 12, currencySymbol)
      }
    };
  }

  // Unused dependencies costs
  const unusedDeps = details.unusedDeps || [];
  const unusedDepBytes = unusedDeps.reduce((s, d) => s + (d.sizeBytes || 0), 0);

  if (unusedDepBytes > 0) {
    const transfer = calculateTransfer(unusedDepBytes, monthlyPageLoads, cacheHitRate);
    const bandwidth = mode === 'served' ? transfer.monthlyTransferGB * bandwidthPerGb : 0;
    const storage = (unusedDepBytes / BYTES_TO_GB) * storagePerGbMonth;

    results.unusedDeps = {
      count: unusedDeps.length,
      bytes: unusedDepBytes,
      bytesFormatted: formatBytes(unusedDepBytes),
      monthlyBandwidth: bandwidth,
      monthlyStorage: storage,
      monthlyTotal: bandwidth + storage,
      annualTotal: (bandwidth + storage) * 12,
      formatted: {
        monthly: formatCurrency(bandwidth + storage, currencySymbol),
        annual: formatCurrency((bandwidth + storage) * 12, currencySymbol)
      }
    };
  }

  // Unused assets costs
  const unusedAssets = details.unusedAssets || [];
  const unusedAssetBytes = unusedAssets.reduce((s, a) => s + (a.sizeBytes || 0), 0);

  if (unusedAssetBytes > 0) {
    const transfer = calculateTransfer(unusedAssetBytes, monthlyPageLoads, cacheHitRate);
    const bandwidth = mode === 'served' ? transfer.monthlyTransferGB * bandwidthPerGb : 0;
    const storage = (unusedAssetBytes / BYTES_TO_GB) * storagePerGbMonth;

    results.unusedAssets = {
      count: unusedAssets.length,
      bytes: unusedAssetBytes,
      bytesFormatted: formatBytes(unusedAssetBytes),
      monthlyBandwidth: bandwidth,
      monthlyStorage: storage,
      monthlyTotal: bandwidth + storage,
      annualTotal: (bandwidth + storage) * 12,
      formatted: {
        monthly: formatCurrency(bandwidth + storage, currencySymbol),
        annual: formatCurrency((bandwidth + storage) * 12, currencySymbol)
      }
    };
  }

  // Asset optimisation potential
  const assetOptimisation = details.assetOptimisation || {};
  const optimisationBytes = assetOptimisation.potentialSavings || 0;

  if (optimisationBytes > 0) {
    const transfer = calculateTransfer(optimisationBytes, monthlyPageLoads, cacheHitRate);
    const bandwidth = mode === 'served' ? transfer.monthlyTransferGB * bandwidthPerGb : 0;
    const storage = (optimisationBytes / BYTES_TO_GB) * storagePerGbMonth;

    results.assetOptimisation = {
      bytes: optimisationBytes,
      bytesFormatted: formatBytes(optimisationBytes),
      monthlyBandwidth: bandwidth,
      monthlyStorage: storage,
      monthlyTotal: bandwidth + storage,
      annualTotal: (bandwidth + storage) * 12,
      formatted: {
        monthly: formatCurrency(bandwidth + storage, currencySymbol),
        annual: formatCurrency((bandwidth + storage) * 12, currencySymbol)
      }
    };
  }

  return results;
}

/**
 * Get methodology information
 */
export function getCostMethodologyInfo() {
  return {
    name: 'Swynx Cost Methodology',
    version: '1.0.0',
    releaseDate: '2026-01-29',
    status: 'active',
    principles: [
      'Transparency - All calculations show formulas',
      'Configurability - All assumptions can be changed',
      'Accuracy - Uses real cloud pricing data',
      'Conservativeness - Default estimates are conservative'
    ],
    factors: COST_FACTORS,
    modes: {
      served: 'Full cost calculation (bandwidth + storage) for web-served assets',
      storage: 'Storage-only calculation for archived or non-served files'
    }
  };
}

export default { calculateCosts, getCostMethodologyInfo };
