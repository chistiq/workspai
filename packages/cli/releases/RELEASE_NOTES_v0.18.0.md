# RapidKit v0.18.0 Release Notes

**Release Date:** February 9, 2026  
**Release Type:** Minor  
**Compatibility:** Fully backward compatible with v0.17.0

---

## 🔧 Overview: Core Bridge & Contract Infrastructure

This minor release introduces **new features and infrastructure** improvements, with a focus on:

1. **Contract synchronization** between Core Python and NPM packages
2. **Enhanced Python bridge** with multi-venv support and robust error handling
3. **Template fixes** for NestJS projects
4. **Improved diagnostics** with better Core installation detection

---

## ✨ What's New

### 🔗 Contract Sync Infrastructure

Added automated contract schema validation to ensure API compatibility between Core and NPM:

- **New npm scripts:**
  - `npm run sync:contracts` - Synchronize contracts from Core schema
  - `npm run check:contracts` - Validate contracts match Core schema
  
- **CI Integration:**
  - Automatic contract validation in GitHub Actions workflow
  - Runs when `RAPIDKIT_CORE_SCHEMA_PATH` environment variable is set
  - Gracefully skips validation in standalone environments
  
- **Pre-commit Hook:**
  - Validates contracts before each commit
  - Auto-detects Core schema in monorepo setups
  - Supports multiple monorepo layouts (sibling/parent directories)

**Usage:**

```bash
# In monorepo setup
export RAPIDKIT_CORE_SCHEMA_PATH="../core/docs/contracts/rapidkit-cli-contracts.json"
npm run check:contracts

# Will validate:
# - version --json response format
# - commands --json response format  
# - project detect --json response format
```

---

### 📊 Modules Catalog API

New `getModulesCatalog()` function in Core bridge for fetching available modules:

```typescript
import { getModulesCatalog } from './core-bridge/pythonRapidkitExec.js';

// Fetch all modules
const catalog = await getModulesCatalog();

// Filter by category
const authModules = await getModulesCatalog({ category: 'auth' });

// Filter by tag
const officialModules = await getModulesCatalog({ tag: 'official' });

// Get detailed information
const detailed = await getModulesCatalog({ detailed: true });
```

**Features:**

- ✅ Supports JSON schema v1 with structured metadata
- ✅ 30-minute TTL caching for performance
- ✅ Backward compatible with legacy `modules list --json` format
- ✅ Automatic fallback to cached data on Core API failure
- ✅ Configurable cache TTL via options

---

### 🎯 Commands JSON API

The Core bridge now prefers the new `rapidkit commands --json` API for faster command discovery:

```json
{
  "schema_version": 1,
  "commands": ["create", "list", "add", "remove", "doctor", ...]
}
```

**Benefits:**

- ⚡ Faster than parsing `--help` output
- 🔒 More reliable and structured
- 📦 Falls back to `--help` parsing if unavailable
- 🔄 Includes `commands` in bootstrapped command set

---

## 🔧 Improvements

### Enhanced Python Bridge Robustness

Major reliability improvements to Core installation and execution:

#### 🗂️ Multi-venv Support

Each Core package specification now gets an isolated virtual environment:

```bash
# Different specs use different venvs
~/.cache/rapidkit/npm-bridge/venv-a1b2c3d4e5f6/  # rapidkit-core
~/.cache/rapidkit/npm-bridge/venv-x7y8z9a0b1c2/  # rapidkit-core==0.3.0
~/.cache/rapidkit/npm-bridge/venv-m3n4o5p6q7r8/  # git+https://...
```

**Key features:**

- Prevents version conflicts between different Core installations
- Supports pinned versions, git URLs, local wheels, etc.
- Smart legacy venv reuse for unpinned specs
- Automatic migration from legacy `venv/` directory

#### 🔄 Retry Logic with Exponential Backoff

Pip operations now automatically retry on failure:

```typescript
// Default: 2 retries with exponential backoff
// Attempt 1: immediate
// Attempt 2: ~800ms delay
// Attempt 3: ~1600ms delay (with jitter)
```

**Configurable via environment variables:**

