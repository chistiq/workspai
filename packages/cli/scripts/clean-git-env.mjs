/**
 * Keep this list aligned with packages/cli/src/utils/git-worktree.ts.
 * Node scripts cannot import that TypeScript module directly.
 */
const GIT_LOCAL_ENV_VARS = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CONFIG',
  'GIT_CONFIG_COUNT',
  'GIT_DIR',
  'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE',
  'GIT_NAMESPACE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_PREFIX',
  'GIT_QUARANTINE_PATH',
  'GIT_REPLACE_REF_BASE',
  'GIT_SHALLOW_FILE',
  'GIT_WORK_TREE',
];

export function buildCleanGitEnv(env = process.env) {
  const cleanEnv = { ...env };
  for (const key of GIT_LOCAL_ENV_VARS) {
    delete cleanEnv[key];
  }
  for (const key of Object.keys(cleanEnv)) {
    if (key.startsWith('GIT_CONFIG_KEY_') || key.startsWith('GIT_CONFIG_VALUE_')) {
      delete cleanEnv[key];
    }
  }
  return cleanEnv;
}
