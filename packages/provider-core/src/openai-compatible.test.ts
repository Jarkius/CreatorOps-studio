import { describe, expect, it, vi } from 'vitest';

import { ProviderError, type ProviderErrorCode } from './errors.js';
import { MockTextProvider } from './mock.js';
import {
  estimateCostUsd,
  fetchTransport,
  MAX_RESPONSE_CHARS,
  OpenAiCompatibleTextProvider,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport,
  type OpenAiCompatibleConfig,
} from './openai-compatible.js';
import type { GenerateBriefRequest, RegenerateSectionRequest } from './types.js';

const KEY = 'sk-test-SECRET-1234567890';

const REQUEST: GenerateBriefRequest = {
  template: { id: 'product-showcase', version: 1 },
  language: 'th',
  tone: 'เป็นกันเอง',
  platform: 'tiktok',
  durationSeconds: 30,
  variantIndex: 0,
  product: {
    name: 'พัดลมพกพา',
    description: 'พัดลมตัวเล็ก ชาร์จได้',
    priceAmount: '299',
    currency: 'THB',
    sellingPoints: ['เบา', 'เงียบ'],
    targetAudience: null,
    brandTone: null,
    restrictedClaims: ['หายขาด'],
  },
};

async function goodDraft() {
  return (await new MockTextProvider().generateBrief(REQUEST)).output;
}

function reply(
  body: unknown,
  init: { status?: number; headers?: Record<string, string>; raw?: string } = {},
): HttpResponse {
  const text = init.raw ?? JSON.stringify(body);
  const headers = init.headers ?? {};
  return {
    status: init.status ?? 200,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(text),
  };
}

const completion = (content: string, extra: Record<string, unknown> = {}, usage: object = {}) => ({
  choices: [{ message: { content }, finish_reason: 'stop', ...extra }],
  usage: { prompt_tokens: 120, completion_tokens: 340, ...usage },
});

function make(
  respond: (request: HttpRequest) => HttpResponse | Promise<HttpResponse>,
  overrides: Partial<OpenAiCompatibleConfig> = {},
) {
  const requests: HttpRequest[] = [];
  const transport: HttpTransport = async (request) => {
    requests.push(request);
    return respond(request);
  };
  const provider = new OpenAiCompatibleTextProvider({
    id: 'openrouter',
    baseUrl: 'https://openrouter.example/api/v1/',
    apiKey: KEY,
    model: 'vendor/model-x',
    transport,
    ...overrides,
  });
  return { provider, requests };
}

async function failureOf(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProviderError) return error;
    throw error;
  }
  throw new Error('expected a ProviderError');
}

describe('OpenAiCompatibleTextProvider: request', () => {
  it('posts to base/chat/completions with the key, the model, JSON mode, and the product as data', async () => {
    const draft = await goodDraft();
    const { provider, requests } = make(() => reply(completion(JSON.stringify(draft))));
    await provider.generateBrief(REQUEST);
    const sent = requests[0]!;
    expect(sent.url).toBe('https://openrouter.example/api/v1/chat/completions');
    expect(sent.method).toBe('POST');
    expect(sent.headers.authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(sent.body) as {
      model: string;
      messages: { role: string; content: string }[];
      response_format: unknown;
      stream: boolean;
      max_tokens: number;
    };
    expect(body.model).toBe('vendor/model-x');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.stream).toBe(false);
    expect(body.max_tokens).toBe(2000);
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user']);
    // The key never appears in the body; product text is only in the user data message.
    expect(sent.body).not.toContain(KEY);
    expect(body.messages[0]!.content).not.toContain('พัดลมพกพา');
    expect(body.messages[1]!.content).toContain('พัดลมพกพา');
    expect(body.messages[0]!.content).toMatch(/DATA in JSON/);
    expect(body.messages[0]!.content).toMatch(/exactly 4 scene/);
  });

  it('adds extra body fields without letting them override the model or messages', async () => {
    const draft = await goodDraft();
    const { provider, requests } = make(() => reply(completion(JSON.stringify(draft))), {
      extraBody: { provider: { data_collection: 'deny' }, model: 'evil/model', messages: [] },
    });
    await provider.generateBrief(REQUEST);
    const body = JSON.parse(requests[0]!.body) as Record<string, unknown>;
    expect(body.provider).toEqual({ data_collection: 'deny' });
    expect(body.model).toBe('vendor/model-x');
    expect((body.messages as unknown[]).length).toBe(2);
  });

  it('refuses a base URL that is not https, has credentials, or a query', () => {
    const cfg = { id: 'x', apiKey: KEY, model: 'm' };
    for (const baseUrl of [
      'http://openrouter.example/v1',
      'https://user:pw@openrouter.example/v1',
      'https://openrouter.example/v1?key=1',
      'not a url',
      'ftp://x/v1',
    ]) {
      expect(() => new OpenAiCompatibleTextProvider({ ...cfg, baseUrl })).toThrow(TypeError);
    }
    expect(
      () => new OpenAiCompatibleTextProvider({ ...cfg, baseUrl: 'http://localhost:9/v1' }),
    ).toThrow();
    expect(
      () =>
        new OpenAiCompatibleTextProvider({
          ...cfg,
          baseUrl: 'http://localhost:9/v1',
          allowLocalHttp: true,
        }),
    ).not.toThrow();
  });

  it('refuses an empty key, a key with a line break, and an empty model', () => {
    const cfg = { id: 'x', baseUrl: 'https://a.example/v1', apiKey: KEY, model: 'm' };
    expect(() => new OpenAiCompatibleTextProvider({ ...cfg, apiKey: '  ' })).toThrow(TypeError);
    expect(() => new OpenAiCompatibleTextProvider({ ...cfg, apiKey: 'a\nb' })).toThrow(TypeError);
    expect(() => new OpenAiCompatibleTextProvider({ ...cfg, model: '' })).toThrow(TypeError);
  });
});

