# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.2] — 2026-05-01

### Fixed
- **Per-project intro article inflection** in the university summary. v0.4.1 fixed `"I'm a aspiring..."` → `"I'm an aspiring..."` on the opening line, but didn't generalize the helper. Per-project intros were still emitting `"A active ml project"` and `"A archived backend project"` for repos with vowel-starting `recencyBucket`. Now uses `startsWithVowelSound` consistently. Result: `"An active ml project built primarily in Python..."`.
- Fixed pre-existing biome 2 lint errors in `packages/core/test/summary/build.test.ts` (non-null assertions on indexed access). Replaced `repos[N]!` with explicit destructuring + a single guard. No behavior change; biome's lint cache had been hiding these on prior CI runs.

### Notes
- Pattern repeating from v0.4.0 → v0.4.1: fix article inflection at one site, find another site that needed the same helper. Worth recording: when a prose-formatting helper is needed in one place, search the whole renderer module for every other place that touches the same shape of output.

## [0.4.1] — 2026-05-01

Output-quality fixes for the v0.4.0 summary renderers, found by reading the actual rendered Markdown against `AbdullahBakir97`'s real history. v0.4.0 shipped the scaffolding correctly; v0.4.1 makes the output read like a clean draft instead of a near-clean one.

### Fixed
- **University opening sentence used the entire headline string as a noun phrase.** v0.4.0 produced gibberish like `"I'm a aspiring backend engineer · Python, TypeScript · 85 public repos · 241 commits with 85 public repositories on GitHub spanning backend and ml."` Now the renderer extracts only the role-noun (the segment before the first ` · `), and uses correct article inflection (`an aspiring backend engineer`, not `a aspiring`).
- **University year ranges showed only the last-push year** (`(2026)` for a 36-month-old repo). The builder now uses `repo.createdAt` as `firstPushDate` (proxy for "first activity"), and the renderer formats as `(2023–2026)` when start ≠ end year. v0.5 may swap in real first-commit dates from REST.
- **University learning-trajectory entries duplicated the year sentence** — the builder's `summary` already says "Created N repos primarily in X and Y, focused on A and B," but the renderer added a near-identical `"Created N repositories…"` second sentence. The renderer now emits only the builder's canonical sentence.
- **Self-directed-scope paragraph welded `longestProjectMonths` and `mostStarredRepo` into one parenthetical**, making them look like the same repo (they're typically not). Now rendered as two separate sentences with explicit subjects.
- **`Jupyter Notebook` and `Roff` no longer appear as skills.** GitHub returns these as "languages" but they're file formats / man-page markup, not engineering skills. Added a `SKILL_DENYLIST` in the builder.

### Notes
- This is a pure rendering / data-shape fix. No new inputs, outputs, or modes. Identical input always produces different (better) output than v0.4.0.
- Discovery method: ran v0.4.0's dogfood against `AbdullahBakir97`, opened the resulting `summary-cv.md` and `summary-uni.md`, read them as a human reviewer. The bugs were all visible at first read. Worth recording as a v0.4 lesson: "shipped scaffolding correctly" ≠ "shipped useful output" — always read the rendered artifact, not just the test snapshots.

## [0.4.0] — 2026-05-01

Application-ready summaries. The original use case behind PortfolioCraft was: *"I needed a summary of my projects so I can edit my CV and write university applications."* v0.4 ships that, end-to-end. Additive — every existing v0.1+v0.2+v0.3 workflow continues unchanged.

### Added
- **New `summary` Action mode** and `summary` CLI subcommand. The `mode` enum widens to `portfolio | audit | both | summary | all`. The new `all` value runs portfolio + audit + summary in one pass.
- **Three new paste-ready Markdown outputs**, each behind its own idempotent marker pair so they can be spliced into a curated README:
  - `summary-cv.md` (`<!-- PORTFOLIOCRAFT-CV:START -->` / `END`) — compact CV section: header, skills tiers (strong / working / familiar), selected projects with one-paragraph blurbs, activity summary. Designed to paste into a real CV (LaTeX, Word, Google Docs) and lightly edit.
  - `summary-uni.md` (`<!-- PORTFOLIOCRAFT-UNI:START -->` / `END`) — narrative format for university motivation letters and personal statements: learning trajectory year-by-year, technical depth per domain, scope-of-self-directed-work paragraph.
  - `summary-case-studies.md` (`<!-- PORTFOLIOCRAFT-CASE-STUDIES:START -->` / `END`) — one section per top project: stack, duration, scale, overview, domain, topics. For portfolio decks and detailed application supplements.
- **New CLI flags:** `--format cv|uni|case-studies|all`, `--cv <path>`, `--uni <path>`, `--case-studies <path>`, `--projects-max <n>`, `--dry-run`.
- **New Action inputs:** `summary-format`, `summary-output-cv`, `summary-output-uni`, `summary-output-case-studies`, `summary-projects-max`.
- **New Action outputs:** `summary-cv-path`, `summary-uni-path`, `summary-case-studies-path`.
- **`audit-check-run` input** (default `true`) — closes the lingering v0.2 spec gap. Posts a GitHub Checks API summary with severity table + top-10 findings on every audit run. Soft-skips with a warning if the workflow lacks `permissions: checks: write`.
- **New `withRetry`-comparable helpers** at the summary boundary — schemas validate, builds are pure functions, no LLM, no API key, no hosted backend.

### Quality
- 99.6% statement / 81.3% branch coverage on `packages/core/src/summary/`.
- 138 new test assertions across 7 new test files (build, CV / Uni / case-studies renderers, summary markers, check-run summary).
- Total project tests: 222 (up from 184 in v0.3.2).
- Determinism property test: identical input → byte-identical Markdown across the CV / Uni / case-studies renderers.

### Notes
- All summary text is generated **deterministically** from your existing GitHub data + the v0.1 scoring + classification heuristics. No LLM, no API key, no hosted backend. Output is intentionally a *clean draft* for you to edit, not polished prose.
- The CV mode is intentionally short (under ~1,500 words) — recruiters scan, they don't read.
- The Uni mode adopts academic-application tone: factual, reserved, no marketing language.
- LLM-powered case-study prose, job-fit scoring, and skill extraction remain the v1.1 "AI intelligence layer" theme — they need API key handling and cost controls that an OSS Action alone shouldn't make.

## [0.3.2] — 2026-04-30

### Fixed
- **GraphQL ingest now retries transient GitHub API failures** (5xx, 408, 429, network errors). Two real-world 502 Bad Gateway events on 2026-04-30 killed daily dogfood runs that should have succeeded — this closes that gap. The `@octokit/plugin-retry` plugin only attaches to the REST client; GraphQL had no equivalent until now.
  - `ingestSnapshot` (the user + repos query): retries on 5xx/408/429/network errors with exponential backoff (500ms × 2ⁿ + jitter, max 4 attempts ≈ 8.5s worst case).
  - `ingestAuditExtras` (per-page repo extras + user-PR search): same retry shape.
  - Per-PR timeline (`ingestAuditExtras`'s inner loop): retries with `maxAttempts: 2` only — the existing per-PR try/catch already degrades gracefully to `timeline: null`, so we cap retries to keep the runtime predictable on a brief outage.

### Added
- New `withRetry` and `isRetryableError` exports from `@portfoliocraft/core`. Tiny (60-line) helper, dependency-free; reusable for any future GraphQL-shaped call.
- 14 new tests in `packages/core/test/retry.test.ts` covering the retry classifier (each retryable-error class has positive/negative cases) and the backoff/cap logic.

### Notes
- 4xx errors other than 408/429 (auth/not-found/validation) propagate immediately — those are caller bugs, not transient outages.
- Plain `Error` with no `status`/`code` also doesn't retry — probably a code bug rather than a network blip.

## [0.3.1] — 2026-04-30

### Fixed
- **The `commit` and `commit-message` Action inputs were declared since v0.1.0 but never wired** — `run.ts` had no git logic, so artifacts were written to the runner's filesystem and discarded when the runner shut down. Anyone setting `commit: true` since launch was getting a successful run that committed nothing. **This was silent data loss.** Fixed by adding a real `commitArtifacts` step that:
  - Configures the commit identity to `github-actions[bot]`.
  - Stages only the artifacts the run actually wrote (no over-staging).
  - Skips silently with a structured reason when the diff is empty, on fork PRs, or when the input is `false`.
  - Pushes to `HEAD:${GITHUB_HEAD_REF || GITHUB_REF_NAME}` so the commit lands on the source branch.
- Required workflow permission is now documented prominently: `permissions: contents: write` is needed on the calling workflow for the commit step. Without it, `git push` returns a 403 and the run fails.

### Added
- New Action outputs: `commit-sha` (the pushed commit SHA when applicable, otherwise empty) and `commit-skipped-reason` (one of `commit-disabled | dry-run | fork-pr | no-changes | no-paths`).
- 7 new tests in `packages/action/test/commit.test.ts` covering the commit flow with injected `exec` doubles — opt-out, dry-run, no-paths, fork-pr, no-changes, push-event, and pull_request-event paths.

### Notes
- This is a backwards-compatible patch release. Workflows that set `commit: false` (or the default `true` with `dry-run: true`) keep working unchanged. Workflows that set `commit: true` and expected commits were silently broken before; they now do what the documentation always promised.
- The profile-repo dogfood at `AbdullahBakir97/AbdullahBakir97` (added in v0.2 work) had `commit: true` but never produced `.portfoliocraft/`. The next daily cron after v0.3.1 ships will populate it.

## [0.3.0] — 2026-04-30

Verifiable signal. Replaces v0.2's age-based heuristics with timeline / label / signature evidence. Additive — existing v0.1 / v0.2 workflows continue working unchanged.

### Changed
- **`pr-rot`** now classifies by who's awaiting whom via per-PR timeline introspection. Severity matrix:
  - reviewer-waiting → `low` (informational, not author's responsibility)
  - author-waiting + age > 30 days → `medium`
  - author-waiting + age > 90 days → `high`
  - timeline data unavailable → falls back to v0.2 age-only behavior
- **`bug-debt`** now weights by GitHub issue labels (`severity:critical` × 4, `severity:high` × 3, `bug` × 2, `enhancement` × 0.5, etc.). The threshold (`bug-debt-warn`) now applies to `weightedDebtScore`. The legacy `debtScore` is preserved in finding metadata for backward compat.

### Added
- New finding category `'unverified-employer-context'` (severity `info`). Heuristic check on user.bio company claim vs commit email domains, plus average commit signature ratio. Skips silently if no employer hint is parseable from the profile.
- New `summary.verifiedSignatureRatio` field on `AuditReport` — average commit signature ratio across all repos with stats. `null` when no repos have commit history.
- New CLI flag `--verified-only` filters findings to `unverified-employer-context` and bug-debt with label-multiplier ≥ 2. Stacks with `--severity`.
- New audit Markdown sections in renderer: a `### Verified signal` block (omitted when ratio is null), per-finding label-multiplier line on bug-debt, per-finding awaiting-role line on pr-rot.
- New per-PR GraphQL timeline ingest (bounded to first 50 open PRs, individually try/caught — failures fall back to v0.2 behavior gracefully).
- New per-repo GraphQL extras: 100-commit signature history + 25-issue label sample.

### Quality
- 80.8% statement coverage / 72.4% branch coverage on `packages/core/src/audit/` overall (above the 80% statement target). 99.5% on `src/audit/checks/` specifically.
- 147 tests across the audit suite (+56 over v0.2). Property test guards label-weight order independence.
- Backward-compat preserved: v0.2 cached snapshots still parse — every new field has a Zod `.default(...)` fallback. v0.2 fixtures carrying older AuditReport shapes get the v0.3 fields filled in transparently.

### Notes
- No new GitHub token scopes required — `public_repo` + `read:user` still sufficient. Audit data never leaves the runner.
- The Action surface (`action.yml` inputs) is **unchanged** in v0.3. The `--verified-only` filter is CLI-only; the Action consumes the unfiltered report.
- Performance: cold-cache audit makes ~85 + ~50 GraphQL calls (repos + PRs). 6h cache hits drop daily dogfood to zero API calls.

## [0.2.0] — 2026-04-30

Self-awareness audit subcommand. Additive to v0.1; existing `mode: portfolio` (default) is unchanged.

### Added
- New `audit` mode that surfaces eight categories of self-awareness signals across your public repos and open PRs: stale, license, docs, tests, pr-rot, bug-debt, archived-but-active, archive-suggestion.
- New CLI subcommand: `npx portfoliocraft audit --user <login>`.
- New Action input `mode: portfolio | audit | both` (default `portfolio` — backward-compatible).
- New Action inputs: `audit-output-md`, `audit-output-json`, `audit-fail-on`.
- New Action outputs: `audit-md-path`, `audit-json-path`, `audit-finding-count`, `audit-fail-on-result`.
- Idempotent audit Markdown markers `<!-- PORTFOLIOCRAFT-AUDIT:START -->` / `END` (distinct from portfolio markers).
- AuditReport JSON output with `schemaVersion: "1.0.0"` — Zod-validated, byte-stable across runs given identical input.
- Severity model: `critical | high | medium | low | info`. CLI `--severity` flag and Action `audit-fail-on` input act as filters.
- Configurable via `audit:` block in `.portfoliocraft.yml` — thresholds (`stale-repo-months`, `pr-rot-days`, `bug-debt-warn`), ignore globs, output paths, fail-on threshold.
- 6-hour cache for audit-extras GraphQL data (per-repo license / README / issues + user open PRs), separate from the 24-hour portfolio snapshot cache.

### Quality
- 98% statement coverage on `packages/core/src/audit/` (well above the 80% target). 100% on the eight check implementations.
- 149 new test assertions across 13 new test files. Property test guards finding-sort determinism.

### Notes
- `pr-rot` and `bug-debt` use simplified age-based heuristics in v0.2 (no per-PR timeline introspection or label-aware weighting). v0.3 will add comment-timeline accuracy and label-aware bug-debt scoring.
- No new GitHub token scopes required — `public_repo` + `read:user` still sufficient. Audit data never leaves the runner.

## [0.1.0] — 2026-04-29

Initial release.

### Added
- GitHub Action that generates a verifiable professional portfolio from your GitHub history.
- Outputs: README section (idempotent `<!-- PORTFOLIOCRAFT:START -->` / `END` markers), JSON Resume (`schemaVersion: "1.0.0"`), PDF CV, SVG stat cards.
- Stack proficiency scoring (LOC × recency × repo maturity), with `--explain` mode for full transparency.
- Project significance ranking with real-work filter (excludes forks, archives, and tutorial repos).
- Domain classification: Backend, Frontend, DevOps, ML, Mobile.
- `--dry-run` mode for safe previews.
- `actions/cache` integration with 24h TTL on stable GitHub data.
- Configurable via `action.yml` inputs and an optional `.portfoliocraft.yml`.
- i18n-ready templates: English and Arabic at launch.
- Local CLI: `npx portfoliocraft generate --user <login>`.

### Quality
- 84% statement coverage, 85% branch coverage on `@portfoliocraft/core`.
- TypeScript strict (`noUncheckedIndexedAccess`), Biome lint and format, Vitest, MSW for HTTP mocking.
- CodeQL, Dependabot, build provenance attestations, SBOM on every release.
- Drift-proof `dist/` bundle: rebuilt on Linux in the release workflow before tagging.

### Security
- Action requests minimum scopes: `public_repo` and `read:user`. No data leaves the runner.

[0.4.2]: https://github.com/AbdullahBakir97/PortfolioCraft/releases/tag/v0.4.2
[0.4.1]: https://github.com/AbdullahBakir97/PortfolioCraft/releases/tag/v0.4.1
[0.4.0]: https://github.com/AbdullahBakir97/PortfolioCraft/releases/tag/v0.4.0
[0.3.2]: https://github.com/AbdullahBakir97/PortfolioCraft/releases/tag/v0.3.2
[0.3.1]: https://github.com/AbdullahBakir97/PortfolioCraft/releases/tag/v0.3.1
[0.3.0]: https://github.com/AbdullahBakir97/PortfolioCraft/releases/tag/v0.3.0
[0.2.0]: https://github.com/AbdullahBakir97/PortfolioCraft/releases/tag/v0.2.0
[0.1.0]: https://github.com/AbdullahBakir97/PortfolioCraft/releases/tag/v0.1.0
