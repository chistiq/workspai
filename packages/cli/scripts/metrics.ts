#!/usr/bin/env node
/**
 * Workspai Metrics Tracker
 *
 * Tracks and reports key performance metrics for the project.
 */

import { execFileSync, execSync } from 'child_process';
import { existsSync, statSync, readFileSync } from 'fs';
import { join } from 'path';

interface Metrics {
  bundle_size_kb: number;
  test_coverage: number;
  install_success_rate: number;
  avg_create_time_ms: number;
  total_tests: number;
  passing_tests: number;
  failing_tests: number;
  eslint_warnings: number;
  eslint_errors: number;
  dependencies_count: number;
  security_vulnerabilities: number;
}

interface VitestJsonReport {
  success: boolean;
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
}

const BUNDLE_SIZE_LIMIT_KB = Number(process.env.RAPIDKIT_BUNDLE_SIZE_LIMIT_KB ?? '3000');
const TEST_COVERAGE_TARGET = Number(process.env.WORKSPAI_TEST_COVERAGE_TARGET ?? '80');

class MetricsCollector {
  private rootDir: string;

  constructor(rootDir: string = process.cwd()) {
    this.rootDir = rootDir;
  }

  private runNpm(args: string[]): string {
    const npmCli = process.env.npm_execpath;
    if (!npmCli) {
      throw new Error('npm_execpath is unavailable; run metrics through the npm script.');
    }
    return execFileSync(process.execPath, [npmCli, ...args], {
      encoding: 'utf-8',
      cwd: this.rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      // The enterprise suite legitimately emits more than Node's 1 MiB
      // execFileSync default. Without an explicit budget a fully passing run
      // is reported as an invalid test result once coverage grows.
      maxBuffer: 64 * 1024 * 1024,
    });
  }

  /**
   * Get bundle size in KB
   */
  getBundleSize(): number {
    const distDir = join(this.rootDir, 'dist');
    if (!existsSync(distDir)) {
      return 0;
    }

    try {
      const result = execSync(`du -sk ${distDir}`, { encoding: 'utf-8' });
      const sizeKb = parseInt(result.split('\t')[0], 10);
      return sizeKb;
    } catch {
      return 0;
    }
  }

  /**
   * Get test coverage percentage
   */
  getTestCoverage(): number {
    // Try coverage-summary.json first (istanbul/nyc format)
    let coverageFile = join(this.rootDir, 'coverage', 'coverage-summary.json');

    if (!existsSync(coverageFile)) {
      // Fall back to coverage-final.json (v8 format)
      coverageFile = join(this.rootDir, 'coverage', 'coverage-final.json');
    }

    if (!existsSync(coverageFile)) {
      return 0;
    }

    try {
      const coverage = JSON.parse(readFileSync(coverageFile, 'utf-8'));

      // Handle istanbul/nyc format
      if (coverage.total) {
        const total = coverage.total;
        return Math.round(
          (total.lines.pct + total.statements.pct + total.functions.pct + total.branches.pct) / 4
        );
      }

      // Handle v8 format - calculate average from all files
      const files = Object.keys(coverage);
      if (files.length === 0) return 0;

      let totalStatements = 0;
      let coveredStatements = 0;
      let totalBranches = 0;
      let coveredBranches = 0;
      let totalFunctions = 0;
      let coveredFunctions = 0;
      let totalLines = 0;
      let coveredLines = 0;

      files.forEach((file) => {
        const data = coverage[file];

        // Statements
        if (data.statementMap) {
          const stmts = Object.keys(data.statementMap).length;
          totalStatements += stmts;
          coveredStatements += Object.values(data.s as Record<string, number>).filter(
            (x) => x > 0
          ).length;
        }

        // Branches
        if (data.branchMap) {
          const branches = Object.values(data.branchMap as Record<string, any>).reduce(
            (sum, b) => sum + b.locations.length,
            0
          );
          totalBranches += branches;
          coveredBranches += Object.values(data.b as Record<string, number[]>)
            .flat()
            .filter((x) => x > 0).length;
        }

        // Functions
        if (data.fnMap) {
          const fns = Object.keys(data.fnMap).length;
          totalFunctions += fns;
          coveredFunctions += Object.values(data.f as Record<string, number>).filter(
            (x) => x > 0
          ).length;
        }
      });

      const stmtPct = totalStatements > 0 ? (coveredStatements / totalStatements) * 100 : 0;
      const branchPct = totalBranches > 0 ? (coveredBranches / totalBranches) * 100 : 0;
      const funcPct = totalFunctions > 0 ? (coveredFunctions / totalFunctions) * 100 : 0;

      return Math.round((stmtPct + branchPct + funcPct) / 3);
    } catch {
      return 0;
    }
  }

