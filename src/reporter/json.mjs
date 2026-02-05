// src/reporter/json.mjs
// JSON format output

export function formatJsonOutput(result, options = {}) {
  const report = {
    generatedAt: new Date().toISOString(),
    project: {
      path: result.projectPath,
      scannedAt: result.scannedAt
    },
    summary: {
      fileCount: result.summary.fileCount,
      jsFileCount: result.summary.jsFileCount,
      cssFileCount: result.summary.cssFileCount,
      assetFileCount: result.summary.assetFileCount,
      totalSizeBytes: result.summary.totalSizeBytes,
      wasteSizeBytes: result.summary.wasteSizeBytes,
      wastePercent: result.summary.wastePercent
    },
    healthScore: {
      score: result.healthScore.score,
      grade: result.healthScore.grade,
      breakdown: result.healthScore.breakdown
    },
    emissions: result.emissions ? {
      current: {
        monthlyCO2Kg: result.emissions.current?.monthlyCO2Kg || 0,
        annualCO2Kg: result.emissions.current?.annualCO2Kg || 0
      },
      optimized: result.emissions.optimized ? {
        monthlyCO2Kg: result.emissions.optimized.monthlyCO2Kg || 0,
        annualCO2Kg: result.emissions.optimized.annualCO2Kg || 0
      } : null,
      savings: result.emissions.savings || null
    } : null,
    findings: {
      critical: result.findings?.critical || [],
      warning: result.findings?.warning || [],
      info: result.findings?.info || []
    }
  };

  return JSON.stringify(report, null, 2);
}

export default formatJsonOutput;
