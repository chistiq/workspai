import path from 'path';
import { createWriteStream, existsSync, promises as fs } from 'fs';
import * as fsExtra from 'fs-extra';
import { createHash, createHmac, createVerify, randomUUID } from 'crypto';
import http from 'http';
import https from 'https';
import { execa } from 'execa';
import { workspaceMetadataCandidates, workspaceMetadataPath } from './workspace-paths.js';
import { assertWorkspaceArtifactContract } from '../contracts/artifact-contract-registry.js';
import {
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACTS,
} from '../contracts/workspace-intelligence-runtime-registry.js';

export type MirrorCheckStatus = 'passed' | 'failed' | 'skipped';

export interface MirrorLifecycleCheck {
  id: string;
  status: MirrorCheckStatus;
  message: string;
}

export interface MirrorLifecycleResult {
  checks: MirrorLifecycleCheck[];
  details: {
    syncedArtifacts: number;
    verifiedArtifacts: number;
    rotatedFiles: number;
    lockWritten: boolean;
    governanceBundleVerified: boolean;
    transparencyEvidenceWritten: boolean;
    transparencyEvidenceRecords: number;
    evidenceExported: boolean;
    evidenceExportTarget: string | null;
  };
}

interface MirrorArtifact {
  id?: string;
  source?: string;
  url?: string;
  target?: string;
  sha256?: string;
  required?: boolean;
  attestation?: {
    signature: string;
    publicKeyPath: string;
    algorithm?: 'sha256' | 'sha512';
    sigstore?: {
      signaturePath?: string;
      certificatePath?: string;
      bundlePath?: string;
      keyPath?: string;
      identity?: string;
      issuer?: string;
      rekorUrl?: string;
    };
  };
}

interface MirrorConfig {
  enabled?: boolean;
  mode?: 'online' | 'offline-first' | 'offline-only';
  artifacts?: MirrorArtifact[];
  retention?: {
    keepLast?: number;
  };
  prefetch?: {
    retries?: number;
    backoffMs?: number;
    timeoutMs?: number;
  };
  security?: {
    requireAttestation?: boolean;
    requireSigstore?: boolean;
    requireTransparencyLog?: boolean;
    requireSignedGovernance?: boolean;
    governance?: {
      environment?: string;
      policies?: Record<
        string,
        {
          allowedIdentities?: string[];
          allowedIssuers?: string[];
          allowedRekorUrls?: string[];
          requireTransparencyLog?: boolean;
        }
      >;
    };
    governanceBundle?: {
      policyPath: string;
      signaturePath: string;
      publicKeyPath: string;
      algorithm?: 'sha256' | 'sha512';
    };
    evidenceExport?: {
      enabled?: boolean;
      target: 'file' | 'http';
      filePath?: string;
      endpoint?: string;
      authTokenEnv?: string;
      timeoutMs?: number;
      retries?: number;
      backoffMs?: number;
      deadLetterPath?: string;
      signing?: {
        enabled?: boolean;
        hmacKeyEnv: string;
        algorithm?: 'sha256' | 'sha512';
        headerName?: string;
      };
      failOnError?: boolean;
    };
  };
}

interface MirrorLockEntry {
  id: string;
  path: string;
  sha256: string;
  size: number;
  provenance: {
    sourceType: 'path' | 'url';
    source: string;
    host: string | null;
    fetchedAt: string;
    attempts: number;
    trusted: boolean;
  };
  attestation: {
    detached: {
      provided: boolean;
      verified: boolean;
      algorithm: string | null;
      publicKeyPath: string | null;
      publicKeyFingerprint: string | null;
      signature: string | null;
      verifiedAt: string | null;
    };
    sigstore: {
      provided: boolean;
      verified: boolean;
      tlogVerified: boolean;
      identity: string | null;
      issuer: string | null;
      rekorUrl: string | null;
      bundlePath: string | null;
      certificatePath: string | null;
      signaturePath: string | null;
      verifiedAt: string | null;
    };
  };
}

interface GovernancePolicy {
  allowedIdentities?: string[];
  allowedIssuers?: string[];
  allowedRekorUrls?: string[];
  requireTransparencyLog?: boolean;
}

type GovernancePolicies = Record<string, GovernancePolicy>;

async function sha256File(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

async function listFilesRecursively(rootPath: string): Promise<string[]> {
  if (!(await fsExtra.pathExists(rootPath))) return [];
  const files: string[] = [];
  const queue = [rootPath];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isFile()) files.push(entryPath);
      else if (entry.isDirectory()) queue.push(entryPath);
    }
  }
  return files;
}

async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await fsExtra.outputFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

function resolveWorkspacePath(workspacePath: string, relativeOrAbsolute: string): string {
  if (path.isAbsolute(relativeOrAbsolute)) return relativeOrAbsolute;
  return path.join(workspacePath, relativeOrAbsolute);
}

function resolveContainedMirrorTarget(mirrorArtifactsDir: string, target: string): string {
  if (!target.trim() || path.isAbsolute(target) || /^[a-zA-Z]:[\\/]/.test(target)) {
    throw new Error(`Mirror artifact target must be a non-empty relative path: ${target}`);
  }
  const root = path.resolve(mirrorArtifactsDir);
  const resolved = path.resolve(root, target);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Mirror artifact target escapes the managed artifact directory: ${target}`);
  }
  return resolved;
}

async function assertNoSymlinkPath(root: string, targetPath: string): Promise<void> {
  const relative = path.relative(root, targetPath);
  let current = root;
  for (const segment of relative.split(path.sep).slice(0, -1)) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stat) break;
    if (stat.isSymbolicLink()) {
      throw new Error(`Mirror artifact target traverses a symbolic link: ${current}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`Mirror artifact target parent is not a directory: ${current}`);
    }
  }
  const targetStat = await fs.lstat(targetPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (targetStat?.isSymbolicLink() || (targetStat && !targetStat.isFile())) {
    throw new Error(`Mirror artifact target must be absent or a regular file: ${targetPath}`);
  }
}

