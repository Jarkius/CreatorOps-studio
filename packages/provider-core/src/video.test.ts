import { describe, expect, it, vi } from 'vitest';

import { ProviderError } from './errors.js';
import type { HttpRequest, HttpResponse, HttpTransport } from './openai-compatible.js';
import {
  estimateVideoCostUsd,
  fakeMp4,
  GeminiOmniVideoProvider,
  MockVideoProvider,
  mp4DurationSeconds,
  type VideoRequest,
} from './video.js';

const KEY = 'AIza-test-key-1234567890';
const REQUEST: VideoRequest = {
  prompt: 'โชว์เครื่องชงกาแฟพกพาบนโต๊ะไม้',
  aspectRatio: '9:16',
  resolution: '720p',
};
const PRICING = { perSecondUsd: 0.1 };

function reply(
  status: number,
  body: string | object,
  extra: { binary?: Uint8Array } = {},
): HttpResponse {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(text),
    ...(extra.binary === undefined
      ? {}
      : { arrayBuffer: () => Promise.resolve(extra.binary!.buffer.slice(0) as ArrayBuffer) }),
  } as HttpResponse;
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const videoReply = (bytes: Uint8Array) => ({
  id: 'v1_x',
  status: 'completed',
  steps: [
    { type: 'user_input', content: [{ type: 'text', text: 'x' }] },
    { type: 'thought', content: [{ type: 'thought', text: '...' }] },
    {
      type: 'model_output',
      content: [{ type: 'video', mime_type: 'video/mp4', data: b64(bytes) }],
    },
  ],
});

function provider(transport: HttpTransport, pricing = PRICING) {
  return new GeminiOmniVideoProvider({ apiKey: KEY, pricing, transport });
}