  /**
   * Get test statistics
   */
  getTestStats(): { total: number; passing: number; failing: number } {
    try {
      // `check` runs test:coverage immediately before metrics. Consume that
      // machine-readable result instead of running the full enterprise suite
      // for a second time and scraping its potentially huge console output.
      const reportPath = join(this.rootDir, 'test-results', 'vitest.json');
      if (existsSync(reportPath)) {
        const report = JSON.parse(readFileSync(reportPath, 'utf-8')) as VitestJsonReport;
        const values = [report.numTotalTests, report.numPassedTests, report.numFailedTests];
        if (
          typeof report.success !== 'boolean' ||
          values.some((value) => !Number.isInteger(value) || value < 0) ||
          report.numPassedTests + report.numFailedTests > report.numTotalTests
        ) {
          throw new Error('Vitest JSON report is invalid.');
        }
        if (!report.success || report.numFailedTests > 0) {
          throw new Error(`Vitest reported ${report.numFailedTests} failed test(s).`);
        }
        return {
          total: report.numPassedTests + report.numFailedTests,
          passing: report.numPassedTests,
          failing: report.numFailedTests,
        };
      }

      // Keep standalone `npm run metrics` useful when no preceding coverage
      // report exists. The larger buffer protects this compatibility fallback.
      const result = this.runNpm(['test']);

      // Parse vitest output
      const summary = result.match(/Tests\s+(?:(\d+) failed\s*\|\s*)?(\d+) passed/);

      if (!summary) throw new Error('Vitest test summary was not found.');
      const failing = summary[1] ? parseInt(summary[1], 10) : 0;
      const passing = parseInt(summary[2], 10);

      return {
        total: passing + failing,
        passing,
        failing,
      };
    } catch (error) {
      throw new Error('Could not collect a valid test result.', { cause: error });
    }
  }

  /**
   * Get ESLint statistics
   */
  getESLintStats(): { warnings: number; errors: number } {
    try {
      const result = this.runNpm(['run', 'lint']);

      const warningMatch = result.match(/(\d+) warnings?/);
      const errorMatch = result.match(/(\d+) errors?/);

      return {
        warnings: warningMatch ? parseInt(warningMatch[1], 10) : 0,
        errors: errorMatch ? parseInt(errorMatch[1], 10) : 0,
      };
    } catch (error) {
      throw new Error('Could not collect a valid ESLint result.', { cause: error });
    }
  }

  /**
   * Get dependency count
   */
  getDependencyCount(): number {
    const packageJsonPath = join(this.rootDir, 'package.json');
    if (!existsSync(packageJsonPath)) {
      return 0;
    }

    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const deps = Object.keys(packageJson.dependencies || {}).length;
    const devDeps = Object.keys(packageJson.devDependencies || {}).length;

    return deps + devDeps;
  }

  /**
   * Get security vulnerabilities count
   */
  getSecurityVulnerabilities(): number {
    try {
      const result = this.runNpm(['audit', '--json']);
      const audit = JSON.parse(result);

      return (
        (audit.metadata?.vulnerabilities?.moderate || 0) +
        (audit.metadata?.vulnerabilities?.high || 0) +
        (audit.metadata?.vulnerabilities?.critical || 0)
      );
    } catch (error) {
      const stdout = (error as { stdout?: unknown }).stdout;
      if (typeof stdout === 'string' && stdout.trim().startsWith('{')) {
        const audit = JSON.parse(stdout);
        return (
          (audit.metadata?.vulnerabilities?.moderate || 0) +
          (audit.metadata?.vulnerabilities?.high || 0) +
          (audit.metadata?.vulnerabilities?.critical || 0)
        );
      }
      throw new Error('Could not collect a valid npm audit result.', { cause: error });
    }
  }