async function assertManagedMirrorRoot(workspacePath: string, mirrorArtifactsDir: string) {
  const workspaceRoot = path.resolve(workspacePath);
  const relative = path.relative(workspaceRoot, path.resolve(mirrorArtifactsDir));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Managed mirror directory escapes the workspace.');
  }
  let current = workspaceRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Managed mirror path must contain only real directories: ${current}`);
    }
  }
}

function getTargetRelativePath(artifact: MirrorArtifact, fallbackId: string): string {
  if (artifact.target) return artifact.target;
  if (artifact.source) return path.basename(artifact.source);
  if (artifact.url) {
    try {
      const pathname = new URL(artifact.url).pathname;
      const basename = path.basename(pathname);
      if (basename && basename !== '/') return basename;
    } catch {
      // Ignore malformed URL here; it will fail later in download path.
    }
  }
  return `${fallbackId}.artifact`;
}

async function loadTrustedHosts(workspacePath: string): Promise<Set<string>> {
  const trustFilePath = workspaceMetadataCandidates(workspacePath, 'trusted-sources.lock').find(
    (candidate) => existsSync(candidate)
  );
  const trustedHosts = new Set<string>(['localhost', '127.0.0.1']);

  if (!trustFilePath) {
    return trustedHosts;
  }

  try {
    const content = await fs.readFile(trustFilePath, 'utf-8');
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    for (const line of lines) {
      trustedHosts.add(line.toLowerCase());
    }
  } catch {
    // Keep default trusted hosts.
  }

  return trustedHosts;
}

async function downloadFileWithTimeout(
  url: string,
  targetPath: string,
  timeoutMs: number
): Promise<void> {
  await fsExtra.ensureDir(path.dirname(targetPath));

  await new Promise<void>((resolve, reject) => {
    const transport = url.startsWith('https://') ? https : http;
    const request = transport.get(url, (response) => {
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        reject(new Error(`HTTP ${response.statusCode || 'unknown'}`));
        response.resume();
        return;
      }

      const fileStream = createWriteStream(targetPath);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });

      fileStream.on('error', (error) => {
        reject(error);
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Request timeout after ${timeoutMs}ms`));
    });

    request.on('error', (error) => {
      reject(error);
    });
  });
}

async function postJsonWithTimeout(
  endpoint: string,
  payload: unknown,
  timeoutMs: number,
  authToken?: string,
  headers?: Record<string, string>
): Promise<void> {
  const url = new URL(endpoint);
  const body = JSON.stringify(payload);
  const transport = url.protocol === 'https:' ? https : http;

  await new Promise<void>((resolve, reject) => {
    const request = transport.request(
      {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          ...(headers || {}),
        },
      },
      (response) => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode || 'unknown'}`));
          response.resume();
          return;
        }
        response.resume();
        resolve();
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Request timeout after ${timeoutMs}ms`));
    });

    request.on('error', (error) => {
      reject(error);
    });

    request.write(body);
    request.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeEvidenceDeadLetter(
  workspacePath: string,
  deadLetterPath: string | undefined,
  payload: unknown,
  reason: string
): Promise<string> {
  const outputPath = resolveWorkspacePath(
    workspacePath,
    deadLetterPath || '.workspai/reports/evidence-export-dead-letter.ndjson'
  );
  await fsExtra.ensureDir(path.dirname(outputPath));
  await fs.appendFile(
    outputPath,
    `${JSON.stringify({ timestamp: new Date().toISOString(), reason, payload })}\n`,
    'utf-8'
  );
  return outputPath;
}

function buildEvidenceSignatureHeaders(
  payload: unknown,
  signing:
    | {
        enabled?: boolean;
        hmacKeyEnv: string;
        algorithm?: 'sha256' | 'sha512';
        headerName?: string;
      }
    | undefined
): { headers: Record<string, string>; error?: string } {
  if (!signing?.enabled) {
    return { headers: {} };
  }

  const hmacKey = process.env[signing.hmacKeyEnv];
  if (!hmacKey) {
    return {
      headers: {},
      error: `Evidence signing key env is missing: ${signing.hmacKeyEnv}`,
    };
  }

  const algorithm = (signing.algorithm || 'sha256').toLowerCase() as 'sha256' | 'sha512';
  const headerName = signing.headerName || 'x-rapidkit-evidence-signature';
  const signature = createHmac(algorithm, hmacKey).update(JSON.stringify(payload)).digest('hex');

  return {
    headers: {
      [headerName]: signature,
      'x-rapidkit-evidence-signature-alg': algorithm,
    },
  };
}

