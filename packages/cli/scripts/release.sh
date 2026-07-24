#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: scripts/release.sh [patch|minor|major|x.y.z] [--yes] [--no-publish]
    scripts/release.sh [..] [--allow-dirty]

Examples:
    scripts/release.sh patch
    scripts/release.sh minor --yes
    scripts/release.sh 0.22.0 --no-publish

Notes:
    - Bumps before regenerating contracts and running release checks.
    - Bumps version only when a bump argument is provided.
    - Always runs npm publish --dry-run before publish.
    - Publishes workspai and the short wspai alias package.
    - Updates the private monorepo version, packages/cli version, and packages/wspai version.
    - --allow-dirty skips clean git tree check (recommended only with --no-publish).
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MONOREPO_ROOT="$(cd "$CLI_DIR/../.." && pwd)"
if command -v npm >/dev/null 2>&1; then
    NPM_CMD=(npm)
elif command -v corepack >/dev/null 2>&1; then
    NPM_CMD=(corepack npm)
else
    echo "❌ npm not found. Install Node.js/npm or enable corepack before releasing." >&2
    exit 1
fi

BUMP=""
AUTO_YES="false"
NO_PUBLISH="false"
ALLOW_DIRTY="false"

for arg in "$@"; do
    case "$arg" in
        patch|minor|major)
            BUMP="$arg"
            ;;
        --yes)
            AUTO_YES="true"
            ;;
        --no-publish)
            NO_PUBLISH="true"
            ;;
        --allow-dirty)
            ALLOW_DIRTY="true"
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            if [[ -z "$BUMP" && "$arg" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
                BUMP="$arg"
            else
                echo "Unknown argument: $arg" >&2
                usage
                exit 1
            fi
            ;;
    esac
done

echo "🚀 Workspai npm release flow"
echo "============================"
echo "Monorepo: $MONOREPO_ROOT"
echo "Package:  $CLI_DIR"

cd "$MONOREPO_ROOT"

if [[ "$ALLOW_DIRTY" == "true" ]]; then
    echo "⚠️ Skipping clean-tree check (--allow-dirty)"
else
    echo "📋 Checking git status..."
    if [[ -n "$(git status --porcelain)" ]]; then
        echo "❌ Working tree is not clean. Commit/stash changes first."
        git status --short
        exit 1
    fi
    echo "✅ Working tree is clean"
fi

if [[ -n "$BUMP" ]]; then
    echo "📌 Bumping version: $BUMP"
    "${NPM_CMD[@]}" version "$BUMP" --no-git-tag-version --workspaces=false
    VERSION="$(node -p "require('./package.json').version")"
    "${NPM_CMD[@]}" --workspace workspai version "$VERSION" --no-git-tag-version
    "${NPM_CMD[@]}" --workspace wspai version "$VERSION" --no-git-tag-version
    node -e "const fs=require('fs'); const p='packages/wspai/package.json'; const pkg=require('./'+p); pkg.dependencies.workspai=process.argv[1]; fs.writeFileSync(p, JSON.stringify(pkg, null, 2)+'\\n');" "$VERSION"
    "${NPM_CMD[@]}" install --package-lock-only --ignore-scripts
fi

echo "🔄 Regenerating version-derived contracts..."
"${NPM_CMD[@]}" --workspace workspai run generate:contracts
"${NPM_CMD[@]}" --workspace workspai run check:generated-contracts

echo "🧪 Running quality checks..."
"${NPM_CMD[@]}" run validate
"${NPM_CMD[@]}" run build
"${NPM_CMD[@]}" run bundle-size
echo "✅ Quality checks passed"

VERSION="$(node -p "require('./packages/cli/package.json').version")"
TAG="v$VERSION"
PKG_NAME="$(node -p "require('./packages/cli/package.json').name")"
ALIAS_PKG_NAME="$(node -p "require('./packages/wspai/package.json').name")"
ALIAS_PKG_VERSION="$(node -p "require('./packages/wspai/package.json').version")"

if [[ "$ALIAS_PKG_VERSION" != "$VERSION" ]]; then
    echo "❌ $ALIAS_PKG_NAME version ($ALIAS_PKG_VERSION) must match $PKG_NAME version ($VERSION)." >&2
    exit 1
fi

ALIAS_DEP_VERSION="$(node -p "require('./packages/wspai/package.json').dependencies.workspai")"
if [[ "$ALIAS_DEP_VERSION" != "$VERSION" ]]; then
    echo "❌ $ALIAS_PKG_NAME dependency on workspai ($ALIAS_DEP_VERSION) must match $VERSION." >&2
    exit 1
fi

set +e
WORKSPAI_VIEW_OUTPUT="$("${NPM_CMD[@]}" view "$PKG_NAME@$VERSION" version 2>&1)"
WORKSPAI_VIEW_STATUS=$?
WSPAI_VIEW_OUTPUT="$("${NPM_CMD[@]}" view "$ALIAS_PKG_NAME@$VERSION" version 2>&1)"
WSPAI_VIEW_STATUS=$?
set -e

if [[ "$WORKSPAI_VIEW_STATUS" -eq 0 ]]; then
    echo "❌ $PKG_NAME@$VERSION is already published on npm."
    exit 1
elif grep -q "E404" <<<"$WORKSPAI_VIEW_OUTPUT"; then
    echo "✅ $PKG_NAME@$VERSION is available for publish."
else
    echo "$WORKSPAI_VIEW_OUTPUT" >&2
    exit "$WORKSPAI_VIEW_STATUS"
fi

if [[ "$WSPAI_VIEW_STATUS" -eq 0 ]]; then
    echo "❌ $ALIAS_PKG_NAME@$VERSION is already published on npm."
    exit 1
elif grep -q "E404" <<<"$WSPAI_VIEW_OUTPUT"; then
    echo "✅ $ALIAS_PKG_NAME@$VERSION is available for publish."
else
    echo "$WSPAI_VIEW_OUTPUT" >&2
    exit "$WSPAI_VIEW_STATUS"
fi

echo "👀 Dry-run publish for $TAG"
"${NPM_CMD[@]}" publish --dry-run --access public --workspace workspai
"${NPM_CMD[@]}" publish --dry-run --access public --workspace wspai

if [[ -n "$BUMP" ]]; then
    git add package.json package-lock.json packages/cli/package.json packages/wspai/package.json \
        packages/cli/contracts/extension-cli-compatibility.v1.json
    git commit -S -m "chore(release): $TAG"
    git tag -s "$TAG" -m "Release $TAG"
fi

if [[ "$NO_PUBLISH" == "true" ]]; then
    echo "ℹ️ --no-publish set. Stopping after dry-run."
    exit 0
fi

if [[ "$AUTO_YES" != "true" ]]; then
    read -r -p "Publish $TAG to npm? (yes/no): " confirm
    if [[ "$confirm" != "yes" ]]; then
        echo "❌ Release cancelled"
        exit 1
    fi
fi

echo "📦 Publishing $PKG_NAME $TAG to npm..."
"${NPM_CMD[@]}" publish --access public --workspace workspai
echo "📦 Publishing $ALIAS_PKG_NAME $TAG to npm..."
"${NPM_CMD[@]}" publish --access public --workspace wspai

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "🐙 Pushing commits/tags to origin/$CURRENT_BRANCH"
git push origin "$CURRENT_BRANCH" --follow-tags

if command -v gh >/dev/null 2>&1; then
    echo "🎉 Creating GitHub release: $TAG"
    gh release create "$TAG" --generate-notes
else
    echo "ℹ️ gh CLI not found. Create release manually:"
    echo "   https://github.com/chistiq/workspai/releases/new"
fi

echo "✅ Release complete: $TAG"
echo "📦 npm: https://www.npmjs.com/package/workspai"
echo "📦 npm alias: https://www.npmjs.com/package/wspai"
