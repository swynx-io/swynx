// Stress test Tier 2 language parsers
import { discoverFiles } from '../src/scanner/discovery.mjs';
import { detectLanguage } from '../src/languages/index.mjs';
import { scan } from '../src/scanner/index.mjs';
import { readdirSync } from 'fs';

const tier1 = new Set(['javascript', 'python', 'go', 'java', 'php', 'ruby', 'rust', 'kotlin']);
const repos = readdirSync('/var/www/test-repos');
const langCounts = {};

console.log('Scanning', repos.length, 'repos for Tier 2 languages...\n');

// First pass: find which languages exist
for (const repo of repos) {
  try {
    const files = discoverFiles('/var/www/test-repos/' + repo, { maxDepth: 5 });
    for (const f of files.slice(0, 200)) {
      const lang = detectLanguage(f);
      if (lang && !tier1.has(lang)) {
        langCounts[lang] = langCounts[lang] || { count: 0, repos: new Set() };
        langCounts[lang].count++;
        langCounts[lang].repos.add(repo);
      }
    }
  } catch {}
}

console.log('=== Tier 2 Languages Found ===');
const sorted = Object.entries(langCounts).sort((a,b) => b[1].count - a[1].count);
for (const [lang, data] of sorted) {
  console.log(`${lang.padEnd(12)}: ${String(data.count).padStart(5)} files in ${String(data.repos.size).padStart(3)} repos`);
}

// Second pass: scan top repos for each language
console.log('\n=== Stress Testing Top Repos ===');
const tested = new Set();
for (const [lang, data] of sorted.slice(0, 15)) {
  const repoList = [...data.repos];
  const testRepo = repoList.find(r => !tested.has(r)) || repoList[0];
  if (!testRepo) continue;
  tested.add(testRepo);

  try {
    const result = await scan('/var/www/test-repos/' + testRepo);
    const rate = (result.deadFiles.length / result.summary.totalFiles * 100).toFixed(2);
    console.log(`${lang.padEnd(12)}: ${testRepo.padEnd(30)} -> ${result.deadFiles.length} dead / ${result.summary.totalFiles} (${rate}%)`);
  } catch (e) {
    console.log(`${lang.padEnd(12)}: ${testRepo.padEnd(30)} -> ERROR: ${e.message}`);
  }
}
