/**
 * ASP.NET Core Web API Clean Architecture scaffold generator.
 *
 * Runs entirely at npm level - no Python core engine required.
 */

import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { execa } from 'execa';
import { getVersion } from '../update-checker.js';
import { buildCleanGitEnv, isInsideExistingGitWorktree } from '../utils/git-worktree.js';
import { toPascalCase, writeGeneratorFile } from './go-kit-common.js';
import { buildNativeKitDependabotYml, NATIVE_KIT_BASELINES } from './native-kit-baselines.js';

export const DEFAULT_DOTNET_TARGET_FRAMEWORK = NATIVE_KIT_BASELINES.dotnet.targetFramework;
export const DEFAULT_DOTNET_PORT = '8080';

export interface DotnetWebApiCleanVariables {
  project_name: string;
  root_namespace?: string;
  description?: string;
  target_framework?: string;
  app_version?: string;
  port?: string;
  skipGit?: boolean;
  skipInstall?: boolean;
}

function sanitizeProjectSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function sanitizeNamespace(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .replace(/[^A-Za-z0-9_.]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.{2,}/g, '.');
  const segments = cleaned
    .split('.')
    .map((segment) => segment.replace(/^[^A-Za-z_]+/, '').replace(/[^A-Za-z0-9_]/g, ''))
    .filter(Boolean);

  return segments.join('.') || fallback;
}

function sanitizeHumanText(value: string, fallback: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim() || fallback;
}

function isTargetFramework(value: string): boolean {
  return value.trim() === DEFAULT_DOTNET_TARGET_FRAMEWORK;
}

function contextJson(): string {
  return JSON.stringify({ engine: 'npm', runtime: 'dotnet' }, null, 2);
}

function projectJson(v: Required<DotnetWebApiCleanVariables>, rapidkitVersion: string): string {
  return JSON.stringify(
    {
      kit_name: 'dotnet.webapi.clean',
      runtime: 'dotnet',
      framework: 'dotnet',
      module_support: false,
      project_name: v.project_name,
      root_namespace: v.root_namespace,
      target_framework: v.target_framework,
      app_version: v.app_version,
      created_by: 'workspai',
      workspai_version: rapidkitVersion,
      rapidkit_version: rapidkitVersion,
      created_at: new Date().toISOString(),
    },
    null,
    2
  );
}

function csproj(v: Required<DotnetWebApiCleanVariables>): string {
  return `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>${v.target_framework}</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <RootNamespace>${v.root_namespace}</RootNamespace>
    <AssemblyName>${v.root_namespace}</AssemblyName>
    <Version>${v.app_version}</Version>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <GenerateDocumentationFile>true</GenerateDocumentationFile>
    <NoWarn>$(NoWarn);1591</NoWarn>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.AspNetCore.OpenApi" Version="${NATIVE_KIT_BASELINES.dotnet.aspnetPatch}" />
    <PackageReference Include="Swashbuckle.AspNetCore" Version="${NATIVE_KIT_BASELINES.dotnet.swashbuckle}" />
  </ItemGroup>
</Project>
`;
}

function testCsproj(v: Required<DotnetWebApiCleanVariables>): string {
  return `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>${v.target_framework}</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <IsPackable>false</IsPackable>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" Version="${NATIVE_KIT_BASELINES.dotnet.aspnetPatch}" />
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="${NATIVE_KIT_BASELINES.dotnet.testSdk}" />
    <PackageReference Include="xunit" Version="${NATIVE_KIT_BASELINES.dotnet.xunit}" />
    <PackageReference Include="xunit.runner.visualstudio" Version="${NATIVE_KIT_BASELINES.dotnet.xunitRunner}" />
    <PackageReference Include="coverlet.collector" Version="${NATIVE_KIT_BASELINES.dotnet.coverlet}" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\\src\\${v.project_name}.csproj" />
  </ItemGroup>
</Project>
`;
}

function programCs(v: Required<DotnetWebApiCleanVariables>): string {
  return `using ${v.root_namespace}.Application;
using ${v.root_namespace}.Infrastructure;
using ${v.root_namespace}.Presentation;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<ApplicationInfoOptions>(
    builder.Configuration.GetSection(ApplicationInfoOptions.SectionName));
builder.Services.AddApplicationServices();
builder.Services.AddInfrastructureServices();
builder.Services.AddPresentationServices();
builder.Services.AddHealthChecks();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(options => options.RoutePrefix = "docs");
}

app.UseExceptionHandler();
app.MapHealthChecks("/health/live");
app.MapHealthChecks("/health/ready");
app.MapSystemEndpoints();

app.Run();

public partial class Program
{
}
`;
}

