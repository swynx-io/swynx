// src/emissions/grid-intensity.mjs
// Grid carbon intensity data (Ember Climate 2022)

// Carbon intensity in gCO2/kWh by region
const GRID_INTENSITY = {
  // Global average
  'Global': 494,

  // Europe
  'UK': 233,
  'France': 85,
  'Germany': 385,
  'Spain': 200,
  'Italy': 371,
  'Netherlands': 386,
  'Belgium': 167,
  'Poland': 635,
  'Sweden': 41,
  'Norway': 26,
  'Denmark': 166,
  'Finland': 131,
  'Austria': 158,
  'Switzerland': 48,
  'Ireland': 296,
  'Portugal': 255,

  // North America
  'US': 379,
  'USA': 379,
  'Canada': 120,
  'Mexico': 431,

  // Asia Pacific
  'China': 582,
  'Japan': 471,
  'India': 632,
  'Australia': 517,
  'South Korea': 415,
  'Singapore': 408,
  'New Zealand': 118,

  // Others
  'Brazil': 103,
  'South Africa': 709
};

/**
 * Get grid intensity for a region
 */
export function getGridIntensity(region) {
  // Try exact match first
  if (GRID_INTENSITY[region]) {
    return GRID_INTENSITY[region];
  }

  // Try case-insensitive match
  const normalized = region?.toLowerCase();
  for (const [key, value] of Object.entries(GRID_INTENSITY)) {
    if (key.toLowerCase() === normalized) {
      return value;
    }
  }

  // Default to global average
  return GRID_INTENSITY['Global'];
}

/**
 * Get all available regions
 */
export function getAvailableRegions() {
  return Object.keys(GRID_INTENSITY);
}

export default { getGridIntensity, getAvailableRegions };
