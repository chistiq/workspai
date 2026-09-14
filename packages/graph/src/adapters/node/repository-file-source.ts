import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  GraphDiagnostic,
  GraphProviderInput,
  GraphUnknownZone,
  GraphUnsupportedZone,
} from '../../contracts/index.js';
import type {
  GraphInventoryWalkBudgets,
  GraphOmittedSubtree,
} from '../../contracts/inventory-surface.js';
import {
  excludedDirectoryOmissionCode,
  inventoryCodesPreventCompleteness,
} from '../../application/classify-inventory-omissions.js';
import { normalizePortableLocator } from '../../domain/content-state-merkle.js';
import { graphInputMediaType } from '../../domain/input-media-type.js';
import {
  classifyInventoryWalkSkip,
  comparePortableInventoryNames,
  inventoryOmissionAccounting,
  inventorySurfacePolicyMaterial,
  isPolicyExcludedFileName,
  omittedSubtreeComparisonToken,
  omittedSubtreesPreventCompleteness,
} from '../../domain/inventory-surface.js';
import {
  graphUnknownObservation,
  graphUnsupportedObservation,
  structurizeUnknownZone,
} from '../../domain/unknown-cause.js';
import type {
  GraphFileInventoryRequest,
  GraphFileInventoryResult,
  GraphFileSourcePort,
} from '../../ports/index.js';

function portableLocator(root: string, target: string): string | null {
  const relative = path.relative(root, target);
  if (!relative || path.isAbsolute(relative) || relative.split(path.sep).includes('..'))
    return null;
  return normalizePortableLocator(relative.split(path.sep).join('/'));
}

function collidingNfcNames(names: readonly string[]): Set<string> {
  const groups = new Map<string, string[]>();
  for (const name of names) {
    const key = name.normalize('NFC');
    const group = groups.get(key) ?? [];
    group.push(name);
    groups.set(key, group);
  }
  const colliding = new Set<string>();
  for (const group of groups.values()) {
    if (new Set(group).size > 1) {
      for (const name of group) colliding.add(name);
    }
  }
  return colliding;
}

async function resolvePortableFile(root: string, locator: string): Promise<string | null> {
  const portable = normalizePortableLocator(locator);
  const direct = path.resolve(root, ...portable.split('/'));
  try {
    const real = await fs.realpath(direct);
    if (inside(root, real)) return real;
  } catch {
    // Fall through to NFC-equal dirent matching when the logical path is precomposed.
  }
  let current = root;
  for (const segment of portable.split('/')) {
    const wanted = segment.normalize('NFC');
    let match: string | undefined;
    let matches = 0;
    for await (const entry of await fs.opendir(current)) {
      if (entry.isSymbolicLink() || entry.name.normalize('NFC') !== wanted) continue;
      matches += 1;
      match = entry.name;
    }
    if (!match || matches !== 1) return null;
    current = path.join(current, match);
    if (!inside(root, current)) return null;
  }
  try {
    const real = await fs.realpath(current);
    return inside(root, real) ? real : null;
  } catch {
    return null;
  }
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === '' || (!path.isAbsolute(relative) && !relative.split(path.sep).includes('..'))
  );
}

function knownSensitiveFile(name: string): boolean {
  return isPolicyExcludedFileName(name);
}

function structurizeInventoryZones<
  T extends { readonly code: string; readonly scope: string; readonly reason: string },
>(zones: readonly T[]): GraphUnknownZone[] {
  return zones.map((zone) =>
    structurizeUnknownZone(zone, {
      provider: 'graph.repository-inventory',
      stage: 'inventory',
    })
  );
}

function walkBudgets(request: GraphFileInventoryRequest): GraphInventoryWalkBudgets {
  return {
    maxFiles: request.maxFiles,
    maxTotalBytes: request.maxTotalBytes,
    maxFileBytes: request.maxFileBytes,
    maxDepth: request.maxDepth,
    maxDirectoryEntries: request.maxDirectoryEntries,
  };
}

