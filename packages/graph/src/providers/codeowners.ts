import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  type GraphDiagnostic,
  type GraphFactBatch,
  type GraphProviderRuntime,
  type GraphWorkspaceFact,
} from '../contracts/index.js';

export const CODEOWNERS_PROVIDER_ID = 'workspai.graph.provider.codeowners';

const CODEOWNERS_LOCATORS = new Set(['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS']);
const MAX_CODEOWNERS_BYTES = 2 * 1024 * 1024;
const MAX_RULES = 10_000;
const MAX_MATCH_OPERATIONS = 2_000_000;
const MAX_FACTS = 250_000;

interface CodeownersRule {
  readonly sourceLine: number;
  readonly pattern: string;
  readonly expression: RegExp;
  readonly owners: readonly string[];
}

function isCodeowners(locator: string): boolean {
  return CODEOWNERS_LOCATORS.has(locator);
}

function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let escaped = false;
  for (const character of line) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (/\s/u.test(character)) {
      if (current) tokens.push(current);
      current = '';
    } else if (character === '#' && current.length === 0) {
      break;
    } else {
      current += character;
    }
  }
  if (escaped) current += '\\';
  if (current) tokens.push(current);
  return tokens;
}

function escapeRegExp(character: string): string {
  return /[\\^$.*+?()[\]{}|]/u.test(character) ? `\\${character}` : character;
}

function compilePattern(pattern: string): RegExp | undefined {
  if (!pattern || pattern.startsWith('!') || pattern.includes('..')) return undefined;
  const anchored = pattern.startsWith('/');
  const directory = pattern.endsWith('/');
  const normalized = pattern.replace(/^\/+|\/+$/gu, '');
  if (!normalized) return /^.*$/u;
  const hasSlash = normalized.includes('/');
  let body = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index] ?? '';
    const next = normalized[index + 1] ?? '';
    if (character === '*' && next === '*') {
      body += '.*';
      index += 1;
    } else if (character === '*') body += '[^/]*';
    else if (character === '?') body += '[^/]';
    else body += escapeRegExp(character);
  }
  if (directory) body += '(?:/.*)?';
  const prefix = anchored || hasSlash ? '^' : '(?:^|.*/)';
  return new RegExp(`${prefix}${body}$`, 'u');
}

function parseRules(source: string): {
  readonly rules: readonly CodeownersRule[];
  readonly invalidLines: readonly number[];
} {
  const rules: CodeownersRule[] = [];
  const invalidLines: number[] = [];
  for (const [lineIndex, line] of source.split(/\r?\n/u).entries()) {
    const tokens = tokenize(line.trimStart());
    if (tokens.length === 0) continue;
    const [pattern, ...owners] = tokens;
    const expression = pattern ? compilePattern(pattern) : undefined;
    const validOwners = owners.filter(
      (owner) =>
        /^@[A-Za-z0-9](?:[A-Za-z0-9-]|\/(?!\/))*$/u.test(owner) || /^[^@\s]+@[^@\s]+$/u.test(owner)
    );
    if (
      !pattern ||
      !expression ||
      validOwners.length === 0 ||
      validOwners.length !== owners.length
    ) {
      invalidLines.push(lineIndex + 1);
      continue;
    }
    rules.push({
      sourceLine: lineIndex + 1,
      pattern,
      expression,
      owners: [...new Set(validOwners)].sort((left, right) => left.localeCompare(right)),
    });
    if (rules.length > MAX_RULES) throw new Error('CODEOWNERS rule count exceeds the limit.');
  }
  return { rules, invalidLines };
}

function ownershipKind(owner: string): 'owner' | 'team' {
  return owner.startsWith('@') && owner.includes('/') ? 'team' : 'owner';
}

