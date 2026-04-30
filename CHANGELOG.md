# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.3.1]: https://github.com/AbdullahBakir97/PortfolioCraft/releases/tag/v0.3.1
[0.3.0]: https://github.com/AbdullahBakir97/PortfolioCraft/releases/tag/v0.3.0
[0.2.0]: https://github.com/AbdullahBakir97/PortfolioCraft/releases/tag/v0.2.0
[0.1.0]: https://github.com/AbdullahBakir97/PortfolioCraft/releases/tag/v0.1.0
