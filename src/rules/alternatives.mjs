// src/rules/alternatives.mjs
// Package alternatives database

const ALTERNATIVES = {
  'moment': [
    { name: 'date-fns', size: '~15KB', features: 'Modular date utilities' },
    { name: 'dayjs', size: '~2KB', features: 'Moment-like API, plugins' },
    { name: 'luxon', size: '~21KB', features: 'Intl-based, immutable' }
  ],
  'lodash': [
    { name: 'lodash-es', size: 'Tree-shakeable', features: 'ES module version' },
    { name: 'radash', size: '~5KB', features: 'Modern utilities' },
    { name: 'remeda', size: '~5KB', features: 'TypeScript-first' }
  ],
  'jquery': [
    { name: 'vanilla-js', size: '0KB', features: 'Native DOM APIs' },
    { name: 'cash-dom', size: '~6KB', features: 'jQuery-like syntax' }
  ],
  'rxjs': [
    { name: 'xstream', size: '~30KB', features: 'Simpler reactive streams' }
  ],
  'bootstrap': [
    { name: 'tailwindcss', size: 'Build-time', features: 'Utility-first CSS' }
  ]
};

export function getAlternatives(packageName) {
  return ALTERNATIVES[packageName] || [];
}

export default { getAlternatives };