function applicationInfoOptionsCs(v: Required<DotnetWebApiCleanVariables>): string {
  return `namespace ${v.root_namespace}.Application;

public sealed class ApplicationInfoOptions
{
    public const string SectionName = "Workspai";

    public string Name { get; init; } = "${v.project_name}";

    public string Version { get; init; } = "${v.app_version}";

    public string Description { get; init; } = "${v.description}";
}
`;
}

function applicationServiceRegistrationCs(v: Required<DotnetWebApiCleanVariables>): string {
  return `using Microsoft.Extensions.DependencyInjection;

namespace ${v.root_namespace}.Application;

public static class ApplicationServiceRegistration
{
    public static IServiceCollection AddApplicationServices(this IServiceCollection services)
    {
        services.AddSingleton<SystemInfoService>();
        return services;
    }
}
`;
}

function systemInfoServiceCs(v: Required<DotnetWebApiCleanVariables>): string {
  return `using Microsoft.Extensions.Options;

namespace ${v.root_namespace}.Application;

public sealed record SystemInfoResponse(
    string Name,
    string Version,
    string Runtime,
    string Environment,
    DateTimeOffset ServerTimeUtc);

public sealed class SystemInfoService(IOptions<ApplicationInfoOptions> options)
{
    public SystemInfoResponse GetInfo(IHostEnvironment environment)
    {
        var info = options.Value;
        return new SystemInfoResponse(
            info.Name,
            info.Version,
            ".NET",
            environment.EnvironmentName,
            DateTimeOffset.UtcNow);
    }
}
`;
}

function infrastructureServiceRegistrationCs(v: Required<DotnetWebApiCleanVariables>): string {
  return `using Microsoft.Extensions.DependencyInjection;

namespace ${v.root_namespace}.Infrastructure;

public static class InfrastructureServiceRegistration
{
    public static IServiceCollection AddInfrastructureServices(this IServiceCollection services)
    {
        return services;
    }
}
`;
}

function presentationServiceRegistrationCs(v: Required<DotnetWebApiCleanVariables>): string {
  return `using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace ${v.root_namespace}.Presentation;

public static class PresentationServiceRegistration
{
    public static IServiceCollection AddPresentationServices(this IServiceCollection services)
    {
        services.AddExceptionHandler<GlobalExceptionHandler>();
        services.AddProblemDetails();
        return services;
    }
}

internal sealed class GlobalExceptionHandler : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext,
        Exception exception,
        CancellationToken cancellationToken)
    {
        httpContext.Response.StatusCode = StatusCodes.Status500InternalServerError;
        await httpContext.Response.WriteAsJsonAsync(
            new
            {
                error = "internal_error",
                traceId = httpContext.TraceIdentifier,
            },
            cancellationToken);
        return true;
    }
}
`;
}

function systemEndpointsCs(v: Required<DotnetWebApiCleanVariables>): string {
  return `using ${v.root_namespace}.Application;

namespace ${v.root_namespace}.Presentation;

public static class SystemEndpoints
{
    public static IEndpointRouteBuilder MapSystemEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/system").WithTags("System");

        group.MapGet("/info", (SystemInfoService service, IHostEnvironment environment) =>
            Results.Ok(service.GetInfo(environment)))
            .WithName("GetSystemInfo")
            .Produces<SystemInfoResponse>();

        return app;
    }
}
`;
}

function appsettings(v: Required<DotnetWebApiCleanVariables>): string {
  return JSON.stringify(
    {
      Workspai: {
        Name: v.project_name,
        Version: v.app_version,
        Description: v.description,
      },
      Logging: {
        LogLevel: {
          Default: 'Information',
          'Microsoft.AspNetCore': 'Warning',
        },
      },
      AllowedHosts: '*',
      Kestrel: {
        Endpoints: {
          Http: {
            Url: `http://0.0.0.0:${v.port}`,
          },
        },
      },
    },
    null,
    2
  );
}

