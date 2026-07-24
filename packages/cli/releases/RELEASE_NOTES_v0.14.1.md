# Release Notes v0.14.1

**Release Date:** December 31, 2025

## 🎯 Highlights

Critical bug fix for Poetry virtualenv detection! This release eliminates the common "no .venv found" error when using Poetry with its default configuration.

## 🐛 Bug Fixes

### Poetry Virtualenv Detection

**Problem:**
RapidKit was only looking for `.venv` in the project directory, but Poetry by default creates virtualenvs in a cache directory (`~/.cache/pypoetry/virtualenvs/`). This caused frustrating errors:

```bash
rapidkit dev
❌ Project environment not bootstrapped (no .venv found).
```

Even though dependencies were properly installed!

**Root Cause:**
- Poetry's default behavior: `virtualenvs.in-project = false`
- Virtualenvs created in: `~/.cache/pypoetry/virtualenvs/<project>-<hash>-py<version>`
- RapidKit only checked: `<project>/.venv/`

**Solution:**
RapidKit now automatically detects Poetry virtualenvs using `poetry env info --path`:

```python
def _get_poetry_venv() -> Path | None:
    """Get Poetry virtualenv path if it exists"""
    result = subprocess.run(
        ["poetry", "env", "info", "--path"],
        capture_output=True,
        text=True,
        check=False
    )
    if result.returncode == 0 and result.stdout.strip():
        venv_path = Path(result.stdout.strip())
        if venv_path.exists():
            return venv_path
    return None
```

**Visual Feedback:**
When using Poetry's cache virtualenv, you'll now see:
```bash
rapidkit dev
🚀 Starting development server with hot reload...
📁 Working directory: /tmp/my-api
🌐 Server will be available at: http://0.0.0.0:8000
🐍 Using Poetry virtualenv: /home/user/.cache/pypoetry/virtualenvs/my-api-xyz-py3.10
```

## 📝 Changes

### Updated Files

**`templates/kits/fastapi-standard/.rapidkit/cli.py.j2`:**
- Added `_get_poetry_venv()` helper function
- Updated `dev()` command to check Poetry venv before `.venv`
- Updated `start()` command with same logic
- Improved error messages: "virtualenv" instead of ".venv"

**`templates/kits/fastapi-standard/.rapidkit/rapidkit.j2`:**
- Added Poetry virtualenv path detection in shell script
- Auto-sets `VENV_PY` and `VENV_POETRY` from Poetry's location
- Falls back to `.venv` if Poetry venv not found

## 🚀 Getting Started

### Install or Upgrade

```bash
# Global installation
npm install -g rapidkit@0.14.1

# Use with npx (no installation)
npx rapidkit@0.14.1 my-api --template fastapi

# Verify version
rapidkit --version
```

### Now Works Out of the Box!

```bash
# Create project
rapidkit my-api --template fastapi
cd my-api

# Install dependencies (Poetry default location)
rapidkit init

# Start dev server (automatically finds Poetry venv!)
rapidkit dev
# 🐍 Using Poetry virtualenv: ~/.cache/pypoetry/virtualenvs/...
# ✅ Works!
```

## 📊 Quality Metrics

| Metric | Value | Status |
|--------|-------|--------|
| Test Suite | 449/452 tests passing | ✅ |
| Build | Successful | ✅ |
| TypeScript | 0 errors | ✅ |
| ESLint | 0 warnings | ✅ |
| Manual Testing | Poetry cache venv | ✅ |
| Manual Testing | .venv in project | ✅ |

## 🧪 Testing

Tested scenarios:
1. ✅ Poetry with cache virtualenv (default)
2. ✅ Poetry with `.venv` in project
3. ✅ Global Python with `--allow-global-runtime`
4. ✅ Shell script wrapper (`.rapidkit/rapidkit`)
5. ✅ All CLI commands: `init`, `dev`, `start`

## 📝 Migration Notes

### For Existing Users

**No action required!** This fix is for newly created projects.

If you previously ran:
```bash
poetry config virtualenvs.in-project true
```

You can now remove this configuration if you prefer Poetry's default behavior:
```bash
poetry config virtualenvs.in-project false
```

### For New Projects

Simply use RapidKit as normal:
```bash
rapidkit my-api --template fastapi
cd my-api
rapidkit init
rapidkit dev
```

No special configuration needed!

## 🔗 Resources

- **GitHub:** https://github.com/chistiq/rapidkit-npm
- **Documentation:** https://docs.rapidkit.dev
- **NPM Package:** https://www.npmjs.com/package/rapidkit

## 🙏 Thanks

Thanks to the community for reporting this issue!

---

**Full Changelog:** https://github.com/chistiq/rapidkit-npm/compare/v0.14.0...v0.14.1