async function verifyDetachedAttestation(
  workspacePath: string,
  artifactPath: string,
  attestation: NonNullable<MirrorArtifact['attestation']>
): Promise<{
  verified: boolean;
  algorithm: string;
  publicKeyPath: string;
  publicKeyFingerprint: string;
  signature: string;
  message?: string;
}> {
  const algorithm = (attestation.algorithm || 'sha256').toLowerCase();
  const publicKeyAbsolutePath = resolveWorkspacePath(workspacePath, attestation.publicKeyPath);

  if (!(await fsExtra.pathExists(publicKeyAbsolutePath))) {
    return {
      verified: false,
      algorithm,
      publicKeyPath: publicKeyAbsolutePath,
      publicKeyFingerprint: '',
      signature: attestation.signature,
      message: `Public key not found: ${publicKeyAbsolutePath}`,
    };
  }

  try {
    const publicKeyPem = await fs.readFile(publicKeyAbsolutePath, 'utf-8');
    const content = await fs.readFile(artifactPath);

    const verifier = createVerify(algorithm);
    verifier.update(content);
    verifier.end();

    const signatureBuffer = Buffer.from(attestation.signature, 'base64');
    const verified = verifier.verify(publicKeyPem, signatureBuffer);
    const publicKeyFingerprint = createHash('sha256').update(publicKeyPem).digest('hex');

    return {
      verified,
      algorithm,
      publicKeyPath: publicKeyAbsolutePath,
      publicKeyFingerprint,
      signature: attestation.signature,
      message: verified ? 'Attestation verified.' : 'Attestation signature verification failed.',
    };
  } catch (error) {
    return {
      verified: false,
      algorithm,
      publicKeyPath: publicKeyAbsolutePath,
      publicKeyFingerprint: '',
      signature: attestation.signature,
      message: `Attestation verification error: ${(error as Error).message}`,
    };
  }
}

async function verifySigstoreAttestation(
  workspacePath: string,
  artifactPath: string,
  sigstore: NonNullable<NonNullable<MirrorArtifact['attestation']>['sigstore']>,
  options: { requireTransparencyLog: boolean }
): Promise<{
  verified: boolean;
  tlogVerified: boolean;
  message: string;
  identity: string | null;
  issuer: string | null;
  rekorUrl: string | null;
  bundlePath: string | null;
  certificatePath: string | null;
  signaturePath: string | null;
}> {
  const mockMode = process.env.RAPIDKIT_SIGSTORE_MOCK;
  if (mockMode === 'success') {
    return {
      verified: true,
      tlogVerified: options.requireTransparencyLog,
      message: 'Sigstore verification passed (mock).',
      identity: sigstore.identity || null,
      issuer: sigstore.issuer || null,
      rekorUrl: sigstore.rekorUrl || null,
      bundlePath: sigstore.bundlePath || null,
      certificatePath: sigstore.certificatePath || null,
      signaturePath: sigstore.signaturePath || null,
    };
  }
  if (mockMode === 'fail') {
    return {
      verified: false,
      tlogVerified: false,
      message: 'Sigstore verification failed (mock).',
      identity: sigstore.identity || null,
      issuer: sigstore.issuer || null,
      rekorUrl: sigstore.rekorUrl || null,
      bundlePath: sigstore.bundlePath || null,
      certificatePath: sigstore.certificatePath || null,
      signaturePath: sigstore.signaturePath || null,
    };
  }

  const signaturePath = sigstore.signaturePath
    ? resolveWorkspacePath(workspacePath, sigstore.signaturePath)
    : null;
  if (!signaturePath || !(await fsExtra.pathExists(signaturePath))) {
    return {
      verified: false,
      tlogVerified: false,
      message: 'Sigstore signaturePath is missing or not found.',
      identity: sigstore.identity || null,
      issuer: sigstore.issuer || null,
      rekorUrl: sigstore.rekorUrl || null,
      bundlePath: sigstore.bundlePath || null,
      certificatePath: sigstore.certificatePath || null,
      signaturePath,
    };
  }

  const args = ['verify-blob', artifactPath, '--signature', signaturePath];

  const certificatePath = sigstore.certificatePath
    ? resolveWorkspacePath(workspacePath, sigstore.certificatePath)
    : null;
  if (certificatePath) args.push('--certificate', certificatePath);

  const bundlePath = sigstore.bundlePath
    ? resolveWorkspacePath(workspacePath, sigstore.bundlePath)
    : null;
  if (bundlePath) args.push('--bundle', bundlePath);

  const keyPath = sigstore.keyPath ? resolveWorkspacePath(workspacePath, sigstore.keyPath) : null;
  if (keyPath) args.push('--key', keyPath);

  if (sigstore.identity) args.push('--certificate-identity', sigstore.identity);
  if (sigstore.issuer) args.push('--certificate-oidc-issuer', sigstore.issuer);
  if (sigstore.rekorUrl) args.push('--rekor-url', sigstore.rekorUrl);
  if (!options.requireTransparencyLog) args.push('--insecure-ignore-tlog');

  try {
    const result = await execa('cosign', args, { reject: false });
    if (result.exitCode === 0) {
      return {
        verified: true,
        tlogVerified: options.requireTransparencyLog,
        message: 'Sigstore verification passed.',
        identity: sigstore.identity || null,
        issuer: sigstore.issuer || null,
        rekorUrl: sigstore.rekorUrl || null,
        bundlePath,
        certificatePath,
        signaturePath,
      };
    }
    return {
      verified: false,
      tlogVerified: false,
      message: `Sigstore verification failed: ${result.stderr || result.stdout || 'unknown error'}`,
      identity: sigstore.identity || null,
      issuer: sigstore.issuer || null,
      rekorUrl: sigstore.rekorUrl || null,
      bundlePath,
      certificatePath,
      signaturePath,
    };
  } catch (error) {
    return {
      verified: false,
      tlogVerified: false,
      message: `Sigstore verification error: ${(error as Error).message}`,
      identity: sigstore.identity || null,
      issuer: sigstore.issuer || null,
      rekorUrl: sigstore.rekorUrl || null,
      bundlePath,
      certificatePath,
      signaturePath,
    };
  }
}

