# Swynx: Where We Are Now

*Last updated: 19 February 2026*

---

## The One-Liner

Swynx is a self-hosted CWE-561 security scanner that identifies dead code weaknesses across 26 programming languages, classifies every finding with evidence-backed verdicts, and quantifies the security and business impact in SARIF, GBP, and CO2.

---

## Positioning

**Swynx is a security tool.** CWE-561 is the primary output. Dead code cleanup is the secondary benefit.

Every scan produces a security report with CWE-561 instance counts as the headline. The console, JSON, markdown, SARIF, and dashboard all lead with CWE-561. The SARIF output integrates directly with GitHub Code Scanning using the MITRE CWE taxonomy. The CI gate fails on CWE-561 instances, not "dead files."

This reframe matters because:
- "Remove dead code to tidy up" is a nice-to-have that gets deprioritised
- "Remediate CWE-561 security weaknesses" is a compliance requirement that gets budget
- CISOs, compliance teams, and audit frameworks (ISO 27001, SOC 2) understand CWE identifiers
- GitHub Code Scanning shows CWE-561 in the Security tab — it looks like a real security tool because it is one

---

## What Changed Recently

Two major shifts:

1. **Three-state, evidence-based analysis framework** — moved from binary (dead or not dead) to three states (unreachable, possibly live, live) with structured evidence trails.

2. **CWE-561 as the primary identity** — the tool now leads with security classification, not code cleanup. Every output format frames findings as CWE-561 instances first.

### Before
- Files were flagged as "dead" or not. No nuance.
- The dashboard showed a generic "Safe to Remove" badge on everything.
- The website described a "6-step detection process."
- The word "detection" was used everywhere.

### After
- Every file gets one of three verdicts: **unreachable**, **possibly live**, or **live**.
- Each verdict carries a structured **evidence trail** — entry points searched, analysis method used, dynamic loading checks performed, confidence score (0-1), and the reasoning factors behind that score.
- The dashboard shows **verdict-aware badges**: "95% Unreachable", "Review Required 75%", "Partial 90%", "Not Imported", "No References" — each one specific to what was actually analysed.
- The website describes a **7-stage analysis pipeline**: Search, Scan, Analyse, Document, Report, Qualify, Quantify.
- The language has shifted from "detection" to **"analysis"** in product-facing copy. Blog SEO titles still use "detection" because that's what people search for.

### Why This Matters for the Business
The binary model was a liability. Telling someone a file is "dead" when it might be dynamically loaded by a plugin system is the fastest way to lose trust. The three-state model is honest: we tell you what we know, what we're uncertain about, and why. That's a defensible position in sales conversations, compliance contexts, and technical evaluations.

---

## The Analysis Pipeline

Every scan runs through seven stages. This is the language we use everywhere — CLI verbose output, website how-it-works page, and internal documentation.

| # | Stage | What Happens |
|---|-------|-------------|
| 1 | **Search** | Discover all files in the project. Detect languages, frameworks, monorepo structure. Exclude node_modules, build outputs, generated code, test fixtures. |
| 2 | **Scan** | Parse every file. Extract imports, exports, function definitions. Build the dependency graph. Parallel workers for large repos (chunked at 10K+ files). |
| 3 | **Analyse** | BFS reachability from all entry points. Identify unreachable files. Detect partially dead files (some exports used, some not). Find dead functions within live files. Check for dynamic loading patterns. |
| 4 | **Document** | Assemble the evidence trail for each verdict. Record entry point count and sources, analysis method, dynamic check results, framework coverage, and confidence score with reasoning factors. |
| 5 | **Report** | Format output — console (with coloured verdict badges), JSON (full structured data), Markdown (tables), or SARIF (IDE integration). |
| 6 | **Qualify** | Optional. Run local AI (Ollama) to validate verdicts. Auto-learn false positives. Human review workflow for AI suggestions. |
| 7 | **Quantify** | Calculate cost impact in GBP, carbon emissions in CO2e, bundle size contribution, developer time to clean up, and **security risk** (CWE-561 exposure). |

---

## CWE-561: The Security Story

