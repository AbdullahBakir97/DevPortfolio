#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  type AuditFinding,
  type AuditReport,
  buildCvSummary,
  buildReport,
  buildUniSummary,
  type Category,
  createGitHubClient,
  createLogger,
  ingestAuditExtras,
  ingestSnapshot,
  loadConfigFile,
  memoryCache,
  mergeConfigWithInputs,
  runAudit,
  SEVERITY_RANK,
  type Severity,
} from '@portfoliocraft/core';
import {
  applyMarkers,
  renderAuditJson,
  renderAuditMarkdown,
  renderCaseStudiesMarkdown,
  renderCvMarkdown,
  renderJsonResume,
  renderMarkdown,
  renderUniMarkdown,
} from '@portfoliocraft/renderers';
import { Command } from 'commander';

const program = new Command();

program
  .name('portfoliocraft')
  .description('Generate a living portfolio from your GitHub activity')
  .version('0.4.2');

program
  .command('generate')
  .description('Generate portfolio artifacts for a GitHub user')
  .requiredOption('--user <login>', 'GitHub login to profile')
  .option('--token <token>', 'GitHub token (falls back to GITHUB_TOKEN env var)')
  .option('--config <path>', 'Path to .portfoliocraft.yml', '.portfoliocraft.yml')
  .option('--locale <locale>', 'Template locale (en|ar)', 'en')
  .option('--sections <list>', 'Comma-separated sections', 'header,stack,projects,activity')
  .option('--readme <path>', 'README to update between markers', 'README.md')
  .option('--json <path>', 'JSON Resume output path', 'profile.json')
  .option('--dry-run', 'Run without writing files', false)
  .option('--explain', 'Print scoring/classification reasoning', false)
  .action(async (opts) => {
    const token = (opts.token as string | undefined) ?? process.env.GITHUB_TOKEN;
    if (!token) {
      console.error('A token is required. Pass --token or set GITHUB_TOKEN.');
      process.exit(1);
    }

    const logger = createLogger({ level: opts.explain ? 'debug' : 'info', pretty: true });
    const client = createGitHubClient({ token });
    const cache = memoryCache();

    const fileConfig = await loadConfigFile(opts.config);
    const config = mergeConfigWithInputs(fileConfig, {
      sections: opts.sections,
      locale: opts.locale,
    });

    const snapshot = await ingestSnapshot({ client, user: opts.user, cache, logger });
    const report = buildReport({ config, snapshot });

    if (opts.explain) {
      console.error(
        JSON.stringify({ summary: report.summary, top: report.stack.slice(0, 5) }, null, 2),
      );
    }

    if (opts.readme) {
      try {
        const existing = await readFile(opts.readme, 'utf8');
        const md = await renderMarkdown({
          report,
          sections: config.sections,
          locale: config.locale,
        });
        const result = applyMarkers(existing, md);
        if (!result.hasMarkers) {
          console.warn(`No markers in ${opts.readme}; skipping README update.`);
        } else if (!opts.dryRun) {
          await writeFile(opts.readme, result.content, 'utf8');
        }
      } catch (err) {
        if (isFsNotFound(err)) {
          console.warn(`README not found at ${opts.readme}; skipping.`);
        } else throw err;
      }
    }

    if (opts.json && !opts.dryRun) {
      const resume = renderJsonResume(report);
      await mkdir(dirname(opts.json), { recursive: true });
      await writeFile(opts.json, JSON.stringify(resume, null, 2), 'utf8');
    }

    process.stdout.write(`${report.summary}\n`);
  });