function policyDigest(
  request: GraphFileInventoryRequest,
  evidenceKind: GraphOmittedSubtree['evidenceKind']
): string {
  return `sha256:${createHash('sha256')
    .update(
      inventorySurfacePolicyMaterial({
        excludedDirectories: request.excludedDirectories,
        evidenceKind,
        budgets: walkBudgets(request),
        sensitiveFiles: request.sensitiveFiles,
      })
    )
    .digest('hex')}`;
}

function directoryLocator(root: string, directory: string): string {
  return portableLocator(root, directory) ?? '.';
}

function recordOmittedSubtree(input: {
  readonly locator: string;
  readonly directoryName: string;
  readonly request: GraphFileInventoryRequest;
  readonly evidenceKind?: GraphOmittedSubtree['evidenceKind'];
  readonly code?: string;
  readonly class?: GraphOmittedSubtree['class'];
  readonly reason: string;
  readonly enumeration?: GraphOmittedSubtree['enumeration'];
  readonly enumeratedEntryCount?: number;
}): GraphOmittedSubtree {
  const skip =
    input.evidenceKind && input.code && input.class
      ? {
          class: input.class,
          evidenceKind: input.evidenceKind,
          code: input.code,
        }
      : (classifyInventoryWalkSkip(input.directoryName) ?? {
          class: 'policy-excluded' as const,
          evidenceKind: 'host-inventory-exclusion' as const,
          code: excludedDirectoryOmissionCode(input.directoryName),
        });
  return Object.freeze({
    locator: input.locator,
    class: skip.class,
    count: 'not-enumerated',
    bytes: 'not-measured',
    enumeration: input.enumeration ?? 'not-enumerated',
    enumeratedEntryCount: input.enumeratedEntryCount ?? 0,
    reason: input.reason,
    code: skip.code,
    evidenceKind: skip.evidenceKind,
    policyDigest: policyDigest(input.request, skip.evidenceKind),
  });
}

function finishInventory(input: {
  readonly statusHint?: GraphFileInventoryResult['status'];
  readonly inputs: GraphProviderInput[];
  readonly diagnostics: GraphDiagnostic[];
  readonly omittedFiles: number;
  readonly omittedBytes: number;
  readonly omittedSubtrees: readonly GraphOmittedSubtree[];
  readonly unknownZones: readonly GraphUnknownZone[];
  readonly unsupportedZones: readonly GraphUnsupportedZone[];
}): GraphFileInventoryResult {
  const omissionCodes = [
    ...input.unknownZones.map((zone) => zone.code),
    ...input.unsupportedZones.map((zone) => zone.code),
    ...input.diagnostics.map((diagnostic) => diagnostic.code),
  ];
  const accounting = inventoryOmissionAccounting(input.omittedSubtrees);
  const partial =
    inventoryCodesPreventCompleteness(omissionCodes) ||
    omittedSubtreesPreventCompleteness(input.omittedSubtrees);
  return {
    status: input.statusHint ?? (partial ? 'partial' : 'complete'),
    inputs: input.inputs,
    diagnostics: input.diagnostics,
    omittedFiles: input.omittedFiles,
    omittedBytes: input.omittedBytes,
    ...accounting,
    omittedSubtrees: Object.freeze(
      [...input.omittedSubtrees].sort((left, right) =>
        comparePortableInventoryNames(
          omittedSubtreeComparisonToken(left),
          omittedSubtreeComparisonToken(right)
        )
      )
    ),
    unknownZones: structurizeInventoryZones(input.unknownZones),
    unsupportedZones: structurizeInventoryZones(input.unsupportedZones),
  };
}

