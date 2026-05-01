import { DOMAIN_DISPLAY, type Domain, type ProjectCaseStudy } from '@portfoliocraft/core';

const MONTH_ABBREVIATIONS: readonly string[] = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const DOMAIN_LABELS: Record<Domain, string> = {
  backend: 'Backend / API',
  frontend: 'Frontend / UI',
  devops: 'DevOps / Infrastructure',
  ml: 'Machine learning / data',
  mobile: 'Mobile',
  unknown: 'General software',
};

/**
 * Render an ordered list of `ProjectCaseStudy` entries as long-form Markdown
 * suitable for a portfolio deck or detailed application appendix.
 *
 * Pure function: identical input always produces byte-identical output. Order
 * is preserved from the input array — the caller is responsible for sorting
 * (the v0.4 builder sorts by significance descending).
 *
 * Topics belong in this format: a case study is the right place to surface
 * the GitHub-topics taxonomy, unlike the CV renderer where they read as
 * noise.
 */
export function renderCaseStudiesMarkdown(studies: ProjectCaseStudy[]): string {
  const lines: string[] = [];
  lines.push('# Project case studies');

  if (studies.length === 0) {
    // Empty section: still write a header so a marker block isn't left
    // visually empty, and so readers see the section was generated rather
    // than missing.
    lines.push('');
    lines.push('_No projects yet._');
    return `${lines.join('\n')}\n`;
  }

  lines.push('');
  for (let i = 0; i < studies.length; i++) {
    const study = studies[i];
    if (study === undefined) continue;
    lines.push(...renderStudy(study));
    if (i < studies.length - 1) lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function renderStudy(study: ProjectCaseStudy): string[] {
  const out: string[] = [];

  out.push(`## ${study.repository.name}`);
  out.push('');

  out.push(`**Repository:** [${study.repository.nameWithOwner}](${study.repository.url})`);
  out.push(`**Stack:** ${formatStack(study)}`);
  out.push(`**Duration:** ${formatDuration(study)}`);
  out.push(`**Status:** ${study.recencyBucket}`);
  out.push(`**Scale:** ${formatScale(study)}`);

  out.push('');
  out.push('### Overview');
  out.push(formatOverview(study));

  out.push('');
  out.push('### Domain');
  out.push(DOMAIN_LABELS[study.domain]);

  // Topics section is conditional — skip the heading entirely when empty.
  if (study.topics.length >= 1) {
    out.push('');
    out.push('### Topics');
    out.push(study.topics.join(', '));
  }

  return out;
}

function formatStack(study: ProjectCaseStudy): string {
  const langs = study.topLanguages.slice(0, 3).join(', ');
  const topics = study.topics.slice(0, 3).join(', ');
  if (langs.length === 0 && topics.length === 0) return '—';
  if (topics.length === 0) return langs;
  if (langs.length === 0) return topics;
  return `${langs} · ${topics}`;
}

function formatDuration(study: ProjectCaseStudy): string {
  const start = formatMonthYear(study.firstPushDate);
  const end = formatMonthYear(study.lastPushDate);
  const months = study.estimatedDurationMonths;
  const monthNoun = months === 1 ? 'month' : 'months';
  if (start === null && end === null) {
    return `${months} ${monthNoun}`;
  }
  const range =
    start === end || start === null || end === null ? (end ?? start ?? '') : `${start}–${end}`;
  return `${range} (${months} ${monthNoun})`;
}

function formatScale(study: ProjectCaseStudy): string {
  const stars = study.stargazerCount;
  const forks = study.forkCount;
  const starNoun = stars === 1 ? 'star' : 'stars';
  const forkNoun = forks === 1 ? 'fork' : 'forks';
  let line = `${stars} ${starNoun}, ${forks} ${forkNoun}`;
  if (study.isPinned) line += ' · pinned';
  return line;
}

function formatOverview(study: ProjectCaseStudy): string {
  if (study.description !== null && study.description.trim().length > 0) {
    return study.description.trim();
  }
  // Fallback when the repo has no description. Use DOMAIN_DISPLAY (lowercase
  // phrase) so we never leak the raw enum value into prose, and pick the
  // article from the domain phrase's first letter (e.g. 'an ML' wouldn't read
  // right as 'a ML' — but DOMAIN_DISPLAY['ml'] is 'machine-learning' so the
  // article is 'a' anyway). Keep the helper inline; this is the only spot.
  const domainPhrase = DOMAIN_DISPLAY[study.domain];
  const article = startsWithVowelSoundLocal(domainPhrase) ? 'An' : 'A';
  const lang = study.primaryLanguage ?? study.topLanguages[0] ?? null;
  if (lang !== null) return `${article} ${domainPhrase} project in ${lang}.`;
  return `${article} ${domainPhrase} project.`;
}

/** Local copy of the article-helper used by summary-uni; kept inline to avoid
 *  a third file just for one shared utility. v0.5 may extract to a renderer
 *  helpers module if a fourth caller appears. */
function startsWithVowelSoundLocal(s: string): boolean {
  if (s.length === 0) return false;
  const c = s.charAt(0).toLowerCase();
  return c === 'a' || c === 'e' || c === 'i' || c === 'o' || c === 'u';
}

/**
 * Format an ISO-8601 datetime string as "Mon YYYY" using a fixed 12-element
 * month table. We deliberately avoid locale-dependent formatters so output is
 * stable regardless of where the action runs.
 *
 * Returns null when the input cannot be parsed — the caller is expected to
 * fall back gracefully rather than emitting "Invalid Date".
 */
function formatMonthYear(iso: string): string | null {
  if (typeof iso !== 'string' || iso.length < 7) return null;
  // Expected shape: "YYYY-MM-DDTHH:MM:SSZ" (or any ISO-8601 prefix). We slice
  // year and month directly so we never round-trip through Date and risk a
  // timezone shift across the month boundary.
  const yearStr = iso.slice(0, 4);
  const monthStr = iso.slice(5, 7);
  if (!/^\d{4}$/.test(yearStr) || !/^\d{2}$/.test(monthStr)) return null;
  const monthIdx = Number.parseInt(monthStr, 10) - 1;
  if (monthIdx < 0 || monthIdx > 11) return null;
  const monthName = MONTH_ABBREVIATIONS[monthIdx];
  if (monthName === undefined) return null;
  return `${monthName} ${yearStr}`;
}