export function createCodeownersProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: CODEOWNERS_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'CODEOWNERS file ownership',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['file', 'owner', 'team'],
      relationKinds: ['owned-by', 'reviewed-by'],
      relationSemantics: ['declarative'] as const,
      factFamilies: ['ownership.codeowners'],
      allowedClaims: ['declared'],
    },
    permissions: {
      filesystem: 'read' as const,
      network: 'deny' as const,
      process: 'deny' as const,
      credentials: 'deny' as const,
    },
    limits: { maxDurationMs: 30_000, maxFacts: MAX_FACTS, maxInputBytes: MAX_CODEOWNERS_BYTES },
    contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
    supportedInputs: ['github-codeowners'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => ({
      contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
      provider: { id: manifest.id, version: manifest.version },
      status: request.availableInputs.some(isCodeowners) ? 'applicable' : 'not-applicable',
      matchedInputs: request.availableInputs.some(isCodeowners) ? ['github-codeowners'] : [],
      missingPermissions: [],
      diagnostics: [],
    }),
    collect: async (request) => {
      const inputs = request.inputs.filter((input) => isCodeowners(input.locator));
      const candidateFiles = request.inputs
        .filter((input) => !isCodeowners(input.locator))
        .sort((left, right) => left.locator.localeCompare(right.locator));
      const facts: GraphWorkspaceFact[] = [];
      const diagnostics: GraphDiagnostic[] = [];
      const unknownZones: GraphFactBatch['unknownZones'][number][] = [];
      const processing: GraphFactBatch['processing'][number][] = [];

      for (const [inputIndex, input] of inputs.entries()) {
        let outcome: GraphFactBatch['processing'][number]['outcome'] = 'processed';
        const inputDiagnostics: GraphDiagnostic[] = [];
        try {
          const bytes = await request.readInput(input, {
            maxBytes: MAX_CODEOWNERS_BYTES,
            signal: request.signal,
          });
          const parsed = parseRules(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
          if (parsed.rules.length * candidateFiles.length > MAX_MATCH_OPERATIONS) {
            throw new Error('CODEOWNERS matching exceeds the admitted operation limit.');
          }
          for (const line of parsed.invalidLines) {
            unknownZones.push({
              code: 'graph.codeowners-rule-invalid',
              scope: `${input.locator}#L${line}`,
              reason: 'The CODEOWNERS rule could not be represented by the portable matcher.',
            });
            outcome = 'unsupported';
          }
          let factIndex = 0;
          for (const candidate of candidateFiles) {
            let selected: CodeownersRule | undefined;
            for (const rule of parsed.rules) {
              if (rule.expression.test(candidate.locator)) selected = rule;
            }
            if (!selected) continue;
            const fileIdentity = await request.resolveIdentity({
              namespace: 'workspai',
              kind: 'file',
              relativeLocator: candidate.locator,
              caseSensitivity: 'sensitive',
              scope: request.scope,
            });
            if (!fileIdentity.accepted)
              throw new Error('Owned file identity could not be resolved.');
            for (const owner of selected.owners) {
              if (facts.length >= MAX_FACTS) throw new Error('CODEOWNERS fact limit exceeded.');
              const kind = ownershipKind(owner);
              const ownerIdentity = await request.resolveIdentity({
                namespace: 'codeowners',
                kind,
                relativeLocator: `${kind}s/${encodeURIComponent(owner)}`,
                caseSensitivity: 'insensitive',
                scope: request.scope,
              });
              if (!ownerIdentity.accepted)
                throw new Error('CODEOWNERS identity could not be resolved.');
              facts.push({
                factId: `fact:codeowners:${String(inputIndex).padStart(8, '0')}:${String(factIndex++).padStart(8, '0')}:${input.digest.value}`,
                factType: 'ownership.codeowners',
                subject: fileIdentity.value.reference,
                predicate: 'owned-by',
                object: ownerIdentity.value.reference,
                scope: request.scope,
                evidence: [
                  {
                    id: `evidence:codeowners:${String(inputIndex).padStart(8, '0')}:line:${selected.sourceLine}`,
                    sourceKind: 'ownership-declaration',
                    relativeLocator: input.locator,
                    digest: input.digest,
                  },
                ],
                provenance: { id: manifest.id, version: manifest.version },
                derivation: 'extracted',
                authority: 'declared',
                confidence: 1,
                freshness: { status: 'current' },
                truthLifecycle: { invalidatedBy: ['input-change', 'deletion', 'provider-change'] },
                observedAt: request.observedAt,
                inputDigest: input.digest,
                unknownZones: [],
                extensions: {
                  'workspai.graph.codeowners.rule': selected.pattern,
                  'workspai.graph.codeowners.line': selected.sourceLine,
                },
              });
            }
          }
        } catch (error) {
          const item: GraphDiagnostic = {
            code: 'graph.codeowners-document-invalid',
            severity: 'warning',
            path: input.locator,
            message: error instanceof Error ? error.message : 'CODEOWNERS could not be analyzed.',
          };
          diagnostics.push(item);
          inputDiagnostics.push(item);
          unknownZones.push({
            code: 'graph.codeowners-ownership-unknown',
            scope: input.locator,
            reason: 'Repository ownership could not be extracted within the admitted boundary.',
          });
          outcome = 'failed';
        }
        processing.push({
          input: { locator: input.locator, digest: input.digest },
          provider: { id: manifest.id, version: manifest.version },
          stage: { id: 'codeowners-matching', version: manifest.version },
          outcome,
          ...(outcome === 'processed' ? { outputDigest: input.digest } : {}),
          diagnostics: inputDiagnostics,
        });
      }

      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:codeowners:${inputs.length}`,
        scope: request.scope,
        inputs: inputs.map((input) => ({ locator: input.locator, digest: input.digest })),
        facts,
        diagnostics,
        coverage: [
          {
            dimension: 'codeowners-files',
            observed: processing.filter((entry) => entry.outcome === 'processed').length,
            expected: inputs.length,
          },
        ],
        unknownZones,
        unsupportedZones: [],
        redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
        status: processing.some((entry) => entry.outcome !== 'processed') ? 'partial' : 'complete',
        processing,
      } satisfies GraphFactBatch;
    },
  };
}
