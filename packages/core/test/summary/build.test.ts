import { describe, expect, it } from 'vitest';
import type { ProjectEntry, StackEntry } from '../../src/schemas.js';
import {
  buildCvSummary,
  buildProjectCaseStudy,
  buildUniSummary,
  SUMMARY_SCHEMA_VERSION,
} from '../../src/summary/index.js';
import { repo as baseRepo } from '../fixtures.js';
import { daysAgoIso, NOW, summaryReport } from './fixtures.js';

describe('buildCvSummary', () => {
  it('stamps schemaVersion as "1.0.0"', () => {
    const cv = buildCvSummary(summaryReport(), { now: NOW });
    expect(cv.schemaVersion).toBe('1.0.0');
    expect(cv.schemaVersion).toBe(SUMMARY_SCHEMA_VERSION);
  });

  it('selectedProjects respects the default projectsMax of 6', () => {
    // Build 8 projects so the default cap kicks in.
    const repos = Array.from({ length: 8 }, (_, i) =>
      baseRepo({
        name: `r${i}`,
        nameWithOwner: `octolearn/r${i}`,
        url: `https://github.com/octolearn/r${i}`,
      }),
    );
    const projects: ProjectEntry[] = repos.map((r, i) => ({
      repository: r,
      significance: 1 - i * 0.05,
      domain: 'backend',
      reasons: [],
    }));
    const cv = buildCvSummary(summaryReport({ repos, projects }), { now: NOW });
    expect(cv.selectedProjects).toHaveLength(6);
  });

  it('selectedProjects honours an explicit projectsMax override', () => {
    const cv = buildCvSummary(summaryReport(), { now: NOW, projectsMax: 2 });
    expect(cv.selectedProjects).toHaveLength(2);
    // The fixture has the backend api-server first (significance 0.95).
    expect(cv.selectedProjects[0]?.repository.name).toBe('api-server');
    expect(cv.selectedProjects[1]?.repository.name).toBe('design-system');
  });

  it('maps stack tiers: expert→strong, proficient→working, familiar/exposed→familiar', () => {
    const stack: StackEntry[] = [
      { language: 'TypeScript', score: 0.9, loc: 100, recency: 1, maturity: 1, tier: 'expert' },
      { language: 'Rust', score: 0.85, loc: 90, recency: 1, maturity: 1, tier: 'expert' },
      { language: 'Python', score: 0.6, loc: 80, recency: 1, maturity: 1, tier: 'proficient' },
      { language: 'Go', score: 0.4, loc: 50, recency: 1, maturity: 1, tier: 'familiar' },
      { language: 'Lua', score: 0.2, loc: 10, recency: 1, maturity: 1, tier: 'exposed' },
    ];
    const cv = buildCvSummary(summaryReport({ stack }), { now: NOW });
    expect(cv.skills.strong).toEqual(['TypeScript', 'Rust']);
    expect(cv.skills.working).toEqual(['Python']);
    expect(cv.skills.familiar).toEqual(['Go', 'Lua']);
  });

  it('caps each skills tier at 8 entries', () => {
    // 10 expert-tier entries — only 8 should land in `strong`.
    const stack: StackEntry[] = Array.from({ length: 10 }, (_, i) => ({
      language: `Lang${i}`,
      score: 1 - i * 0.01,
      loc: 1_000,
      recency: 1,
      maturity: 1,
      tier: 'expert' as const,
    }));
    const cv = buildCvSummary(summaryReport({ stack }), { now: NOW });
    expect(cv.skills.strong).toHaveLength(8);
    // Order is preserved from the input (already score-sorted).
    expect(cv.skills.strong[0]).toBe('Lang0');
    expect(cv.skills.strong[7]).toBe('Lang7');
  });

  it('headline includes the top 3 languages joined with ", "', () => {
    const cv = buildCvSummary(summaryReport(), { now: NOW });
    // Default fixture stack: TypeScript, Python, Go.
    expect(cv.headline).toContain('TypeScript, Python, Go');
    // It should also cite the public-repo count from the snapshot.
    expect(cv.headline).toContain('6 public repos');
  });

  it('domains is sorted by descending count, ties broken alphabetically', () => {
    // Custom projects: 3 backend, 1 frontend, 1 devops, 1 ml.
    const repos = Array.from({ length: 6 }, (_, i) =>
      baseRepo({
        name: `r${i}`,
        nameWithOwner: `octolearn/r${i}`,
        url: `https://github.com/octolearn/r${i}`,
      }),
    );
    const [r0, r1, r2, r3, r4, r5] = repos;
    if (!r0 || !r1 || !r2 || !r3 || !r4 || !r5) {
      throw new Error('test setup: expected 6 repos');
    }
    const projects: ProjectEntry[] = [
      { repository: r0, significance: 0.9, domain: 'backend', reasons: [] },
      { repository: r1, significance: 0.8, domain: 'backend', reasons: [] },
      { repository: r2, significance: 0.7, domain: 'backend', reasons: [] },
      { repository: r3, significance: 0.6, domain: 'frontend', reasons: [] },
      { repository: r4, significance: 0.5, domain: 'devops', reasons: [] },
      { repository: r5, significance: 0.4, domain: 'ml', reasons: [] },
    ];
    const cv = buildCvSummary(summaryReport({ repos, projects }), { now: NOW, projectsMax: 6 });
    // backend (3) first, then devops/frontend/ml (1 each) alphabetically.
    expect(cv.domains).toEqual(['backend', 'devops', 'frontend', 'ml']);
  });
});