program
  .command('audit')
  .description('Run the self-awareness audit on a GitHub user')
  .requiredOption('--user <login>', 'GitHub login to audit')
  .option('--token <token>', 'GitHub token (falls back to GITHUB_TOKEN env var)')
  .option('--config <path>', 'Path to .portfoliocraft.yml', '.portfoliocraft.yml')
  .option('--md <path>', 'Markdown audit output path', 'audit.md')
  .option('--json <path>', 'JSON audit output path', 'audit.json')
  .option('--severity <level>', 'Minimum severity to include (info|low|medium|high|critical)', '')
  // v0.3: --verified-only narrows the report to the verifiable-signal slice —
  // unverified employer context findings plus bug-debt findings whose label
  // multiplier shows GitHub itself classified the issue as a real bug. It
  // stacks with --severity (both filters apply when both are passed).
  .option(
    '--verified-only',
    'Only include findings backed by verifiable signal (unverified-employer-context, or bug-debt with labelMultiplier >= 2)',
    false,
  )
  .option('--dry-run', 'Run without writing files', false)
  .option('--explain', 'Print summary and top findings to stderr', false)
  .action(async (opts) => {
    const token = (opts.token as string | undefined) ?? process.env.GITHUB_TOKEN;
    if (!token) {
      console.error('A token is required. Pass --token or set GITHUB_TOKEN.');
      process.exit(1);
    }

    const logger = createLogger({ level: opts.explain ? 'debug' : 'info', pretty: true });
    const client = createGitHubClient({ token });
    const cache = memoryCache();

    const fileConfig = await loadConfigFile(opts.config);
    const snapshot = await ingestSnapshot({ client, user: opts.user, cache, logger });
    const extras = await ingestAuditExtras({
      client,
      user: opts.user,
      snapshot,
      cache,
      logger,
    });

    const baseReport = await runAudit({
      snapshot,
      extras,
      config: fileConfig.audit,
      user: opts.user,
    });

    // --severity filters in-place on the rendered report (post-orchestrator)
    // rather than being plumbed into runAudit. Reason: the orchestrator's
    // ignore filter is concept-level (categories/repos), while --severity is
    // a presentation knob; filtering on the way out keeps the JSON artifact
    // and the Markdown summary internally consistent without re-running
    // checks or mutating runAudit's contract.
    //
    // --verified-only is the same shape — a presentation-time slice — and
    // stacks: severity floor first (cheap, drops the most), then verified
    // gate. Order doesn't change the output (filters are commutative) but
    // is cheaper this way.
    const severityFiltered = filterReportBySeverity(baseReport, opts.severity as Severity | '');
    const report = opts.verifiedOnly
      ? filterReportByVerifiedOnly(severityFiltered)
      : severityFiltered;

    if (opts.explain) {
      printExplain(report);
    }

    if (opts.md && !opts.dryRun) {
      const md = renderAuditMarkdown(report);
      await mkdir(dirname(opts.md), { recursive: true });
      await writeFile(opts.md, md, 'utf8');
    }

    if (opts.json && !opts.dryRun) {
      const json = renderAuditJson(report);
      await mkdir(dirname(opts.json), { recursive: true });
      await writeFile(opts.json, json, 'utf8');
    }

    process.stdout.write(
      `audit: ${report.summary.totalFindings} finding(s) across ${report.summary.reposScanned} repo(s)\n`,
    );
  });

program
  .command('summary')
  .description('Generate CV / university / case-study summaries from your GitHub history')
  .requiredOption('--user <login>', 'GitHub login to summarize')
  .option('--token <token>', 'GitHub token (falls back to GITHUB_TOKEN)')
  .option('--config <path>', 'Path to .portfoliocraft.yml', '.portfoliocraft.yml')
  .option('--format <format>', 'cv | uni | case-studies | all', 'all')
  .option('--cv <path>', 'CV output path', 'summary-cv.md')
  .option('--uni <path>', 'University output path', 'summary-uni.md')
  .option('--case-studies <path>', 'Case studies output path', 'summary-case-studies.md')
  .option('--projects-max <n>', 'Max projects in CV/case-studies', '6')
  .option('--dry-run', 'Print to stdout, write nothing', false)
  .action(async (opts) => {
    const token = (opts.token as string | undefined) ?? process.env.GITHUB_TOKEN;
    if (!token) {
      console.error('A token is required. Pass --token or set GITHUB_TOKEN.');
      process.exit(1);
    }

    const format = String(opts.format) as 'cv' | 'uni' | 'case-studies' | 'all';
    if (format !== 'cv' && format !== 'uni' && format !== 'case-studies' && format !== 'all') {
      console.error(`Invalid --format=${opts.format}. Use cv | uni | case-studies | all.`);
      process.exit(1);
    }

    const projectsMax = Number.parseInt(String(opts.projectsMax ?? '6'), 10);
    if (!Number.isFinite(projectsMax) || projectsMax <= 0) {
      console.error('Invalid --projects-max; expected a positive integer.');
      process.exit(1);
    }

    const logger = createLogger({ level: 'info', pretty: true });
    const client = createGitHubClient({ token });
    const cache = memoryCache();

    // The summary phase doesn't take CLI overrides for sections/locale —
    // those are README knobs, not summary-level. Use `fileConfig` directly,
    // which is already a fully-validated `PortfolioConfig`.
    const fileConfig = await loadConfigFile(opts.config);

    const snapshot = await ingestSnapshot({ client, user: opts.user, cache, logger });
    const report = buildReport({ config: fileConfig, snapshot });

    const renderCv = format === 'cv' || format === 'all';
    const renderUni = format === 'uni' || format === 'all';
    const renderCases = format === 'case-studies' || format === 'all';

    // Build the CV first (we may need its `selectedProjects` for the case-
    // studies render even when the CV file itself isn't being written).
    const cv = renderCv || renderCases ? buildCvSummary(report, { projectsMax }) : null;

    if (renderCv && cv) {
      const md = renderCvMarkdown(cv);
      if (opts.dryRun) {
        process.stdout.write(`${md}\n`);
      } else if (opts.cv) {
        await mkdir(dirname(opts.cv), { recursive: true });
        await writeFile(opts.cv, md, 'utf8');
      }
    }

    if (renderUni) {
      const uni = buildUniSummary(report, { projectsMax });
      const md = renderUniMarkdown(uni);
      if (opts.dryRun) {
        process.stdout.write(`${md}\n`);
      } else if (opts.uni) {
        await mkdir(dirname(opts.uni), { recursive: true });
        await writeFile(opts.uni, md, 'utf8');
      }
    }

    if (renderCases && cv) {
      const md = renderCaseStudiesMarkdown(cv.selectedProjects);
      if (opts.dryRun) {
        process.stdout.write(`${md}\n`);
      } else if (opts.caseStudies) {
        await mkdir(dirname(opts.caseStudies), { recursive: true });
        await writeFile(opts.caseStudies, md, 'utf8');
      }
    }

    if (!opts.dryRun) {
      process.stdout.write(
        `summary: rendered ${[renderCv && 'cv', renderUni && 'uni', renderCases && 'case-studies']
          .filter(Boolean)
          .join(', ')} for ${opts.user}\n`,
      );
    }
  });

