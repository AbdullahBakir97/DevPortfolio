import type { exec, getExecOutput } from '@actions/exec';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commitArtifacts } from '../src/run.js';

/**
 * Minimal exec doubles. We don't depend on @actions/exec's runtime here; we
 * just record the calls and return whatever the test wants. The shape of
 * the spy mirrors the real signature so the production code compiles
 * unchanged when the doubles are injected.
 */
function makeExecDouble() {
  const calls: Array<{ tool: string; args: ReadonlyArray<string> }> = [];
  const stub: typeof exec = (async (tool: string, args?: string[] | null) => {
    calls.push({ tool, args: args ?? [] });
    return 0;
  }) as unknown as typeof exec;
  return { stub, calls };
}

function makeGetExecOutputDouble(programs: Record<string, { stdout?: string; exitCode?: number }>) {
  const calls: Array<{ tool: string; args: ReadonlyArray<string> }> = [];
  const stub: typeof getExecOutput = (async (tool: string, args?: string[] | null) => {
    calls.push({ tool, args: args ?? [] });
    const key = `${tool} ${(args ?? []).join(' ')}`;
    const match = programs[key] ??
      programs[Object.keys(programs).find((k) => key.startsWith(k)) ?? ''] ?? {
        stdout: '',
        exitCode: 0,
      };
    return { stdout: match.stdout ?? '', stderr: '', exitCode: match.exitCode ?? 0 };
  }) as unknown as typeof getExecOutput;
  return { stub, calls };
}

describe('commitArtifacts', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.GITHUB_HEAD_REPOSITORY;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_EVENT_NAME;
    delete process.env.GITHUB_REF_NAME;
    delete process.env.GITHUB_HEAD_REF;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('skips with reason="commit-disabled" when commit input is false', async () => {
    const { stub: execStub, calls } = makeExecDouble();
    const { stub: outStub } = makeGetExecOutputDouble({});
    const result = await commitArtifacts({
      enabled: false,
      dryRun: false,
      paths: ['profile.json'],
      message: 'chore: refresh',
      exec: execStub,
      getExecOutput: outStub,
    });
    expect(result).toEqual({ commitSha: '', commitSkippedReason: 'commit-disabled' });
    expect(calls).toHaveLength(0);
  });

  it('skips with reason="dry-run" when dryRun is true', async () => {
    const { stub: execStub, calls } = makeExecDouble();
    const { stub: outStub } = makeGetExecOutputDouble({});
    const result = await commitArtifacts({
      enabled: true,
      dryRun: true,
      paths: ['profile.json'],
      message: 'chore: refresh',
      exec: execStub,
      getExecOutput: outStub,
    });
    expect(result.commitSkippedReason).toBe('dry-run');
    expect(calls).toHaveLength(0);
  });

  it('skips with reason="no-paths" when paths array is empty', async () => {
    const { stub: execStub } = makeExecDouble();
    const { stub: outStub } = makeGetExecOutputDouble({});
    const result = await commitArtifacts({
      enabled: true,
      dryRun: false,
      paths: [],
      message: 'chore: refresh',
      exec: execStub,
      getExecOutput: outStub,
    });
    expect(result.commitSkippedReason).toBe('no-paths');
  });

  it('skips with reason="fork-pr" when head repo differs from base', async () => {
    process.env.GITHUB_HEAD_REPOSITORY = 'attacker/PortfolioCraft';
    process.env.GITHUB_REPOSITORY = 'AbdullahBakir97/PortfolioCraft';
    const { stub: execStub, calls } = makeExecDouble();
    const { stub: outStub } = makeGetExecOutputDouble({});
    const result = await commitArtifacts({
      enabled: true,
      dryRun: false,
      paths: ['profile.json'],
      message: 'chore: refresh',
      exec: execStub,
      getExecOutput: outStub,
    });
    expect(result.commitSkippedReason).toBe('fork-pr');
    expect(calls).toHaveLength(0);
  });

  it('skips with reason="no-changes" when staged diff is empty', async () => {
    process.env.GITHUB_REF_NAME = 'main';
    process.env.GITHUB_REPOSITORY = 'AbdullahBakir97/PortfolioCraft';
    const { stub: execStub, calls: execCalls } = makeExecDouble();
    const { stub: outStub } = makeGetExecOutputDouble({
      'git diff --cached --quiet': { stdout: '', exitCode: 0 },
    });
    const result = await commitArtifacts({
      enabled: true,
      dryRun: false,
      paths: ['profile.json'],
      message: 'chore: refresh',
      exec: execStub,
      getExecOutput: outStub,
    });
    expect(result.commitSkippedReason).toBe('no-changes');
    // Identity + add ran, but commit and push did not.
    const tools = execCalls.map((c) => `${c.tool} ${c.args.join(' ')}`);
    expect(tools).toContain('git config user.name github-actions[bot]');
    expect(tools).toContain('git add -- profile.json');
    expect(tools.some((t) => t.startsWith('git commit'))).toBe(false);
    expect(tools.some((t) => t.startsWith('git push'))).toBe(false);
  });

  it('commits and pushes to GITHUB_REF_NAME on push events', async () => {
    process.env.GITHUB_REF_NAME = 'main';
    process.env.GITHUB_EVENT_NAME = 'push';
    process.env.GITHUB_REPOSITORY = 'AbdullahBakir97/PortfolioCraft';
    const { stub: execStub, calls: execCalls } = makeExecDouble();
    const { stub: outStub } = makeGetExecOutputDouble({
      'git diff --cached --quiet': { exitCode: 1 },
      'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n', exitCode: 0 },
    });
    const result = await commitArtifacts({
      enabled: true,
      dryRun: false,
      paths: ['profile.json', 'audit.md'],
      message: 'chore: refresh portfolio',
      exec: execStub,
      getExecOutput: outStub,
    });
    expect(result.commitSha).toBe('abc1234deadbeef');
    expect(result.commitSkippedReason).toBe('');
    const tools = execCalls.map((c) => `${c.tool} ${c.args.join(' ')}`);
    expect(tools).toContain('git add -- profile.json audit.md');
    expect(tools).toContain('git commit -m chore: refresh portfolio');
    expect(tools).toContain('git push origin HEAD:main');
  });

  it('uses GITHUB_HEAD_REF (not REF_NAME) on pull_request events', async () => {
    process.env.GITHUB_REF_NAME = '42/merge';
    process.env.GITHUB_HEAD_REF = 'feat/my-branch';
    process.env.GITHUB_EVENT_NAME = 'pull_request';
    process.env.GITHUB_REPOSITORY = 'AbdullahBakir97/PortfolioCraft';
    const { stub: execStub, calls: execCalls } = makeExecDouble();
    const { stub: outStub } = makeGetExecOutputDouble({
      'git diff --cached --quiet': { exitCode: 1 },
      'git rev-parse HEAD': { stdout: 'sha\n', exitCode: 0 },
    });
    const result = await commitArtifacts({
      enabled: true,
      dryRun: false,
      paths: ['x'],
      message: 'm',
      exec: execStub,
      getExecOutput: outStub,
    });
    expect(result.commitSkippedReason).toBe('');
    const tools = execCalls.map((c) => `${c.tool} ${c.args.join(' ')}`);
    expect(tools).toContain('git push origin HEAD:feat/my-branch');
    expect(tools.every((t) => !t.includes('42/merge'))).toBe(true);
  });
});