describe('buildUniSummary', () => {
  it('learningTrajectory groups by createdAt year, skips zero-repo years, capped to last 5', () => {
    // Build repos across 6 different years so the cap really applies.
    const years = [2019, 2020, 2021, 2022, 2023, 2024];
    const repos = years.map((y, i) =>
      baseRepo({
        name: `r${y}`,
        nameWithOwner: `octolearn/r${y}`,
        url: `https://github.com/octolearn/r${y}`,
        createdAt: `${y}-06-01T00:00:00.000Z`,
        pushedAt: `${y}-12-01T00:00:00.000Z`,
        primaryLanguage: 'TypeScript',
        languages: [{ name: 'TypeScript', bytes: 1_000 + i }],
      }),
    );
    const uni = buildUniSummary(summaryReport({ repos, projects: [] }), { now: NOW });
    // Cap is 5 → drop the earliest year (2019).
    expect(uni.learningTrajectory).toHaveLength(5);
    const trajectoryYears = uni.learningTrajectory.map((e) => e.year);
    expect(trajectoryYears).toEqual([2020, 2021, 2022, 2023, 2024]);
    // Each entry is non-zero by construction.
    for (const e of uni.learningTrajectory) {
      expect(e.reposCreated).toBeGreaterThan(0);
    }
  });

  it('technicalDepth has one entry per domain with non-zero repos', () => {
    const uni = buildUniSummary(summaryReport(), { now: NOW });
    // Default fixture: backend, frontend, ml, devops — four projects total.
    const domains = uni.technicalDepth.map((t) => t.domain);
    expect(domains).toEqual(expect.arrayContaining(['backend', 'frontend', 'ml', 'devops']));
    expect(domains).toHaveLength(4);
    for (const t of uni.technicalDepth) {
      expect(t.repos).toBeGreaterThan(0);
    }
  });

  it('selfDirectedScope sums totalRepos, longest project, and openSourceShare in [0,1]', () => {
    const uni = buildUniSummary(summaryReport(), { now: NOW });
    const scope = uni.selfDirectedScope;
    // Default fixture has 6 repos, 1 of which is a fork (sandbox).
    expect(scope.totalReposScanned).toBe(6);
    // 5/6 non-fork.
    expect(scope.openSourceShare).toBeCloseTo(5 / 6, 6);
    expect(scope.openSourceShare).toBeGreaterThanOrEqual(0);
    expect(scope.openSourceShare).toBeLessThanOrEqual(1);
    // longestProjectMonths must reflect the longest createdAt→pushedAt window.
    expect(scope.longestProjectMonths).toBeGreaterThan(0);
    // The most-starred repo in the fixture is api-server (42 stars).
    expect(scope.mostStarredRepo).toBe('octolearn/api-server');
  });

  it('selfDirectedScope.openSourceShare is exactly 0 when there are no repos', () => {
    const uni = buildUniSummary(summaryReport({ repos: [], projects: [] }), { now: NOW });
    expect(uni.selfDirectedScope.totalReposScanned).toBe(0);
    expect(uni.selfDirectedScope.openSourceShare).toBe(0);
    expect(uni.selfDirectedScope.mostStarredRepo).toBe('');
  });
});

