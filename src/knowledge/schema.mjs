// src/knowledge/schema.mjs
// Pattern validation schemas

const REQUIRED_LANGUAGE_FIELDS = ['language', 'version', 'file_extensions'];
const REQUIRED_FRAMEWORK_FIELDS = ['framework', 'detection'];
const REQUIRED_PATTERN_FIELDS = ['id', 'name'];

export function validateLanguagePattern(pattern) {
  const errors = [];

  for (const field of REQUIRED_LANGUAGE_FIELDS) {
    if (!pattern[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (pattern.file_extensions && !Array.isArray(pattern.file_extensions)) {
    errors.push('file_extensions must be an array');
  }

  if (pattern.import_resolution?.strategies) {
    for (const strategy of pattern.import_resolution.strategies) {
      if (!strategy.order || !strategy.name) {
        errors.push(`Invalid import resolution strategy: missing order or name`);
      }
    }
  }

  if (pattern.entry_point_annotations) {
    for (const [framework, annotations] of Object.entries(pattern.entry_point_annotations)) {
      if (!Array.isArray(annotations)) {
        errors.push(`entry_point_annotations.${framework} must be an array`);
      }
      for (const anno of annotations) {
        if (!anno.name || !anno.reason) {
          errors.push(`Annotation in ${framework} missing name or reason`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateFrameworkPattern(pattern) {
  const errors = [];

  for (const field of REQUIRED_FRAMEWORK_FIELDS) {
    if (!pattern[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (pattern.detection && typeof pattern.detection !== 'object') {
    errors.push('detection must be an object');
  }

  return { valid: errors.length === 0, errors };
}

export function validatePattern(pattern) {
  const errors = [];

  for (const field of REQUIRED_PATTERN_FIELDS) {
    if (!pattern[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateFalsePositive(fp) {
  const errors = [];

  if (!fp.file) errors.push('Missing file path');
  if (!fp.reason) errors.push('Missing reason');

  return { valid: errors.length === 0, errors };
}
