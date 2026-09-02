import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const repositoryRoot = path.resolve(root, '..', '..');

function collectMarkdownFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectMarkdownFiles(fullPath, acc);
    } else if (entry.name.endsWith('.md')) {
      acc.push(fullPath);
    }
  }
  return acc;
}

const targets = [
  path.join(root, 'README.md'),
  ...collectMarkdownFiles(path.join(root, 'docs')),
  path.join(repositoryRoot, 'README.md'),
  path.join(repositoryRoot, '.github', 'CONTRIBUTING.md'),
  path.join(repositoryRoot, '.github', 'CONTRIBUTOR_MESSAGES.md'),
  path.join(repositoryRoot, '.github', 'PULL_REQUEST_TEMPLATE.md'),
];

const linkRegex = /\[[^\]]+\]\(([^)]+)\)/g;
const errors = [];

for (const file of targets) {
  const raw = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file);

  for (const match of raw.matchAll(linkRegex)) {
    const href = (match[1] || '').trim();
    if (!href) continue;

    if (
      href.startsWith('http://') ||
      href.startsWith('https://') ||
      href.startsWith('mailto:') ||
      href.startsWith('#')
    ) {
      continue;
    }

    const [filePart] = href.split('#');
    const resolved = path.resolve(dir, filePart);
    if (!fs.existsSync(resolved)) {
      errors.push(`${path.relative(root, file)} -> missing: ${href}`);
    }
  }
}

if (errors.length) {
  console.error('❌ Markdown link check failed:\n');
  for (const err of errors) console.error(`- ${err}`);
  process.exit(1);
}

console.log(`✅ Markdown local links are valid (${targets.length} files).`);
