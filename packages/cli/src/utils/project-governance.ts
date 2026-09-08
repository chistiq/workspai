import fs from 'node:fs';
import path from 'node:path';
import { WORKSPACE_SUPPLEMENTAL_ARTIFACTS } from '../contracts/workspace-intelligence-runtime-registry.js';

export type ProjectGovernanceControlStatus =
  'repository' | 'external-declared' | 'external-observed' | 'unknown';

export type ProjectGovernanceControl = {
  status: ProjectGovernanceControlStatus;
  provider: string | null;
  evidence: string[];
  reference: string | null;
};

export type ProjectGovernanceProfile = {
  schemaVersion: 'workspai.project-governance.v1';
  ci: ProjectGovernanceControl;
  release: ProjectGovernanceControl;
  ownership: ProjectGovernanceControl;
};

export type ProjectGovernanceDeclaration = Partial<
  Record<
    'ci' | 'release' | 'ownership',
    {
      mode?: 'repository' | 'external';
      provider?: string;
      reference?: string;
    }
  >
>;

const REPOSITORY_SURFACES = {
  ci: [
    '.github/workflows',
    '.gitlab-ci.yml',
    '.circleci/config.yml',
    'azure-pipelines.yml',
    'bitbucket-pipelines.yml',
    'cloudbuild.yaml',
    'Jenkinsfile',
    '.buildkite/pipeline.yml',
    'prow',
  ],
  release: [
    '.changeset',
    '.releaserc',
    '.releaserc.json',
    'release.config.js',
    '.goreleaser.yml',
    '.goreleaser.yaml',
    'RELEASING.md',
    'RELEASE.md',
    'tools/release',
    'scripts/release',
    'docs/release',
    'doc/release',
    'build/release.sh',
    'hack/lib/release.sh',
  ],
  ownership: [
    '.github/CODEOWNERS',
    '.gitlab/CODEOWNERS',
    'CODEOWNERS',
    'docs/CODEOWNERS',
    'OWNERS',
    'OWNERS_ALIASES',
    'MAINTAINERS',
  ],
} as const;

const RELEASE_WORKFLOW_NAME_PATTERN =
  /(?:^|[-_.])(?:release|publish|publishing|distribution)(?:[-_.]|$)/i;

const EXTERNAL_REFERENCE_PATTERNS = {
  ci: /\b(?:prow|buildkite|jenkins|teamcity|travis|external ci|test-infra)\b/i,
  release:
    /\b(?:release automation|release engineering|release infrastructure|external release)\b/i,
  ownership: /\b(?:external ownership|central owners|maintainer team|code owners)\b/i,
} as const;

async function existingSurface(
  projectPath: string,
  candidates: readonly string[]
): Promise<string[]> {
  const found: string[] = [];
  for (const candidate of candidates) {
    try {
      await fs.promises.access(path.join(projectPath, candidate), fs.constants.F_OK);
      found.push(candidate);
    } catch {
      // An absent repository surface is represented explicitly as unknown.
    }
  }
  return found;
}

async function observedExternalReferences(projectPath: string, pattern: RegExp): Promise<string[]> {
  const candidates = ['README.md', 'CONTRIBUTING.md', 'DEVELOPMENT.md', 'docs/devel/README.md'];
  const found: string[] = [];
  for (const candidate of candidates) {
    try {
      const filePath = path.join(projectPath, candidate);
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile() || stat.size > 1024 * 1024) continue;
      const content = await fs.promises.readFile(filePath, 'utf8');
      if (pattern.test(content)) found.push(candidate);
    } catch {
      // Documentation is optional and never required for detection.
    }
  }
  return found;
}

async function releaseWorkflowEvidence(projectPath: string): Promise<string[]> {
  const workflowDirectory = path.join(projectPath, '.github', 'workflows');
  try {
    const entries = await fs.promises.readdir(workflowDirectory, { withFileTypes: true });
    return entries
      .filter(
        (entry) =>
          entry.isFile() &&
          /\.(?:ya?ml)$/i.test(entry.name) &&
          RELEASE_WORKFLOW_NAME_PATTERN.test(entry.name)
      )
      .map((entry) => `.github/workflows/${entry.name}`)
      .sort();
  } catch {
    return [];
  }
}

function declaredControl(
  declaration: ProjectGovernanceDeclaration | undefined,
  control: 'ci' | 'release' | 'ownership'
): ProjectGovernanceControl | null {
  const value = declaration?.[control];
  if (!value?.mode) return null;
  return {
    status: value.mode === 'external' ? 'external-declared' : 'repository',
    provider: value.provider?.trim() || null,
    evidence: [WORKSPACE_SUPPLEMENTAL_ARTIFACTS.workspaceContract],
    reference: value.reference?.trim() || null,
  };
}

async function detectControl(
  projectPath: string,
  declaration: ProjectGovernanceDeclaration | undefined,
  control: 'ci' | 'release' | 'ownership'
): Promise<ProjectGovernanceControl> {
  const declared = declaredControl(declaration, control);
  if (declared) return declared;
  const repositoryEvidence = [
    ...(await existingSurface(projectPath, REPOSITORY_SURFACES[control])),
    ...(control === 'release' ? await releaseWorkflowEvidence(projectPath) : []),
  ];
  if (repositoryEvidence.length > 0) {
    return {
      status: 'repository',
      provider: null,
      evidence: repositoryEvidence,
      reference: null,
    };
  }
  const observed = await observedExternalReferences(
    projectPath,
    EXTERNAL_REFERENCE_PATTERNS[control]
  );
  if (observed.length > 0) {
    return {
      status: 'external-observed',
      provider: null,
      evidence: observed,
      reference: null,
    };
  }
  return { status: 'unknown', provider: null, evidence: [], reference: null };
}

export async function detectProjectGovernance(input: {
  projectPath: string;
  declaration?: ProjectGovernanceDeclaration;
}): Promise<ProjectGovernanceProfile> {
  const [ci, release, ownership] = await Promise.all([
    detectControl(input.projectPath, input.declaration, 'ci'),
    detectControl(input.projectPath, input.declaration, 'release'),
    detectControl(input.projectPath, input.declaration, 'ownership'),
  ]);
  return {
    schemaVersion: 'workspai.project-governance.v1',
    ci,
    release,
    ownership,
  };
}
