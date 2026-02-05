// src/emissions/index.mjs

import { getGridIntensity } from './grid-intensity.mjs';

/**
 * EcoPigs Carbon Methodology v1.0
 *
 * Based on peer-reviewed research from:
 * - IEA 2022: Data center and network energy consumption
 * - Malmodin 2023: User device energy and embodied emissions
 * - Ember Climate 2022: Grid carbon intensity data
 *
 * All values sourced from peer-reviewed research.
 * See EcoPigs ECOPIGS_CARBON_METHODOLOGY.md for full documentation.
 */

// ============================================
// ENERGY INTENSITY VALUES (kWh per GB)
// ============================================

const ENERGY_INTENSITY = {
  // Operational Energy (energy consumed during use)
  operational: {
    dataCenter: 0.055,   // IEA 2022
    network: 0.059,      // IEA 2022
    userDevice: 0.080    // Malmodin 2023
  },

  // Embodied Energy (manufacturing and production)
  embodied: {
    dataCenter: 0.012,   // Malmodin 2023
    network: 0.013,      // Malmodin 2023
    userDevice: 0.081    // Malmodin 2023
  }
};

// Green hosting factor (80% reduction when verified green hosted)
const GREEN_HOSTING_FACTOR = 0.8;

// Global average grid intensity (Ember 2022)
const GLOBAL_GRID_INTENSITY = 494;

// Relatable metrics conversion factors
const RELATABLE_METRICS = {
  TREE_ABSORPTION_PER_DAY: 55,     // grams CO2 absorbed by one tree per day
  CAR_MILE_GRAMS: 170,             // grams CO2 per mile driven
  CAR_KM_GRAMS: 106,               // grams CO2 per km driven (170 / 1.609)
  SMARTPHONE_CHARGE: 8,            // grams CO2 per smartphone charge
  KETTLE_BOIL: 12                  // grams CO2 per kettle boil
};

// Unit conversions
const BYTES_TO_GB = 1024 ** 3;

/**
 * Calculate carbon emissions for a web application
 *
 * Uses the EcoPigs Carbon Methodology v1.0 which:
 * - Separates operational and embodied emissions
 * - Uses location-specific grid intensity
 * - Applies green hosting factor only to data center operational emissions
 * - Uses conservative baseline assumptions
 *
 * @param {Object} config - Configuration options
 * @param {number} config.buildSizeBytes - Total build size in bytes
 * @param {number} config.wasteBytes - Wasted bytes that could be eliminated
 * @param {number} config.monthlyVisitors - Monthly visitor count
 * @param {number} config.avgPagesPerVisit - Average pages viewed per visit
 * @param {number} config.cacheRate - Cache hit rate (0-1)
 * @param {string} config.region - Region for grid intensity
 * @param {boolean} config.greenHosted - Whether hosted on green energy
 * @returns {Object} Emissions calculation results
 */
