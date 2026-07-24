# RapidKit v0.16.5 Release Notes

**Release Date:** February 5, 2026  
**Type:** Minor Release  
**Breaking Changes:** None

---

## 🎯 Overview

RapidKit v0.16.5 introduces powerful configuration management and comprehensive system diagnostics to streamline your development workflow.

---

## ✨ What's New

### ⚙️ Configuration File Support

RapidKit now supports `rapidkit.config.js` files for workspace-wide and project-level defaults:

**Workspace Settings:**
- `defaultAuthor` - Set your default author name
- `pythonVersion` - Choose Python version (3.10, 3.11, 3.12)
- `installMethod` - Set default install method (poetry, venv, pipx)

**Project Settings:**
- `defaultKit` - Set default project template
- `addDefaultModules` - Auto-include modules in all projects
- `skipGit` - Skip git initialization by default
- `skipInstall` - Skip dependency installation by default

**Configuration Priority:**
```
CLI arguments > rapidkit.config.js > .rapidkitrc.json > defaults
```

**Auto-Discovery:**
- Searches current directory and parent directories
- Supports .js, .mjs, and .cjs formats

**Example Configuration:**
```javascript
// rapidkit.config.js
export default {
  workspace: {
    defaultAuthor: "Your Name",
    pythonVersion: "3.11",
    installMethod: "poetry"
  },
  projects: {
    defaultKit: "fastapi.standard",
    addDefaultModules: ["auth", "database"],
    skipGit: false,
    skipInstall: false
  }
};
```

### 🪺 Doctor Command

New `rapidkit doctor` command provides comprehensive system diagnostics:

**Features:**
- ✅ Validates Python installation and version
- ✅ Checks pip, pipx, and Poetry installation
- ✅ Verifies RapidKit Core installation
- ✅ Provides actionable troubleshooting recommendations
- ✅ Generates detailed JSON reports for debugging

**Usage:**
```bash
# Run diagnostics
rapidkit doctor

# Get JSON report
rapidkit doctor --json
```

**Example Output:**
```
🪺 RapidKit System Doctor
━━━━━━━━━━━━━━━━━━━━━━

✓ Python 3.11.0 installed
✓ pip 24.0 installed
✓ pipx 1.4.0 installed
✓ Poetry 1.7.0 installed
✓ RapidKit Core 0.2.3 installed

🎉 All checks passed! Your system is ready to use RapidKit.
```

---

## 📚 Documentation

New comprehensive guides added:

1. **Configuration File Guide** (`docs/config-file-guide.md`)
   - Complete configuration file reference
   - Usage examples and best practices
   - Migration guide from .rapidkitrc.json

2. **Doctor Command Guide** (`docs/doctor-command.md`)
   - Detailed command documentation
   - Troubleshooting workflows
   - Understanding diagnostic output

3. **Example Configuration** (`rapidkit.config.example.js`)
   - Ready-to-use configuration template
   - Commented examples for all options

---

## 🔧 Improvements

### CLI Experience
- Enhanced help text with configuration examples
- Better error messages for config loading failures
- Improved README with configuration section

### Code Quality
- TypeScript types for configuration interfaces
- ESM-compatible config loading with pathToFileURL
- Robust config file discovery algorithm

---

## 📦 Installation

### Update Existing Installation
```bash
npm install -g rapidkit@0.16.5
```

### Fresh Installation
```bash
npm install -g rapidkit
```

### Verify Installation
```bash
rapidkit --version  # Should show 0.16.5
rapidkit doctor     # Verify your system setup
```

---

## 🔄 Upgrade Notes

**No breaking changes.** This release is fully backward compatible with v0.16.x.

- Existing `.rapidkitrc.json` files continue to work
- CLI arguments still take precedence
- No changes to existing project templates

**New Functionality:**
- Add `rapidkit.config.js` to leverage new configuration features
- Run `rapidkit doctor` to validate your toolchain setup

---

## 📊 Metrics

- **Bundle Size:** 118 KB (2 KB increase for new features)
- **Test Coverage:** 80%+ (maintained)
- **Tests Passing:** 488+ tests
- **Zero Breaking Changes**

---

## 🐛 Known Issues

None reported.

---

## 🙏 Credits

Thanks to all contributors and users providing feedback!

---

## 📝 Full Changelog

See [CHANGELOG.md](../CHANGELOG.md) for complete details.

---

## 🔗 Links

- **NPM Package:** https://www.npmjs.com/package/rapidkit
- **GitHub Repository:** https://github.com/chistiq/rapidkit-npm
- **Documentation:** https://docs.rapidkit.dev
- **Report Issues:** https://github.com/chistiq/rapidkit-npm/issues

---

**Happy Building! 🚀**
