/**
 * ESG PDF Report Generator
 *
 * Generates formatted PDF reports for ESG data.
 */

import PDFDocument from 'pdfkit';

/**
 * Format date for display
 */
function formatDate(date) {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

/**
 * Format month key (YYYY-MM) for display
 */
function formatMonth(monthKey) {
  const [year, month] = monthKey.split('-');
  const date = new Date(year, parseInt(month) - 1);
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

/**
 * Generate ESG PDF report
 * @param {object} data - Aggregated ESG data from aggregator
 * @returns {Promise<Buffer>} PDF buffer
 */
export async function generateESGPDF(data) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        info: {
          Title: 'Swynx Digital Emissions Report',
          Author: 'Swynx',
          Subject: `ESG Report ${formatDate(data.period.start)} to ${formatDate(data.period.end)}`,
          Keywords: 'ESG, emissions, carbon, sustainability, digital'
        }
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width - 100;
      const primaryColor = '#fdcb0f';
      const textColor = '#333333';
      const lightGray = '#666666';
      const lineColor = '#e0e0e0';

      // ===== HEADER =====
      doc.fontSize(24)
         .fillColor(primaryColor)
         .text('SWYNX', 50, 50);

      doc.fontSize(16)
         .fillColor(textColor)
         .text('Digital Emissions Report', 50, 80);

      doc.fontSize(10)
         .fillColor(lightGray)
         .text(`Report Period: ${formatDate(data.period.start)} - ${formatDate(data.period.end)}`, 50, 110)
         .text(`Generated: ${formatDate(data.generatedAt)}`, 50, 125)
         .text(`Organisation: ${data.organisation}`, 50, 140);

      // Divider
      doc.moveTo(50, 165)
         .lineTo(50 + pageWidth, 165)
         .strokeColor(lineColor)
         .stroke();

      // ===== EXECUTIVE SUMMARY =====
      let y = 185;

      doc.fontSize(14)
         .fillColor(textColor)
         .text('EXECUTIVE SUMMARY', 50, y);

      y += 30;

      // Summary boxes
      const boxWidth = (pageWidth - 30) / 4;

      // Total Emissions
      doc.fontSize(24)
         .fillColor(primaryColor)
         .text(`${data.summary.totalEmissions.toFixed(1)}`, 50, y, { width: boxWidth, align: 'center' });
      doc.fontSize(9)
         .fillColor(lightGray)
         .text('kg CO₂e Total', 50, y + 30, { width: boxWidth, align: 'center' });

      // Projects
      doc.fontSize(24)
         .fillColor(textColor)
         .text(`${data.summary.projectCount}`, 50 + boxWidth + 10, y, { width: boxWidth, align: 'center' });
      doc.fontSize(9)
         .fillColor(lightGray)
         .text('Projects', 50 + boxWidth + 10, y + 30, { width: boxWidth, align: 'center' });

      // Scans
      doc.fontSize(24)
         .fillColor(textColor)
         .text(`${data.summary.totalScans}`, 50 + (boxWidth + 10) * 2, y, { width: boxWidth, align: 'center' });
      doc.fontSize(9)
         .fillColor(lightGray)
         .text('Scans', 50 + (boxWidth + 10) * 2, y + 30, { width: boxWidth, align: 'center' });

      // Trend
      const trendText = data.summary.trend < 0
        ? `▼ ${Math.abs(data.summary.trend).toFixed(0)}%`
        : data.summary.trend > 0
          ? `▲ ${data.summary.trend.toFixed(0)}%`
          : '● 0%';
      const trendColor = data.summary.trend < 0 ? '#10b981' : data.summary.trend > 0 ? '#ef4444' : textColor;

      doc.fontSize(24)
         .fillColor(trendColor)
         .text(trendText, 50 + (boxWidth + 10) * 3, y, { width: boxWidth, align: 'center' });
      doc.fontSize(9)
         .fillColor(lightGray)
         .text('Trend', 50 + (boxWidth + 10) * 3, y + 30, { width: boxWidth, align: 'center' });

      y += 70;

      // Divider
      doc.moveTo(50, y)
         .lineTo(50 + pageWidth, y)
         .strokeColor(lineColor)
         .stroke();

      y += 20;

      // ===== EMISSIONS BY PROJECT =====
      doc.fontSize(14)
         .fillColor(textColor)
         .text('EMISSIONS BY PROJECT', 50, y);

      y += 25;

      // Table header
      doc.fontSize(9)
         .fillColor(lightGray)
         .text('Project', 50, y)
         .text('Emissions', 250, y)
         .text('% of Total', 330, y)
         .text('Trend', 420, y);

      y += 15;

      doc.moveTo(50, y)
         .lineTo(50 + pageWidth, y)
         .strokeColor(lineColor)
         .stroke();

      y += 10;

      // Project rows
      for (const project of data.projects.slice(0, 10)) { // Limit to 10
        const trendStr = project.trend < -2
          ? `▼ ${Math.abs(project.trend).toFixed(0)}%`
          : project.trend > 2
            ? `▲ ${project.trend.toFixed(0)}%`
            : '● No change';
        const rowTrendColor = project.trend < -2 ? '#10b981' : project.trend > 2 ? '#ef4444' : lightGray;

        doc.fontSize(10)
           .fillColor(textColor)
           .text(project.name.substring(0, 30), 50, y)
           .text(`${project.emissions.toFixed(1)} kg`, 250, y)
           .text(`${project.percentOfTotal.toFixed(0)}%`, 330, y);

        doc.fillColor(rowTrendColor)
           .text(trendStr, 420, y);

        y += 20;

        if (y > 700) break; // Page break protection
      }

      y += 10;

      // ===== EMISSIONS AVOIDED =====
      doc.moveTo(50, y)
         .lineTo(50 + pageWidth, y)
         .strokeColor(lineColor)
         .stroke();

      y += 20;

      doc.fontSize(14)
         .fillColor(textColor)
         .text('EMISSIONS AVOIDED', 50, y);

      y += 25;

      doc.fontSize(10)
         .fillColor(lightGray)
         .text('Through waste removal and optimisation during this period:', 50, y);

      y += 25;

      doc.fontSize(10)
         .fillColor(textColor)
         .text(`Issues fixed: ${data.summary.issuesFixed}`, 70, y)
         .text(`Estimated annual savings: ${data.summary.emissionsAvoided.toFixed(1)} kg CO₂e`, 70, y + 18);

      y += 50;

      // ===== MONTHLY BREAKDOWN =====
      if (data.monthlyBreakdown.length > 0 && y < 600) {
        doc.moveTo(50, y)
           .lineTo(50 + pageWidth, y)
           .strokeColor(lineColor)
           .stroke();

        y += 20;

        doc.fontSize(14)
           .fillColor(textColor)
           .text('MONTHLY BREAKDOWN', 50, y);

        y += 25;

        // Table header
        doc.fontSize(9)
           .fillColor(lightGray)
           .text('Month', 50, y)
           .text('Emissions', 200, y)
           .text('Scans', 300, y)
           .text('Issues Fixed', 400, y);

        y += 15;

        doc.moveTo(50, y)
           .lineTo(50 + pageWidth, y)
           .strokeColor(lineColor)
           .stroke();

        y += 10;

        for (const month of data.monthlyBreakdown.slice(-6)) { // Last 6 months
          doc.fontSize(10)
             .fillColor(textColor)
             .text(formatMonth(month.month), 50, y)
             .text(`${month.emissions.toFixed(1)} kg`, 200, y)
             .text(`${month.scans}`, 300, y)
             .text(`${month.issuesFixed}`, 400, y);

          y += 18;

          if (y > 700) break;
        }
      }

      // ===== NEW PAGE FOR METHODOLOGY =====
      doc.addPage();
      y = 50;

      doc.fontSize(14)
         .fillColor(textColor)
         .text('METHODOLOGY', 50, y);

      y += 25;

      doc.fontSize(10)
         .fillColor(lightGray)
         .text('Emissions calculated using PEER methodology aligned with', 50, y)
         .text('GHG Protocol Scope 3 (Category 1: Purchased Goods & Services).', 50, y + 15);

      y += 45;

      doc.fontSize(10)
         .fillColor(textColor)
         .text('Calculation factors:', 50, y);

      y += 20;

      doc.fontSize(9)
         .fillColor(lightGray)
         .text('• Bundle size × average monthly page views × energy per byte', 60, y)
         .text('• Energy per byte: 0.6 kWh per GB (The Shift Project data)', 60, y + 15)
         .text('• Grid carbon intensity: 0.233 kg CO₂ per kWh (UK average)', 60, y + 30)
         .text('• Server processing time × requests × energy per compute unit', 60, y + 45);

      y += 80;

      doc.fontSize(10)
         .fillColor(textColor)
         .text('This data is suitable for inclusion in sustainability reports and ESG disclosures.', 50, y);

      y += 20;

      doc.fontSize(9)
         .fillColor(primaryColor)
         .text('Full methodology: https://swynx.oynk.co.uk/methodology', 50, y);

      // ===== FOOTER =====
      y = doc.page.height - 80;

      doc.moveTo(50, y)
         .lineTo(50 + pageWidth, y)
         .strokeColor(lineColor)
         .stroke();

      y += 15;

      doc.fontSize(8)
         .fillColor(lightGray)
         .text(`Report ID: ${data.reportId}`, 50, y)
         .text(`Verify: https://swynx.oynk.co.uk/verify/${data.reportId}`, 50, y + 12);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

export default {
  generateESGPDF
};
