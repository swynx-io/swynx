// src/knowledge/learner.mjs
// Records false positives and new patterns discovered during verification

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEARNED_DIR = join(__dirname, 'learned');

function ensureLearnedDir() {
  if (!existsSync(LEARNED_DIR)) {
    mkdirSync(LEARNED_DIR, { recursive: true });
  }
}

function readJsonFile(filePath, defaultValue) {
  if (!existsSync(filePath)) return defaultValue;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return defaultValue;
  }
}

function writeJsonFile(filePath, data) {
  ensureLearnedDir();
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

export async function recordFalsePositive(data) {
  const { file, repo, reason, patternType, suggestedFix } = data;

  const fpPath = join(LEARNED_DIR, 'false-positives.json');
  const existing = readJsonFile(fpPath, { false_positives: [] });

  existing.false_positives.push({
    id: `fp-${Date.now()}`,
    file,
    repo,
    reason,
    patternType,
    suggestedFix,
    discovered: new Date().toISOString(),
    status: 'new'
  });

  writeJsonFile(fpPath, existing);

  await logChange({
    type: 'false-positive-discovered',
    data: { file, repo, reason }
  });

  return existing.false_positives[existing.false_positives.length - 1];
}

export async function addPattern(pattern) {
  const newPatternsPath = join(LEARNED_DIR, 'new-patterns.json');
  const existing = readJsonFile(newPatternsPath, { patterns: [] });

  const entry = {
    ...pattern,
    added: new Date().toISOString(),
    status: 'pending-review'
  };

  existing.patterns.push(entry);
  writeJsonFile(newPatternsPath, existing);

  await logChange({
    type: 'pattern-added',
    data: pattern
  });

  return entry;
}

export async function promotePattern(patternId) {
  const newPatternsPath = join(LEARNED_DIR, 'new-patterns.json');
  const existing = readJsonFile(newPatternsPath, { patterns: [] });

  const pattern = existing.patterns.find(p => p.id === patternId);
  if (pattern) {
    pattern.status = 'promoted';
    pattern.promotedAt = new Date().toISOString();
    writeJsonFile(newPatternsPath, existing);

    await logChange({
      type: 'pattern-promoted',
      data: { id: patternId }
    });
  }

  return pattern;
}

export async function logChange(change) {
  const changelogPath = join(LEARNED_DIR, 'changelog.json');
  const existing = readJsonFile(changelogPath, { changes: [] });

  existing.changes.push({
    ...change,
    timestamp: new Date().toISOString()
  });

  writeJsonFile(changelogPath, existing);
}

export function getLearnedStats() {
  const fpPath = join(LEARNED_DIR, 'false-positives.json');
  const npPath = join(LEARNED_DIR, 'new-patterns.json');
  const clPath = join(LEARNED_DIR, 'changelog.json');

  const fps = readJsonFile(fpPath, { false_positives: [] });
  const nps = readJsonFile(npPath, { patterns: [] });
  const cl = readJsonFile(clPath, { changes: [] });

  return {
    falsePositives: fps.false_positives.length,
    newPatterns: nps.patterns.length,
    promotedPatterns: nps.patterns.filter(p => p.status === 'promoted').length,
    totalChanges: cl.changes.length
  };
}

// ── AI-driven pending / approved flow ──────────────────────────────────────

const PENDING_PATH = join(LEARNED_DIR, 'pending.json');
const APPROVED_PATH = join(LEARNED_DIR, 'approved.json');

function readPending() {
  return readJsonFile(PENDING_PATH, { pending: [] });
}

function writePending(data) {
  writeJsonFile(PENDING_PATH, data);
}

function readApproved() {
  return readJsonFile(APPROVED_PATH, { items: [] });
}

function writeApproved(data) {
  writeJsonFile(APPROVED_PATH, data);
}

/**
 * Record an AI-identified potential false positive as pending human review.
 */
export async function recordPendingAI(entry) {
  const data = readPending();
  data.pending.push({
    id: `fp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ...entry,
    discovered: new Date().toISOString(),
    status: 'pending',
  });
  writePending(data);

  await logChange({ type: 'ai-pending-added', data: { file: entry.file, reason: entry.reason } });
}

/**
 * Record an AI-identified false positive as auto-approved.
 */
export async function recordApprovedAI(entry) {
  const data = readApproved();
  data.items.push({
    id: `fp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ...entry,
    discovered: new Date().toISOString(),
    approved_by: 'auto-learn',
  });
  writeApproved(data);

  // Also add to the main false-positives so the scanner picks it up
  await recordFalsePositive({
    file: entry.file,
    reason: `[auto-learn] ${entry.reason}`,
    patternType: entry.suggestedPattern,
  });

  await logChange({ type: 'ai-auto-approved', data: { file: entry.file, reason: entry.reason } });
}

/**
 * Get all pending AI suggestions for interactive review.
 */
export function getPendingAI() {
  return readPending().pending.filter(p => p.status === 'pending');
}

/**
 * Approve a pending AI suggestion by ID.
 */
export async function approvePendingAI(id) {
  const data = readPending();
  const item = data.pending.find(p => p.id === id);
  if (!item) return null;

  item.status = 'approved';
  writePending(data);

  // Move to approved
  const approved = readApproved();
  approved.items.push({ ...item, approved_by: 'user' });
  writeApproved(approved);

  // Also add to main false-positives
  await recordFalsePositive({
    file: item.file,
    reason: `[user-approved] ${item.reason}`,
    patternType: item.suggestedPattern,
  });

  await logChange({ type: 'ai-user-approved', data: { id, file: item.file } });
  return item;
}

/**
 * Reject a pending AI suggestion by ID.
 */
export async function rejectPendingAI(id) {
  const data = readPending();
  const idx = data.pending.findIndex(p => p.id === id);
  if (idx === -1) return null;

  const item = data.pending.splice(idx, 1)[0];
  writePending(data);

  await logChange({ type: 'ai-rejected', data: { id, file: item.file } });
  return item;
}
