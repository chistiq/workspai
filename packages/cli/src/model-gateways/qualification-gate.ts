export const MODEL_GATEWAY_REGISTRY_FAILURE_PATTERN =
  /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|401 Unauthorized|403 Forbidden|404 Not Found|EAI_AGAIN|npm ERR!|npm error|Could not find a version|Failed to establish|No matching distribution|HTTPError|read ECONNRESET|registry\.npmjs|pypi\.org|network is unreachable|getaddrinfo|Could not fetch URL|Max retries exceeded|NewConnectionError/i;

const PACKAGE_INSTALL_COMMAND_PATTERN =
  /\b(?:npm|npx|pnpm|yarn|pip3?|uv|poetry)\b|\bpython(?:3)?\s+-m\s+pip\b/i;

export type ModelGatewayLifecycleFailureClass = 'registry' | 'product';

export class ModelGatewayQualificationError extends Error {
  readonly classification: ModelGatewayLifecycleFailureClass;
  readonly stage: string;

  constructor(stage: string, classification: ModelGatewayLifecycleFailureClass, detail: string) {
    const prefix =
      classification === 'registry'
        ? `QUALIFICATION_INFRA: ${stage} could not install or resolve package-registry dependencies.`
        : `QUALIFICATION_PRODUCT: ${stage} failed.`;
    super(`${prefix} This is not a green qualification result. ${detail}`.trim());
    this.name = 'ModelGatewayQualificationError';
    this.classification = classification;
    this.stage = stage;
  }
}

export function classifyGatewayLifecycleFailure(
  text: string
): ModelGatewayLifecycleFailureClass | null {
  if (!text.trim()) return null;
  return MODEL_GATEWAY_REGISTRY_FAILURE_PATTERN.test(text) ? 'registry' : 'product';
}

export function classifyGatewayLifecycleReport(
  report: unknown,
  stage: string
): ModelGatewayLifecycleFailureClass | null {
  const blob = typeof report === 'string' ? report : JSON.stringify(report ?? '');
  if (MODEL_GATEWAY_REGISTRY_FAILURE_PATTERN.test(blob)) {
    return 'registry';
  }
  const record = asRecord(report);
  if (!record) {
    return classifyGatewayLifecycleFailure(blob);
  }
  const projects = failedProjects(record);
  if (projects.length === 0) {
    return classifyGatewayLifecycleFailure(blob);
  }
  const installStage = stage === 'init';
  for (const project of projects) {
    const diagnostic = collectProjectDiagnostics(project);
    const installCommand = PACKAGE_INSTALL_COMMAND_PATTERN.test(diagnostic.command);
    const unknownOrMissing =
      diagnostic.categories.length === 0 || diagnostic.categories.includes('unknown');
    const dependency = diagnostic.categories.includes('dependency');
    if ((installStage || installCommand) && (unknownOrMissing || dependency)) {
      return 'registry';
    }
  }
  return classifyGatewayLifecycleFailure(blob) ?? 'product';
}

export function assertGatewayQualificationStage(input: {
  stage: string;
  failed: number;
  detail?: string;
  report?: unknown;
}): void {
  if (input.failed === 0) return;
  const classification =
    input.report !== undefined
      ? (classifyGatewayLifecycleReport(input.report, input.stage) ?? 'product')
      : (classifyGatewayLifecycleFailure(input.detail ?? '') ?? 'product');
  const detail = (
    input.detail ?? (input.report !== undefined ? JSON.stringify(input.report) : '')
  ).slice(0, 2000);
  throw new ModelGatewayQualificationError(input.stage, classification, detail);
}

export async function runGatewayInitWithRegistryRetry<T extends { summary: { failed: number } }>(
  run: () => Promise<T>,
  options?: { attempts?: number; delayMs?: number }
): Promise<T> {
  const attempts = Math.max(1, options?.attempts ?? 2);
  const delayMs = Math.max(0, options?.delayMs ?? 1_000);
  let last: T | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await run();
    if (last.summary.failed === 0) return last;
    if (classifyGatewayLifecycleReport(last, 'init') !== 'registry' || attempt === attempts) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return last as T;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function failedProjects(report: Record<string, unknown>): Record<string, unknown>[] {
  const projects = Array.isArray(report.projects) ? report.projects : [];
  const records = projects
    .map((project) => asRecord(project))
    .filter((project): project is Record<string, unknown> => project !== null);
  const failed = records.filter((project) => project.status === 'failed');
  return failed.length > 0 ? failed : records;
}

function collectProjectDiagnostics(project: Record<string, unknown>): {
  categories: string[];
  command: string;
} {
  const diagnostic = asRecord(project.failureDiagnostic);
  const executions = Array.isArray(project.runtimeExecutions)
    ? project.runtimeExecutions
        .map((execution) => asRecord(execution))
        .filter((execution): execution is Record<string, unknown> => execution !== null)
    : [];
  const categories = uniqueStrings([
    project.errorCategory,
    diagnostic?.category,
    ...executions.map((execution) => execution.errorCategory),
    ...executions.map((execution) => asRecord(execution.failureDiagnostic)?.category),
  ]);
  const command = [
    project.executionCommand,
    diagnostic?.command,
    ...executions.map((execution) => execution.command),
    ...executions.map((execution) => asRecord(execution.failureDiagnostic)?.command),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n');
  return { categories, command };
}

function uniqueStrings(values: unknown[]): string[] {
  return [
    ...new Set(
      values.filter(
        (value): value is string => typeof value === 'string' && value.trim().length > 0
      )
    ),
  ];
}
