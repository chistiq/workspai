# Optimization Guide

Optimization ideas for the Workspai CLI codebase.

> This is a proposal backlog, not a description of shipped APIs, benchmarks, CI,
> or release policy. Validate every proposal against the current package manifest,
> workflows, and [Development Guide](./DEVELOPMENT.md) before implementation.

**Users:** [../README.md](../README.md) · [OPEN_SOURCE_USER_SCENARIOS.md](./OPEN_SOURCE_USER_SCENARIOS.md) · [Documentation index](./README.md)

## 1. Performance Optimizations

### 1.1 Reduce Bundle Size
```json
// package.json - Add these
{
  "sideEffects": false,
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  }
}
```

### 1.2 Better Tree-shaking
- Use dynamic imports for heavy libraries (inquirer, ora)
- Lazy loading for template files

### 1.3 Result Caching
```typescript
// Add caching for version checks and template loading
import { createHash } from 'crypto';
import os from 'os';

const CACHE_DIR = path.join(os.homedir(), '.workspai', 'cache');
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function getCachedOrFetch(key: string, fetcher: () => Promise<any>) {
  const cachePath = path.join(CACHE_DIR, `${createHash('md5').update(key).digest('hex')}.json`);
  
  if (await fsExtra.pathExists(cachePath)) {
    const cached = await fsExtra.readJson(cachePath);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
  }
  
  const data = await fetcher();
  await fsExtra.ensureDir(CACHE_DIR);
  await fsExtra.writeJson(cachePath, { data, timestamp: Date.now() });
  return data;
}
```

## 2. Code Quality Optimizations

### 2.1 Add ESLint
```bash
npm install -D @typescript-eslint/eslint-plugin @typescript-eslint/parser eslint
```

```javascript
// .eslintrc.cjs
module.exports = {
  parser: '@typescript-eslint/parser',
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
};
```

### 2.2 Add Prettier
```json
// .prettierrc
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2
}
```

### 2.3 Pre-commit Hooks
```bash
npm install -D husky lint-staged
```

```json
// package.json
{
  "lint-staged": {
    "*.ts": ["eslint --fix", "prettier --write"]
  }
}
```

## 3. User Experience (UX) Optimizations

### 3.1 Better Progress Indicators
```typescript
// Use multi-step progress bar
import cliProgress from 'cli-progress';

const multibar = new cliProgress.MultiBar({
  clearOnComplete: false,
  hideCursor: true,
  format: '{bar} | {filename} | {value}/{total}',
});

const installBar = multibar.create(100, 0, { filename: 'Installing dependencies' });
const templateBar = multibar.create(100, 0, { filename: 'Copying templates' });
```

### 3.2 Better Error Messages with Suggestions
```typescript
export class PythonNotFoundError extends RapidKitError {
  constructor() {
    super(
      'Python not found',
      'PYTHON_NOT_FOUND',
      'Python 3.11+ is required by the current RapidKit Core bridge but was not found in PATH.\n\n' +
      '💡 Quick fixes:\n' +
      '  • macOS: brew install python@3.11\n' +
      '  • Ubuntu/Debian: sudo apt install python3.11\n' +
      '  • Windows: Download from python.org\n' +
      '  • Or use pyenv: pyenv install 3.11.0'
    );
  }
}
```

### 3.3 Interactive Mode Improvements
```typescript
// Add fuzzy search for template selection
import inquirerPrompt from 'inquirer-autocomplete-prompt';

inquirer.registerPrompt('autocomplete', inquirerPrompt);

await inquirer.prompt([{
  type: 'autocomplete',
  name: 'template',
  message: 'Choose a template:',
  source: async (_, input) => {
    return templates.filter(t => 
      t.name.includes(input?.toLowerCase() || '')
    );
  },
}]);
```

## 4. Security Optimizations

### 4.1 Better Input Validation
```typescript
import validator from 'validator';

export function validateProjectName(name: string): void {
  // Check for path traversal
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new ValidationError('Project name cannot contain path separators');
  }
  
  // Check for dangerous characters
  if (!validator.isAlphanumeric(name.replace(/[-_]/g, ''))) {
    throw new ValidationError('Project name can only contain alphanumeric, dash, and underscore');
  }
  
  // Check length
  if (name.length > 100) {
    throw new ValidationError('Project name is too long (max 100 characters)');
  }
}
```

### 4.2 Dependency Security
```bash
# Add npm audit to CI/CD
npm audit --audit-level=moderate
```

### 4.3 Template Sanitization
```typescript
// Use secure template rendering
import nunjucks from 'nunjucks';

const env = new nunjucks.Environment(null, { 
  autoescape: true,
  throwOnUndefined: true,
});
```

## 5. Architecture Optimizations

### 5.1 Plugin System
```typescript
// src/plugins/plugin-manager.ts
interface Plugin {
  name: string;
  version: string;
  hooks: {
    beforeCreate?: (context: CreateContext) => Promise<void>;
    afterCreate?: (context: CreateContext) => Promise<void>;
    beforeInstall?: (context: InstallContext) => Promise<void>;
    afterInstall?: (context: InstallContext) => Promise<void>;
  };
}

export class PluginManager {
  private plugins: Plugin[] = [];
  
  register(plugin: Plugin) {
    this.plugins.push(plugin);
  }
  
  async runHook(hookName: string, context: any) {
    for (const plugin of this.plugins) {
      const hook = plugin.hooks[hookName];
      if (hook) {
        await hook(context);
      }
    }
  }
}
```

