import { ProviderError, type ProviderErrorCode } from './errors.js';
import type { HttpResponse, HttpTransport } from './openai-compatible.js';
import { fetchTransport } from './openai-compatible.js';
import type { ProviderCallOptions } from './types.js';

/** What a video provider is asked for. Plain data; the prompt is never logged. */
export interface VideoRequest {
  readonly prompt: string;
  readonly aspectRatio: '9:16' | '16:9';
  readonly resolution: '360p' | '720p' | '1080p';
  /** A scene image to animate (image-to-video). Optional. */
  readonly image?: {
    readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
    readonly bytes: Uint8Array;
  };
  /** What the caller expects, used only for the mock and as a fallback when the clip has no header. */
  readonly expectedSeconds?: number;
}

export interface VideoUsage {
  /** Length of the clip in seconds, read from the file. */
  readonly seconds: number;
  /** Cost in USD as billed to the owner, computed from the entered price (providers report none). */
  readonly costUsd: number;
  readonly costSource: 'computed' | 'none';
}

export interface VideoResult {
  readonly bytes: Uint8Array;
  readonly mimeType: 'video/mp4';
  readonly usage: VideoUsage;
}

export interface VideoProvider {
  readonly id: string;
  generateVideo(request: VideoRequest, options?: ProviderCallOptions): Promise<VideoResult>;
}

/** Prices as the owner entered them; the API reports no cost, so this is what the ledger uses. */
export interface VideoPricing {
  readonly perSecondUsd: number;
  /** A plan or pool multiplier, default 1. */
  readonly multiplier?: number;
  /** A flat charge below which a clip is never billed, default 0. */
  readonly minPerRequestUsd?: number;
}

export function estimateVideoCostUsd(seconds: number, pricing: VideoPricing): number {
  const base = Math.max(0, seconds) * pricing.perSecondUsd * (pricing.multiplier ?? 1);
  return Math.max(base, pricing.minPerRequestUsd ?? 0);
}

/**
 * The length of an MP4 in seconds, from its `moov/mvhd` header, or null when the file has none the
 * parser understands. Reads boxes only; never decodes video.
 */