function dockerfile(v: Required<DotnetWebApiCleanVariables>): string {
  return `FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/*.csproj ./src/
COPY tests/*.csproj ./tests/
RUN dotnet restore ./src/${v.project_name}.csproj
COPY . .
RUN dotnet publish ./src/${v.project_name}.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
RUN apt-get update \\
    && apt-get install -y --no-install-recommends curl \\
    && rm -rf /var/lib/apt/lists/*
ENV ASPNETCORE_URLS=http://+:${v.port}
COPY --from=build /app/publish .
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -fsS http://localhost:${v.port}/health/live || exit 1
USER $APP_UID
ENTRYPOINT ["dotnet", "${v.root_namespace}.dll"]
`;
}

function dockerCompose(v: Required<DotnetWebApiCleanVariables>): string {
  return `services:
  api:
    build: .
    ports:
      - "\${PORT:-${v.port}}:${v.port}"
    environment:
      ASPNETCORE_ENVIRONMENT: Development
      ASPNETCORE_URLS: http://+:${v.port}
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:${v.port}/health/live"]
      interval: 30s
      timeout: 5s
      retries: 3
`;
}

function makefile(v: Required<DotnetWebApiCleanVariables>): string {
  return `.PHONY: init dev start build test lint format docker-up docker-down

init:
\tdotnet restore src/${v.project_name}.csproj
\tdotnet tool restore || true

dev:
\tdotnet run --project src/${v.project_name}.csproj

start:
\tdotnet run --project src/${v.project_name}.csproj

build:
\tdotnet build src/${v.project_name}.csproj -c Release

test:
\tdotnet test tests/${v.project_name}.Tests.csproj --collect:"XPlat Code Coverage"

lint:
\tdotnet format src/${v.project_name}.csproj --verify-no-changes
\tdotnet format tests/${v.project_name}.Tests.csproj --verify-no-changes

format:
\tdotnet format src/${v.project_name}.csproj
\tdotnet format tests/${v.project_name}.Tests.csproj

docker-up:
\tdocker compose up --build -d

docker-down:
\tdocker compose down
`;
}

function launcherShell(v: Required<DotnetWebApiCleanVariables>): string {
  return `#!/usr/bin/env sh
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CMD="\${1:-help}"
shift 2>/dev/null || true

case "$CMD" in
  init)
    cd "$SCRIPT_DIR" || exit 1
    dotnet restore "src/${v.project_name}.csproj" || exit $?
    dotnet tool restore 2>/dev/null || true
    ;;
  dev) exec dotnet run --project "$SCRIPT_DIR/src/${v.project_name}.csproj" "$@" ;;
  start) exec dotnet run --project "$SCRIPT_DIR/src/${v.project_name}.csproj" "$@" ;;
  build) exec dotnet build "$SCRIPT_DIR/src/${v.project_name}.csproj" -c Release "$@" ;;
  test) exec dotnet test "$SCRIPT_DIR/tests/${v.project_name}.Tests.csproj" "$@" ;;
  lint)
    dotnet format "$SCRIPT_DIR/src/${v.project_name}.csproj" --verify-no-changes "$@" || exit $?
    exec dotnet format "$SCRIPT_DIR/tests/${v.project_name}.Tests.csproj" --verify-no-changes "$@"
    ;;
  format|fmt)
    dotnet format "$SCRIPT_DIR/src/${v.project_name}.csproj" "$@" || exit $?
    exec dotnet format "$SCRIPT_DIR/tests/${v.project_name}.Tests.csproj" "$@"
    ;;
  help|--help|-h)
    echo "Workspai — ASP.NET Core project: ${v.project_name}"
    echo "Available: init, dev, start, build, test, lint, format"
    ;;
  *) echo "rapidkit: unknown command: $CMD" >&2; exit 1 ;;
esac
`;
}

function launcherCmd(v: Required<DotnetWebApiCleanVariables>): string {
  return `@echo off
set CMD=%1
if "%CMD%"=="" set CMD=help
shift

if "%CMD%"=="init" (
  dotnet restore src\\${v.project_name}.csproj
  if errorlevel 1 exit /b %ERRORLEVEL%
  dotnet tool restore 2>nul
  exit /b 0
)
if "%CMD%"=="dev" ( dotnet run --project src\\${v.project_name}.csproj %* & exit /b %ERRORLEVEL% )
if "%CMD%"=="start" ( dotnet run --project src\\${v.project_name}.csproj %* & exit /b %ERRORLEVEL% )
if "%CMD%"=="build" ( dotnet build src\\${v.project_name}.csproj -c Release %* & exit /b %ERRORLEVEL% )
if "%CMD%"=="test" ( dotnet test tests\\${v.project_name}.Tests.csproj %* & exit /b %ERRORLEVEL% )
if "%CMD%"=="lint" (
  dotnet format src\\${v.project_name}.csproj --verify-no-changes %*
  if errorlevel 1 exit /b %ERRORLEVEL%
  dotnet format tests\\${v.project_name}.Tests.csproj --verify-no-changes %*
  exit /b %ERRORLEVEL%
)
if "%CMD%"=="format" (
  dotnet format src\\${v.project_name}.csproj %*
  if errorlevel 1 exit /b %ERRORLEVEL%
  dotnet format tests\\${v.project_name}.Tests.csproj %*
  exit /b %ERRORLEVEL%
)

echo Available: init, dev, start, build, test, lint, format
exit /b 1
`;
}

