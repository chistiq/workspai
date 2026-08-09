import { buildDoctorCapabilitiesReport, runDoctorValidationCorpus } from '../src/doctor/index.js';
import { DOCTOR_DEPENDENCY_AUDIT_RUNTIMES } from '../src/utils/doctor-dependency-audit.js';
import { DOCTOR_SURFACE_RUNTIME_FAMILIES } from '../src/utils/doctor-surface-probes.js';

const capabilities = buildDoctorCapabilitiesReport();
const validation = runDoctorValidationCorpus();
const failures: string[] = [];

if (capabilities.summary.adapterCount < 17) {
  failures.push(`expected at least 17 adapters, found ${capabilities.summary.adapterCount}`);
}
if (capabilities.summary.fallbackRuntimes !== 1) {
  failures.push('the capability registry must expose exactly one fail-closed fallback adapter');
}
if (capabilities.policy.unknownIsHealthy || capabilities.policy.unsupportedIsHealthy) {
  failures.push('unknown or unsupported evidence must never be classified as healthy');
}
if (!capabilities.policy.repairRequiresTypedOperation) {
  failures.push('repair must require a typed operation or structured invocation');
}
if (validation.summary.failedCases > 0) {
  failures.push(`${validation.summary.failedCases} disease-corpus case(s) failed`);
}
for (const [metric, value] of Object.entries({
  precision: validation.summary.precision,
  recall: validation.summary.recall,
  domainCoverage: validation.summary.domainCoverage,
  runtimeAdapterCoverage: validation.summary.runtimeAdapterCoverage,
})) {
  if (value !== 1) failures.push(`${metric} must equal 1 for the versioned synthetic corpus`);
}
if (validation.summary.declaredPlatforms !== 3) {
  failures.push('every built-in adapter must declare Linux, macOS, and Windows support boundaries');
}

const registeredRuntimes = capabilities.adapters
  .flatMap((adapter) => adapter.runtimeFamilies)
  .sort();
const surfaceRuntimes = [...DOCTOR_SURFACE_RUNTIME_FAMILIES].sort();
const auditRuntimes = [...DOCTOR_DEPENDENCY_AUDIT_RUNTIMES].sort();
if (JSON.stringify(surfaceRuntimes) !== JSON.stringify(registeredRuntimes)) {
  failures.push(
    `surface-probe runtime coverage drifted from the adapter registry (${surfaceRuntimes.join(', ')} vs ${registeredRuntimes.join(', ')})`
  );
}
if (JSON.stringify(auditRuntimes) !== JSON.stringify(registeredRuntimes)) {
  failures.push(
    `dependency-audit runtime coverage drifted from the adapter registry (${auditRuntimes.join(', ')} vs ${registeredRuntimes.join(', ')})`
  );
}

if (failures.length > 0) {
  console.error('Doctor capability gate failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Doctor capability gate passed: ${capabilities.summary.adapterCount} adapters, ` +
      `${validation.summary.totalCases} disease/runtime cases, six domains, three platforms declared.`
  );
}