export function mp4DurationSeconds(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fourcc = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  const find = (start: number, end: number, type: string): [number, number] | null => {
    let at = start;
    while (at + 8 <= end) {
      let size = view.getUint32(at);
      const name = fourcc(at + 4);
      let header = 8;
      if (size === 1) {
        if (at + 16 > end) return null;
        const high = view.getUint32(at + 8);
        const low = view.getUint32(at + 12);
        size = high * 2 ** 32 + low;
        header = 16;
      } else if (size === 0) {
        size = end - at;
      }
      if (size < header || at + size > end) return null;
      if (name === type) return [at + header, at + size];
      at += size;
    }
    return null;
  };
  const moov = find(0, bytes.byteLength, 'moov');
  if (moov === null) return null;
  const mvhd = find(moov[0], moov[1], 'mvhd');
  if (mvhd === null) return null;
  const [body, end] = mvhd;
  if (body + 4 > end) return null;
  const version = view.getUint8(body);
  let timescale: number;
  let duration: number;
  if (version === 0) {
    if (body + 20 > end) return null;
    timescale = view.getUint32(body + 12);
    duration = view.getUint32(body + 16);
  } else if (version === 1) {
    if (body + 32 > end) return null;
    timescale = view.getUint32(body + 20);
    duration = view.getUint32(body + 24) * 2 ** 32 + view.getUint32(body + 28);
  } else {
    return null;
  }
  if (timescale === 0) return null;
  const seconds = duration / timescale;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const length = 8 + parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  const view = new DataView(out.buffer);
  view.setUint32(0, length);
  out.set(
    Array.from(type, (char) => char.charCodeAt(0)),
    4,
  );
  let at = 8;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * A tiny MP4 made of a `ftyp` and a `moov/mvhd` box that states its length. It is not playable
 * video: it passes the server's file-type check and carries a real duration, which is all the
 * mock provider and the tests need.
 */
export function fakeMp4(seconds: number): Uint8Array {
  const ftyp = box(
    'ftyp',
    Uint8Array.from([0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d]),
  );
  const mvhdBody = new Uint8Array(100);
  const view = new DataView(mvhdBody.buffer);
  view.setUint32(12, 1000); // timescale
  view.setUint32(16, Math.round(seconds * 1000)); // duration
  const moov = box('moov', box('mvhd', mvhdBody));
  const file = new Uint8Array(ftyp.length + moov.length);
  file.set(ftyp, 0);
  file.set(moov, ftyp.length);
  return file;
}

/** No network, no cost: a deterministic clip the app can attach, for development and tests. */
export class MockVideoProvider implements VideoProvider {
  readonly id = 'mock-video';
  generateVideo(request: VideoRequest, options: ProviderCallOptions = {}): Promise<VideoResult> {
    if (options.signal?.aborted === true) return Promise.reject(new ProviderError('TIMEOUT'));
    if (request.prompt.trim() === '') return Promise.reject(new ProviderError('INVALID_REQUEST'));
    const seconds = request.expectedSeconds ?? 8;
    return Promise.resolve({
      bytes: fakeMp4(seconds),
      mimeType: 'video/mp4',
      usage: { seconds, costUsd: 0, costSource: 'none' },
    });
  }
}

// ---- Gemini Omni (paid, official) -----------------------------------------------------------

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_VIDEO_MODEL = 'gemini-omni-1.1-flash';
/** Largest reply read: base64 of about 75 MB of video. Anything bigger is refused. */
export const MAX_VIDEO_RESPONSE_CHARS = 100_000_000;
/** The only host a returned file address may point to (and the key is only ever sent there). */
const GEMINI_HOST = 'generativelanguage.googleapis.com';

export interface GeminiOmniConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly pricing: VideoPricing;
  readonly transport?: HttpTransport;
  /** Tests only. */
  readonly baseUrl?: string;
  /** Largest reply read, in characters. Defaults to `MAX_VIDEO_RESPONSE_CHARS`. */
  readonly maxResponseChars?: number;
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  // Pieces keep the argument list of fromCharCode small for large files.
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

function failureFor(status: number): ProviderError {
  let code: ProviderErrorCode;
  if (status === 401 || status === 403) code = 'AUTH_FAILED';
  else if (status === 402) code = 'BUDGET_EXCEEDED';
  else if (status === 408) code = 'TIMEOUT';
  else if (status === 429) return new ProviderError('RATE_LIMITED');
  else if (status >= 500) code = 'UPSTREAM_5XX';
  else code = 'INVALID_REQUEST';
  return new ProviderError(code);
}

interface VideoPart {
  readonly type?: unknown;
  readonly mime_type?: unknown;
  readonly data?: unknown;
  readonly uri?: unknown;
}

/**
 * Gemini Omni video through the official Gemini API (D-080 part 2). The request and response
 * shapes follow Google's documentation read on 2026-11-05 (`docs/MEDIA_PROVIDERS.md`); they have
 * NOT been confirmed by a real call. The key goes in the `x-goog-api-key` header, never in the
 * address, and is only ever sent to Google's own host. Errors are fixed sentences: no reply body,
 * prompt or key reaches a log.
 */
export class GeminiOmniVideoProvider implements VideoProvider {
  readonly id = 'gemini-omni';
  private readonly config: GeminiOmniConfig;
  private readonly transport: HttpTransport;
  private readonly base: string;

  constructor(config: GeminiOmniConfig) {
    if (config.apiKey.trim() === '' || /[\r\n]/u.test(config.apiKey)) {
      throw new TypeError('apiKey is missing or not valid');
    }
    if (!(config.pricing.perSecondUsd >= 0)) throw new TypeError('perSecondUsd is not valid');
    this.config = config;
    this.transport = config.transport ?? fetchTransport;
    this.base = (config.baseUrl ?? GEMINI_API_BASE).replace(/\/+$/u, '');
  }

  async generateVideo(
    request: VideoRequest,
    options: ProviderCallOptions = {},
  ): Promise<VideoResult> {
    if (options.signal?.aborted === true) throw new ProviderError('TIMEOUT');
    if (request.prompt.trim() === '') throw new ProviderError('INVALID_REQUEST');
    const text = { type: 'text', text: request.prompt };
    const body = {
      model: this.config.model ?? GEMINI_VIDEO_MODEL,
      input:
        request.image === undefined
          ? request.prompt
          : [
              {
                type: 'image',
                data: toBase64(request.image.bytes),
                mime_type: request.image.mimeType,
              },
              text,
            ],
      response_format: {
        type: 'video',
        aspect_ratio: request.aspectRatio,
        resolution: request.resolution,
      },
      ...(request.image === undefined
        ? {}
        : { generation_config: { video_config: { task: 'image_to_video' } } }),
    };
    const reply = await this.send(
      { url: `${this.base}/interactions`, method: 'POST', body: JSON.stringify(body) },
      options,
    );
    const part = this.findVideoPart(await this.readText(reply));
    let bytes: Uint8Array;
    if (typeof part.data === 'string' && part.data !== '') {
      bytes = fromBase64(part.data);
    } else if (typeof part.uri === 'string') {
      bytes = await this.download(part.uri, options);
    } else {
      throw new ProviderError('INVALID_OUTPUT');
    }
    if (bytes.length === 0) throw new ProviderError('INVALID_OUTPUT');
    const seconds = mp4DurationSeconds(bytes) ?? request.expectedSeconds ?? 8;
    return {
      bytes,
      mimeType: 'video/mp4',
      usage: {
        seconds,
        costUsd: estimateVideoCostUsd(seconds, this.config.pricing),
        costSource: 'computed',
      },
    };
  }

  private async send(
    call: { url: string; method: 'POST' | 'GET'; body?: string },
    options: ProviderCallOptions,
  ): Promise<HttpResponse> {
    let response: HttpResponse;
    try {
      response = await this.transport({
        url: call.url,
        method: call.method,
        headers: {
          'x-goog-api-key': this.config.apiKey,
          ...(call.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(call.body === undefined ? {} : { body: call.body }),
        signal: options.signal,
      });
    } catch {
      throw new ProviderError(options.signal?.aborted === true ? 'TIMEOUT' : 'UPSTREAM_5XX');
    }
    if (response.status < 200 || response.status >= 300) throw failureFor(response.status);
    return response;
  }

  private async readText(response: HttpResponse): Promise<string> {
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new ProviderError('UPSTREAM_5XX');
    }
    if (text.length > (this.config.maxResponseChars ?? MAX_VIDEO_RESPONSE_CHARS)) {
      throw new ProviderError('INVALID_OUTPUT');
    }
    return text;
  }

  private findVideoPart(text: string): VideoPart {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ProviderError('INVALID_OUTPUT');
    }
    const steps = (parsed as { steps?: unknown } | null)?.steps;
    if (!Array.isArray(steps)) throw new ProviderError('INVALID_OUTPUT');
    for (const step of steps as { type?: unknown; content?: unknown }[]) {
      if (step?.type !== 'model_output' || !Array.isArray(step.content)) continue;
      for (const part of step.content as VideoPart[]) {
        if (part?.type === 'video' && part.mime_type === 'video/mp4') return part;
      }
    }
    // A reply with no video usually means the prompt was blocked by the safety filters.
    throw new ProviderError('CONTENT_REFUSED');
  }

  private async download(address: string, options: ProviderCallOptions): Promise<Uint8Array> {
    let url: URL;
    try {
      url = new URL(address);
    } catch {
      throw new ProviderError('INVALID_OUTPUT');
    }
    // The key is sent with this request, so it may only go to Google's own host.
    if (
      url.protocol !== 'https:' ||
      url.hostname !== GEMINI_HOST ||
      url.username !== '' ||
      url.password !== ''
    ) {
      throw new ProviderError('INVALID_OUTPUT');
    }
    const response = await this.send({ url: url.toString(), method: 'GET' }, options);
    const binary = response as HttpResponse & { arrayBuffer?: () => Promise<ArrayBuffer> };
    if (typeof binary.arrayBuffer !== 'function') throw new ProviderError('INVALID_OUTPUT');
    try {
      return new Uint8Array(await binary.arrayBuffer());
    } catch {
      throw new ProviderError('UPSTREAM_5XX');
    }
  }
}