describe('mp4DurationSeconds', () => {
  it('reads the length from moov/mvhd', () => {
    expect(mp4DurationSeconds(fakeMp4(8))).toBe(8);
    expect(mp4DurationSeconds(fakeMp4(2.5))).toBeCloseTo(2.5, 3);
  });

  it('returns null for files it cannot read instead of throwing', () => {
    expect(mp4DurationSeconds(new Uint8Array())).toBeNull();
    expect(mp4DurationSeconds(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(mp4DurationSeconds(fakeMp4(8).subarray(0, 30))).toBeNull(); // cut off inside moov
    const junk = new Uint8Array(64).fill(0xff); // a box size that runs past the end
    expect(mp4DurationSeconds(junk)).toBeNull();
    const zeroScale = fakeMp4(8);
    new DataView(zeroScale.buffer).setUint32(zeroScale.length - 100 + 12, 0); // timescale 0
    expect(mp4DurationSeconds(zeroScale)).toBeNull();
  });
});

describe('estimateVideoCostUsd', () => {
  it('multiplies seconds, price and plan multiplier, and never goes below the minimum', () => {
    expect(estimateVideoCostUsd(8, { perSecondUsd: 0.1 })).toBeCloseTo(0.8, 9);
    expect(estimateVideoCostUsd(8, { perSecondUsd: 0.1, multiplier: 2 })).toBeCloseTo(1.6, 9);
    expect(estimateVideoCostUsd(1, { perSecondUsd: 0.1, minPerRequestUsd: 0.5 })).toBe(0.5);
    expect(estimateVideoCostUsd(-3, { perSecondUsd: 0.1 })).toBe(0);
  });
});

describe('MockVideoProvider', () => {
  it('returns a small mp4 with the expected length and no cost, without a network', async () => {
    const result = await new MockVideoProvider().generateVideo({ ...REQUEST, expectedSeconds: 6 });
    expect(result.mimeType).toBe('video/mp4');
    expect(mp4DurationSeconds(result.bytes)).toBe(6);
    expect(result.usage).toEqual({ seconds: 6, costUsd: 0, costSource: 'none' });
    expect(String.fromCharCode(...result.bytes.subarray(4, 8))).toBe('ftyp');
  });

  it('refuses an empty prompt and an aborted call', async () => {
    const mock = new MockVideoProvider();
    await expect(mock.generateVideo({ ...REQUEST, prompt: '  ' })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    const controller = new AbortController();
    controller.abort();
    await expect(mock.generateVideo(REQUEST, { signal: controller.signal })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });
});

describe('GeminiOmniVideoProvider request', () => {
  it('sends the documented text-to-video body with the key in a header, not the address', async () => {
    const transport = vi.fn((_r: HttpRequest) =>
      Promise.resolve(reply(200, videoReply(fakeMp4(8)))),
    );
    await provider(transport).generateVideo(REQUEST);
    const call = transport.mock.calls[0]![0];
    expect(call.method).toBe('POST');
    expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(call.url).not.toContain(KEY);
    expect(call.url).not.toContain('key=');
    expect(call.headers['x-goog-api-key']).toBe(KEY);
    expect(call.headers['content-type']).toBe('application/json');
    expect(JSON.parse(call.body!)).toEqual({
      model: 'gemini-omni-1.1-flash',
      input: REQUEST.prompt,
      response_format: { type: 'video', aspect_ratio: '9:16', resolution: '720p' },
    });
  });

  it('sends the scene image first for image-to-video, with the task set', async () => {
    const transport = vi.fn((_r: HttpRequest) =>
      Promise.resolve(reply(200, videoReply(fakeMp4(8)))),
    );
    await provider(transport).generateVideo({
      ...REQUEST,
      image: { mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) },
    });
    const body = JSON.parse(transport.mock.calls[0]![0].body!);
    expect(body.input).toEqual([
      { type: 'image', data: btoa('\x01\x02\x03'), mime_type: 'image/png' },
      { type: 'text', text: REQUEST.prompt },
    ]);
    expect(body.generation_config).toEqual({ video_config: { task: 'image_to_video' } });
  });

  it('refuses a missing key, a newline in the key, and an empty prompt before any request', async () => {
    const transport = vi.fn();
    expect(() => new GeminiOmniVideoProvider({ apiKey: ' ', pricing: PRICING, transport })).toThrow(
      TypeError,
    );
    expect(
      () => new GeminiOmniVideoProvider({ apiKey: 'a\nb', pricing: PRICING, transport }),
    ).toThrow(TypeError);
    await expect(
      provider(transport).generateVideo({ ...REQUEST, prompt: '' }),
    ).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('GeminiOmniVideoProvider result', () => {
  it('decodes the inline video, reads its length and computes the cost from the entered price', async () => {
    const source = fakeMp4(8);
    const result = await provider(() =>
      Promise.resolve(reply(200, videoReply(source))),
    ).generateVideo(REQUEST);
    expect([...result.bytes]).toEqual([...source]);
    expect(result.mimeType).toBe('video/mp4');
    expect(result.usage.seconds).toBe(8);
    expect(result.usage.costUsd).toBeCloseTo(0.8, 9);
    expect(result.usage.costSource).toBe('computed');
  });

  it('trusts the length in the file over the length the caller expected', async () => {
    const result = await provider(() =>
      Promise.resolve(reply(200, videoReply(fakeMp4(8)))),
    ).generateVideo({
      ...REQUEST,
      expectedSeconds: 3,
    });
    expect(result.usage.seconds).toBe(8);
    expect(result.usage.costUsd).toBeCloseTo(0.8, 9);
  });

  it('refuses a downloaded file that is empty', async () => {
    const address = 'https://generativelanguage.googleapis.com/v1beta/files/e:download?alt=media';
    const transport: HttpTransport = (request) =>
      Promise.resolve(
        request.method === 'POST'
          ? reply(200, {
              steps: [
                {
                  type: 'model_output',
                  content: [{ type: 'video', mime_type: 'video/mp4', uri: address }],
                },
              ],
            })
          : reply(200, '', { binary: new Uint8Array() }),
      );
    await expect(provider(transport).generateVideo(REQUEST)).rejects.toMatchObject({
      code: 'INVALID_OUTPUT',
    });
  });

  it('refuses a reply larger than the cap', async () => {
    const big = new GeminiOmniVideoProvider({
      apiKey: KEY,
      pricing: PRICING,
      maxResponseChars: 200,
      transport: () => Promise.resolve(reply(200, videoReply(fakeMp4(8)))),
    });
    await expect(big.generateVideo(REQUEST)).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
  });

  it('falls back to the expected length when the file has no readable header', async () => {
    const bare = Uint8Array.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 1, 2, 3, 4, 5, 6, 7, 8]);
    const result = await provider(() =>
      Promise.resolve(reply(200, videoReply(bare))),
    ).generateVideo({
      ...REQUEST,
      expectedSeconds: 5,
    });
    expect(result.usage.seconds).toBe(5);
    expect(result.usage.costUsd).toBeCloseTo(0.5, 9);
  });

  it('downloads a file address from Google, sending the key only to that host', async () => {
    const source = fakeMp4(8);
    const uriReply = {
      steps: [
        {
          type: 'model_output',
          content: [
            {
              type: 'video',
              mime_type: 'video/mp4',
              uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc:download?alt=media',
            },
          ],
        },
      ],
    };
    const transport = vi.fn((request: HttpRequest) =>
      Promise.resolve(
        request.method === 'POST' ? reply(200, uriReply) : reply(200, '', { binary: source }),
      ),
    );
    const result = await provider(transport).generateVideo(REQUEST);
    expect([...result.bytes]).toEqual([...source]);
    const get = transport.mock.calls[1]![0];
    expect(get.method).toBe('GET');
    expect(get.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/files/abc:download?alt=media',
    );
    expect(get.headers['x-goog-api-key']).toBe(KEY);
  });

  it('never sends the key to another host, an http address, or an address with credentials', async () => {
    for (const uri of [
      'https://evil.example.com/v1beta/files/x',
      'http://generativelanguage.googleapis.com/v1beta/files/x',
      'https://user:pw@generativelanguage.googleapis.com/x',
      'https://generativelanguage.googleapis.com.evil.example/x',
      'not a url',
    ]) {
      const transport = vi.fn((request: HttpRequest) =>
        Promise.resolve(
          request.method === 'POST'
            ? reply(200, {
                steps: [
                  {
                    type: 'model_output',
                    content: [{ type: 'video', mime_type: 'video/mp4', uri }],
                  },
                ],
              })
            : reply(200, '', { binary: fakeMp4(8) }),
        ),
      );
      await expect(provider(transport).generateVideo(REQUEST), uri).rejects.toMatchObject({
        code: 'INVALID_OUTPUT',
      });
      expect(transport, uri).toHaveBeenCalledTimes(1); // only the POST; no key left for the bad address
    }
  });
});

describe('GeminiOmniVideoProvider errors', () => {
  const code = async (transport: HttpTransport) => {
    try {
      await provider(transport).generateVideo(REQUEST);
    } catch (error) {
      if (error instanceof ProviderError) return error.code;
      throw error;
    }
    return 'none';
  };

  it('maps statuses to the same codes as the text provider, and marks the retryable ones', async () => {
    const cases: [number, string][] = [
      [400, 'INVALID_REQUEST'],
      [401, 'AUTH_FAILED'],
      [403, 'AUTH_FAILED'],
      [402, 'BUDGET_EXCEEDED'],
      [408, 'TIMEOUT'],
      [429, 'RATE_LIMITED'],
      [500, 'UPSTREAM_5XX'],
      [503, 'UPSTREAM_5XX'],
    ];
    for (const [status, expected] of cases) {
      expect(
        await code(() => Promise.resolve(reply(status, 'secret body with the prompt'))),
        String(status),
      ).toBe(expected);
    }
    expect(new ProviderError('RATE_LIMITED').retryable).toBe(true);
    expect(new ProviderError('AUTH_FAILED').retryable).toBe(false);
  });

  it('reports a refused prompt when the reply has no video', async () => {
    const noVideo = {
      steps: [{ type: 'model_output', content: [{ type: 'text', text: 'blocked' }] }],
    };
    expect(await code(() => Promise.resolve(reply(200, noVideo)))).toBe('CONTENT_REFUSED');
  });

  it('rejects replies that are not what the documentation describes', async () => {
    expect(await code(() => Promise.resolve(reply(200, 'not json')))).toBe('INVALID_OUTPUT');
    expect(await code(() => Promise.resolve(reply(200, { nothing: true })))).toBe('INVALID_OUTPUT');
    const empty = {
      steps: [
        { type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', data: '' }] },
      ],
    };
    expect(await code(() => Promise.resolve(reply(200, empty)))).toBe('INVALID_OUTPUT');
  });

  it('turns a network failure and a cancelled call into TIMEOUT or UPSTREAM_5XX', async () => {
    expect(await code(() => Promise.reject(new Error('socket hang up')))).toBe('UPSTREAM_5XX');
    const controller = new AbortController();
    const slow: HttpTransport = () => {
      controller.abort();
      return Promise.reject(new Error('aborted'));
    };
    await expect(
      provider(slow).generateVideo(REQUEST, { signal: controller.signal }),
    ).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('never puts the key, the prompt or the reply body into an error', async () => {
    try {
      await provider(() =>
        Promise.resolve(reply(500, `boom ${KEY} ${REQUEST.prompt}`)),
      ).generateVideo(REQUEST);
      expect.unreachable();
    } catch (error) {
      const text = JSON.stringify([String(error), (error as Error).message]);
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(REQUEST.prompt);
      expect(text).not.toContain('boom');
    }
  });
});
