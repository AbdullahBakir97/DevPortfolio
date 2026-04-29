import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import * as core from '@actions/core';
import { context } from '@actions/github';
import {
  type ActionInputs,
  buildReport,
  createGitHubClient,
  createLogger,
  ingestSnapshot,
  loadConfigFile,
  memoryCache,
  mergeConfigWithInputs,
} from '@devportfolio/core';
import { applyMarkers, renderJsonResume, renderMarkdown, renderPdf } from '@devportfolio/renderers';

export interface RunResult {
  readmeUpdated: boolean;
  jsonPath: string;
  pdfPath: string;
  cardsDir: string;
  summary: string;
}

export async function run(inputs: ActionInputs): Promise<RunResult> {
  const logger = createLogger({ level: inputs.explain ? 'debug' : 'info' });
  const client = createGitHubClient({ token: inputs.token });
  const cache = memoryCache();

  const fileConfig = await loadConfigFile(inputs.configFile);
  const config = mergeConfigWithInputs(fileConfig, {
    sections: inputs.sections,
    locale: inputs.locale,
  });

  const userLogin = inputs.user || (await resolveTokenOwner(client));
  core.info(`Profiling github user: ${userLogin}`);

  const snapshot = await ingestSnapshot({ client, user: userLogin, cache, logger });
  const report = buildReport({ config, snapshot });

  if (inputs.explain) {
    core.startGroup('explain');
    core.info(JSON.stringify({ summary: report.summary, top: report.stack.slice(0, 5) }, null, 2));
    core.endGroup();
  }

  let readmeUpdated = false;
  if (inputs.outputReadme) {
    readmeUpdated = await writeReadme(inputs.outputReadme, report, config, inputs.dryRun);
  }

  if (inputs.outputJson) {
    const resume = renderJsonResume(report);
    if (!inputs.dryRun) await writeFileEnsured(inputs.outputJson, JSON.stringify(resume, null, 2));
  }

  if (inputs.outputPdf && !inputs.dryRun) {
    try {
      const buffer = await renderPdf({ report });
      await writeFileEnsured(inputs.outputPdf, buffer);
    } catch (err) {
      // React-PDF needs its built-in AFM font metrics on disk; some bundled
      // environments (notably ncc-bundled actions on Linux runners) strip
      // them. Skip the artifact rather than failing the whole run — the
      // README/JSON Resume outputs are independently useful.
      const message = err instanceof Error ? err.message : String(err);
      core.warning(
        `Skipping PDF: ${message}. See https://github.com/AbdullahBakir97/DevPortfolio/issues for font-bundling status.`,
      );
    }
  }

  if (inputs.outputSvgDir && !inputs.dryRun) {
    core.info('SVG card rendering requires fonts; skipping when none provided.');
  }

  core.setOutput('readme-updated', readmeUpdated);
  core.setOutput('json-path', inputs.outputJson);
  core.setOutput('pdf-path', inputs.outputPdf);
  core.setOutput('cards-dir', inputs.outputSvgDir);
  core.setOutput('summary', report.summary);

  return {
    readmeUpdated,
    jsonPath: inputs.outputJson,
    pdfPath: inputs.outputPdf,
    cardsDir: inputs.outputSvgDir,
    summary: report.summary,
  };
}

async function resolveTokenOwner(client: ReturnType<typeof createGitHubClient>): Promise<string> {
  const ctxOwner = context.repo?.owner;
  if (ctxOwner) return ctxOwner;
  const { data } = await client.rest.users.getAuthenticated();
  return data.login;
}

async function writeReadme(
  path: string,
  report: Awaited<ReturnType<typeof buildReport>>,
  config: Awaited<ReturnType<typeof loadConfigFile>>,
  dryRun: boolean,
): Promise<boolean> {
  let existing = '';
  try {
    existing = await readFile(path, 'utf8');
  } catch {
    return false;
  }

  const generated = await renderMarkdown({
    report,
    sections: config.sections,
    locale: config.locale,
  });
  const result = applyMarkers(existing, generated);

  if (!result.hasMarkers) {
    core.warning(`No DEVPORTFOLIO markers found in ${path}; nothing to update.`);
    return false;
  }
  if (!result.changed) return false;
  if (!dryRun) await writeFile(path, result.content, 'utf8');
  return true;
}

async function writeFileEnsured(
  path: string,
  contents: string | Buffer | Uint8Array,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}
