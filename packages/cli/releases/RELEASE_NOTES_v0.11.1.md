# RapidKit v0.11.1 Release Notes

*Released: November 14, 2025*

## 🎯 Overview

This patch release focuses on improving test coverage and code quality with 33 additional tests and enhanced TypeScript configuration for decorator support.

## ✨ What's New

### Enhanced Test Coverage (+33 Tests)

We've significantly expanded our test suite from **393 to 426 tests**, increasing overall coverage from **72.69% to 74.63%**.

#### 📋 CLI Integration Tests (37 new tests)
- **Version & Help Commands**: Comprehensive testing of `--version`, `-V`, `--help`, `-h` flags
- **Dry-Run Mode**: Validation of dry-run behavior for both demo-only and workspace modes
- **Debug Mode**: Testing debug logging and verbose output
- **Demo Modes**: 
  - Demo-only project generation
  - Demo workspace creation
  - Beta notice for full installation mode
- **Input Validation**:
  - Invalid project names (uppercase, special characters, numbers at start)
  - Edge cases (single character, very long names, paths with dots)
  - Proper error messages and exit codes
- **Option Combinations**: Testing multiple flags together
- **Update Checker**: Verification of update check behavior
- **Path Resolution**: Testing absolute and relative path handling

#### 🎯 Performance Decorator Tests (6 new tests)
- Method performance measurement with `@measurePerformance` decorator
- Parameter handling in decorated methods
- Error propagation through decorated methods
- Context preservation (`this` binding)
- Multiple decorated methods in same class
- Complex return type handling

#### 🛡️ Error Handling Tests (3 new tests)
- Git initialization failure graceful degradation
- General error handling in demo workspace creation
- Error recovery and cleanup

## 🔧 Improvements

### TypeScript Configuration
- Enabled `experimentalDecorators` for performance monitoring decorators
- Added `emitDecoratorMetadata` for enhanced decorator metadata

### Test Coverage by Module
- ✅ **performance.ts**: 100% (improved from 79%)
- ✅ **create.ts**: 91.06% (improved from 90.07%)
- ✅ **config.ts**: 100%
- ✅ **errors.ts**: 100%
- ✅ **logger.ts**: 100%
- ✅ **update-checker.ts**: 100%
- ✅ **cache.ts**: 96.7%
- ✅ **validation.ts**: 96%
- ✅ **demo-kit.ts**: 94.82%

## 🐛 Bug Fixes

### Test Suite Fix
- Fixed async/await syntax error in `create-helpers.test.ts`
- Path operation tests now properly handle dynamic imports

## 📊 Test Statistics

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| **Total Tests** | 393 | 426 | +33 (+8.4%) |
| **Coverage** | 72.69% | 74.63% | +1.94% |
| **Test Files** | 18 | 18 | - |

## 🚀 Getting Started

### Install or Update

```bash
# Install globally
npm install -g rapidkit@0.11.1

# Or use with npx
npx rapidkit@0.11.1 my-workspace --demo
```

### Verify Installation

```bash
# Check version
rapidkit --version
# Output: 0.11.1

# Run tests
npm test

# Check coverage
npm run test:coverage
```

## 📝 Usage Examples

### Create Demo Workspace
```bash
npx rapidkit my-workspace --demo
```

### Generate Demo Project
```bash
npx rapidkit my-project --demo-only
```

### Dry Run (Preview)
```bash
npx rapidkit my-workspace --demo --dry-run
```

### Debug Mode
```bash
npx rapidkit my-project --demo-only --debug
```

## 🔗 Links

- **NPM Package**: https://www.npmjs.com/package/rapidkit
- **GitHub Repository**: https://github.com/chistiq/rapidkit-npm
- **Documentation**: https://getrapidkit.com/docs
- **Issue Tracker**: https://github.com/chistiq/rapidkit-npm/issues

## 🙏 Contributors

Special thanks to all contributors who helped make this release possible!

## 📋 Full Changelog

See [CHANGELOG.md](../CHANGELOG.md) for complete details.

---

**Note**: RapidKit Python package is currently in beta. For now, use `--demo` mode for standalone demo projects, or `--test-mode` if you have RapidKit installed locally.

Full installation mode will be available when RapidKit is published on PyPI.
