import { describe, expect, it } from 'vitest';

import {
  addedInputLocators,
  providersRequiredForAddedInputs,
} from '../../src/application/providers-required-for-added-inputs.js';
import type { GraphInputChange, GraphProviderRuntime } from '../../src/contracts/index.js';
import {
  createEcmaScriptImportsProvider,
  createGitHeadProvider,
  createLanguageImportsProvider,
  createPackageJsonProvider,
  createRepositoryFilesProvider,
} from '../../src/providers/index.js';

const scan = { algorithm: 'sha256' as const, value: 'a'.repeat(64) };

function change(
  kind: GraphInputChange['kind'],
  locator: string,
  renameCandidate?: GraphInputChange['renameCandidate']
): GraphInputChange {
  return {
    kind,
    locator,
    inputKind: 'source-file',
    scanProfileDigest: scan,
    ...(renameCandidate ? { renameCandidate } : {}),
  };
}

function stub(id: string, detect: GraphProviderRuntime['detect']): GraphProviderRuntime {
  return {
    manifest: { id, version: '1' } as GraphProviderRuntime['manifest'],
    detect,
    collect: async () => {
      throw new Error('collect is not part of added-input detection.');
    },
  };
}

describe('providersRequiredForAddedInputs', () => {
  it('lists only added and rename-next locators', () => {
    expect(
      addedInputLocators([
        change('edited', 'src/health.ts'),
        change('deleted', 'src/gone.ts'),
        change('added', 'src/extra.ts'),
        change('rename-candidate', 'src/new.ts', {
          priorLocator: 'src/old.ts',
          nextLocator: 'src/new.ts',
          confidence: 1,
        }),
      ])
    ).toEqual(['src/extra.ts', 'src/new.ts']);
  });

  it('keeps package-json and git-head reused when the added file is unrelated', async () => {
    const required = await providersRequiredForAddedInputs({
      providers: [
        createPackageJsonProvider(),
        createGitHeadProvider(),
        createRepositoryFilesProvider(),
        createEcmaScriptImportsProvider(),
      ],
      addedLocators: ['src/extra.ts'],
      scopeKind: 'project',
      networkAllowed: false,
    });
    expect(required).toEqual([
      'workspai.graph.provider.ecmascript-imports',
      'workspai.graph.provider.repository-files',
    ]);
  });

  it('recomputes language-imports for an added Python file and keeps package-json reused', async () => {
    const required = await providersRequiredForAddedInputs({
      providers: [
        createPackageJsonProvider(),
        createRepositoryFilesProvider(),
        createLanguageImportsProvider(),
        createEcmaScriptImportsProvider(),
      ],
      addedLocators: ['extra.py'],
      scopeKind: 'project',
      networkAllowed: false,
    });
    expect(required).toEqual([
      'workspai.graph.provider.language-imports',
      'workspai.graph.provider.repository-files',
    ]);
  });

  it('recomputes fail-closed when detection throws or is not a clean miss', async () => {
    const required = await providersRequiredForAddedInputs({
      providers: [
        stub('workspai.graph.provider.throws', () => {
          throw new Error('detect failed');
        }),
        stub('workspai.graph.provider.unknown', () => ({ status: 'unknown' })),
        stub('workspai.graph.provider.skip', () => ({ status: 'not-applicable' })),
      ],
      addedLocators: ['src/extra.ts'],
      scopeKind: 'project',
      networkAllowed: false,
    });
    expect(required).toEqual(['workspai.graph.provider.throws', 'workspai.graph.provider.unknown']);
  });

  it('returns no providers when the tree has no added locators', async () => {
    await expect(
      providersRequiredForAddedInputs({
        providers: [createRepositoryFilesProvider()],
        addedLocators: [],
        scopeKind: 'project',
        networkAllowed: false,
      })
    ).resolves.toEqual([]);
  });
});
