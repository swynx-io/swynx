/**
 * ESG Data Aggregator
 *
 * Aggregates scan data for ESG reporting.
 */

import { getAllScans } from '../../storage/index.mjs';
import { loadLicense } from '../../license/storage.mjs';

/**
 * Parse period string to date range
 * @param {string} period - e.g., '90d', 'Q4-2025', '2025', 'last-quarter'
 * @returns {{ start: Date, end: Date }}
 */
export function parsePeriod(period) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  if (!period || period === '90d' || period === 'last-90-days') {
    const start = new Date(today);
    start.setDate(start.getDate() - 90);
    start.setHours(0, 0, 0, 0);
    return { start, end: today };
  }

  if (period === '30d' || period === 'last-30-days') {
    const start = new Date(today);
    start.setDate(start.getDate() - 30);
    start.setHours(0, 0, 0, 0);
    return { start, end: today };
  }

  if (period === 'this-quarter') {
    const quarter = Math.floor(now.getMonth() / 3);
    const start = new Date(now.getFullYear(), quarter * 3, 1, 0, 0, 0);
    return { start, end: today };
  }

  if (period === 'last-quarter') {
    const quarter = Math.floor(now.getMonth() / 3);
    const lastQuarter = quarter === 0 ? 3 : quarter - 1;
    const year = quarter === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const start = new Date(year, lastQuarter * 3, 1, 0, 0, 0);
    const end = new Date(year, lastQuarter * 3 + 3, 0, 23, 59, 59);
    return { start, end };
  }

  if (period === 'this-year') {
    const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
    return { start, end: today };
  }

  if (period === 'last-year') {
    const start = new Date(now.getFullYear() - 1, 0, 1, 0, 0, 0);
    const end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);
    return { start, end };
  }

  // Quarter format: Q1-2025, Q4-2025
  const quarterMatch = period.match(/^Q([1-4])-(\d{4})$/i);
  if (quarterMatch) {
    const q = parseInt(quarterMatch[1]) - 1;
    const year = parseInt(quarterMatch[2]);
    const start = new Date(year, q * 3, 1, 0, 0, 0);
    const end = new Date(year, q * 3 + 3, 0, 23, 59, 59);
    return { start, end };
  }

  // Year format: 2025
  const yearMatch = period.match(/^(\d{4})$/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1]);
    const start = new Date(year, 0, 1, 0, 0, 0);
    const end = new Date(year, 11, 31, 23, 59, 59);
    return { start, end };
  }

  // Default to 90 days
  const start = new Date(today);
  start.setDate(start.getDate() - 90);
  start.setHours(0, 0, 0, 0);
  return { start, end: today };
}

/**
 * Parse custom date range
 * @param {string} after - Start date (YYYY-MM-DD)
 * @param {string} before - End date (YYYY-MM-DD)
 * @returns {{ start: Date, end: Date }}
 */
