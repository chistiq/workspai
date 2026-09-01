/**
 * Spring Boot (springboot.standard) scaffold generator.
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

export const DEFAULT_JAVA_VERSION = NATIVE_KIT_BASELINES.springBoot.java;
export const DEFAULT_SPRING_BOOT_VERSION = NATIVE_KIT_BASELINES.springBoot.version;
export const DEFAULT_SPRINGDOC_VERSION = NATIVE_KIT_BASELINES.springBoot.springdoc;

export interface SpringBootVariables {
  project_name: string;
  artifact_id?: string;
  group_id?: string;
  package_name?: string;
  author?: string;
  description?: string;
  java_version?: string;
  spring_boot_version?: string;
  springdoc_version?: string;
  app_version?: string;
  port?: string;
  skipGit?: boolean;
  skipInstall?: boolean;
}

function sanitizePackageSegment(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.{2,}/g, '.');

  const segments = cleaned
    .split('.')
    .map((segment) => segment.replace(/^[^a-z]+/, '').replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);

  return segments.join('.');
}

function sanitizeHumanText(value: string, fallback: string): string {
  const cleaned = value.replace(/[\r\n\t]+/g, ' ').trim();
  return cleaned || fallback;
}

function sanitizeArtifactId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function derivePackageName(groupId: string, artifactId: string): string {
  const groupPart = sanitizePackageSegment(groupId) || 'com.workspai.apps';
  const artifactPart = sanitizePackageSegment(artifactId) || 'service';
  return `${groupPart}.${artifactPart}`;
}

function javaPackagePath(packageName: string): string {
  return packageName.replace(/\./g, '/');
}

function contextJson(): string {
  return JSON.stringify({ engine: 'npm', runtime: 'java' }, null, 2);
}

function projectJson(v: Required<SpringBootVariables>, rapidkitVersion: string): string {
  return JSON.stringify(
    {
      kit_name: 'springboot.standard',
      runtime: 'java',
      module_support: false,
      project_name: v.project_name,
      artifact_id: v.artifact_id,
      group_id: v.group_id,
      package_name: v.package_name,
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

function pomXml(v: Required<SpringBootVariables>): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>${v.spring_boot_version}</version>
    <relativePath/>
  </parent>

  <groupId>${v.group_id}</groupId>
  <artifactId>${v.artifact_id}</artifactId>
  <version>${v.app_version}</version>
  <name>${v.project_name}</name>
  <description>${v.description}</description>

  <properties>
    <java.version>${v.java_version}</java.version>
    <springdoc.version>${v.springdoc_version}</springdoc.version>
    <maven.compiler.release>${v.java_version}</maven.compiler.release>
  </properties>

  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-actuator</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-validation</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-configuration-processor</artifactId>
      <optional>true</optional>
    </dependency>
    <dependency>
      <groupId>org.springdoc</groupId>
      <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
      <version>${'${springdoc.version}'}</version>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-test</artifactId>
      <scope>test</scope>
    </dependency>
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
        <configuration>
          <layers>
            <enabled>true</enabled>
          </layers>
        </configuration>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <configuration>
          <release>${'${maven.compiler.release}'}</release>
        </configuration>
      </plugin>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-enforcer-plugin</artifactId>
                <version>3.6.3</version>
                <executions>
                    <execution>
                        <id>enforce-java-and-maven</id>
                        <goals>
                            <goal>enforce</goal>
                        </goals>
                        <configuration>
                            <rules>
                                <requireJavaVersion>
                                    <version>[${v.java_version},)</version>
                                </requireJavaVersion>
                                <requireMavenVersion>
                                    <version>[3.9.0,)</version>
                                </requireMavenVersion>
                            </rules>
                        </configuration>
                    </execution>
                </executions>
            </plugin>
            <plugin>
                <groupId>com.diffplug.spotless</groupId>
                <artifactId>spotless-maven-plugin</artifactId>
                <version>3.9.0</version>
                <configuration>
                    <java>
                        <googleJavaFormat version="1.23.0" />
                        <trimTrailingWhitespace />
                        <endWithNewline />
                    </java>
                </configuration>
            </plugin>
            <plugin>
                <groupId>org.cyclonedx</groupId>
                <artifactId>cyclonedx-maven-plugin</artifactId>
                <version>2.9.3</version>
                <executions>
                    <execution>
                        <phase>verify</phase>
                        <goals>
                            <goal>makeAggregateBom</goal>
                        </goals>
                    </execution>
                </executions>
            </plugin>
            <plugin>
                <groupId>org.owasp</groupId>
                <artifactId>dependency-check-maven</artifactId>
                <version>12.2.2</version>
                <configuration>
                    <format>HTML</format>
                    <failBuildOnCVSS>9</failBuildOnCVSS>
                </configuration>
            </plugin>
    </plugins>
  </build>
</project>
`;
}

function applicationJava(v: Required<SpringBootVariables>, className: string): string {
  return `package ${v.package_name};

import ${v.package_name}.config.ApplicationInfoProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties(ApplicationInfoProperties.class)
public class ${className} {

    public static void main(String[] args) {
        SpringApplication.run(${className}.class, args);
    }
}
`;
}

function applicationInfoPropertiesJava(v: Required<SpringBootVariables>): string {
  return `package ${v.package_name}.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "rapidkit.application")
public record ApplicationInfoProperties(
    String name,
    String description,
    String version,
    String owner
) {}
`;
}

function openApiConfigurationJava(v: Required<SpringBootVariables>): string {
  return `package ${v.package_name}.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfiguration {

    @Bean
    OpenAPI rapidkitOpenApi(ApplicationInfoProperties properties) {
        return new OpenAPI()
            .info(new Info()
                .title(properties.name())
                .description(properties.description())
                .version(properties.version())
                .contact(new Contact().name(properties.owner()))
                .license(new License().name("MIT")));
    }
}
`;
}

function systemInfoResponseJava(v: Required<SpringBootVariables>): string {
  return `package ${v.package_name}.api.http.dto;

import java.time.Instant;
import java.util.List;

public record SystemInfoResponse(
    String name,
    String version,
    String environment,
    String basePath,
    List<String> profiles,
    Instant timestamp
) {}
`;
}

function systemInfoServiceJava(v: Required<SpringBootVariables>): string {
  return `package ${v.package_name}.application;

import ${v.package_name}.api.http.dto.SystemInfoResponse;
import ${v.package_name}.config.ApplicationInfoProperties;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;

@Service
public class SystemInfoService {

    private final ApplicationInfoProperties properties;
    private final Environment environment;

    @Value("\${api.base-path:/api/v1}")
    private String apiBasePath;

    public SystemInfoService(ApplicationInfoProperties properties, Environment environment) {
        this.properties = properties;
        this.environment = environment;
    }

    public SystemInfoResponse snapshot() {
        List<String> activeProfiles = Arrays.stream(environment.getActiveProfiles()).toList();
        String runtimeEnv = activeProfiles.isEmpty() ? "default" : String.join(",", activeProfiles);

        return new SystemInfoResponse(
            properties.name(),
            properties.version(),
            runtimeEnv,
            apiBasePath,
            activeProfiles,
            Instant.now()
        );
    }
}
`;
}

function systemInfoControllerJava(v: Required<SpringBootVariables>): string {
  return `package ${v.package_name}.api.http;

import ${v.package_name}.api.http.dto.SystemInfoResponse;
import ${v.package_name}.application.SystemInfoService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("\${api.base-path:/api/v1}/system")
@Tag(name = "system", description = "Operational system endpoints")
public class SystemInfoController {

    private final SystemInfoService systemInfoService;

    public SystemInfoController(SystemInfoService systemInfoService) {
        this.systemInfoService = systemInfoService;
    }

    @GetMapping("/info")
    @Operation(summary = "Expose service metadata for diagnostics and platform wiring")
    public SystemInfoResponse info() {
        return systemInfoService.snapshot();
    }
}
`;
}

function apiExceptionHandlerJava(v: Required<SpringBootVariables>): string {
  return `package ${v.package_name}.api.http;

import java.time.Instant;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> handleValidation(MethodArgumentNotValidException ex) {
        return ResponseEntity.badRequest().body(Map.of(
            "timestamp", Instant.now().toString(),
            "status", HttpStatus.BAD_REQUEST.value(),
            "error", "validation_failed",
            "message", ex.getBindingResult().getErrorCount() + " validation error(s)"
        ));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleGeneric(Exception ex) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
            "timestamp", Instant.now().toString(),
            "status", HttpStatus.INTERNAL_SERVER_ERROR.value(),
            "error", "internal_error",
            "message", ex.getMessage() == null ? "Unexpected error" : ex.getMessage()
        ));
    }
}
`;
}

function applicationYaml(v: Required<SpringBootVariables>): string {
  return `server:
  port: \${PORT:${v.port}}
  shutdown: graceful

spring:
  application:
    name: ${v.artifact_id}
  threads:
    virtual:
      enabled: true

management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics
  endpoint:
    health:
      probes:
        enabled: true
  info:
    env:
      enabled: true

springdoc:
  api-docs:
    path: /api-docs
  swagger-ui:
    path: /docs

api:
  base-path: \${API_BASE_PATH:/api/v1}

rapidkit:
  application:
    name: ${v.project_name}
    description: ${v.description}
    version: ${v.app_version}
    owner: ${v.author}
`;
}

function applicationTestYaml(): string {
  return `spring:
  main:
    banner-mode: off

management:
  endpoints:
    web:
      exposure:
        include: health,info
`;
}

function envExample(v: Required<SpringBootVariables>): string {
  return `PORT=${v.port}
SPRING_PROFILES_ACTIVE=local
API_BASE_PATH=/api/v1
JAVA_TOOL_OPTIONS=-Xms256m -Xmx512m
`;
}

function dockerfile(v: Required<SpringBootVariables>): string {
  return `FROM maven:${NATIVE_KIT_BASELINES.springBoot.maven}-eclipse-temurin-${v.java_version} AS build
WORKDIR /workspace

COPY pom.xml ./
RUN mvn -B -q -DskipTests dependency:go-offline

COPY src ./src
RUN mvn -B -DskipTests package

FROM eclipse-temurin:${v.java_version}-jre
WORKDIR /app

COPY --from=build /workspace/target/*.jar /app/app.jar
RUN useradd --system --uid 10001 --create-home workspai \
    && chown -R 10001:0 /app

EXPOSE ${v.port}
ENV JAVA_TOOL_OPTIONS=""
USER 10001

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
`;
}

function dockerCompose(v: Required<SpringBootVariables>): string {
  return `services:
  ${v.artifact_id}:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "${v.port}:${v.port}"
    env_file:
      - .env
    environment:
      SPRING_PROFILES_ACTIVE: docker
`;
}

function dockerIgnore(): string {
  return `target
.git
.idea
.vscode
node_modules
coverage
`;
}

function gitignore(): string {
  return `.idea/
.vscode/
target/
.mvn/
*.log
.DS_Store
.env
`;
}

function editorconfig(): string {
  return `root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 4
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
`;
}

function githubWorkflow(v: Required<SpringBootVariables>): string {
  return [
    'name: ci',
    '',
    'on:',
    '  push:',
    '    branches: [main]',
    '  pull_request:',
    '',
    'permissions:',
    '  contents: read',
    '',
    'jobs:',
    '  build-test-e2e:',
    `    runs-on: ${'${{ matrix.os }}'}`,
    '    strategy:',
    '      fail-fast: false',
    '      matrix:',
    '        os: [ubuntu-latest, windows-latest]',
    `        java: ['${v.java_version}', '${NATIVE_KIT_BASELINES.springBoot.compatibilityJava}']`,
    '    steps:',
    `      - uses: actions/checkout@${NATIVE_KIT_BASELINES.actions.checkout}`,
    `      - uses: actions/setup-java@${NATIVE_KIT_BASELINES.actions.setupJava}`,
    '        with:',
    '          distribution: temurin',
    `          java-version: ${'${{ matrix.java }}'}`,
    '          cache: maven',
    '      - name: Generate Maven Wrapper (Unix)',
    "        if: runner.os != 'Windows'",
    '        run: |',
    '          if [ ! -f mvnw ]; then',
    `            mvn -N wrapper:wrapper -Dmaven=${NATIVE_KIT_BASELINES.springBoot.maven}`,
    '            chmod +x mvnw',
    '          fi',
    '      - name: Generate Maven Wrapper (Windows)',
    "        if: runner.os == 'Windows'",
    '        shell: pwsh',
    '        run: |',
    "          if (-not (Test-Path 'mvnw.cmd')) {",
    `            mvn -N wrapper:wrapper -Dmaven=${NATIVE_KIT_BASELINES.springBoot.maven}`,
    '          }',
    '      - name: Verify (Unix)',
    "        if: runner.os != 'Windows'",
    '        run: ./mvnw -B verify',
    '      - name: Verify (Windows)',
    "        if: runner.os == 'Windows'",
    '        run: .\\mvnw.cmd -B verify',
    '      - name: Package (Unix)',
    "        if: runner.os != 'Windows'",
    '        run: ./mvnw -B -DskipTests package',
    '      - name: Package (Windows)',
    "        if: runner.os == 'Windows'",
    '        run: .\\mvnw.cmd -B -DskipTests package',
    '      - name: Security scan (Unix)',
    "        if: runner.os != 'Windows'",
    '        run: ./mvnw -B -DskipTests org.owasp:dependency-check-maven:check -DfailBuildOnCVSS=9',
    '      - name: Security scan (Windows)',
    "        if: runner.os == 'Windows'",
    '        run: .\\mvnw.cmd -B -DskipTests org.owasp:dependency-check-maven:check -DfailBuildOnCVSS=9',
    '      - name: Upload SCA report',
    '        if: always()',
    `        uses: actions/upload-artifact@${NATIVE_KIT_BASELINES.actions.uploadArtifact}`,
    '        with:',
    `          name: dependency-check-report-${'${{ matrix.os }}'}-${'${{ matrix.java }}'}`,
    '          path: target/dependency-check-report.html',
    '          if-no-files-found: ignore',
    '      - name: Upload SBOM',
    '        if: always()',
    `        uses: actions/upload-artifact@${NATIVE_KIT_BASELINES.actions.uploadArtifact}`,
    '        with:',
    `          name: sbom-${'${{ matrix.os }}'}-${'${{ matrix.java }}'}`,
    '          path: target/bom.xml',
    '          if-no-files-found: ignore',
    '',
  ].join('\n');
}

function readmeMd(v: Required<SpringBootVariables>): string {
  return `# ${v.project_name}

Built with Spring Boot and scaffolded by Workspai.

## Stack

- Java ${v.java_version}
- Spring Boot ${v.spring_boot_version}
- Maven
- Spring Actuator
- springdoc OpenAPI

## Endpoints

- GET /actuator/health
- GET /api/v1/system/info
- GET /docs

## Quick Start

\`\`\`bash
mvn spring-boot:run
\`\`\`

Or use the generated launcher:

\`\`\`bash
npx workspai init
npx workspai dev
\`\`\`

## Commands

\`\`\`bash
mvn test
mvn -DskipTests package
docker compose up --build
./scripts/perf-smoke.sh
\`\`\`

## Project Structure

\`\`\`
src/main/java/.../api/http        # Controllers + HTTP DTOs
src/main/java/.../application     # Application services
src/main/java/.../config          # OpenAPI + app properties
src/main/resources                # Spring configuration
\`\`\`

## Notes

- This kit is npm-level and intentionally independent from rapidkit-core modules.
- Use environment variables for deployment concerns; Spring Boot maps them automatically.
- CI runs matrix build/test + dependency scan + SBOM artifact generation by default.
`;
}

function perfSmokeScript(v: Required<SpringBootVariables>): string {
  return `#!/usr/bin/env sh
set -eu

PORT="${v.port}"
LOG_FILE="./.workspai/perf-smoke.log"

mkdir -p ./.workspai

echo "[perf] Building service..."
npx workspai build >/dev/null

echo "[perf] Measuring startup latency and max RSS..."
START_EPOCH=$(date +%s)
/usr/bin/time -f "max_rss_kb=%M" -o "$LOG_FILE" npx workspai start >/tmp/workspai-perf-app.log 2>&1 &
APP_PID=$!

cleanup() {
    kill "$APP_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in $(seq 1 45); do
    if curl -fsS "http://127.0.0.1:${v.port}/actuator/health" >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

READY_EPOCH=$(date +%s)
echo "startup_seconds=$((READY_EPOCH - START_EPOCH))" >> "$LOG_FILE"
cat "$LOG_FILE"
`;
}

function rapidkitScript(v: Required<SpringBootVariables>): string {
  return `#!/usr/bin/env sh
# Workspai Spring Boot project launcher - generated by Workspai CLI

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CMD="\${1:-}"
shift 2>/dev/null || true

maven_cmd() {
    if [ -x "$SCRIPT_DIR/mvnw" ]; then
        echo "$SCRIPT_DIR/mvnw"
        return 0
    fi
    if command -v mvn >/dev/null 2>&1; then
        echo mvn
        return 0
    fi
    return 1
}

jar_path() {
    find "$SCRIPT_DIR/target" -maxdepth 1 -type f -name '*.jar' ! -name '*-sources.jar' ! -name '*-javadoc.jar' | head -n 1
}

case "$CMD" in
    init)
        cd "$SCRIPT_DIR"
        if [ ! -f ".env" ] && [ -f ".env.example" ]; then
            cp .env.example .env && echo "✓ .env created from .env.example"
        fi
        MVN_CMD=$(maven_cmd) || {
            echo "rapidkit: Maven or Maven Wrapper is required" >&2
            exit 1
        }
        exec "$MVN_CMD" -B -q -DskipTests dependency:go-offline
        ;;
    dev)
        cd "$SCRIPT_DIR"
        MVN_CMD=$(maven_cmd) || {
            echo "rapidkit: Maven or Maven Wrapper is required" >&2
            exit 1
        }
        exec "$MVN_CMD" spring-boot:run "$@"
        ;;
    test)
        cd "$SCRIPT_DIR"
        MVN_CMD=$(maven_cmd) || {
            echo "rapidkit: Maven or Maven Wrapper is required" >&2
            exit 1
        }
        exec "$MVN_CMD" test "$@"
        ;;
    build)
        cd "$SCRIPT_DIR"
        MVN_CMD=$(maven_cmd) || {
            echo "rapidkit: Maven or Maven Wrapper is required" >&2
            exit 1
        }
        exec "$MVN_CMD" -DskipTests package "$@"
        ;;
    start)
        cd "$SCRIPT_DIR"
        JAR=$(jar_path)
        if [ -z "$JAR" ]; then
            MVN_CMD=$(maven_cmd) || {
                echo "rapidkit: Maven or Maven Wrapper is required" >&2
                exit 1
            }
            "$MVN_CMD" -DskipTests package || exit $?
            JAR=$(jar_path)
        fi
        exec java $JAVA_OPTS -jar "$JAR" "$@"
        ;;
    help|--help|-h)
        echo "Workspai - Spring Boot project: ${v.project_name}"
        echo ""
        echo "Available: init, dev, test, build, start"
        ;;
    *)
        if [ -n "$CMD" ]; then
            echo "rapidkit: unknown command: $CMD" >&2
        fi
        echo "Available: init, dev, test, build, start" >&2
        exit 1
        ;;
esac
`;
}

function rapidkitCmd(): string {
  return `@echo off
set CMD=%1
if "%CMD%"=="" goto usage
shift

set BUILD_CMD=mvn
if exist mvnw.cmd set BUILD_CMD=mvnw.cmd

if "%CMD%"=="init" (
  if not exist .env if exist .env.example copy .env.example .env >nul
    %BUILD_CMD% -B -q -DskipTests dependency:go-offline
  exit /b %ERRORLEVEL%
)
if "%CMD%"=="dev" (
    %BUILD_CMD% spring-boot:run %*
  exit /b %ERRORLEVEL%
)
if "%CMD%"=="test" (
    %BUILD_CMD% test %*
  exit /b %ERRORLEVEL%
)
if "%CMD%"=="build" (
    %BUILD_CMD% -DskipTests package %*
  exit /b %ERRORLEVEL%
)
if "%CMD%"=="start" (
  for %%f in (target\*.jar) do set APP_JAR=%%f
    if not defined APP_JAR %BUILD_CMD% -DskipTests package
  for %%f in (target\*.jar) do set APP_JAR=%%f
  java %JAVA_OPTS% -jar %APP_JAR% %*
  exit /b %ERRORLEVEL%
)

:usage
echo Available: init, dev, test, build, start
exit /b 1
`;
}

function applicationTestsJava(v: Required<SpringBootVariables>, className: string): string {
  return `package ${v.package_name};

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class ${className}Tests {

    @Test
    void contextLoads() {
    }
}
`;
}

function systemInfoControllerTestJava(v: Required<SpringBootVariables>): string {
  return `package ${v.package_name}.api.http;

import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import ${v.package_name}.api.http.dto.SystemInfoResponse;
import ${v.package_name}.application.SystemInfoService;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(SystemInfoController.class)
@Import(ApiExceptionHandler.class)
class SystemInfoControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private SystemInfoService systemInfoService;

    @Test
    void returnsSystemInfo() throws Exception {
        given(systemInfoService.snapshot()).willReturn(new SystemInfoResponse(
            "${v.project_name}",
            "${v.app_version}",
            "test",
            "/api/v1",
            List.of("test"),
            Instant.parse("2026-01-01T00:00:00Z")
        ));

        mockMvc.perform(get("/api/v1/system/info"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.name").value("${v.project_name}"))
            .andExpect(jsonPath("$.version").value("${v.app_version}"))
            .andExpect(jsonPath("$.environment").value("test"));
    }
}
`;
}

function serviceRuntimeE2ETestJava(v: Required<SpringBootVariables>): string {
  return `package ${v.package_name};

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.ResponseEntity;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ServiceRuntimeE2ETest {

        @Autowired
        private TestRestTemplate restTemplate;

        @Test
        void healthEndpointShouldBeUp() {
                ResponseEntity<Map> response = restTemplate.getForEntity("/actuator/health", Map.class);
                assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
                assertThat(response.getBody()).containsEntry("status", "UP");
        }
}
`;
}

async function ensureMavenWrapper(projectPath: string): Promise<boolean> {
  try {
    await execa(
      'mvn',
      ['-N', 'wrapper:wrapper', `-Dmaven=${NATIVE_KIT_BASELINES.springBoot.maven}`],
      {
        cwd: projectPath,
        timeout: 120_000,
      }
    );

    const mvnw = path.join(projectPath, 'mvnw');
    if (
      await fs
        .stat(mvnw)
        .then(() => true)
        .catch(() => false)
    ) {
      await fs.chmod(mvnw, 0o755);
    }
    return true;
  } catch {
    return false;
  }
}

export async function generateSpringBootKit(
  projectPath: string,
  variables: SpringBootVariables
): Promise<void> {
  const artifactId =
    sanitizeArtifactId(variables.artifact_id || variables.project_name) || 'service';
  const groupId =
    sanitizePackageSegment(variables.group_id || 'com.workspai.apps') || 'com.workspai.apps';
  const packageName =
    sanitizePackageSegment(variables.package_name || derivePackageName(groupId, artifactId)) ||
    'com.workspai.apps.service';

  const v: Required<SpringBootVariables> = {
    project_name: variables.project_name,
    artifact_id: artifactId,
    group_id: groupId,
    package_name: packageName,
    author: sanitizeHumanText(variables.author || '', 'Workspai User'),
    description: sanitizeHumanText(
      variables.description || '',
      `Spring Boot service generated with Workspai - ${variables.project_name}`
    ),
    java_version: variables.java_version || DEFAULT_JAVA_VERSION,
    spring_boot_version: variables.spring_boot_version || DEFAULT_SPRING_BOOT_VERSION,
    springdoc_version: variables.springdoc_version || DEFAULT_SPRINGDOC_VERSION,
    app_version: variables.app_version || '0.1.0',
    port: variables.port || '8080',
    skipGit: variables.skipGit ?? false,
    skipInstall: variables.skipInstall ?? false,
  };

  const rapidkitVersion = getVersion();
  const className = `${toPascalCase(v.project_name)}Application`;
  const packagePath = javaPackagePath(v.package_name);

  // --skip-install is also the deterministic/offline scaffold boundary: do not
  // start runtime probes whose process trees can outlive their parent on Windows.
  if (!v.skipInstall) {
    try {
      await execa('mvn', ['-version'], { timeout: 3000 });
    } catch {
      console.log(
        chalk.yellow(
          '\n⚠  Maven not found in PATH - project will be scaffolded, but init/build commands require Maven 3.9+'
        )
      );
      console.log(chalk.gray('   Install: https://maven.apache.org/install.html\n'));
    }
  }

  const spinner = ora(`Generating Spring Boot project: ${v.project_name}...`).start();

  try {
    const w = (rel: string, content: string) =>
      writeGeneratorFile(path.join(projectPath, rel), content);

    const rapidkitScriptPath = path.join(projectPath, 'rapidkit');
    const rapidkitCmdPath = path.join(projectPath, 'rapidkit.cmd');

    await Promise.all([
      w('pom.xml', pomXml(v)),
      w('.gitignore', gitignore()),
      w('.editorconfig', editorconfig()),
      w('.env.example', envExample(v)),
      w('.dockerignore', dockerIgnore()),
      w('Dockerfile', dockerfile(v)),
      w('docker-compose.yml', dockerCompose(v)),
      w('.github/workflows/ci.yml', githubWorkflow(v)),
      w('.github/dependabot.yml', buildNativeKitDependabotYml('maven')),
      w('README.md', readmeMd(v)),
      w('src/main/resources/application.yml', applicationYaml(v)),
      w('src/test/resources/application.yml', applicationTestYaml()),
      w(`src/main/java/${packagePath}/${className}.java`, applicationJava(v, className)),
      w(
        `src/main/java/${packagePath}/config/ApplicationInfoProperties.java`,
        applicationInfoPropertiesJava(v)
      ),
      w(
        `src/main/java/${packagePath}/config/OpenApiConfiguration.java`,
        openApiConfigurationJava(v)
      ),
      w(
        `src/main/java/${packagePath}/application/SystemInfoService.java`,
        systemInfoServiceJava(v)
      ),
      w(
        `src/main/java/${packagePath}/api/http/dto/SystemInfoResponse.java`,
        systemInfoResponseJava(v)
      ),
      w(
        `src/main/java/${packagePath}/api/http/SystemInfoController.java`,
        systemInfoControllerJava(v)
      ),
      w(
        `src/main/java/${packagePath}/api/http/ApiExceptionHandler.java`,
        apiExceptionHandlerJava(v)
      ),
      w(`src/test/java/${packagePath}/${className}Tests.java`, applicationTestsJava(v, className)),
      w(
        `src/test/java/${packagePath}/api/http/SystemInfoControllerTest.java`,
        systemInfoControllerTestJava(v)
      ),
      w(`src/test/java/${packagePath}/ServiceRuntimeE2ETest.java`, serviceRuntimeE2ETestJava(v)),
      w('scripts/perf-smoke.sh', perfSmokeScript(v)),
      w('.workspai/project.json', projectJson(v, rapidkitVersion)),
      w('.workspai/context.json', contextJson()),
      w('rapidkit', rapidkitScript(v)),
      w('rapidkit.cmd', rapidkitCmd()),
    ]);

    await fs.chmod(rapidkitScriptPath, 0o755);
    await fs.chmod(rapidkitCmdPath, 0o755);
    await fs.chmod(path.join(projectPath, 'scripts', 'perf-smoke.sh'), 0o755);

    if (!v.skipInstall) {
      const wrapperReady = await ensureMavenWrapper(projectPath);
      if (!wrapperReady) {
        console.log(
          chalk.yellow(
            '⚠  Maven Wrapper could not be generated automatically. Run `mvn -N wrapper:wrapper -Dmaven=3.9.9` inside the project.'
          )
        );
      }
    }

    spinner.succeed(chalk.green(`Project created at ${projectPath}`));

    if (v.skipInstall) {
      spinner.info(chalk.gray('Skipped Maven dependency warm-up (--skip-install).'));
    } else {
      try {
        spinner.start('Resolving Maven dependencies...');
        const wrapperPath = path.join(
          projectPath,
          process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw'
        );
        const mavenCommand = await fs
          .stat(wrapperPath)
          .then(() => wrapperPath)
          .catch(() => 'mvn');
        await execa(mavenCommand, ['-B', '-q', '-DskipTests', 'dependency:go-offline'], {
          cwd: projectPath,
          timeout: 180_000,
        });
        spinner.succeed(chalk.gray('✓ maven dependency warm-up completed'));
      } catch {
        spinner.warn(
          chalk.yellow(
            '⚠  Maven dependency warm-up failed - run manually: mvn -B -DskipTests dependency:go-offline'
          )
        );
      }
    }

    if (!v.skipGit) {
      try {
        if (await isInsideExistingGitWorktree(projectPath)) {
          console.log(
            chalk.gray('⚠  git init skipped (target is inside an existing git worktree)')
          );
        } else {
          await execa('git', ['init'], { cwd: projectPath, env: buildCleanGitEnv() });
          await execa('git', ['add', '-A'], { cwd: projectPath, env: buildCleanGitEnv() });
          await execa(
            'git',
            ['commit', '-m', 'chore: initial scaffold (rapidkit springboot.standard)'],
            {
              cwd: projectPath,
              env: buildCleanGitEnv(),
            }
          );
        }
      } catch {
        console.log(
          chalk.yellow('⚠  Git initialization failed - continuing without initial commit')
        );
      }
    }

    console.log(chalk.green('\n✨ Spring Boot project created successfully!\n'));
    console.log(chalk.cyan('📂 Location:'), chalk.white(projectPath));
    console.log(chalk.cyan('\n🚀 Get started:\n'));
    console.log(chalk.white(`   cd ${v.project_name}`));
    console.log(chalk.white('   npx workspai init'));
    console.log(chalk.white('   npx workspai dev\n'));
    console.log(chalk.gray('Endpoints: /actuator/health, /api/v1/system/info, /docs'));
  } catch (error) {
    spinner.fail('Failed to create Spring Boot project');
    try {
      await fs.rm(projectPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures.
    }
    throw error;
  }
}
