import { describe, expect, it } from 'vitest';
import { employerVerifiedContextCheck } from '../../../src/audit/checks/employer-verified-context.js';
import type { AuditExtrasForRepo } from '../../../src/audit/index.js';
import { auditCtx, extrasForWithSignature, repo } from '../fixtures.js';

/**
 * Build extras whose signatureStats contains the given email domains as
 * uniqueAuthorEmails. Defaults to a healthy 50% signature ratio so the
 * "low-signature" branch doesn't accidentally fire.
 */
function withEmails(
  nameWithOwner: string,
  emails: string[],
  signedRatio = 0.5,
): AuditExtrasForRepo {
  const base = extrasForWithSignature(nameWithOwner, signedRatio);
  if (!base.signatureStats) {
    throw new Error('signatureStats missing — fixture invariant broken');
  }
  base.signatureStats = {
    ...base.signatureStats,
    uniqueAuthorEmails: [...emails].sort(),
  };
  return base;
}

describe('employerVerifiedContextCheck', () => {
  it('emits no finding when there is no bio/company hint', () => {
    const ctx = auditCtx({
      repos: [repo()],
      extras: [withEmails('octocat/demo', ['user@somewhere.com'], 0.05)],
      user_profile: { bio: null, company: null },
    });
    expect(employerVerifiedContextCheck(ctx)).toEqual([]);
  });

  it('emits info finding with branch (a) when bio claims employer but no email matches', () => {
    const ctx = auditCtx({
      repos: [repo()],
      extras: [withEmails('octocat/demo', ['nobody@personal.dev'])],
      user_profile: { bio: 'Engineer at @acme — building things.', company: null },
    });
    const findings = employerVerifiedContextCheck(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('info');
    expect(findings[0]?.category).toBe('unverified-employer-context');
    expect(findings[0]?.title).toContain('Employer signal weak');
    expect(findings[0]?.metadata.matchedDomains).toEqual([]);
    expect(findings[0]?.metadata.unmatchedDomains).toEqual(['personal.dev']);
  });

  it('low-signature branch (b) wins when domains match but signature ratio is < 10%', () => {
    const ctx = auditCtx({
      repos: [repo()],
      extras: [withEmails('octocat/demo', ['user@acme.com'], 0.05)],
      user_profile: { bio: 'Working at acme.com', company: null },
    });
    const findings = employerVerifiedContextCheck(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.title.toLowerCase()).toContain('low signed-commit');
    expect(findings[0]?.metadata.avgSignatureRatio).toBeLessThan(0.1);
    // Branch (a) didn't fire — domain matched.
    expect(findings[0]?.metadata.matchedDomains).toContain('acme.com');
  });

  it('emits no finding when domains match AND signature ratio > 0.5', () => {
    const ctx = auditCtx({
      repos: [repo()],
      extras: [withEmails('octocat/demo', ['user@acme.com'], 0.85)],
      user_profile: { bio: 'Working at acme.com', company: null },
    });
    expect(employerVerifiedContextCheck(ctx)).toEqual([]);
  });

  it('emits no finding when extras has no perRepo entries with signatureStats', () => {
    const ctx = auditCtx({
      repos: [repo()],
      // No extras → perRepo is empty → no domains, no ratio.
      user_profile: { bio: 'Working at acme.com', company: null },
    });
    expect(employerVerifiedContextCheck(ctx)).toEqual([]);
  });

  it('filters users.noreply.github.com noise emails', () => {
    const ctx = auditCtx({
      repos: [repo()],
      extras: [
        withEmails(
          'octocat/demo',
          ['12345+octo@users.noreply.github.com', 'real@personal.dev'],
          0.5,
        ),
      ],
      user_profile: { bio: 'Engineer at @acme', company: null },
    });
    const findings = employerVerifiedContextCheck(ctx);
    expect(findings).toHaveLength(1);
    // The noise domain must NOT appear in either matched or unmatched.
    expect(findings[0]?.metadata.unmatchedDomains).toEqual(['personal.dev']);
    const unmatched = findings[0]?.metadata.unmatchedDomains as string[];
    // Use exact-match / proper-subdomain check, not bare endsWith — matches
    // the source-side guard against "evilusers.noreply.github.com" spoofing.
    expect(
      unmatched.some(
        (d) => d === 'users.noreply.github.com' || d.endsWith('.users.noreply.github.com'),
      ),
    ).toBe(false);
  });

  it('exposes matchedDomains, unmatchedDomains, avgSignatureRatio in metadata', () => {
    // Force the low-signature branch so a finding is guaranteed.
    const ctx = auditCtx({
      repos: [repo({ name: 'a', nameWithOwner: 'octocat/a', url: 'https://github.com/octocat/a' })],
      extras: [withEmails('octocat/a', ['hi@personal.dev'], 0.02)],
      user_profile: { bio: 'Building things at acme.com', company: null },
    });
    const findings = employerVerifiedContextCheck(ctx);
    expect(findings).toHaveLength(1);
    const meta = findings[0]?.metadata as Record<string, unknown>;
    expect(Array.isArray(meta.matchedDomains)).toBe(true);
    expect(Array.isArray(meta.unmatchedDomains)).toBe(true);
    expect(typeof meta.avgSignatureRatio).toBe('number');
    expect(meta.avgSignatureRatio).toBeCloseTo(0.02, 3);
  });

  it('emits exactly one finding even with multiple repos contributing domains', () => {
    const ctx = auditCtx({
      repos: [
        repo({ name: 'a', nameWithOwner: 'octocat/a', url: 'https://github.com/octocat/a' }),
        repo({ name: 'b', nameWithOwner: 'octocat/b', url: 'https://github.com/octocat/b' }),
      ],
      extras: [
        withEmails('octocat/a', ['x@nopath.dev'], 0.0),
        withEmails('octocat/b', ['y@otherthing.com'], 0.0),
      ],
      user_profile: { bio: '@acme · founder', company: null },
    });
    const findings = employerVerifiedContextCheck(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.repo).toBeNull();
  });

  it('treats the company field as a hint just like bio', () => {
    const ctx = auditCtx({
      repos: [repo()],
      extras: [withEmails('octocat/demo', ['a@elsewhere.dev'])],
      user_profile: { bio: null, company: 'acme.io' },
    });
    const findings = employerVerifiedContextCheck(ctx);
    expect(findings).toHaveLength(1);
  });

  it('strips http(s) URLs before deciding whether a hint exists', () => {
    // The bio is *only* a URL — the URL-strip step removes it, leaving
    // nothing that looks like a company token. No hint → no finding.
    const ctx = auditCtx({
      repos: [repo()],
      extras: [withEmails('octocat/demo', ['x@elsewhere.dev'], 0.01)],
      user_profile: { bio: 'https://example.com/profile', company: null },
    });
    expect(employerVerifiedContextCheck(ctx)).toEqual([]);
  });

  it('extracts domain even with a trailing/whitespace email payload', () => {
    // Slightly malformed but still parseable email → domain inclusion check.
    const ctx = auditCtx({
      repos: [repo()],
      extras: [withEmails('octocat/demo', ['  a@malformed.dev  '], 0.5)],
      user_profile: { bio: '@acme', company: null },
    });
    const findings = employerVerifiedContextCheck(ctx);
    expect(findings).toHaveLength(1);
    const meta = findings[0]?.metadata as Record<string, unknown>;
    const unmatched = (meta.unmatchedDomains as string[]) ?? [];
    expect(unmatched).toContain('malformed.dev');
  });

  it('skips emails with no @ or trailing @ silently', () => {
    const ctx = auditCtx({
      repos: [repo()],
      extras: [withEmails('octocat/demo', ['no-at-here', 'trailing@'], 0.0)],
      user_profile: { bio: '@acme', company: null },
    });
    // Both emails are unusable → no domains → only the low-signature
    // branch can fire. With 0% it does.
    const findings = employerVerifiedContextCheck(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.metadata.unmatchedDomains).toEqual([]);
  });
});