```bash
export RAPIDKIT_BRIDGE_PIP_RETRY=3  # 3 retries (default: 2)
export RAPIDKIT_BRIDGE_PIP_RETRY_DELAY_MS=1000  # 1s base delay (default: 800ms)
```

#### ⏱️ Timeout Protection

All operations now have configurable timeouts:

- **venv creation**: 60 seconds
- **pip operations**: 120 seconds (default)

```bash
export RAPIDKIT_BRIDGE_PIP_TIMEOUT_MS=180000  # 3 minutes
```

#### 🚨 Granular Error Messages

Better error codes with actionable guidance:

```
❌ PYTHON_NOT_FOUND
   → Install Python 3.10+ and ensure `python3` is available

❌ BRIDGE_VENV_CREATE_FAILED  
   → Ensure Python venv support is installed (python3-venv)

❌ BRIDGE_PIP_BOOTSTRAP_FAILED
   → Install python3-venv/python3-pip and retry

❌ BRIDGE_PIP_UPGRADE_FAILED
   → Check network/proxy or disable RAPIDKIT_BRIDGE_UPGRADE_PIP

❌ BRIDGE_PIP_INSTALL_FAILED
   → Check network/proxy, or install manually: pipx install rapidkit-core
```

#### ✅ Enhanced Validation

Before reusing a cached venv, the bridge now:

1. Checks if Python executable exists
2. Validates rapidkit-core is importable
3. Removes and rebuilds venv if validation fails

---

### 👀 Doctor Command Enhancements

The `rapidkit doctor` command now displays **multiple RapidKit Core installations**:

```
✅ RapidKit Core: 0.3.0
   • Global (pipx): ~/.local/bin/rapidkit -> 0.3.0
   • Workspace (.venv): ./my-project/.venv/bin/rapidkit -> 0.3.0
```

**Improvements:**

- Shows all found installations (Global, pyenv, system, workspace)
- Displays version number for each installation
- Color-coded version arrows (`-> v0.3.0` in cyan)
- Indicates installation location context

---

### 🧪 Enhanced Test Coverage

**Drift Guard Tests** now validate contract schemas:

```typescript
// Validates JSON APIs against contract schema
test('version --json returns valid schema', async () => {
  const res = await runCoreRapidkitCapture(['version', '--json']);
  const payload = JSON.parse(res.stdout);
  
  expect(payload.schema_version).toBe(1);
  expect(typeof payload.version).toBe('string');
});

// Similar tests for:
// - commands --json
// - project detect --json
```

**Python Exec Tests** updated:

- Fixed error code expectation: `BRIDGE_VENV_CREATE_FAILED` (was `BRIDGE_VENV_BOOTSTRAP_FAILED`)
- Added test for `commands --json` preference over `--help` parsing

---

### 📦 Demo Kit Template Variables

Fixed missing context variables that caused template rendering errors:

```typescript
// Added default values:
{
  node_version: '20.0.0',        // Node.js version for NestJS
  database_type: 'postgresql',   // Database type selection
  include_caching: false         // Redis caching toggle
}
```

**Better error logging:**

```typescript
try {
  rendered = env.renderString(templateContent, context);
} catch (e) {
  console.error(`Failed to render template: ${templateFile}`);
  throw e;
}
```

---

## 🐛 Bug Fixes

### NestJS Template: Fixed Nunjucks Ternary Syntax

**Problem:**

```yaml
# ❌ Parser error at column 74: "expected variable end"
command: {{ 'pnpm' if package_manager == 'pnpm' else package_manager if package_manager in ['npm', 'yarn'] else 'npm' }} run start:dev
```

**Solution:**

```yaml
# ✅ Added parentheses to disambiguate nested ternary
command: {{ ('pnpm' if package_manager == 'pnpm' else (package_manager if package_manager in ['npm', 'yarn'] else 'npm')) }} run start:dev
```

**Impact:**

- Resolves "expected variable end" error in NestJS template tests
- Allows proper package manager selection in docker-compose.yml
- Fixed in both NPM templates and Core engine source

---

### Template Cleanup

Removed redundant `.env.example.j2` file from NestJS standard kit template.

---

### Bootstrap Commands Update

