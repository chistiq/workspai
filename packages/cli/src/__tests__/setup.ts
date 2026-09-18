import path from 'node:path';
import os from 'node:os';

import { buildCleanGitEnv } from '../utils/git-worktree.js';

// Every Vitest worker and every CLI subprocess it launches gets an isolated
// registry root. Tests must never read or mutate the developer/runner HOME.
const worker = process.env.VITEST_WORKER_ID ?? 'main';
const isolatedHome = path.join(os.tmpdir(), `workspai-vitest-${process.pid}-${worker}`);
process.env.HOME = isolatedHome;
process.env.USERPROFILE = isolatedHome;
process.env.XDG_CONFIG_HOME = path.join(isolatedHome, '.config');
process.env.XDG_CACHE_HOME = path.join(isolatedHome, '.cache');

// Husky and `git push` export GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE for the
// host worktree. Fixture `git init` / `git commit` calls inherit that unless we
// drop it here, and then they commit into the real repository.
const isolatedGitEnv = buildCleanGitEnv(process.env);
for (const key of Object.keys(process.env)) {
  if (!Object.prototype.hasOwnProperty.call(isolatedGitEnv, key)) {
    delete process.env[key];
  }
}
