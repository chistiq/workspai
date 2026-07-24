# RapidKit v0.17.0 Release Notes

**Release Date:** February 6, 2026  
**Type:** Minor Release  
**Breaking Changes:** None

---

## 🎯 Overview

RapidKit v0.17.0 delivers a **major upgrade** to the `doctor` command with comprehensive workspace health monitoring, intelligent project type detection, and actionable diagnostics. This release transforms `rapidkit doctor --workspace` into a professional-grade health check tool suitable for both development and CI/CD pipelines.

---

## ✨ What's New

### 🩺 Enhanced Doctor Command - Complete Overhaul

The `doctor` command has been completely reimagined with 15+ new features:

#### **1. Framework Detection**
Automatically identifies your project type with visual indicators:
- 🐍 **FastAPI** - Python-based projects with `pyproject.toml`
- 🦅 **NestJS** - Node.js-based projects with `package.json`
- Mixed workspace support (FastAPI + NestJS in same workspace)

```bash
✅ Project: ai-services
   🐍 Framework: FastAPI (fastapi.standard)
```

#### **2. Health Score System**
Visual percentage-based scoring with detailed breakdown:

```
📊 Health Score:
   80% ████████████████░░░░
   ✅ 4 passed | ⚠️ 1 warnings | ❌ 0 errors
```

**Scoring includes:**
- System tool checks (Python, Poetry, pipx, Core)
- Project health (venv, dependencies, modules)
- Overall workspace status

#### **3. Project Statistics**
Real-time metrics from `registry.json`:
- Module count (e.g., "📊 Stats: 7 modules")
- Automatically synced with installed modules
- Foundation for future file/size metrics

#### **4. Last Modified Tracking**
Git-aware modification timestamps:
- Git-based: "2 hours ago", "3 days ago"
- Fallback: Directory mtime
- Display: `🕒 Last Modified: today`

#### **5. Comprehensive Health Checks**

**Tests Detection:**
- Checks for `tests/` or `test/` directories
- Display: `✅ Tests` or `⊘ No tests`

**Docker Support:**
- Validates `Dockerfile` presence
- Display: `✅ Docker` or `⊘ No Docker`

**Code Quality Tools:**
- **NestJS**: ESLint configuration (`.eslintrc.js`, `.eslintrc.json`)
- **FastAPI**: Ruff configuration (`ruff.toml`, `pyproject.toml`)
- Display: `✅ ESLint` / `✅ Ruff`

**Security Scanning:**
- Node.js: `npm audit --json` integration
- Python: Framework ready for pip-audit
- Display: `⚠️ Security: 3 vulnerability(ies) found`

#### **6. Actionable Fix Commands**
Every issue includes a solution:

```
Issues:
  • Dependencies not installed

🔧 Quick Fix:
$ cd /home/user/project && rapidkit init
```

**Features:**
- Project-specific paths (not workspace paths)
- Copy-paste ready commands
- Multiple fixes per project supported

#### **7. Auto-Fix Mode** (NEW)
Automatically apply fixes with user confirmation:

```bash
rapidkit doctor --workspace --fix
```

**Process:**
1. Scans workspace for issues
2. Displays available fixes
3. Asks for confirmation
4. Executes fixes sequentially
5. Reports success/failure per fix

**Example:**
```
? Apply 1 fix(es)? Yes

🚀 Applying fixes...

Fixing ai-services...
  $ cd /path/to/project && rapidkit init
  ✅ Success

✅ Fix process completed!
```

#### **8. JSON Output Mode** (NEW)
Machine-readable format for CI/CD:

```bash
rapidkit doctor --workspace --json
```

**Output includes:**
- Workspace metadata
- Health score
- System tool status
- Project-by-project details
- Fix commands
- Summary statistics

**Use in CI/CD:**
```yaml
- name: Health Check
  run: |
    rapidkit doctor --workspace --json > health.json
    if [ $(jq '.summary.hasSystemErrors' health.json) = "true" ]; then
      exit 1
    fi
```

