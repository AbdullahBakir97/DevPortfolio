# DevPortfolio

[![Marketplace](https://img.shields.io/badge/marketplace-DevPortfolio-blue)](https://github.com/marketplace/actions/devportfolio)
[![CI](https://github.com/AbdullahBakir97/DevPortfolio/actions/workflows/ci.yml/badge.svg)](https://github.com/AbdullahBakir97/DevPortfolio/actions/workflows/ci.yml)
[![CodeQL](https://github.com/AbdullahBakir97/DevPortfolio/actions/workflows/codeql.yml/badge.svg)](https://github.com/AbdullahBakir97/DevPortfolio/actions/workflows/codeql.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node 20 LTS](https://img.shields.io/badge/node-20.18.0%20LTS-339933?logo=node.js&logoColor=white)](.nvmrc)

Generate a verifiable professional portfolio from your GitHub history — README section, JSON Resume, PDF CV, and SVG stat cards — in a single workflow run.

> **Privacy & scope.** Uses only `public_repo` and `read:user`. No data leaves your runner.

## Quickstart (60s)

Add a workflow to your profile repository (`<your-login>/<your-login>`):

```yaml
# .github/workflows/portfolio.yml
name: Portfolio

on:
  schedule:
    - cron: '17 4 * * *'   # daily refresh
  workflow_dispatch:

permissions:
  contents: write

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: AbdullahBakir97/DevPortfolio@v1
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
```

Then in your `README.md`, drop the markers wherever you want generated content:

```markdown
<!-- DEVPORTFOLIO:START -->
<!-- DEVPORTFOLIO:END -->
```

That's it. The next run inserts your stack, top projects, activity summary, and a generation receipt between the markers.

## What gets generated

| Artifact      | Path (default)        | Source                                        |
| ------------- | --------------------- | --------------------------------------------- |
| README block  | `README.md`           | Eta templates per locale, between markers     |
| JSON Resume   | `profile.json`        | `schemaVersion: "1.0.0"`                      |
| PDF CV        | `cv.pdf`              | `@react-pdf/renderer`                         |
| SVG cards     | `assets/cards/*.svg`  | Satori + `@resvg/resvg-js`                    |

Each artifact is independent — set the matching path input to `''` to skip it.

## Inputs

| Name             | Default                          | Description                                                                                  |
| ---------------- | -------------------------------- | -------------------------------------------------------------------------------------------- |
| `token`          | _required_                       | `secrets.GITHUB_TOKEN` is enough for public-repo data; PAT unlocks private signal.           |
| `user`           | token owner                      | GitHub login to profile.                                                                     |
| `sections`       | `header,stack,projects,activity` | Comma-separated README sections in order.                                                    |
| `locale`         | `en`                             | Template locale. `en` and `ar` ship at launch.                                               |
| `output-readme`  | `README.md`                      | README to update between markers. Empty string to skip.                                      |
| `output-json`    | `profile.json`                   | JSON Resume output path. Empty string to skip.                                               |
| `output-pdf`     | `cv.pdf`                         | PDF CV output path. Empty string to skip.                                                    |
| `output-svg-dir` | `assets/cards`                   | Directory for stat cards. Empty string to skip.                                              |
| `config-file`    | `.devportfolio.yml`              | Optional YAML config to override defaults (filters, weights, sections).                      |
| `commit`         | `true`                           | Commit generated artifacts back to the repo on a non-`dry-run`.                              |
| `commit-message` | `chore: refresh portfolio`       | Commit message used when committing artifacts.                                               |
| `dry-run`        | `false`                          | Run end-to-end without writing files or committing.                                          |
| `explain`        | `false`                          | Print scoring/classification reasoning to the job log.                                       |

## Outputs

| Name             | Description                                       |
| ---------------- | ------------------------------------------------- |
| `readme-updated` | `true` if the README was changed by this run.    |
| `json-path`      | Path of the generated JSON Resume file.           |
| `pdf-path`       | Path of the generated PDF CV.                     |
| `cards-dir`      | Directory containing generated SVG cards.         |
| `summary`        | One-line summary of the generated portfolio.      |

## How scoring works

Stack proficiency is computed as `LOC × recency_decay × repo_maturity` per language, then ranked and bucketed into proficiency tiers. Project significance excludes forks, archives, and tutorial-shaped repos by default; you can override the filter rules in `.devportfolio.yml`. Domain classification (Backend / Frontend / DevOps / ML / Mobile) uses a deterministic, weighted-keyword classifier over languages, topics, and dependency manifests.

Run with `explain: true` to see every weight, decision, and tie-break in the job log.

## Local CLI

```bash
npx devportfolio generate --user AbdullahBakir97 --dry-run --explain
```

Same engine, no Action runtime required.

## Configuration file

```yaml
# .devportfolio.yml
sections: [header, stack, projects, activity]
locale: en
filters:
  exclude_archived: true
  exclude_forks: true
  exclude_topics: [tutorial, exercise]
weights:
  loc: 0.5
  recency: 0.3
  maturity: 0.2
projects:
  pinned_first: true
  max: 6
```

## Development

```bash
pnpm install
pnpm build       # turbo run build across workspaces
pnpm test        # vitest
pnpm bundle      # ncc → packages/action/dist/index.js → dist/
pnpm verify      # the full pre-push gate (lint + typecheck + test + bundle)
```

The repo is a pnpm + Turborepo monorepo:

- `packages/action` — thin Action entrypoint (consumes `@actions/*`)
- `packages/core` — framework-free engine (Octokit, ingestion, scoring, classification)
- `packages/renderers` — markdown / json-resume / pdf / svg
- `packages/cli` — `npx devportfolio`
- `apps/docs` — Starlight site

## Security

Reports go to [SECURITY.md](SECURITY.md). Builds are reproducible via `actions/attest-build-provenance`; SBOMs are generated on every release with `anchore/sbom-action`.

## License

Apache-2.0. See [LICENSE](LICENSE).