Every unreachable file Swynx finds is a **CWE-561** instance. That's not a marketing angle — it's the literal MITRE classification. [CWE-561: Dead Code](https://cwe.mitre.org/data/definitions/561.html) states: *"The software contains dead code, which can never be executed."*

This matters because:

- **Dead code increases attack surface.** Unreachable files still get compiled, bundled, and deployed. A vulnerability in dead code is still exploitable if an attacker can reach it through a different path than your application uses.
- **Dead code hides real bugs.** Apple's "goto fail" SSL bug (CVE-2014-1266) was a single unreachable line that silently bypassed SSL certificate verification on 500 million devices for 18 months. It was dead code — and it was catastrophic.
- **Compliance frameworks care.** ISO 27001 and SOC 2 both require organisations to manage unnecessary code. CWE-561 gives that requirement a formal identifier.
- **It reframes the sale.** "Remove dead code to tidy up" is a nice-to-have. "Remediate CWE-561 security weaknesses across your codebase" is a compliance requirement.

### Where CWE-561 is today

| Surface | CWE-561 Present? | Notes |
|---------|------------------|-------|
| Sales emails | Yes | Outreach mentions MITRE, Apple goto fail |
| Blog posts | Yes | Apple goto fail article, blog index, GitHub Action page |
| Prospect reports | Yes | Badge in HTML template |
| Analysis engine | **Yes** | Every verdict carries `cwe: 'CWE-561'` at top level and in evidence |
| SARIF output | **Yes** | Full CWE taxonomy (MITRE CWE v4.14), 3 rules with CWE relationships, every result tagged |
| Console output | **Yes** | "CWE-561 instances: N" in summary, sections labelled "CWE-561: Dead Files/Functions" |
| JSON output | **Yes** | `cwe` field on every dead file and function |
| Markdown output | **Yes** | CWE-561 column in table, count in summary |
| Dashboard | **Yes** | "CWE-561 Findings" stat card, "CWE-561: Dead Code" section heading, CWE column in table |
| Evidence trail | **Yes** | `cwe: 'CWE-561'` in every evidence object |


## What the Tool Can Do Today

### Core: Dead Code Analysis
- **26 languages** — JS/TS, Python, Go, Java, Kotlin, C#, PHP, Ruby, Rust, Swift, Dart, Scala, Elixir, Haskell, F#, OCaml, Julia, Zig, Nim, Erlang, Crystal, V, Perl, Clojure, VB.NET, CSS
- **File-level and export-level** — finds whole dead files AND individual unused exports within live files
- **Dead function detection** — finds private/unexported functions that nothing calls, across all supported languages
- **Three-state verdicts** with structured evidence
- **Framework-aware** — auto-detects 20+ frameworks (React, Next.js, Express, Django, Spring Boot, Angular, etc.) and understands their entry point conventions
- **Monorepo-aware** — Turborepo, npm/pnpm/Yarn workspaces, Lerna, Cargo workspaces, Go workspaces, .NET solutions, Bazel, Buck

### Auto-Fix
- `--fix` removes dead files with a pre-fix snapshot for rollback
- Cleans imports in live files that referenced deleted files
- Cleans barrel file (index.ts) re-exports that point to dead modules
- Optional git commit after fix
- Skips `possibly-live` files by default (requires `--include-uncertain` to override)
- Confidence threshold gate (default 0.8)
- `swynx rollback` restores from any snapshot

### Security Scanning
- **CWE-561 (Dead Code)** — every unreachable file is a CWE-561 instance by definition. All output formats (console, JSON, markdown, SARIF, dashboard) now explicitly tag findings with CWE-561. The SARIF reporter uses the full MITRE CWE taxonomy so GitHub Code Scanning recognises and categorises the findings.
- npm audit integration for known vulnerabilities in dependencies
- CWE pattern matching for vulnerable function usage
- Severity categorisation (critical/high/medium/low)
- Exploitability assessment (real risk vs audit noise)
- Evidence: file locations, import chains, usage patterns
- **The connection:** dead code with known CVEs is doubly dangerous — it's unreachable by the application but still compiled and deployed, meaning an attacker who finds an alternative path to it hits unpatched code that nobody monitors.

### Dependency Analysis
- Unused dependency detection (cross-references manifest against actual imports)
- Package sizing from node_modules
- Alternative package suggestions (e.g., moment -> dayjs)
- Outdated dependency detection with migration guides
- Unmaintained package flagging (no update in 2+ years)

### License Compliance
- SPDX identifier categorisation for 70+ licenses
- Risk levels: permissive (MIT, Apache), copyleft (GPL, AGPL), restrictive (SSPL)
- Fallback knowledge for 100+ well-known packages

### Carbon & Cost Reporting
- GHG Protocol Scope 3, Category 11 aligned methodology
- Location-specific grid intensity (Ember 2022 data)
- Green hosting factor
- Outputs: grams CO2/month, annual cost in GBP, relatable comparisons (trees, car miles)
- CSRD/SECR reporting ready

### Duplicate Code Detection
- Function-level content hashing and similarity scoring
- Configurable threshold (default 85%)
- Smart exclusion for expected patterns (React hooks, icon components)

### Asset Analysis
- Unused image/font/video detection
- Optimisation recommendations (WebP, AVIF, compression)
- Size thresholds and lazy-loading hints

### Code Decay Scoring
- Predictive model identifying live files at risk of becoming dead
- 7 weighted factors (velocity decline, import decline, contributor withdrawal, staleness, etc.)
- Tuned on 65 repos across 7 language ecosystems

### Health Score
- 0-100 composite score with weighted deductions across waste, security, licenses, outdated deps, and code patterns

---

## CLI Commands

| Command | Purpose |
|---------|---------|
| `swynx scan .` | Full analysis with all features |
| `swynx scan . --fix` | Analyse then auto-remove dead code |
| `swynx scan . --fix --dry-run` | Preview what would be removed |
| `swynx scan . --ci` | Exit code 1 if dead code found (for CI gates) |
| `swynx scan . --qualify` | Add local AI validation via Ollama |
| `swynx scan . --format json` | Machine-readable output |
| `swynx scan . --format sarif` | IDE integration output |
| `swynx verify .` | Re-scan and compare with previous results |
| `swynx qualify <file>` | Re-qualify saved JSON without re-scanning |
| `swynx rollback` | Undo the most recent --fix |
| `swynx rollback --list` | Show available rollback snapshots |
| `swynx learn false-positive <file>` | Teach the scanner to skip a file |
| `swynx learn show` | Show all learned patterns |
| `swynx learn review` | Interactive review of AI suggestions |
| `swynx learn reset` | Clear all learned patterns |
| `swynx dashboard` | Launch web dashboard on port 8999 |
| `swynx train` | Regenerate AI training data |

---

## Output Formats

| Format | Use Case |
|--------|----------|
| **Console** | Human terminal output. Verdict badges with confidence percentages, evidence summaries, colour-coded. |
| **JSON** | CI/CD pipelines, programmatic consumption. Full structured data including all evidence fields. |
| **Markdown** | GitHub PR comments, documentation. Tables with verdict column. |
| **SARIF** | IDE integration (VS Code, JetBrains), GitHub Code Scanning. Maps unreachable to warnings, possibly-live to notes. Full CWE-561 taxonomy references. |

---

## The Dashboard

24 pages served at `localhost:8999`. Key sections:

- **Overview** — health score, alerts, comparison with previous scans
- **Waste** — dead code files with verdict badges, evidence trails, quarantine workflow, unused deps with "Not Imported" badges, unused assets with "No References" badges
- **Security** — vulnerabilities with severity badges, exploitability, fix recommendations
- **Emissions** — carbon footprint with adjustable visitor counts, ESG export
- **Dependencies** — package tree, sizes, costs, alternatives, usage chains
- **Licenses** — compliance categorisation by risk level
- **Duplicates** — similar code blocks across codebase
- **Assets** — image optimisation, unused assets, size analysis
- **History** — scan trends over time
- **Action List** — prioritised fixes ranked by impact
- **Quick Fixes** — one-click console.log removal, unused variable cleanup
- **Settings** — cost assumptions (hourly rate, hosting costs, visitor counts)

---

## How It's Sold

**Price:** £2,000 one-off. One license, one user, up to 3 projects. Everything included.

**Renewal:** £500/year (optional). Covers updates and support. If they don't renew, the tool keeps working — they just don't get new versions.

**Volume:** 10+ licenses get tiered discounts with a dedicated account manager.

**Free tier:** Scan any public GitHub repo on swynx.io. No signup.

**Positioning:** "No tiers. No per-seat confusion. No surprise invoices."

**Deployment:** Self-hosted only. Code never leaves the customer's network. Air-gapped deployment supported.

---

## Who It's For

Three target audiences with dedicated landing pages:

### Engineering Leaders
*"You know there's dead code but you can't quantify it."*
Health score (0-100), technical debt cost in GBP, risk visibility, carbon metrics. The sell is: you get a number to put on a slide.

### DevOps / Platform Teams
*"Builds are slow. Docker images are bloated with unused code."*
CI/CD integration (one step, under 3 minutes), quality gates, self-hosted. The sell is: add one line to your pipeline.

### Sustainability / ESG Teams
*"Digital products generate CO2 that nobody tracks."*
GHG Protocol alignment, CSRD/SECR compliance, B Corp metrics. The sell is: report on digital waste in your sustainability disclosure.

---

## Website Content

The site has ~130 pages:

- **12 language pages** — one per major language (JS, Python, Go, Java, etc.)
- **10 framework pages** — React, Next.js, Angular, Vue, Express, Django, Rails, Laravel, Spring Boot, Nuxt
- **9 comparison pages** — SonarQube, Knip, Snyk, Semgrep, CodeClimate, Trunk, Depcheck, Dependabot, ts-prune
- **3 audience pages** — engineering leaders, devops, sustainability
- **4 feature pages** — auto-fix, dependencies, ESG, security scanning
- **76 blog posts** covering: dead code by language (28), dead code by framework (14), business value (11), compliance/security (5), sustainability (2), benchmark studies (3), conceptual guides (8), SEO content (5)
- **Core pages** — home, about, pricing, how-it-works, docs, changelog, scan, integrations

---

## Benchmark Data We Cite

| Claim | Source |
|-------|--------|
| 26 languages supported | Language parser count in codebase |
| 3,000,000+ files validated | Batch scan runs across open source repos |
| 1,001 repos scanned | "We scanned 1,000 repos" study |
| 4.09% average dead code rate | Aggregate from 1,001 repo study |
| 0 false positives on React, Next.js, Angular, n8n, Airflow | Individual repo validation runs |
| Under 30 seconds for 5,000-file project | Performance benchmarks |
| 2-3 minutes for 50,000+ file monorepos | Performance benchmarks |

---

## Language Rules

These are the terminology conventions now in use across the product:

| Use This | Not This | Why |
|----------|----------|-----|
| **CWE-561 security analysis** | Dead code **detection** | CWE-561 is the MITRE classification. Lead with security; "dead code" is the explanation. Exception: SEO titles keep "detection" for search. |
| **Unreachable** | **Dead** | More precise. "Dead" is kept as shorthand in casual copy but the formal verdict is "unreachable." |
| **Possibly live** | **Uncertain** / **maybe dead** | Acknowledges the file might have a legitimate dynamic use. |
| **Evidence trail** | **Reason** / **explanation** | Structured, auditable, not a guess. |
| **Confidence score** | **Accuracy** | Per-verdict, not a global claim. A file has 95% confidence, not 95% accuracy. |
| **Three states** | **Binary** / **dead or not dead** | Always describe the three-state model when explaining how the tool works. |
| **7-stage pipeline** | **6 steps** / **scan process** | Search, Scan, Analyse, Document, Report, Qualify, Quantify. The blog's "6-step cleanup workflow" is separate — that's what users do, not what the tool does internally. |
| **Not Imported** | **Safe to Remove** (for deps) | Evidence-specific badge. We searched for imports and found none. |
| **No References** | **Safe to Remove** (for assets) | Evidence-specific badge. We searched for file references and found none. |
| **Verdict** | **Result** / **finding** | A verdict is backed by evidence. A result is just data. |

---

## What's Next (Potential Directions)

1. **Code Decay as a feature** — the predictive model exists but isn't surfaced prominently. "Files at risk of becoming dead" is a compelling story for engineering leaders who want to prevent problems, not just clean up after them.

2. **Evidence in marketing** — the three-state model and evidence trails are now in the product but barely mentioned in comparison pages and blog posts. Every competitor comparison could include "they give you a list; we give you a verdict with evidence."

3. **AI qualification as a differentiator** — local LLM validation is unique. No competitor offers "AI second opinion on every verdict, running on your own hardware." This could be a headline feature.

4. **The "six-step cleanup workflow" vs "7-stage pipeline"** — these are different things and that's fine, but we should be clearer about it. The pipeline is how Swynx analyses. The six steps are how a human cleans up. Both are valid.

5. **Dashboard as the product** — 24 pages of analysis is substantial. The CLI is how developers interact, but the dashboard is how engineering leaders and sustainability teams see value. The dashboard could carry more of the sales narrative.

6. **Compliance packaging** — ISO 27001, SOC 2, CSRD, SECR are all mentioned. Packaging scan reports as audit-ready compliance documents (not just developer tool output) could open a different buyer. CWE-561 tagging makes this much easier — the report already speaks the auditor's language.

7. **The accuracy claim** — we removed the "99.9998%" claim from some pages. The zero-FP-on-major-projects story is stronger because it's verifiable. Consider leading with specific project names rather than aggregate percentages.

8. **Dead code + CVE cross-referencing** — "You have 47 unreachable files that contain dependencies with known CVEs. These are unmonitored, unpatched, and still deployed." That's a finding that gets budget approved.
