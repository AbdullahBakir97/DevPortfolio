import { classifyRepository } from '../classification.js';
import type { Domain, PortfolioReport, ProjectEntry, Repository, StackEntry } from '../schemas.js';
import {
  type CvSummary,
  type LearningTrajectoryEntry,
  type ProjectCaseStudy,
  type RecencyBucket,
  type SelfDirectedScope,
  SUMMARY_SCHEMA_VERSION,
  type SummaryActivity,
  type SummarySkills,
  type SummaryUser,
  type TechnicalDepthEntry,
  type UniSummary,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

export interface BuildSummaryOptions {
  /**
   * Cap on the number of `selectedProjects` (CV) / `topProjects` (Uni). If
   * the underlying `report.projects` is shorter, the cap is silently ignored
   * — we never pad. Default: 6 to match `ProjectsConfig.max`.
   */
  projectsMax?: number;
  /** Pure-function clock seam. Defaults to `report.generatedAt`. */
  now?: Date;
}

const DEFAULT_PROJECTS_MAX = 6;
const SKILLS_CAP = 8;
const TRAJECTORY_CAP = 5;
const TOP_LANGUAGES_PER_PROJECT = 5;
const TOP_LANGUAGES_PER_BUCKET = 3;
const TOP_DOMAINS_PER_YEAR = 2;
const TOPICS_IN_DEPTH_SUMMARY = 3;

/**
 * Build a `CvSummary` (CV-shaped data) from an existing `PortfolioReport`. No
 * I/O — the report already contains snapshot + stack + projects. Identical
 * input must yield byte-identical output, so every list this touches is
 * sorted with stable, value-based comparators.
 */
export function buildCvSummary(report: PortfolioReport, opts: BuildSummaryOptions = {}): CvSummary {
  const generatedAt = (opts.now ?? new Date(report.generatedAt)).toISOString();
  const projectsMax = opts.projectsMax ?? DEFAULT_PROJECTS_MAX;

  const selectedProjects = pickProjects(report, projectsMax);
  const skills = buildSkills(report.stack);
  const headline = buildHeadline(report, /* academic */ false);
  const domains = uniqueDomainsByCount(selectedProjects);
  const activity = buildActivity(report);

  return {
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    generatedAt,
    user: buildUser(report),
    headline,
    skills,
    selectedProjects,
    domains,
    activity,
    links: { github: `https://github.com/${report.snapshot.user.login}` },
  };
}

/**
 * Build a `UniSummary` (narrative-shaped data for university applications)
 * from the same `PortfolioReport`. The shared user / headline / project data
 * comes from the same helpers as `buildCvSummary` so the two stay in sync.
 */
export function buildUniSummary(
  report: PortfolioReport,
  opts: BuildSummaryOptions = {},
): UniSummary {
  const generatedAt = (opts.now ?? new Date(report.generatedAt)).toISOString();
  const projectsMax = opts.projectsMax ?? DEFAULT_PROJECTS_MAX;

  const topProjects = pickProjects(report, projectsMax);
  const headline = buildHeadline(report, /* academic */ true);

  return {
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    generatedAt,
    user: buildUser(report),
    headline,
    learningTrajectory: buildLearningTrajectory(report),
    topProjects,
    technicalDepth: buildTechnicalDepth(report),
    selfDirectedScope: buildSelfDirectedScope(report),
  };
}

/**
 * Build a single `ProjectCaseStudy` from a `ProjectEntry` plus the underlying
 * `Repository`. Exposed for renderers / tests that want to format a single
 * project independently of a full summary.
 *
 * Both arguments are taken even though `project.repository` already carries
 * the repo — callers that have already filtered/normalised the repo (e.g.
 * a deterministic-clone pass in tests) can pass a different reference, and
 * passing both makes the data dependencies explicit.
 */
export function buildProjectCaseStudy(
  project: ProjectEntry,
  repo: Repository,
  now: Date = new Date(),
): ProjectCaseStudy {
  const owner = ownerOf(repo.nameWithOwner);
  const months = monthsBetween(repo.createdAt, repo.pushedAt);
  return {
    repository: {
      owner,
      name: repo.name,
      url: repo.url,
      nameWithOwner: repo.nameWithOwner,
    },
    domain: project.domain,
    significance: project.significance,
    description: repo.description,
    topics: [...repo.topics].sort((a, b) => a.localeCompare(b)),
    primaryLanguage: repo.primaryLanguage,
    topLanguages: topLanguageNames(repo, TOP_LANGUAGES_PER_PROJECT),
    stargazerCount: repo.stargazerCount,
    forkCount: repo.forkCount,
    estimatedDurationMonths: Math.max(1, months),
    // v0.4 uses repo.createdAt as a proxy for "first activity" — close enough
    // to first-commit for personal repos. v0.5 may swap in real first-commit
    // dates from a REST query.
    firstPushDate: repo.createdAt,
    lastPushDate: repo.pushedAt,
    isPinned: repo.isPinned,
    isArchived: repo.isArchived,
    recencyBucket: bucketOf(repo, now),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers — kept module-private; the public surface above is the
// only thing other packages should depend on.
// ---------------------------------------------------------------------------

function buildUser(report: PortfolioReport): SummaryUser {
  const u = report.snapshot.user;
  return {
    login: u.login,
    name: u.name,
    bio: u.bio,
    location: u.location,
    websiteUrl: u.websiteUrl,
  };
}

function buildActivity(report: PortfolioReport): SummaryActivity {
  const c = report.snapshot.contributions;
  return {
    period: 'last 12 months',
    commits: c.totalCommits,
    pullRequests: c.totalPRs,
    reviews: c.totalReviews,
    issues: c.totalIssues,
    reposContributedTo: c.reposContributedTo,
  };
}

// File-format-style "languages" GitHub returns that don't represent a real
// engineering skill on a CV. Filtered from every skills tier.
const SKILL_DENYLIST = new Set<string>(['Jupyter Notebook', 'Roff']);

function buildSkills(stack: StackEntry[]): SummarySkills {
  const strong: string[] = [];
  const working: string[] = [];
  const familiar: string[] = [];
  // `report.stack` is already sorted by descending score (see scoreStack), so
  // a simple in-order push preserves the most-relevant entries when we cap.
  for (const entry of stack) {
    if (SKILL_DENYLIST.has(entry.language)) continue;
    if (entry.tier === 'expert' && strong.length < SKILLS_CAP) {
      strong.push(entry.language);
    } else if (entry.tier === 'proficient' && working.length < SKILLS_CAP) {
      working.push(entry.language);
    } else if (
      (entry.tier === 'familiar' || entry.tier === 'exposed') &&
      familiar.length < SKILLS_CAP
    ) {
      familiar.push(entry.language);
    }
  }
  return { strong, working, familiar };
}

function pickProjects(report: PortfolioReport, max: number): ProjectCaseStudy[] {
  const now = new Date(report.generatedAt);
  // `report.projects` is already sorted by significance with pinned-first
  // honoured, so we trust that order and just slice + map.
  return report.projects.slice(0, max).map((p) => buildProjectCaseStudy(p, p.repository, now));
}

function uniqueDomainsByCount(projects: ProjectCaseStudy[]): string[] {
  const counts = new Map<string, number>();
  for (const p of projects) counts.set(p.domain, (counts.get(p.domain) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .map(([domain]) => domain);
}

// ---------------------------------------------------------------------------
// Headline generation — deterministic from snapshot + stack.
// ---------------------------------------------------------------------------

const DOMAIN_NOUN_PHRASE: Record<Domain, string> = {
  backend: 'Backend developer',
  frontend: 'Frontend developer',
  devops: 'DevOps engineer',
  ml: 'Machine learning engineer',
  mobile: 'Mobile developer',
  unknown: 'Software developer',
};

const DOMAIN_NOUN_PHRASE_ACADEMIC: Record<Domain, string> = {
  backend: 'Aspiring backend engineer',
  frontend: 'Aspiring frontend engineer',
  devops: 'Aspiring DevOps engineer',
  ml: 'Aspiring machine-learning engineer',
  mobile: 'Aspiring mobile engineer',
  unknown: 'Aspiring software engineer',
};

function buildHeadline(report: PortfolioReport, academic: boolean): string {
  const dominant = dominantDomain(report.projects);
  const phrase = (academic ? DOMAIN_NOUN_PHRASE_ACADEMIC : DOMAIN_NOUN_PHRASE)[dominant];
  const langs = report.stack
    .slice(0, 3)
    .map((s) => s.language)
    .join(', ');
  const repos = report.snapshot.user.publicRepos;
  const commits = report.snapshot.contributions.totalCommits;
  const langClause = langs.length > 0 ? langs : 'no detected languages';
  return `${phrase} · ${langClause} · ${repos} public repos · ${formatThousands(commits)} commits`;
}

function dominantDomain(projects: ProjectEntry[]): Domain {
  if (projects.length === 0) return 'unknown';
  const counts: Record<Domain, number> = {
    backend: 0,
    frontend: 0,
    devops: 0,
    ml: 0,
    mobile: 0,
    unknown: 0,
  };
  for (const p of projects) counts[p.domain] += 1;
  // Excludes `unknown` from winning unless it is the only signal.
  const ranked = (Object.entries(counts) as [Domain, number][])
    .filter(([d]) => d !== 'unknown')
    .filter(([, n]) => n > 0)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    });
  const top = ranked[0];
  return top ? top[0] : 'unknown';
}

/**
 * Format an integer with commas as the thousands separator. Locale-independent
 * (we explicitly do NOT use `Number.prototype.toLocaleString()` because it
 * would yield non-deterministic output across hosts).
 */
function formatThousands(n: number): string {
  const negative = n < 0;
  const abs = Math.abs(Math.trunc(n));
  const s = String(abs);
  const groups: string[] = [];
  for (let i = s.length; i > 0; i -= 3) {
    const start = Math.max(0, i - 3);
    groups.unshift(s.slice(start, i));
  }
  const joined = groups.join(',');
  return negative ? `-${joined}` : joined;
}

// ---------------------------------------------------------------------------
// Learning trajectory — group by ISO year of `repo.createdAt`. v0.4 uses
// repo creation; v0.5 may swap in real first-commit dates from REST.
// ---------------------------------------------------------------------------

function buildLearningTrajectory(report: PortfolioReport): LearningTrajectoryEntry[] {
  const repos = report.snapshot.repositories;
  const byYear = new Map<number, Repository[]>();
  for (const repo of repos) {
    const year = new Date(repo.createdAt).getUTCFullYear();
    if (!Number.isFinite(year) || year <= 0) continue;
    const bucket = byYear.get(year);
    if (bucket) bucket.push(repo);
    else byYear.set(year, [repo]);
  }

  const entries: LearningTrajectoryEntry[] = [];
  const sortedYears = [...byYear.keys()].sort((a, b) => a - b);
  for (const year of sortedYears) {
    const yearRepos = byYear.get(year);
    if (!yearRepos || yearRepos.length === 0) continue;
    const primaryLanguages = topLanguagesAcross(yearRepos, TOP_LANGUAGES_PER_BUCKET);
    const primaryDomains = topDomainsAcross(yearRepos, TOP_DOMAINS_PER_YEAR);
    entries.push({
      year,
      primaryLanguages,
      primaryDomains,
      reposCreated: yearRepos.length,
      summary: trajectorySentence(yearRepos.length, primaryLanguages, primaryDomains),
    });
  }
  // Cap to the most recent N years; entries are already sorted ascending so
  // we slice from the tail.
  return entries.slice(Math.max(0, entries.length - TRAJECTORY_CAP));
}

function trajectorySentence(
  reposCreated: number,
  primaryLanguages: string[],
  primaryDomains: string[],
): string {
  const noun = reposCreated === 1 ? 'repo' : 'repos';
  const langClause =
    primaryLanguages.length > 0 ? joinAnd(primaryLanguages) : 'no detected languages';
  const domainClause = primaryDomains.length > 0 ? joinAnd(primaryDomains) : 'mixed work';
  return `Created ${reposCreated} ${noun} primarily in ${langClause}, focused on ${domainClause}.`;
}

// ---------------------------------------------------------------------------
// Technical depth — one entry per domain present in `report.projects`.
// ---------------------------------------------------------------------------

function buildTechnicalDepth(report: PortfolioReport): TechnicalDepthEntry[] {
  const byDomain = new Map<Domain, Repository[]>();
  for (const project of report.projects) {
    const bucket = byDomain.get(project.domain);
    if (bucket) bucket.push(project.repository);
    else byDomain.set(project.domain, [project.repository]);
  }

  const entries: TechnicalDepthEntry[] = [];
  for (const [domain, repos] of byDomain.entries()) {
    if (repos.length === 0) continue;
    const primaryLanguages = topLanguagesAcross(repos, TOP_LANGUAGES_PER_BUCKET);
    const topTopics = topTopicsAcross(repos, TOPICS_IN_DEPTH_SUMMARY);
    entries.push({
      domain,
      repos: repos.length,
      primaryLanguages,
      summary: depthSentence(domain, repos.length, primaryLanguages, topTopics),
    });
  }

  return entries.sort((a, b) => {
    if (b.repos !== a.repos) return b.repos - a.repos;
    return a.domain.localeCompare(b.domain);
  });
}

function depthSentence(
  domain: Domain,
  repoCount: number,
  primaryLanguages: string[],
  topTopics: string[],
): string {
  const noun = repoCount === 1 ? 'project' : 'projects';
  const domainWord = domain === 'unknown' ? 'general' : domain;
  const langClause =
    primaryLanguages.length > 0 ? `in ${joinAnd(primaryLanguages)}` : 'across mixed languages';
  const topicClause = topTopics.length > 0 ? ` covering ${topTopics.join(', ')}` : '';
  return `${repoCount} ${domainWord} ${noun} ${langClause}${topicClause}.`;
}

// ---------------------------------------------------------------------------
// Self-directed scope — quick aggregate stats across the full snapshot.
// ---------------------------------------------------------------------------

function buildSelfDirectedScope(report: PortfolioReport): SelfDirectedScope {
  const repos = report.snapshot.repositories;
  const total = repos.length;
  const ownWork = repos.filter((r) => !r.isFork).length;
  const openSourceShare = total === 0 ? 0 : ownWork / total;

  let longestMonths = 0;
  let mostStarredRepo = '';
  let mostStarred = -1;
  for (const r of repos) {
    const months = Math.max(1, monthsBetween(r.createdAt, r.pushedAt));
    if (months > longestMonths) longestMonths = months;
    if (r.stargazerCount > mostStarred) {
      mostStarred = r.stargazerCount;
      mostStarredRepo = r.nameWithOwner;
    }
  }

  return {
    totalReposScanned: total,
    openSourceShare,
    longestProjectMonths: longestMonths,
    mostStarredRepo,
  };
}

// ---------------------------------------------------------------------------
// Cross-cutting helpers: language/topic/domain aggregation, dates, strings.
// ---------------------------------------------------------------------------

function topLanguagesAcross(repos: Repository[], limit: number): string[] {
  const totals = new Map<string, number>();
  for (const r of repos) {
    for (const lang of r.languages) {
      if (lang.bytes <= 0) continue;
      totals.set(lang.name, (totals.get(lang.name) ?? 0) + lang.bytes);
    }
  }
  return [...totals.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, limit)
    .map(([name]) => name);
}

function topLanguageNames(repo: Repository, limit: number): string[] {
  return [...repo.languages]
    .filter((l) => l.bytes > 0)
    .sort((a, b) => {
      if (b.bytes !== a.bytes) return b.bytes - a.bytes;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit)
    .map((l) => l.name);
}

function topDomainsAcross(repos: Repository[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const r of repos) {
    const { domain } = classifyRepository(r);
    if (domain === 'unknown') continue;
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, limit)
    .map(([d]) => d);
}

function topTopicsAcross(repos: Repository[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const r of repos) {
    for (const t of r.topics) {
      const key = t.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, limit)
    .map(([t]) => t);
}

function monthsBetween(startIso: string, endIso: string): number {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  // 30.4375 days/month is the average length over a 4-year cycle — close
  // enough for human-readable durations and avoids calendar-arithmetic noise.
  const months = (end - start) / (1000 * 60 * 60 * 24 * 30.4375);
  return Math.round(months);
}

function bucketOf(repo: Repository, now: Date): RecencyBucket {
  if (repo.isArchived) return 'archived';
  const ageDays = (now.getTime() - Date.parse(repo.pushedAt)) / (1000 * 60 * 60 * 24);
  if (ageDays <= 90) return 'active';
  if (ageDays <= 365) return 'recent';
  return 'dormant';
}

function ownerOf(nameWithOwner: string): string {
  const slash = nameWithOwner.indexOf('/');
  if (slash <= 0) return nameWithOwner;
  return nameWithOwner.slice(0, slash);
}

function joinAnd(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  const head = items.slice(0, items.length - 1).join(', ');
  const tail = items[items.length - 1];
  return `${head}, and ${tail}`;
}
