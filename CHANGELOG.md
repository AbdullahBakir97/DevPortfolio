# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-04-29

Initial release.

### Added
- GitHub Action that generates a verifiable professional portfolio from your GitHub history.
- Outputs: README section (idempotent `<!-- DEVPORTFOLIO:START -->` / `END` markers), JSON Resume (`schemaVersion: "1.0.0"`), PDF CV, SVG stat cards.
- Stack proficiency scoring (LOC × recency × repo maturity), with `--explain` mode for full transparency.
- Project significance ranking with real-work filter (excludes forks, archives, and tutorial repos).
- Domain classification: Backend, Frontend, DevOps, ML, Mobile.
- `--dry-run` mode for safe previews.
- `actions/cache` integration with 24h TTL on stable GitHub data.
- Configurable via `action.yml` inputs and an optional `.devportfolio.yml`.
- i18n-ready templates: English and Arabic at launch.
- Local CLI: `npx devportfolio generate --user <login>`.

### Quality
- 84% statement coverage, 85% branch coverage on `@devportfolio/core`.
- TypeScript strict (`noUncheckedIndexedAccess`), Biome lint and format, Vitest, MSW for HTTP mocking.
- CodeQL, Dependabot, build provenance attestations, SBOM on every release.
- Drift-proof `dist/` bundle: rebuilt on Linux in the release workflow before tagging.

### Security
- Action requests minimum scopes: `public_repo` and `read:user`. No data leaves the runner.

[0.1.0]: https://github.com/AbdullahBakir97/DevPortfolio/releases/tag/v0.1.0