export function calculateEmissions(config) {
  const {
    buildSizeBytes,
    wasteBytes = 0,
    monthlyVisitors = 10000,
    avgPagesPerVisit = 3,
    cacheRate = 0.7,
    region = 'Global',
    greenHosted = false
  } = config;

  // Get grid intensity for region (hardcoded data, no API)
  const gridIntensity = getGridIntensity(region);

  // Convert sizes to GB
  const buildSizeGB = buildSizeBytes / BYTES_TO_GB;

  // Calculate monthly data transfer
  const totalPageViews = monthlyVisitors * avgPagesPerVisit;
  const freshPageViews = totalPageViews * (1 - cacheRate);
  const cachedPageViews = totalPageViews * cacheRate;

  // Fresh transfer = full page load
  // Cached transfer = approximately 10% of full load (validation, dynamic content)
  const freshTransferGB = freshPageViews * buildSizeGB;
  const cachedTransferGB = cachedPageViews * buildSizeGB * 0.1;
  const totalTransferGB = freshTransferGB + cachedTransferGB;

  // ============================================
  // ECOPIGS METHODOLOGY CALCULATION
  // ============================================

  // Step 1: Calculate operational energy per segment (kWh)
  const opDataCenterEnergy = totalTransferGB * ENERGY_INTENSITY.operational.dataCenter;
  const opNetworkEnergy = totalTransferGB * ENERGY_INTENSITY.operational.network;
  const opUserDeviceEnergy = totalTransferGB * ENERGY_INTENSITY.operational.userDevice;

  // Step 2: Calculate embodied energy per segment (kWh)
  const embDataCenterEnergy = totalTransferGB * ENERGY_INTENSITY.embodied.dataCenter;
  const embNetworkEnergy = totalTransferGB * ENERGY_INTENSITY.embodied.network;
  const embUserDeviceEnergy = totalTransferGB * ENERGY_INTENSITY.embodied.userDevice;

  // Step 3: Apply green hosting factor (only to data center operational)
  const greenFactor = greenHosted ? GREEN_HOSTING_FACTOR : 0;
  const adjustedOpDataCenterEnergy = opDataCenterEnergy * (1 - greenFactor);

  // Step 4: Calculate operational emissions (gCO2)
  // Data center and network use hosting region's grid
  // User device uses global average (user's location unknown)
  const opDataCenterCO2 = adjustedOpDataCenterEnergy * gridIntensity;
  const opNetworkCO2 = opNetworkEnergy * gridIntensity;
  const opUserDeviceCO2 = opUserDeviceEnergy * GLOBAL_GRID_INTENSITY;
  const totalOperationalCO2 = opDataCenterCO2 + opNetworkCO2 + opUserDeviceCO2;

  // Step 5: Calculate embodied emissions (gCO2)
  // All embodied uses global average (global supply chains)
  const embDataCenterCO2 = embDataCenterEnergy * GLOBAL_GRID_INTENSITY;
  const embNetworkCO2 = embNetworkEnergy * GLOBAL_GRID_INTENSITY;
  const embUserDeviceCO2 = embUserDeviceEnergy * GLOBAL_GRID_INTENSITY;
  const totalEmbodiedCO2 = embDataCenterCO2 + embNetworkCO2 + embUserDeviceCO2;

  // Step 6: Total emissions
  const monthlyCO2Grams = totalOperationalCO2 + totalEmbodiedCO2;

  // Step 7: Calculate total energy
  const totalOperationalEnergy = adjustedOpDataCenterEnergy + opNetworkEnergy + opUserDeviceEnergy;
  const totalEmbodiedEnergy = embDataCenterEnergy + embNetworkEnergy + embUserDeviceEnergy;
  const monthlyKwh = totalOperationalEnergy + totalEmbodiedEnergy;

  // ============================================
  // WASTE IMPACT
  // ============================================
  const wasteRatio = buildSizeBytes > 0 ? wasteBytes / buildSizeBytes : 0;
  const wastedCO2Grams = monthlyCO2Grams * wasteRatio;

  // ============================================
  // RESULTS
  // ============================================

  return {
    methodology: 'EcoPigs Carbon Methodology',
    version: '1.0.0',
    region,
    gridIntensity,
    greenHosted,

    config: {
      buildSizeBytes,
      wasteBytes,
      monthlyVisitors,
      avgPagesPerVisit,
      cacheRate
    },

    transfer: {
      totalPageViews,
      freshPageViews,
      cachedPageViews,
      monthlyTransferGB: totalTransferGB,
      monthlyTransferBytes: totalTransferGB * BYTES_TO_GB
    },

    energy: {
      monthlyKwh,
      operational: {
        dataCenter: adjustedOpDataCenterEnergy,
        network: opNetworkEnergy,
        userDevice: opUserDeviceEnergy,
        total: totalOperationalEnergy
      },
      embodied: {
        dataCenter: embDataCenterEnergy,
        network: embNetworkEnergy,
        userDevice: embUserDeviceEnergy,
        total: totalEmbodiedEnergy
      }
    },

    current: {
      monthlyTransferGB: totalTransferGB,
      monthlyKwh,
      monthlyCO2Grams,
      monthlyCO2Kg: monthlyCO2Grams / 1000,
      annualCO2Kg: (monthlyCO2Grams / 1000) * 12,
      breakdown: {
        operational: {
          dataCenter: opDataCenterCO2,
          network: opNetworkCO2,
          userDevice: opUserDeviceCO2,
          total: totalOperationalCO2
        },
        embodied: {
          dataCenter: embDataCenterCO2,
          network: embNetworkCO2,
          userDevice: embUserDeviceCO2,
          total: totalEmbodiedCO2
        }
      }
    },

    waste: {
      wasteBytes,
      wasteRatio,
      wastedCO2Grams,
      wastedCO2Kg: wastedCO2Grams / 1000,
      annualWastedCO2Kg: (wastedCO2Grams / 1000) * 12
    },

    optimised: {
      monthlyCO2Grams: monthlyCO2Grams - wastedCO2Grams,
      monthlyCO2Kg: (monthlyCO2Grams - wastedCO2Grams) / 1000,
      annualCO2Kg: ((monthlyCO2Grams - wastedCO2Grams) / 1000) * 12,
      potentialSavingsKg: wastedCO2Grams / 1000,
      potentialSavingsPercent: wasteRatio * 100
    },

    equivalents: calculateEquivalents((monthlyCO2Grams / 1000) * 12)
  };
}