describe('OpenAiCompatibleTextProvider: results', () => {
  it('returns the validated draft, the model, and usage with the reported cost', async () => {
    const draft = await goodDraft();
    const { provider } = make(() => reply(completion(JSON.stringify(draft), {}, { cost: 0.0042 })));
    const result = await provider.generateBrief(REQUEST);
    expect(result.output).toEqual(draft);
    expect(result.model).toBe('vendor/model-x');
    expect(result.usage).toEqual({
      inputUnits: 120,
      outputUnits: 340,
      requests: 1,
      costUsd: 0.0042,
    });
  });

  it('computes the cost from the owner prices when the provider reports none', async () => {
    const draft = await goodDraft();
    const { provider } = make(() => reply(completion(JSON.stringify(draft))), {
      pricing: { inputPerMillionUsd: 3, outputPerMillionUsd: 15, multiplier: 1.3 },
    });
    const { usage } = await provider.generateBrief(REQUEST);
    expect(usage.costUsd).toBeCloseTo(((120 * 3 + 340 * 15) / 1_000_000) * 1.3, 10);
  });

  it('keeps Thai text whole (NFC and combining marks) and accepts a fenced JSON reply', async () => {
    const draft = await goodDraft();
    const fenced = '```json\n' + JSON.stringify(draft) + '\n```';
    const { provider } = make(() => reply(completion(fenced)));
    expect((await provider.generateBrief(REQUEST)).output.title).toBe(draft.title);
  });

  it('regenerates one section and validates only that section', async () => {
    const draft = await goodDraft();
    const { provider, requests } = make(() =>
      reply(completion(JSON.stringify({ value: 'ชื่อใหม่ที่ต่างจากเดิม' }))),
    );
    const req: RegenerateSectionRequest = { ...REQUEST, section: 'title', current: draft };
    const result = await provider.regenerateSection(req);
    expect(result).toMatchObject({ section: 'title', value: 'ชื่อใหม่ที่ต่างจากเดิม' });
    expect(JSON.parse(requests[0]!.body).messages[0].content).toContain(
      'Rewrite only the section "title"',
    );
  });

  it('rejects a section value of the wrong shape and an unknown section', async () => {
    const draft = await goodDraft();
    const { provider } = make(() => reply(completion(JSON.stringify({ value: ['x'] }))));
    const bad = await failureOf(
      provider.regenerateSection({ ...REQUEST, section: 'title', current: draft }),
    );
    expect(bad.code).toBe('INVALID_OUTPUT');
    const unknown = await failureOf(
      provider.regenerateSection({
        ...REQUEST,
        section: 'nope' as never,
        current: draft,
      }),
    );
    expect(unknown.code).toBe('INVALID_REQUEST');
  });
});