  /**
   * Collect all metrics
   */
  async collect(): Promise<Metrics> {
    console.log('📊 Collecting metrics...\n');

    const bundleSize = this.getBundleSize();
    console.log(`📦 Bundle size: ${bundleSize} KB`);

    const coverage = this.getTestCoverage();
    console.log(`🎯 Test coverage: ${coverage}%`);

    const testStats = this.getTestStats();
    console.log(`🧪 Tests: ${testStats.passing}/${testStats.total} passing`);

    const lintStats = this.getESLintStats();
    console.log(`🧹 ESLint: ${lintStats.errors} errors, ${lintStats.warnings} warnings`);

    const depCount = this.getDependencyCount();
    console.log(`📚 Dependencies: ${depCount}`);

    const vulns = this.getSecurityVulnerabilities();
    console.log(`🔒 Security vulnerabilities: ${vulns}`);

    return {
      bundle_size_kb: bundleSize,
      test_coverage: coverage,
      install_success_rate: 0, // Requires telemetry data
      avg_create_time_ms: 0, // Requires benchmark data
      total_tests: testStats.total,
      passing_tests: testStats.passing,
      failing_tests: testStats.failing,
      eslint_warnings: lintStats.warnings,
      eslint_errors: lintStats.errors,
      dependencies_count: depCount,
      security_vulnerabilities: vulns,
    };
  }

  /**
   * Check if metrics meet targets
   */
  validateMetrics(metrics: Metrics): boolean {
    const targets = {
      bundle_size_kb: BUNDLE_SIZE_LIMIT_KB,
      test_coverage: TEST_COVERAGE_TARGET,
      eslint_errors: 0,
      security_vulnerabilities: 0,
    };

    let passed = true;

    console.log('\n🎯 Metrics Validation:\n');

    if (metrics.bundle_size_kb > targets.bundle_size_kb) {
      console.log(
        `❌ Bundle size: ${metrics.bundle_size_kb} KB (target: <${targets.bundle_size_kb} KB)`
      );
      passed = false;
    } else {
      console.log(
        `✅ Bundle size: ${metrics.bundle_size_kb} KB (target: <${targets.bundle_size_kb} KB)`
      );
    }

    if (metrics.test_coverage < targets.test_coverage) {
      console.log(
        `❌ Test coverage: ${metrics.test_coverage}% (target: >=${targets.test_coverage}%)`
      );
      passed = false;
    } else {
      console.log(
        `✅ Test coverage: ${metrics.test_coverage}% (target: >=${targets.test_coverage}%)`
      );
    }

    if (metrics.eslint_errors > targets.eslint_errors) {
      console.log(`❌ ESLint errors: ${metrics.eslint_errors} (target: ${targets.eslint_errors})`);
      passed = false;
    } else {
      console.log(`✅ ESLint errors: ${metrics.eslint_errors} (target: ${targets.eslint_errors})`);
    }

    if (metrics.security_vulnerabilities > targets.security_vulnerabilities) {
      console.log(
        `❌ Security vulnerabilities: ${metrics.security_vulnerabilities} (target: ${targets.security_vulnerabilities})`
      );
      passed = false;
    } else {
      console.log(
        `✅ Security vulnerabilities: ${metrics.security_vulnerabilities} (target: ${targets.security_vulnerabilities})`
      );
    }

    return passed;
  }
}

// Run metrics collection
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  const collector = new MetricsCollector();

  collector
    .collect()
    .then((metrics) => {
      const passed = collector.validateMetrics(metrics);

      console.log('\n' + '='.repeat(50));
      console.log(passed ? '✅ All metrics passed!' : '❌ Some metrics failed!');
      console.log('='.repeat(50) + '\n');

      process.exit(passed ? 0 : 1);
    })
    .catch((error) => {
      console.error(
        `❌ Metrics collection failed: ${error instanceof Error ? error.message : error}`
      );
      process.exit(1);
    });
}

export { MetricsCollector, Metrics };
