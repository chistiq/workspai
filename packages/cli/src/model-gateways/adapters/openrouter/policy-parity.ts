export const OPENROUTER_OVERFLOW_PRICE = '9'.repeat(400);

export type PolicyParityDecision = 'accept' | 'reject';

export type PolicyParityCase = {
  id: string;
  decision: PolicyParityDecision;
  needle?: string;
  typescript: unknown;
  python: unknown;
};

function both(
  id: string,
  decision: PolicyParityDecision,
  needle: string | undefined,
  typescript: unknown,
  python: unknown
): PolicyParityCase {
  return needle
    ? { id, decision, needle, typescript, python }
    : { id, decision, typescript, python };
}

export const OPENROUTER_POLICY_PARITY_CASES: PolicyParityCase[] = [
  both('unknown-root-field', 'reject', 'unknown field', { widget: true }, { widget: true }),
  both(
    'unknown-provider-field',
    'reject',
    'unknown field',
    { provider: { fallbacks: true } },
    { provider: { fallbacks: true } }
  ),
  both(
    'unknown-max-price-key',
    'reject',
    'unknown field',
    { provider: { maxPrice: { tokens: '1' } } },
    { provider: { max_price: { tokens: '1' } } }
  ),
  both(
    'unknown-percentile-key',
    'reject',
    'unknown field',
    { provider: { preferredMaxLatency: { p95: 1 } } },
    { provider: { preferred_max_latency: { p95: 1 } } }
  ),
  both(
    'unknown-sort-field',
    'reject',
    'unknown field',
    { provider: { sort: { by: 'price', extra: true } } },
    { provider: { sort: { by: 'price', extra: true } } }
  ),
  both(
    'models-not-array',
    'reject',
    'models must be an array',
    { models: 'openai/gpt' },
    { models: 'openai/gpt' }
  ),
  both(
    'allow-fallbacks-string',
    'reject',
    'boolean',
    { provider: { allowFallbacks: 'yes' } },
    { provider: { allow_fallbacks: 'yes' } }
  ),
  both(
    'require-parameters-number',
    'reject',
    'boolean',
    { provider: { requireParameters: 1 } },
    { provider: { require_parameters: 1 } }
  ),
  both('zdr-number', 'reject', 'boolean', { provider: { zdr: 1 } }, { provider: { zdr: 1 } }),
  both('empty-model-name', 'reject', 'non-empty string', { models: [' '] }, { models: [' '] }),
  both(
    'whitespace-provider-name',
    'reject',
    'non-empty string',
    { provider: { order: [' '] } },
    { provider: { order: [' '] } }
  ),
  both('duplicate-models', 'reject', 'duplicates', { models: ['a', 'a'] }, { models: ['a', 'a'] }),
  both(
    'duplicate-order',
    'reject',
    'duplicates',
    { provider: { order: ['openai', 'openai'] } },
    { provider: { order: ['openai', 'openai'] } }
  ),
  both(
    'only-ignore-overlap',
    'reject',
    'overlap',
    { provider: { only: ['openai'], ignore: ['openai'] } },
    { provider: { only: ['openai'], ignore: ['openai'] } }
  ),
  both(
    'ignored-provider-in-order',
    'reject',
    'ignored providers',
    { provider: { order: ['openai'], ignore: ['openai'] } },
    { provider: { order: ['openai'], ignore: ['openai'] } }
  ),
  both(
    'unsupported-quantization',
    'reject',
    'quantizations',
    { provider: { quantizations: ['int5'] } },
    { provider: { quantizations: ['int5'] } }
  ),
  both(
    'invalid-sort',
    'reject',
    'sort',
    { provider: { sort: 'cheap' } },
    { provider: { sort: 'cheap' } }
  ),
  both(
    'invalid-sort-partition',
    'reject',
    'partition',
    { provider: { sort: { by: 'price', partition: 'all' } } },
    { provider: { sort: { by: 'price', partition: 'all' } } }
  ),
  both(
    'zdr-with-data-collection-allow',
    'reject',
    'zdr',
    { provider: { zdr: true, dataCollection: 'allow' } },
    { provider: { zdr: true, data_collection: 'allow' } }
  ),
  both('timeout-zero', 'reject', 'positive integer', { timeoutMs: 0 }, { timeout_ms: 0 }),
  both(
    'timeout-over-max',
    'reject',
    'positive integer',
    { timeoutMs: 600001 },
    { timeout_ms: 600001 }
  ),
  both(
    'max-price-number',
    'reject',
    'numeric string',
    { provider: { maxPrice: { prompt: 1 } } },
    { provider: { max_price: { prompt: 1 } } }
  ),
  both(
    'max-price-negative',
    'reject',
    'numeric string',
    { provider: { maxPrice: { prompt: '-1' } } },
    { provider: { max_price: { prompt: '-1' } } }
  ),
  both(
    'max-price-malformed',
    'reject',
    'numeric string',
    { provider: { maxPrice: { prompt: 'not-a-price' } } },
    { provider: { max_price: { prompt: 'not-a-price' } } }
  ),
  both(
    'max-price-overflow',
    'reject',
    'numeric string',
    { provider: { maxPrice: { prompt: OPENROUTER_OVERFLOW_PRICE } } },
    { provider: { max_price: { prompt: OPENROUTER_OVERFLOW_PRICE } } }
  ),
  both(
    'percentile-negative',
    'reject',
    'non-negative',
    { provider: { preferredMinThroughput: { p50: -1 } } },
    { provider: { preferred_min_throughput: { p50: -1 } } }
  ),
  both('valid-minimal-policy', 'accept', undefined, {}, {}),
  both('timeout-one', 'accept', undefined, { timeoutMs: 1 }, { timeout_ms: 1 }),
  both('timeout-max', 'accept', undefined, { timeoutMs: 600000 }, { timeout_ms: 600000 }),
  both(
    'max-price-zero',
    'accept',
    undefined,
    { provider: { maxPrice: { prompt: '0' } } },
    { provider: { max_price: { prompt: '0' } } }
  ),
  both(
    'max-price-micro',
    'accept',
    undefined,
    { provider: { maxPrice: { prompt: '0.000001' } } },
    { provider: { max_price: { prompt: '0.000001' } } }
  ),
  both(
    'max-price-positive',
    'accept',
    undefined,
    { provider: { maxPrice: { completion: '1.5' } } },
    { provider: { max_price: { completion: '1.5' } } }
  ),
  both(
    'valid-complete-policy',
    'accept',
    undefined,
    {
      models: ['openrouter/fallback'],
      timeoutMs: 1,
      httpReferer: 'https://example.test',
      appTitle: 'gateway',
      provider: {
        allowFallbacks: false,
        requireParameters: true,
        zdr: true,
        dataCollection: 'deny',
        enforceDistillableText: true,
        only: ['anthropic'],
        ignore: ['openai'],
        order: ['anthropic'],
        sort: { by: 'exacto', partition: 'none' },
        quantizations: ['fp16'],
        maxPrice: {
          prompt: '0',
          completion: '1.5',
          request: '2',
          image: '3',
          audio: '4',
        },
        preferredMinThroughput: { p50: 0, p75: 1, p90: 2, p99: 3 },
        preferredMaxLatency: 1.5,
      },
    },
    {
      models: ['openrouter/fallback'],
      timeout_ms: 1,
      http_referer: 'https://example.test',
      x_open_router_title: 'gateway',
      provider: {
        allow_fallbacks: false,
        require_parameters: true,
        zdr: true,
        data_collection: 'deny',
        enforce_distillable_text: true,
        only: ['anthropic'],
        ignore: ['openai'],
        order: ['anthropic'],
        sort: { by: 'exacto', partition: 'none' },
        quantizations: ['fp16'],
        max_price: {
          prompt: '0',
          completion: '1.5',
          request: '2',
          image: '3',
          audio: '4',
        },
        preferred_min_throughput: { p50: 0, p75: 1, p90: 2, p99: 3 },
        preferred_max_latency: 1.5,
      },
    }
  ),
];