Added `commands` to `BOOTSTRAP_CORE_COMMANDS_SET` for cold-start support, ensuring the new `rapidkit commands --json` API is available during initial setup.

---

## 🆕 Environment Variables

New environment variables for Python bridge configuration:

| Variable | Default | Description |
|----------|---------|-------------|
| `RAPIDKIT_BRIDGE_PIP_RETRY` | `2` | Number of retry attempts for pip operations |
| `RAPIDKIT_BRIDGE_PIP_RETRY_DELAY_MS` | `800` | Base delay for exponential backoff (milliseconds) |
| `RAPIDKIT_BRIDGE_PIP_TIMEOUT_MS` | `120000` | Timeout for pip operations (milliseconds) |
| `RAPIDKIT_CORE_PYTHON_PACKAGE_ID` | - | Additional identifier for venv isolation |

**Example usage:**

```bash
# Increase retries for unreliable networks
export RAPIDKIT_BRIDGE_PIP_RETRY=5
export RAPIDKIT_BRIDGE_PIP_RETRY_DELAY_MS=2000
export RAPIDKIT_BRIDGE_PIP_TIMEOUT_MS=300000  # 5 minutes

# Use custom Core package
export RAPIDKIT_CORE_PYTHON_PACKAGE_ID="custom-build"
```

---

## 🔄 Migration Guide

### No Breaking Changes

This is a **minor release** with full backward compatibility. No action required.

### Optional: Enable Contract Validation

If you're in a monorepo with Core Python:

```bash
# Add to .env or CI environment
export RAPIDKIT_CORE_SCHEMA_PATH="$PWD/../core/docs/contracts/rapidkit-cli-contracts.json"

# Run validation
npm run check:contracts
```

### Optional: Customize Bridge Behavior

If you experience network issues during Core installation:

```bash
# Increase retry count and timeout
export RAPIDKIT_BRIDGE_PIP_RETRY=3
export RAPIDKIT_BRIDGE_PIP_TIMEOUT_MS=180000
```

---

## 📦 Installation

### New Installation

```bash
npm install -g rapidkit@0.18.0
```

### Upgrade from 0.17.0

```bash
npm install -g rapidkit@latest
```

### Verify Installation

```bash
rapidkit --version
# Expected: RapidKit CLI v0.18.0

rapidkit doctor
# Should show enhanced Core detection with multiple installations
```

---

## 🔗 Related Changes

### Synchronized with Core Engine

This release includes template fixes synchronized with RapidKit Core v0.3.0:

- Fixed nunjucks ternary syntax in `nestjs/standard/templates/docker-compose.yml.j2`
- Both Core and NPM templates now use consistent syntax

---

## 📚 Resources

- **Changelog:** [CHANGELOG.md](../CHANGELOG.md)
- **GitHub Repository:** [RapidKit NPM Package](https://github.com/chistiq/rapidkit-npm)
- **Documentation:** [docs.rapidkit.dev](https://docs.rapidkit.dev)
- **Core Python Package:** [RapidKit Core](https://github.com/chistiq/rapidkit-core)

---

## 🙏 Acknowledgments

Special thanks to all contributors who helped identify and fix issues in this release!

---

## 📝 Full Diff Summary

**Files Changed:** 14 files

**Key Changes:**

- ✨ New: Contract sync infrastructure (CI, pre-commit, npm scripts)
- 🔧 Enhanced: Python bridge (multi-venv, retry logic, timeouts, validation)
- 👀 Improved: Doctor command (multiple installations, versions)
- 📦 Fixed: Demo kit template variables
- 🐛 Fixed: NestJS docker-compose.yml nunjucks syntax
- 🧪 Enhanced: Test coverage (contract validation, drift guard)
- 📊 New: Modules catalog API (`getModulesCatalog`)
- 🎯 New: Commands JSON API preference

---

**Questions or Issues?**

- 🐛 Report bugs: [GitHub Issues](https://github.com/chistiq/rapidkit-npm/issues)
- 💬 Discussions: [GitHub Discussions](https://github.com/chistiq/rapidkit-npm/discussions)
- 📧 Contact: support@rapidkit.dev