await program.parseAsync(process.argv);

function isFsNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'ENOENT'
  );
}

/**
 * Drop findings whose severity rank is below the threshold and re-aggregate
 * `summary.bySeverity`/`summary.byCategory` so the rendered + serialized
 * outputs agree. An empty threshold returns the report unchanged.
 */
function filterReportBySeverity(report: AuditReport, threshold: Severity | ''): AuditReport {
  if (threshold === '') return report;
  const floor = SEVERITY_RANK[threshold];
  const findings = report.findings.filter((f: AuditFinding) => SEVERITY_RANK[f.severity] >= floor);
  return reaggregateReport(report, findings);
}

/**
 * v0.3: keep only findings backed by verifiable signal — unverified-employer
 * -context (the audit explicitly couldn't back a claim) plus bug-debt findings
 * whose `metadata.labelMultiplier` is >= 2 (i.e. GitHub's own labeling
 * confirms it's a real bug, not a feature request mis-tagged as an issue).
 *
 * Re-aggregates the same summary fields as `filterReportBySeverity` so the
 * rendered Markdown and serialized JSON stay internally consistent.
 */
function filterReportByVerifiedOnly(report: AuditReport): AuditReport {
  const findings = report.findings.filter((f: AuditFinding) => isVerifiedFinding(f));
  return reaggregateReport(report, findings);
}

/**
 * Predicate for the --verified-only filter. Pulled out as a named function so
 * the contract (verbatim from agent 3's spec) is easy to grep for and unit-
 * test in isolation later.
 */
function isVerifiedFinding(f: AuditFinding): boolean {
  if (f.category === 'unverified-employer-context') return true;
  if (f.category === 'bug-debt') {
    const raw = f.metadata.labelMultiplier;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 2) return true;
  }
  return false;
}

/**
 * Build a fresh report with the supplied findings list and re-derived summary
 * counters. Shared by both --severity and --verified-only so a future filter
 * can plug in without re-implementing aggregation. Does NOT recompute
 * `verifiedSignatureRatio` — that's a perRepo-level signal whose source data
 * (signatureStats) lives outside the findings array, so filtering findings
 * mustn't change it.
 */
function reaggregateReport(report: AuditReport, findings: AuditFinding[]): AuditReport {
  const bySeverity: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  const byCategory: Record<Category, number> = {
    stale: 0,
    license: 0,
    docs: 0,
    tests: 0,
    'pr-rot': 0,
    'bug-debt': 0,
    archived: 0,
    'archive-suggestion': 0,
    'unverified-employer-context': 0,
  };
  const reposWithFindings = new Set<string>();
  let bugDebtScore = 0;
  for (const f of findings) {
    bySeverity[f.severity] += 1;
    byCategory[f.category] += 1;
    if (f.repo) reposWithFindings.add(`${f.repo.owner}/${f.repo.name}`);
    if (f.category === 'bug-debt') {
      const raw = f.metadata.debtScore;
      if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
        bugDebtScore += raw;
      }
    }
  }

  return {
    ...report,
    findings,
    summary: {
      ...report.summary,
      totalFindings: findings.length,
      bySeverity,
      byCategory,
      bugDebtScore,
      reposWithFindings: reposWithFindings.size,
    },
  };
}

function printExplain(report: AuditReport): void {
  const sev = report.summary.bySeverity;
  console.error(
    `audit: ${report.summary.totalFindings} finding(s) — ` +
      `critical=${sev.critical ?? 0} high=${sev.high ?? 0} ` +
      `medium=${sev.medium ?? 0} low=${sev.low ?? 0} info=${sev.info ?? 0}`,
  );
  console.error(
    `scanned ${report.summary.reposScanned} repo(s); ${report.summary.reposWithFindings} with findings`,
  );
  const topCategories = Object.entries(report.summary.byCategory)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([cat, count]) => `${cat}=${count}`)
    .join(' ');
  console.error(`top categories: ${topCategories || '(none)'}`);
  const top = report.findings.slice(0, 5);
  for (const f of top) {
    const repo = f.repo ? `${f.repo.owner}/${f.repo.name}` : '-';
    console.error(`  [${f.severity}] ${f.category} ${repo}: ${f.title}`);
  }
}
