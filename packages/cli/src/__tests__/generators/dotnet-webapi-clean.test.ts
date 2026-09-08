import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateDotnetWebApiCleanKit } from '../../generators/dotnet-webapi-clean.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

vi.mock('execa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('execa')>();
  return {
    ...actual,
    execa: vi.fn().mockImplementation((cmd: string) => {
      if (cmd === 'dotnet') {
        return Promise.resolve({ stdout: '8.0.401', stderr: '', exitCode: 0 });
      }
      if (cmd === 'git') {
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
      }
      return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
    }),
  };
});

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    text: '',
  })),
}));

describe('generateDotnetWebApiCleanKit', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(
      os.tmpdir(),
      `dotnet-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await fs.mkdir(testDir, { recursive: true });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('creates an enterprise ASP.NET Core clean Web API scaffold', async () => {
    const projectPath = path.join(testDir, 'orders-api');

    await generateDotnetWebApiCleanKit(projectPath, {
      project_name: 'orders-api',
      root_namespace: 'Acme.Orders',
      skipGit: true,
    });

    const expectedFiles = [
      'orders-api.sln',
      'src/orders-api.csproj',
      'src/Program.cs',
      'src/Application/ApplicationInfoOptions.cs',
      'src/Application/ApplicationServiceRegistration.cs',
      'src/Application/SystemInfoService.cs',
      'src/Infrastructure/InfrastructureServiceRegistration.cs',
      'src/Presentation/PresentationServiceRegistration.cs',
      'src/Presentation/SystemEndpoints.cs',
      'src/appsettings.json',
      'tests/orders-api.Tests.csproj',
      'tests/RuntimeSmokeTests.cs',
      'Dockerfile',
      'docker-compose.yml',
      'Makefile',
      'rapidkit',
      'rapidkit.cmd',
      '.github/workflows/ci.yml',
      '.github/dependabot.yml',
      '.workspai/project.json',
      '.workspai/context.json',
      '.workspai/project.json',
      '.workspai/context.json',
    ];

    for (const file of expectedFiles) {
      await expect(fs.stat(path.join(projectPath, file))).resolves.toBeTruthy();
    }
  });

  it('writes .NET metadata, runtime launchers, and health endpoints', async () => {
    const projectPath = path.join(testDir, 'billing-api');

    await generateDotnetWebApiCleanKit(projectPath, {
      project_name: 'billing-api',
      target_framework: 'net10.0',
      port: '9090',
      skipGit: true,
    });

    const projectJson = JSON.parse(
      await fs.readFile(path.join(projectPath, '.workspai', 'project.json'), 'utf8')
    );
    expect(projectJson.kit_name).toBe('dotnet.webapi.clean');
    expect(projectJson.runtime).toBe('dotnet');
    expect(projectJson.module_support).toBe(false);

    const solution = await fs.readFile(path.join(projectPath, 'billing-api.sln'), 'utf8');
    expect(solution).toContain('GlobalSection(SolutionConfigurationPlatforms)');
    expect(solution).toContain('GlobalSection(ProjectConfigurationPlatforms)');

    const csproj = await fs.readFile(path.join(projectPath, 'src/billing-api.csproj'), 'utf8');
    expect(csproj).toContain('<Project Sdk="Microsoft.NET.Sdk.Web">');
    expect(csproj).toContain('<TargetFramework>net10.0</TargetFramework>');
    expect(csproj).toContain('<NoWarn>$(NoWarn);1591</NoWarn>');
    expect(csproj).toContain('Swashbuckle.AspNetCore');
    expect(csproj).toContain('Microsoft.AspNetCore.OpenApi" Version="10.0.11');
    expect(csproj).toContain('Swashbuckle.AspNetCore" Version="10.2.3');

    const dockerfile = await fs.readFile(path.join(projectPath, 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain('mcr.microsoft.com/dotnet/aspnet:10.0');
    expect(dockerfile).toContain('USER $APP_UID');

    const program = await fs.readFile(path.join(projectPath, 'src/Program.cs'), 'utf8');
    expect(program).toContain('MapHealthChecks("/health/live")');
    expect(program).toContain('MapSystemEndpoints()');

    const applicationInfo = await fs.readFile(
      path.join(projectPath, 'src/Application/ApplicationInfoOptions.cs'),
      'utf8'
    );
    expect(applicationInfo).toContain('namespace Workspai.BillingApi.Application;');
    expect(applicationInfo).toContain('public const string SectionName = "Workspai";');

    const appsettings = JSON.parse(
      await fs.readFile(path.join(projectPath, 'src/appsettings.json'), 'utf8')
    );
    expect(appsettings.Workspai.Name).toBe('billing-api');
    expect(appsettings.RapidKit).toBeUndefined();

    const unixLauncher = await fs.readFile(path.join(projectPath, 'rapidkit'), 'utf8');
    expect(unixLauncher).toContain('dotnet run');
    expect(unixLauncher).toContain('dotnet format');

    const ciWorkflow = await fs.readFile(
      path.join(projectPath, '.github/workflows/ci.yml'),
      'utf8'
    );
    expect(ciWorkflow).toContain('actions/setup-dotnet@v6');
    expect(ciWorkflow).toContain('dotnet-version: 10.0.x');
    expect(ciWorkflow).toContain('permissions:\n  contents: read');
    expect(ciWorkflow).toContain('package --vulnerable --include-transitive');
    expect(ciWorkflow).toContain('dotnet test');
    expect(ciWorkflow).toContain('windows-latest');
    expect(ciWorkflow).toContain(
      'dotnet build tests/billing-api.Tests.csproj -c Release --no-restore'
    );
    expect(ciWorkflow).toContain(
      'dotnet test tests/billing-api.Tests.csproj -c Release --no-build'
    );
  });

  it('falls back to net10.0 when an inconsistent target framework is requested', async () => {
    const projectPath = path.join(testDir, 'framework-api');

    await generateDotnetWebApiCleanKit(projectPath, {
      project_name: 'framework-api',
      target_framework: 'net9.0',
      skipGit: true,
    });

    const csproj = await fs.readFile(path.join(projectPath, 'src/framework-api.csproj'), 'utf8');
    const projectJson = JSON.parse(
      await fs.readFile(path.join(projectPath, '.workspai/project.json'), 'utf8')
    );
    expect(csproj).toContain('<TargetFramework>net10.0</TargetFramework>');
    expect(projectJson.target_framework).toBe('net10.0');
  });

  it('does not invoke host tools when install and git are skipped', async () => {
    const { execa } = await import('execa');
    const projectPath = path.join(testDir, 'offline-api');

    await generateDotnetWebApiCleanKit(projectPath, {
      project_name: 'offline-api',
      skipGit: true,
      skipInstall: true,
    });

    expect(execa).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(projectPath, 'offline-api.sln'), 'utf8')).toContain(
      'offline-api'
    );
  });
});
