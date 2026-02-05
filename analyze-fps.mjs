import { readdirSync, readFileSync } from 'fs';

const dir = './results/training-data';
const files = readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_'));

let generated = [], plugin = [], migration = [];

for (const f of files) {
  const data = JSON.parse(readFileSync(dir + '/' + f));
  if (!data.deadFileDetails) continue;
  for (const d of data.deadFileDetails) {
    const cat = d.analysis?.category;
    if (cat === 'generated-code') generated.push({ repo: data.repo, path: d.path });
    if (cat === 'plugin') plugin.push({ repo: data.repo, path: d.path });
    if (cat === 'migration') migration.push({ repo: data.repo, path: d.path });
  }
}

console.log('=== Generated-code (' + generated.length + ') ===');
const byRepo = {};
for (const g of generated) {
  byRepo[g.repo] = byRepo[g.repo] || [];
  byRepo[g.repo].push(g.path);
}
for (const [repo, paths] of Object.entries(byRepo).sort((a,b) => b[1].length - a[1].length)) {
  console.log(repo + ': ' + paths.length);
  paths.forEach(p => console.log('  ' + p));
}

console.log('\n=== Plugin (' + plugin.length + ') ===');
plugin.forEach(p => console.log(p.repo + ': ' + p.path));

console.log('\n=== Migration (' + migration.length + ') ===');
migration.forEach(p => console.log(p.repo + ': ' + p.path));
