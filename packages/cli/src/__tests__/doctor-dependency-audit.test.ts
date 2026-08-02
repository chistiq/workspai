import fsExtra from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execaMock } = vi.hoisted(() => ({
  execaMock: vi.fn(),
}));

vi.mock('execa', () => ({
  execa: execaMock,
}));

import { collectDoctorDependencyAudit } from '../utils/doctor-dependency-audit.js';

describe('Doctor dependency audit evidence', () => {
  let projectPath = '';

  beforeEach(async () => {
    projectPath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-doctor-audit-'));
    execaMock.mockReset();
  });

  afterEach(async () => {
    await fsExtra.remove(projectPath);
  });

  it('normalizes npm vulnerability severities and keeps a structured invocation', async () => {
    await fsExtra.writeJSON(path.join(projectPath, 'package.json'), { name: 'node-app' });
    await fsExtra.writeJSON(path.join(projectPath, 'package-lock.json'), { lockfileVersion: 3 });
    execaMock.mockResolvedValue({
      stdout: JSON.stringify({
        vulnerabilities: {
          minimatch: {
            name: 'minimatch',
            severity: 'high',
            isDirect: false,
            via: [
              {
                source: 123456,
                url: 'https://github.com/advisories/GHSA-example',
                severity: 'high',
              },
            ],
            fixAvailable: {
              name: 'minimatch',
              version: '10.2.0',
              isSemVerMajor: true,
            },
          },
        },
        metadata: {
          vulnerabilities: { info: 0, low: 1, moderate: 2, high: 3, critical: 1, total: 7 },
        },
      }),
      stderr: '',
      exitCode: 1,
    });

    const evidence = await collectDoctorDependencyAudit({
      projectPath,
      runtime: 'node',
    });

    expect(evidence).toMatchObject({
      schemaVersion: 'doctor-dependency-audit-v1',
      status: 'vulnerable',
      tool: 'npm audit',
      findingCount: 7,
      blockingFindingCount: 6,
      severityCounts: { low: 1, moderate: 2, high: 3, critical: 1, unknown: 0 },
      subjects: [
        {
          name: 'minimatch',
          direct: false,
          advisoryIds: ['123456', 'https://github.com/advisories/GHSA-example'],
          severities: ['high'],
        },
      ],
      invocation: {
        cwd: projectPath,
        executable: 'npm',
        args: ['audit', '--json'],
      },
      remediation: {
        disposition: 'breaking-only',
        compatibleFixAvailable: false,
        breakingFixAvailable: true,
        candidates: [{ packageName: 'minimatch', version: '10.2.0', breaking: true }],
      },
    });
  });

  it('distinguishes compatible boolean npm fixes from breaking-only candidates', async () => {
    await fsExtra.writeJSON(path.join(projectPath, 'package.json'), { name: 'node-app' });
    await fsExtra.writeJSON(path.join(projectPath, 'package-lock.json'), { lockfileVersion: 3 });
    execaMock.mockResolvedValue({
      stdout: JSON.stringify({
        vulnerabilities: {
          compatible: {
            name: 'compatible',
            severity: 'high',
            isDirect: true,
            via: [],
            fixAvailable: true,
          },
          transitive: {
            name: 'transitive',
            severity: 'high',
            isDirect: false,
            via: [],
            fixAvailable: false,
          },
        },
        metadata: { vulnerabilities: { high: 2, total: 2 } },
      }),
      stderr: '',
      exitCode: 1,
    });

    const evidence = await collectDoctorDependencyAudit({ projectPath, runtime: 'node' });
    expect(evidence.remediation).toEqual({
      disposition: 'compatible',
      compatibleFixAvailable: true,
      breakingFixAvailable: false,
      candidates: [{ packageName: 'compatible', breaking: false }],
    });
  });

  it('preserves dependency identity from legacy npm advisory payloads', async () => {
    await fsExtra.writeJSON(path.join(projectPath, 'package.json'), { name: 'node-app' });
    await fsExtra.writeJSON(path.join(projectPath, 'package-lock.json'), { lockfileVersion: 1 });
    execaMock.mockResolvedValue({
      stdout: JSON.stringify({
        advisories: {
          1001: {
            id: 1001,
            module_name: 'legacy-package',
            severity: 'high',
            url: 'https://github.com/advisories/GHSA-legacy',
          },
        },
      }),
      stderr: '',
      exitCode: 1,
    });

    const evidence = await collectDoctorDependencyAudit({
      projectPath,
      runtime: 'node',
    });

    expect(evidence).toMatchObject({
      status: 'vulnerable',
      findingCount: 1,
      subjects: [
        {
          name: 'legacy-package',
          advisoryIds: ['1001', 'https://github.com/advisories/GHSA-legacy'],
          severities: ['high'],
        },
      ],
    });
  });

  it('selects pnpm, Yarn classic, Yarn Berry, and Bun from deterministic lock markers', async () => {
    execaMock.mockResolvedValue({
      stdout: JSON.stringify({ metadata: { vulnerabilities: {} } }),
      stderr: '',
      exitCode: 0,
    });

    await fsExtra.writeFile(path.join(projectPath, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
    expect(
      (
        await collectDoctorDependencyAudit({
          projectPath,
          runtime: 'node',
        })
      ).invocation
    ).toMatchObject({ executable: 'pnpm', args: ['audit', '--json'] });

    await fsExtra.remove(path.join(projectPath, 'pnpm-lock.yaml'));
    await fsExtra.writeFile(path.join(projectPath, 'yarn.lock'), '# yarn');
    expect(
      (
        await collectDoctorDependencyAudit({
          projectPath,
          runtime: 'node',
        })
      ).invocation
    ).toMatchObject({ executable: 'yarn', args: ['audit', '--json', '--level', 'moderate'] });

    await fsExtra.writeFile(path.join(projectPath, '.yarnrc.yml'), 'nodeLinker: node-modules');
    expect(
      (
        await collectDoctorDependencyAudit({
          projectPath,
          runtime: 'node',
        })
      ).invocation
    ).toMatchObject({
      executable: 'yarn',
      args: ['npm', 'audit', '--json', '--severity', 'moderate'],
    });

    expect(
      (
        await collectDoctorDependencyAudit({
          projectPath,
          runtime: 'bun',
        })
      ).invocation
    ).toMatchObject({ executable: 'bun', args: ['audit', '--json'] });
  });

  it('does not report Python as clean when pip-audit is unavailable', async () => {
    execaMock.mockResolvedValue({
      stdout: '',
      stderr: 'python3: No module named pip_audit',
      exitCode: 1,
    });

    const evidence = await collectDoctorDependencyAudit({
      projectPath,
      runtime: 'python',
    });

    expect(evidence.status).toBe('tool-unavailable');
    expect(evidence.findingCount).toBeNull();
    expect(evidence.reason).toContain('not installed');
  });

  it('parses pip-audit dependency findings without inventing severity', async () => {
    execaMock.mockResolvedValue({
      stdout: JSON.stringify({
        dependencies: [
          { name: 'safe', version: '1.0.0', vulns: [] },
          {
            name: 'unsafe',
            version: '1.0.0',
            vulns: [{ id: 'PYSEC-1' }, { id: 'GHSA-test' }],
          },
        ],
      }),
      stderr: '',
      exitCode: 1,
    });

    const evidence = await collectDoctorDependencyAudit({
      projectPath,
      runtime: 'python',
    });

    expect(evidence).toMatchObject({
      status: 'vulnerable',
      findingCount: 2,
      blockingFindingCount: 2,
      severityCounts: { unknown: 2 },
      subjects: [
        {
          name: 'unsafe',
          version: '1.0.0',
          advisoryIds: ['GHSA-test', 'PYSEC-1'],
          severities: ['unknown'],
        },
      ],
    });
  });

  it('deduplicates streaming govulncheck findings by OSV identity', async () => {
    execaMock.mockResolvedValue({
      stdout: [
        JSON.stringify({ config: { protocol_version: 'v1.0.0' } }),
        JSON.stringify({ finding: { osv: 'GO-2026-0001' } }),
        JSON.stringify({ finding: { osv: 'GO-2026-0001' } }),
        JSON.stringify({ finding: { osv: 'GO-2026-0002' } }),
      ].join('\n'),
      stderr: '',
      exitCode: 0,
    });

    const evidence = await collectDoctorDependencyAudit({
      projectPath,
      runtime: 'go',
    });

    expect(evidence).toMatchObject({
      status: 'vulnerable',
      findingCount: 2,
      blockingFindingCount: 2,
      tool: 'govulncheck',
    });
  });

  it.each([
    ['rust', 'cargo', ['audit', '--json'], { vulnerabilities: { list: [] } }],
    ['php', 'composer', ['audit', '--format=json'], { advisories: {} }],
    [
      'dotnet',
      'dotnet',
      ['package', 'list', '--vulnerable', '--include-transitive', '--format', 'json'],
      { projects: [] },
    ],
    ['ruby', 'bundle-audit', ['check', '--format', 'json'], { results: [] }],
  ] as const)(
    'produces clean structured %s audit evidence',
    async (runtime, executable, args, payload) => {
      execaMock.mockResolvedValue({
        stdout: JSON.stringify(payload),
        stderr: '',
        exitCode: 0,
      });

      const evidence = await collectDoctorDependencyAudit({
        projectPath,
        runtime,
      });

      expect(evidence.status).toBe('clean');
      expect(evidence.findingCount).toBe(0);
      expect(evidence.invocation).toMatchObject({ executable, args });
    }
  );

  it.each([
    ['deno', 'No vulnerabilities found'],
    ['elixir', 'No retired packages found'],
  ] as const)('requires an explicit clean signal for %s text audits', async (runtime, stdout) => {
    execaMock.mockResolvedValue({ stdout, stderr: '', exitCode: 0 });
    expect(
      await collectDoctorDependencyAudit({
        projectPath,
        runtime,
      })
    ).toMatchObject({ status: 'clean', findingCount: 0 });
  });

  it('treats malformed or registry-failure output as failed, never clean', async () => {
    execaMock.mockResolvedValue({
      stdout: '',
      stderr: 'registry request timed out',
      exitCode: 1,
    });

    const evidence = await collectDoctorDependencyAudit({
      projectPath,
      runtime: 'deno',
    });
    expect(evidence.status).toBe('failed');
    expect(evidence.findingCount).toBeNull();
  });

  it.each([
    ['java', 'OWASP Dependency-Check'],
    ['clojure', 'organization-selected Clojure audit'],
    ['scala', 'organization-selected JVM dependency scanner'],
    ['kotlin', 'organization-selected JVM dependency scanner'],
    ['c', 'organization-selected native dependency scanner'],
    ['cpp', 'organization-selected native dependency scanner'],
    ['unknown', 'none'],
  ] as const)(
    'records unsupported %s audits without a false clean result',
    async (runtime, tool) => {
      const evidence = await collectDoctorDependencyAudit({
        projectPath,
        runtime,
      });
      expect(evidence).toMatchObject({
        status: 'unsupported',
        tool,
        findingCount: null,
        blockingFindingCount: null,
      });
      expect(execaMock).not.toHaveBeenCalled();
    }
  );
});