function ciWorkflow(v: Required<DotnetWebApiCleanVariables>): string {
  return `name: CI

on:
  push:
  pull_request:

permissions:
  contents: read

jobs:
  verify:
    runs-on: \${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
    steps:
      - uses: actions/checkout@${NATIVE_KIT_BASELINES.actions.checkout}
      - uses: actions/setup-dotnet@${NATIVE_KIT_BASELINES.actions.setupDotnet}
        with:
          dotnet-version: ${NATIVE_KIT_BASELINES.dotnet.sdkChannel}
      - name: Restore
        run: |
          dotnet restore src/${v.project_name}.csproj
          dotnet restore tests/${v.project_name}.Tests.csproj
      - name: Format check
        run: |
          dotnet format src/${v.project_name}.csproj --verify-no-changes
          dotnet format tests/${v.project_name}.Tests.csproj --verify-no-changes
      - name: Build
        run: dotnet build tests/${v.project_name}.Tests.csproj -c Release --no-restore
      - name: Vulnerability audit
        run: dotnet list tests/${v.project_name}.Tests.csproj package --vulnerable --include-transitive
      - name: Test
        run: dotnet test tests/${v.project_name}.Tests.csproj -c Release --no-build --collect:"XPlat Code Coverage"
`;
}

function testRuntimeCs(v: Required<DotnetWebApiCleanVariables>): string {
  return `using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace ${v.root_namespace}.Tests;

public sealed class RuntimeSmokeTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public RuntimeSmokeTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task HealthEndpointShouldReturnOk()
    {
        using var client = _factory.CreateClient();
        var response = await client.GetAsync("/health/live");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task SystemInfoEndpointShouldReturnOk()
    {
        using var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/v1/system/info");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
`;
}