#### **9. Version Compatibility Warnings**
Alerts on Core/CLI version mismatches:

```
⚠️ Version mismatch: Core 0.2.1 / CLI 0.17.0
   Consider updating to matching versions for best compatibility
```

**Logic:**
- Compares Core and npm package versions
- Warns when minor versions differ
- Recommends updating

#### **10. Module Health Checks**
Validates Python module structure:
- Checks `src/__init__.py`
- Validates `modules/<module>/__init__.py` for each module
- Reports specific missing files

**Display:**
```
✅ Modules: Healthy
⚠️ Modules: Missing 2 init file(s)
```

#### **11. Environment File Validation**
Detects missing `.env` configuration:
- Checks for `.env` in project root
- Detects `.env.example` as template
- Offers copy command if example exists

**Display:**
```
✅ Environment: .env configured
⚠️ Environment: .env missing
```

**Fix suggestion:**
```bash
cd /path/to/project && cp .env.example .env
```

#### **12. Improved Dependency Detection**
Better verification for both project types:

**Node.js:**
- Tries to count real packages in `node_modules/`
- Filters system directories (`.bin`, `.cache`)
- Accurate "installed" vs "missing" detection

**Python:**
- Tries `import fastapi` to verify installation
- Fallback: Counts real packages in site-packages
- Ignores pip/setuptools/wheel

#### **13. Multi-Project Type Support**
Handles mixed workspaces seamlessly:
- Different health checks per project type
- Appropriate fix commands per framework
- Framework-specific displays

**Example workspace with both:**
```
📦 Projects (2):

✅ Project: api-gateway
   🐍 Framework: FastAPI
   ✅ Dependencies: Installed
   ✅ Tests • ✅ Docker • ✅ Ruff

✅ Project: web-service
   🦅 Framework: NestJS
   ✅ Dependencies: Installed
   ✅ Tests • ✅ Docker • ✅ ESLint
```

#### **14. RapidKit Core Priority Fix**
Workspace venv now checked **before** global:

**Priority:**
1. Workspace `.venv/bin/rapidkit`
2. Global pipx installation
3. System Python environment

**Benefits:**
- Respects isolated workspace environments
- Proper detection: "Installed in workspace virtualenv"
- Better workspace isolation

#### **15. Enhanced Visual Output**
Professional-grade UI with comprehensive indicators:

**Status Icons:**
- ✅ Green: Healthy/configured
- ⚠️ Yellow: Warning/missing
- ❌ Red: Error/critical
- ℹ️ Info: Informational
- ⊘ Dim: Not present/optional

**Framework Icons:**
- 🐍 FastAPI
- 🦅 NestJS
- 📦 Unknown

**Information Icons:**
- 📊 Statistics
- 🕒 Last Modified
- 🔧 Quick Fix

---

## 🔧 Improvements

### Core Detection Priority
- **Before**: Checked global Python first, then workspace venv
- **After**: Workspace venv **priority**, then global
- **Benefit**: Proper workspace isolation and environment detection

### Project Health Display
- Framework type with icon at the top
- Kit information display
- Organized status lines
- Compact additional checks (Tests • Docker • ESLint/Ruff)
- Statistics and timestamps

### Command Execution
- Fixed shell command resolution
- Proper handling of `cd && command` patterns
- Better error messages

---

## 🐛 Bug Fixes

1. **fs-extra ESM Compatibility**
   - **Issue**: `import * as fsExtra` doesn't work properly in ESM
   - **Fix**: Changed to `import fsExtra from 'fs-extra'`
   - **Impact**: Project detection now works reliably

2. **Auto-Fix Command Execution**
   - **Issue**: Commands like `rapidkit init` couldn't be resolved
   - **Fix**: Execute commands through shell with `shell: true`
   - **Impact**: `--fix` flag now works correctly