### 5.2 Modular Template System
```typescript
// src/templates/template-registry.ts
export class TemplateRegistry {
  private templates = new Map<string, Template>();
  
  register(id: string, template: Template) {
    this.templates.set(id, template);
  }
  
  get(id: string): Template | undefined {
    return this.templates.get(id);
  }
  
  list(): Template[] {
    return Array.from(this.templates.values());
  }
}
```

### 5.3 State Machine for Installation Flow
```typescript
// src/core/installation-state-machine.ts
enum State {
  IDLE = 'idle',
  VALIDATING = 'validating',
  CREATING_DIR = 'creating_dir',
  INSTALLING_DEPS = 'installing_deps',
  COPYING_TEMPLATES = 'copying_templates',
  INITIALIZING_GIT = 'initializing_git',
  COMPLETE = 'complete',
  ERROR = 'error',
}

export class InstallationStateMachine {
  private state: State = State.IDLE;
  
  async transition(to: State) {
    logger.debug(`State transition: ${this.state} -> ${to}`);
    this.state = to;
  }
  
  canTransition(to: State): boolean {
    // Define valid transitions
    const validTransitions = {
      [State.IDLE]: [State.VALIDATING],
      [State.VALIDATING]: [State.CREATING_DIR, State.ERROR],
      // ...
    };
    return validTransitions[this.state]?.includes(to) ?? false;
  }
}
```

## 6. Testing Optimizations

### 6.1 Integration Tests
```typescript
// src/__tests__/integration/full-flow.test.ts
describe('Full installation flow', () => {
  it('should create demo workspace successfully', async () => {
    const tmpDir = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-test-'));
    
    try {
      await createProject('test-workspace', {
        demoMode: true,
        skipGit: true,
      });
      
      expect(await fsExtra.pathExists(path.join(tmpDir, 'test-workspace'))).toBe(true);
      expect(await fsExtra.pathExists(path.join(tmpDir, 'test-workspace', 'generate-demo.js'))).toBe(true);
    } finally {
      await fsExtra.remove(tmpDir);
    }
  });
});
```

### 6.2 Snapshot Tests for Generated Files
```typescript
// src/__tests__/snapshots/templates.test.ts
it('should generate correct pyproject.toml', async () => {
  const result = await generateTemplate('pyproject.toml', {
    project_name: 'test_project',
    author: 'Test Author',
  });
  
  expect(result).toMatchSnapshot();
});
```

### 6.3 Performance Benchmarks
```typescript
// src/__tests__/benchmarks/creation-speed.bench.ts
import { bench, describe } from 'vitest';

describe('Creation performance', () => {
  bench('create demo workspace', async () => {
    await createProject('bench-test', { demoMode: true, dryRun: true });
  });
});
```

## 7. Documentation Optimizations

### 7.1 API Documentation
```bash
npm install -D typedoc
```

```json
// package.json
{
  "scripts": {
    "docs": "typedoc --out docs src/index.ts"
  }
}
```

### 7.2 Proposed public API example

The package currently guarantees a CLI binary, not this programmatic API. The
following is illustrative only and must not be used by consumers:
```typescript
// examples/programmatic-usage.ts
import { createProject } from 'workspai';

async function example() {
  await createProject('my-workspace', {
    demoMode: true,
    skipGit: false,
  });
}
```

## 8. CI/CD Optimizations

**Note**: CI/CD is optional. If you don't need automated workflows, you can skip this section.

### 8.1 GitHub Actions Workflow
```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node-version: ['20.19.0', 22]
    
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm ci
      - run: npm test
      - run: npm run build
```

### 8.2 Releases

Do not publish directly from a tag-triggered example. Releases use the
maintainer-only `.github/workflows/release-npm-manual.yml` workflow and package
release scripts after all required exact-SHA gates pass. See
[CI Workflows](./ci-workflows.md) and [Setup](./SETUP.md).

## 9. Monitoring & Analytics Optimizations

### 9.1 Telemetry (Optional with User Consent)
```typescript
// src/telemetry.ts
import os from 'os';
import { getVersion } from './update-checker.js';

interface TelemetryData {
  version: string;
  command: string;
  options: string[];
  platform: string;
  nodeVersion: string;
  success: boolean;
  duration: number;
}

export async function sendTelemetry(data: TelemetryData) {
  // Only if user opted-in via config
  const config = await loadUserConfig();
  if (!config.telemetry) return;
  
  try {
    await fetch('https://telemetry.workspai.dev/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...data,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // Fail silently
  }
}
```

## 10. Bundle Size Optimizations

### 10.1 Analyze Bundle
```bash
npm install -D webpack-bundle-analyzer
```

### 10.2 Replace Heavy Dependencies
- `inquirer` → `prompts` (lighter alternative)
- `chalk` → `picocolors` (much smaller)
- `fs-extra` → native `fs/promises` where possible

### 10.3 Code Splitting
```typescript
// Dynamic imports for heavy operations
const createDemoWorkspace = async () => {
  const { generateDemoKit } = await import('./demo-kit.js');
  return generateDemoKit(...);
};
```

## Evaluation requirements

Proposals need an owner, measured baseline, target platform matrix, compatibility
analysis, and tests before implementation. Do not claim performance or bundle
improvements without committed, reproducible benchmark evidence.