describe('OpenAiCompatibleTextProvider: failures', () => {
  const statusCases: [number, ProviderErrorCode, boolean][] = [
    [401, 'AUTH_FAILED', false],
    [403, 'AUTH_FAILED', false],
    [402, 'BUDGET_EXCEEDED', false],
    [400, 'INVALID_REQUEST', false],
    [404, 'INVALID_REQUEST', false],
    [422, 'INVALID_REQUEST', false],
    [408, 'TIMEOUT', true],
    [429, 'RATE_LIMITED', true],
    [500, 'UPSTREAM_5XX', true],
    [502, 'UPSTREAM_5XX', true],
    [503, 'UPSTREAM_5XX', true],
  ];
  it.each(statusCases)('maps HTTP %i to %s (retryable %s)', async (status, code, retryable) => {
    const { provider } = make(() => reply({ error: { message: `leak ${KEY}` } }, { status }));
    const error = await failureOf(provider.generateBrief(REQUEST));
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(retryable);
    // Nothing from the reply body or the key reaches the error.
    expect(error.message).not.toContain('leak');
    expect(error.message).not.toContain(KEY);
  });

  it('reads Retry-After as seconds or as a date, clamped to one minute', async () => {
    const seconds = make(() => reply({}, { status: 429, headers: { 'retry-after': '7' } }));
    expect((await failureOf(seconds.provider.generateBrief(REQUEST))).retryAfterMs).toBe(7000);
    const huge = make(() => reply({}, { status: 429, headers: { 'retry-after': '3600' } }));
    expect((await failureOf(huge.provider.generateBrief(REQUEST))).retryAfterMs).toBe(60_000);
    const date = new Date(Date.now() + 5000).toUTCString();
    const dated = make(() => reply({}, { status: 429, headers: { 'retry-after': date } }));
    const ms = (await failureOf(dated.provider.generateBrief(REQUEST))).retryAfterMs!;
    expect(ms).toBeGreaterThan(2000);
    expect(ms).toBeLessThanOrEqual(5000);
    const none = make(() => reply({}, { status: 429 }));
    expect((await failureOf(none.provider.generateBrief(REQUEST))).retryAfterMs).toBeUndefined();
    const junk = make(() => reply({}, { status: 429, headers: { 'retry-after': 'soon' } }));
    expect((await failureOf(junk.provider.generateBrief(REQUEST))).retryAfterMs).toBeUndefined();
  });

  it('treats a network failure as retryable, and an aborted call as a timeout', async () => {
    const down = make(() => Promise.reject(new TypeError(`fetch failed ${KEY}`)));
    const network = await failureOf(down.provider.generateBrief(REQUEST));
    expect(network).toMatchObject({ code: 'UPSTREAM_5XX', retryable: true });
    expect(network.message).not.toContain(KEY);

    const controller = new AbortController();
    const slow = make(() => {
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    });
    const timed = await failureOf(
      slow.provider.generateBrief(REQUEST, { signal: controller.signal }),
    );
    expect(timed.code).toBe('TIMEOUT');

    const already = new AbortController();
    already.abort();
    const never = make(() => reply({}));
    expect(
      (await failureOf(never.provider.generateBrief(REQUEST, { signal: already.signal }))).code,
    ).toBe('TIMEOUT');
    expect(never.requests).toHaveLength(0);
  });

  it('classifies bad replies: not JSON, empty, wrong shape, truncated, filtered, refused, too long', async () => {
    const draft = await goodDraft();
    const cases: [string, HttpResponse, ProviderErrorCode][] = [
      ['not json', reply(null, { raw: '<html>oops</html>' }), 'INVALID_OUTPUT'],
      ['no choices', reply({ choices: [] }), 'INVALID_OUTPUT'],
      ['empty content', reply(completion('  ')), 'INVALID_OUTPUT'],
      ['content not json', reply(completion('Sure! Here is your video.')), 'INVALID_OUTPUT'],
      ['missing keys', reply(completion(JSON.stringify({ title: 'only' }))), 'INVALID_OUTPUT'],
      [
        'too long a title',
        reply(completion(JSON.stringify({ ...draft, title: 'ก'.repeat(500) }))),
        'INVALID_OUTPUT',
      ],
      [
        'truncated',
        reply(completion(JSON.stringify(draft).slice(0, 50), { finish_reason: 'length' })),
        'OUTPUT_TRUNCATED',
      ],
      ['filtered', reply(completion('', { finish_reason: 'content_filter' })), 'CONTENT_REFUSED'],
      [
        'refusal field',
        reply({
          choices: [{ message: { content: null, refusal: 'I cannot' }, finish_reason: 'stop' }],
        }),
        'CONTENT_REFUSED',
      ],
      [
        'huge reply',
        reply(null, {
          raw: JSON.stringify(completion(JSON.stringify(draft))) + ' '.repeat(MAX_RESPONSE_CHARS),
        }),
        'INVALID_OUTPUT',
      ],
    ];
    for (const [label, response, code] of cases) {
      const { provider } = make(() => response);
      const error = await failureOf(provider.generateBrief(REQUEST));
      expect(error.code, label).toBe(code);
      expect(error.retryable, label).toBe(false);
    }
  });

  it('never retries or leaks: budget and truncation are permanent', () => {
    expect(new ProviderError('BUDGET_EXCEEDED').retryable).toBe(false);
    expect(new ProviderError('OUTPUT_TRUNCATED').retryable).toBe(false);
  });
});

describe('estimateCostUsd', () => {
  const pricing = { inputPerMillionUsd: 3, outputPerMillionUsd: 15 };
  it('multiplies and applies the per-request minimum', () => {
    const usage = { inputUnits: 1000, outputUnits: 1000 };
    expect(estimateCostUsd(usage, pricing)).toBeCloseTo(0.018, 10);
    expect(estimateCostUsd(usage, { ...pricing, multiplier: 2 })).toBeCloseTo(0.036, 10);
    expect(estimateCostUsd(usage, { ...pricing, minPerRequestUsd: 0.1 })).toBe(0.1);
    expect(estimateCostUsd({ inputUnits: 0, outputUnits: 0 }, pricing)).toBe(0);
  });
});

describe('fetchTransport', () => {
  it('never follows a redirect (a redirect could carry the key to another host) and passes the signal', async () => {
    const fake = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fake);
    try {
      const controller = new AbortController();
      await fetchTransport({
        url: 'https://a.example/v1/chat/completions',
        method: 'POST',
        headers: { authorization: 'Bearer x' },
        body: '{}',
        signal: controller.signal,
      });
      const init = fake.mock.calls[0]![1] as RequestInit;
      expect(init.redirect).toBe('error');
      expect(init.signal).toBe(controller.signal);
      expect(init.method).toBe('POST');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