async function readStableFile(
  file: string,
  maxBytes: number,
  signal?: AbortSignal
): Promise<{ bytes: Uint8Array; size: number }> {
  if (signal?.aborted) throw new Error('Repository read was cancelled.');
  const handle = await fs.open(file, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maxBytes) {
      throw new Error('Repository input exceeds its admitted read budget.');
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      signal?.aborted ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.byteLength !== before.size
    ) {
      throw new Error('Repository input changed while it was being read.');
    }
    return { bytes: new Uint8Array(bytes), size: before.size };
  } finally {
    await handle.close();
  }
}

export function createNodeGraphFileSource(): GraphFileSourcePort {
  return {
    async inventory(request: GraphFileInventoryRequest): Promise<GraphFileInventoryResult> {
      const diagnostics: GraphDiagnostic[] = [];
      const unknownZones: GraphUnknownZone[] = [];
      const unsupportedZones: GraphUnsupportedZone[] = [];
      const omittedSubtrees: GraphOmittedSubtree[] = [];
      const inputs: GraphProviderInput[] = [];
      let omittedFiles = 0;
      let omittedBytes = 0;
      let totalBytes = 0;
      try {
        const rootStat = await fs.lstat(request.root);
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
          throw new Error('Repository root must be a real directory, not a symbolic link.');
        }
        const root = await fs.realpath(request.root);
        const excluded = new Set(request.excludedDirectories.map((name) => name.normalize('NFC')));
        const onlyLocators =
          request.onlyLocators === undefined
            ? undefined
            : new Set(request.onlyLocators.map((locator) => normalizePortableLocator(locator)));
        const pending = [{ directory: root, depth: 0 }];
        let budgetExhausted = false;
        const omittedSubtreeKeys = new Set<string>();
        const pushSubtree = (subtree: GraphOmittedSubtree): void => {
          const key = omittedSubtreeComparisonToken(subtree);
          if (omittedSubtreeKeys.has(key)) return;
          omittedSubtreeKeys.add(key);
          omittedSubtrees.push(subtree);
        };
        const drainUnvisited = (): void => {
          while (pending.length > 0) {
            const leftover = pending.pop();
            if (!leftover) continue;
            const locator = directoryLocator(root, leftover.directory);
            pushSubtree(
              recordOmittedSubtree({
                locator,
                directoryName: path.posix.basename(locator),
                request,
                evidenceKind: 'resource-budget',
                code: 'graph.repository-budget-truncated',
                class: 'resource-bounded',
                reason:
                  'Repository inventory stopped at the admitted file or byte budget and did not enumerate this subtree.',
                enumeration: 'not-enumerated',
                enumeratedEntryCount: 0,
              })
            );
          }
        };
        while (pending.length > 0 && !budgetExhausted) {
          if (request.signal?.aborted) {
            return finishInventory({
              statusHint: 'cancelled',
              inputs,
              diagnostics,
              omittedFiles,
              omittedBytes,
              omittedSubtrees,
              unknownZones,
              unsupportedZones,
            });
          }
          const current = pending.pop();
          if (!current) continue;
          const entries = [];
          let listingTruncated = false;
          for await (const entry of await fs.opendir(current.directory)) {
            if (entries.length >= request.maxDirectoryEntries) {
              listingTruncated = true;
              break;
            }
            entries.push(entry);
          }
          entries.sort((left, right) => comparePortableInventoryNames(left.name, right.name));
          const colliding = collidingNfcNames(entries.map((entry) => entry.name));
          let processedEntries = 0;
          for (const entry of entries) {
            if (budgetExhausted) break;
            processedEntries += 1;
            const target = path.join(current.directory, entry.name);
            const locator = portableLocator(root, target);
            if (!locator) {
              diagnostics.push({
                code: 'GRAPH_FILE_LOCATOR_REJECTED',
                severity: 'warning',
                path: '/inventory',
                message: 'A repository entry could not be represented as a portable locator.',
              });
              omittedFiles += 1;
              continue;
            }
            if (colliding.has(entry.name)) {
              omittedFiles += 1;
              unknownZones.push({
                code: 'graph.unicode-locator-collision',
                scope: locator,
                reason:
                  'NFC-equivalent filenames in one directory cannot share a portable content locator.',
              });
              continue;
            }
            if (
              current.directory === root &&
              entry.name.normalize('NFC') === '.git' &&
              !entry.isDirectory()
            ) {
              const metadata = await fs.lstat(target);
              omittedFiles += 1;
              omittedBytes += metadata.isFile() ? metadata.size : 0;
              unsupportedZones.push({
                code: 'graph.git-indirection-unsupported',
                scope: 'repository',
                reason:
                  'Git worktree indirection is excluded because its metadata may cross the repository boundary.',
              });
              continue;
            }
            if (entry.isDirectory()) {
              if (excluded.has(entry.name.normalize('NFC'))) {
                const skip = classifyInventoryWalkSkip(entry.name) ?? {
                  class: 'policy-excluded' as const,
                  evidenceKind: 'host-inventory-exclusion' as const,
                  code: excludedDirectoryOmissionCode(entry.name),
                };
                const subtree = recordOmittedSubtree({
                  locator,
                  directoryName: entry.name,
                  request,
                  evidenceKind: skip.evidenceKind,
                  code: skip.code,
                  class: skip.class,
                  reason:
                    skip.evidenceKind === 'universal-vcs-metadata'
                      ? 'VCS metadata is a universal inventory safety boundary and was not enumerated.'
                      : skip.evidenceKind === 'host-inventory-exclusion'
                        ? 'Directory was excluded by host-supplied inventory policy without enumerating its contents.'
                        : 'A high-confidence dependency or environment store was excluded without enumerating its contents.',
                });
                pushSubtree(subtree);
                unsupportedZones.push(
                  graphUnsupportedObservation({
                    code: skip.code,
                    scope: locator,
                    reason: subtree.reason,
                    cause:
                      skip.class === 'vendored' ? 'generated-or-vendor-policy' : 'inventory-policy',
                    stage: 'inventory',
                    provider: 'graph.repository-inventory',
                    evidence: [
                      `evidence-kind:${skip.evidenceKind}`,
                      `policy-digest:${subtree.policyDigest}`,
                    ],
                    classificationOrigin: 'structured-producer',
                  })
                );
              } else if (current.depth >= request.maxDepth) {
                const subtree = recordOmittedSubtree({
                  locator,
                  directoryName: entry.name,
                  request,
                  evidenceKind: 'resource-budget',
                  code: 'graph.repository-depth-truncated',
                  class: 'resource-bounded',
                  reason:
                    'Repository traversal stopped at the admitted depth budget and did not enumerate this subtree.',
                });
                pushSubtree(subtree);
                unknownZones.push(
                  graphUnknownObservation({
                    code: 'graph.repository-depth-truncated',
                    scope: locator,
                    reason: subtree.reason,
                    cause: 'resource-bound',
                    stage: 'inventory',
                    provider: 'graph.repository-inventory',
                    evidence: [`policy-digest:${subtree.policyDigest}`],
                    classificationOrigin: 'structured-producer',
                  })
                );
              } else pending.push({ directory: target, depth: current.depth + 1 });
              continue;
            }
            if (entry.isSymbolicLink() || !entry.isFile()) {
              omittedFiles += 1;
              unsupportedZones.push({
                code: entry.isSymbolicLink()
                  ? 'graph.repository-symlink-unsupported'
                  : 'graph.repository-special-entry-unsupported',
                scope: locator,
                reason: entry.isSymbolicLink()
                  ? 'Symbolic links are not followed across the repository trust boundary.'
                  : 'The repository entry is not a regular file or directory and cannot be inventoried safely.',
              });
              diagnostics.push({
                code: 'GRAPH_FILE_SPECIAL_ENTRY_OMITTED',
                severity: 'info',
                path: locator,
                message: 'Symbolic links and special filesystem entries are not inventoried.',
              });
              continue;
            }
            if (onlyLocators && !onlyLocators.has(locator)) {
              continue;
            }
            const stat = await fs.stat(target);
            if (request.sensitiveFiles === 'omit-known' && knownSensitiveFile(entry.name)) {
              omittedFiles += 1;
              omittedBytes += stat.size;
              unsupportedZones.push(
                graphUnsupportedObservation({
                  code: 'graph.sensitive-input-omitted',
                  scope: locator,
                  reason: 'A known sensitive file was excluded by the default repository policy.',
                  cause: 'inventory-policy',
                  stage: 'inventory',
                  provider: 'graph.repository-inventory',
                  evidence: ['evidence-kind:sensitive-file-policy'],
                  classificationOrigin: 'structured-producer',
                })
              );
              continue;
            }
            if (stat.size > request.maxFileBytes) {
              omittedFiles += 1;
              omittedBytes += stat.size;
              diagnostics.push({
                code: 'GRAPH_FILE_SIZE_LIMIT_OMITTED',
                severity: 'warning',
                path: locator,
                message: 'Repository input exceeds the per-file inventory budget.',
              });
              unknownZones.push({
                code: 'graph.repository-file-size-truncated',
                scope: locator,
                reason:
                  'File content and semantic relationships are unknown beyond the admitted per-file budget.',
              });
              continue;
            }
            if (
              inputs.length >= request.maxFiles ||
              totalBytes + stat.size > request.maxTotalBytes
            ) {
              omittedFiles += 1;
              omittedBytes += stat.size;
              budgetExhausted = true;
              if (!unknownZones.some((zone) => zone.code === 'graph.repository-budget-truncated')) {
                unknownZones.push({
                  code: 'graph.repository-budget-truncated',
                  scope: 'repository',
                  reason:
                    'Repository inventory stopped admitting files at the configured file or byte budget.',
                });
              }
              break;
            }
            const stable = await readStableFile(target, request.maxFileBytes, request.signal);
            const value = createHash('sha256').update(stable.bytes).digest('hex');
            inputs.push({
              locator,
              mediaType: graphInputMediaType(locator),
              byteLength: stable.size,
              digest: { algorithm: 'sha256', value },
            });
            totalBytes += stable.size;
          }
          const currentLocator = directoryLocator(root, current.directory);
          if (listingTruncated || (budgetExhausted && processedEntries < entries.length)) {
            const listingRemainder = listingTruncated && processedEntries >= entries.length;
            pushSubtree(
              recordOmittedSubtree({
                locator: currentLocator,
                directoryName: path.posix.basename(currentLocator),
                request,
                evidenceKind: 'resource-budget',
                code: listingRemainder
                  ? 'graph.repository-directory-truncated'
                  : 'graph.repository-budget-truncated',
                class: 'resource-bounded',
                reason: listingRemainder
                  ? 'Directory listing stopped at the admitted entry budget and did not enumerate remaining dirents.'
                  : 'Directory walk stopped at the admitted file or byte budget and did not enumerate remaining entries.',
                enumeration: 'partially-enumerated',
                enumeratedEntryCount: processedEntries,
              })
            );
            if (listingTruncated) {
              unknownZones.push(
                graphUnknownObservation({
                  code: 'graph.repository-directory-truncated',
                  scope: currentLocator,
                  reason: 'Directory traversal stopped at the admitted entry budget.',
                  cause: 'resource-bound',
                  stage: 'inventory',
                  provider: 'graph.repository-inventory',
                  classificationOrigin: 'structured-producer',
                })
              );
            }
          }
          if (budgetExhausted) drainUnvisited();
        }
        const gitDirectory = path.join(root, '.git');
        if (!onlyLocators || onlyLocators.has('.git/HEAD')) {
          try {
            const gitDirectoryStat = await fs.lstat(gitDirectory);
            if (gitDirectoryStat.isDirectory() && !gitDirectoryStat.isSymbolicLink()) {
              const head = path.join(gitDirectory, 'HEAD');
              const headStat = await fs.lstat(head);
              if (headStat.isSymbolicLink() || !headStat.isFile()) {
                unsupportedZones.push({
                  code: 'graph.git-head-special-entry-unsupported',
                  scope: 'repository',
                  reason: 'Git HEAD must be a real repository-local regular file.',
                });
              } else if (headStat.size > 4_096) {
                omittedFiles += 1;
                omittedBytes += headStat.size;
                unsupportedZones.push({
                  code: 'graph.git-head-size-unsupported',
                  scope: 'repository',
                  reason: 'Git HEAD exceeds the fixed safe metadata size ceiling.',
                });
              } else {
                if (
                  !budgetExhausted &&
                  inputs.length < request.maxFiles &&
                  totalBytes + headStat.size <= request.maxTotalBytes &&
                  headStat.size <= request.maxFileBytes
                ) {
                  const stable = await readStableFile(head, 4_096, request.signal);
                  inputs.push({
                    locator: '.git/HEAD',
                    mediaType: 'text/plain',
                    byteLength: stable.size,
                    digest: {
                      algorithm: 'sha256',
                      value: createHash('sha256').update(stable.bytes).digest('hex'),
                    },
                  });
                  totalBytes += stable.size;
                } else {
                  omittedFiles += 1;
                  omittedBytes += headStat.size;
                  unknownZones.push({
                    code: 'graph.git-head-budget-omitted',
                    scope: 'repository',
                    reason: 'Git HEAD evidence exceeded the admitted repository inventory budget.',
                  });
                }
              }
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
              unsupportedZones.push({
                code: 'graph.git-head-unavailable',
                scope: 'repository',
                reason: 'Git HEAD metadata could not be safely admitted from this repository.',
              });
            }
          }
        }
        inputs.sort((left, right) => left.locator.localeCompare(right.locator));
        return finishInventory({
          inputs,
          diagnostics,
          omittedFiles,
          omittedBytes,
          omittedSubtrees,
          unknownZones,
          unsupportedZones,
        });
      } catch {
        return finishInventory({
          statusHint: request.signal?.aborted ? 'cancelled' : 'failed',
          inputs: [],
          diagnostics: [
            {
              code: request.signal?.aborted
                ? 'GRAPH_FILE_INVENTORY_CANCELLED'
                : 'GRAPH_FILE_INVENTORY_FAILED',
              severity: request.signal?.aborted ? 'info' : 'error',
              path: '/inventory',
              message: request.signal?.aborted
                ? 'Repository inventory was cancelled.'
                : 'Repository inventory failed at the host filesystem boundary.',
            },
          ],
          omittedFiles,
          omittedBytes,
          omittedSubtrees,
          unknownZones,
          unsupportedZones,
        });
      }
    },

    async read(rootInput, input, options) {
      try {
        const locator = normalizePortableLocator(input.locator);
        if (
          !locator ||
          path.posix.isAbsolute(locator) ||
          locator.includes('\\') ||
          locator.split('/').includes('..')
        ) {
          throw new Error('Repository input locator is not portable.');
        }
        const root = await fs.realpath(rootInput);
        const target = await resolvePortableFile(root, locator);
        if (!target) throw new Error('Repository input locator is not portable.');
        const realTarget = await fs.realpath(target);
        if (!inside(root, realTarget)) throw new Error('Repository input escapes its root.');
        const stable = await readStableFile(realTarget, options.maxBytes, options.signal);
        const digest = createHash('sha256').update(stable.bytes).digest('hex');
        if (stable.size !== input.byteLength || digest !== input.digest.value) {
          throw new Error('Repository input no longer matches its admitted content digest.');
        }
        return stable.bytes;
      } catch {
        throw new Error('Repository input could not be read within the admitted boundary.');
      }
    },
  };
}
