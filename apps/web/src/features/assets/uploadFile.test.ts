import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@creatorops/contracts';

import { createDashboardClient } from '../../api/client.js';
import { createFakeApi, json, WORKSPACE } from '../../test/fakeApi.js';
import type { FakeApiOptions } from '../../test/fakeApi.js';
import { FakeXhr } from '../../test/fakeXhr.js';
import { formatBytes, uploadFile, validateFile } from './uploadFile.js';
import type { UploadProgress } from './uploadFile.js';

const MB = 1024 * 1024;

function setup(intercept?: FakeApiOptions['intercept']) {
  const api = createFakeApi(intercept === undefined ? {} : { intercept });
  const client = createDashboardClient({
    baseUrl: 'http://api.test',
    getToken: () => 'secret-token',
    fetch: api.fetch,
  });
  FakeXhr.reset();
  return { api, client };
}

const pick = (name: string, type: string, size: number) => ({ name, type, size });

describe('validateFile', () => {
  it.each([
    ['image/jpeg', 'a.jpg'],
    ['image/png', 'a.png'],
    ['image/webp', 'a.webp'],
    ['image/gif', 'a.gif'],
    ['video/mp4', 'a.mp4'],
  ])('accepts %s', (type, name) => {
    expect(validateFile(pick(name, type, 1024))).toBeNull();
  });

  it('refuses a type outside the allowlist, such as SVG', () => {
    expect(validateFile(pick('logo.svg', 'image/svg+xml', 100))).toMatch(/not supported/);
    expect(validateFile(pick('notes.txt', '', 100))).toMatch(/not supported/);
  });

  it('refuses an empty file', () => {
    expect(validateFile(pick('empty.png', 'image/png', 0))).toBe('This file is empty.');
  });

  it('refuses a blank name and a name longer than 255 characters', () => {
    expect(validateFile(pick('   ', 'image/png', 10))).toBe('The file needs a name.');
    expect(validateFile(pick(`${'x'.repeat(256)}.png`, 'image/png', 10))).toMatch(
      /up to 255 characters/,
    );
    expect(validateFile(pick(`${'x'.repeat(251)}.png`, 'image/png', 10))).toBeNull();
  });

  it('accepts an image of exactly 15 MB and refuses one byte more', () => {
    expect(validateFile(pick('ok.png', 'image/png', 15 * MB))).toBeNull();
    const message = validateFile(pick('big.png', 'image/png', 15 * MB + 1));
    expect(message).toBe('Images can be up to 15.0 MB. This file is 15.0 MB.');
  });

  it('gives videos the larger cap: 200 MB allowed, one byte more refused', () => {
    expect(validateFile(pick('ok.mp4', 'video/mp4', 200 * MB))).toBeNull();
    expect(validateFile(pick('big.mp4', 'video/mp4', 200 * MB + 1))).toMatch(
      /^Videos can be up to 200\.0 MB/,
    );
  });

  it('refuses an image that is only too large for images, even though a video could be that big', () => {
    expect(validateFile(pick('photo.jpg', 'image/jpeg', 20 * MB))).toMatch(/^Images/);
    expect(validateFile(pick('clip.mp4', 'video/mp4', 20 * MB))).toBeNull();
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [15 * MB, '15.0 MB'],
    [5 * 1024 * MB, '5.0 GB'],
    [Number.NaN, '0 B'],
    [-4, '0 B'],
  ])('formats %d as %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

describe('uploadFile', () => {
  it('declares the file, PUTs its bytes to the resolved URL without a bearer token, then completes it', async () => {
    const { api, client } = setup();
    const file = new File(['hello-bytes'], 'photo.png', { type: 'image/png' });
    const progress: UploadProgress[] = [];

    const pending = uploadFile({
      client,
      workspaceId: WORKSPACE.id,
      file,
      productId: 'prod_1',
      onProgress: (value) => progress.push(value),
      createTransport: () => new FakeXhr(),
    });
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));

    const xhr = FakeXhr.last();
    expect(xhr.method).toBe('PUT');
    expect(xhr.url).toBe('http://api.test/api/v1/uploads/intent_1?exp=1&sig=test');
    expect(xhr.headers['content-type']).toBe('image/png');
    expect(xhr.headers.authorization).toBeUndefined();
    expect(xhr.body).toBe(file);

    xhr.progress(5, 10);
    xhr.progress(10, 10);
    xhr.respond(204);
    const asset = await pending;

    expect(asset.originalFilename).toBe('photo.png');
    expect(api.calls.find((call) => call.path.endsWith('upload-intent'))?.body).toEqual({
      filename: 'photo.png',
      mimeType: 'image/png',
      sizeBytes: 11,
      productId: 'prod_1',
    });
    expect(api.calls.at(-1)).toMatchObject({
      method: 'POST',
      path: `/api/v1/workspaces/${WORKSPACE.id}/assets/complete-upload`,
      body: { intentId: 'intent_1' },
    });
    expect(progress).toEqual([
      { stage: 'preparing', percent: 0 },
      { stage: 'uploading', percent: 0 },
      { stage: 'uploading', percent: 50 },
      { stage: 'uploading', percent: 100 },
      { stage: 'finishing', percent: 100 },
    ]);
  });

  it('leaves productId out of the intent when no product is given', async () => {
    const { api, client } = setup();
    const pending = uploadFile({
      client,
      workspaceId: WORKSPACE.id,
      file: new File(['x'], 'a.gif', { type: 'image/gif' }),
      createTransport: () => new FakeXhr(),
    });
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    FakeXhr.last().respond(204);
    await pending;
    expect(api.calls.find((call) => call.path.endsWith('upload-intent'))?.body).not.toHaveProperty(
      'productId',
    );
  });

  it('shows the server message for a 415 that carries the standard error body', async () => {
    const { client } = setup();
    const pending = uploadFile({
      client,
      workspaceId: WORKSPACE.id,
      file: new File(['not really a png'], 'fake.png', { type: 'image/png' }),
      createTransport: () => new FakeXhr(),
    });
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    FakeXhr.last().respond(
      415,
      JSON.stringify({
        error: {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'The file content does not match its type.',
          requestId: 'req-415',
        },
      }),
    );

    const error = await pending.catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'The file content does not match its type.',
      status: 415,
      requestId: 'req-415',
    });
  });

  it.each([
    [409, /expired or was already used/],
    [413, /larger than allowed/],
    [400, /was not accepted/],
    [502, /server had a problem/],
  ])('falls back to a readable message for %i without a body', async (status, text) => {
    const { client } = setup();
    const pending = uploadFile({
      client,
      workspaceId: WORKSPACE.id,
      file: new File(['x'], 'a.png', { type: 'image/png' }),
      createTransport: () => new FakeXhr(),
    });
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    FakeXhr.last().respond(status, '<html>proxy error</html>');
    await expect(pending).rejects.toMatchObject({ message: expect.stringMatching(text) });
  });

  it('reports a network error as a readable ApiError', async () => {
    const { client } = setup();
    const pending = uploadFile({
      client,
      workspaceId: WORKSPACE.id,
      file: new File(['x'], 'a.png', { type: 'image/png' }),
      createTransport: () => new FakeXhr(),
    });
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    FakeXhr.last().networkError();
    await expect(pending).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: expect.stringMatching(/Could not reach the server/),
    });
  });

  it('reports a timed-out upload as TIMEOUT', async () => {
    const { client } = setup();
    const pending = uploadFile({
      client,
      workspaceId: WORKSPACE.id,
      file: new File(['x'], 'a.png', { type: 'image/png' }),
      createTransport: () => new FakeXhr(),
    });
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    FakeXhr.last().timedOut();
    await expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('aborts the byte upload when the signal fires, and says it was cancelled', async () => {
    const { client } = setup();
    const controller = new AbortController();
    const pending = uploadFile({
      client,
      workspaceId: WORKSPACE.id,
      file: new File(['x'], 'a.png', { type: 'image/png' }),
      signal: controller.signal,
      createTransport: () => new FakeXhr(),
    });
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));

    controller.abort();

    expect(FakeXhr.last().aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ message: 'The upload was cancelled.' });
  });

  it('makes no request at all when the signal is already aborted', async () => {
    const { api, client } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadFile({
        client,
        workspaceId: WORKSPACE.id,
        file: new File(['x'], 'a.png', { type: 'image/png' }),
        signal: controller.signal,
        createTransport: () => new FakeXhr(),
      }),
    ).rejects.toMatchObject({ message: 'The upload was cancelled.' });
    expect(api.calls).toHaveLength(0);
    expect(FakeXhr.instances).toHaveLength(0);
  });

  it('makes no request for a file that fails validation', async () => {
    const { api, client } = setup();
    await expect(
      uploadFile({
        client,
        workspaceId: WORKSPACE.id,
        file: new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }),
        createTransport: () => new FakeXhr(),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(api.calls).toHaveLength(0);
  });

  it('propagates a refused intent without sending any bytes', async () => {
    const { client } = setup((call) =>
      call.path.endsWith('upload-intent')
        ? json(
            {
              error: {
                code: 'CONFLICT',
                message: 'Too many uploads are in progress. Wait for them to finish.',
                requestId: 'req-q',
              },
            },
            409,
          )
        : undefined,
    );
    await expect(
      uploadFile({
        client,
        workspaceId: WORKSPACE.id,
        file: new File(['x'], 'a.png', { type: 'image/png' }),
        createTransport: () => new FakeXhr(),
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Too many uploads are in progress. Wait for them to finish.',
    });
    expect(FakeXhr.instances).toHaveLength(0);
  });
});
