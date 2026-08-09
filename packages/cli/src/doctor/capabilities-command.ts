import path from 'node:path';
import chalk from 'chalk';

import { WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS } from '../contracts/workspace-intelligence-runtime-registry.js';
import { writeWorkspaceArtifactJson } from '../utils/artifact-path-compat.js';
import { findWorkspaceRootUp } from '../utils/workspace-root.js';
import { buildDoctorCapabilitiesReport } from './capability-registry.js';
import { runDoctorValidationCorpus } from './validation-corpus.js';

export type DoctorCapabilitiesCommandOptions = {
  runtime?: string;
  framework?: string;
  validate?: boolean;
  write?: boolean;
  workspace?: string;
  json?: boolean;
  quiet?: boolean;
};

export async function runDoctorCapabilities(
  options: DoctorCapabilitiesCommandOptions = {}
): Promise<number> {
  const capabilities = buildDoctorCapabilitiesReport({
    runtime: options.runtime,
    framework: options.framework,
  });
  const validation = options.validate ? runDoctorValidationCorpus() : undefined;
  let artifactPath: string | undefined;
  let validationArtifactPath: string | undefined;

  if (options.write) {
    const workspacePath = options.workspace
      ? path.resolve(options.workspace)
      : findWorkspaceRootUp(process.cwd());
    if (!workspacePath) {
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              schemaVersion: capabilities.schemaVersion,
              status: 'error',
              error: {
                code: 'doctor.capabilities.workspace-not-found',
                message: '--write requires a Workspai workspace or --workspace <path>.',
              },
            },
            null,
            2
          )
        );
      } else {
        console.log(chalk.red('Doctor capabilities could not be written: no workspace found.'));
      }
      return 1;
    }
    // Filters are a query concern. The governed artifact must always contain
    // complete registry truth for every downstream consumer.
    const canonicalCapabilities = buildDoctorCapabilitiesReport();
    artifactPath = await writeWorkspaceArtifactJson(
      workspacePath,
      WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.doctorCapabilities.artifactPath,
      canonicalCapabilities
    );
    if (validation) {
      validationArtifactPath = await writeWorkspaceArtifactJson(
        workspacePath,
        WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.doctorValidation.artifactPath,
        validation
      );
    }
  }

  const output = {
    ...capabilities,
    ...(validation ? { validation } : {}),
    ...(artifactPath ? { artifactPath } : {}),
    ...(validationArtifactPath ? { validationArtifactPath } : {}),
  };
  if (options.json) {
    if (!options.quiet) console.log(JSON.stringify(output, null, 2));
  } else if (!options.quiet) {
    console.log(chalk.bold.cyan('\n🩺 Workspai Doctor capabilities\n'));
    console.log(
      `${capabilities.summary.adapterCount} adapter(s) · ${capabilities.summary.frameworkCount} framework mapping(s) · ${capabilities.summary.platformCount} platform(s)`
    );
    for (const adapter of capabilities.adapters) {
      const coverage = adapter.domains
        .map((domain) => `${domain.domain}:${domain.level}`)
        .join(' · ');
      console.log(chalk.bold(`\n${adapter.runtimeFamilies.join(', ')} · ${adapter.tier}`));
      console.log(chalk.gray(coverage));
      for (const limitation of adapter.limitations) console.log(chalk.yellow(`  ! ${limitation}`));
    }
    if (validation) {
      const summary = validation.summary;
      const color = summary.failedCases === 0 ? chalk.green : chalk.red;
      console.log(
        color(
          `\nValidation ${summary.passedCases}/${summary.totalCases} · precision ${summary.precision} · recall ${summary.recall}`
        )
      );
    }
    if (artifactPath) console.log(chalk.gray(`\nCapabilities: ${artifactPath}`));
    if (validationArtifactPath) console.log(chalk.gray(`Validation: ${validationArtifactPath}`));
  }

  return validation && validation.summary.failedCases > 0 ? 1 : 0;
}