async function verifyGovernanceBundle(
  workspacePath: string,
  governanceBundle: NonNullable<NonNullable<MirrorConfig['security']>['governanceBundle']>
): Promise<{
  verified: boolean;
  message: string;
  policies: GovernancePolicies | null;
}> {
  const algorithm = governanceBundle.algorithm || 'sha256';
  const policyPath = resolveWorkspacePath(workspacePath, governanceBundle.policyPath);
  const signaturePath = resolveWorkspacePath(workspacePath, governanceBundle.signaturePath);
  const publicKeyPath = resolveWorkspacePath(workspacePath, governanceBundle.publicKeyPath);

  if (!(await fsExtra.pathExists(policyPath))) {
    return {
      verified: false,
      message: `Governance policy bundle not found: ${policyPath}`,
      policies: null,
    };
  }
  if (!(await fsExtra.pathExists(signaturePath))) {
    return {
      verified: false,
      message: `Governance policy signature not found: ${signaturePath}`,
      policies: null,
    };
  }
  if (!(await fsExtra.pathExists(publicKeyPath))) {
    return {
      verified: false,
      message: `Governance policy public key not found: ${publicKeyPath}`,
      policies: null,
    };
  }

  try {
    const policyRaw = await fs.readFile(policyPath, 'utf-8');
    const signatureRaw = (await fs.readFile(signaturePath, 'utf-8')).trim();
    const publicKeyPem = await fs.readFile(publicKeyPath, 'utf-8');

    const verifier = createVerify(algorithm);
    verifier.update(policyRaw);
    verifier.end();
    const verified = verifier.verify(publicKeyPem, Buffer.from(signatureRaw, 'base64'));
    if (!verified) {
      return {
        verified: false,
        message: 'Governance policy bundle signature verification failed.',
        policies: null,
      };
    }

    const parsed = JSON.parse(policyRaw) as { policies?: GovernancePolicies };
    return {
      verified: true,
      message: 'Governance policy bundle verified.',
      policies: parsed.policies || {},
    };
  } catch (error) {
    return {
      verified: false,
      message: `Governance policy bundle verification error: ${(error as Error).message}`,
      policies: null,
    };
  }
}