3. **Dependency Detection**
   - **Issue**: Always reported "Dependencies not installed"
   - **Fix**: Improved detection logic with actual package verification
   - **Impact**: Accurate "100% healthy" scores

4. **Project Scanning**
   - **Issue**: Shallow scan missed nested projects
   - **Fix**: Added deep recursive fallback (max depth 3)
   - **Impact**: All projects found in workspace

---

## 📚 Documentation

### New Documentation
- **DOCTOR_ENHANCEMENTS.md**: Comprehensive guide covering:
  - All 15 features explained in detail
  - Use case examples (dev workflow, CI/CD)
  - Technical architecture
  - API interfaces and examples
  - Future roadmap

### Updated Documentation
- **README.md**: Added doctor command section with:
  - Usage examples for all flags
  - Feature highlights
  - Integration examples

---

## 📖 Usage Examples

### Basic Health Check
```bash
# System check only
rapidkit doctor

# Full workspace check
rapidkit doctor --workspace
```

### CI/CD Integration
```bash
# JSON output for automation
rapidkit doctor --workspace --json > health-report.json

# Fail on errors
if [ $(jq '.summary.hasSystemErrors' health-report.json) = "true" ]; then
  echo "System requirements not met"
  exit 1
fi
```

### Auto-Fix Workflow
```bash
# Interactive fix
rapidkit doctor --workspace --fix

# Or manual copy-paste from Quick Fix sections
cd /path/to/project && rapidkit init
```

### Development Workflow
```bash
# Daily check
rapidkit doctor --workspace

# Before commit
rapidkit doctor --workspace --json | jq '.healthScore.percentage'

# Team onboarding
git clone <repo>
cd workspace
rapidkit doctor --workspace --fix
```

---

## 🎯 Use Cases

### For Developers
- **Daily health monitoring** of workspace
- **Quick issue identification** with fix commands
- **Project statistics** at a glance
- **Version compatibility** checks

### For Teams
- **Consistent environment validation**
- **Onboarding automation** with auto-fix
- **Workspace health standards**
- **Cross-project oversight**

### For CI/CD
- **Automated health checks** in pipelines
- **JSON output parsing** for decisions
- **Fail-fast validation**
- **Pre-deployment verification**

---

## 🚀 Migration Guide

No breaking changes! All existing functionality preserved.

### New Features to Adopt

1. **Use `--workspace` for detailed checks**
   ```bash
   rapidkit doctor --workspace
   ```

2. **Leverage auto-fix for common issues**
   ```bash
   rapidkit doctor --workspace --fix
   ```

3. **Integrate JSON mode in CI/CD**
   ```yaml
   script:
     - rapidkit doctor --workspace --json
   ```

4. **Review health scores regularly**
   - Aim for 80%+ health scores
   - Address warnings proactively

---

## 🔮 Future Enhancements

Planned for future releases:
- **Git Status**: Uncommitted changes, branch info
- **Port Availability**: Check default ports (8000, 3000, 5432, 6379)
- **Database Connection**: Test DB connectivity from `.env`
- **API Documentation**: Validate Swagger/OpenAPI setup
- **Performance Metrics**: Project size, build times
- **CI/CD File Detection**: GitHub Actions, GitLab CI

---

## 🙏 Acknowledgments

This release represents a major quality-of-life improvement for RapidKit users, with comprehensive diagnostics that help catch issues early and provide actionable solutions.

---

## 📦 Installation

```bash
# Update to latest
npm install -g rapidkit@0.17.0

# Or use with npx
npx rapidkit@0.17.0 doctor --workspace
```

---

## 🔗 Links

- [GitHub Repository](https://github.com/chistiq/rapidkit-npm)
- [Documentation](https://getrapidkit.com/docs)
- [VS Code Extension](https://marketplace.visualstudio.com/items?itemName=rapidkit.rapidkit-vscode)
- [Discord Community](https://discord.gg/rapidkit)

---

**Happy Building! 🚀**

*The RapidKit Team*
