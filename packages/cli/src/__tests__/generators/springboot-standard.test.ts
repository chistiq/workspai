import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateSpringBootKit } from '../../generators/springboot-standard.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { execa } from 'execa';

vi.mock('execa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('execa')>();
  return {
    ...actual,
    execa: vi.fn().mockImplementation((cmd: string) => {
      if (cmd === 'mvn') {
        return Promise.resolve({ stdout: 'Apache Maven 3.9.9', stderr: '', exitCode: 0 });
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
    info: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    text: '',
  })),
}));

describe('generateSpringBootKit', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(
      os.tmpdir(),
      `springboot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await fs.mkdir(testDir, { recursive: true });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors.
    }
  });

  it('creates the expected Spring Boot scaffold', async () => {
    const projectPath = path.join(testDir, 'orders-service');
    await generateSpringBootKit(projectPath, { project_name: 'orders-service', skipGit: true });

    const expectedFiles = [
      'pom.xml',
      'Dockerfile',
      'docker-compose.yml',
      '.env.example',
      'scripts/perf-smoke.sh',
      '.github/dependabot.yml',
      '.workspai/project.json',
      '.workspai/context.json',
      '.workspai/project.json',
      '.workspai/context.json',
      'rapidkit',
      'rapidkit.cmd',
      'src/main/resources/application.yml',
      'src/test/resources/application.yml',
      'src/main/java/com/workspai/apps/orders/service/OrdersServiceApplication.java',
      'src/main/java/com/workspai/apps/orders/service/config/ApplicationInfoProperties.java',
      'src/main/java/com/workspai/apps/orders/service/config/OpenApiConfiguration.java',
      'src/main/java/com/workspai/apps/orders/service/application/SystemInfoService.java',
      'src/main/java/com/workspai/apps/orders/service/api/http/SystemInfoController.java',
      'src/main/java/com/workspai/apps/orders/service/api/http/ApiExceptionHandler.java',
      'src/main/java/com/workspai/apps/orders/service/api/http/dto/SystemInfoResponse.java',
      'src/test/java/com/workspai/apps/orders/service/OrdersServiceApplicationTests.java',
      'src/test/java/com/workspai/apps/orders/service/ServiceRuntimeE2ETest.java',
      'src/test/java/com/workspai/apps/orders/service/api/http/SystemInfoControllerTest.java',
    ];

    for (const file of expectedFiles) {
      const filePath = path.join(projectPath, file);
      const exists = await fs
        .stat(filePath)
        .then(() => true)
        .catch(() => false);
      expect(exists, `Expected file to exist: ${file}`).toBe(true);
    }
  });

  it('writes Spring metadata into pom.xml and project.json', async () => {
    const projectPath = path.join(testDir, 'billing-platform');
    await generateSpringBootKit(projectPath, { project_name: 'billing-platform', skipGit: true });

    const pomXml = await fs.readFile(path.join(projectPath, 'pom.xml'), 'utf8');
    expect(pomXml).toContain('<artifactId>billing-platform</artifactId>');
    expect(pomXml).toContain('<artifactId>spring-boot-starter-web</artifactId>');
    expect(pomXml).toContain('<artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>');
    expect(pomXml).toContain('<artifactId>maven-enforcer-plugin</artifactId>');
    expect(pomXml).toContain('<artifactId>dependency-check-maven</artifactId>');
    expect(pomXml).toContain('<artifactId>cyclonedx-maven-plugin</artifactId>');
    expect(pomXml).toContain('<version>3.5.16</version>');
    expect(pomXml).toContain('<springdoc.version>2.9.0</springdoc.version>');
    expect(pomXml).toContain('<version>12.2.2</version>');

    const projectJson = JSON.parse(
      await fs.readFile(path.join(projectPath, '.workspai', 'project.json'), 'utf8')
    );
    expect(projectJson.kit_name).toBe('springboot.standard');
    expect(projectJson.runtime).toBe('java');
    expect(projectJson.module_support).toBe(false);

    const mainApplicationYaml = await fs.readFile(
      path.join(projectPath, 'src/main/resources/application.yml'),
      'utf8'
    );
    expect(mainApplicationYaml).toContain('management:');
    expect(mainApplicationYaml).toContain('include: health,info,metrics');
    expect(mainApplicationYaml).toContain('path: /docs');
  });

  it('falls back to safe group/package defaults when invalid values are provided', async () => {
    const projectPath = path.join(testDir, 'invalid-group-fallback');
    await generateSpringBootKit(projectPath, {
      project_name: 'invalid-group-fallback',
      group_id: '-_@#$',
      package_name: '...---',
      skipGit: true,
    });

    const pomXml = await fs.readFile(path.join(projectPath, 'pom.xml'), 'utf8');
    expect(pomXml).toContain('<groupId>com.workspai.apps</groupId>');

    const projectJson = JSON.parse(
      await fs.readFile(path.join(projectPath, '.workspai', 'project.json'), 'utf8')
    );
    expect(projectJson.group_id).toBe('com.workspai.apps');
    expect(projectJson.package_name).toContain('com.workspai.apps');
  });

  it('emits clean Docker, env, and Java source templates', async () => {
    const projectPath = path.join(testDir, 'quality-guard-service');
    await generateSpringBootKit(projectPath, {
      project_name: 'quality-guard-service',
      skipGit: true,
    });

    const dockerfile = await fs.readFile(path.join(projectPath, 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain('FROM maven:3.9.9-eclipse-temurin-21 AS build');
    expect(dockerfile).toContain('RUN mvn -B -q -DskipTests dependency:go-offline');
    expect(dockerfile).toContain('FROM eclipse-temurin:21-jre');
    expect(dockerfile).toContain('USER 10001');
    expect(dockerfile).toContain('ENTRYPOINT ["java", "-jar", "/app/app.jar"]');
    expect(dockerfile).not.toContain('maven: 3.9.9 - eclipse - temurin - 21');

    const envExample = await fs.readFile(path.join(projectPath, '.env.example'), 'utf8');
    expect(envExample).toContain('JAVA_TOOL_OPTIONS=-Xms256m -Xmx512m');
    expect(envExample).not.toContain('JAVA_OPTS = -Xms256m - Xmx512m');

    const exceptionHandler = await fs.readFile(
      path.join(
        projectPath,
        'src/main/java/com/workspai/apps/quality/guard/service/api/http/ApiExceptionHandler.java'
      ),
      'utf8'
    );
    expect(exceptionHandler).toContain('ResponseEntity<Map<String, Object>>');
    expect(exceptionHandler).not.toContain('ResponseEntity<Map<String, Object >>');

    const controllerTest = await fs.readFile(
      path.join(
        projectPath,
        'src/test/java/com/workspai/apps/quality/guard/service/api/http/SystemInfoControllerTest.java'
      ),
      'utf8'
    );
    expect(controllerTest).toContain('@MockitoBean');
    expect(controllerTest).not.toContain('@MockBean');

    const ciWorkflow = await fs.readFile(
      path.join(projectPath, '.github/workflows/ci.yml'),
      'utf8'
    );
    expect(ciWorkflow).toContain('matrix:');
    expect(ciWorkflow).toContain('permissions:\n  contents: read');
    expect(ciWorkflow).toContain("java: ['21', '25']");
    expect(ciWorkflow).toContain('os: [ubuntu-latest, windows-latest]');
    expect(ciWorkflow).toContain('Generate Maven Wrapper (Unix)');
    expect(ciWorkflow).toContain('Generate Maven Wrapper (Windows)');
    expect(ciWorkflow).toContain("if: runner.os != 'Windows'");
    expect(ciWorkflow).toContain("if: runner.os == 'Windows'");
    expect(ciWorkflow).toContain('if [ ! -f mvnw ]');
    expect(ciWorkflow).toContain("Test-Path 'mvnw.cmd'");
    expect(ciWorkflow).toContain('shell: pwsh');
    expect(ciWorkflow).not.toContain('        run: mvn -N wrapper:wrapper');
    expect(ciWorkflow).toContain('dependency-check-maven:check');
    expect(ciWorkflow).toContain('Verify (Unix)');
    expect(ciWorkflow).toContain('Verify (Windows)');
    expect(ciWorkflow).toContain('./mvnw -B verify');
    expect(ciWorkflow).toContain('.\\mvnw.cmd -B verify');
    expect(ciWorkflow).toMatch(
      /^(\s*)- uses: actions\/setup-java@v6\n\1  with:\n\1    distribution: temurin/m
    );
    expect(ciWorkflow).toMatch(
      /^(\s*)- name: Upload SBOM\n\1  if: always\(\)\n\1  uses: actions\/upload-artifact@v4\n\1  with:/m
    );

    const perfScript = await fs.readFile(path.join(projectPath, 'scripts/perf-smoke.sh'), 'utf8');
    expect(perfScript).toContain('/actuator/health');
    expect(perfScript).toContain('startup_seconds=');

    const unixLauncher = await fs.readFile(path.join(projectPath, 'rapidkit'), 'utf8');
    expect(unixLauncher).toContain('maven_cmd()');
    expect(unixLauncher).toContain('"$SCRIPT_DIR/mvnw"');

    const windowsLauncher = await fs.readFile(path.join(projectPath, 'rapidkit.cmd'), 'utf8');
    expect(windowsLauncher).toContain('set BUILD_CMD=mvn');
    expect(windowsLauncher).toContain('if exist mvnw.cmd set BUILD_CMD=mvnw.cmd');

    const e2eTest = await fs.readFile(
      path.join(
        projectPath,
        'src/test/java/com/workspai/apps/quality/guard/service/ServiceRuntimeE2ETest.java'
      ),
      'utf8'
    );
    expect(e2eTest).toContain('healthEndpointShouldBeUp');
    expect(e2eTest).toContain('TestRestTemplate');
  });

  it('makes the launcher scripts executable', async () => {
    const projectPath = path.join(testDir, 'inventory-service');
    await generateSpringBootKit(projectPath, { project_name: 'inventory-service', skipGit: true });

    const stat = await fs.stat(path.join(projectPath, 'rapidkit'));
    // On Windows, execute bits are not supported; skip the check
    if (process.platform !== 'win32') {
      expect(stat.mode & 0o111).not.toBe(0);
    }
  });

  it('propagates custom Java version and port to Docker templates', async () => {
    const projectPath = path.join(testDir, 'custom-runtime-service');
    await generateSpringBootKit(projectPath, {
      project_name: 'custom-runtime-service',
      java_version: '22',
      port: '9090',
      skipGit: true,
      skipInstall: true,
    });

    const dockerfile = await fs.readFile(path.join(projectPath, 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain('FROM maven:3.9.9-eclipse-temurin-22 AS build');
    expect(dockerfile).toContain('FROM eclipse-temurin:22-jre');
    expect(dockerfile).toContain('EXPOSE 9090');

    const compose = await fs.readFile(path.join(projectPath, 'docker-compose.yml'), 'utf8');
    expect(compose).toContain('- "9090:9090"');
  });

  it('does not invoke Maven or another external process when install and git are skipped', async () => {
    const projectPath = path.join(testDir, 'offline-spring-service');

    await generateSpringBootKit(projectPath, {
      project_name: 'offline-spring-service',
      skipGit: true,
      skipInstall: true,
    });

    expect(execa).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(projectPath, 'pom.xml'), 'utf8')).toContain(
      '<artifactId>offline-spring-service</artifactId>'
    );
  });
});