export async function runMirrorLifecycle(
  workspacePath: string,
  options: { ciMode: boolean; offlineMode: boolean; forceRun?: boolean }
): Promise<MirrorLifecycleResult> {
  const checks: MirrorLifecycleCheck[] = [];
  const details = {
    syncedArtifacts: 0,
    verifiedArtifacts: 0,
    rotatedFiles: 0,
    lockWritten: false,
    governanceBundleVerified: false,
    transparencyEvidenceWritten: false,
    transparencyEvidenceRecords: 0,
    evidenceExported: false,
    evidenceExportTarget: null as string | null,
  };

  const mirrorConfigPath =
    workspaceMetadataCandidates(workspacePath, 'mirror-config.json').find((candidate) =>
      existsSync(candidate)
    ) ?? workspaceMetadataPath(workspacePath, 'mirror-config.json');
  const mirrorLockPath = workspaceMetadataPath(workspacePath, 'mirror.lock');
  const mirrorArtifactsDir = workspaceMetadataPath(workspacePath, 'mirror', 'artifacts');
  const reportsDir = workspaceMetadataPath(workspacePath, 'reports');
  const trustedHosts = await loadTrustedHosts(workspacePath);

  if (!(await fsExtra.pathExists(mirrorConfigPath))) {
    checks.push({
      id: 'mirror.lifecycle',
      status: 'skipped',
      message: 'Mirror lifecycle skipped: .workspai/mirror-config.json not found.',
    });
    return { checks, details };
  }

  let config: MirrorConfig = {};
  try {
    config = JSON.parse(await fs.readFile(mirrorConfigPath, 'utf-8')) as MirrorConfig;
  } catch {
    checks.push({
      id: 'mirror.lifecycle.config',
      status: 'failed',
      message: 'Mirror lifecycle failed: invalid JSON in mirror-config.json.',
    });
    return { checks, details };
  }

  const shouldRun =
    options.forceRun === true ||
    options.ciMode ||
    options.offlineMode ||
    config.mode === 'offline-only';
  if (!shouldRun) {
    checks.push({
      id: 'mirror.lifecycle',
      status: 'skipped',
      message: 'Mirror lifecycle skipped: not in ci/offline mode.',
    });
    return { checks, details };
  }

  await fsExtra.ensureDir(mirrorArtifactsDir);
  try {
    await assertManagedMirrorRoot(workspacePath, mirrorArtifactsDir);
  } catch (error) {
    checks.push({
      id: 'mirror.root.safety',
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
    });
    return { checks, details };
  }

  const prefetchRetries = Math.max(0, config.prefetch?.retries ?? 2);
  const prefetchBackoffMs = Math.max(0, config.prefetch?.backoffMs ?? 250);
  const prefetchTimeoutMs = Math.max(1000, config.prefetch?.timeoutMs ?? 15000);
  const requireAttestation = config.security?.requireAttestation === true;
  const requireSigstore = config.security?.requireSigstore === true;
  const requireTransparencyLog = config.security?.requireTransparencyLog === true;
  const requireSignedGovernance = config.security?.requireSignedGovernance === true;
  const evidenceExportConfig = config.security?.evidenceExport;
  const activeEnvironment = (
    process.env.RAPIDKIT_ENV ||
    config.security?.governance?.environment ||
    'dev'
  ).toLowerCase();
  let governancePolicies: GovernancePolicies = config.security?.governance?.policies || {};

  if (config.security?.governanceBundle) {
    const governanceBundleResult = await verifyGovernanceBundle(
      workspacePath,
      config.security.governanceBundle
    );
    checks.push({
      id: 'governance.bundle.verify',
      status: governanceBundleResult.verified ? 'passed' : 'failed',
      message: governanceBundleResult.message,
    });

    if (governanceBundleResult.verified && governanceBundleResult.policies) {
      governancePolicies = governanceBundleResult.policies;
      details.governanceBundleVerified = true;
    } else if (requireSignedGovernance) {
      return { checks, details };
    }
  }

  const environmentPolicy = governancePolicies[activeEnvironment];
  const effectiveRequireTransparencyLog =
    requireTransparencyLog || environmentPolicy?.requireTransparencyLog === true;

  const transparencyEvidenceRecords: Array<{
    artifactId: string;
    verified: boolean;
    tlogVerified: boolean;
    identity: string | null;
    issuer: string | null;
    rekorUrl: string | null;
    timestamp: string;
    environment: string;
  }> = [];

  const artifacts = Array.isArray(config.artifacts) ? config.artifacts : [];
  const lockEntries: MirrorLockEntry[] = [];

  for (let index = 0; index < artifacts.length; index += 1) {
    const artifact = artifacts[index];
    const artifactId = artifact.id || `artifact-${index + 1}`;
    const sourcePath = artifact.source
      ? resolveWorkspacePath(workspacePath, artifact.source)
      : null;
    const targetRelative = getTargetRelativePath(artifact, artifactId);
    let targetPath: string;
    try {
      targetPath = resolveContainedMirrorTarget(mirrorArtifactsDir, targetRelative);
      await assertNoSymlinkPath(mirrorArtifactsDir, targetPath);
    } catch (error) {
      checks.push({
        id: `mirror.target.${artifactId}`,
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    let mirrored = false;
    let candidatePath = targetPath;
    let ownsCandidate = false;
    const discardCandidate = async (): Promise<void> => {
      if (ownsCandidate) await fs.rm(candidatePath, { force: true }).catch(() => undefined);
    };

    let provenance: MirrorLockEntry['provenance'] = {
      sourceType: 'path',
      source: sourcePath || artifact.url || 'unknown',
      host: null,
      fetchedAt: new Date().toISOString(),
      attempts: 1,
      trusted: true,
    };

    if (sourcePath && (await fsExtra.pathExists(sourcePath))) {
      await fsExtra.ensureDir(path.dirname(targetPath));
      candidatePath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
      ownsCandidate = true;
      await fs.copyFile(sourcePath, candidatePath);
      details.syncedArtifacts += 1;
      mirrored = true;
      provenance = {
        sourceType: 'path',
        source: sourcePath,
        host: null,
        fetchedAt: new Date().toISOString(),
        attempts: 1,
        trusted: true,
      };

      checks.push({
        id: `mirror.sync.${artifactId}`,
        status: 'passed',
        message: `Mirrored artifact ${artifactId} from source path.`,
      });
    } else if (artifact.url) {
      let host = '';
      try {
        host = new URL(artifact.url).hostname.toLowerCase();
      } catch {
        checks.push({
          id: `mirror.prefetch.${artifactId}`,
          status: 'failed',
          message: `Invalid URL for ${artifactId}: ${artifact.url}`,
        });
        continue;
      }

      const trustBypass = process.env.RAPIDKIT_TRUSTED_SOURCES === '1';
      const hostTrusted = trustBypass || trustedHosts.has(host);
      if (!hostTrusted) {
        checks.push({
          id: `mirror.prefetch.trust.${artifactId}`,
          status: 'failed',
          message: `Untrusted mirror host for ${artifactId}: ${host}. Add host to .workspai/trusted-sources.lock or set RAPIDKIT_TRUSTED_SOURCES=1.`,
        });
        continue;
      }

      if (options.offlineMode) {
        if (await fsExtra.pathExists(targetPath)) {
          mirrored = true;
          provenance = {
            sourceType: 'url',
            source: artifact.url,
            host,
            fetchedAt: new Date().toISOString(),
            attempts: 0,
            trusted: true,
          };
          checks.push({
            id: `mirror.prefetch.${artifactId}`,
            status: 'passed',
            message: `Offline mode reused existing mirrored artifact ${artifactId}.`,
          });
        } else {
          checks.push({
            id: `mirror.prefetch.${artifactId}`,
            status: 'failed',
            message: `Offline mode cannot prefetch remote artifact ${artifactId} without an existing mirrored copy.`,
          });
        }
        if (!mirrored) continue;
      }

      if (!mirrored) {
        await fsExtra.ensureDir(path.dirname(targetPath));
        candidatePath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
        ownsCandidate = true;
        let lastError: Error | null = null;
        let attempts = 0;

        for (let attempt = 1; attempt <= prefetchRetries + 1; attempt += 1) {
          attempts = attempt;
          try {
            await fs.rm(candidatePath, { force: true }).catch(() => undefined);
            await downloadFileWithTimeout(artifact.url, candidatePath, prefetchTimeoutMs);
            details.syncedArtifacts += 1;
            mirrored = true;
            provenance = {
              sourceType: 'url',
              source: artifact.url,
              host,
              fetchedAt: new Date().toISOString(),
              attempts,
              trusted: true,
            };
            checks.push({
              id: `mirror.prefetch.${artifactId}`,
              status: 'passed',
              message:
                attempts > 1
                  ? `Prefetched artifact ${artifactId} from ${host} after ${attempts} attempts.`
                  : `Prefetched artifact ${artifactId} from ${host}.`,
            });
            break;
          } catch (error) {
            lastError = error as Error;
            if (attempt <= prefetchRetries) {
              await sleep(prefetchBackoffMs * attempt);
              continue;
            }
          }
        }

        if (!mirrored) {
          await discardCandidate();
          checks.push({
            id: `mirror.prefetch.${artifactId}`,
            status: 'failed',
            message: `Failed to prefetch ${artifactId} after ${prefetchRetries + 1} attempt(s): ${lastError?.message || 'unknown error'}`,
          });
          continue;
        }
      }

      if (!mirrored) {
        checks.push({
          id: `mirror.prefetch.${artifactId}`,
          status: 'failed',
          message: `Failed to prefetch ${artifactId}.`,
        });
        continue;
      }
    }

    if (!mirrored) {
      if (artifact.required || options.offlineMode) {
        checks.push({
          id: `mirror.sync.${artifactId}`,
          status: 'failed',
          message: `Mirror source missing for ${artifactId}${sourcePath ? `: ${sourcePath}` : ''}`,
        });
      } else {
        checks.push({
          id: `mirror.sync.${artifactId}`,
          status: 'skipped',
          message: `Mirror source not found for optional artifact ${artifactId}.`,
        });
      }
      continue;
    }

    const digest = await sha256File(candidatePath);
    if (artifact.sha256 && artifact.sha256.toLowerCase() !== digest.toLowerCase()) {
      checks.push({
        id: `mirror.verify.${artifactId}`,
        status: 'failed',
        message: `Checksum mismatch for ${artifactId}.`,
      });
      await discardCandidate();
      continue;
    }

    details.verifiedArtifacts += 1;
    checks.push({
      id: `mirror.verify.${artifactId}`,
      status: 'passed',
      message: `Checksum verified for ${artifactId}.`,
    });

    const attestationResult = artifact.attestation
      ? await verifyDetachedAttestation(workspacePath, candidatePath, artifact.attestation)
      : null;

    if (artifact.attestation) {
      checks.push({
        id: `mirror.attest.${artifactId}`,
        status: attestationResult?.verified ? 'passed' : 'failed',
        message: attestationResult?.message || 'Attestation verification failed.',
      });
      if (!attestationResult?.verified) {
        await discardCandidate();
        continue;
      }
    } else if (requireAttestation) {
      checks.push({
        id: `mirror.attest.${artifactId}`,
        status: 'failed',
        message: `Attestation is required but missing for ${artifactId}.`,
      });
      await discardCandidate();
      continue;
    } else {
      checks.push({
        id: `mirror.attest.${artifactId}`,
        status: 'skipped',
        message: `No attestation provided for ${artifactId}.`,
      });
    }

    const sigstoreConfig = artifact.attestation?.sigstore;
    const sigstoreResult = sigstoreConfig
      ? await verifySigstoreAttestation(workspacePath, candidatePath, sigstoreConfig, {
          requireTransparencyLog: effectiveRequireTransparencyLog,
        })
      : null;

    if (sigstoreConfig) {
      checks.push({
        id: `mirror.sigstore.${artifactId}`,
        status: sigstoreResult?.verified ? 'passed' : 'failed',
        message: sigstoreResult?.message || 'Sigstore verification failed.',
      });
      transparencyEvidenceRecords.push({
        artifactId,
        verified: !!sigstoreResult?.verified,
        tlogVerified: !!sigstoreResult?.tlogVerified,
        identity: sigstoreResult?.identity || null,
        issuer: sigstoreResult?.issuer || null,
        rekorUrl: sigstoreResult?.rekorUrl || null,
        timestamp: new Date().toISOString(),
        environment: activeEnvironment,
      });
      if (!sigstoreResult?.verified) {
        await discardCandidate();
        continue;
      }
    } else if (requireSigstore) {
      checks.push({
        id: `mirror.sigstore.${artifactId}`,
        status: 'failed',
        message: `Sigstore attestation is required but missing for ${artifactId}.`,
      });
      await discardCandidate();
      continue;
    } else {
      checks.push({
        id: `mirror.sigstore.${artifactId}`,
        status: 'skipped',
        message: `No Sigstore attestation provided for ${artifactId}.`,
      });
    }

    if (sigstoreConfig && sigstoreResult?.verified && environmentPolicy) {
      const allowedIdentities = environmentPolicy.allowedIdentities || [];
      if (allowedIdentities.length > 0) {
        const identityAllowed =
          !!sigstoreResult.identity && allowedIdentities.includes(sigstoreResult.identity);
        checks.push({
          id: `mirror.sigstore.policy.identity.${artifactId}`,
          status: identityAllowed ? 'passed' : 'failed',
          message: identityAllowed
            ? `Sigstore identity policy passed for ${artifactId} in ${activeEnvironment}.`
            : `Sigstore identity policy failed for ${artifactId} in ${activeEnvironment}.`,
        });
        if (!identityAllowed) {
          await discardCandidate();
          continue;
        }
      }

      const allowedIssuers = environmentPolicy.allowedIssuers || [];
      if (allowedIssuers.length > 0) {
        const issuerAllowed =
          !!sigstoreResult.issuer && allowedIssuers.includes(sigstoreResult.issuer);
        checks.push({
          id: `mirror.sigstore.policy.issuer.${artifactId}`,
          status: issuerAllowed ? 'passed' : 'failed',
          message: issuerAllowed
            ? `Sigstore issuer policy passed for ${artifactId} in ${activeEnvironment}.`
            : `Sigstore issuer policy failed for ${artifactId} in ${activeEnvironment}.`,
        });
        if (!issuerAllowed) {
          await discardCandidate();
          continue;
        }
      }

      const allowedRekorUrls = environmentPolicy.allowedRekorUrls || [];
      if (allowedRekorUrls.length > 0) {
        const rekorAllowed =
          !!sigstoreResult.rekorUrl && allowedRekorUrls.includes(sigstoreResult.rekorUrl);
        checks.push({
          id: `mirror.sigstore.policy.rekor.${artifactId}`,
          status: rekorAllowed ? 'passed' : 'failed',
          message: rekorAllowed
            ? `Sigstore Rekor policy passed for ${artifactId} in ${activeEnvironment}.`
            : `Sigstore Rekor policy failed for ${artifactId} in ${activeEnvironment}.`,
        });
        if (!rekorAllowed) {
          await discardCandidate();
          continue;
        }
      }
    } else if (environmentPolicy) {
      checks.push({
        id: `mirror.sigstore.policy.${artifactId}`,
        status: 'skipped',
        message: `Sigstore governance policy configured for ${activeEnvironment} but no verified Sigstore attestation for ${artifactId}.`,
      });
    }

    if (ownsCandidate) {
      await assertNoSymlinkPath(mirrorArtifactsDir, targetPath);
      await fs.rename(candidatePath, targetPath);
      ownsCandidate = false;
    }
    const stat = await fs.stat(targetPath);
    lockEntries.push({
      id: artifactId,
      path: path.relative(workspacePath, targetPath),
      sha256: digest,
      size: stat.size,
      provenance,
      attestation: {
        detached: {
          provided: !!artifact.attestation,
          verified: attestationResult?.verified || false,
          algorithm: attestationResult?.algorithm || null,
          publicKeyPath: attestationResult?.publicKeyPath || null,
          publicKeyFingerprint: attestationResult?.publicKeyFingerprint || null,
          signature: attestationResult?.signature || null,
          verifiedAt: attestationResult?.verified ? new Date().toISOString() : null,
        },
        sigstore: {
          provided: !!sigstoreConfig,
          verified: sigstoreResult?.verified || false,
          tlogVerified: sigstoreResult?.tlogVerified || false,
          identity: sigstoreResult?.identity || null,
          issuer: sigstoreResult?.issuer || null,
          rekorUrl: sigstoreResult?.rekorUrl || null,
          bundlePath: sigstoreResult?.bundlePath || null,
          certificatePath: sigstoreResult?.certificatePath || null,
          signaturePath: sigstoreResult?.signaturePath || null,
          verifiedAt: sigstoreResult?.verified ? new Date().toISOString() : null,
        },
      },
    });
  }

  const keepLast = config.retention?.keepLast;
  if (typeof keepLast === 'number' && keepLast > 0) {
    const activeArtifactPaths = new Set(
      lockEntries.map((entry) => path.resolve(workspacePath, entry.path))
    );
    const files = (await listFilesRecursively(mirrorArtifactsDir)).filter(
      (filePath) => !activeArtifactPaths.has(path.resolve(filePath))
    );

    if (files.length > keepLast) {
      const withStat = await Promise.all(
        files.map(async (filePath) => ({ filePath, stat: await fs.stat(filePath) }))
      );
      withStat.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
      const toDelete = withStat.slice(keepLast);

      for (const item of toDelete) {
        await fs.unlink(item.filePath);
        details.rotatedFiles += 1;
      }
    }
  }

  checks.push({
    id: 'mirror.rotate',
    status: 'passed',
    message:
      details.rotatedFiles > 0
        ? `Mirror retention rotation removed ${details.rotatedFiles} file(s).`
        : 'Mirror retention rotation completed with no removals.',
  });

  const lockBody = {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    mode: config.mode || null,
    environment: activeEnvironment,
    artifacts: lockEntries,
  };

  await fs.writeFile(mirrorLockPath, `${JSON.stringify(lockBody, null, 2)}\n`, 'utf-8');
  details.lockWritten = true;

  checks.push({
    id: 'mirror.lock.write',
    status: 'passed',
    message: `Mirror lock updated at ${path.relative(workspacePath, mirrorLockPath)}.`,
  });

  details.transparencyEvidenceRecords = transparencyEvidenceRecords.length;
  if (transparencyEvidenceRecords.length > 0) {
    const evidencePayload = {
      schemaVersion: WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.transparencyEvidence.schemaVersion,
      generatedAt: new Date().toISOString(),
      environment: activeEnvironment,
      records: transparencyEvidenceRecords,
    };
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const evidencePath = path.join(reportsDir, `transparency-evidence-${ts}.json`);
    const latestPath = path.join(reportsDir, 'transparency-evidence.latest.json');
    assertWorkspaceArtifactContract(
      `.workspai/reports/${path.basename(evidencePath)}`,
      evidencePayload
    );
    assertWorkspaceArtifactContract(
      WORKSPACE_SUPPLEMENTAL_ARTIFACTS.transparencyEvidence,
      evidencePayload
    );
    await fsExtra.ensureDir(reportsDir);
    await writeJsonFile(evidencePath, evidencePayload);
    await writeJsonFile(latestPath, evidencePayload);
    details.transparencyEvidenceWritten = true;
    checks.push({
      id: 'sigstore.evidence.write',
      status: 'passed',
      message: `Transparency evidence written to ${path.relative(workspacePath, latestPath)}.`,
    });

    if (evidenceExportConfig?.enabled) {
      const timeoutMs = Math.max(1000, evidenceExportConfig.timeoutMs ?? 10000);
      if (evidenceExportConfig.target === 'file') {
        if (!evidenceExportConfig.filePath) {
          checks.push({
            id: 'sigstore.evidence.export.file',
            status: 'failed',
            message: 'Evidence export target=file requires security.evidenceExport.filePath.',
          });
        } else {
          try {
            const outputPath = resolveWorkspacePath(workspacePath, evidenceExportConfig.filePath);
            await fsExtra.ensureDir(path.dirname(outputPath));
            await fs.appendFile(outputPath, `${JSON.stringify(evidencePayload)}\n`, 'utf-8');
            details.evidenceExported = true;
            details.evidenceExportTarget = outputPath;
            checks.push({
              id: 'sigstore.evidence.export.file',
              status: 'passed',
              message: `Transparency evidence exported to file sink ${outputPath}.`,
            });
          } catch (error) {
            checks.push({
              id: 'sigstore.evidence.export.file',
              status: 'failed',
              message: `Evidence file export failed: ${(error as Error).message}`,
            });
          }
        }
      } else if (evidenceExportConfig.target === 'http') {
        if (!evidenceExportConfig.endpoint) {
          checks.push({
            id: 'sigstore.evidence.export.http',
            status: 'failed',
            message: 'Evidence export target=http requires security.evidenceExport.endpoint.',
          });
        } else {
          const retries = Math.max(0, evidenceExportConfig.retries ?? 0);
          const backoffMs = Math.max(0, evidenceExportConfig.backoffMs ?? 500);
          const signatureHeaders = buildEvidenceSignatureHeaders(
            evidencePayload,
            evidenceExportConfig.signing
          );

          if (signatureHeaders.error) {
            checks.push({
              id: 'sigstore.evidence.export.http',
              status: 'failed',
              message: signatureHeaders.error,
            });
          }

          try {
            const authToken = evidenceExportConfig.authTokenEnv
              ? process.env[evidenceExportConfig.authTokenEnv]
              : undefined;
            let delivered = false;
            let lastError: Error | null = null;

            for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
              try {
                if (signatureHeaders.error) {
                  throw new Error(signatureHeaders.error);
                }

                await postJsonWithTimeout(
                  evidenceExportConfig.endpoint,
                  evidencePayload,
                  timeoutMs,
                  authToken,
                  signatureHeaders.headers
                );
                details.evidenceExported = true;
                details.evidenceExportTarget = evidenceExportConfig.endpoint;
                checks.push({
                  id: 'sigstore.evidence.export.http',
                  status: 'passed',
                  message:
                    attempt > 1
                      ? `Transparency evidence exported to HTTP endpoint ${evidenceExportConfig.endpoint} after ${attempt} attempts.`
                      : `Transparency evidence exported to HTTP endpoint ${evidenceExportConfig.endpoint}.`,
                });
                delivered = true;
                break;
              } catch (error) {
                lastError = error as Error;
                if (attempt <= retries) {
                  await sleep(backoffMs * attempt);
                }
              }
            }

            if (!delivered) {
              throw lastError || new Error('unknown evidence export error');
            }
          } catch (error) {
            const exportErrorMessage = `Evidence HTTP export failed: ${(error as Error).message}`;
            checks.push({
              id: 'sigstore.evidence.export.http',
              status: 'failed',
              message: exportErrorMessage,
            });

            try {
              const deadLetterPath = await writeEvidenceDeadLetter(
                workspacePath,
                evidenceExportConfig.deadLetterPath,
                evidencePayload,
                exportErrorMessage
              );
              checks.push({
                id: 'sigstore.evidence.export.deadletter',
                status: 'passed',
                message: `Evidence export failure persisted to dead-letter sink ${deadLetterPath}.`,
              });
            } catch (deadLetterError) {
              checks.push({
                id: 'sigstore.evidence.export.deadletter',
                status: 'failed',
                message: `Evidence dead-letter write failed: ${(deadLetterError as Error).message}`,
              });
            }
          }
        }
      }

      if (evidenceExportConfig.failOnError) {
        const exportFailure = checks.some(
          (check) =>
            check.status === 'failed' &&
            (check.id === 'sigstore.evidence.export.file' ||
              check.id === 'sigstore.evidence.export.http')
        );
        if (exportFailure) {
          return { checks, details };
        }
      }
    } else {
      checks.push({
        id: 'sigstore.evidence.export',
        status: 'skipped',
        message: 'Central evidence export not configured (security.evidenceExport.enabled=false).',
      });
    }
  } else {
    checks.push({
      id: 'sigstore.evidence.write',
      status: 'skipped',
      message: 'No Sigstore records available for transparency evidence output.',
    });
    checks.push({
      id: 'sigstore.evidence.export',
      status: 'skipped',
      message: 'Central evidence export skipped because no transparency evidence records exist.',
    });
  }

  return { checks, details };
}
