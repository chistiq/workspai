export const OPENROUTER_GATEWAY_ID = 'openrouter' as const;
export const OPENROUTER_POLICY_FILE = 'gateway.policy.json' as const;
export const DEFAULT_GATEWAY_TIMEOUT_MS = 30_000;
export const MAX_GATEWAY_TIMEOUT_MS = 600_000;
export const OPENROUTER_SORT_VALUES = ['price', 'throughput', 'latency', 'exacto'] as const;
export const OPENROUTER_SORT_PARTITION_VALUES = ['model', 'none'] as const;
export const OPENROUTER_PERCENTILE_KEYS = ['p50', 'p75', 'p90', 'p99'] as const;
export const OPENROUTER_MAX_PRICE_KEYS = [
  'prompt',
  'completion',
  'request',
  'image',
  'audio',
] as const;
export const OPENROUTER_QUANTIZATION_VALUES = [
  'int4',
  'int8',
  'fp4',
  'mxfp4',
  'nvfp4',
  'fp6',
  'fp8',
  'mxfp8',
  'fp16',
  'bf16',
  'fp32',
  'unknown',
] as const;
export const OPENROUTER_DATA_COLLECTION_VALUES = ['allow', 'deny'] as const;

export const GITIGNORE = `# Credentials and local secrets
.env
.env.*
!.env.example

# Dependencies and virtual environments
node_modules/
.venv/
venv/
__pycache__/
*.py[cod]
.pytest_cache/
.mypy_cache/
.ruff_cache/

# Build output and caches
dist/
build/
coverage/
.coverage
*.tsbuildinfo
.cache/

# Editor and OS
.DS_Store
Thumbs.db
`;
