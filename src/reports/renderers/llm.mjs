/**
 * LLM Prompt Renderer
 *
 * Generates optimized prompts for AI coding assistants (Claude Code, Codex, Cursor, etc.)
 * Focuses on actionable, structured information that AI can work with.
 */

/**
 * Render action list as an LLM-optimized prompt
 */
export function renderLLMPrompt(actionList) {
  const { meta, summary, issues, quickWins } = actionList;

  const lines = [];

  // System context
  lines.push('# Codebase Audit Results - Review These Candidates');
  lines.push('');
  lines.push('You are reviewing potential code quality issues identified by Swynx.');
  lines.push('Each item is a candidate for action - verify before making changes.');
  lines.push('The tool identifies patterns but you make the final call.');
  lines.push('');
  lines.push('## Project Context');
  lines.push('');
  lines.push(`- **Project:** ${meta.project}`);
  lines.push(`- **Path:** ${meta.path}`);
  lines.push(`- **Health Score:** ${meta.healthScore}/100 (${meta.grade || 'N/A'})`);
  lines.push(`- **Total Issues:** ${summary.total} (${summary.critical} critical, ${summary.high} high, ${summary.medium} medium, ${summary.low} low)`);
  lines.push('');

  // High-confidence candidates first
  if (quickWins?.length > 0) {
    lines.push('## Highest-Confidence Candidates (Start Here)');
    lines.push('');
    lines.push('These candidates have the highest confidence and potential impact:');
    lines.push('');

    for (const issue of quickWins) {
      lines.push(`### ${issue.title}`);
      if (issue.description) {
        lines.push(`${issue.description}`);
      }
      if (issue.file) {
        lines.push(`- **File:** \`${issue.file}\``);
      }
      if (issue.fix?.command) {
        lines.push(`- **Verification command:** \`${issue.fix.command}\``);
      }
      if (issue.impact?.cost) {
        lines.push(`- **Saves:** £${issue.impact.cost.toFixed(0)}/year`);
      }
      lines.push('');
    }
  }

  // Critical candidates - high confidence issues
  const criticalIssues = issues.filter(i => i.severity === 'critical');
  if (criticalIssues.length > 0) {
    lines.push('## Critical Candidates (Review First)');
    lines.push('');
    lines.push('These are potential security vulnerabilities or severe issues - verify and address if confirmed:');
    lines.push('');

    for (const issue of criticalIssues) {
      renderIssueForLLM(lines, issue);
    }
  }

  // High priority issues
  const highIssues = issues.filter(i => i.severity === 'high');
  if (highIssues.length > 0) {
    lines.push('## High Priority Issues');
    lines.push('');

    for (const issue of highIssues) {
      renderIssueForLLM(lines, issue);
    }
  }

  // Medium priority - only include if not too many
  const mediumIssues = issues.filter(i => i.severity === 'medium');
  if (mediumIssues.length > 0 && mediumIssues.length <= 20) {
    lines.push('## Medium Priority Issues');
    lines.push('');

    for (const issue of mediumIssues) {
      renderIssueForLLM(lines, issue);
    }
  } else if (mediumIssues.length > 20) {
    lines.push('## Medium Priority Issues');
    lines.push('');
    lines.push(`There are ${mediumIssues.length} medium priority issues. Here are the top 10:`);
    lines.push('');

    for (const issue of mediumIssues.slice(0, 10)) {
      renderIssueForLLM(lines, issue);
    }
  }

  // Guidance for the AI
  lines.push('---');
  lines.push('');
  lines.push('## Guidance');
  lines.push('');
  lines.push('1. Start with highest-confidence candidates - these have the best signal');
  lines.push('2. Review all Critical candidates before moving to High priority');
  lines.push('3. For security vulnerabilities, verify the issue applies before updating packages');
  lines.push('4. For unused file candidates, verify they\'re truly unused before removing');
  lines.push('5. Test changes before committing');
  lines.push('');
  lines.push('When you\'re ready, say "Let\'s review these candidates" and I\'ll help you verify each one.');

  return lines.join('\n');
}

/**
 * Render a single issue in LLM-friendly format
 */
function renderIssueForLLM(lines, issue) {
  lines.push(`### ${issue.title}`);

  if (issue.description) {
    lines.push(issue.description);
  }

  // Key details as structured data
  const details = [];

  if (issue.category) {
    details.push(`**Category:** ${formatCategory(issue.category)}`);
  }

  if (issue.file && issue.file !== 'package.json') {
    details.push(`**File:** \`${issue.file}\``);
  }

  if (issue.locations?.length) {
    const locs = issue.locations.slice(0, 3).map(l => `\`${l.file}:${l.start}\``).join(', ');
    details.push(`**Locations:** ${locs}`);
  }

  if (issue.cve) {
    details.push(`**CVE:** ${issue.cve}`);
  }

  if (issue.exploitable !== undefined) {
    details.push(`**Actually exploitable:** ${issue.exploitable ? 'YES - prioritize this' : 'No'}`);
    if (issue.exploitable && issue.usageLocations?.length) {
      details.push(`**Called at:** \`${issue.usageLocations[0]}\``);
    }
  }

  if (issue.fix?.command) {
    details.push(`**Suggested action:** \`${issue.fix.command}\``);
  }

  if (issue.fix?.effort) {
    details.push(`**Effort:** ${issue.fix.effort}`);
  }

  if (details.length > 0) {
    lines.push('');
    lines.push(details.join('\n'));
  }

  lines.push('');
}

function formatCategory(cat) {
  if (!cat) return 'General';
  return cat.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export default {
  renderLLMPrompt
};