export function parseCustomRange(after, before) {
  const start = new Date(after);
  start.setHours(0, 0, 0, 0);
  const end = new Date(before);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * Calculate emissions avoided from removed waste
 * @param {object} scan - Scan data
 * @param {object} previousScan - Previous scan data
 * @returns {number} - Avoided emissions in kg CO2e annually
 */
function calculateEmissionsAvoided(scan, previousScan) {
  if (!previousScan) return 0;

  const monthlyRequests = scan.config?.costs?.monthlyPageLoads || 100000;
  const energyPerByte = 0.0000000006; // kWh per byte
  const gridIntensity = 0.233; // kg CO2 per kWh (UK average)

  // Calculate bytes removed (bundle size reduction + dead code)
  const prevSize = previousScan.summary?.totalSizeBytes || 0;
  const currSize = scan.summary?.totalSizeBytes || 0;
  const bytesRemoved = Math.max(0, prevSize - currSize);

  if (bytesRemoved === 0) return 0;

  const monthlyKgAvoided = bytesRemoved * monthlyRequests * energyPerByte * gridIntensity;
  const annualKgAvoided = monthlyKgAvoided * 12;

  return annualKgAvoided;
}

/**
 * Count issues fixed between scans
 */
function countIssuesFixed(scan, previousScan) {
  if (!previousScan) return 0;

  const prevIssues = (previousScan.findings?.critical?.length || 0) +
                     (previousScan.findings?.warning?.length || 0);
  const currIssues = (scan.findings?.critical?.length || 0) +
                     (scan.findings?.warning?.length || 0);

  return Math.max(0, prevIssues - currIssues);
}

/**
 * Aggregate scan data for ESG reporting
 * @param {object} options
 * @param {Date} options.startDate
 * @param {Date} options.endDate
 * @param {string[]} options.projects - Filter to specific projects (optional)
 * @returns {Promise<object>} Aggregated ESG data
 */
export async function aggregateESGData(options = {}) {
  const { startDate, endDate, projects } = options;

  // Get all scans
  const allScans = await getAllScans({ includeRaw: true });

  // Filter by date range
  let filteredScans = allScans.filter(scan => {
    const scanDate = new Date(scan.created_at || scan.scannedAt);
    return scanDate >= startDate && scanDate <= endDate;
  });

  // Filter by projects if specified
  if (projects && projects.length > 0) {
    filteredScans = filteredScans.filter(scan => {
      const projectName = scan.project_name || scan.projectName;
      const projectPath = scan.project_path || scan.projectPath;
      return projects.some(p =>
        p === projectName ||
        p === projectPath ||
        projectPath?.includes(p) ||
        projectName?.includes(p)
      );
    });
  }

  // Sort by date
  filteredScans.sort((a, b) =>
    new Date(a.created_at || a.scannedAt) - new Date(b.created_at || b.scannedAt)
  );

  // Get license info
  const license = await loadLicense();
  const organisation = license?.email?.split('@')[1]?.split('.')[0] ||
                       license?.customerName ||
                       'Organisation';

  // Group by project
  const projectMap = new Map();

  for (const scan of filteredScans) {
    const projectName = scan.project_name || scan.projectName ||
                        (scan.project_path || scan.projectPath || '').split('/').filter(Boolean).pop() ||
                        'Unknown Project';
    const projectPath = scan.project_path || scan.projectPath;

    if (!projectMap.has(projectPath)) {
      projectMap.set(projectPath, {
        name: projectName,
        path: projectPath,
        scans: [],
        totalEmissions: 0,
        firstScan: null,
        lastScan: null
      });
    }

    const project = projectMap.get(projectPath);

    // Parse raw data if needed
    let rawData = scan.raw || scan.raw_data;
    if (typeof rawData === 'string') {
      try {
        rawData = JSON.parse(rawData);
      } catch (e) {
        rawData = {};
      }
    }

    const emissions = rawData?.emissions?.current?.monthlyCO2Kg ||
                      scan.emissions_kg ||
                      0;

    const scanData = {
      id: scan.id,
      date: new Date(scan.created_at || scan.scannedAt),
      emissions,
      bundleSize: rawData?.summary?.totalSizeBytes || scan.total_size_bytes || 0,
      wastePercent: rawData?.summary?.wastePercent || scan.waste_percent || 0,
      vulnerabilities: (rawData?.security?.critical?.length || 0) +
                       (rawData?.security?.high?.length || 0) +
                       (rawData?.security?.medium?.length || 0) +
                       (rawData?.security?.low?.length || 0),
      issuesFixed: 0,
      emissionsAvoided: 0,
      healthScore: rawData?.healthScore?.score || scan.health_score || 0
    };

    // Calculate issues fixed and emissions avoided vs previous scan
    if (project.scans.length > 0) {
      const prevScan = project.scans[project.scans.length - 1];
      scanData.issuesFixed = countIssuesFixed(rawData, prevScan._raw);
      scanData.emissionsAvoided = calculateEmissionsAvoided(rawData, prevScan._raw);
    }

    scanData._raw = rawData; // Keep for calculations
    project.scans.push(scanData);
    project.totalEmissions += emissions;

    if (!project.firstScan) project.firstScan = scanData;
    project.lastScan = scanData;
  }

  // Calculate totals and trends
  let totalEmissions = 0;
  let totalIssuesFixed = 0;
  let totalEmissionsAvoided = 0;
  let totalScans = 0;
  const projectSummaries = [];

  for (const [path, project] of projectMap) {
    totalEmissions += project.totalEmissions;
    totalScans += project.scans.length;

    let projectIssuesFixed = 0;
    let projectEmissionsAvoided = 0;

    for (const scan of project.scans) {
      projectIssuesFixed += scan.issuesFixed;
      projectEmissionsAvoided += scan.emissionsAvoided;
    }

    totalIssuesFixed += projectIssuesFixed;
    totalEmissionsAvoided += projectEmissionsAvoided;

    // Calculate trend
    let trend = 0;
    let trendSymbol = '●';
    if (project.firstScan && project.lastScan && project.scans.length > 1) {
      const firstEmissions = project.firstScan.emissions;
      const lastEmissions = project.lastScan.emissions;
      if (firstEmissions > 0) {
        trend = ((lastEmissions - firstEmissions) / firstEmissions) * 100;
        trendSymbol = trend < -2 ? '▼' : trend > 2 ? '▲' : '●';
      }
    }

    projectSummaries.push({
      name: project.name,
      path: project.path,
      emissions: project.totalEmissions,
      scanCount: project.scans.length,
      trend,
      trendSymbol,
      issuesFixed: projectIssuesFixed,
      emissionsAvoided: projectEmissionsAvoided,
      scans: project.scans.map(s => ({
        id: s.id,
        date: s.date,
        emissions: s.emissions,
        bundleSize: s.bundleSize,
        wastePercent: s.wastePercent,
        vulnerabilities: s.vulnerabilities,
        issuesFixed: s.issuesFixed,
        healthScore: s.healthScore
      }))
    });
  }

  // Sort projects by emissions (descending)
  projectSummaries.sort((a, b) => b.emissions - a.emissions);

  // Calculate percentage of total for each project
  for (const project of projectSummaries) {
    project.percentOfTotal = totalEmissions > 0
      ? (project.emissions / totalEmissions) * 100
      : 0;
  }

  // Calculate monthly breakdown
  const monthlyData = new Map();
  for (const project of projectSummaries) {
    for (const scan of project.scans) {
      const monthKey = `${scan.date.getFullYear()}-${String(scan.date.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyData.has(monthKey)) {
        monthlyData.set(monthKey, {
          month: monthKey,
          emissions: 0,
          scans: 0,
          issuesFixed: 0
        });
      }
      const month = monthlyData.get(monthKey);
      month.emissions += scan.emissions;
      month.scans += 1;
      month.issuesFixed += scan.issuesFixed;
    }
  }

  const monthlyBreakdown = Array.from(monthlyData.values())
    .sort((a, b) => a.month.localeCompare(b.month));

  // Calculate overall trend
  let overallTrend = 0;
  let overallTrendSymbol = '●';
  if (monthlyBreakdown.length >= 2) {
    const firstMonth = monthlyBreakdown[0].emissions;
    const lastMonth = monthlyBreakdown[monthlyBreakdown.length - 1].emissions;
    if (firstMonth > 0) {
      overallTrend = ((lastMonth - firstMonth) / firstMonth) * 100;
      overallTrendSymbol = overallTrend < -2 ? '▼' : overallTrend > 2 ? '▲' : '●';
    }
  }

  // Generate report ID
  const reportId = `rpt_${Date.now().toString(36)}${Math.random().toString(36).substr(2, 9)}`;

  return {
    reportId,
    generatedAt: new Date(),
    organisation: organisation.charAt(0).toUpperCase() + organisation.slice(1),
    period: {
      start: startDate,
      end: endDate
    },
    summary: {
      totalEmissions,
      totalScans,
      projectCount: projectSummaries.length,
      trend: overallTrend,
      trendSymbol: overallTrendSymbol,
      issuesFixed: totalIssuesFixed,
      emissionsAvoided: totalEmissionsAvoided
    },
    projects: projectSummaries,
    monthlyBreakdown,
    methodology: {
      version: 'Swynx v1.0',
      framework: 'GHG Protocol Scope 3 aligned',
      energyPerByte: '0.6 kWh per GB (Shift Project)',
      gridIntensity: '0.233 kg CO₂ per kWh (UK average)',
      note: 'Emissions calculated based on code analysis and estimated traffic. Suitable for CDP, GRI, and internal sustainability reporting.'
    }
  };
}

export default {
  parsePeriod,
  parseCustomRange,
  aggregateESGData
};