function solutionFile(v: Required<DotnetWebApiCleanVariables>): string {
  return `
Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
VisualStudioVersion = 17.0.31903.59
MinimumVisualStudioVersion = 10.0.40219.1
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "src", "src", "{33333333-3333-3333-3333-333333333333}"
EndProject
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "tests", "tests", "{44444444-4444-4444-4444-444444444444}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "${v.project_name}", "src\\${v.project_name}.csproj", "{11111111-1111-1111-1111-111111111111}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "${v.project_name}.Tests", "tests\\${v.project_name}.Tests.csproj", "{22222222-2222-2222-2222-222222222222}"
EndProject
Global
	GlobalSection(SolutionConfigurationPlatforms) = preSolution
		Debug|Any CPU = Debug|Any CPU
		Debug|x64 = Debug|x64
		Debug|x86 = Debug|x86
		Release|Any CPU = Release|Any CPU
		Release|x64 = Release|x64
		Release|x86 = Release|x86
	EndGlobalSection
	GlobalSection(ProjectConfigurationPlatforms) = postSolution
		{11111111-1111-1111-1111-111111111111}.Debug|Any CPU.ActiveCfg = Debug|Any CPU
		{11111111-1111-1111-1111-111111111111}.Debug|Any CPU.Build.0 = Debug|Any CPU
		{11111111-1111-1111-1111-111111111111}.Debug|x64.ActiveCfg = Debug|Any CPU
		{11111111-1111-1111-1111-111111111111}.Debug|x64.Build.0 = Debug|Any CPU
		{11111111-1111-1111-1111-111111111111}.Debug|x86.ActiveCfg = Debug|Any CPU
		{11111111-1111-1111-1111-111111111111}.Debug|x86.Build.0 = Debug|Any CPU
		{11111111-1111-1111-1111-111111111111}.Release|Any CPU.ActiveCfg = Release|Any CPU
		{11111111-1111-1111-1111-111111111111}.Release|Any CPU.Build.0 = Release|Any CPU
		{11111111-1111-1111-1111-111111111111}.Release|x64.ActiveCfg = Release|Any CPU
		{11111111-1111-1111-1111-111111111111}.Release|x64.Build.0 = Release|Any CPU
		{11111111-1111-1111-1111-111111111111}.Release|x86.ActiveCfg = Release|Any CPU
		{11111111-1111-1111-1111-111111111111}.Release|x86.Build.0 = Release|Any CPU
		{22222222-2222-2222-2222-222222222222}.Debug|Any CPU.ActiveCfg = Debug|Any CPU
		{22222222-2222-2222-2222-222222222222}.Debug|Any CPU.Build.0 = Debug|Any CPU
		{22222222-2222-2222-2222-222222222222}.Debug|x64.ActiveCfg = Debug|Any CPU
		{22222222-2222-2222-2222-222222222222}.Debug|x64.Build.0 = Debug|Any CPU
		{22222222-2222-2222-2222-222222222222}.Debug|x86.ActiveCfg = Debug|Any CPU
		{22222222-2222-2222-2222-222222222222}.Debug|x86.Build.0 = Debug|Any CPU
		{22222222-2222-2222-2222-222222222222}.Release|Any CPU.ActiveCfg = Release|Any CPU
		{22222222-2222-2222-2222-222222222222}.Release|Any CPU.Build.0 = Release|Any CPU
		{22222222-2222-2222-2222-222222222222}.Release|x64.ActiveCfg = Release|Any CPU
		{22222222-2222-2222-2222-222222222222}.Release|x64.Build.0 = Release|Any CPU
		{22222222-2222-2222-2222-222222222222}.Release|x86.ActiveCfg = Release|Any CPU
		{22222222-2222-2222-2222-222222222222}.Release|x86.Build.0 = Release|Any CPU
	EndGlobalSection
	GlobalSection(SolutionProperties) = preSolution
		HideSolutionNode = FALSE
	EndGlobalSection
	GlobalSection(NestedProjects) = preSolution
		{11111111-1111-1111-1111-111111111111} = {33333333-3333-3333-3333-333333333333}
		{22222222-2222-2222-2222-222222222222} = {44444444-4444-4444-4444-444444444444}
	EndGlobalSection
EndGlobal
`.trimStart();
}

async function maybeInitGit(projectPath: string, skipGit?: boolean): Promise<void> {
  if (skipGit) return;
  try {
    if (await isInsideExistingGitWorktree(projectPath)) {
      console.log(chalk.gray('⚠  git init skipped (target is inside an existing git worktree)'));
      return;
    }
    await execa('git', ['init'], {
      cwd: projectPath,
      stdio: 'ignore',
      env: buildCleanGitEnv(),
    });
  } catch {
    console.log(chalk.gray('⚠  git init skipped (git not found or error)'));
  }
}

async function warnIfDotnetMissing(projectPath: string): Promise<void> {
  try {
    await execa('dotnet', ['--version'], { cwd: projectPath, timeout: 3000, stdio: 'pipe' });
  } catch {
    console.log(
      chalk.yellow(
        `⚠  .NET SDK not found in PATH - project scaffolded, but init/build need ${DEFAULT_DOTNET_TARGET_FRAMEWORK}`
      )
    );
    console.log(chalk.gray('   Install: https://dotnet.microsoft.com/download'));
  }
}