/**
 * Calculate real-world equivalents for CO2 emissions
 * Based on EcoPigs relatable metrics
 *
 * @param {number} annualCO2Kg - Annual CO2 in kg
 * @returns {Object} Equivalent measures
 */
function calculateEquivalents(annualCO2Kg) {
  const annualCO2Grams = annualCO2Kg * 1000;

  return {
    // km driven by average car
    carKm: Math.round(annualCO2Grams / RELATABLE_METRICS.CAR_KM_GRAMS),

    // Trees needed to offset (tree absorbs ~55g/day = ~20kg/year)
    treesNeeded: parseFloat((annualCO2Grams / (RELATABLE_METRICS.TREE_ABSORPTION_PER_DAY * 365)).toFixed(1)),

    // Smartphone charges equivalent
    smartphoneCharges: Math.round(annualCO2Grams / RELATABLE_METRICS.SMARTPHONE_CHARGE),

    // Kettle boils equivalent
    kettleBoils: Math.round(annualCO2Grams / RELATABLE_METRICS.KETTLE_BOIL),

    // Car miles equivalent
    carMiles: Math.round(annualCO2Grams / RELATABLE_METRICS.CAR_MILE_GRAMS)
  };
}

/**
 * Compare emissions between two configurations
 */
export function compareEmissions(baseline, optimised) {
  const baselineEmissions = calculateEmissions(baseline);
  const optimisedEmissions = calculateEmissions(optimised);

  const savingsKg = baselineEmissions.current.annualCO2Kg - optimisedEmissions.current.annualCO2Kg;
  const savingsPercent = baselineEmissions.current.annualCO2Kg > 0
    ? (savingsKg / baselineEmissions.current.annualCO2Kg) * 100
    : 0;

  return {
    baseline: baselineEmissions,
    optimised: optimisedEmissions,
    savings: {
      annualCO2Kg: savingsKg,
      percent: savingsPercent,
      equivalents: calculateEquivalents(savingsKg)
    }
  };
}

/**
 * Get methodology information
 */
export function getMethodologyInfo() {
  return {
    name: 'EcoPigs Carbon Methodology',
    version: '1.0.0',
    releaseDate: '2025-01-23',
    status: 'active',
    principles: [
      'Independence - Not tied to third-party model changes',
      'Transparency - All calculations fully documented',
      'Conservativeness - Upper-bound estimates (prefer overestimation)',
      'Accuracy - Location-specific, live data when available',
      'Scientific - Based on peer-reviewed research only'
    ],
    energyIntensity: ENERGY_INTENSITY,
    sources: {
      dataCenter: 'IEA 2022',
      network: 'IEA 2022',
      userDevice: 'Malmodin 2023',
      gridIntensity: 'Ember Climate 2022'
    }
  };
}

export default calculateEmissions;