describe('buildProjectCaseStudy', () => {
  it('recencyBucket: archived repos always become "archived"', () => {
    const r = baseRepo({
      isArchived: true,
      // Even with a fresh push, archived wins.
      pushedAt: daysAgoIso(1),
    });
    const study = buildProjectCaseStudy(
      { repository: r, significance: 0.5, domain: 'backend', reasons: [] },
      r,
      NOW,
    );
    expect(study.recencyBucket).toBe('archived');
  });

  it('recencyBucket: ≤90d → active, ≤365d → recent, else dormant', () => {
    const mk = (ageDays: number) =>
      baseRepo({
        isArchived: false,
        pushedAt: daysAgoIso(ageDays),
      });
    const active = buildProjectCaseStudy(
      { repository: mk(30), significance: 0, domain: 'backend', reasons: [] },
      mk(30),
      NOW,
    );
    const recent = buildProjectCaseStudy(
      { repository: mk(200), significance: 0, domain: 'backend', reasons: [] },
      mk(200),
      NOW,
    );
    const dormant = buildProjectCaseStudy(
      { repository: mk(500), significance: 0, domain: 'backend', reasons: [] },
      mk(500),
      NOW,
    );
    expect(active.recencyBucket).toBe('active');
    expect(recent.recencyBucket).toBe('recent');
    expect(dormant.recencyBucket).toBe('dormant');
  });

  it('estimatedDurationMonths is integer ≥1, computed createdAt→pushedAt', () => {
    // Same-day repo → still 1 month thanks to the floor.
    const sameDay = baseRepo({
      createdAt: '2025-04-01T00:00:00.000Z',
      pushedAt: '2025-04-01T12:00:00.000Z',
    });
    const studySame = buildProjectCaseStudy(
      { repository: sameDay, significance: 0, domain: 'backend', reasons: [] },
      sameDay,
      NOW,
    );
    expect(studySame.estimatedDurationMonths).toBe(1);
    expect(Number.isInteger(studySame.estimatedDurationMonths)).toBe(true);

    // ~24 months — within ±1 of 24 because of the 30.4375 day/month average.
    const long = baseRepo({
      createdAt: '2023-04-01T00:00:00.000Z',
      pushedAt: '2025-04-01T00:00:00.000Z',
    });
    const studyLong = buildProjectCaseStudy(
      { repository: long, significance: 0, domain: 'backend', reasons: [] },
      long,
      NOW,
    );
    expect(studyLong.estimatedDurationMonths).toBeGreaterThanOrEqual(23);
    expect(studyLong.estimatedDurationMonths).toBeLessThanOrEqual(25);
    expect(Number.isInteger(studyLong.estimatedDurationMonths)).toBe(true);
  });

  it('topLanguages is capped at 5 and sorted by bytes descending', () => {
    const r = baseRepo({
      languages: [
        { name: 'A', bytes: 50 },
        { name: 'B', bytes: 5_000 },
        { name: 'C', bytes: 200 },
        { name: 'D', bytes: 9_000 },
        { name: 'E', bytes: 30 },
        { name: 'F', bytes: 6_000 },
        { name: 'G', bytes: 800 },
      ],
    });
    const study = buildProjectCaseStudy(
      { repository: r, significance: 0, domain: 'backend', reasons: [] },
      r,
      NOW,
    );
    expect(study.topLanguages).toHaveLength(5);
    // Sorted by descending byte count: D(9000), F(6000), B(5000), G(800), C(200).
    expect(study.topLanguages).toEqual(['D', 'F', 'B', 'G', 'C']);
  });
});

describe('determinism', () => {
  it('two consecutive buildCvSummary calls produce byte-identical JSON', () => {
    const report = summaryReport();
    const a = buildCvSummary(report, { now: NOW });
    const b = buildCvSummary(report, { now: NOW });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