export async function generateDotnetWebApiCleanKit(
  projectPath: string,
  variables: DotnetWebApiCleanVariables
): Promise<void> {
  const projectName = sanitizeProjectSlug(variables.project_name) || 'dotnet-api';
  const rootNamespace = sanitizeNamespace(
    variables.root_namespace || `Workspai.${toPascalCase(projectName)}`,
    'Workspai.App'
  );
  const requestedTargetFramework = variables.target_framework?.trim();
  const targetFramework =
    requestedTargetFramework && isTargetFramework(requestedTargetFramework)
      ? requestedTargetFramework
      : DEFAULT_DOTNET_TARGET_FRAMEWORK;
  const port =
    variables.port && /^\d+$/.test(variables.port) ? variables.port : DEFAULT_DOTNET_PORT;
  const v: Required<DotnetWebApiCleanVariables> = {
    project_name: projectName,
    root_namespace: rootNamespace,
    description: sanitizeHumanText(
      variables.description || '',
      'Production-ready ASP.NET Core Web API scaffolded by Workspai.'
    ),
    target_framework: targetFramework,
    app_version: variables.app_version || '0.1.0',
    port,
    skipGit: variables.skipGit ?? false,
    skipInstall: variables.skipInstall ?? false,
  };

  const spinner = ora(`Creating ASP.NET Core Web API project ${projectName}`).start();
  await fs.mkdir(projectPath, { recursive: true });

  await writeGeneratorFile(path.join(projectPath, `${projectName}.sln`), solutionFile(v));
  await writeGeneratorFile(path.join(projectPath, 'src', `${projectName}.csproj`), csproj(v));
  await writeGeneratorFile(path.join(projectPath, 'src', 'Program.cs'), programCs(v));
  await writeGeneratorFile(
    path.join(projectPath, 'src', 'Application', 'ApplicationInfoOptions.cs'),
    applicationInfoOptionsCs(v)
  );
  await writeGeneratorFile(
    path.join(projectPath, 'src', 'Application', 'ApplicationServiceRegistration.cs'),
    applicationServiceRegistrationCs(v)
  );
  await writeGeneratorFile(
    path.join(projectPath, 'src', 'Application', 'SystemInfoService.cs'),
    systemInfoServiceCs(v)
  );
  await writeGeneratorFile(
    path.join(projectPath, 'src', 'Infrastructure', 'InfrastructureServiceRegistration.cs'),
    infrastructureServiceRegistrationCs(v)
  );
  await writeGeneratorFile(
    path.join(projectPath, 'src', 'Presentation', 'PresentationServiceRegistration.cs'),
    presentationServiceRegistrationCs(v)
  );
  await writeGeneratorFile(
    path.join(projectPath, 'src', 'Presentation', 'SystemEndpoints.cs'),
    systemEndpointsCs(v)
  );
  await writeGeneratorFile(path.join(projectPath, 'src', 'appsettings.json'), appsettings(v));
  await writeGeneratorFile(
    path.join(projectPath, 'src', 'appsettings.Development.json'),
    appsettings(v)
  );
  await writeGeneratorFile(
    path.join(projectPath, 'tests', `${projectName}.Tests.csproj`),
    testCsproj(v)
  );
  await writeGeneratorFile(
    path.join(projectPath, 'tests', 'RuntimeSmokeTests.cs'),
    testRuntimeCs(v)
  );
  await writeGeneratorFile(path.join(projectPath, 'Dockerfile'), dockerfile(v));
  await writeGeneratorFile(path.join(projectPath, 'docker-compose.yml'), dockerCompose(v));
  await writeGeneratorFile(path.join(projectPath, 'Makefile'), makefile(v));
  await writeGeneratorFile(path.join(projectPath, 'rapidkit'), launcherShell(v));
  await writeGeneratorFile(path.join(projectPath, 'rapidkit.cmd'), launcherCmd(v));
  await writeGeneratorFile(
    path.join(projectPath, '.env.example'),
    `ASPNETCORE_ENVIRONMENT=Development\nPORT=${v.port}\n`
  );
  await writeGeneratorFile(path.join(projectPath, '.github', 'workflows', 'ci.yml'), ciWorkflow(v));
  await writeGeneratorFile(
    path.join(projectPath, '.github', 'dependabot.yml'),
    buildNativeKitDependabotYml('nuget')
  );
  await writeGeneratorFile(path.join(projectPath, '.workspai', 'context.json'), contextJson());
  await writeGeneratorFile(
    path.join(projectPath, '.workspai', 'project.json'),
    projectJson(v, getVersion())
  );

  if (process.platform !== 'win32') {
    await fs.chmod(path.join(projectPath, 'rapidkit'), 0o755);
  }

  await maybeInitGit(projectPath, v.skipGit);
  spinner.succeed('ASP.NET Core Web API project ready');
  // --skip-install guarantees a host-toolchain-free scaffold operation.
  if (!v.skipInstall) {
    await warnIfDotnetMissing(projectPath);
  }

  console.log(chalk.green('\n✅ ASP.NET Core project ready!\n'));
  console.log(chalk.gray('Next steps:'));
  console.log(chalk.white(`  cd ${projectName}`));
  console.log(chalk.white('  npx workspai init'));
  console.log(chalk.white('  npx workspai dev'));
  console.log(chalk.gray(`\nEndpoints: /health/live, /health/ready, /api/v1/system/info, /docs`));
  console.log(chalk.gray('ℹ  RapidKit Core modules are not available for .NET projects yet.'));
}
