# Release Notes - v0.10.0

**Release Date:** November 8, 2025

## 🎉 Major Changes

### Bundle Optimization
We've completely optimized the build process with **tsup**, resulting in dramatic improvements:

- **80% smaller bundle size** (208KB → 40KB)
- **Faster installation** - Single minified bundle
- **Faster startup** - Optimized for Node.js 18+
- **Production-ready** - Minified and tree-shaked
- **No source maps** in production builds

### New Versioning Strategy
We've switched from `beta` versioning to `0.x.x` to better reflect the development phase:

- `0.x.x` indicates pre-stable development
- API may change between minor versions
- Will release `1.0.0` when RapidKit Python is published on PyPI
- More transparent about development status

## 📊 Performance Improvements

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Bundle Size | 208KB | 40KB | **80% reduction** |
| Files | 30+ files | 1 file | **Simplified** |
| Startup Time | ~150ms | ~80ms | **47% faster** |

## 🛠️ Technical Details

### Build System
- Migrated from `tsc` to `tsup`
- Added minification and tree-shaking
- Removed development artifacts from production
- Optimized for modern Node.js runtime

### Developer Experience
- New `npm run build:watch` script
- Automated bundle size monitoring
- Improved build performance
- Better error messages during build

## 📦 Installation

```bash
# Use the latest version
npx rapidkit@latest my-workspace --demo

# Or install globally
npm install -g rapidkit@0.10.0
rapidkit my-workspace --demo
```

## 🔄 Migration from beta.9

No breaking changes! Simply update to the new version:

```bash
npm install -g rapidkit@0.10.0
```

All existing commands and features work exactly the same.

## 🚀 What's Next

Looking ahead to future releases:

- **NestJS demo templates** - Coming in 0.11.0
- **Improved error handling** - Better troubleshooting
- **More templates** - Additional project scaffolds
- **1.0.0 release** - When RapidKit Python hits PyPI

## 📚 Documentation

- [NPM Package](https://www.npmjs.com/package/rapidkit)
- [GitHub Repository](https://github.com/chistiq/rapidkit-npm)
- [VS Code Extension](https://marketplace.visualstudio.com/items?itemName=rapidkit.rapidkit-vscode)

## 💬 Feedback

We'd love to hear from you:
- 🐛 [Report Issues](https://github.com/chistiq/rapidkit-npm/issues)
- ⭐ [Star us on GitHub](https://github.com/chistiq/rapidkit-npm)
- 💬 Share your experience

---

**Note:** This is still a demo version. Full RapidKit integration will be available when the Python package is published on PyPI. Use `--demo` mode to try it out now!
