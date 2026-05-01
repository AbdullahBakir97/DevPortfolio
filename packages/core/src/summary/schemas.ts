import { z } from 'zod';
import { Domain } from '../schemas.js';

/**
 * Schema version stamped onto every summary artifact (CV + Uni). Bump when the
 * wire shape changes in a way downstream renderers or consumers cannot ignore.
 *
 * v0.4 line: introduces `ProjectCaseStudy`, `CvSummary`, `UniSummary`. These
 * are the application-ready summaries — the renderers that turn them into
 * Markdown / JSON / PDF live in `@portfoliocraft/renderers`.
 */
export const SUMMARY_SCHEMA_VERSION = '1.0.0' as const;

// ---------------------------------------------------------------------------
// Per-project case study — the unit shared by `CvSummary.selectedProjects`
// and `UniSummary.topProjects`. The renderer is what makes them look CV-like
// or essay-like; the data is the same shape.
// ---------------------------------------------------------------------------

export const RecencyBucket = z.enum(['active', 'recent', 'dormant', 'archived']);
export type RecencyBucket = z.infer<typeof RecencyBucket>;

export const CaseStudyRepoRef = z.object({
  owner: z.string(),
  name: z.string(),
  url: z.string().url(),
  nameWithOwner: z.string(),
});
export type CaseStudyRepoRef = z.infer<typeof CaseStudyRepoRef>;

export const ProjectCaseStudy = z.object({
  repository: CaseStudyRepoRef,
  domain: Domain,
  significance: z.number().nonnegative(),
  description: z.string().nullable(),
  topics: z.array(z.string()).default([]),
  primaryLanguage: z.string().nullable(),
  topLanguages: z.array(z.string()).default([]),
  stargazerCount: z.number().int().nonnegative(),
  forkCount: z.number().int().nonnegative(),
  // Integer months from createdAt → pushedAt, clamped to a minimum of 1 so
  // a same-day repo still reads as "1 month" rather than "0".
  estimatedDurationMonths: z.number().int().positive(),
  // ISO date string. v0.4 uses pushedAt because the ingest snapshot does not
  // carry a real first-commit timestamp; v0.5 can fetch it via REST.
  firstPushDate: z.string().datetime(),
  lastPushDate: z.string().datetime(),
  isPinned: z.boolean(),
  isArchived: z.boolean(),
  recencyBucket: RecencyBucket,
});
export type ProjectCaseStudy = z.infer<typeof ProjectCaseStudy>;

// ---------------------------------------------------------------------------
// Shared user / activity sub-schemas.
// ---------------------------------------------------------------------------

export const SummaryUser = z.object({
  login: z.string(),
  name: z.string().nullable(),
  bio: z.string().nullable(),
  location: z.string().nullable(),
  websiteUrl: z.string().nullable(),
});
export type SummaryUser = z.infer<typeof SummaryUser>;

export const SummarySkills = z.object({
  // strong  ← StackEntry.tier === 'expert'
  // working ← StackEntry.tier === 'proficient'
  // familiar ← StackEntry.tier === 'familiar' OR 'exposed'
  // Each list is capped at 8 entries by the builder.
  strong: z.array(z.string()).default([]),
  working: z.array(z.string()).default([]),
  familiar: z.array(z.string()).default([]),
});
export type SummarySkills = z.infer<typeof SummarySkills>;

export const SummaryActivity = z.object({
  // Human-readable period label — the GitHub contributions API returns
  // "the last 12 months" of contributions, so v0.4 hard-codes that string
  // and exposes it for renderers to drop into prose.
  period: z.string(),
  commits: z.number().int().nonnegative(),
  pullRequests: z.number().int().nonnegative(),
  reviews: z.number().int().nonnegative(),
  issues: z.number().int().nonnegative(),
  reposContributedTo: z.number().int().nonnegative(),
});
export type SummaryActivity = z.infer<typeof SummaryActivity>;

export const SummaryLinks = z.object({
  github: z.string().url(),
});
export type SummaryLinks = z.infer<typeof SummaryLinks>;

// ---------------------------------------------------------------------------
// CvSummary — top-level CV-shaped data.
// ---------------------------------------------------------------------------

export const CvSummary = z.object({
  schemaVersion: z.literal(SUMMARY_SCHEMA_VERSION),
  generatedAt: z.string().datetime(),
  user: SummaryUser,
  headline: z.string(),
  skills: SummarySkills,
  selectedProjects: z.array(ProjectCaseStudy).default([]),
  // Unique domains across selected projects, sorted by descending count then
  // by name ascending for deterministic ties.
  domains: z.array(z.string()).default([]),
  activity: SummaryActivity,
  links: SummaryLinks,
});
export type CvSummary = z.infer<typeof CvSummary>;

// ---------------------------------------------------------------------------
// UniSummary — narrative-shaped data for university applications.
// ---------------------------------------------------------------------------

export const LearningTrajectoryEntry = z.object({
  year: z.number().int().positive(),
  primaryLanguages: z.array(z.string()).default([]),
  primaryDomains: z.array(z.string()).default([]),
  reposCreated: z.number().int().nonnegative(),
  summary: z.string(),
});
export type LearningTrajectoryEntry = z.infer<typeof LearningTrajectoryEntry>;

export const TechnicalDepthEntry = z.object({
  // Tightened from z.string() in v0.4.3 — the builder only emits Domain enum
  // values, so renderers can safely index DOMAIN_TITLE / DOMAIN_DISPLAY without
  // a runtime fallback.
  domain: Domain,
  repos: z.number().int().nonnegative(),
  primaryLanguages: z.array(z.string()).default([]),
  summary: z.string(),
});
export type TechnicalDepthEntry = z.infer<typeof TechnicalDepthEntry>;

export const SelfDirectedScope = z.object({
  totalReposScanned: z.number().int().nonnegative(),
  // Share of repos that are not forks — proxy for "self-initiated work".
  // Always in [0, 1]; equal to 0 when totalReposScanned === 0.
  openSourceShare: z.number().min(0).max(1),
  longestProjectMonths: z.number().int().nonnegative(),
  // nameWithOwner of the most-starred repo, or '' when there are no repos.
  mostStarredRepo: z.string(),
});
export type SelfDirectedScope = z.infer<typeof SelfDirectedScope>;

export const UniSummary = z.object({
  schemaVersion: z.literal(SUMMARY_SCHEMA_VERSION),
  generatedAt: z.string().datetime(),
  user: SummaryUser,
  headline: z.string(),
  // Sorted ascending by year, capped to the most recent 5 entries.
  learningTrajectory: z.array(LearningTrajectoryEntry).default([]),
  topProjects: z.array(ProjectCaseStudy).default([]),
  // Sorted by descending repo count then by domain name ascending.
  technicalDepth: z.array(TechnicalDepthEntry).default([]),
  selfDirectedScope: SelfDirectedScope,
});
export type UniSummary = z.infer<typeof UniSummary>;
