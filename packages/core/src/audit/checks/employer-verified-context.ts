// v0.3 verifiable signal: heuristic check on (bio claims) vs (commit email
// domains) and overall commit signature ratio. Pure-function, no I/O.
import { AUDIT_SCHEMA_VERSION, type AuditCheck, type AuditFinding, findingId } from '../schemas.js';

const LOW_SIGNATURE_RATIO = 0.1;
// Domains that are noise — GitHub's privacy email and empties don't
// represent a real employer signal either way.
const NOISE_DOMAIN_SUFFIXES = ['users.noreply.github.com'];
// Heuristic: a "company token" in the bio/company text needs at least one
// letter and a length > 1 to count as a recognizable employer claim.
const MIN_TOKEN_LEN = 2;

/**
 * employerVerifiedContextCheck — emits at most ONE finding per audit. Combines
 * the user's bio + company claims with the commit-author-email domains
 * gathered across all repos and the overall commit signature ratio. Fires when
 * either:
 *   - the user claims an employer in bio/company, but none of the unique
 *     commit email domains overlap with the claim, OR
 *   - the average signature ratio across repos with stats is < 10%.
 *
 * The check is professional in tone — it never accuses, only flags weak
 * verification signal so the user can strengthen it.
 */
export const employerVerifiedContextCheck: AuditCheck = (ctx): AuditFinding[] => {
  const { snapshot, extras, now, user } = ctx;

  const bio = (snapshot.user.bio ?? '').toLowerCase();
  const company = (snapshot.user.company ?? '').toLowerCase();
  const haystack = `${bio} ${company}`.trim();

  // Guard: if neither bio nor company has *anything* recognizable as a
  // company hint we have nothing to verify and shouldn't emit.
  if (!hasRecognizableCompanyHint(haystack)) return [];

  // Aggregate unique commit-author-email domains across every repo with
  // signatureStats. Skip noise domains and obviously-empty entries.
  const allDomains = new Set<string>();
  let signatureSum = 0;
  let repoCountWithStats = 0;
  for (const repoExtras of extras.perRepo.values()) {
    const stats = repoExtras.signatureStats;
    if (!stats) continue;
    repoCountWithStats += 1;
    signatureSum += stats.signatureRatio;
    for (const email of stats.uniqueAuthorEmails) {
      const domain = extractDomain(email);
      if (domain === null) continue;
      if (isNoiseDomain(domain)) continue;
      allDomains.add(domain);
    }
  }

  const matchedDomains: string[] = [];
  const unmatchedDomains: string[] = [];
  for (const domain of allDomains) {
    if (haystack.includes(domain)) matchedDomains.push(domain);
    else unmatchedDomains.push(domain);
  }
  matchedDomains.sort();
  unmatchedDomains.sort();

  const avgSignatureRatio = repoCountWithStats === 0 ? null : signatureSum / repoCountWithStats;

  const employerWeak = unmatchedDomains.length > 0 && matchedDomains.length === 0;
  const lowSignature = avgSignatureRatio !== null && avgSignatureRatio < LOW_SIGNATURE_RATIO;

  if (!employerWeak && !lowSignature) return [];

  const profileUrl = `https://github.com/${snapshot.user.login}`;
  const title = employerWeak
    ? `Employer signal weak: ${user}`
    : `Low signed-commit ratio for claimed context: ${user}`;
  const message = employerWeak
    ? 'Your bio or company field references an employer, but the commit-author email domains in your repositories don’t overlap with that claim. This weakens verifiable employment context for visitors.'
    : 'Your bio or company field references professional context, but the share of cryptographically signed commits across your repositories is low. Signed commits are the most direct way to back an employer claim.';
  const suggestedAction = employerWeak
    ? 'Add a verified domain to your GitHub email or update your bio so commit context reflects employer claim.'
    : 'Enable GPG/SSH commit signing — published cryptographic signature strengthens employer-verifiable claims.';
  const evidenceLabel =
    unmatchedDomains.length > 0
      ? `Unverified domains: ${unmatchedDomains.join(', ')}`
      : avgSignatureRatio !== null
        ? `Signature ratio: ${(avgSignatureRatio * 100).toFixed(1)}%`
        : 'Verifiable signal: weak';

  return [
    {
      id: findingId('unverified-employer-context', null, snapshot.user.login),
      schemaVersion: AUDIT_SCHEMA_VERSION,
      severity: 'info',
      category: 'unverified-employer-context',
      repo: null,
      title,
      message,
      evidence: [
        {
          url: profileUrl,
          label: evidenceLabel,
        },
      ],
      suggestedAction,
      detectedAt: now.toISOString(),
      metadata: {
        matchedDomains,
        unmatchedDomains,
        avgSignatureRatio,
        repoCountWithStats,
      },
    },
  ];
};

/**
 * Cheap heuristic: is there *any* token in the bio/company text that could be
 * read as a company name? We just need one letter-bearing token of length >=
 * MIN_TOKEN_LEN that isn't a pure URL. This intentionally errs toward
 * "yes" — false positives just mean the check runs and may not emit; false
 * negatives mean we silently skip a legitimate claim.
 */
function hasRecognizableCompanyHint(haystack: string): boolean {
  if (haystack.length === 0) return false;
  // Strip URLs to avoid treating "https://example.com" as the only token.
  const stripped = haystack.replace(/https?:\/\/\S+/g, ' ');
  // A '@' followed by letters is a strong company-handle signal (e.g. '@acme').
  if (/@[a-z0-9][a-z0-9-]+/i.test(stripped)) return true;
  // A bare domain-like token (acme.com, acme.io).
  if (/[a-z0-9-]+\.[a-z]{2,}/i.test(stripped)) return true;
  // Any alphabetic token >= MIN_TOKEN_LEN.
  const tokens = stripped.split(/\s+/).filter((t) => t.length >= MIN_TOKEN_LEN);
  for (const token of tokens) {
    if (/[a-z]/i.test(token)) return true;
  }
  return false;
}

function extractDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 0 || at === email.length - 1) return null;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  if (domain.length === 0) return null;
  return domain;
}

function isNoiseDomain(domain: string): boolean {
  // Match only on exact equality or proper subdomain (with leading dot).
  // A bare endsWith(suffix) would falsely match attacker-controlled
  // hosts like "evilusers.noreply.github.com" (no dot boundary).
  for (const suffix of NOISE_DOMAIN_SUFFIXES) {
    if (domain === suffix || domain.endsWith(`.${suffix}`)) return true;
  }
  return false;
}
